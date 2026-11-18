// Edit (tap) and delete (swipe left, with Undo) for log entries, in today's list and in History.
// Timestamps are never edited: an entry keeps its `time`, `id` and `pid`; only text and mood change.
import { rememberDeletedReply, forgetDeletedReply } from './deletedReplies.js';
import { t } from './i18n.js';
import { noteJournalChanged } from './journalMirror.js';

const ACTION_W = 88;          // width of the red "Delete" action
const GAP = 16;               // space between the entry (mood emoji) and the action
const REVEAL = ACTION_W + GAP;
const FULL_SWIPE = 0.6;       // past this share of the row width, a swipe deletes directly
const TOAST_MS = 5000;

let deps = null;              // { loadEntriesForKey, onChanged(key), emojiChoices(), tap() }
let editing = null;           // { row, key, id, original: { text, emoji }, emoji }
let revealed = null;          // row whose Delete action is showing
let toastTimer = null;

/* ── Storage ── */
function saveList(key, list) {
  if (list.length) localStorage.setItem(key, JSON.stringify(list));
  else localStorage.removeItem(key);
  noteJournalChanged();
}

function updateEntry(key, id, changes) {
  const list = deps.loadEntriesForKey(key);
  const entry = list.find(e => e.id === id);
  if (!entry) return;
  Object.assign(entry, changes);
  saveList(key, list);
  deps.onChanged(key);
}

function deleteEntry(key, id) {
  const list = deps.loadEntriesForKey(key);
  const index = list.findIndex(e => e.id === id);
  if (index < 0) return;
  const [removed] = list.splice(index, 1);
  saveList(key, list);
  rememberDeletedReply(removed.pid);
  deps.onChanged(key);
  showUndoToast(key, removed);
}

function restoreEntry(key, entry) {
  const list = deps.loadEntriesForKey(key);
  if (!list.some(e => e.id === entry.id)) {
    list.push(entry);
    list.sort((a, b) => a.id - b.id); // back in its original place, by its original timestamp
  }
  saveList(key, list);
  forgetDeletedReply(entry.pid);
  deps.onChanged(key);
}

/* ── Undo toast ── */
function showUndoToast(key, entry) {
  const toast = document.getElementById('entryToast');
  clearTimeout(toastTimer);
  toast.classList.add('visible');
  toast.querySelector('button').onclick = () => {
    hideToast();
    restoreEntry(key, entry);
    deps.tap();
  };
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById('entryToast').classList.remove('visible');
}

/* ── Swipe to delete ── */
function setOffset(row, x, animate) {
  const slide = row.querySelector('.log-entry');
  const action = row.querySelector('.log-delete');
  slide.style.transition = action.style.transition = animate ? 'transform 0.2s ease, width 0.2s ease' : 'none';
  slide.style.transform = x ? `translateX(${x}px)` : '';
  action.style.width = `${Math.max(0, -x - GAP)}px`;
  row.classList.toggle('swiping', x !== 0);
}

function closeRevealed() {
  if (revealed) setOffset(revealed, 0, true);
  revealed = null;
}

function attachSwipe(row) {
  const slide = row.querySelector('.log-entry');
  let start = null;   // { x, y, base, width }
  let mode = null;    // null (undecided) | 'swipe' | 'scroll'
  let x = 0;

  slide.addEventListener('pointerdown', e => {
    if (editing && editing.row === row) return;
    if (revealed && revealed !== row) closeRevealed();
    start = { x: e.clientX, y: e.clientY, base: revealed === row ? -REVEAL : 0, width: row.offsetWidth };
    mode = null;
    x = start.base;
  });

  slide.addEventListener('pointermove', e => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        mode = 'swipe';
        slide.setPointerCapture(e.pointerId);
      } else if (Math.abs(dy) > 8) {
        mode = 'scroll';
      }
    }
    if (mode !== 'swipe') return;
    x = Math.min(0, start.base + dx);
    setOffset(row, x, false);
  });

  const end = () => {
    if (!start) return;
    const { width } = start;
    const wasSwipe = mode === 'swipe';
    start = null;
    if (!wasSwipe) return;
    row.dataset.justSwiped = '1'; // the click that follows a swipe is not a tap-to-edit
    setTimeout(() => delete row.dataset.justSwiped, 0);
    if (-x > width * FULL_SWIPE) {
      setOffset(row, -width, true);
      revealed = null;
      setTimeout(() => deleteEntry(row.dataset.key, Number(row.dataset.id)), 180);
    } else if (-x > REVEAL / 2) {
      setOffset(row, -REVEAL, true);
      revealed = row;
    } else {
      setOffset(row, 0, true);
      if (revealed === row) revealed = null;
    }
  };
  slide.addEventListener('pointerup', end);
  slide.addEventListener('pointercancel', end);

  row.querySelector('.log-delete').addEventListener('click', () => {
    revealed = null;
    deleteEntry(row.dataset.key, Number(row.dataset.id));
    deps.tap();
  });
}

/* ── Tap to edit ── */
function moodSlot(row) {
  let slot = row.querySelector('.log-mood');
  if (!slot) {
    slot = document.createElement('span');
    slot.className = 'log-mood';
    row.querySelector('.log-entry').appendChild(slot);
  }
  return slot;
}

function showMood(row, emoji) {
  const slot = moodSlot(row);
  slot.textContent = emoji || '+';
  slot.classList.toggle('log-mood-empty', !emoji);
  slot.setAttribute('aria-hidden', editing ? 'false' : 'true');
}

