import { dateKey, clock, longDate, zonedDate, demoSlots } from './time.mjs';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const cfg = window.MEET_CONFIG || { demo: true, apiBase: '' };
const apiBase = cfg.apiBase.replace(/\/$/, '');
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const defaults = () => ({ name: 'Jan Bauer', timezone: 'Europe/London', buffer: 15, leadHours: 4, horizonDays: 60, reminders: [24, 1], calendars: ['primary', 'personal'], bookingCalendar: 'primary', weekly: days.map((_, i) => ({ enabled: i < 5, start: '09:00', end: '17:00' })), types: [15, 30, 60, 90].map(d => ({ id: `meet${d}`, duration: d, title: ({ 15: 'Quick chat', 30: 'Meeting', 60: 'Long meeting', 90: 'Extended meeting' })[d], description: '', active: true })) });
let saved;
try { saved = JSON.parse(localStorage.getItem('jan-meet-demo-v1') || 'null'); } catch { /* Storage is optional. */ }
const state = { settings: cfg.demo && saved?.settings || defaults(), bookings: cfg.demo && saved?.bookings || [], ignored: cfg.demo && saved?.ignored || [], zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', month: null, selectedDay: null, selectedSlot: null, type: 'meet30', slots: [], loading: true, step: 1, adminTab: 'types', admin: false, adminCalendars: [], adminEvents: [], query: '', requestNumber: 0, submitted: null, connected: false, mailReady: false, error: '' };
const persist = () => { if (cfg.demo) { try { localStorage.setItem('jan-meet-demo-v1', JSON.stringify({ settings: state.settings, bookings: state.bookings, ignored: state.ignored })); } catch { /* Allow private browsing. */ } } };
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
async function api(path, options = {}) {
  const response = await fetch(apiBase + path, { ...options, credentials: 'include', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data; try { data = await response.json(); } catch { throw new Error('The booking service could not be reached. Please try again.'); }
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
const currentType = () => state.settings.types.find(t => t.id === state.type) || state.settings.types.find(t => t.active);
function zoneOptions(zone) {
  const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney'];
  return [...new Set([zone, 'UTC', ...list])].map(z => `<option value="${esc(z)}"${z === zone ? ' selected' : ''}>${esc(z.replaceAll('_', ' '))}</option>`).join('');
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
function renderPanel() {
  const type = currentType();
  $('#duration-options').innerHTML = state.settings.types.filter(t => t.active).map(t => `<button class="duration-button${t.id === state.type ? ' active' : ''}" data-duration="${esc(t.id)}" aria-pressed="${t.id === state.type}">${t.duration}<small>min</small></button>`).join('');
  $('.panel-copy').textContent = type?.description || 'No meeting types are available right now.';
  $('#meeting-meta').innerHTML = `<div class="meta-row"><span class="meta-icon" aria-hidden="true">◷</span>${type?.duration || 0} minutes</div><div class="meta-row"><span class="meta-icon" aria-hidden="true">▱</span>Google Meet link in the invitation</div><div class="meta-row"><span class="meta-icon" aria-hidden="true">◎</span>Times shown in your timezone</div>${state.settings.reminders.length ? '<div class="meta-row"><span class="meta-icon" aria-hidden="true">♧</span>A friendly reminder before we meet</div>' : ''}`;
  document.querySelectorAll('[data-duration]').forEach(b => b.onclick = async () => { state.type = b.dataset.duration; state.step = 1; state.selectedSlot = null; state.submitted = null; state.error = ''; renderPanel(); await loadSlots(); });
}
async function loadSlots() {
  const request = ++state.requestNumber;
  state.loading = true; renderBooking();
  try {
    const slots = cfg.demo ? demoSlots(state.settings, currentType(), state.bookings, sampleEvents(), state.ignored) : (await api(`/api/slots?type=${encodeURIComponent(state.type)}`)).slots;
    if (request !== state.requestNumber) return;
    state.slots = slots;
    const availableDates = [...new Set(slots.map(s => dateKey(new Date(s.start), state.zone)))];
    if (!availableDates.includes(state.selectedDay)) state.selectedDay = availableDates[0] || null;
    if (!state.month) state.month = (state.selectedDay || dateKey(new Date(), state.zone)).slice(0, 7);
    state.error = '';
  } catch (e) { if (request !== state.requestNumber) return; state.error = e.message; state.slots = []; }
  state.loading = false; renderBooking();
}
function renderBooking() {
  if (state.submitted) return renderSuccess();
  $('#step-number').textContent = state.step === 1 ? '01' : '02';
  $('#step-eyebrow').textContent = state.step === 1 ? 'Available times' : 'MAKE IT A DATE';
  $('#step-title').textContent = state.step === 1 ? 'Select a date and time' : 'A few details, then we’re set';
  $('#step-count').textContent = `${state.step} of 2`;
  const content = $('#booking-content');
  if (state.step === 2) return renderForm();
  if (state.loading) { content.innerHTML = '<div class="loading" role="status">Finding a little room in the calendar…</div>'; return; }
  if (state.error) { content.innerHTML = `<div class="error-message" role="alert">${esc(state.error)}</div><button class="secondary-button" id="retry-slots">Try again</button>`; $('#retry-slots').onclick = loadSlots; return; }
  const [year, month] = state.month.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstIndex = (first.getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = new Set(state.slots.map(s => dateKey(new Date(s.start), state.zone)));
  const today = dateKey(new Date(), state.zone);
  const selectedSlots = state.slots.filter(s => dateKey(new Date(s.start), state.zone) === state.selectedDay);
  const timeCounts = new Map();
  for (const slot of selectedSlots) { const label = clock(slot.start, state.zone); timeCounts.set(label, (timeCounts.get(label) || 0) + 1); }
  const slotLabel = slot => { const label = clock(slot.start, state.zone); if (timeCounts.get(label) === 1) return label; const offset = new Intl.DateTimeFormat('en-GB', { timeZone: state.zone, timeZoneName: 'shortOffset' }).formatToParts(new Date(slot.start)).find(p => p.type === 'timeZoneName').value; return `${label} (${offset})`; };
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const selectedLabel = state.selectedDay ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(state.selectedDay + 'T12:00:00Z')) : 'Choose a day';
  content.innerHTML = `<div class="calendar-layout"><div><div class="calendar-toolbar"><h3 aria-live="polite">${esc(monthName)}</h3><div class="month-buttons"><button class="icon-button" id="prev-month" aria-label="Previous month" ${state.month <= today.slice(0, 7) ? 'disabled' : ''}>‹</button><button class="icon-button" id="next-month" aria-label="Next month" ${state.month >= dateKey(new Date(Date.now() + state.settings.horizonDays * 86400000), state.zone).slice(0, 7) ? 'disabled' : ''}>›</button></div></div><div class="weekdays" aria-hidden="true">${['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map(d => `<span>${d}</span>`).join('')}</div><div class="calendar-grid" aria-label="${esc(monthName)}">${'<span></span>'.repeat(firstIndex)}${Array.from({ length: dayCount }, (_, i) => {
    const day = `${state.month}-${String(i + 1).padStart(2, '0')}`;
    return `<button class="day${dates.has(day) ? ' available' : ''}${day === state.selectedDay ? ' selected' : ''}${day === today ? ' today' : ''}" data-day="${day}" ${dates.has(day) ? '' : 'disabled'} aria-label="${esc(`${day}${dates.has(day) ? ', available' : ', unavailable'}`)}" aria-pressed="${day === state.selectedDay}">${i + 1}</button>`;
  }).join('')}</div><div class="calendar-legend"><span><span class="legend-square"></span>Available</span><span>Weekdays, with room between calls</span></div><div class="timezone-field"><label class="timezone-label" for="visitor-timezone">◎ &nbsp; YOUR TIMEZONE</label><select id="visitor-timezone" class="timezone-select">${zoneOptions(state.zone)}</select><p class="timezone-help">Detected automatically. Change it if you’re travelling.</p></div></div><div class="times-column"><h3 class="times-heading">${esc(selectedLabel)}</h3><p class="times-subtitle">${selectedSlots.length ? 'Times shown in your time zone.' : 'No available times on this date.'}</p><div class="times-list">${selectedSlots.map(s => `<button class="time-button${state.selectedSlot?.start === s.start ? ' selected' : ''}" data-slot="${s.start}" aria-pressed="${state.selectedSlot?.start === s.start}">${esc(slotLabel(s))}</button>`).join('') || '<p class="empty-state">Try another day or a shorter meeting.</p>'}</div><button id="continue" class="continue-button" ${state.selectedSlot ? '' : 'disabled'}>Continue <span aria-hidden="true">→</span></button></div></div><div class="booking-bottom"><span class="status-dot"></span>${cfg.demo ? 'Sample times · nothing is booked' : 'Connected to Google Calendar · availability checked again at booking'}</div>`;
  $('#prev-month').onclick = () => changeMonth(-1); $('#next-month').onclick = () => changeMonth(1);
  document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { state.selectedDay = b.dataset.day; state.selectedSlot = null; renderBooking(); });
  document.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => { state.selectedSlot = state.slots.find(s => s.start === b.dataset.slot); renderBooking(); $('#continue').focus({ preventScroll: true }); });
  $('#visitor-timezone').onchange = e => { state.zone = e.target.value; state.selectedDay = null; state.selectedSlot = null; state.month = null; loadSlots(); };
  $('#continue').onclick = () => { state.step = 2; state.error = ''; renderBooking(); $('#guest-name').focus({ preventScroll: true }); };
}
function changeMonth(delta) { const [y, m] = state.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + delta, 1)); state.month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; renderBooking(); }
function summary() { return `<strong>${esc(longDate(state.selectedSlot.start, state.zone))}</strong><p>${esc(clock(state.selectedSlot.start, state.zone))} – ${esc(clock(state.selectedSlot.end, state.zone))} · ${esc(state.zone.replaceAll('_', ' '))}</p>`; }
function renderForm() {
  $('#booking-content').innerHTML = `<div class="detail-summary"><div>${summary()}</div><button class="back-button" id="change-time">← Change</button></div><form class="booking-form" id="guest-form"><div class="form-grid"><div class="form-field"><label for="guest-name">Your name</label><input id="guest-name" name="name" autocomplete="name" maxlength="100" required placeholder="Alex Taylor"></div><div class="form-field"><label for="guest-email">Email address</label><input id="guest-email" name="email" type="email" autocomplete="email" maxlength="254" required placeholder="alex@example.com"></div></div><div class="form-field"><label for="guest-note">What’s on your mind? <span class="optional">(optional)</span></label><textarea id="guest-note" name="note" maxlength="2000" placeholder="Add anything Jan should know before the meeting."></textarea></div><div class="honeypot" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><div id="form-error" class="error-message" role="alert"></div><button class="primary-button" id="confirm-booking" type="submit">${cfg.demo ? 'Try a sample booking' : 'Confirm meeting'} <span aria-hidden="true">↗</span></button><p class="form-footnote">${cfg.demo ? 'This preview saves a sample in this browser only. No calendar invitation, meeting link, or email will be sent.' : `You’ll receive a calendar invitation${state.settings.reminders.length ? ' and email reminders before we meet' : ''}. Your details are used only to arrange this meeting.`}</p></form>`;
  $('#change-time').onclick = () => { state.step = 1; state.selectedSlot = null; renderBooking(); };
  let bookingId = uid();
  $('#guest-form').onsubmit = async e => {
    e.preventDefault(); const button = $('#confirm-booking'); button.disabled = true; button.textContent = 'Saving your time…'; $('#form-error').textContent = '';
    const form = new FormData(e.target); const payload = { name: String(form.get('name')).trim(), email: String(form.get('email')).trim(), note: String(form.get('note')).trim(), website: form.get('website'), type: state.type, start: state.selectedSlot.start, timezone: state.zone, idempotencyKey: bookingId };
    try {
      if (cfg.demo) { const b = { id: bookingId, ...payload, ...state.selectedSlot, title: currentType().title, duration: currentType().duration, status: 'confirmed', demo: true }; state.bookings.push(b); persist(); state.submitted = b; }
      else state.submitted = await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
      renderSuccess();
    } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; button.textContent = cfg.demo ? 'Try a sample booking ↗' : 'Confirm meeting ↗'; }
  };
}
function icsText(booking) {
  const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
  const text = s => String(s || '').replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jan Bauer//Meet//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${booking.id}@janbauer.cc`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(booking.start)}`, `DTEND:${stamp(booking.end)}`, `SUMMARY:${text(`${cfg.demo ? '[Preview] ' : ''}${booking.title} with Jan Bauer`)}`, `DESCRIPTION:${text(cfg.demo ? 'Sample only. This is not a real appointment.' : 'Your meeting with Jan Bauer.')}`, `LOCATION:${text(booking.meetLink || 'See your Google Calendar invitation')}`, 'END:VEVENT', 'END:VCALENDAR'];
  return lines.join('\r\n') + '\r\n';
}
function renderSuccess() {
  const b = state.submitted; $('#step-number').textContent = '✓'; $('#step-eyebrow').textContent = 'TIME, WELL SPENT'; $('#step-title').textContent = cfg.demo ? 'That’s how it works' : 'See you soon'; $('#step-count').textContent = 'All set';
  $('#booking-content').innerHTML = `<div class="success"><div class="success-icon" aria-hidden="true">✓</div><h3>${cfg.demo ? 'Your sample meeting is saved.' : 'It’s in the calendar.'}</h3><p>${cfg.demo ? 'In the live version, you’ll get a Google Calendar invitation, a unique Meet link, and a friendly reminder. This sample stays in this browser.' : `A calendar invitation is on its way to <strong>${esc(b.email)}</strong>. ${b.meetLink ? 'Your Google Meet link is ready below.' : 'Your invitation will include the meeting details. Meet link generation can take a moment.'}`}</p><div class="detail-summary"><strong>${esc(b.title)} · ${b.duration} minutes</strong><p>${esc(longDate(b.start, state.zone))}</p><p>${esc(clock(b.start, state.zone))} – ${esc(clock(b.end, state.zone))}</p><span class="timezone-pill">${esc(state.zone.replaceAll('_', ' '))}</span></div><div class="success-actions">${b.meetLink ? `<a class="primary-button" target="_blank" rel="noopener" href="${esc(b.meetLink)}">Open Google Meet ↗</a>` : ''}<button class="secondary-button" id="download-ics">${cfg.demo ? 'Download sample .ics' : 'Add to calendar (.ics)'}</button><button class="secondary-button" id="book-again">Book another time</button></div>${b.cancelUrl ? `<p class="form-footnote"><a href="${esc(b.cancelUrl)}">Need to cancel or choose a different time?</a></p>` : ''}</div>`;
  $('#download-ics').onclick = () => { const url = URL.createObjectURL(new Blob([icsText(b)], { type: 'text/calendar;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'meet-jan-bauer.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  $('#book-again').onclick = () => { state.submitted = null; state.selectedSlot = null; state.step = 1; loadSlots(); };
}
async function openAdmin() {
  if (!$('#admin-dialog').open) $('#admin-dialog').showModal();
  if (cfg.demo) { state.admin = true; state.adminCalendars = [{ id: 'primary', summary: 'Jan Bauer', backgroundColor: '#718d5c', accessRole: 'owner' }, { id: 'personal', summary: 'Personal', backgroundColor: '#c3ad74', accessRole: 'owner' }, { id: 'birthdays', summary: 'Birthdays & holidays', backgroundColor: '#a4afb9', accessRole: 'reader' }]; state.adminEvents = sampleEvents(); renderAdmin(); return; }
  try { const data = await api('/api/admin'); Object.assign(state, { admin: true, settings: data.settings, connected: data.connected, mailReady: data.mailReady, adminCalendars: data.calendars, bookings: data.bookings, ignored: data.ignored }); renderAdmin(); }
  catch { state.admin = false; renderAdminLogin(); }
}
const adminHeader = () => `<div class="admin-header"><div><h2 id="admin-title">Your time, your rules<span class="green">.</span></h2><p>${cfg.demo ? 'Admin preview · changes are saved only in this browser' : 'Signed in as the calendar owner'}</p></div><button class="icon-button" id="admin-close" aria-label="Close admin">×</button></div>`;
function renderAdminLogin() {
  $('#admin-content').innerHTML = `${adminHeader()}<div class="admin-body"><div class="login-box"><div class="avatar" style="margin:0 auto">jb</div><h3>Sign in with Google to manage your booking page.</h3><p>Sign in with your Google account to manage meeting types, availability, and calendar rules.</p><a href="${esc(apiBase)}/api/auth/google" class="primary-button">Sign in with Google <span aria-hidden="true">↗</span></a><p class="form-footnote">Only the configured admin account can access this workspace.</p></div></div>`; $('#admin-close').onclick = () => $('#admin-dialog').close();
}
function renderAdmin() {
  $('#admin-content').innerHTML = `${adminHeader()}<div class="admin-tabs" role="tablist" aria-label="Admin sections">${[['types', 'Meeting types'], ['availability', 'Availability'], ['calendars', 'Calendar rules'], ['bookings', 'Bookings']].map(([id, label]) => `<button class="admin-tab${id === state.adminTab ? ' active' : ''}" data-tab="${id}" role="tab" aria-selected="${id === state.adminTab}">${label}</button>`).join('')}</div><div class="admin-body" id="admin-body"></div>`;
  $('#admin-close').onclick = () => $('#admin-dialog').close();
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.adminTab = b.dataset.tab; renderAdmin(); });
  ({ types: renderTypes, availability: renderAvailability, calendars: renderCalendars, bookings: renderBookings })[state.adminTab]();
}
function savebar() { return `<div class="admin-savebar"><p>${cfg.demo ? 'Preview settings stay in this browser.' : 'Changes apply to new bookings immediately.'}</p><button class="primary-button" type="submit">Save changes <span aria-hidden="true">↗</span></button></div>`; }
async function saveSettings(next, button) {
  if (button) button.disabled = true;
  try {
    if (!next.types.some(t => t.active)) throw new Error('Keep at least one meeting type available.');
    if (cfg.demo) { state.settings = next; persist(); }
    else { const data = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(next) }); state.settings = data.settings; }
    if (!state.settings.types.some(t => t.id === state.type && t.active)) state.type = state.settings.types.find(t => t.active).id;
    state.selectedSlot = null; state.submitted = null; state.step = 1; renderPanel(); await loadSlots(); toast('Your changes are saved.');
  } catch (e) { toast(e.message); } finally { if (button) button.disabled = false; }
}
function renderTypes() {
  $('#admin-body').innerHTML = `<div class="admin-section-head"><div><h3>A format for every conversation</h3><p>Give each meeting a name, a little context, and an on/off switch.</p></div><span class="admin-badge">4 meeting lengths</span></div><form id="types-form"><div class="type-cards">${state.settings.types.map((t, i) => `<div class="type-card"><div class="type-card-top"><span class="type-duration">${t.duration}<small>minutes</small></span><label class="switch"><input type="checkbox" name="active${i}" ${t.active ? 'checked' : ''} aria-label="Enable ${t.duration}-minute meeting"><span>Available</span></label></div><div class="form-field"><label for="type-title${i}">Meeting name</label><input name="title${i}" id="type-title${i}" value="${esc(t.title)}" required maxlength="80"></div><div class="form-field"><label for="type-description${i}">Note</label><textarea name="description${i}" id="type-description${i}" maxlength="300">${esc(t.description)}</textarea></div></div>`).join('')}</div>${savebar()}</form>`;
  $('#types-form').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target), next = structuredClone(state.settings); next.types.forEach((t, i) => { t.title = String(f.get(`title${i}`)).trim(); t.description = String(f.get(`description${i}`)).trim(); t.active = f.has(`active${i}`); }); saveSettings(next, e.submitter); };
}
function renderAvailability() {
  const s = state.settings;
  $('#admin-body').innerHTML = `<div class="admin-section-head"><div><h3>Availability</h3><p>Working hours follow your timezone. Guests see their own local time.</p></div></div><form id="availability-form"><div class="admin-two-col"><div class="admin-card"><h3>Your weekly rhythm</h3><div class="form-field"><label for="host-timezone">Your timezone</label><select name="timezone" id="host-timezone">${zoneOptions(s.timezone)}</select></div>${s.weekly.map((w, i) => `<div class="week-row"><label class="switch"><input type="checkbox" name="enabled${i}" ${w.enabled ? 'checked' : ''} aria-label="Available on ${days[i]}"><span>${days[i].slice(0, 3)}</span></label><input type="time" name="start${i}" value="${w.start}" required aria-label="${days[i]} start time"><span>–</span><input type="time" name="end${i}" value="${w.end}" required aria-label="${days[i]} end time"></div>`).join('')}</div><div><div class="admin-card"><h3>Buffers and notice</h3><div class="form-grid"><div class="form-field"><label for="buffer">Buffer, each side (min)</label><input type="number" id="buffer" name="buffer" min="0" max="120" value="${s.buffer}" required></div><div class="form-field"><label for="lead">Minimum notice (hours)</label><input type="number" id="lead" name="leadHours" min="0" max="168" value="${s.leadHours}" required></div></div><div class="form-field"><label for="horizon">Booking window (days ahead)</label><input type="number" name="horizonDays" id="horizon" min="1" max="90" value="${s.horizonDays}" required></div></div><div class="admin-card" style="margin-top:15px"><h3>A Email reminders</h3><label class="reminder-setting"><span>24 hours before<small>Sent 24 hours before.</small></span><span class="switch"><input type="checkbox" name="reminder24" ${s.reminders.includes(24) ? 'checked' : ''} aria-label="24-hour email reminder"></span></label><label class="reminder-setting"><span>1 hour before<small>Sent 1 hour before.</small></span><span class="switch"><input type="checkbox" name="reminder1" ${s.reminders.includes(1) ? 'checked' : ''} aria-label="1-hour email reminder"></span></label><p class="admin-copy" style="margin-top:12px">${cfg.demo ? 'The live backend sends these emails automatically.' : state.mailReady ? 'Email delivery is configured.' : 'Email delivery needs SMTP configuration before reminders can be enabled.'}</p></div></div></div>${savebar()}</form>`;
  $('#availability-form').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target), next = structuredClone(s); next.timezone = f.get('timezone'); ['buffer', 'leadHours', 'horizonDays'].forEach(k => next[k] = +f.get(k)); next.weekly = days.map((_, i) => ({ enabled: f.has(`enabled${i}`), start: f.get(`start${i}`), end: f.get(`end${i}`) })); next.reminders = [24, 1].filter(v => f.has(`reminder${v}`)); if (next.weekly.some(w => w.enabled && w.start >= w.end)) return toast('Each working day needs an end time after its start.'); saveSettings(next, e.submitter); };
}
function renderCalendars() {
  $('#admin-body').innerHTML = `<div class="admin-section-head"><div><h3>You decide what counts as busy</h3><p>Block time from whole calendars, or ignore individual events.</p></div></div>${cfg.demo ? '<div class="admin-notice">These are sample calendars and events. Your real calendar is connected after Google sign-in on the live backend.</div>' : ''}<div class="admin-card"><h3>Calendars to check</h3><div id="calendar-rules">${state.adminCalendars.map(c => `<div class="calendar-rule"><div><strong><span class="calendar-color" style="background:${/^#[0-9a-f]{6}$/i.test(c.backgroundColor) ? c.backgroundColor : '#82946d'}"></span>${esc(c.summary)}</strong><p>${c.id === state.settings.bookingCalendar ? 'Booking destination · confirmed meetings always reserve their time' : 'Busy events on this calendar can block new bookings'}</p></div><label class="switch"><input type="checkbox" data-calendar="${esc(c.id)}" ${state.settings.calendars.includes(c.id) ? 'checked' : ''} aria-label="Use ${esc(c.summary)} for conflicts"><span>Check conflicts</span></label></div>`).join('')}</div><div class="form-field" style="margin-top:20px;margin-bottom:0"><label for="booking-calendar">Add new bookings to</label><select id="booking-calendar">${state.adminCalendars.filter(c => ['owner', 'writer'].includes(c.accessRole)).map(c => `<option value="${esc(c.id)}"${c.id === state.settings.bookingCalendar ? ' selected' : ''}>${esc(c.summary)}</option>`).join('')}</select><p class="admin-copy">Google Meet must be supported by the selected calendar.</p></div></div><div class="admin-card" style="margin-top:17px"><h3>Individual events</h3><p class="admin-copy">Switch on “Ignore” to allow bookings over that event. This leaves the original event in Google Calendar unchanged.</p><div class="event-filter"><div class="form-field"><label for="event-from">From</label><input id="event-from" type="date" value="${dateKey(new Date(), state.settings.timezone)}"></div><div class="form-field"><label for="event-to">Until</label><input id="event-to" type="date" value="${dateKey(new Date(Date.now() + 7 * 86400000), state.settings.timezone)}"></div><button class="secondary-button" id="load-events">Find events</button></div><div id="event-list" class="event-list"><p class="admin-copy">Find events to choose which ones to ignore.</p></div></div><div class="admin-savebar"><p>Calendar selections take effect when saved.</p><button id="save-calendars" class="primary-button">Save calendar rules ↗</button></div>`;
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
      state.ignored = state.ignored.filter(k => k !== b.dataset.eventKey); if (checked) state.ignored.push(b.dataset.eventKey); persist(); state.selectedSlot = null; loadSlots(); toast(checked ? 'This event will no longer block new bookings.' : 'This event will block bookings again.');
    } catch (e) { b.checked = !checked; toast(e.message); } finally { b.disabled = false; }
  });
}
function renderBookings() {
  const sorted = [...state.bookings].sort((a, b) => a.start.localeCompare(b.start));
  $('#admin-body').innerHTML = `<div class="admin-section-head"><div><h3>Conversations to look forward to</h3><p>${cfg.demo ? 'Sample bookings made in this browser appear here.' : 'Bookings made through your meeting page.'}</p></div><span class="admin-badge">${sorted.length} booking${sorted.length === 1 ? '' : 's'}</span></div><div class="bookings-list">${sorted.map(b => `<div class="booking-row"><div><strong>${esc(b.name)} · ${b.duration} min</strong><p>${esc(longDate(b.start, state.settings.timezone))} · ${esc(clock(b.start, state.settings.timezone))} · ${esc(b.email)}</p></div><span class="booking-status">${esc(b.status)}</span></div>`).join('') || '<div class="admin-card"><p class="admin-copy">No bookings yet.</p></div>'}</div><div class="admin-savebar"><p>${cfg.demo ? 'Want a fresh start? Clear this browser’s preview data.' : 'Google Calendar remains the source of truth for your meetings.'}</p><button id="admin-end" class="secondary-button">${cfg.demo ? 'Reset preview' : 'Sign out'}</button></div>`;
  $('#admin-end').onclick = async () => { if (cfg.demo) { state.settings = defaults(); state.bookings = []; state.ignored = []; state.type = 'meet30'; state.submitted = null; state.selectedSlot = null; state.step = 1; persist(); renderPanel(); await loadSlots(); renderAdmin(); toast('Preview reset.'); } else { await api('/api/auth/logout', { method: 'POST', body: '{}' }); state.admin = false; $('#admin-dialog').close(); } };
}
async function cancellation(token) {
  $('#booking-shell').style.display = 'block';
  $('#booking-shell').innerHTML = '<div class="cancel-view"><p class="eyebrow">YOUR MEETING</p><h2>Manage your time.</h2><p id="cancel-message">Loading your meeting…</p><div id="cancel-actions"></div></div>';
  try {
    const b = await api(`/api/booking?token=${encodeURIComponent(token)}`);
    $('#cancel-message').textContent = `${b.title} · ${longDate(b.start, state.zone)} · ${clock(b.start, state.zone)} (${state.zone}). ${b.status === 'cancelled' ? 'This meeting has been cancelled.' : 'You can cancel this meeting and choose a new time.'}`;
    $('#cancel-actions').innerHTML = `${b.status !== 'cancelled' ? '<button class="danger-button" id="cancel-confirm">Cancel this meeting</button>' : ''} <a class="secondary-button" href="${esc(location.pathname)}">Choose a new time</a>`;
    if ($('#cancel-confirm')) $('#cancel-confirm').onclick = async () => { $('#cancel-confirm').disabled = true; try { await api('/api/cancel', { method: 'POST', body: JSON.stringify({ token }) }); $('#cancel-message').textContent = 'Your meeting has been cancelled and your calendar invitation has been updated. You’re welcome to choose another time.'; $('#cancel-confirm').remove(); } catch (e) { toast(e.message); $('#cancel-confirm').disabled = false; } };
  } catch (e) { $('#cancel-message').textContent = e.message; }
}
async function init() {
  if ($('#year')) $('#year').textContent = new Date().getFullYear(); $('#preview-note').hidden = !cfg.demo;
  $('#admin-open').onclick = openAdmin; $('#demo-admin').onclick = openAdmin;
  $('#admin-dialog').onclick = e => { if (e.target === $('#admin-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } };
  if (!cfg.demo) { try { const data = await api('/api/public'); state.settings = data.settings; } catch (e) { state.error = e.message; state.loading = false; renderPanel(); renderBooking(); return; } }
  if (!state.settings.types.some(t => t.id === state.type && t.active)) state.type = state.settings.types.find(t => t.active)?.id;
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('cancel')) return cancellation(params.get('cancel'));
  renderPanel(); await loadSlots();
  if (location.hash === '#admin') openAdmin();
  if (params.get('error')) { toast(params.get('error')); history.replaceState(null, '', location.pathname); }
}
init();
