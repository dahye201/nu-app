import { Capacitor, registerPlugin } from '@capacitor/core';
import { isDeletedReply } from './deletedReplies.js';

// Native side: ios/App/App/NuReminders.swift
const NuReminders = registerPlugin('NuReminders');
const native = Capacitor.isNativePlatform();

const SETTINGS_KEY = 'nu_reminders';
const MAX_TIMES = 3;
const SCHEDULE_DAYS = 7;
// Random check-ins are skipped within an hour after an entry (the user is already on track).
// Times the user picked always fire: they are anchors, and skipping them silently feels broken.
const SKIP_AFTER_ENTRY_MS = 60 * 60 * 1000;

// Free: two random check-ins a day. Premium: up to MAX_TIMES fixed times of the user's choosing.
const DEFAULT_CUSTOM_TIMES = ['11:00', '16:00'];
const RANDOM_START = 10 * 60;   // minutes after midnight
const RANDOM_END = 20 * 60;
const RANDOM_MIN_GAP = 3 * 60;
const SEED_KEY = 'nu_reminders_seed';

// Check-in lines (notification body only), picked by the local time the reminder fires.
// Same pool for random (free) and custom (Premium) times.
export const CHECKIN_LINES = {
  morning: [ // before 12:00
    "Morning check: what's the first tiny step?",
    'What did you just finish? One line is enough.',
    "Coffee in hand? Jot what's next.",
    'What are you on right now?',
  ],
  afternoon: [ // 12:00–16:59
    "Tiny step check: what's next?",
    'Where are you at? Jot it down, then back to it.',
    'Lost the thread? One line brings it back.',
    'Lunch, meetings, tabs… what did you just do?',
    'Afternoon check: what just happened?',
  ],
  evening: [ // 17:00 and later
    'Done anything? Even "made coffee" counts.',
    'Wrapping up? One line for what you just finished.',
    'Quick check-in: what are you on?',
    'Quick one: what are you doing right now?',
  ],
};
// December only, at most one per day, mixed into that time's lines
export const DECEMBER_LINES = [
  'Gift hunting? Log what you just did 🎁',
  'Brain frozen? ❄️ Just write what you did last.',
  "Cozy check: what's next, tiny step only 🎄",
];
const RECENT_LIMIT = 5; // never reuse any of the last 5 lines
const ALL_LINES = [...CHECKIN_LINES.morning, ...CHECKIN_LINES.afternoon, ...CHECKIN_LINES.evening];

const slotFor = hour => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');

/**
 * Line for a reminder at `at` (ms). `recent` holds the latest lines, oldest first; none of the
 * last RECENT_LIMIT is reused. December lines join that time's lines unless one was already used
 * that day. If the time's lines are all used up, any unused line from the whole pool is taken.
 * Seeded by the reminder time, so rescheduling gives the same line.
 */
export function pickLine({ at, recent = [], decemberUsedToday = false, seed = '' }) {
  const when = new Date(at);
  const blocked = new Set(recent.slice(-RECENT_LIMIT));
  const december = when.getMonth() === 11 && !decemberUsedToday ? DECEMBER_LINES : [];
  const fresh = list => list.filter(line => !blocked.has(line));
  let options = fresh([...CHECKIN_LINES[slotFor(when.getHours())], ...december]);
  if (!options.length) options = fresh([...ALL_LINES, ...december]);
  if (!options.length) options = ALL_LINES; // unreachable with 13+ lines, but never send nothing
  const rand = seededRandom(hashString(`${seed}:line:${at}`));
  return options[Math.floor(rand() * options.length)];
}

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
 * and anything within an hour after the latest entry (`lastEntryAt`, ms; pass 0 to never skip).
 * `sent` is the lines already delivered ({ at, body }), so the first new ones don't repeat them.
 */
export function buildSchedule({ now, times = [], timesFor = () => times, lastEntryAt = 0, skipDay = null, days = SCHEDULE_DAYS, sent = [], seed = '' }) {
  const out = [];
  const recent = [...sent].sort((a, b) => a.at - b.at).map(r => r.body);
  const decemberDays = new Set(sent.filter(r => DECEMBER_LINES.includes(r.body)).map(r => dayString(new Date(r.at))));
  for (let d = 0; d < days; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    if (dayString(day) === skipDay) continue;
    [...new Set(timesFor(day))].sort().forEach(time => {
      const [h, m] = time.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
      if (at <= now.getTime()) return;
      if (lastEntryAt && at > lastEntryAt && at - lastEntryAt < SKIP_AFTER_ENTRY_MS) return;
      const body = pickLine({ at, recent, decemberUsedToday: decemberDays.has(dayString(day)), seed });
      recent.push(body);
      if (DECEMBER_LINES.includes(body)) decemberDays.add(dayString(day));
      out.push({ at, body });
    });
  }
  return out;
}

// What was scheduled, so lines that have already gone out count as "recent" next time
const SENT_KEY = 'nu_reminders_sent';

