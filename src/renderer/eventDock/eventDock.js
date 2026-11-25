import { languageReady, localize, t } from '../shared/i18n.js';

const view = new URLSearchParams(location.search).get('view');
const app = document.getElementById('app');
const api = window.api;
const icons = {
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9m-9 4h4"/>',
  pin: '<path d="m14 4 6 6-4 1-3 4v3l-2 2-2-5-5-2 2-2h3l4-3 1-4ZM9 15l-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  document: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8m-8 4h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tag: '<path d="M20 12 12 4H4v8l8 8a2 2 0 0 0 3 0l5-5a2 2 0 0 0 0-3Z"/><circle cx="8" cy="8" r="1"/>',
  clip: '<path d="m9 12 5-5a3 3 0 0 1 4 4l-7 7a5 5 0 0 1-7-7l8-8"/>',
  minimize: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

function icon(name) {
  return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
}

function button(name, action, label, pressed = false) {
  return '<button type="button" class="icon-button" data-action="' + action +
    '" data-i18n-title="' + label + '"' + (pressed ? ' aria-pressed="false"' : '') +
    '>' + icon(name) + '</button>';
}

const views = {
  dock: () => `
    <button type="button" class="dock-trigger" data-action="toggle" aria-expanded="false">
      <span class="dock-content">
        ${icon('calendar')}
        <span class="dock-label" data-i18n="dockToday"></span>
        <span class="dock-count" id="count"></span>
      </span>
      <span class="dock-indicators" id="dock-indicators" aria-hidden="true"></span>
    </button>`,
  panel: () => `
    <section class="panel">
      <header class="panel-header">
        <nav class="tabs" aria-label="">
          <button type="button" data-tab="today">${icon('calendar')}<span data-i18n="dockTabToday"></span></button>
          <button type="button" data-tab="all">${icon('layers')}<span data-i18n="dockTabAll"></span></button>
          <button type="button" data-tab="archive">${icon('archive')}<span data-i18n="dockTabArchive"></span></button>
        </nav>
        ${button('pin', 'pin', 'dockPinPanel', true)}
      </header>
      <div class="panel-body">
        <div class="panel-heading">
          <h1 id="list-title"></h1>
          <span class="list-count" id="count"></span>
          <div class="panel-actions">
            ${button('plus', 'new', 'dockNewEvent')}
            ${button('search', 'search', 'dockSearch')}
            ${button('more', 'menu', 'menu')}
          </div>
        </div>
        <input id="search" type="search" data-i18n-placeholder="dockSearch" hidden>
        <div class="list-scroll"><div id="rows" class="rows"></div></div>
        <output id="list-status" aria-live="polite" hidden></output>
      </div>
    </section>`,
  detail: () => `
    <section class="detail">
      <header class="detail-header">
        <div class="detail-label">${icon('document')}<span id="detail-mode" data-i18n="dockDetail"></span></div>
        <div class="record-header-actions">
          <output id="save-status" aria-live="polite"></output>
          <button type="button" class="record-button" id="record-preview" data-i18n="dockPreview" hidden></button>
          <button type="button" class="record-button primary" id="record-edit" data-i18n="edit"></button>
          <button type="button" class="record-button primary" id="record-save" data-i18n="dockSave" hidden></button>
          <details class="record-more">
            <summary class="icon-button" data-i18n-title="menu">${icon('more')}</summary>
            <div class="record-menu">
              <button type="button" id="record-archive"></button>
              <button type="button" id="record-delete" data-i18n="delete"></button>
            </div>
          </details>
        </div>
        <div class="detail-actions">
          ${button('pin', 'pin', 'pin', true)}
          ${button('minimize', 'minimize', 'minimize')}
          ${button('close', 'close', 'close')}
        </div>
      </header>
      <div class="detail-scroll">
        <div id="record-heading">
          <h1 id="event-title"></h1>
          <div class="meta-line">${icon('clock')}<span data-i18n="dockTime"></span><time id="event-time"></time></div>
          <div class="meta-line">${icon('tag')}<span data-i18n="dockTags"></span><div class="tags" id="event-tags"></div></div>
        </div>
        <div id="record-fields" class="record-fields" hidden>
          <input id="edit-title" maxlength="200" data-i18n-title="dockTitleField" data-i18n-placeholder="dockUntitled">
          <div class="record-metadata">
            <label class="record-meta">${icon('clock')}<span data-i18n="dockTime"></span><input id="edit-time" type="datetime-local"></label>
            <div class="record-meta record-tag-editor">
              ${icon('tag')}<label for="edit-tags" data-i18n="dockTags"></label>
              <div class="record-tag-controls"><div id="edit-tag-list" class="tags"></div><input id="edit-tags" maxlength="300" data-i18n-placeholder="dockAddTag"></div>
            </div>
          </div>
        </div>
        <section class="detail-section editor-card">
          <h2 id="content-heading">${icon('document')}<span data-i18n="dockContent"></span></h2>
          <div id="editor-tools" class="record-tools" role="group" aria-labelledby="content-heading" hidden>
            <button class="record-button" type="button" data-command="undo" data-i18n-title="undo">↶</button>
            <button class="record-button" type="button" data-command="redo" data-i18n-title="redo">↷</button>
            <span class="editor-divider" aria-hidden="true"></span>
            <button class="record-button" type="button" data-command="bold" data-i18n-title="bold"><strong data-i18n="boldGlyph"></strong></button>
            <button class="record-button" type="button" data-command="italic" data-i18n-title="italic"><em data-i18n="italicGlyph"></em></button>
            <button class="record-button" type="button" data-command="underline" data-i18n-title="underline"><u data-i18n="underlineGlyph"></u></button>
            <span class="editor-divider" aria-hidden="true"></span>
            <button class="record-button" type="button" data-command="list" data-i18n-title="bulletList">•≡</button>
            <button class="record-button" type="button" data-command="ordered" data-i18n-title="dockOrderedList">1≡</button>
            <button class="record-button" type="button" data-command="task" data-i18n-title="dockTaskList">☑</button>
            <button class="record-button" type="button" data-command="heading" data-i18n-title="dockHeading">H2</button>
            <button class="record-button" type="button" data-command="quote" data-i18n-title="dockQuote">❝</button>
            <button class="record-button" type="button" data-command="code" data-i18n-title="dockCode">&lt;/&gt;</button>
            <button class="record-button" type="button" data-command="table" data-i18n-title="dockTable">▦</button>
            <button class="record-button" type="button" data-command="link" data-i18n="dockLink"></button>
            <span class="editor-divider" aria-hidden="true"></span>
            <button type="button" class="record-button" id="record-attach" data-i18n-title="dockAttach">${icon('clip')}</button>
          </div>
          <form id="link-form" class="record-tools" hidden>
            <input id="link-address" maxlength="2048" data-i18n-placeholder="dockLinkAddress" aria-label="URL" required>
            <button type="submit" class="record-button" data-i18n="dockApplyLink"></button>
          </form>
          <div id="event-content"></div>
        </section>
        <section class="detail-section" id="attachments" hidden>
          <h2>${icon('clip')}<span data-i18n="dockAttachments"></span></h2>
          <div id="attachment-list"></div>
        </section>
      </div>
    </section>`,
};

document.body.dataset.view = view;
app.innerHTML = views[view]();

const byId = id => document.getElementById(id);
const search = byId('search');
const recordView = view === 'detail'
  ? (await import('./recordView.js')).createRecordView(api, formatDate) : null;
let activeTab = 'today';
let state;
let loaded = false;
let receivedState = false;
let lastHeight;

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function eventTitle(event) {
  return event.title || event.summary?.split('\n')[0].slice(0, 80) || t('dockUntitled');
}

function isToday(event) {
  return event.eventTime >= state.startOfToday && event.eventTime < state.startOfTomorrow;
}

function formatDate(event, full = false) {
  const fields = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  if (full || !isToday(event)) Object.assign(fields, {
    ...(full ? { year: 'numeric' } : {}), month: '2-digit', day: '2-digit',
  });
  return new Intl.DateTimeFormat(document.documentElement.lang, fields).format(event.eventTime);
}

function updatePin(pressed) {
  const pin = app.querySelector('[data-action="pin"]');
  const key = view === 'panel'
    ? (pressed ? 'dockUnpinPanel' : 'dockPinPanel')
    : (pressed ? 'unpin' : 'pin');
  const label = t(key);
  pin.setAttribute('aria-pressed', String(pressed));
  pin.title = label;
  pin.setAttribute('aria-label', label);
}

function renderPanel() {
  const nav = app.querySelector('.tabs');
  nav.setAttribute('aria-label', t('dockEventViews'));
  for (const tab of nav.querySelectorAll('button')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.tab === activeTab));
  }
  search.setAttribute('aria-label', t('dockSearch'));
  byId('list-title').textContent = t({
    today: 'dockToday', all: 'dockAllEvents', archive: 'dockArchivedEvents',
  }[activeTab]);
  updatePin(state.pinned);

  const query = search.value.trim().toLocaleLowerCase(document.documentElement.lang);
  const items = state.events.filter(event => {
    const inTab = activeTab === 'archive' ? event.archived : !event.archived && (activeTab === 'all' || isToday(event));
    const searchable = [eventTitle(event), event.summary, ...event.tags].join(' ');
    return inTab && searchable.toLocaleLowerCase(document.documentElement.lang).includes(query);
  }).sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)));
  byId('count').textContent = items.length;
  const rows = byId('rows');
  const elements = items.map(sample => {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.dataset.selected = String(sample.id === state.selected);
    row.dataset.completed = String(Boolean(sample.completedAt));

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'event-row-open';
    open.dataset.event = sample.id;
    if (sample.id === state.selected) open.setAttribute('aria-current', 'true');
    open.append(
      textElement('time', 'event-row-time', formatDate(sample)),
      textElement('span', 'event-row-title', eventTitle(sample)),
    );
    if (sample.draft) open.title = t('dockDraft');
    const cue = document.createElement('span');
    cue.className = 'event-row-icon';
    cue.innerHTML = icon(sample.attachment ? 'clip' : 'document');
    open.append(cue);
    row.append(open);

    const actions = document.createElement('div');
    actions.className = 'event-row-actions';
    for (const [action, iconName, label] of [
      ['complete', 'check', sample.completedAt ? 'dockReopenEvent' : 'dockCompleteEvent'],
      ['archive', 'archive', sample.archived ? 'dockRestoreEvent' : 'dockArchiveEvent'],
    ]) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'icon-button';
      control.dataset.rowAction = action;
      control.dataset.eventId = sample.id;
      control.title = t(label);
      control.setAttribute('aria-label', control.title);
      if (action === 'complete') control.setAttribute('aria-pressed', String(Boolean(sample.completedAt)));
      control.innerHTML = icon(iconName);
      actions.append(control);
    }
    row.append(actions);
    return row;
  });
  const focused = document.activeElement?.dataset;
  const focusAction = focused?.rowAction;
  const focusId = focused?.eventId;
  rows.replaceChildren(...(elements.length ? elements : [textElement('p', 'empty', t('dockNoEvents'))]));
  if (focusId) [...rows.querySelectorAll('[data-row-action]')].find(button =>
    button.dataset.rowAction === focusAction && button.dataset.eventId === focusId
  )?.focus();
  requestAnimationFrame(resizePanel);
}

