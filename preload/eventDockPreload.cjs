const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  ipcRenderer.on(channel, (_event, value) => callback(value));
}

contextBridge.exposeInMainWorld('api', {
  getLanguage: () => ipcRenderer.invoke('i18n:get'),
  onLanguageChanged: callback => subscribe('i18n:changed', callback),
  dockSettings: (action, value) => ipcRenderer.invoke('event-dock:settings', action, value),
  getDockState: () => ipcRenderer.invoke('event-dock:get'),
  onDockState: callback => subscribe('event-dock:state', callback),
  onOverdueShake: callback => subscribe('event-dock:overdue-shake', callback),
  onDockAnimation: callback => subscribe('event-dock:animate', callback),
  onSearchStarted: callback => subscribe('event-dock:search-started', callback),
  onSearchEnded: callback => subscribe('event-dock:search-ended', callback),
  getImagePreview: () => ipcRenderer.invoke('event-dock:preview'),
  getEditorUrl: () => ipcRenderer.invoke('event-dock:editor-url'),
  getEventRecord: id => ipcRenderer.invoke('event-dock:record', id),
  stageEvent: (id, revision, value) => ipcRenderer.send('event-dock:stage', id, revision, value),
  onEventMoved: callback => subscribe('event-dock:event-moved', callback),
  onEventSaved: callback => subscribe('event-dock:save-result', callback),
  eventAttachment: (id, action, value) => ipcRenderer.invoke('event-dock:attachment', id, action, value),
  manageEvent: (id, action) => ipcRenderer.invoke('event-dock:manage', id, action),
  dockAction: (action, value) => ipcRenderer.send('event-dock:action', action, value),
});
