import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { noteJournalChanged } from './journalMirror.js';
import { t } from './i18n.js';

const LAST_EXPORT_KEY = 'nu_last_export';

function rememberExport(date) {
  localStorage.setItem(LAST_EXPORT_KEY, date.toISOString());
  noteJournalChanged();
}

// Backup file: { app: "nu.", format: 1, exportedAt, days: { "YYYY-MM-DD": [entry, …] } }
const FORMAT = 1;
const DAY_KEY = /^ij_(\d{4})_(\d{1,2})_(\d{1,2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^\d{2}:\d{2}$/;
const MAX_TEXT = 10000;

const pad = n => String(n).padStart(2, '0');
const storageKeyFor = date => {
  const [, y, m, d] = date.match(DATE);
  return `ij_${Number(y)}_${Number(m)}_${Number(d)}`;
};

/** Same entry on both sides: notification replies by their native id, the rest by id + text. */
const entryKey = e => (e.pid ? `pid:${e.pid}` : `${e.id}|${e.text}`);

/** Every day with entries in `storage`, as { "YYYY-MM-DD": entries }. */
export function collectDays(storage) {
  const days = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const match = key && key.match(DAY_KEY);
    if (!match) continue;
    let entries;
    try { entries = JSON.parse(storage.getItem(key)); } catch { continue; }
    if (!Array.isArray(entries) || !entries.length) continue;
    days[`${match[1]}-${pad(match[2])}-${pad(match[3])}`] = entries;
  }
  return days;
}

export function buildBackup(storage, now = new Date()) {
  return { app: 'nu.', format: FORMAT, exportedAt: now.toISOString(), days: collectDays(storage) };
}

/** A cleaned-up entry, or null if it can't be one of ours. */
function cleanEntry(raw, date) {
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > MAX_TEXT) return null;
  if (typeof raw.time !== 'string' || !TIME.test(raw.time)) return null;
  let id = Number(raw.id);
  if (!Number.isFinite(id)) {
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = raw.time.split(':').map(Number);
    id = new Date(y, m - 1, d, h, min).getTime();
  }
  const entry = { text: raw.text, emoji: typeof raw.emoji === 'string' && raw.emoji.length <= 16 ? raw.emoji : null, time: raw.time, id };
  if (typeof raw.pid === 'string') entry.pid = raw.pid;
  return entry;
}

/**
 * Reads a backup file's text. Throws an Error with a user-facing message if it isn't one.
 * Returns { days: { date: entries }, invalid } where `invalid` counts entries that were skipped.
 */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(t('backup.notBackup')); }
  if (!data || data.app !== 'nu.' || typeof data.days !== 'object' || data.days === null) {
    throw new Error(t('backup.notBackup'));
  }
  if (data.format > FORMAT) throw new Error(t('backup.newer'));

  const days = {};
  let invalid = 0;
  for (const [date, list] of Object.entries(data.days)) {
    if (!DATE.test(date) || !Array.isArray(list)) { invalid += Array.isArray(list) ? list.length : 1; continue; }
    const entries = [];
    for (const raw of list) {
      const entry = cleanEntry(raw, date);
      if (entry) entries.push(entry); else invalid++;
    }
    if (entries.length) days[date] = entries;
  }
  return { days, invalid };
}

/** What importing `days` would do: entries not on this phone yet, per storage key. */
export function planImport(days, storage) {
  const additions = {};
  let added = 0, existing = 0;
  for (const [date, entries] of Object.entries(days)) {
    const key = storageKeyFor(date);
    let current = [];
    try { current = JSON.parse(storage.getItem(key)) || []; } catch { current = []; }
    const seen = new Set(current.map(entryKey));
    const fresh = [];
    for (const entry of entries) {
      if (seen.has(entryKey(entry))) { existing++; continue; }
      seen.add(entryKey(entry));
      fresh.push(entry);
    }
    if (fresh.length) { additions[key] = fresh; added += fresh.length; }
  }
  return { additions, added, existing, days: Object.keys(additions).length };
}

