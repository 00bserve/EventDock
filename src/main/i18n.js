import { readdirSync, readFileSync } from 'node:fs';
import { app } from 'electron';
import { translate } from '../i18n.js';
import { getSettings, updateSettings } from './settings.js';

const localeDirectory = new URL('../locales/', import.meta.url);
const fallbackLocale = 'en';
const catalogs = new Map();

for (const file of readdirSync(localeDirectory).filter(name => name.endsWith('.json')).sort()) {
  try {
    const [locale] = Intl.getCanonicalLocales(file.slice(0, -5));
    const { name, messages } = JSON.parse(readFileSync(new URL(file, localeDirectory), 'utf8'));
    if (typeof name !== 'string' || !name.trim() || !messages ||
        typeof messages !== 'object' || Array.isArray(messages) ||
        Object.values(messages).some(message => typeof message !== 'string')) {
      throw new Error('Expected a language name and a map of translation strings');
    }
    catalogs.set(locale, { name, messages });
  } catch (error) {
    console.warn(`[i18n] Ignoring ${file}: ${error.message}`);
  }
}

function matchLocale(preference) {
  try {
    const requested = new Intl.Locale(preference);
    if (catalogs.has(requested.baseName)) return requested.baseName;

    const { language, script, region } = requested.maximize();
    const candidates = [...catalogs.keys()].filter(locale => {
      const supported = new Intl.Locale(locale).maximize();
      return supported.language === language && supported.script === script;
    });
    return candidates.find(locale => new Intl.Locale(locale).maximize().region === region)
      ?? candidates.find(locale => locale === language)
      ?? candidates[0];
  } catch {
    return undefined;
  }
}

let state;

export function getLanguageState() {
  if (state) return state;

  const saved = getSettings().language;
  const preference = catalogs.has(saved) ? saved : 'system';
  const locale = preference === 'system'
    ? app.getPreferredSystemLanguages().map(matchLocale).find(Boolean) ?? fallbackLocale
    : preference;
  state = {
    preference,
    locale,
    messages: {
      ...catalogs.get(fallbackLocale)?.messages,
      ...catalogs.get(locale)?.messages,
    },
  };
  return state;
}

export function getAvailableLanguages() {
  return [...catalogs].map(([locale, { name }]) => ({ locale, name }));
}

export function setLanguage(preference) {
  if (preference !== 'system' && !catalogs.has(preference)) return false;
  if (getLanguageState().preference === preference) return false;

  updateSettings({ language: preference });
  state = undefined;
  return true;
}

export function t(key, values) {
  return translate(getLanguageState().messages, key, values);
}
