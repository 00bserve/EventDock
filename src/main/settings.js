import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const appData = app.getPath('appData');
const file = join(appData, 'EventDock', 'settings.json');

function readSettings(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function getSettings() {
  const current = readSettings(file);
  if (current) return current;

  // Import only the language preference from the original combined workspace.
  let language;
  try {
    const previous = join(appData, 'FelipeGazapina', 'sticky-notes-data', 'config.json');
    language = readSettings(previous)?.settings?.language;
  } catch (error) {
    console.warn('[EventDock] Could not import the prior language setting:', error.message);
  }
  const settings = typeof language === 'string' ? { language } : {};
  saveSettings(settings);
  return settings;
}

function saveSettings(settings) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { flush: true });
  renameSync(temporary, file);
}

export function updateSettings(patch) {
  saveSettings({ ...getSettings(), ...patch });
}
