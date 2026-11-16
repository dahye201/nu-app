import { Capacitor, registerPlugin } from '@capacitor/core';

// Native side: ios/App/App/NuReminders.swift
const NuReminders = registerPlugin('NuReminders');
const native = Capacitor.isNativePlatform();

const SETTINGS_KEY = 'nu_reminders';
const MAX_TIMES = 3;
const SCHEDULE_DAYS = 7;
const SKIP_AFTER_ENTRY_MS = 2 * 60 * 60 * 1000;

// Free: two random check-ins a day. Premium: up to MAX_TIMES fixed times of the user's choosing.
const DEFAULT_CUSTOM_TIMES = ['11:00', '16:00'];
const RANDOM_START = 10 * 60;   // minutes after midnight
const RANDOM_END = 20 * 60;
const RANDOM_MIN_GAP = 3 * 60;
const SEED_KEY = 'nu_reminders_seed';

// Rotated so the same line never shows twice in a row
export const CHECKIN_MESSAGES = [
  'What did you just finish? One line is enough.',
  "Tiny step check: what's next?",
  'Done anything? Even "made coffee" counts.',
  'Where are you at? Jot it down, then back to it.',
];

const ICON_CLOSE = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>`;

const pad = n => String(n).padStart(2, '0');

// iPhone's 12/24-hour setting, read natively (the web view's Intl doesn't follow it)
let hour12 = null;

function deviceUsesHour12() {
  if (hour12 !== null) return hour12;
  const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h11' || cycle === 'h12';
}

/** "15:00" → "3 PM" or "15:00", following the device's 12/24-hour setting. */
export function formatTime(hhmm, useHour12 = deviceUsesHour12()) {
  const [h, m] = hhmm.split(':').map(Number);
  if (!useHour12) return `${pad(h)}:${pad(m)}`;
  const hour = h % 12 || 12;
  return `${m ? `${hour}:${pad(m)}` : hour} ${h < 12 ? 'AM' : 'PM'}`;
}
const dayString = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toHHMM = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** { enabled, mode: 'random' | 'custom', times (custom times), asked } */
export function loadReminderSettings() {
  const defaults = { enabled: false, mode: 'random', times: DEFAULT_CUSTOM_TIMES, asked: false };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { saved = {}; }
  const settings = { ...defaults, ...saved };
  // Test builds before modes: the old presets become random, anything else stays custom
  if (!saved.mode && Array.isArray(saved.times)) {
    const preset = ['15:00', '11:00,16:00'].includes([...saved.times].sort().join());
    settings.mode = preset ? 'random' : 'custom';
    if (preset) settings.times = DEFAULT_CUSTOM_TIMES;
  }
  return settings;
}

function saveReminderSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Small seeded PRNG (mulberry32) and string hash (FNV-1a)
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Per-install salt, so random times differ between people but stay put for a given day. */
function reminderSeed() {
  let seed = localStorage.getItem(SEED_KEY);
  if (!seed) {
    seed = String(Math.floor(Math.random() * 2 ** 32));
    localStorage.setItem(SEED_KEY, seed);
  }
  return seed;
}

/**
 * Two random times ("HH:MM") for `day` between 10:00 and 20:00, at least 3 hours apart,
 * uniform over all such pairs. Rescheduling the same day gives the same times.
 */
export function randomTimesFor(day, seed) {
  const rand = seededRandom(hashString(`${seed}:${dayString(day)}`));
  const span = RANDOM_END - RANDOM_START - RANDOM_MIN_GAP;
  const [a, b] = [Math.floor(rand() * (span + 1)), Math.floor(rand() * (span + 1))].sort((x, y) => x - y);
  return [toHHMM(RANDOM_START + a), toHHMM(RANDOM_START + b + RANDOM_MIN_GAP)];
}

/**
 * Check-ins for the next `days` days, as [{ at, body }] with `at` in ms. `timesFor(day)` gives
 * that day's times ("HH:MM"); `times` is a shortcut for the same times every day.
 * Leaves out times already past, the day the user tapped "Not today" (`skipDay`, "YYYY-MM-DD"),
 * and anything within 2 hours after the latest entry (`lastEntryAt`, ms).
 */
export function buildSchedule({ now, times = [], timesFor = () => times, lastEntryAt = 0, skipDay = null, days = SCHEDULE_DAYS }) {
  const out = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    if (dayString(day) === skipDay) continue;
    const dayNumber = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86400000;
    [...new Set(timesFor(day))].sort().forEach((time, i) => {
      const [h, m] = time.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
      if (at <= now.getTime()) return;
      if (lastEntryAt && at > lastEntryAt && at - lastEntryAt < SKIP_AFTER_ENTRY_MS) return;
      // Stride MAX_TIMES (3) over 4 messages: neighbours, within and across days, always differ
      out.push({ at, body: CHECKIN_MESSAGES[(dayNumber * MAX_TIMES + i) % CHECKIN_MESSAGES.length] });
    });
  }
  return out;
}

/** Custom times only while Premium; otherwise (or if never set) random. */
function usesCustomTimes(settings) {
  return settings.mode === 'custom' && deps.isPremium();
}

let deps = null;     // { dayKey, loadEntriesForKey, onTodayChanged, syncBodyScrollLock, isPremium, openPaywall }
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
  const seed = reminderSeed();
  const timesFor = usesCustomTimes(settings) ? () => settings.times : day => randomTimesFor(day, seed);
  const reminders = buildSchedule({ now: new Date(), timesFor, lastEntryAt, skipDay });
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

/**
 * Time chips before `addChip` in `list`: × removes one (never the last), and the "+ Add"
 * chip, holding a hidden time field, hides at MAX_TIMES. Used by the opt-in and settings.
 */
function renderTimeChips(list, addChip, times, { format = t => t, onChange }) {
  const sorted = [...times].sort();
  list.querySelectorAll('.rm-time').forEach(el => el.remove());
  sorted.forEach(time => {
    const removable = sorted.length > 1;
    const chip = document.createElement('button');
    chip.className = 'rm-chip rm-time';
    chip.type = 'button';
    chip.setAttribute('aria-label', removable ? `Remove ${format(time)}` : format(time));
    chip.innerHTML = `<span>${format(time)}</span>${removable ? ICON_CLOSE : ''}`;
    chip.disabled = !removable;
    chip.addEventListener('click', () => onChange(sorted.filter(t => t !== time)));
    list.insertBefore(chip, addChip);
  });
  addChip.hidden = sorted.length >= MAX_TIMES;
}

/** Reads the time picked in a chip's iOS time wheel and returns the new list, or null. */
function takeAddedTime(field, times) {
  const value = field.value;
  field.value = '';
  if (!/^\d{2}:\d{2}$/.test(value) || times.includes(value) || times.length >= MAX_TIMES) return null;
  return [...times, value];
}

/** "My times" is Premium: free users see a lock and get the paywall. */
function lockCustomButton(btn, label) {
  const locked = !deps.isPremium();
  btn.classList.toggle('is-locked', locked);
  btn.setAttribute('aria-label', locked ? `${label}, Premium` : label);
}

/* Opt-in, shown once after an entry */
let askCustom = false;
let customTimes = [...DEFAULT_CUSTOM_TIMES];

function renderAskTimes() {
  renderTimeChips($('remindAskTimes'), $('remindAskAddChip'), customTimes, {
    format: formatTime,
    onChange(times) { customTimes = times; renderAskTimes(); },
  });
}

function showAskCustom(show) {
  askCustom = show;
  $('remindAskTimes').hidden = !show;
  $('remindAskCustom').setAttribute('aria-expanded', show ? 'true' : 'false');
  if (show) renderAskTimes();
}

function toggleAskCustom() {
  if (!deps.isPremium()) { deps.openPaywall(); return; }
  showAskCustom(!askCustom);
}

function openAsk() {
  lockCustomButton($('remindAskCustom'), 'Pick my own times');
  customTimes = [...DEFAULT_CUSTOM_TIMES];
  showAskCustom(false);
  openOverlay($('remindAskOverlay'));
}

// The choice is saved first; reminders only switch on if iOS grants permission.
async function turnOnFromAsk() {
  const settings = loadReminderSettings();
  const choice = askCustom && deps.isPremium()
    ? { mode: 'custom', times: [...customTimes].sort() }
    : { mode: 'random', times: settings.times };
  saveReminderSettings({ ...settings, ...choice, asked: true, enabled: false });
  const display = await askPermission();
  if (display === 'granted') saveReminderSettings({ ...loadReminderSettings(), enabled: true });
  closeOverlay($('remindAskOverlay'));
  syncReminders();
}

function dismissAsk() {
  saveReminderSettings({ ...loadReminderSettings(), asked: true });
  closeOverlay($('remindAskOverlay'));
}

/** Call after the user adds an entry. */
export function afterEntryAdded() {
  syncReminders();
  if (native && !loadReminderSettings().asked) openAsk();
}

/* Settings popup */
async function renderSettings() {
  const settings = loadReminderSettings();
  const display = await permission();
  const blocked = display === 'denied' || display === 'unavailable';

  $('remindNote').textContent = display === 'unavailable'
    ? 'Reminders work in the nu. iPhone app.'
    : 'Notifications are off for nu.';
  $('remindOpenSettings').hidden = display !== 'denied';
  $('remindBlocked').hidden = !blocked;

  const on = settings.enabled && !blocked;
  setSwitch($('remindEnabled'), on);
  $('remindBody').classList.toggle('rm-disabled', !on);

  const custom = usesCustomTimes(settings);
  $('remindModes').querySelectorAll('.rm-option').forEach(btn => {
    btn.setAttribute('aria-checked', (btn.dataset.mode === 'custom') === custom ? 'true' : 'false');
  });
  lockCustomButton($('remindModes').querySelector('[data-mode="custom"]'), 'My times');

  $('remindTimes').hidden = !custom;
  if (custom) renderTimeChips($('remindTimes'), $('remindAddChip'), settings.times, { onChange: updateTimes });

  const skip = 'Skipped if you logged something in the last 2 hours. Reply right from the notification to log without opening nu.';
  $('remindHint').textContent = custom
    ? `Up to 3 a day. ${skip}`
    : `Twice a day at random moments between ${formatTime(toHHMM(RANDOM_START))} and ${formatTime(toHHMM(RANDOM_END))}. ${skip}`;
}

function chooseMode(mode) {
  if (mode === 'custom' && !deps.isPremium()) { deps.openPaywall(); return; }
  saveReminderSettings({ ...loadReminderSettings(), mode });
  renderSettings();
  syncReminders();
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
  const times = takeAddedTime($('remindAddTime'), loadReminderSettings().times);
  if (times) updateTimes(times);
}

function commitAskAddedTime() {
  const times = takeAddedTime($('remindAskAddTime'), customTimes);
  if (times) { customTimes = times; renderAskTimes(); }
}

export function openReminderSettings() {
  renderSettings();
  openOverlay($('remindOverlay'));
}

/** Premium status changed (RevenueCat result, purchase or restore): redraw the locks, reschedule. */
export function refreshReminderPremium() {
  if (!deps) return;
  lockCustomButton($('remindAskCustom'), 'Pick my own times');
  if ($('remindOverlay').classList.contains('visible')) renderSettings();
  syncReminders();
}

/** Right after buying from the reminders paywall: back to where the user was, with the time chips open. */
export function openCustomReminderTimes() {
  refreshReminderPremium();
  if ($('remindAskOverlay').classList.contains('visible')) {
    showAskCustom(true);
  } else {
    saveReminderSettings({ ...loadReminderSettings(), mode: 'custom' });
    openReminderSettings();
    syncReminders();
  }
}

export function initReminders(options) {
  deps = options;
  if (native) NuReminders.getTimeFormat().then(r => { hour12 = r.hour12; }).catch(() => {});

  $('remindAskCustom').addEventListener('click', toggleAskCustom);
  $('remindAskOn').addEventListener('click', turnOnFromAsk);
  $('remindAskLater').addEventListener('click', dismissAsk);
  $('remindAskAddTime').addEventListener('blur', commitAskAddedTime);

  const overlay = $('remindOverlay');
  $('remindBtn').addEventListener('click', openReminderSettings);
  $('remindEnabled').addEventListener('click', toggleEnabled);
  $('remindModes').querySelectorAll('.rm-option').forEach(btn => btn.addEventListener('click', () => chooseMode(btn.dataset.mode)));
  $('remindOpenSettings').addEventListener('click', () => NuReminders.openSettings());
  $('remindClose').addEventListener('click', () => closeOverlay(overlay));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(overlay); });
  // iOS commits the time wheel on "Done", which blurs the field
  $('remindAddTime').addEventListener('blur', commitAddedTime);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    syncReminders();
    // Back from iOS Settings: show the new permission state
    if (overlay.classList.contains('visible')) renderSettings();
  });
  syncReminders();
}
