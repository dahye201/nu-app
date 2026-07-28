import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import {
  initPurchases,
  getPremiumProduct,
  purchasePremium,
  restorePurchases,
} from './purchaseService.js';

const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

let selectedEmoji = null;
let isPremium = false;
let premiumProduct = null;

const input       = document.getElementById('journalInput');
const timeline    = document.getElementById('timeline');
const themeToggle = document.getElementById('themeToggle');

/* ── Haptics (no-op on web) ── */
function tap() {
  if (Capacitor.isNativePlatform()) {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }
}

/* ── Date display ── */
function initDate() {
  updateClock();
}

function updateClock(now = new Date()) {
  const month = `${MONTHS[now.getMonth()]} ${now.getDate()}`;
  const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  document.getElementById('dateText').innerHTML =
    `<span class="date-month">${month}</span><span class="date-clock">${hhmm}</span>`;
}

function scheduleClockTick() {
  const now = new Date();
  const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    updateClock();
    setInterval(updateClock, 60000);
  }, msUntilNextMinute);
}

function nowHHMM() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

/* ── Storage ── */
const ENTRY_KEY_RE = /^ij_(\d+)_(\d+)_(\d+)$/;

function dayKey(d) {
  return `ij_${d.getFullYear()}_${d.getMonth()+1}_${d.getDate()}`;
}

function todayKey() {
  return dayKey(new Date());
}

function loadEntriesForKey(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}

function loadEntries() {
  return loadEntriesForKey(todayKey());
}

function saveEntries(entries) {
  localStorage.setItem(todayKey(), JSON.stringify(entries));
}

/** All past days that have entries, newest first (excludes today). */
function listArchiveDays() {
  const todaysKey = todayKey();
  const days = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const match = key && key.match(ENTRY_KEY_RE);
    if (!match || key === todaysKey) continue;
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    const entries = loadEntriesForKey(key);
    if (entries.length) days.push({ key, date, count: entries.length });
  }
  return days.sort((a, b) => b.date - a.date);
}

/* ── Render ── */
function escapeHtml(str) {
  return str
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

const LOG_LIMIT = 5;

function renderTimeline(entries) {
  timeline.innerHTML = '';

  if (!entries.length) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'No entries yet — start writing above.';
    timeline.appendChild(hint);
    return;
  }

  // newest first, cap at LOG_LIMIT unless premium
  const sorted  = [...entries].reverse();
  const visible = isPremium ? sorted : sorted.slice(0, LOG_LIMIT);
  const hidden  = sorted.length - visible.length;

  visible.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.setAttribute('role','listitem');

    row.innerHTML = `
      <span class="log-time">${entry.time}</span>
      <span class="log-text">${escapeHtml(entry.text)}</span>
      ${entry.emoji ? `<span class="log-mood" aria-hidden="true">${entry.emoji}</span>` : ''}
    `;
    timeline.appendChild(row);

    if (i < visible.length - 1) {
      const hr = document.createElement('hr');
      hr.className = 'log-divider';
      timeline.appendChild(hr);
    }
  });

  if (hidden > 0) {
    const hr = document.createElement('hr');
    hr.className = 'log-divider';
    timeline.appendChild(hr);

    const btn = document.createElement('button');
    btn.className = 'show-older-btn';
    btn.textContent = `+ Show older logs today (🔒)`;
    btn.addEventListener('click', openPremiumModal);
    timeline.appendChild(btn);
  }
}

/* ── Recap ── */
const recap  = document.getElementById('recap');
const copyBtn = document.getElementById('copyBtn');

function renderRecap(entries) {
  recap.style.display = entries.length ? 'block' : 'none';
}

function buildCopyText(entries, date = new Date()) {
  const header = `─── ${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ───`;
  const lines = entries.map(e => {
    const mood = e.emoji ? ` ${e.emoji}` : '';
    return `[${e.time}]${mood} ${e.text}`;
  });
  return [header, ...lines].join('\n');
}

copyBtn.addEventListener('click', async () => {
  const entries = loadEntries();
  if (!entries.length) return;
  const text = buildCopyText(entries);
  tap();

  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ text, dialogTitle: "Today's log" });
      return;
    } catch {
      // fall through to clipboard on cancel/error
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied! 👍';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = "Copy today's log";
      copyBtn.classList.remove('copied');
    }, 2000);
  } catch {
    copyBtn.textContent = 'Copy failed — try again';
    setTimeout(() => { copyBtn.textContent = "Copy today's log"; }, 2000);
  }
});