/** Adds the planned entries. Never removes or changes an entry already on this phone. */
export function applyImport(plan, storage) {
  for (const [key, fresh] of Object.entries(plan.additions)) {
    let current = [];
    try { current = JSON.parse(storage.getItem(key)) || []; } catch { current = []; }
    const seen = new Set(current.map(entryKey));
    const merged = current.concat(fresh.filter(e => !seen.has(entryKey(e))));
    merged.sort((a, b) => a.id - b.id);
    storage.setItem(key, JSON.stringify(merged));
  }
}

/* ── UI ── */
const $ = id => document.getElementById(id);
let deps = null;      // { syncBodyScrollLock, onEntriesChanged, tap }
let pendingPlan = null;

function showStep(step) {
  ['backupMain', 'backupConfirm', 'backupDone'].forEach(id => { $(id).hidden = id !== step; });
}

function countEntries(days) {
  return Object.values(days).reduce((n, list) => n + list.length, 0);
}


function renderMain() {
  const days = collectDays(localStorage);
  const total = countEntries(days);
  $('backupSummary').textContent = total
    ? t('backup.summary', total, Object.keys(days).length)
    : t('backup.empty');
  $('backupExport').disabled = !total;
  showStep('backupMain');
}

function openBackup() {
  renderMain();
  $('backupOverlay').classList.add('visible');
  deps.syncBodyScrollLock();
}

function closeBackup() {
  $('backupOverlay').classList.remove('visible');
  pendingPlan = null;
  deps.syncBodyScrollLock();
}

function showDone(title, message) {
  $('backupDoneTitle').textContent = title;
  $('backupDoneText').textContent = message;
  showStep('backupDone');
}

async function exportBackup() {
  const backup = buildBackup(localStorage);
  const json = JSON.stringify(backup, null, 2);
  const now = new Date();
  const filename = `nu-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  deps.tap();

  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ files: [uri], dialogTitle: t('backup.shareTitle') });
      rememberExport(now);
    } catch {
      // Share sheet dismissed: nothing to do
    }
    return;
  }

  // Browser: plain download
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  rememberExport(now);
}

async function pickedFile(event) {
  const field = event.target;
  const file = field.files && field.files[0];
  field.value = '';
  if (!file) return;

  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (err) {
    showDone(t('backup.importFailed'), err.message);
    return;
  }

  const plan = planImport(parsed.days, localStorage);
  if (!plan.added) {
    showDone(t('backup.nothingNew'), plan.existing
      ? t('backup.allThere')
      : t('backup.noEntries'));
    return;
  }

  pendingPlan = plan;
  $('backupConfirmTitle').textContent = t('backup.confirm', plan.added);
  const notes = [t('backup.fromDays', plan.days)];
  if (plan.existing) notes.push(t('backup.existing', plan.existing));
  if (parsed.invalid) notes.push(t('backup.invalid', parsed.invalid));
  notes.push(t('backup.safe'));
  $('backupConfirmText').textContent = notes.join(' ');
  showStep('backupConfirm');
}

function confirmImport() {
  if (!pendingPlan) return;
  applyImport(pendingPlan, localStorage);
  const added = pendingPlan.added;
  pendingPlan = null;
  deps.tap();
  deps.onEntriesChanged();
  showDone(t('backup.imported'), t('backup.added', added));
}

export function initBackup(options) {
  deps = options;
  const overlay = $('backupOverlay');
  $('backupBtn').addEventListener('click', openBackup);
  $('backupExport').addEventListener('click', () => exportBackup().catch(() => showDone(t('backup.exportFailed'), t('backup.tryAgain'))));
  $('backupFile').addEventListener('change', pickedFile);
  $('backupImportConfirm').addEventListener('click', confirmImport);
  $('backupImportCancel').addEventListener('click', renderMain);
  $('backupDoneBtn').addEventListener('click', closeBackup);
  $('backupClose').addEventListener('click', closeBackup);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeBackup(); });
}