function resizePanel() {
  const rows = byId('rows');
  const height = Math.ceil(app.clientHeight - rows.parentElement.clientHeight + rows.offsetHeight);
  if (height !== lastHeight && height > 0) {
    lastHeight = height;
    api.dockAction('resize', height);
  }
}

function render() {
  if (!loaded || !state) return;
  document.title = t({ dock: 'dockName', panel: 'dockToday', detail: 'dockDetail' }[view]);
  if (view === 'dock') {
    const trigger = app.querySelector('.dock-trigger');
    trigger.setAttribute('aria-label', t('dockToday') + ' (' + state.todayCount + ')');
    trigger.style.setProperty('--resting-width', state.restingWidth + 'px');
    trigger.style.setProperty('--resting-height', state.restingHeight + 'px');
    trigger.style.setProperty('--resting-center', state.restingCenter + 'px');
    trigger.dataset.side = state.side;
    trigger.setAttribute('aria-expanded', String(state.expanded));
    byId('count').textContent = state.todayCount;
    const indicators = Array.from({ length: state.restingDots }, () =>
      textElement('span', 'dock-dot', '')
    );
    if (state.restingOverflow) indicators.push(textElement('span', 'dock-overflow', '+'));
    byId('dock-indicators').replaceChildren(...indicators);
  }
  if (view === 'panel') renderPanel();
  if (recordView) {
    updatePin(state.detailPinned);
    const summary = state.events.find(event => event.id === state.selected);
    void recordView.update(state.selected, state.editOnOpen, summary);
  }
}

