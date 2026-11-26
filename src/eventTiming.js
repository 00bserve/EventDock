const reminderWindow = 30 * 60_000;

export function reminderStatus(event, now) {
  if (event.completedAt || event.archived) return 'normal';
  const remaining = event.eventTime - now;
  if (remaining <= 0) return 'late';
  return remaining <= reminderWindow ? 'soon' : 'normal';
}

const reminderInterval = 5 * 60_000;
const maximumReminders = 3;

export function advanceOverdueReminders(events, previous, now) {
  const reminders = {};
  let shake = false;
  for (const event of events) {
    if (reminderStatus(event, now) !== 'late') continue;

    const saved = previous[event.id];
    const entry = saved?.eventTime === event.eventTime ? saved : null;
    const last = entry?.last ?? event.eventTime;
    const count = entry?.count ?? 0;
    if (count < maximumReminders && now - last >= reminderInterval) {
      reminders[event.id] = { eventTime: event.eventTime, last: now, count: count + 1 };
      shake = true;
    } else if (entry) {
      reminders[event.id] = entry;
    }
  }
  return { reminders, shake };
}
