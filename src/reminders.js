import { Capacitor, registerPlugin } from '@capacitor/core';
import { isDeletedReply } from './deletedReplies.js';
import { noteJournalChanged } from './journalMirror.js';
import { lang, isKo, t, formatWeekday } from './i18n.js';

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
// When "Not today" is undone, random check-ins for the rest of that day are drawn from now
// until RANDOM_END; with less than this left, they start again tomorrow.
const RESUME_KEY = 'nu_reminders_resumed';   // { day: "YYYY-MM-DD", at: ms }
const RESUME_MIN_WINDOW = 60;                // minutes
const RESUME_LEAD = 15;                      // minutes: no check-in right on top of tapping Resume

// Check-in lines (notification body only), picked by the local time the reminder fires.
// Same pool for random (free) and custom (Premium) times. One pool per language, picked by the
// device language; the same index means the same line in both.
const LINES_EN = {
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
const LINES_KO = {
  morning: [
    '좋은 아침! 첫 번째 작은 할 일은 뭐예요?',
    '방금 뭐 끝냈어요? 한 줄이면 충분해요.',
    '커피 한 잔 들었어요? 다음 할 일 적어봐요.',
    '지금 뭐 하고 있어요?',
  ],
  afternoon: [
    '잠깐, 다음엔 뭐 할 거예요?',
    '어디까지 했어요? 적어두고 다시 하던 거 해요.',
    '흐름 놓쳤어요? 한 줄이면 다시 돌아와요.',
    '점심, 회의, 쇼츠… 방금 뭐 했어요?',
    '오후 체크인: 방금 무슨 일 있었어요?',
  ],
  evening: [
    "뭐라도 했어요? '물 마심'도 기록이에요.",
    '마무리 중이에요? 방금 끝낸 일 한 줄만요.',
    '잠깐 체크인: 지금 뭐 하는 중이에요?',
    '짧게 하나만: 지금 손에 잡은 일은?',
  ],
};
// December only, at most one per day, mixed into that time's lines
const DECEMBER_EN = [
  'Gift hunting? Log what you just did 🎁',
  'Brain frozen? ❄️ Just write what you did last.',
  "Cozy check: what's next, tiny step only 🎄",
];
const DECEMBER_KO = [
  '선물 고르는 중? 방금 한 일 적어봐요 🎁',
  '머리가 안 돌아가요? ❄️ 마지막에 한 거 하나만 적어봐요.',
  '포근하게 한 줄: 다음 할 일 하나만 🎄',
];
export const CHECKIN_LINES = lang === 'ko' ? LINES_KO : LINES_EN;
export const DECEMBER_LINES = lang === 'ko' ? DECEMBER_KO : DECEMBER_EN;
// Lines already sent may be in the other language (the iPhone's language changed since)
const isDecemberLine = body => DECEMBER_EN.includes(body) || DECEMBER_KO.includes(body);
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

/** "15:00" → "3 PM" ("오후 3시") or "15:00", following the device's 12/24-hour setting. */
export function formatTime(hhmm, useHour12 = deviceUsesHour12()) {
  const [h, m] = hhmm.split(':').map(Number);
  if (!useHour12) return `${pad(h)}:${pad(m)}`;
  const hour = h % 12 || 12;
  if (isKo) return `${h < 12 ? '오전' : '오후'} ${m ? `${hour}:${pad(m)}` : `${hour}시`}`;
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
  noteJournalChanged();
}

/**
 * Reminder settings were just restored from the native copy. If they were on but iOS no longer
 * allows notifications, they stay off (the 🔔 screen then shows the iOS state, e.g. "Enable in
 * Settings"); otherwise they are rescheduled. Mode and times are kept either way.
 */
export async function adoptRestoredReminders() {
  const settings = loadReminderSettings();
  if (settings.enabled && (await permission()) !== 'granted') {
    saveReminderSettings({ ...settings, enabled: false });
  }
  await syncReminders();
  if ($('remindOverlay').classList.contains('visible')) renderSettings();
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
 * Random times for the rest of a day on which "Not today" was undone at `resumedAt` (ms):
 * drawn between 15 minutes later and 20:00. Two (3 hours apart) if there is room, else one;
 * none if less than an hour is left. Seeded by the resume moment, so rescheduling keeps the same times.
 */
export function resumedRandomTimes(resumedAt, seed) {
  const at = new Date(resumedAt);
  const nowMin = at.getHours() * 60 + at.getMinutes();
  if (RANDOM_END - Math.max(RANDOM_START, nowMin) < RESUME_MIN_WINDOW) return [];
  const start = Math.max(RANDOM_START, nowMin + RESUME_LEAD);
  const window = RANDOM_END - start;
  const rand = seededRandom(hashString(`${seed}:resume:${resumedAt}`));
  if (window < RANDOM_MIN_GAP) return [toHHMM(start + Math.floor(rand() * (window + 1)))];
  const span = window - RANDOM_MIN_GAP;
  const [a, b] = [Math.floor(rand() * (span + 1)), Math.floor(rand() * (span + 1))].sort((x, y) => x - y);
  return [toHHMM(start + a), toHHMM(start + b + RANDOM_MIN_GAP)];
}

function loadResumed() {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY)) || null; } catch { return null; }
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
  const decemberDays = new Set(sent.filter(r => isDecemberLine(r.body)).map(r => dayString(new Date(r.at))));
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