/* ── Add entry ── */
function addEntry(text) {
  const entries = loadEntries();
  entries.push({ text: text.trim(), emoji: selectedEmoji, time: nowHHMM(), id: Date.now() });
  saveEntries(entries);
  renderTimeline(entries);
  renderRecap(entries);

  input.value = '';
  autoResize();
  selectedEmoji = null;
  document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
  input.focus();
  tap();
}

/* ── Auto-resize textarea ── */
function autoResize() {
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';
}

input.addEventListener('input', autoResize);

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = input.value.trim();
    if (text) addEntry(text);
  }
});

/* ── Emoji selection ── */
function selectEmoji(emoji, sourceBtn) {
  if (selectedEmoji === emoji) {
    selectedEmoji = null;
    document.querySelectorAll('.emoji-btn, .emoji-grid button').forEach(b => b.classList.remove('selected'));
  } else {
    selectedEmoji = emoji;
    document.querySelectorAll('.emoji-btn, .emoji-grid button').forEach(b => b.classList.remove('selected'));
    if (sourceBtn) sourceBtn.classList.add('selected');
  }
  tap();
}

document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectEmoji(btn.dataset.emoji, btn);
    closePanel();
    input.focus();
  });
});

/* ── More emoji panel ── */
const MORE_EMOJIS = [
  '🙂','😐','😫','🤩',
  '🧠','☕','🔋','📝',
  '🫠','😤','🥱','🚨',
  '🤫','🏃','🛑','✨',
];

const moreBtn    = document.getElementById('moreBtn');
const emojiPanel = document.getElementById('emojiPanel');
const emojiGrid  = document.getElementById('emojiGrid');

MORE_EMOJIS.forEach(em => {
  const btn = document.createElement('button');
  btn.textContent = em;
  btn.setAttribute('aria-label', em);
  btn.addEventListener('click', () => {
    selectEmoji(em, btn);
    closePanel();
    input.focus();
  });
  emojiGrid.appendChild(btn);
});

function closePanel() {
  emojiPanel.classList.remove('visible');
  moreBtn.classList.remove('open');
}

moreBtn.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = emojiPanel.classList.contains('visible');
  isOpen ? closePanel() : (emojiPanel.classList.add('visible'), moreBtn.classList.add('open'));
});

document.addEventListener('click', e => {
  if (!emojiPanel.contains(e.target) && e.target !== moreBtn) closePanel();
});

/* ── Premium modal ── */
const modalOverlay    = document.getElementById('modalOverlay');
const premiumBtn      = document.getElementById('premiumBtn');
const closeModalBtn   = document.getElementById('closeModalBtn');
const closeModalBtn2  = document.getElementById('closeModalBtn2');
const premiumLocked   = document.getElementById('premiumLocked');
const premiumUnlocked = document.getElementById('premiumUnlocked');
const unlockBtn       = document.getElementById('unlockBtn');
const restoreBtn      = document.getElementById('restoreBtn');
const modalPrice      = document.getElementById('modalPrice');

function refreshPremiumModalState() {
  premiumLocked.style.display = isPremium ? 'none' : 'block';
  premiumUnlocked.style.display = isPremium ? 'block' : 'none';
  premiumBtn.textContent = isPremium ? '✨ Themes' : '🔒 Themes';
}

function openPremiumModal() {
  refreshPremiumModalState();
  modalOverlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closePremiumModal() {
  modalOverlay.classList.remove('visible');
  document.body.style.overflow = '';
}

premiumBtn.addEventListener('click', openPremiumModal);
closeModalBtn.addEventListener('click', closePremiumModal);
closeModalBtn2.addEventListener('click', closePremiumModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closePremiumModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePremiumModal(); });

unlockBtn.addEventListener('click', async () => {
  if (!premiumProduct) return;
  unlockBtn.disabled = true;
  unlockBtn.textContent = 'Processing…';
  const result = await purchasePremium(premiumProduct);
  unlockBtn.disabled = false;
  unlockBtn.textContent = 'Unlock Premium';
  if (result === 'success') {
    onPremiumChange(true);
    refreshPremiumModalState();
  }
});

