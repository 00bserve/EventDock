import { BrowserWindow, dialog, globalShortcut, ipcMain, Menu, powerMonitor, screen } from 'electron';
import { join } from 'node:path';
import { openEventStore } from './eventStore.js';
import { createEventRecords, registerAttachmentProtocol } from './eventRecords.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAvailableLanguages, getLanguageState, setLanguage, t } from './i18n.js';

const page = fileURLToPath(new URL('../renderer/eventDock/index.html', import.meta.url));
const previewPage = fileURLToPath(new URL('../renderer/eventDock/imagePreview.html', import.meta.url));
const preload = fileURLToPath(new URL('../../preload/eventDockPreload.cjs', import.meta.url));
const icon = fileURLToPath(new URL('../../assets/icons/icon.png', import.meta.url));
const gap = 8;
const animationDuration = 180;
const editIdleDelay = 60_000;
const restingWidth = 14;

export async function openEventDock(app) {
  const store = await openEventStore(join(app.getPath('appData'), 'EventDock'));
  registerAttachmentProtocol(store);
  let events;
  let startOfToday;
  let startOfTomorrow;
  let todayCount;
  let restingDots;
  let restingOverflow;
  let restingHeight;
  const windows = new Map();
  const ready = new Map();
  let display = screen.getPrimaryDisplay();
  let pinned = false;
  let detailPinned = false;
  let selected = null;
  let previewImage;
  let editOnOpen = false;
  let editing = false;
  let editIdleTimer;
  let visible = false;
  let searching = false;
  let confirmingDelete = false;
  let transition;
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
    today.setDate(today.getDate() + 1);
    startOfTomorrow = today.getTime();
    events = store.list();
    todayCount = events.filter(event =>
      !event.archived && event.eventTime >= startOfToday && event.eventTime < startOfTomorrow
    ).length;
    restingDots = Math.min(todayCount, 10);
    restingOverflow = todayCount > restingDots;
    restingHeight = Math.max(88, 22 + (restingDots + Number(restingOverflow)) * 12);
  }

  function refreshDate() {
    const now = Date.now();
    if (now < startOfToday || now >= startOfTomorrow) publish();
  }

  refreshEvents();

  function layout() {
    const { x, y, width, height } = display.workArea;
    const dockHeight = Math.min(172, height);
    const dockWidth = 42;
    const dockY = y + Math.round((height - dockHeight) / 2);
    const right = x + width;
    const adjacentToDock = screen.getAllDisplays().some(({ id, bounds }) =>
      id !== display.id && bounds.x === right &&
      bounds.y < dockY + dockHeight && bounds.y + bounds.height > dockY
    );
    const expandedDock = {
      x: right - dockWidth - (adjacentToDock ? 2 : 0),
      y: dockY,
      width: dockWidth,
      height: dockHeight,
    };
    const compactHeight = Math.min(dockHeight, restingHeight);
    const restingDock = {
      x: expandedDock.x + dockWidth - restingWidth,
      y: dockY + Math.floor((dockHeight - compactHeight) / 2),
      width: restingWidth,
      height: compactHeight,
    };
    const panelWidth = Math.min(356, Math.max(1, width - dockWidth - gap));
    const maxPanelHeight = Math.max(1, Math.floor(height * 0.75));
    // Reused by the renderer when the list changes height.
    const panelHeight = Math.min(panelRequestHeight, maxPanelHeight);
    const panel = {
      x: expandedDock.x - gap - panelWidth,
      y: Math.max(y, Math.min(dockY - 52, y + height - panelHeight)),
      width: panelWidth,
      height: panelHeight,
    };
    const room = panel.x - x - gap;
    const detailWidth = Math.min(690, room >= 480 ? room : width - dockWidth - gap);
    const detailHeight = Math.min(510, height);
    const detail = {
      x: room >= 480 ? panel.x - gap - detailWidth : x,
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
      skipTaskbar: true,
      focusable: view === 'detail' || isPreview,
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
        scheduleCollapse();
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

  const state = () => ({
    events,
    startOfToday,
    startOfTomorrow,
    todayCount,
    restingDots,
    restingOverflow,
    selected,
    editOnOpen,
    pinned,
    detailPinned,
    expanded: visible,
    restingHeight,
    restingWidth,
    animationDuration,
  });

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
    resetEditIdle();
  }

  function collapse() {
    cancelTransition();
    clearTimeout(editIdleTimer);
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

  function scheduleCollapse() {
    cancelTransition();
    if (!visible || pinned || searching || editing || confirmingDelete) return;
    transition = setTimeout(() => {
      transition = undefined;
      if (!pointerInside()) collapse();
    }, 400);
  }

  function resetEditIdle() {
    if (!editing || !visible) return;
    clearTimeout(editIdleTimer);
    editIdleTimer = setTimeout(() => {
      if (editing && visible && !pinned && !confirmingDelete) collapse();
    }, editIdleDelay);
  }

  function setEditing(value) {
    editing = value;
    clearTimeout(editIdleTimer);
    if (editing) {
      cancelTransition();
      if (visible) resetEditIdle();
      else void expand();
    } else {
      scheduleCollapse();
    }
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
    if (panel.isFocused()) panel.blur();
    panel.setFocusable(false);
    panel.webContents.send('event-dock:search-ended');
  }

  function onDisplayChange() {
    const dock = windows.get('dock');
    if (!dock || dock.isDestroyed()) return;
    display = screen.getDisplayMatching(dock.getBounds());
    const bounds = layout();
    dock.setBounds(bounds.dock);
    updateDockHitRegion();
    windows.get('panel')?.setBounds(bounds.panel);
    if (windows.get('detail')?.isVisible()) windows.get('detail').setBounds(bounds.detail);
  }

  function changeLanguage(locale) {
    if (!setLanguage(locale)) return;
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('i18n:changed', getLanguageState());
    }
  }

  function openMenu(view) {
    const menu = Menu.buildFromTemplate([
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
      { label: t('quit'), click: () => app.quit() },
    ]);
    cancelTransition();
    menu.popup({ window: windows.get(view), callback: scheduleCollapse });
  }

  function senderView(event) {
    for (const [view, win] of windows) {
      if (event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame) return view;
    }
  }

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
    if (action === 'remove' && !confirmingDelete) {
      confirmingDelete = true;
      cancelTransition();
      try {
        if (!await records.remove(id, fromPanel)) return false;
        if (selected === id) windows.get('detail')?.close();
        publish();
        return true;
      } finally {
        confirmingDelete = false;
        if (editing) resetEditIdle();
        else scheduleCollapse();
      }
    }
    if (view === 'detail' && (action === 'archive' || action === 'restore') && records.flush()) {
      store.archive(id, action === 'archive');
      publish();
      return true;
    }
    return false;
  });
  ipcMain.on('event-dock:pointer', (event, inside) => {
    const view = senderView(event);
    if (!view || typeof inside !== 'boolean') return;
    if (inside) {
      cancelTransition();
      resetEditIdle();
    } else {
      scheduleCollapse();
    }
  });

  ipcMain.on('event-dock:action', (event, action, value) => {
    const view = senderView(event);
    if (!view) return;
    const win = windows.get(view);

    if (action === 'activity') return resetEditIdle();
    if (view === 'preview' && action === 'close') return win.close();
    if (action === 'menu' && view !== 'detail') return openMenu(view);
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
        else if (editing) resetEditIdle();
        else scheduleCollapse();
      }
      if (action === 'resize' && Number.isInteger(value) && value > 0 && value < 3000) {
        if (panelRequestHeight === value) return;
        panelRequestHeight = value;
        win.setBounds(layout().panel);
      }
      if (action === 'search' && visible) void focusSearch();
      if (action === 'end-search') {
        endSearch();
        scheduleCollapse();
      }
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
  panel.on('blur', () => {
    endSearch();
    scheduleCollapse();
  });
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
    panel.setFocusable(true);
    panel.focus();
    panel.webContents.send('event-dock:search-started', tab);
  }

  const shortcuts = [
    { letter: 'N', label: 'dockNewEvent', action: createEvent },
    { letter: 'E', label: 'dockTogglePanel', action: togglePanel },
    { letter: 'F', label: 'dockSearch', action: () => void focusSearch('all') },
  ];
  for (const shortcut of shortcuts) {
    const keys = ['Ctrl+Alt+', 'Ctrl+Alt+Shift+'].map(prefix => prefix + shortcut.letter);
    shortcut.accelerator = keys.find(key => globalShortcut.register(key, shortcut.action));
    if (!shortcut.accelerator) console.warn('[EventDock] Shortcut unavailable:', keys.join(', '));
  }
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
    powerMonitor.removeListener('resume', refreshDate);
    cancelTransition();
    clearTimeout(closingTimer);
    clearTimeout(editIdleTimer);
    for (const name of displayEvents) screen.removeListener(name, onDisplayChange);
  });

  ready.get('dock').then(() => {
    if (dock.isDestroyed()) return;
    updateDockHitRegion();
    dock.showInactive();
  });
}
