export function translate(messages, key, values = {}) {
  const message = Object.hasOwn(messages, key) ? messages[key] : key;
  return message.replace(/\{(\w+)\}/g, (token, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : token
  );
}