function startEdit(row) {
  if (editing) commitEdit();
  const key = row.dataset.key;
  const id = Number(row.dataset.id);
  const entry = deps.loadEntriesForKey(key).find(e => e.id === id);
  if (!entry) return;

  editing = { row, key, id, original: { text: entry.text, emoji: entry.emoji || null }, emoji: entry.emoji || null };
  row.classList.add('editing');

  const text = row.querySelector('.log-text');
  text.setAttribute('contenteditable', 'plaintext-only');
  text.setAttribute('enterkeyhint', 'done');
  text.setAttribute('role', 'textbox');
  text.setAttribute('aria-label', t('entry.edit'));
  text.focus();
  // caret at the end
  const range = document.createRange();
  range.selectNodeContents(text);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const slot = moodSlot(row);
  showMood(row, editing.emoji);
  slot.setAttribute('role', 'button');
  slot.setAttribute('aria-label', editing.emoji ? t('entry.mood', editing.emoji) : t('entry.addMood'));
  // keep the keyboard up while choosing a mood
  slot.onpointerdown = e => e.preventDefault();
  slot.onclick = e => { e.stopPropagation(); toggleMoodPanel(slot); };

  text.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };
  text.onblur = () => { if (editing && editing.row === row) commitEdit(); };
}

function endEditUI() {
  closeMoodPanel();
  if (!editing) return;
  const text = editing.row.querySelector('.log-text');
  text.removeAttribute('contenteditable');
  text.onkeydown = text.onblur = null;
  editing.row.classList.remove('editing');
}

/** Save the entry being edited. Empty text deletes it (with Undo). Returns true if something was being edited. */
export function commitEdit() {
  if (!editing) return false;
  const { row, key, id, original, emoji } = editing;
  const value = row.querySelector('.log-text').innerText.replace(/ /g, ' ').trim();
  endEditUI();
  editing = null;
  if (!value) {
    deleteEntry(key, id);
  } else if (value !== original.text || emoji !== original.emoji) {
    updateEntry(key, id, { text: value, emoji });
  } else {
    deps.onChanged(key); // redraw to drop the edit-only "+" mood placeholder
  }
  return true;
}

function cancelEdit() {
  if (!editing) return;
  const { key } = editing;
  endEditUI();
  editing = null;
  deps.onChanged(key);
}

export const isEditing = () => !!editing;

/* ── Mood picker while editing ── */
function closeMoodPanel() {
  document.getElementById('entryMoodPanel')?.remove();
}

function toggleMoodPanel(slot) {
  if (document.getElementById('entryMoodPanel')) { closeMoodPanel(); return; }
  const panel = document.createElement('div');
  panel.className = 'emoji-panel visible entry-mood-panel';
  panel.id = 'entryMoodPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('entry.chooseMood'));
  panel.onpointerdown = e => e.preventDefault(); // keep editing focus
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  deps.emojiChoices().forEach(em => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = em;
    btn.setAttribute('aria-label', em);
    btn.classList.toggle('selected', em === editing.emoji);
    btn.onclick = e => {
      e.stopPropagation();
      // the same emoji again clears the mood, like the quick mood buttons
      editing.emoji = editing.emoji === em ? null : em;
      showMood(editing.row, editing.emoji);
      closeMoodPanel();
      deps.tap();
    };
    grid.appendChild(btn);
  });
  panel.appendChild(grid);
  document.body.appendChild(panel);

  // under the mood slot, right-aligned to it; flipped above if it would run off the screen
  const r = slot.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
  let top = r.bottom + 8;
  if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 8);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

/* ── Rows ── */

/** Build an editable, swipeable entry row for `entry` stored under `key`. */
export function buildEntryRow(key, entry, { listItem = true } = {}) {
  const row = document.createElement('div');
  row.className = 'log-row';
  row.dataset.key = key;
  row.dataset.id = String(entry.id);
  if (listItem) row.setAttribute('role', 'listitem');

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'log-delete';
  action.textContent = t('entry.delete');
  row.appendChild(action);

  const slide = document.createElement('div');
  slide.className = 'log-entry';
  slide.innerHTML = `<span class="log-time"></span><span class="log-text"></span>`;
  slide.querySelector('.log-time').textContent = entry.time;
  slide.querySelector('.log-text').textContent = entry.text;
  if (entry.emoji) {
    const mood = document.createElement('span');
    mood.className = 'log-mood';
    mood.setAttribute('aria-hidden', 'true');
    mood.textContent = entry.emoji;
    slide.appendChild(mood);
  }
  row.appendChild(slide);

  attachSwipe(row);
  slide.addEventListener('click', e => {
    if (row.dataset.justSwiped) return;
    if (revealed) { const wasThis = revealed === row; closeRevealed(); if (wasThis) return; }
    if (editing && editing.row === row) return;
    if (e.target.closest('.log-mood') && editing) return;
    startEdit(row);
  });
  return row;
}

export function initEntryActions(options) {
  deps = options;
  // Tap outside: close an open Delete action, or finish editing (blur also does this)
  document.addEventListener('pointerdown', e => {
    if (revealed && !revealed.contains(e.target)) closeRevealed();
    if (editing && !editing.row.contains(e.target) && !e.target.closest('#entryMoodPanel')) {
      // blur will commit; on some taps (non-focusable targets) iOS keeps focus, so commit here too
      setTimeout(() => { if (editing) commitEdit(); }, 0);
    }
  });
}