restoreBtn.addEventListener('click', async () => {
  restoreBtn.textContent = 'Restoring…';
  const restored = await restorePurchases();
  restoreBtn.textContent = 'Restore Purchases';
  if (restored) {
    onPremiumChange(true);
    refreshPremiumModalState();
  } else {
    restoreBtn.textContent = 'No purchases found';
    setTimeout(() => { restoreBtn.textContent = 'Restore Purchases'; }, 2000);
  }
});

async function loadPremiumProduct() {
  premiumProduct = await getPremiumProduct();
  modalPrice.textContent = premiumProduct?.priceString ?? 'unavailable';
  unlockBtn.disabled = !premiumProduct;
}

/* ── Theme picker (premium) ── */
const themeGrid = document.getElementById('themeGrid');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'light' || theme === 'sepia' ? '🌙' : '☀️';
  localStorage.setItem('ij_theme', theme);
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.swatch === theme);
  });
}

themeGrid.querySelectorAll('.theme-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    applyTheme(btn.dataset.swatch);
    tap();
  });
});

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ── Archive (history) modal ── */
const archiveOverlay   = document.getElementById('archiveOverlay');
const historyBtn       = document.getElementById('historyBtn');
const closeArchiveBtn  = document.getElementById('closeArchiveBtn');
const closeArchiveBtn2 = document.getElementById('closeArchiveBtn2');
const archiveLocked    = document.getElementById('archiveLocked');
const archiveUnlocked  = document.getElementById('archiveUnlocked');
const archiveDayList   = document.getElementById('archiveDayList');
const archiveUnlockBtn = document.getElementById('archiveUnlockBtn');

function renderArchiveDayList() {
  const days = listArchiveDays();
  if (!days.length) {
    archiveDayList.innerHTML = `<p class="archive-empty">No past logs yet.</p>`;
    return;
  }
  archiveDayList.innerHTML = `<ul class="archive-list" role="list"></ul>`;
  const list = archiveDayList.querySelector('.archive-list');
  days.forEach(({ key, date, count }) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'archive-day-btn';
    btn.innerHTML = `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}<span class="archive-count">${count} ${count === 1 ? 'entry' : 'entries'}</span>`;
    btn.addEventListener('click', () => renderArchiveDayDetail(key, date));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function renderArchiveDayDetail(key, date) {
  const entries = loadEntriesForKey(key);
  const back = document.createElement('button');
  back.className = 'archive-back-btn';
  back.textContent = '← Back';
  back.addEventListener('click', renderArchiveDayList);

  archiveDayList.innerHTML = '';
  archiveDayList.appendChild(back);

  const title = document.createElement('div');
  title.className = 'modal-price-line';
  title.textContent = `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  archiveDayList.appendChild(title);

  entries.slice().reverse().forEach(entry => {
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML = `
      <span class="log-time">${entry.time}</span>
      <span class="log-text">${escapeHtml(entry.text)}</span>
      ${entry.emoji ? `<span class="log-mood" aria-hidden="true">${entry.emoji}</span>` : ''}
    `;
    archiveDayList.appendChild(row);
  });
}

function refreshArchiveModalState() {
  archiveLocked.style.display = isPremium ? 'none' : 'block';
  archiveUnlocked.style.display = isPremium ? 'block' : 'none';
  if (isPremium) renderArchiveDayList();
}

function openArchiveModal() {
  refreshArchiveModalState();
  archiveOverlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeArchiveModal() {
  archiveOverlay.classList.remove('visible');
  document.body.style.overflow = '';
}

historyBtn.addEventListener('click', openArchiveModal);
closeArchiveBtn.addEventListener('click', closeArchiveModal);
closeArchiveBtn2.addEventListener('click', closeArchiveModal);
archiveOverlay.addEventListener('click', e => { if (e.target === archiveOverlay) closeArchiveModal(); });
archiveUnlockBtn.addEventListener('click', () => {
  closeArchiveModal();
  openPremiumModal();
});

/* ── Purchases boot ── */
function onPremiumChange(premium) {
  isPremium = premium;
  renderTimeline(loadEntries());
  refreshPremiumModalState();
}

initPurchases(onPremiumChange);
loadPremiumProduct();

/* ── Boot ── */
const savedTheme = localStorage.getItem('ij_theme');
applyTheme(savedTheme || 'dark');

initDate();
scheduleClockTick();
const _boot = loadEntries();
renderTimeline(_boot);
renderRecap(_boot);
input.focus();