function loadSent(now) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(SENT_KEY)) || []; } catch { list = []; }
  return list.filter(r => r.at <= now).sort((a, b) => a.at - b.at).slice(-RECENT_LIMIT);
}

function saveScheduled(sent, upcoming) {
  try { localStorage.setItem(SENT_KEY, JSON.stringify([...sent, ...upcoming])); } catch {}
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
    if (isDeletedReply(reply.id)) continue; // the user deleted this reply's entry
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
  const custom = usesCustomTimes(settings);
  const timesFor = custom ? () => settings.times : day => randomTimesFor(day, seed);
  const now = new Date();
  const sent = loadSent(now.getTime());
  const reminders = buildSchedule({ now, timesFor, lastEntryAt: custom ? 0 : lastEntryAt, skipDay, sent, seed });
  await NuReminders.schedule({ reminders });
  saveScheduled(sent, reminders);
}

/** The next check-in that is scheduled, in ms, or null. */
function nextReminderAt(now = Date.now()) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(SENT_KEY)) || []; } catch { list = []; }
  const upcoming = list.map(r => r.at).filter(at => at > now).sort((a, b) => a - b);
  return upcoming.length ? upcoming[0] : null;
}

/** "Today at 4 PM", "Tomorrow at 11:00", "Thursday at 9:30 AM" */
function formatNext(at, now = new Date()) {
  const when = new Date(at);
  const days = Math.round((new Date(when.getFullYear(), when.getMonth(), when.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : when.toLocaleDateString('en-US', { weekday: 'long' });
  return `${day} at ${formatTime(`${pad(when.getHours())}:${pad(when.getMinutes())}`)}`;
}

/** Settings: "Next reminder: Today at 4 PM", while reminders are really on. */
async function refreshNext() {
  const el = $('remindNext');
  const on = loadReminderSettings().enabled && (await permission()) === 'granted';
  const at = on ? nextReminderAt() : null;
  el.hidden = !at;
  if (at) el.textContent = `Next reminder: ${formatNext(at)}`;
}

/** Header bell: filled while reminders are really on (switched on and allowed by iOS). */
async function refreshBell() {
  const on = loadReminderSettings().enabled && (await permission()) === 'granted';
  $('remindBtn').classList.toggle('is-on', on);
  $('remindBtn').setAttribute('aria-label', on ? 'Reminders, on' : 'Reminders, off');
}

/** Pull in notification replies, then rebuild the upcoming check-ins. */
export function syncReminders() {
  if (!native) return chain;
  return enqueue(async () => {
    await mergePendingReplies();
    await reschedule();
    await refreshBell();
    await refreshNext();
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

/* Opt-in, shown once after the first entry. Explains the benefit before iOS asks for permission. */
function openAsk() {
  openOverlay($('remindAskOverlay'));
}

// "Set up reminders": only now does iOS ask. The current mode (random unless Premium chose
// custom times) is kept; reminders switch on only if iOS grants permission.
async function turnOnFromAsk() {
  saveReminderSettings({ ...loadReminderSettings(), asked: true, enabled: false });
  const display = await askPermission();
  if (display === 'granted') saveReminderSettings({ ...loadReminderSettings(), enabled: true });
  closeOverlay($('remindAskOverlay'));
  syncReminders();
}

// "Not now": never shown again; reminders stay available from the bell
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
  lockCustomButton($('remindModes').querySelector('[data-mode="custom"]'), 'At my times');

  $('remindTimes').hidden = !custom;
  if (custom) renderTimeChips($('remindTimes'), $('remindAddChip'), settings.times, { format: t => formatTime(t), onChange: updateTimes });

  // First line: the random window, or (At my times) the chips above take its place
  $('remindHintWhen').hidden = custom;
  $('remindHintWhen').textContent = `Twice a day, between ${formatTime(toHHMM(RANDOM_START))} and ${formatTime(toHHMM(RANDOM_END))}.`;
  $('remindHintSkip').hidden = custom; // picked times always fire
  refreshBell();
  refreshNext();
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

export function openReminderSettings() {
  renderSettings();
  openOverlay($('remindOverlay'));
}

/** Premium status changed (RevenueCat result, purchase or restore): redraw the locks, reschedule. */
export function refreshReminderPremium() {
  if (!deps) return;
  if ($('remindOverlay').classList.contains('visible')) renderSettings();
  syncReminders();
}

/** Right after buying from the reminders paywall: back to Reminders, on Custom times, ready to add times. */
export function openCustomReminderTimes() {
  saveReminderSettings({ ...loadReminderSettings(), mode: 'custom' });
  refreshReminderPremium();
  openReminderSettings();
}

export function initReminders(options) {
  deps = options;
  if (native) NuReminders.getTimeFormat().then(r => { hour12 = r.hour12; }).catch(() => {});
  refreshBell();

  $('remindAskOn').addEventListener('click', turnOnFromAsk);
  $('remindAskLater').addEventListener('click', dismissAsk);

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
