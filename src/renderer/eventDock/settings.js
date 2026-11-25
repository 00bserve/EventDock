import { languageReady, t } from '../shared/i18n.js';

const preferences = document.getElementById('preferences');
const lock = document.getElementById('lock-position');
const side = document.getElementById('side');
const language = document.getElementById('language');
const status = document.getElementById('status');
let saving = false;
let current;

function render(next) {
  current = next;
  lock.checked = next.dockLocked;
  side.value = next.side;
  language.replaceChildren(
    new Option(t('system'), 'system'),
    ...next.languages.map(item => new Option(item.name, item.locale)),
  );
  language.value = next.language;
  document.title = t('dockSettings');
}

async function update(action, value) {
  if (saving) return;
  saving = true;
  preferences.disabled = true;
  status.textContent = '';
  try {
    const next = await window.api.dockSettings(action, value);
    if (!next) throw new Error('Missing settings');
    render(next);
  } catch {
    if (current) render(current);
    status.textContent = t('dockSettingsError');
  } finally {
    saving = false;
    preferences.disabled = !current;
  }
}

lock.addEventListener('change', () => void update('lock', lock.checked));
side.addEventListener('change', () => void update('side', side.value));
language.addEventListener('change', () => void update('language', language.value));
await languageReady;
document.addEventListener('languagechange', () => {
  document.title = t('dockSettings');
  void update();
});
await update();
