export const dateKey = (date, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export function zonedDate(year, month, day, hour, minute, zone) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let value = target;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
    const actual = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const delta = target - actual;
    value += delta;
    if (!delta) return new Date(value);
  }
  return null; // Nonexistent wall time at a spring DST transition.
}
export const clock = (date, zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));
// Times sooner than this after the host next sees a booking need the host to confirm them.
export const SHORT_NOTICE = 4 * 3600000;
export const longDate = (date, zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date));
// When the host next sees a booking made now: now during working hours, otherwise
// when their next working day starts. Minimum notice counts from here.
export function noticeFrom(settings, now = new Date()) {
  const [year, month, day] = dateKey(now, settings.timezone).split('-').map(Number);
  for (let i = 0; i < 8; i++) {
    const date = new Date(Date.UTC(year, month - 1, day + i));
    const hours = settings.weekly[(date.getUTCDay() + 6) % 7];
    if (!hours.enabled) continue;
    const at = time => zonedDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), ...time.split(':').map(Number), settings.timezone);
    const start = at(hours.start), end = at(hours.end);
    if (end && +now < +end) return start && +start > +now ? start : now;
  }
  return now;
}
export function demoSlots(settings, type, bookings, busy, ignored, now = new Date()) {
  const slots = [];
  const [year, month, day] = dateKey(now, settings.timezone).split('-').map(Number);
  const notice = +noticeFrom(settings, now), earliest = notice + settings.leadMinutes * 60000;
  const blocked = busy.filter(b => settings.calendars.includes(b.calendarId) && !ignored.includes(b.key) && b.blocking);
  for (let i = 0; i <= settings.horizonDays; i++) {
    const calendarDate = new Date(Date.UTC(year, month - 1, day + i));
    const weekday = (calendarDate.getUTCDay() + 6) % 7;
    const hours = settings.weekly[weekday];
    if (!hours.enabled) continue;
    const [sh, sm] = hours.start.split(':').map(Number), [eh, em] = hours.end.split(':').map(Number);
    // Same-day times open only once the host's day has started.
    if (i === 0 && +now < +zonedDate(year, month, day, sh, sm, settings.timezone)) continue;
    for (let minutes = sh * 60 + sm; minutes + type.duration <= eh * 60 + em; minutes += 15) {
      const start = zonedDate(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth() + 1, calendarDate.getUTCDate(), Math.floor(minutes / 60), minutes % 60, settings.timezone);
      const end = start && new Date(+start + type.duration * 60000);
      if (!start || +start < earliest || +start > +now + settings.horizonDays * 86400000) continue;
      const overlap = (a, b, c, d) => +a < +d && +b > +c;
      if (blocked.some(b => overlap(new Date(+start - settings.buffer * 60000), new Date(+end + settings.buffer * 60000), new Date(b.start), new Date(b.end)))) continue;
      if (bookings.some(b => b.status !== 'cancelled' && overlap(new Date(+start - settings.buffer * 60000), new Date(+end + settings.buffer * 60000), new Date(b.start), new Date(b.end)))) continue;
      slots.push({ start: start.toISOString(), end: end.toISOString(), shortNotice: +start < notice + SHORT_NOTICE });
    }
  }
  return slots;
}
