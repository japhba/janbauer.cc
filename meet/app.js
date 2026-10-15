const cfg = window.MEET_CONFIG || {};
const apiBase = (cfg.apiBase || '').replace(/\/$/, '');
const app = document.getElementById('app');
const title = document.getElementById('title');
const visitorZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const state = {
  settings: null,
  type: null,
  zone: visitorZone,
  slots: [],
  start: null,
  day: null,
  key: null,
  booked: null,
  error: '',
  loading: false,
};

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cityOf = zone => zone.split('/').pop().replaceAll('_', ' ');

async function api(path, options = {}) {
  const response = await fetch(apiBase + path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The booking service could not be reached. Please try again.'); }
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// Formatting always uses the zone passed in, so each visitor sees their own clock.
const clock = (iso, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const dayKey = (iso, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dayShort = (iso, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric' }).format(new Date(iso));
const dayLabel = (iso, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
const longDate = (iso, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
function gmtOffset(zone, iso) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(iso)).find(p => p.type === 'timeZoneName')?.value || '';
}
const currentType = () => state.settings?.types.find(t => t.id === state.type);
const selectedSlot = () => state.slots.find(s => s.start === state.start);

function zoneOptions() {
  const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York'];
  return [...new Set([state.zone, 'UTC', ...list])]
    .map(z => `<option value="${esc(z)}"${z === state.zone ? ' selected' : ''}>${esc(z.replaceAll('_', ' '))}</option>`).join('');
}

function zoneBlock(now) {
  const host = state.settings.timezone;
  return `<div class="zone">
    <label for="zone">Times shown in your time zone</label>
    <select id="zone">${zoneOptions()}</select>
    <p class="zone-now">${esc(cityOf(state.zone))} · ${esc(gmtOffset(state.zone, now))}</p>
    <p class="zone-host">Jan is in ${esc(cityOf(host))} (${esc(gmtOffset(host, now))}). Each time below is converted to yours.</p>
  </div>`;
}

function renderBook() {
  title.textContent = 'Book a meeting';
  const types = state.settings.types;
  const now = new Date();
  const durations = types.map(t => `<button type="button" data-type="${esc(t.id)}" aria-pressed="${t.id === state.type}">${t.duration} min</button>`).join('');
  const type = currentType();
  let body;
  if (state.loading) {
    body = '<p class="muted">Loading times…</p>';
  } else if (!state.slots.length) {
    body = '<p class="muted">No times are free for this length in the next few weeks. Try a shorter meeting.</p>';
  } else {
    const days = new Map();
    for (const s of state.slots) {
      const k = dayKey(s.start, state.zone);
      if (!days.has(k)) days.set(k, { label: dayLabel(s.start, state.zone), short: dayShort(s.start, state.zone), slots: [] });
      days.get(k).slots.push(s);
    }
    if (!days.has(state.day)) state.day = [...days.keys()][0];
    const chosen = days.get(state.day);
    body = `<div class="days" role="group" aria-label="Day">${[...days].map(([k, d]) => `<button type="button" data-day="${esc(k)}" aria-pressed="${k === state.day}">${esc(d.short)}</button>`).join('')}</div>
      <h3>${esc(chosen.label)}</h3>
      <div class="times">${chosen.slots.map(s => `<button type="button" data-start="${esc(s.start)}">${clock(s.start, state.zone)}</button>`).join('')}</div>`;
  }
  app.innerHTML = `
    <p class="muted">${esc(type ? `${type.duration} minutes` : '')}${type?.description ? ` · ${esc(type.description)}` : ''}</p>
    <div class="durations" role="group" aria-label="Meeting length">${durations}</div>
    ${zoneBlock(now)}
    <div id="slots">${body}</div>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''}
  `;
  const zone = document.getElementById('zone');
  if (zone) zone.onchange = () => { state.zone = zone.value; render(); };
  app.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { state.type = b.dataset.type; state.start = null; loadSlots(); });
  app.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { state.day = b.dataset.day; render(); });
  app.querySelectorAll('[data-start]').forEach(b => b.onclick = () => { state.start = b.dataset.start; state.key = crypto.randomUUID(); state.error = ''; render(); });
}

function renderForm() {
  title.textContent = 'Confirm your meeting';
  const slot = selectedSlot();
  const type = currentType();
  app.innerHTML = `
    <div class="summary">
      <div>
        <p><strong>${esc(longDate(slot.start, state.zone))}</strong></p>
        <p class="muted">${esc(type.duration)} minutes · ${esc(cityOf(state.zone))} time (${esc(gmtOffset(state.zone, slot.start))})</p>
      </div>
      <button type="button" class="link" id="change">Change</button>
    </div>
    <form id="guest" novalidate>
      <label for="g-name">Your name</label>
      <input id="g-name" name="name" autocomplete="name" maxlength="100" required>
      <label for="g-email">Email</label>
      <input id="g-email" name="email" type="email" autocomplete="email" maxlength="254" required>
      <p class="note">The calendar invitation and Google Meet link go to this address.</p>
      <label for="g-note">Anything to share beforehand? <span class="muted">(optional)</span></label>
      <textarea id="g-note" name="note" maxlength="2000"></textarea>
      <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <p class="error" id="form-error" role="alert">${esc(state.error)}</p>
      <button class="primary" id="confirm" type="submit">Book meeting</button>
    </form>`;
  document.getElementById('change').onclick = () => { state.start = null; state.error = ''; render(); };
  document.getElementById('guest').onsubmit = submitBooking;
}

async function submitBooking(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  if (!name || !email) { state.error = 'Please enter your name and email.'; return render(); }
  const button = document.getElementById('confirm');
  button.disabled = true;
  state.error = '';
  try {
    const booking = await api('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        name, email, note: form.note.value.trim(), website: form.website.value,
        type: state.type, start: state.start, timezone: state.zone, idempotencyKey: state.key,
      }),
    });
    state.booked = booking;
    renderDone();
  } catch (e) {
    button.disabled = false;
    state.error = e.message;
    document.getElementById('form-error').textContent = state.error;
  }
}