const pointerSurface = view === 'dock' ? app.querySelector('.dock-trigger') : document.documentElement;
let suppressDockClick = false;
if (view === 'dock') {
  let drag;
  pointerSurface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || state?.dockLocked) return;
    suppressDockClick = false;
    drag = { id: event.pointerId, x: event.screenX, y: event.screenY, started: false };
    pointerSurface.setPointerCapture(event.pointerId);
  });
  pointerSurface.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) < 5) return;
      drag.started = true;
      suppressDockClick = true;
      api.dockAction('drag-start');
    }
    api.dockAction('drag-move');
  });
  function finishDrag(event) {
    if (drag?.id !== event.pointerId) return;
    if (drag.started) api.dockAction('drag-end');
    drag = undefined;
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pointerSurface.addEventListener(name, finishDrag);
  }
}
pointerSurface.addEventListener('pointerenter', () => api.dockPointer(true));
pointerSurface.addEventListener('pointerleave', () => api.dockPointer(false));
let lastActivity = -Infinity;
for (const name of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'input']) {
  document.addEventListener(name, () => {
    const now = performance.now();
    if (now - lastActivity < 200) return;
    lastActivity = now;
    api.dockAction('activity');
  }, { passive: true });
}

app.addEventListener('contextmenu', event => {
  if (view === 'detail' || event.target === search) return;
  event.preventDefault();
  api.dockAction('menu');
});
app.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  const { action, tab, event: id } = target.dataset;
  if (target.dataset.rowAction) {
    const status = byId('list-status');
    status.hidden = true;
    void api.manageEvent(target.dataset.eventId, target.dataset.rowAction).catch(() => {
      status.textContent = t('dockSaveFailed');
      status.hidden = false;
      resizePanel();
    });
    return;
  }
  if (action === 'toggle' && suppressDockClick && event.detail !== 0) return;
  if (action) api.dockAction(action);
  if (id) api.dockAction('open', id);
  if (tab && tab !== activeTab) {
    activeTab = tab;
    renderPanel();
  }
});

