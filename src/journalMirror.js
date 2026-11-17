// Keeps a native copy of the journal (ios/App/App/NuReminders.swift, NuJournalPlugin) in
// Application Support, which is in the iPhone's backups. The web view's localStorage normally is
// too, but WebKit may clear it, so it is not the only copy.
//
// - After every change, all days (`ij_YYYY_M_D`), deleted-reply notes and the settings below are
//   written to the file.
// - On launch, only if localStorage had no days at all, the file is read back: missing entries are
//   added, and a setting is restored only if it was not in localStorage at launch.
// - Nothing is written until that launch check is done, so an emptied localStorage can never
//   overwrite the good copy.
import { Capacitor, registerPlugin } from '@capacitor/core';

const NuJournal = registerPlugin('NuJournal');
const native = Capacitor.isNativePlatform();

const DAY_KEY = /^ij_\d{4}_\d{1,2}_\d{1,2}$/;
const DELETED_KEY = 'nu_deleted_pids';
// Settings kept with the journal, stored as their raw localStorage strings
export const SETTINGS_KEYS = [
  'nu_reminders',   // on/off, mode, custom times, whether the opt-in sheet was shown
  'ij_theme',       // theme
  'ij_theme_prev',  // regular theme to return to after the Christmas look
  'ij_xmas_off',    // Christmas look switched off ('default' | 'theme')
  'nu_last_export', // last backup export (ISO date)
];
const FORMAT = 1;
const DEBOUNCE_MS = 400;

let ready = false;
let timer = null;

function dayKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && DAY_KEY.test(key)) keys.push(key);
  }
  return keys;
}

function snapshot() {
  const days = {};
  for (const key of dayKeys()) {
    try {
      const list = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(list) && list.length) days[key] = list;
    } catch { /* skip an unreadable day */ }
  }
  let deleted = [];
  try { deleted = JSON.parse(localStorage.getItem(DELETED_KEY)) || []; } catch { deleted = []; }
  const settings = {};
  for (const key of SETTINGS_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) settings[key] = value;
  }
  return { format: FORMAT, savedAt: Date.now(), days, deleted, settings };
}

// What localStorage held when the app started, before boot code writes defaults (e.g. the theme).
// This module is imported before app.js runs, so this is the true launch state.
const hasStorage = (() => { try { return typeof localStorage !== 'undefined' && !!localStorage; } catch { return false; } })();
const launchHadDays = hasStorage && dayKeys().length > 0;
const missingAtLaunch = new Set(hasStorage ? SETTINGS_KEYS.filter(key => localStorage.getItem(key) === null) : []);

async function writeNow() {
  clearTimeout(timer);
  timer = null;
  if (!native || !ready) return;
  try {
    await NuJournal.save({ data: JSON.stringify(snapshot()) });
  } catch (err) {
    console.error('journal copy:', err);
  }
}

/** Call after entries change. Batched, so a burst of changes is one write. */
export function noteJournalChanged() {
  if (!native || !ready) return;
  clearTimeout(timer);
  timer = setTimeout(writeNow, DEBOUNCE_MS);
}

/** Merge `saved` into localStorage: entries missing here are added, nothing here is changed. */
function mergeIn(saved) {
  let added = 0;
  for (const [key, list] of Object.entries(saved.days || {})) {
    if (!DAY_KEY.test(key) || !Array.isArray(list)) continue;
    let current = [];
    try { current = JSON.parse(localStorage.getItem(key)) || []; } catch { current = []; }
    const seen = new Set(current.map(e => e.id));
    const fresh = list.filter(e => e && typeof e.text === 'string' && !seen.has(e.id));
    if (!fresh.length) continue;
    const merged = current.concat(fresh).sort((a, b) => a.id - b.id);
    localStorage.setItem(key, JSON.stringify(merged));
    added += fresh.length;
  }
  if (Array.isArray(saved.deleted) && saved.deleted.length && !localStorage.getItem(DELETED_KEY)) {
    localStorage.setItem(DELETED_KEY, JSON.stringify(saved.deleted));
  }
  return added;
}

/** Settings from `saved` that were missing at launch. Values the user had are never replaced. */
function restoreSettings(saved) {
  const restored = [];
  for (const key of SETTINGS_KEYS) {
    const value = saved.settings && saved.settings[key];
    if (typeof value !== 'string' || !missingAtLaunch.has(key)) continue;
    localStorage.setItem(key, value);
    restored.push(key);
  }
  return restored;
}

/**
 * Launch check. If localStorage had no days at launch, restore from the native copy.
 * Resolves to { entries: number restored, settings: keys restored }. Afterwards, changes are mirrored.
 * `beforeMirror(result)` runs before the first write, so restored settings can be adjusted first.
 */
export async function restoreJournalIfEmpty({ beforeMirror = async () => {} } = {}) {
  const result = { entries: 0, settings: [] };
  if (!native) return result;
  try {
    if (!launchHadDays) {
      const { data } = await NuJournal.load();
      if (data) {
        const saved = JSON.parse(data);
        result.entries = mergeIn(saved);
        result.settings = restoreSettings(saved);
      }
    }
    await beforeMirror(result);
  } catch (err) {
    console.error('journal restore:', err);
  }
  ready = true;
  await writeNow(); // existing users get their first copy right away
  return result;
}

if (native) {
  // Last chance before iOS may suspend or end the app: write a pending change now.
  // (Only a pending one: every change goes through noteJournalChanged.)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && timer) writeNow();
  });
}
