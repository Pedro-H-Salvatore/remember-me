// @ts-check
/** @param {string} date @param {number} days */
export function addDays(date, days) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
/** Convert civil time. First occurrence for ambiguity; reject nonexistent time.
 * @param {string} date @param {string} time @param {string} zone */
export function zonedTime(date, time, zone) {
  const target = Date.parse(`${date}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let guess = target;
  for (let i = 0; i < 5; i++) {
    const civil = Date.parse(fmt.format(guess).replace(' ', 'T') + 'Z');
    const next = guess + target - civil;
    if (next === guess) break;
    guess = next;
  }
  if (fmt.format(guess).slice(0, 16) !== `${date} ${time}`)
    throw new Error('Horário inexistente neste fuso. Escolha outro horário.');
  // Prefer the first occurrence at the fall-back boundary.
  for (const delta of [7200000, 3600000, 1800000])
    if (fmt.format(guess - delta).slice(0, 16) === `${date} ${time}`) guess -= delta;
  return guess;
}
/** @param {import('./contracts.js').DatedItem} item @param {import('./contracts.js').Settings} settings @param {number} now @returns {import('./contracts.js').ReminderTime[]} */
export function reminderTimes(item, settings, now = Date.now()) {
  if (!item.date || item.archived || item.done) return [];
  const date = item.date;
  return [7, 1, 0]
    .map((days) => ({
      days,
      at: zonedTime(addDays(date, -days), item.time || settings.reminderTime, settings.timezone),
    }))
    .filter((r) => r.at > now);
}
export function today(zone = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(new Date());
}