if (search) {
  search.addEventListener('input', renderPanel);
  api.onSearchStarted(tab => {
    search.hidden = false;
    if (tab === 'all') {
      activeTab = tab;
      renderPanel();
    }
    search.focus();
    resizePanel();
  });
  api.onSearchEnded(() => {
    search.hidden = true;
    search.value = '';
    renderPanel();
  });
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (search && !search.hidden) api.dockAction('end-search');
  else if (view === 'detail') api.dockAction('close');
});

let animation;
api.onDockAnimation(direction => {
  const opening = direction === 'in';
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0 : state?.animationDuration ?? 180;
  const previous = animation && getComputedStyle(app);
  const offset = view === 'detail' ? 'translateX(5px)' : 'translateX(0)';
  const from = {
    opacity: previous?.opacity ?? (opening ? 0 : 1),
    transform: previous?.transform ?? (opening ? offset : 'translateX(0)'),
  };
  const to = { opacity: opening ? 1 : 0, transform: opening ? 'translateX(0)' : offset };
  animation?.cancel();
  animation = app.animate([from, to], {
    duration,
    easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)',
    fill: 'both',
  });
});

api.onDockState(next => {
  receivedState = true;
  state = next;
  render();
});
document.addEventListener('languagechange', render);
const [initialState] = await Promise.all([api.getDockState(), languageReady]);
if (!receivedState) state = initialState;
loaded = true;
localize();
render();
