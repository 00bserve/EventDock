import { BrowserWindow, dialog, globalShortcut, ipcMain, Menu, powerMonitor, screen, Tray } from 'electron';
import { getSettings, updateSettings } from './settings.js';
import { advanceOverdueReminders, reminderStatus } from '../eventTiming.js';
import { join } from 'node:path';
import { openEventStore } from './eventStore.js';
import { createEventRecords, registerAttachmentProtocol } from './eventRecords.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAvailableLanguages, getLanguageState, setLanguage, t } from './i18n.js';

const page = fileURLToPath(new URL('../renderer/eventDock/index.html', import.meta.url));
const settingsPage = fileURLToPath(new URL('../renderer/eventDock/settings.html', import.meta.url));
const previewPage = fileURLToPath(new URL('../renderer/eventDock/imagePreview.html', import.meta.url));
const preload = fileURLToPath(new URL('../../preload/eventDockPreload.cjs', import.meta.url));
const icon = fileURLToPath(new URL('../../assets/icons/icon.png', import.meta.url));
const trayIcon = fileURLToPath(new URL('../../assets/icons/icon.ico', import.meta.url));
const gap = 8;
const animationDuration = 180;
const restingWidth = 14;
const dotLimit = 10;

function indicatorColors(events, now) {
  const counts = { late: 0, soon: 0, normal: 0 };
  for (const event of events) counts[reminderStatus(event, now)]++;
  return Object.entries(counts).flatMap(([color, count]) => Array(Math.min(count, dotLimit)).fill(color)).slice(0, dotLimit);
}

