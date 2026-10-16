import { dateKey, clock, longDate, zonedDate, demoSlots } from './time.mjs';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const cfg = window.MEET_CONFIG || { demo: true, apiBase: '' };
const apiBase = cfg.apiBase.replace(/\/$/, '');
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// A shared link such as /meet/90min only offers that meeting length.
const fixedDuration = Number(location.pathname.match(/\/(\d+)min(?:\.html)?\/?$/)?.[1]) || null;
const defaults = () => ({ name: 'Jan Bauer', timezone: 'Europe/London', buffer: 15, leadHours: 4, horizonDays: 60, reminders: [24, 1], calendars: ['primary', 'personal'], bookingCalendar: 'primary', weekly: days.map((_, i) => ({ enabled: i < 5, start: '09:00', end: '17:00' })), types: [15, 30, 60, 90].map(d => ({ id: `meet${d}`, duration: d, title: ({ 15: 'Quick chat', 30: 'Meeting', 60: 'Long meeting', 90: 'Extended meeting' })[d], description: '', active: true })) });
let saved;
try { saved = JSON.parse(localStorage.getItem('jan-meet-demo-v1') || 'null'); } catch { /* Storage is optional. */ }
const state = { settings: cfg.demo && saved?.settings || defaults(), bookings: cfg.demo && saved?.bookings || [], ignored: cfg.demo && saved?.ignored || [], zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', month: null, selectedDay: null, selectedSlot: null, type: fixedDuration ? `meet${fixedDuration}` : 'meet30', slots: [], loading: true, step: 1, guest: { name: '', email: '', note: '' }, adminTab: 'types', admin: false, adminCalendars: [], adminEvents: [], requestNumber: 0, submitted: null, connected: false, mailReady: false, error: '' };
const persist = () => { if (cfg.demo) { try { localStorage.setItem('jan-meet-demo-v1', JSON.stringify({ settings: state.settings, bookings: state.bookings, ignored: state.ignored })); } catch { /* Allow private browsing. */ } } };
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
async function api(path, options = {}) {
  const response = await fetch(apiBase + path, { ...options, credentials: 'include', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data; try { data = await response.json(); } catch { throw new Error('The booking service could not be reached. Please try again.'); }
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
const currentType = () => fixedDuration ? state.settings.types.find(t => t.duration === fixedDuration && t.active) : state.settings.types.find(t => t.id === state.type && t.active) || state.settings.types.find(t => t.active);
const paths = { clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', video: '<rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="m15.5 10.5 5-3v9l-5-3"/>', calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3z"/>', back: '<path d="m14.5 6-6 6 6 6"/>', next: '<path d="m9.5 6 6 6-6 6"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>' };
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const zoneName = zone => zone.replaceAll('_', ' ');
const offsets = new Map();
function zoneOffset(zone) {
  if (!offsets.has(zone)) { try { offsets.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value); } catch { offsets.set(zone, ''); } }
  return offsets.get(zone);
}
function zoneOptions(zone) {
  const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney'];
  return [...new Set([zone, 'UTC', ...list])].map(z => `<option value="${esc(z)}"${z === zone ? ' selected' : ''}>${esc(zoneName(z))} (${esc(zoneOffset(z))})</option>`).join('');
}
function sampleEvents() {
  const [y, m, d] = dateKey(new Date(), state.settings.timezone).split('-').map(Number);
  const result = [];
  for (let i = 1; i <= 45; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    if ([0, 6].includes(dt.getUTCDay())) continue;
    const start = zonedDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), 12, 0, state.settings.timezone);
    result.push({ key: `personal|lunch-${dateKey(start, state.settings.timezone)}`, calendarId: 'personal', title: 'Lunch & a walk', start: start.toISOString(), end: new Date(+start + 3600000).toISOString(), blocking: true });
    if (dt.getUTCDay() === 2) {
      const s = zonedDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), 10, 0, state.settings.timezone);
      result.push({ key: `primary|focus-${dateKey(s, state.settings.timezone)}`, calendarId: 'primary', title: 'Focus time', start: s.toISOString(), end: new Date(+s + 5400000).toISOString(), blocking: true });
    }
  }
  return result;
}
const slotDay = slot => dateKey(new Date(slot.start), state.zone);
function pickDay() {
  const available = [...new Set(state.slots.map(slotDay))];
  if (!available.includes(state.selectedDay)) state.selectedDay = available[0] || null;
  state.month = (state.selectedDay || dateKey(new Date(), state.zone)).slice(0, 7);
}
function render() {
  renderInfo();
  if (state.step === 3) return renderSuccess();
  if (state.step === 2) return renderForm();
  renderPicker();
}
function renderInfo() {
  const type = currentType();
  const slot = state.step > 1 && (state.submitted || state.selectedSlot);
  const active = state.settings.types.filter(t => t.active);
  $('#info').innerHTML = `<p class="host">${esc(state.settings.name)}</p><h1 class="title">${esc(type ? type.title : 'Book a meeting')}</h1>${type ? `<ul class="facts"><li>${icon('clock')}<span>${type.duration} min</span></li><li>${icon('video')}<span>Google Meet</span></li>${slot ? `<li>${icon('calendar')}<span>${esc(clock(slot.start, state.zone))} – ${esc(clock(slot.end, state.zone))}<br>${esc(longDate(slot.start, state.zone))}</span></li><li>${icon('globe')}<span>${esc(zoneName(state.zone))}</span></li>` : ''}</ul>` : ''}${type?.description ? `<p class="description">${esc(type.description)}</p>` : ''}${state.step === 1 && !fixedDuration && active.length > 1 ? `<div class="durations" role="group" aria-label="Meeting length">${active.map(t => `<button type="button" data-duration="${esc(t.id)}" aria-pressed="${t.id === type?.id}">${t.duration} min</button>`).join('')}</div>` : ''}`;
  document.querySelectorAll('[data-duration]').forEach(b => b.onclick = () => { if (b.dataset.duration === state.type) return; state.type = b.dataset.duration; state.slots = []; state.selectedSlot = null; loadSlots(); });
}
async function loadSlots() {
  const request = ++state.requestNumber;
  const type = currentType();
  state.loading = true; render();
  try {
    const slots = !type ? [] : cfg.demo ? demoSlots(state.settings, type, state.bookings, sampleEvents(), state.ignored) : (await api(`/api/slots?type=${encodeURIComponent(type.id)}`)).slots;
    if (request !== state.requestNumber) return;
    state.slots = slots; state.error = '';
    pickDay();
  } catch (e) { if (request !== state.requestNumber) return; state.error = e.message; state.slots = []; }
  state.loading = false; render();
}
function renderPicker() {
  const content = $('#booking-content');
  if (!currentType()) { content.innerHTML = `<h2 class="step-title">This booking link isn’t active right now.</h2><p class="muted">Please check with Jan for a current link.</p>`; return; }
  const today = dateKey(new Date(), state.zone);
  state.month ||= today.slice(0, 7);
  const [year, month] = state.month.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = new Set(state.slots.map(slotDay));
  const preferred = new Set(state.slots.filter(s => !s.lessPreferred).map(slotDay));
  const daySlots = state.slots.filter(s => slotDay(s) === state.selectedDay);
  const lastMonth = dateKey(new Date(Date.now() + state.settings.horizonDays * 86400000), state.zone).slice(0, 7);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const dayName = day => new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));
  // Two starts share a label only during an autumn clock change; the offset tells them apart.
  const counts = new Map();
  for (const slot of daySlots) { const label = clock(slot.start, state.zone); counts.set(label, (counts.get(label) || 0) + 1); }
  const slotLabel = slot => { const label = clock(slot.start, state.zone); return counts.get(label) === 1 ? label : `${label} (${new Intl.DateTimeFormat('en-US', { timeZone: state.zone, timeZoneName: 'shortOffset' }).formatToParts(new Date(slot.start)).find(p => p.type === 'timeZoneName').value})`; };
  let times;
  if (state.loading) times = '<p class="muted">Loading available times…</p>';
  else if (state.error) times = `<p class="error" role="alert">${esc(state.error)}</p><button class="secondary-button" id="retry-slots" type="button">Try again</button>`;
  else if (!state.slots.length) times = `<p class="muted">No times are available in the next ${state.settings.horizonDays} days.</p>`;
  else if (!daySlots.length) times = `<p class="muted">No available times in ${esc(monthName.split(' ')[0])}.</p>`;
  else times = `<h3 class="times-title">${esc(dayName(state.selectedDay))}</h3>${daySlots.some(s => s.lessPreferred) ? '<p class="hint">Gray times are less convenient, but you can still book them.</p>' : ''}<div class="time-list">${daySlots.map(s => `<button class="time${s.lessPreferred ? ' less' : ''}" type="button" data-slot="${esc(s.start)}"${s.lessPreferred ? ` aria-label="${esc(slotLabel(s))}, less convenient" title="Less convenient"` : ''}>${esc(slotLabel(s))}</button>`).join('')}</div>`;
  content.innerHTML = `<h2 class="step-title">Select a date and time</h2><div class="picker"><div class="month"><div class="month-head"><h3 aria-live="polite">${esc(monthName)}</h3><div class="month-nav"><button class="icon-button" id="prev-month" type="button" aria-label="Previous month" ${state.month <= today.slice(0, 7) ? 'disabled' : ''}>${icon('back')}</button><button class="icon-button" id="next-month" type="button" aria-label="Next month" ${state.month >= lastMonth ? 'disabled' : ''}>${icon('next')}</button></div></div><div class="weekdays" aria-hidden="true">${days.map(d => `<span>${d.slice(0, 3)}</span>`).join('')}</div><div class="days">${'<span></span>'.repeat(lead)}${Array.from({ length: dayCount }, (_, i) => {
    const day = `${state.month}-${String(i + 1).padStart(2, '0')}`;
    const open = !state.loading && dates.has(day);
    return `<button class="day${open && !preferred.has(day) ? ' less' : ''}${day === today ? ' today' : ''}" type="button" data-day="${day}" ${open ? '' : 'disabled'} aria-pressed="${open && day === state.selectedDay}" aria-label="${esc(dayName(day))}${open ? (preferred.has(day) ? '' : ', less convenient') : ', unavailable'}">${i + 1}</button>`;
  }).join('')}</div><label class="zone">${icon('globe')}<span class="sr-only">Time zone</span><select id="visitor-timezone">${zoneOptions(state.zone)}</select></label></div><div class="times"><div class="times-inner">${times}</div></div></div>`;
  $('#prev-month').onclick = () => changeMonth(-1); $('#next-month').onclick = () => changeMonth(1);
  if ($('#retry-slots')) $('#retry-slots').onclick = loadSlots;
  document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { state.selectedDay = b.dataset.day; render(); });
  document.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => { state.selectedSlot = state.slots.find(s => s.start === b.dataset.slot); state.step = 2; state.error = ''; render(); if ($('#booking-content').getBoundingClientRect().top < 0) $('#booking-content').scrollIntoView(); if (matchMedia('(pointer: fine)').matches) $('#guest-name').focus({ preventScroll: true }); });
  $('#visitor-timezone').onchange = e => { state.zone = e.target.value; state.selectedDay = null; pickDay(); render(); };
}
function changeMonth(delta) {
  const [y, m] = state.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  state.month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  state.selectedDay = [...new Set(state.slots.map(slotDay))].find(day => day.startsWith(state.month)) || null;
  render();
}
function renderForm() {
  const g = state.guest;
  $('#booking-content').innerHTML = `<div class="step-head"><button class="icon-button" id="change-time" type="button" aria-label="Back to times">${icon('back')}</button><h2 class="step-title">Enter your details</h2></div><form class="form" id="guest-form"><div class="form-field"><label for="guest-name">Name</label><input id="guest-name" name="name" autocomplete="name" maxlength="100" required value="${esc(g.name)}"></div><div class="form-field"><label for="guest-email">Email</label><input id="guest-email" name="email" type="email" autocomplete="email" maxlength="254" required value="${esc(g.email)}"></div><div class="form-field"><label for="guest-note">Notes <span class="muted">(optional)</span></label><textarea id="guest-note" name="note" maxlength="2000" rows="4">${esc(g.note)}</textarea></div><div class="honeypot" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p id="form-error" class="error" role="alert"></p><div class="form-actions"><button class="primary-button" id="confirm-booking" type="submit">${cfg.demo ? 'Try a sample booking' : 'Schedule meeting'}</button></div><p class="fine">${cfg.demo ? 'Preview only: the sample stays in this browser. No invitation or email is sent.' : `You’ll get a Google Calendar invitation with the Meet link${state.settings.reminders.length ? ' and an email reminder' : ''}. Your details are only used to arrange this meeting.`}</p></form>`;
  $('#change-time').onclick = () => { state.step = 1; state.selectedSlot = null; render(); };
  const form = $('#guest-form');
  form.oninput = () => { const f = new FormData(form); state.guest = { name: String(f.get('name')), email: String(f.get('email')), note: String(f.get('note')) }; };
  form.onsubmit = async e => {
    e.preventDefault(); const button = $('#confirm-booking'); const label = button.textContent; button.disabled = true; button.textContent = 'Booking…'; $('#form-error').textContent = '';
    const f = new FormData(form); const payload = { name: String(f.get('name')).trim(), email: String(f.get('email')).trim(), note: String(f.get('note')).trim(), website: f.get('website'), type: currentType().id, start: state.selectedSlot.start, timezone: state.zone };
    // Retrying the same request reuses its key; edited details are a new request.
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== state.lastAttempt?.fingerprint) state.lastAttempt = { fingerprint, key: uid() };
    payload.idempotencyKey = state.lastAttempt.key;
    try {
      if (cfg.demo) { const b = { id: payload.idempotencyKey, ...payload, ...state.selectedSlot, title: currentType().title, duration: currentType().duration, status: 'confirmed', demo: true }; state.bookings.push(b); persist(); state.submitted = b; }
      else state.submitted = await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
      state.step = 3; state.lastAttempt = null; render();
    } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; button.textContent = label; }
  };
}
function icsText(booking) {
  const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
  const text = s => String(s || '').replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jan Bauer//Meet//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${booking.id}@janbauer.cc`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(booking.start)}`, `DTEND:${stamp(booking.end)}`, `SUMMARY:${text(`${cfg.demo ? '[Preview] ' : ''}${booking.title} with Jan Bauer`)}`, `DESCRIPTION:${text(cfg.demo ? 'Sample only. This is not a real appointment.' : 'Your meeting with Jan Bauer.')}`, `LOCATION:${text(booking.meetLink || 'See your Google Calendar invitation')}`, 'END:VEVENT', 'END:VCALENDAR'];
  return lines.join('\r\n') + '\r\n';
}
function renderSuccess() {
  const b = state.submitted;
  $('#booking-content').innerHTML = `<div class="done"><div class="done-icon">${icon('check')}</div><h2 class="step-title">${cfg.demo ? 'Sample booking saved' : 'You’re booked'}</h2><p class="muted">${cfg.demo ? 'In the live version you’d now get a Google Calendar invitation with a unique Meet link. Nothing was sent.' : `A calendar invitation is on its way to <strong>${esc(b.email)}</strong>, and a Google Meet link has been added to it.`}</p><div class="actions">${b.meetLink ? `<a class="primary-button" target="_blank" rel="noopener" href="${esc(b.meetLink)}">Open Google Meet</a>` : ''}<button class="secondary-button" id="download-ics" type="button">Add to calendar (.ics)</button></div><p class="fine">${b.cancelUrl ? `<a href="${esc(b.cancelUrl)}">Cancel or reschedule</a> · ` : ''}<button class="link-button" id="book-again" type="button">Book another meeting</button></p></div>`;
  $('#download-ics').onclick = () => { const url = URL.createObjectURL(new Blob([icsText(b)], { type: 'text/calendar;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'meet-jan-bauer.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  $('#book-again').onclick = () => { state.submitted = null; state.selectedSlot = null; state.step = 1; loadSlots(); };
}
async function openAdmin() {
  if (!$('#admin-dialog').open) $('#admin-dialog').showModal();
  if (cfg.demo) { state.admin = true; state.adminCalendars = [{ id: 'primary', summary: 'Jan Bauer', backgroundColor: '#718d5c', accessRole: 'owner' }, { id: 'personal', summary: 'Personal', backgroundColor: '#c3ad74', accessRole: 'owner' }, { id: 'birthdays', summary: 'Birthdays & holidays', backgroundColor: '#a4afb9', accessRole: 'reader' }]; state.adminEvents = sampleEvents(); renderAdmin(); return; }
  try { const data = await api('/api/admin'); Object.assign(state, { admin: true, settings: data.settings, connected: data.connected, mailReady: data.mailReady, adminCalendars: data.calendars, bookings: data.bookings, ignored: data.ignored }); renderAdmin(); }
  catch { state.admin = false; renderAdminLogin(); }
}
const adminHeader = () => `<div class="admin-header"><div><h2 id="admin-title">Booking settings</h2><p>${cfg.demo ? 'Preview · changes are saved only in this browser' : 'Signed in as the calendar owner'}</p></div><button class="icon-button" id="admin-close" type="button" aria-label="Close admin">${icon('close')}</button></div>`;
function renderAdminLogin() {
  $('#admin-content').innerHTML = `${adminHeader()}<div class="admin-body"><div class="login-box"><h3>Sign in to manage your booking page</h3><p class="admin-copy">Meeting types, availability and calendar rules. Only the configured admin account can sign in.</p><a href="${esc(apiBase)}/api/auth/google" class="primary-button">Sign in with Google</a></div></div>`; $('#admin-close').onclick = () => $('#admin-dialog').close();
}
function renderAdmin() {
  $('#admin-content').innerHTML = `${adminHeader()}<div class="admin-tabs" role="tablist" aria-label="Admin sections">${[['types', 'Meeting types'], ['availability', 'Availability'], ['calendars', 'Calendar rules'], ['bookings', 'Bookings']].map(([id, label]) => `<button class="admin-tab${id === state.adminTab ? ' active' : ''}" data-tab="${id}" type="button" role="tab" aria-selected="${id === state.adminTab}">${label}</button>`).join('')}</div><div class="admin-body" id="admin-body"></div>`;
  $('#admin-close').onclick = () => $('#admin-dialog').close();
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.adminTab = b.dataset.tab; renderAdmin(); });
  ({ types: renderTypes, availability: renderAvailability, calendars: renderCalendars, bookings: renderBookings })[state.adminTab]();
}
function savebar() { return `<div class="admin-savebar"><p>${cfg.demo ? 'Preview settings stay in this browser.' : 'Changes apply to new bookings immediately.'}</p><button class="primary-button" type="submit">Save changes</button></div>`; }
async function saveSettings(next, button) {
  if (button) button.disabled = true;
  try {
    if (!next.types.some(t => t.active)) throw new Error('Keep at least one meeting type available.');
    if (cfg.demo) { state.settings = next; persist(); }
    else { const data = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(next) }); state.settings = data.settings; }
    if (!fixedDuration && !state.settings.types.some(t => t.id === state.type && t.active)) state.type = state.settings.types.find(t => t.active).id;
    state.selectedSlot = null; state.submitted = null; state.step = 1; await loadSlots(); toast('Your changes are saved.');
  } catch (e) { toast(e.message); } finally { if (button) button.disabled = false; }
}
// The page's own folder, e.g. https://janbauer.cc/meet/, also from /meet/90min.
const shareLink = t => new URL(`${t.duration}min`, new URL('.', location.href)).href;
function renderTypes() {
  $('#admin-body').innerHTML = `<div class="admin-section-head"><div><h3>Meeting types</h3><p>The main page offers every available length. Each length also has its own link that offers only that length.</p></div></div><form id="types-form"><div class="type-cards">${state.settings.types.map((t, i) => `<div class="type-card"><div class="type-card-top"><span class="type-duration">${t.duration} min</span><label class="switch"><input type="checkbox" name="active${i}" ${t.active ? 'checked' : ''} aria-label="Enable ${t.duration}-minute meeting"><span>Available</span></label></div><div class="share-link"><input readonly value="${esc(shareLink(t))}" aria-label="Link for ${t.duration}-minute meetings"><button class="secondary-button" type="button" data-copy="${esc(shareLink(t))}">Copy link</button></div><div class="form-grid"><div class="form-field"><label for="type-title${i}">Meeting name</label><input name="title${i}" id="type-title${i}" value="${esc(t.title)}" required maxlength="80"></div><div class="form-field"><label for="type-description${i}">Note shown to guests</label><textarea name="description${i}" id="type-description${i}" maxlength="300" rows="1">${esc(t.description)}</textarea></div></div></div>`).join('')}</div>${savebar()}</form>`;
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied.'); } catch { b.previousElementSibling.select(); } });
  $('#types-form').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target), next = structuredClone(state.settings); next.types.forEach((t, i) => { t.title = String(f.get(`title${i}`)).trim(); t.description = String(f.get(`description${i}`)).trim(); t.active = f.has(`active${i}`); }); saveSettings(next, e.submitter); };
}
function renderAvailability() {
  const s = state.settings;
  $('#admin-body').innerHTML = `<div class="admin-section-head"><div><h3>Availability</h3><p>Working hours follow your time zone. Guests see their own local time.</p></div></div><form id="availability-form"><div class="admin-two-col"><div class="admin-card"><h3>Weekly hours</h3><div class="form-field"><label for="host-timezone">Your time zone</label><select name="timezone" id="host-timezone">${zoneOptions(s.timezone)}</select></div>${s.weekly.map((w, i) => `<div class="week-row"><label class="switch"><input type="checkbox" name="enabled${i}" ${w.enabled ? 'checked' : ''} aria-label="Available on ${days[i]}"><span>${days[i].slice(0, 3)}</span></label><input type="time" name="start${i}" value="${w.start}" required aria-label="${days[i]} start time"><span>–</span><input type="time" name="end${i}" value="${w.end}" required aria-label="${days[i]} end time"></div>`).join('')}</div><div><div class="admin-card"><h3>Buffers and notice</h3><div class="form-grid"><div class="form-field"><label for="buffer">Buffer, each side (min)</label><input type="number" id="buffer" name="buffer" min="0" max="120" value="${s.buffer}" required></div><div class="form-field"><label for="lead">Minimum notice (hours)</label><input type="number" id="lead" name="leadHours" min="0" max="168" value="${s.leadHours}" required></div></div><div class="form-field"><label for="horizon">Booking window (days ahead)</label><input type="number" name="horizonDays" id="horizon" min="1" max="90" value="${s.horizonDays}" required></div><p class="admin-copy">Same-day times only open once your day has started, then minimum notice applies.</p></div><div class="admin-card"><h3>Email reminders</h3><label class="reminder-setting"><span>24 hours before</span><input type="checkbox" name="reminder24" ${s.reminders.includes(24) ? 'checked' : ''} aria-label="24-hour email reminder"></label><label class="reminder-setting"><span>1 hour before</span><input type="checkbox" name="reminder1" ${s.reminders.includes(1) ? 'checked' : ''} aria-label="1-hour email reminder"></label><p class="admin-copy">${cfg.demo ? 'The live backend sends these emails automatically.' : state.mailReady ? 'Email delivery is configured.' : 'Email delivery needs SMTP configuration before reminders can be enabled.'}</p></div></div></div>${savebar()}</form>`;
  $('#availability-form').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target), next = structuredClone(s); next.timezone = f.get('timezone'); ['buffer', 'leadHours', 'horizonDays'].forEach(k => next[k] = +f.get(k)); next.weekly = days.map((_, i) => ({ enabled: f.has(`enabled${i}`), start: f.get(`start${i}`), end: f.get(`end${i}`) })); next.reminders = [24, 1].filter(v => f.has(`reminder${v}`)); if (next.weekly.some(w => w.enabled && w.start >= w.end)) return toast('Each working day needs an end time after its start.'); saveSettings(next, e.submitter); };
}
function renderCalendars() {
  $('#admin-body').innerHTML = `<div class="admin-section-head"><div><h3>Calendar rules</h3><p>Block time from whole calendars, or ignore individual events.</p></div></div>${cfg.demo ? '<div class="admin-notice">These are sample calendars and events. Your real calendar is connected after Google sign-in on the live backend.</div>' : ''}<div class="admin-card"><h3>Calendars to check</h3><div id="calendar-rules">${state.adminCalendars.map(c => `<div class="calendar-rule"><div><strong><span class="calendar-color" style="background:${/^#[0-9a-f]{6}$/i.test(c.backgroundColor) ? c.backgroundColor : '#82946d'}"></span>${esc(c.summary)}</strong><p>${c.id === state.settings.bookingCalendar ? 'Booking destination · confirmed meetings always reserve their time' : 'Busy events on this calendar can block new bookings'}</p></div><label class="switch"><input type="checkbox" data-calendar="${esc(c.id)}" ${state.settings.calendars.includes(c.id) ? 'checked' : ''} aria-label="Use ${esc(c.summary)} for conflicts"><span>Check conflicts</span></label></div>`).join('')}</div><div class="form-field" style="margin-top:20px"><label for="booking-calendar">Add new bookings to</label><select id="booking-calendar">${state.adminCalendars.filter(c => ['owner', 'writer'].includes(c.accessRole)).map(c => `<option value="${esc(c.id)}"${c.id === state.settings.bookingCalendar ? ' selected' : ''}>${esc(c.summary)}</option>`).join('')}</select><p class="admin-copy">Google Meet must be supported by the selected calendar.</p></div></div><div class="admin-card"><h3>Individual events</h3><p class="admin-copy">Switch on “Ignore” to allow bookings over that event. This leaves the original event in Google Calendar unchanged.</p><div class="event-filter"><div class="form-field"><label for="event-from">From</label><input id="event-from" type="date" value="${dateKey(new Date(), state.settings.timezone)}"></div><div class="form-field"><label for="event-to">Until</label><input id="event-to" type="date" value="${dateKey(new Date(Date.now() + 7 * 86400000), state.settings.timezone)}"></div><button class="secondary-button" id="load-events" type="button">Find events</button></div><div id="event-list" class="event-list"><p class="admin-copy">Find events to choose which ones to ignore.</p></div></div><div class="admin-savebar"><p>Calendar selections take effect when saved.</p><button id="save-calendars" class="primary-button" type="button">Save calendar rules</button></div>`;
  $('#save-calendars').onclick = async e => { const next = structuredClone(state.settings); next.calendars = [...document.querySelectorAll('[data-calendar]:checked')].map(b => b.dataset.calendar); next.bookingCalendar = $('#booking-calendar').value; await saveSettings(next, e.currentTarget); };
  $('#load-events').onclick = async () => {
    const from = $('#event-from').value, to = $('#event-to').value; if (to < from) return toast('Choose an end date after the start date.');
    const button = $('#load-events'); button.disabled = true;
    try { if (!cfg.demo) state.adminEvents = (await api(`/api/admin/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).events; renderEventList(from, to); }
    catch (e) { toast(e.message); } finally { button.disabled = false; }
  };
}
function renderEventList(from, to) {
  const events = state.adminEvents.filter(e => dateKey(new Date(e.start), state.settings.timezone) >= from && dateKey(new Date(e.start), state.settings.timezone) <= to);
  $('#event-list').innerHTML = events.map(e => `<div class="event-row"><div><strong>${esc(e.title)}</strong><p>${esc(longDate(e.start, state.settings.timezone))} · ${esc(clock(e.start, state.settings.timezone))}${e.blocking ? '' : ' · already marked free'}</p></div><label class="switch"><span>Ignore</span><input data-event-key="${esc(e.key)}" type="checkbox" ${state.ignored.includes(e.key) ? 'checked' : ''} ${e.booking ? 'disabled' : ''} aria-label="Ignore ${esc(e.title)}"></label></div>`).join('') || '<p class="admin-copy">No events in this range.</p>';
  document.querySelectorAll('[data-event-key]').forEach(b => b.onchange = async () => {
    const checked = b.checked; b.disabled = true;
    try {
      if (!cfg.demo) await api('/api/admin/ignore', { method: 'PUT', body: JSON.stringify({ key: b.dataset.eventKey, ignore: checked }) });
      state.ignored = state.ignored.filter(k => k !== b.dataset.eventKey); if (checked) state.ignored.push(b.dataset.eventKey); persist(); state.selectedSlot = null; state.step = 1; loadSlots(); toast(checked ? 'This event will no longer block new bookings.' : 'This event will block bookings again.');
    } catch (e) { b.checked = !checked; toast(e.message); } finally { b.disabled = false; }
  });
}
function renderBookings() {
  const sorted = [...state.bookings].sort((a, b) => a.start.localeCompare(b.start));
  $('#admin-body').innerHTML = `<div class="admin-section-head"><div><h3>Bookings</h3><p>${cfg.demo ? 'Sample bookings made in this browser appear here.' : 'Bookings made through your meeting page.'}</p></div><span class="admin-badge">${sorted.length} booking${sorted.length === 1 ? '' : 's'}</span></div><div class="bookings-list">${sorted.map(b => `<div class="booking-row"><div><strong>${esc(b.name)} · ${b.duration} min</strong><p>${esc(longDate(b.start, state.settings.timezone))} · ${esc(clock(b.start, state.settings.timezone))} · ${esc(b.email)}</p></div><span class="booking-status">${esc(b.status === 'cancelled' ? 'canceled' : b.status)}</span></div>`).join('') || '<div class="admin-card"><p class="admin-copy">No bookings yet.</p></div>'}</div><div class="admin-savebar"><p>${cfg.demo ? 'Want a fresh start? Clear this browser’s preview data.' : 'Google Calendar remains the source of truth for your meetings.'}</p><button id="admin-end" class="secondary-button" type="button">${cfg.demo ? 'Reset preview' : 'Sign out'}</button></div>`;
  $('#admin-end').onclick = async () => { if (cfg.demo) { state.settings = defaults(); state.bookings = []; state.ignored = []; state.type = fixedDuration ? `meet${fixedDuration}` : 'meet30'; state.submitted = null; state.selectedSlot = null; state.step = 1; persist(); await loadSlots(); renderAdmin(); toast('Preview reset.'); } else { await api('/api/auth/logout', { method: 'POST', body: '{}' }); state.admin = false; $('#admin-dialog').close(); } };
}
async function cancellation(token) {
  $('#info').innerHTML = `<p class="host">${esc(state.settings.name)}</p><h1 class="title">Your meeting</h1><ul class="facts" id="cancel-facts"></ul>`;
  $('#booking-content').innerHTML = '<h2 class="step-title">Cancel or reschedule</h2><p class="muted" id="cancel-message">Loading your meeting…</p><div class="actions" id="cancel-actions"></div>';
  const show = b => {
    const cancelled = b.status === 'cancelled';
    $('#cancel-message').textContent = cancelled ? 'This meeting is canceled. You’re welcome to pick a new time.' : 'To move the meeting, cancel it here and pick a new time. Jan’s calendar and your invitation are updated automatically.';
    // The same length as before; relative to the page's folder, e.g. /meet/30min.
    $('#cancel-actions').innerHTML = cancelled ? `<a class="primary-button" href="${b.duration}min">Pick a new time</a>` : '<button class="danger-button" id="cancel-confirm" type="button">Cancel meeting</button>';
    if (!cancelled) $('#cancel-confirm').onclick = async () => { $('#cancel-confirm').disabled = true; try { await api('/api/cancel', { method: 'POST', body: JSON.stringify({ token }) }); show({ ...b, status: 'cancelled' }); } catch (e) { toast(e.message); $('#cancel-confirm').disabled = false; } };
  };
  try {
    const b = await api(`/api/booking?token=${encodeURIComponent(token)}`);
    $('#info .title').textContent = b.title;
    $('#cancel-facts').innerHTML = `<li>${icon('clock')}<span>${b.duration} min</span></li><li>${icon('calendar')}<span>${esc(clock(b.start, state.zone))} – ${esc(clock(b.end, state.zone))}<br>${esc(longDate(b.start, state.zone))}</span></li><li>${icon('globe')}<span>${esc(zoneName(state.zone))}</span></li>`;
    show(b);
  } catch (e) { $('#cancel-message').textContent = e.message; }
}
async function init() {
  $('#preview-note').hidden = !cfg.demo;
  $('#admin-open').onclick = openAdmin;
  $('#admin-dialog').onclick = e => { if (e.target === $('#admin-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } };
  if (!cfg.demo) { try { const data = await api('/api/public'); state.settings = data.settings; } catch (e) { state.error = e.message; state.loading = false; render(); return; } }
  if (!fixedDuration && !state.settings.types.some(t => t.id === state.type && t.active)) state.type = state.settings.types.find(t => t.active)?.id;
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('cancel')) return cancellation(params.get('cancel'));
  await loadSlots();
  if (location.hash === '#admin') openAdmin();
  if (params.get('error')) { toast(params.get('error')); history.replaceState(null, '', location.pathname); }
}
init();
