import { Capacitor, registerPlugin } from '@capacitor/core';

// Native side: ios/App/App/NuReminders.swift
const NuReminders = registerPlugin('NuReminders');
const native = Capacitor.isNativePlatform();

const SETTINGS_KEY = 'nu_reminders';
const MAX_TIMES = 3;
const SCHEDULE_DAYS = 7;
const SKIP_AFTER_ENTRY_MS = 2 * 60 * 60 * 1000;

const PLANS = {
  once:   ['15:00'],
  twice:  ['11:00', '16:00'],
  custom: ['11:00', '16:00'],
};

// Rotated so the same line never shows twice in a row
export const CHECKIN_MESSAGES = [
  'What did you just finish? One line is enough.',
  "Tiny step check: what's next?",
  'Done anything? Even "made coffee" counts.',
  'Where are you at? Jot it down, then back to it.',
];

const ICON_CLOSE = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>`;

const pad = n => String(n).padStart(2, '0');
const dayString = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function loadReminderSettings() {
  const defaults = { enabled: false, times: PLANS.twice, asked: false };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
  catch { return defaults; }
}

function saveReminderSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Check-ins for the next `days` days at `times` ("HH:MM"), as [{ at, body }] with `at` in ms.
 * Leaves out times already past, the day the user tapped "Not today" (`skipDay`, "YYYY-MM-DD"),
 * and anything within 2 hours after the latest entry (`lastEntryAt`, ms).
 */
export function buildSchedule({ now, times, lastEntryAt = 0, skipDay = null, days = SCHEDULE_DAYS }) {
  const sorted = [...new Set(times)].sort();
  const out = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    if (dayString(day) === skipDay) continue;
    const dayNumber = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86400000;
    sorted.forEach((time, i) => {
      const [h, m] = time.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
      if (at <= now.getTime()) return;
      if (lastEntryAt && at > lastEntryAt && at - lastEntryAt < SKIP_AFTER_ENTRY_MS) return;
      out.push({ at, body: CHECKIN_MESSAGES[(dayNumber * sorted.length + i) % CHECKIN_MESSAGES.length] });
    });
  }
  return out;
}

let deps = null;     // { dayKey, loadEntriesForKey, onTodayChanged, syncBodyScrollLock }
let skipDay = null;
let chain = Promise.resolve();
const enqueue = fn => (chain = chain.then(fn).catch(err => console.error('reminders:', err)));

/**
 * Moves replies typed into notifications into the journal. The native queue keeps each reply
 * until it is acknowledged here, and entries are matched by `pid`, so a reply is never lost
 * and never added twice.
 */
async function mergePendingReplies() {
  const { entries = [], skipDay: nativeSkipDay = null } = await NuReminders.takePending();
  skipDay = nativeSkipDay;
  if (!entries.length) return;

  const todayKey = deps.dayKey(new Date());
  let todayChanged = false;
  for (const reply of entries) {
    const when = new Date(reply.ts);
    const key = deps.dayKey(when);
    const list = deps.loadEntriesForKey(key);
    if (list.some(e => e.pid === reply.id)) continue;
    list.push({ text: reply.text, emoji: null, time: `${pad(when.getHours())}:${pad(when.getMinutes())}`, id: reply.ts, pid: reply.id });
    list.sort((a, b) => a.id - b.id);
    localStorage.setItem(key, JSON.stringify(list)); // throws on failure, so nothing is acknowledged
    if (key === todayKey) todayChanged = true;
  }
  await NuReminders.ackPending({ ids: entries.map(e => e.id) });
  if (todayChanged) deps.onTodayChanged();
}

async function reschedule() {
  const settings = loadReminderSettings();
  if (!settings.enabled) { await NuReminders.cancelAll(); return; }
  const { display } = await NuReminders.getPermission();
  if (display !== 'granted') return;
  const today = deps.loadEntriesForKey(deps.dayKey(new Date()));
  const lastEntryAt = today.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
  const reminders = buildSchedule({ now: new Date(), times: settings.times, lastEntryAt, skipDay });
  await NuReminders.schedule({ reminders });
}

/** Pull in notification replies, then rebuild the upcoming check-ins. */
export function syncReminders() {
  if (!native) return chain;
  return enqueue(async () => {
    await mergePendingReplies();
    await reschedule();
  });
}

/* ── UI ── */
const $ = id => document.getElementById(id);

function openOverlay(el) {
  el.classList.add('visible');
  deps.syncBodyScrollLock();
}

function closeOverlay(el) {
  el.classList.remove('visible');
  deps.syncBodyScrollLock();
}

async function permission() {
  return native ? (await NuReminders.getPermission()).display : 'unavailable';
}

async function askPermission() {
  return native ? (await NuReminders.askPermission()).display : 'unavailable';
}

function setSwitch(el, on) {
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

/* Opt-in, shown once after an entry */
let selectedPlan = 'twice';

function selectPlan(plan) {
  selectedPlan = plan;
  document.querySelectorAll('#remindAskOverlay .rm-option').forEach(btn => {
    btn.setAttribute('aria-checked', btn.dataset.plan === plan ? 'true' : 'false');
  });
}

async function turnOnFromAsk() {
  const settings = { ...loadReminderSettings(), asked: true, times: PLANS[selectedPlan] };
  const display = await askPermission();
  settings.enabled = display === 'granted';
  saveReminderSettings(settings);
  closeOverlay($('remindAskOverlay'));
  if (selectedPlan === 'custom' || !settings.enabled) openReminderSettings();
  syncReminders();
}

function dismissAsk() {
  saveReminderSettings({ ...loadReminderSettings(), asked: true });
  closeOverlay($('remindAskOverlay'));
}

/** Call after the user adds an entry. */
export function afterEntryAdded() {
  syncReminders();
  if (native && !loadReminderSettings().asked) {
    selectPlan('twice');
    openOverlay($('remindAskOverlay'));
  }
}

/* Settings popup */
async function renderSettings() {
  const settings = loadReminderSettings();
  const display = await permission();
  const note = $('remindNote');
  const blocked = display === 'denied' || display === 'unavailable';

  if (display === 'unavailable') note.textContent = 'Reminders work in the nu. iPhone app.';
  else if (display === 'denied') note.textContent = 'Notifications are off for nu. Turn them on in iOS Settings → nu. → Notifications.';
  note.hidden = !blocked;

  const on = settings.enabled && !blocked;
  setSwitch($('remindEnabled'), on);
  $('remindBody').classList.toggle('rm-disabled', !on);

  const times = [...settings.times].sort();
  const list = $('remindTimes');
  list.querySelectorAll('.rm-time').forEach(el => el.remove());
  const addChip = $('remindAddChip');
  times.forEach(time => {
    const chip = document.createElement('button');
    chip.className = 'rm-chip rm-time';
    chip.type = 'button';
    chip.setAttribute('aria-label', times.length > 1 ? `Remove ${time}` : time);
    chip.innerHTML = `<span>${time}</span>${times.length > 1 ? ICON_CLOSE : ''}`;
    chip.disabled = times.length === 1;
    chip.addEventListener('click', () => updateTimes(times.filter(t => t !== time)));
    list.insertBefore(chip, addChip);
  });
  addChip.hidden = times.length >= MAX_TIMES;
}

function updateTimes(times) {
  saveReminderSettings({ ...loadReminderSettings(), times });
  renderSettings();
  syncReminders();
}

async function toggleEnabled() {
  const settings = loadReminderSettings();
  const turningOn = $('remindEnabled').getAttribute('aria-checked') !== 'true';
  let enabled = false;
  if (turningOn) {
    let display = await permission();
    if (display === 'prompt') display = await askPermission();
    enabled = display === 'granted';
  }
  saveReminderSettings({ ...settings, enabled, asked: true });
  await renderSettings();
  syncReminders();
}

function commitAddedTime() {
  const field = $('remindAddTime');
  const value = field.value;
  field.value = '';
  if (!/^\d{2}:\d{2}$/.test(value)) return;
  const times = loadReminderSettings().times;
  if (times.includes(value) || times.length >= MAX_TIMES) return;
  updateTimes([...times, value]);
}

export function openReminderSettings() {
  renderSettings();
  openOverlay($('remindOverlay'));
}

export function initReminders(options) {
  deps = options;

  const askOverlay = $('remindAskOverlay');
  askOverlay.querySelectorAll('.rm-option').forEach(btn => btn.addEventListener('click', () => selectPlan(btn.dataset.plan)));
  $('remindAskOn').addEventListener('click', turnOnFromAsk);
  $('remindAskLater').addEventListener('click', dismissAsk);

  const overlay = $('remindOverlay');
  $('remindBtn').addEventListener('click', openReminderSettings);
  $('remindEnabled').addEventListener('click', toggleEnabled);
  $('remindClose').addEventListener('click', () => closeOverlay(overlay));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(overlay); });
  // iOS commits the time wheel on "Done", which blurs the field
  $('remindAddTime').addEventListener('blur', commitAddedTime);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncReminders();
  });
  syncReminders();
}
