import { app, dialog, protocol } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openEventDock } from './src/main/eventDock.js';

protocol.registerSchemesAsPrivileged([{
  scheme: 'eventdock-attachment',
  privileges: { standard: true, secure: true },
}]);

const profile = join(app.getPath('appData'), 'EventDock', 'profile');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setAppUserModelId('com.eventdock.desktop');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    try {
      await openEventDock(app);
    } catch (error) {
      console.error('[EventDock] Startup failed:', error);
      dialog.showErrorBox('EventDock', error.message);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
}