let deps = null;     // { dayKey, loadEntriesForKey, onTodayChanged, syncBodyScrollLock, isPremium, openPaywall, tap }
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
  noteJournalChanged();
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
  const resumed = loadResumed();
  const timesFor = custom ? () => settings.times
    : day => (resumed && resumed.day === dayString(day) ? resumedRandomTimes(resumed.at, seed) : randomTimesFor(day, seed));
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

/** "Today at 4 PM", "Tomorrow at 11:00", "Thursday at 9:30 AM" (Korean: "오늘 오후 4시", "목요일 오전 9:30") */
function formatNext(at, now = new Date()) {
  const when = new Date(at);
  const days = Math.round((new Date(when.getFullYear(), when.getMonth(), when.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const time = formatTime(`${pad(when.getHours())}:${pad(when.getMinutes())}`);
  if (days === 0) return t('rm.today', time);
  if (days === 1) return t('rm.tomorrow', time);
  return t('rm.weekday', formatWeekday(when), time);
}

const pausedToday = () => !!skipDay && skipDay === dayString(new Date());

/**
 * Undo "Not today": from the Resume button, or when the user changes reminder settings
 * (adding a time, switching mode, turning reminders on), which says they want check-ins today.
 * Call inside enqueue() so it runs in order with syncing.
 */
async function resumeToday() {
  if (!pausedToday()) return;
  await NuReminders.clearSkipDay();
  skipDay = null;
  localStorage.setItem(RESUME_KEY, JSON.stringify({ day: dayString(new Date()), at: Date.now() }));
}

/** Settings: "Paused for today · Resume" while paused, and "Next reminder: Today at 4 PM" while really on. */
async function refreshNext() {
  if (!deps) return;
  const el = $('remindNext');
  const on = loadReminderSettings().enabled && (await permission()) === 'granted';
  $('remindPaused').hidden = !(on && pausedToday());
  const at = on ? nextReminderAt() : null;
  el.hidden = !at;
  if (at) el.textContent = t('rm.next', formatNext(at));
}

/** Header bell: filled while reminders are really on (switched on and allowed by iOS). */
async function refreshBell() {
  const on = loadReminderSettings().enabled && (await permission()) === 'granted';
  $('remindBtn').classList.toggle('is-on', on);
  $('remindBtn').setAttribute('aria-label', t(on ? 'header.remindersOn' : 'header.remindersOff'));
}

/**
 * Pull in notification replies, then rebuild the upcoming check-ins.
 * `resume`: the user just changed reminder settings, so "Not today" is undone first.
 */
export function syncReminders({ resume = false } = {}) {
  if (!native) return chain;
  return enqueue(async () => {
    await mergePendingReplies();
    if (resume) await resumeToday();
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
    chip.setAttribute('aria-label', removable ? t('rm.remove', format(time)) : format(time));
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
  btn.setAttribute('aria-label', locked ? t('rm.lockedAria', label) : label);
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

  $('remindNote').textContent = t(display === 'unavailable' ? 'rm.unavailable' : 'rm.denied');
  $('remindOpenSettings').hidden = display !== 'denied';
  $('remindBlocked').hidden = !blocked;

  const on = settings.enabled && !blocked;
  setSwitch($('remindEnabled'), on);
  $('remindBody').classList.toggle('rm-disabled', !on);

  const custom = usesCustomTimes(settings);
  $('remindModes').querySelectorAll('.rm-option').forEach(btn => {
    btn.setAttribute('aria-checked', (btn.dataset.mode === 'custom') === custom ? 'true' : 'false');
  });
  lockCustomButton($('remindModes').querySelector('[data-mode="custom"]'), t('rm.custom'));

  $('remindTimes').hidden = !custom;
  if (custom) renderTimeChips($('remindTimes'), $('remindAddChip'), settings.times, { format: t => formatTime(t), onChange: updateTimes });

  // First line: the random window, or (At my times) the chips above take its place
  $('remindHintWhen').hidden = custom;
  $('remindHintWhen').textContent = t('rm.window', formatTime(toHHMM(RANDOM_START)), formatTime(toHHMM(RANDOM_END)));
  $('remindHintSkip').hidden = custom; // picked times always fire
  refreshBell();
  refreshNext();
}

function chooseMode(mode) {
  if (mode === 'custom' && !deps.isPremium()) { deps.openPaywall(); return; }
  const changed = loadReminderSettings().mode !== mode;
  saveReminderSettings({ ...loadReminderSettings(), mode });
  renderSettings();
  syncReminders({ resume: changed });
}

function updateTimes(times) {
  const added = times.length > loadReminderSettings().times.length;
  saveReminderSettings({ ...loadReminderSettings(), times });
  renderSettings();
  syncReminders({ resume: added });
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
  syncReminders({ resume: enabled });
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
  $('remindResume').addEventListener('click', () => { deps.tap(); syncReminders({ resume: true }); });
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
