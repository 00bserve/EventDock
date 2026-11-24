import { translate } from '../../i18n.js';

let messages = {};
let receivedChange = false;

export function t(key, values) {
  return translate(messages, key, values);
}

export function localize(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle);
    if (element.matches('button')) element.setAttribute('aria-label', element.title);
  }
  for (const element of root.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
}

function applyLanguage(state) {
  messages = state.messages;
  document.documentElement.lang = state.locale;
  const locale = new Intl.Locale(state.locale);
  document.documentElement.dir = (locale.getTextInfo?.() ?? locale.textInfo)?.direction ?? 'ltr';
  localize();
  document.dispatchEvent(new Event('languagechange'));
}

window.api.onLanguageChanged(state => {
  receivedChange = true;
  applyLanguage(state);
});

export const languageReady = window.api.getLanguage().then(state => {
  if (!receivedChange) applyLanguage(state);
});