export async function openEventDock(app) {
  const store = await openEventStore(join(app.getPath('appData'), 'EventDock'));
  registerAttachmentProtocol(store);
  let events;
  let startOfToday;
  let startOfTomorrow;
  let overdueBefore;
  let todayCount;
  let todayEvents;
  let restingIndicators;
  let restingOverflow;
  let restingHeight;
  const windows = new Map();
  const ready = new Map();
  const preferences = getSettings();
  let overdueReminders = preferences.overdueReminders ?? {};
  const savedDock = preferences.dockPosition;
  let dockLocked = preferences.dockLocked === true;
  let display = screen.getAllDisplays().find(item => item.id === savedDock?.displayId) ?? screen.getPrimaryDisplay();
  let side = savedDock?.side === 'left' ? 'left' : 'right';
  let vertical = Number.isFinite(savedDock?.vertical) ? Math.max(0, Math.min(1, savedDock.vertical)) : 0.5;
  let draggingDock = false;
  let pinned = false;
  let detailPinned = false;
  let selected = null;
  let previewImage;
  let editOnOpen = false;
  let editing = false;
  let visible = false;
  let searching = false;
  let tray;
  let confirmingDelete = false;
  let transition;
  let menuOpen = false;
  let closingTimer;
  let visibilityRequest = 0;

  const records = createEventRecords({
    store, publish,
    getDetail: () => windows.get('detail'),
    getSelected: () => selected,
  });

  function refreshEvents() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    startOfToday = today.getTime();
    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);
    overdueBefore = yesterday.getTime();
    today.setDate(today.getDate() + 1);
    startOfTomorrow = today.getTime();
    events = store.list();
    todayEvents = events.filter(event =>
      !event.archived && event.eventTime >= startOfToday && event.eventTime < startOfTomorrow
    );
    todayCount = todayEvents.length;
    restingIndicators = indicatorColors(todayEvents, Date.now());
    restingOverflow = todayCount > dotLimit;
    restingHeight = Math.max(88, 22 + (restingIndicators.length + Number(restingOverflow)) * 12);
  }

  function checkOverdueReminders(now) {
    const dock = windows.get('dock');
    if (!dock || dock.isDestroyed() || !dock.isVisible() || draggingDock) return;
    const { reminders, shake } = advanceOverdueReminders(events, overdueReminders, now);
    if (JSON.stringify(reminders) !== JSON.stringify(overdueReminders)) {
      overdueReminders = reminders;
      try { updateSettings({ overdueReminders }); }
      catch (error) { console.error('[EventDock] Could not save overdue reminder history:', error); }
    }
    if (shake) dock.webContents.send('event-dock:overdue-shake');
  }

  function refreshDate() {
    const now = Date.now();
    checkOverdueReminders(now);
    if (now < startOfToday || now >= startOfTomorrow) {
      publish();
      return;
    }
    const next = indicatorColors(todayEvents, now);
    if (!next.every((color, index) => color === restingIndicators[index])) {
      restingIndicators = next;
      const dock = windows.get('dock');
      if (dock && !dock.isDestroyed()) dock.webContents.send('event-dock:state', state());
    }
    const panel = windows.get('panel');
    if (visible && panel && !panel.isDestroyed()) panel.webContents.send('event-dock:state', state());
  }

  refreshEvents();

  function layout() {
    const { x, y, width, height } = display.workArea;
    const dockHeight = Math.min(172, height);
    const dockWidth = 42;
    const left = side === 'left';
    const compactHeight = Math.min(dockHeight, restingHeight);
    const center = Math.max(y + compactHeight / 2, Math.min(y + height - compactHeight / 2, y + vertical * height));
    const dockY = Math.max(y, Math.min(y + height - dockHeight, Math.round(center - dockHeight / 2)));
    const right = x + width;
    const adjacentToDock = screen.getAllDisplays().some(({ id, bounds }) =>
      id !== display.id && (left ? bounds.x + bounds.width === x : bounds.x === right) &&
      bounds.y < dockY + dockHeight && bounds.y + bounds.height > dockY
    );
    const inset = adjacentToDock ? 2 : 0;
    const expandedDock = {
      x: left ? x + inset : right - dockWidth - inset,
      y: dockY,
      width: dockWidth,
      height: dockHeight,
    };
    const restingDock = {
      x: expandedDock.x + (left ? 0 : dockWidth - restingWidth),
      y: Math.round(center - compactHeight / 2),
      width: restingWidth,
      height: compactHeight,
    };
    const panelWidth = Math.min(356, Math.max(1, width - dockWidth - gap));
    const maxPanelHeight = Math.max(1, Math.floor(height * 0.75));
    // Reused by the renderer when the list changes height.
    const panelHeight = Math.min(panelRequestHeight, maxPanelHeight);
    const panel = {
      x: left ? expandedDock.x + dockWidth + gap : expandedDock.x - gap - panelWidth,
      y: Math.max(y, Math.min(Math.round(center - 138), y + height - panelHeight)),
      width: panelWidth,
      height: panelHeight,
    };
    const room = left ? right - panel.x - panelWidth - gap : panel.x - x - gap;
    const detailWidth = Math.min(690, room >= 480 ? room : width - dockWidth - gap);
    const detailHeight = Math.min(510, height);
    const detail = {
      x: room >= 480
        ? (left ? panel.x + panelWidth + gap : panel.x - gap - detailWidth)
        : (left ? right - detailWidth : x),
      y: Math.max(y, Math.min(panel.y + 12, y + height - detailHeight)),
      width: detailWidth,
      height: detailHeight,
    };
    return { dock: expandedDock, restingDock, panel, detail };
  }

  let panelRequestHeight = 390;

  function updateDockHitRegion() {
    const dock = windows.get('dock');
    if (process.platform !== 'win32' || !dock || dock.isDestroyed()) return;

    // Keep the native window still while letting clicks through the blank area at rest.
    if (visible || closingTimer) {
      dock.setShape([]);
      return;
    }
    const bounds = layout();
    const strip = bounds.restingDock;
    dock.setShape([{
      x: strip.x - bounds.dock.x,
      y: strip.y - bounds.dock.y,
      width: strip.width,
      height: strip.height,
    }]);
  }

  function createWindow(view) {
    const isDock = view === 'dock';
    const isPreview = view === 'preview';
    const bounds = isPreview
      ? screen.getDisplayMatching(windows.get('detail').getBounds()).bounds : layout()[view];
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      fullscreen: isPreview,
      frame: false,
      movable: view === 'detail',
      // Windows resize hit targets would consume the entire resting strip.
      resizable: !isDock && !isPreview,
      minimizable: view === 'detail',
      maximizable: false,
      alwaysOnTop: view !== 'detail' || detailPinned,
      skipTaskbar: view !== 'detail',
      focusable: view !== 'dock',
      autoHideMenuBar: true,
      // The renderer draws the rounded surface; the desktop shows through its corners.
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      thickFrame: !isDock && !isPreview,
      icon,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.removeMenu();
    if (view === 'detail') win.on('close', event => {
      if (!records.flush()) event.preventDefault();
    });
    if (view === 'panel') win.on('will-resize', event => event.preventDefault());
    windows.set(view, win);
    win.on('closed', () => {
      windows.delete(view);
      ready.delete(view);
      if (isPreview) previewImage = undefined;
      if (view === 'detail') {
        windows.get('preview')?.close();
        detailPinned = false;
        selected = null;
        editOnOpen = false;
        setEditing(false);
        publish();
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    ready.set(view, win.loadFile(isPreview ? previewPage : page, { query: { view } }).catch(error => {
      console.error(`[EventDock] Could not open ${view}:`, error);
      if (!win.isDestroyed()) win.destroy();
    }));
    return win;
  }

  const state = () => {
    const { restingDock, dock } = layout();
    return {
      events,
      startOfToday,
      startOfTomorrow,
      overdueBefore,
      todayCount,
      restingIndicators,
      restingOverflow,
      selected,
      editOnOpen,
      pinned,
      detailPinned,
      expanded: visible,
      restingHeight,
      restingWidth,
      animationDuration,
      side,
      dockLocked,
      restingCenter: restingDock.y - dock.y + restingDock.height / 2,
    };
  };

  function publish() {
    const priorHeight = restingHeight;
    refreshEvents();
    if (!visible && restingHeight !== priorHeight) updateDockHitRegion();
    const snapshot = state();
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('event-dock:state', snapshot);
    }
  }

  function cancelTransition() {
    clearTimeout(transition);
    transition = undefined;
  }

  function pointerInside() {
    const point = screen.getCursorScreenPoint();
    return [...windows.values()].some(win => {
      if (win.isDestroyed() || !win.isVisible() || win.isMinimized()) return false;
      const { x, y, width, height } = win.getBounds();
      return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
    });
  }

  async function expand() {
    cancelTransition();
    const request = ++visibilityRequest;
    await ready.get('panel');
    const panel = windows.get('panel');
    if (request !== visibilityRequest || !panel || panel.isDestroyed()) return;
    if (visible) return;
    clearTimeout(closingTimer);
    closingTimer = undefined;
    visible = true;
    updateDockHitRegion();
    publish();
    panel.webContents.send('event-dock:animate', 'in');
    if (!panel.isVisible()) panel.showInactive();
    panel.focus();
  }

  function collapse() {
    cancelTransition();
    visibilityRequest++;
    visible = false;
    publish();
    endSearch();
    const panel = windows.get('panel');
    panel?.webContents.send('event-dock:animate', 'out');
    closingTimer = setTimeout(() => {
      closingTimer = undefined;
      updateDockHitRegion();
      if (panel && !panel.isDestroyed()) panel.hide();
    }, animationDuration + 34);
  }

  function dismissOnFocusLoss() {
    cancelTransition();
    if (!visible || pinned || confirmingDelete || draggingDock || menuOpen) return;
    transition = setTimeout(() => {
      transition = undefined;
      if (!BrowserWindow.getFocusedWindow() && !pointerInside() && !menuOpen && !pinned) collapse();
    }, 50);
  }

  function setEditing(value) {
    editing = value;
    if (editing && !visible) void expand();
  }

  function popupControlMenu(menu, view) {
    menuOpen = true;
    cancelTransition();
    menu.popup({ window: windows.get(view), callback: () => { menuOpen = false; } });
  }

  async function openDetail(id, edit = false) {
    if (!records.flush()) return;
    const record = store.get(id);
    if (!record) return;
    if (selected !== id || edit) {
      windows.get('preview')?.close();
      editOnOpen = edit || Boolean(record.draft);
      setEditing(editOnOpen);
    }
    selected = id;
    const detail = windows.get('detail') ?? createWindow('detail');
    publish();
    await ready.get('detail');
    if (detail.isDestroyed() || selected !== id) return;
    const animate = !detail.isVisible() || detail.isMinimized();
    if (detail.isMinimized()) detail.restore();
    if (animate) detail.setBounds(layout().detail);
    // An explicit row click should raise the detail above the current app.
    detail.show();
    detail.moveTop();
    if (animate) detail.webContents.send('event-dock:animate', 'in');
  }

  async function openImagePreview(id) {
    const attachment = store.getAttachment(id);
    if (!attachment || attachment.eventId !== selected || !attachment.mime.startsWith('image/')) return;
    const existing = windows.get('preview');
    if (existing && !existing.isDestroyed()) return;
    previewImage = { id, name: attachment.name };
    const preview = createWindow('preview');
    preview.setAlwaysOnTop(true, 'screen-saver');
    await ready.get('preview');
    if (!preview.isDestroyed()) preview.show();
  }

  function createEvent() {
    if (!records.flush()) return;
    try {
      void openDetail(store.create(), true);
    } catch (error) {
      console.error('[EventDock] Could not create event:', error);
      dialog.showErrorBox(t('dockName'), t('dockSaveFailed'));
    }
  }

  function endSearch() {
    if (!searching) return;
    searching = false;
    const panel = windows.get('panel');
    if (!panel || panel.isDestroyed()) return;
    panel.webContents.send('event-dock:search-ended');
  }

  function onDisplayChange() {
    const dock = windows.get('dock');
    if (!dock || dock.isDestroyed()) return;
    display = screen.getAllDisplays().find(item => item.id === display.id) ?? screen.getPrimaryDisplay();
    repositionDock();
  }

  function repositionDock() {
    const dock = windows.get('dock');
    if (!dock || dock.isDestroyed()) return;
    const bounds = layout();
    dock.setBounds(bounds.dock);
    updateDockHitRegion();
    windows.get('panel')?.setBounds(bounds.panel);
    if (draggingDock) {
      dock.webContents.send('event-dock:state', state());
    } else {
      if (windows.get('detail')?.isVisible()) windows.get('detail').setBounds(bounds.detail);
      publish();
    }
  }

  function changeLanguage(locale) {
    if (!setLanguage(locale)) return;
    refreshTray();
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('i18n:changed', getLanguageState());
    }
  }

  function openSettingsWindow() {
    const existing = windows.get('settings');
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 500, height: 430, minWidth: 370, minHeight: 370,
      show: false, title: t('dockSettings'), icon,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    windows.set('settings', win);
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('closed', () => windows.delete('settings'));
    void win.loadFile(settingsPage, { query: { view: 'settings' } }).then(() => {
      if (win.isDestroyed()) return;
      win.showInactive();
      win.focus();
    }).catch(error => {
      console.error('[EventDock] Could not open settings:', error);
      if (!win.isDestroyed()) win.destroy();
    });
  }

  function buildControlMenu(fromTray = false) {
    return Menu.buildFromTemplate([
      ...shortcuts.map(shortcut => ({
        label: t(shortcut.label),
        accelerator: shortcut.accelerator,
        registerAccelerator: false,
        click: shortcut.action,
      })),
      { type: 'separator' },
      {
        label: t('language'),
        submenu: [
          { locale: 'system', name: t('system') },
          ...getAvailableLanguages(),
        ].map(({ locale, name }) => ({
          label: name,
          type: 'radio',
          checked: getLanguageState().preference === locale,
          click: () => changeLanguage(locale),
        })),
      },
      { type: 'separator' },
      ...(fromTray ? [{ label: t('dockSettings'), click: openSettingsWindow }] : []),
      { label: t('quit'), click: () => app.quit() },
    ]);
  }

  function refreshTray() {
    if (!tray || tray.isDestroyed()) return;
    tray.setToolTip(t('dockName'));
    tray.setContextMenu(buildControlMenu(true));
  }

  function openMenu(view) {
    cancelTransition();
    popupControlMenu(buildControlMenu(), view);
  }

  function moveToToday(id) {
    if (!records.flush()) return;
    refreshDate();
    const record = store.get(id);
    if (!record) return;
    const date = new Date(record.eventTime);
    const today = new Date(startOfToday);
    date.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
    const eventTime = date.getTime();
    try {
      store.moveToToday(id, eventTime);
      if (selected === id) windows.get('detail')?.webContents.send('event-dock:event-moved', { id, eventTime });
      publish();
    } catch (error) {
      console.error('[EventDock] Could not move event to today:', error);
      dialog.showErrorBox(t('dockName'), t('dockSaveFailed'));
    }
  }

  function openEventMenu(id) {
    refreshDate();
    const record = store.get(id);
    if (!record) return;
    const menu = Menu.buildFromTemplate([
      { label: t('dockMoveToday'), click: () => moveToToday(id) },
      {
        label: t('dockPriority'),
        submenu: [
          ['dockPriorityUrgent', 2], ['dockPriorityNormal', 1], ['dockPriorityLow', 0],
        ].map(([label, priority]) => ({
          label: t(label), type: 'radio', checked: priority === record.priority,
          click: () => {
            if (!store.get(id)) return;
            try {
              store.setPriority(id, priority);
              publish();
            } catch (error) {
              console.error('[EventDock] Could not save priority:', error);
              dialog.showErrorBox(t('dockName'), t('dockSaveFailed'));
            }
          },
        })),
      },
    ]);
    popupControlMenu(menu, 'panel');
  }

  function senderView(event) {
    for (const [view, win] of windows) {
      if (event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame) return view;
    }
  }

  ipcMain.handle('event-dock:settings', (event, action, value) => {
    if (senderView(event) !== 'settings') return null;
    if (action === 'lock' && typeof value === 'boolean') {
      updateSettings({ dockLocked: value });
      dockLocked = value;
      if (value && draggingDock) {
        draggingDock = false;
      }
      publish();
    } else if (action === 'side' && (value === 'left' || value === 'right')) {
      updateSettings({ dockPosition: { displayId: display.id, side: value, vertical } });
      side = value;
      repositionDock();
    } else if (action === 'language' && typeof value === 'string') {
      changeLanguage(value);
    }
    return { dockLocked, side, language: getLanguageState().preference, languages: getAvailableLanguages() };
  });
  ipcMain.handle('event-dock:get', event => senderView(event) ? state() : null);
  ipcMain.handle('i18n:get', event => senderView(event) ? getLanguageState() : null);
  ipcMain.handle('event-dock:editor-url', event => {
    if (senderView(event) !== 'detail') return null;
    const bundle = !app.isPackaged && process.env.EVENT_DOCK_EDITOR_BUNDLE;
    return bundle ? pathToFileURL(bundle).href : new URL('../renderer/eventDock/editor.bundle.js', import.meta.url).href;
  });
  ipcMain.handle('event-dock:preview', event =>
    senderView(event) === 'preview' ? previewImage : null
  );
  ipcMain.handle('event-dock:record', (event, id) =>
    senderView(event) === 'detail' && typeof id === 'string' && id === selected ? store.get(id) : null
  );
  ipcMain.on('event-dock:stage', (event, id, revision, value) => {
    if (senderView(event) === 'detail') records.stage(id, revision, value);
  });
  ipcMain.handle('event-dock:attachment', async (event, id, action, value) => {
    const view = senderView(event);
    if (view === 'preview' && action === 'copy' && value === previewImage?.id) {
      return records.copyImage(selected, value);
    }
    if (view !== 'detail' || typeof id !== 'string' || id !== selected) return null;
    if (action === 'add') return records.attach(id, value);
    if (action === 'copy' && typeof value === 'string') return records.copyImage(id, value);
    if (action === 'export' && typeof value === 'string') return records.exportAttachment(id, value);
    if (action === 'remove' && typeof value === 'string' && records.flush()) {
      if (!store.removeAttachment(id, value)) return null;
      publish();
      return store.get(id);
    }
    return null;
  });
  ipcMain.handle('event-dock:manage', async (event, id, action) => {
    const view = senderView(event);
    const fromPanel = view === 'panel' && visible;
    if ((!fromPanel && (view !== 'detail' || id !== selected)) ||
        typeof id !== 'string' || !store.get(id)) return false;

    if (fromPanel && action === 'complete' && records.flush()) {
      store.toggleComplete(id);
      publish();
      return true;
    }
    if (view === 'detail' && action === 'remove' && !confirmingDelete) {
      confirmingDelete = true;
      cancelTransition();
      try {
        if (!await records.remove(id)) return false;
        if (selected === id) windows.get('detail')?.close();
        publish();
        return true;
      } finally {
        confirmingDelete = false;
      }
    }
    if (fromPanel && action === 'archive' && records.flush()) {
      store.archive(id, !store.get(id).archived);
      publish();
      return true;
    }
    if (view === 'detail' && (action === 'archive' || action === 'restore') && records.flush()) {
      store.archive(id, action === 'archive');
      publish();
      return true;
    }
    return false;
  });

  ipcMain.on('event-dock:action', (event, action, value) => {
    const view = senderView(event);
    if (!view) return;
    const win = windows.get(view);

    if (view === 'preview' && action === 'close') return win.close();
    if (view === 'panel' && visible && action === 'event-menu' && typeof value === 'string') {
      return openEventMenu(value);
    }
    if (action === 'menu' && view !== 'detail') return openMenu(view);
    if (view === 'dock' && action === 'drag-start' && !dockLocked) {
      draggingDock = true;
      cancelTransition();
    }
    if (view === 'dock' && draggingDock && (action === 'drag-move' || action === 'drag-end')) {
      const point = screen.getCursorScreenPoint();
      display = screen.getDisplayNearestPoint(point);
      const { x, y, width, height } = display.workArea;
      side = point.x < x + width / 2 ? 'left' : 'right';
      vertical = Math.max(0, Math.min(1, (point.y - y) / height));
      if (action === 'drag-end') draggingDock = false;
      repositionDock();
      if (action === 'drag-end') {
        try { updateSettings({ dockPosition: { displayId: display.id, side, vertical } }); }
        catch (error) { console.error('[EventDock] Could not save dock position:', error); }
      }
      return;
    }
    if (view === 'dock' && action === 'toggle') {
      togglePanel();
    }
    if (view === 'panel') {
      if (action === 'new' && visible) createEvent();
      if (action === 'open' && typeof value === 'string' && visible) void openDetail(value);
      if (action === 'pin') {
        pinned = !pinned;
        publish();
        if (pinned) cancelTransition();
      }
      if (action === 'resize' && Number.isInteger(value) && value > 0 && value < 3000) {
        if (panelRequestHeight === value) return;
        panelRequestHeight = value;
        win.setBounds(layout().panel);
      }
      if (action === 'search' && visible) void focusSearch();
      if (action === 'end-search') endSearch();
    }
    if (view === 'detail') {
      if (action === 'preview' && typeof value === 'string') void openImagePreview(value);
      if (action === 'editing' && value?.id === selected && typeof value.active === 'boolean') {
        if (editing !== value.active) setEditing(value.active);
      }
      if (action === 'pin') {
        detailPinned = !detailPinned;
        win.setAlwaysOnTop(detailPinned);
        publish();
      }
      if (action === 'close') win.close();
      if (action === 'minimize') win.minimize();
    }
  });

  const dock = createWindow('dock');
  const panel = createWindow('panel');
  app.on('browser-window-blur', dismissOnFocusLoss);
  app.on('browser-window-focus', cancelTransition);
  function togglePanel() {
    if (visible) {
      pinned = false;
      collapse();
    } else void expand();
  }

  async function focusSearch(tab) {
    await expand();
    if (!visible || panel.isDestroyed()) return;
    searching = true;
    cancelTransition();
    panel.focus();
    panel.webContents.send('event-dock:search-started', tab);
  }

  const shortcuts = [
    { letter: 'N', label: 'dockNewEvent', action: createEvent },
    { letter: 'E', label: 'dockTogglePanel', action: togglePanel },
    { letter: 'F', label: 'dockSearch', action: () => void focusSearch('long-term') },
  ];
  for (const shortcut of shortcuts) {
    const keys = ['Ctrl+Alt+', 'Ctrl+Alt+Shift+'].map(prefix => prefix + shortcut.letter);
    shortcut.accelerator = keys.find(key => globalShortcut.register(key, shortcut.action));
    if (!shortcut.accelerator) console.warn('[EventDock] Shortcut unavailable:', keys.join(', '));
  }
  tray = new Tray(process.platform === 'win32' ? trayIcon : icon);
  tray.on('click', togglePanel);
  tray.on('right-click', cancelTransition);
  refreshTray();

  const dateTimer = setInterval(refreshDate, 30_000);
  powerMonitor.on('resume', refreshDate);
  const displayEvents = ['display-added', 'display-removed', 'display-metrics-changed'];
  for (const name of displayEvents) screen.on(name, onDisplayChange);
  app.on('before-quit', event => {
    if (!records.flush()) {
      event.preventDefault();
      dialog.showErrorBox(t('dockName'), t('dockSaveFailed'));
      return;
    }
    clearInterval(dateTimer);
    globalShortcut.unregisterAll();
    if (tray && !tray.isDestroyed()) tray.destroy();
    powerMonitor.removeListener('resume', refreshDate);
    app.removeListener('browser-window-blur', dismissOnFocusLoss);
    app.removeListener('browser-window-focus', cancelTransition);
    cancelTransition();
    clearTimeout(closingTimer);
    for (const name of displayEvents) screen.removeListener(name, onDisplayChange);
  });

  ready.get('dock').then(() => {
    if (dock.isDestroyed()) return;
    updateDockHitRegion();
    dock.showInactive();
    checkOverdueReminders(Date.now());
  });
}