function renderDone() {
  title.textContent = 'You’re booked';
  const b = state.booked;
  const when = longDate(b.start, state.zone);
  app.innerHTML = `
    <div class="summary">
      <div>
        <p><strong>${esc(when)}</strong></p>
        <p class="muted">${esc(b.duration)} minutes · ${esc(cityOf(state.zone))} time (${esc(gmtOffset(state.zone, b.start))})</p>
      </div>
    </div>
    <p>A calendar invitation is on its way to <strong>${esc(b.email)}</strong>${b.meetLink ? ' with your Google Meet link.' : '. The Google Meet link will appear in the invitation.'}</p>
    ${b.meetLink ? `<p><a href="${esc(b.meetLink)}" target="_blank" rel="noopener">Open Google Meet link</a></p>` : ''}
    <p class="note">Need to change plans? <a href="${esc(b.cancelUrl)}">Cancel this meeting</a>.</p>
    <p><button type="button" class="link" id="again">Book another time</button></p>`;
  document.getElementById('again').onclick = () => { state.booked = null; state.start = null; title.textContent = 'Book a meeting'; loadSlots(); };
}

async function renderCancel(token) {
  title.textContent = 'Cancel meeting';
  app.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const b = await api(`/api/booking?token=${encodeURIComponent(token)}`);
    if (b.status === 'cancelled') {
      app.innerHTML = '<p>This meeting is already cancelled.</p><p><a href="./">Book a new time</a></p>';
      return;
    }
    app.innerHTML = `
      <div class="summary"><div>
        <p><strong>${esc(longDate(b.start, state.zone))}</strong></p>
        <p class="muted">${esc(b.duration)} minutes · ${esc(cityOf(state.zone))} time</p>
      </div></div>
      <button class="primary" id="cancel-confirm" type="button">Cancel meeting</button>
      <p class="error" id="cancel-error" role="alert"></p>
      <p class="note"><a href="./">Book a new time instead</a></p>`;
    document.getElementById('cancel-confirm').onclick = async () => {
      const button = document.getElementById('cancel-confirm');
      button.disabled = true;
      try {
        await api('/api/cancel', { method: 'POST', body: JSON.stringify({ token }) });
        app.innerHTML = '<p>Your meeting is cancelled. The calendar invitation has been updated.</p><p><a href="./">Book a new time</a></p>';
        title.textContent = 'Meeting cancelled';
      } catch (e) {
        button.disabled = false;
        document.getElementById('cancel-error').textContent = e.message;
      }
    };
  } catch (e) {
    app.innerHTML = `<p class="error" role="alert">${esc(e.message)}</p><p><a href="./">Back to booking</a></p>`;
  }
}

async function loadSlots() {
  state.loading = true;
  render();
  try {
    const data = await api(`/api/slots?type=${encodeURIComponent(state.type)}`);
    state.slots = data.slots;
    state.error = '';
  } catch (e) {
    state.slots = [];
    state.error = e.message;
  }
  state.loading = false;
  render();
}

function render() {
  if (state.booked) return renderDone();
  if (state.start && selectedSlot()) return renderForm();
  state.start = null;
  renderBook();
}

function route() {
  if (location.hash.startsWith('#cancel=')) {
    return renderCancel(decodeURIComponent(location.hash.slice('#cancel='.length)));
  }
  if (!state.settings) return;
  if (state.booked) return renderDone();
  if (state.start && selectedSlot()) return renderForm();
  loadSlots();
}

async function init() {
  try {
    const data = await api('/api/public');
    state.settings = data.settings;
    const types = state.settings.types;
    state.type = (types.find(t => t.duration === 30) || types[0] || {}).id;
  } catch (e) {
    app.innerHTML = `<p class="error" role="alert">${esc(e.message)}</p>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

init();
