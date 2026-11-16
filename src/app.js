import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import {
  initPurchases,
  getPremiumProduct,
  purchasePremium,
  restorePurchases,
} from './purchaseService.js';
import { initReminders, afterEntryAdded, refreshReminderPremium, openCustomReminderTimes } from './reminders.js';
import { initBackup } from './backup.js';

const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

const ICON_SUN = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
  <circle cx="10" cy="10" r="4"/>
  <line x1="10" y1="1.5" x2="10" y2="3.5"/><line x1="10" y1="16.5" x2="10" y2="18.5"/>
  <line x1="1.5" y1="10" x2="3.5" y2="10"/><line x1="16.5" y1="10" x2="18.5" y2="10"/>
  <line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="14.4" y1="14.4" x2="15.8" y2="15.8"/>
  <line x1="4.2" y1="15.8" x2="5.6" y2="14.4"/><line x1="14.4" y1="5.6" x2="15.8" y2="4.2"/>
</svg>`;

const ICON_MOON = `<svg viewBox="0 0 20 20" fill="currentColor">
  <path d="M14.5 11.5A6 6 0 0 1 8.5 5.5a6 6 0 1 0 6 6z"/>
</svg>`;

const ICON_LOCK = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4.5" y="9" width="11" height="8" rx="2"/>
  <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/>
</svg>`;

const ICON_SPARKLE = `<svg viewBox="0 0 20 20" fill="currentColor">
  <path d="M10 2l1.6 5.2L17 9l-5.4 1.8L10 16l-1.6-5.2L3 9l5.4-1.8z"/>
</svg>`;

let selectedEmoji = null;
// Last premium status RevenueCat confirmed on this device, so the UI can render
// immediately on launch (and keep working if RevenueCat is slow or fails).
// No saved value (first launch) = free.
const PREMIUM_CACHE_KEY = 'ij_premium_cached';
function readCachedPremium() {
  try { return localStorage.getItem(PREMIUM_CACHE_KEY) === '1'; } catch { return false; }
}
function saveCachedPremium(premium) {
  try { localStorage.setItem(PREMIUM_CACHE_KEY, premium ? '1' : '0'); } catch {}
}
let isPremium = readCachedPremium();
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
  document.getElementById('recap').classList.remove('after-locked');

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
    // Locked row: reads as the last row of the list (divider above, none below)
    const hr = document.createElement('hr');
    hr.className = 'log-divider';
    timeline.appendChild(hr);

    const row = document.createElement('button');
    row.className = 'log-entry locked-row';
    row.setAttribute('aria-label', `${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'} today. Unlock with Premium`);
    row.innerHTML = `
      <span class="locked-row-text">${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'} today</span>
      <span class="locked-row-icon" aria-hidden="true">${ICON_LOCK}</span>
    `;
    row.addEventListener('click', () => openPaywall({ source: 'older_entries' }));
    timeline.appendChild(row);
    document.getElementById('recap').classList.add('after-locked');
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
  afterEntryAdded();
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
  '🫠','😤','🥱','🚨',
  '🔋','🪫','☕','🧠',
  '🎧','📝','📱','🏃',
  '💧','🍽️','✅','✨',
];

// Extra top row for everyone during the Christmas event (Nov–Dec, device local date)
const DECEMBER_EMOJIS = ['🎄','🎁','🍪','❄️'];

const moreBtn    = document.getElementById('moreBtn');
const emojiPanel = document.getElementById('emojiPanel');
const emojiGrid  = document.getElementById('emojiGrid');

function renderEmojiGrid() {
  emojiGrid.replaceChildren();
  const seasonal = isSeasonalWindow();
  const set = seasonal ? [...DECEMBER_EMOJIS, ...MORE_EMOJIS] : MORE_EMOJIS;
  set.forEach((em, i) => {
    if (seasonal && i === DECEMBER_EMOJIS.length) {
      const divider = document.createElement('div');
      divider.className = 'emoji-divider';
      divider.setAttribute('aria-hidden', 'true');
      emojiGrid.appendChild(divider);
    }
    const btn = document.createElement('button');
    btn.textContent = em;
    btn.setAttribute('aria-label', em);
    btn.classList.toggle('selected', em === selectedEmoji);
    btn.addEventListener('click', () => {
      selectEmoji(em, btn);
      closePanel();
      input.focus();
    });
    emojiGrid.appendChild(btn);
  });
}
renderEmojiGrid();

// The fixed top-right buttons (Themes, calendar, theme toggle)
const HEADER_BUTTON_IDS = ['premiumBtn', 'remindBtn', 'historyBtn', 'themeToggle'];
const HEADER_GAP = 12;
const PANEL_OFFSET = 8; // matches the CSS calc(100% + 8px)

/** Open upward from "+" unless that would come within HEADER_GAP of the header buttons; then open downward. */
function positionPanel() {
  const headerBottom = Math.max(0, ...HEADER_BUTTON_IDS
    .map(id => document.getElementById(id))
    .filter(Boolean)
    .map(el => el.getBoundingClientRect().bottom));
  const roomAbove = moreBtn.getBoundingClientRect().top - PANEL_OFFSET - (headerBottom + HEADER_GAP);
  emojiPanel.classList.toggle('open-down', emojiPanel.offsetHeight > roomAbove);
}

function closePanel() {
  emojiPanel.classList.remove('visible');
  moreBtn.classList.remove('open');
  window.removeEventListener('scroll', positionPanel);
}

moreBtn.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = emojiPanel.classList.contains('visible');
  if (isOpen) return closePanel();
  renderEmojiGrid(); // picks up the event row if the date changed while the app was open
  emojiPanel.classList.add('visible'); // visible first so it can be measured
  positionPanel();
  moreBtn.classList.add('open');
  window.addEventListener('scroll', positionPanel, { passive: true });
});

document.addEventListener('click', e => {
  if (!emojiPanel.contains(e.target) && e.target !== moreBtn) closePanel();
});

/* ── Themes popup (everyone) ── */
const modalOverlay    = document.getElementById('modalOverlay');
const premiumBtn      = document.getElementById('premiumBtn');
const closeModalBtn2  = document.getElementById('closeModalBtn2');

function refreshPremiumModalState() {
  premiumBtn.innerHTML = `${isPremium ? ICON_SPARKLE : ICON_LOCK} Themes`;
  document.getElementById('themesSubtitle').textContent = isPremium ? 'Premium unlocked. Pick a theme:' : 'Pick a theme:';
  modalOverlay.classList.toggle('themes-locked', !isPremium);
  document.querySelectorAll('.theme-swatch .swatch-lock').forEach(el => { el.innerHTML = ICON_LOCK; });
}

function openPremiumModal() {
  refreshPremiumModalState();
  refreshSeasonalThemes();
  modalOverlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closePremiumModal() {
  modalOverlay.classList.remove('visible');
  syncBodyScrollLock();
}

/** Keep the page from scrolling while any popup is open. */
function syncBodyScrollLock() {
  const anyOpen = document.querySelector('.modal-overlay.visible');
  document.body.style.overflow = anyOpen ? 'hidden' : '';
}

premiumBtn.addEventListener('click', () => openPremiumModal());
closeModalBtn2.addEventListener('click', closePremiumModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closePremiumModal(); });

/* ── Paywall ── */
const PREMIUM_THEMES = ['paper', 'cyberpunk', 'neon', 'deepblue'];
const paywallOverlay  = document.getElementById('paywallOverlay');
const paywallHeadline = document.getElementById('paywallHeadline');
const paywallBenefits = document.getElementById('paywallBenefits');
const unlockBtn       = document.getElementById('unlockBtn');
const restoreBtn      = document.getElementById('restoreBtn');
const closePaywallBtn = document.getElementById('closePaywallBtn');

const ICON_CHECK = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4.5 10.5l3.5 3.5 7.5-8"/>
</svg>`;

// Same message wherever the paywall opens, except the reminders lock, which leads with its feature.
// `source` also decides what happens after purchase.
const PAYWALL_HEADLINE = 'Look back at any day.';
const PAYWALL_SUBTITLE = 'Your memories, always within reach.';
const BENEFIT_REMINDER_TIMES = 'Pick your own reminder times';
const PAYWALL_BENEFITS = [
  'Browse any past day',
  'Access all your daily entries',
  'Unlock exclusive themes',
  BENEFIT_REMINDER_TIMES,
];
const PAYWALL_BY_SOURCE = {
  reminders: {
    headline: 'Nudges at\nyour times.',
    benefits: [BENEFIT_REMINDER_TIMES, ...PAYWALL_BENEFITS.filter(b => b !== BENEFIT_REMINDER_TIMES)],
  },
};
const PAYWALL_SOURCES = ['older_entries', 'history', 'themes', 'reminders', 'default'];

let paywallContext = { source: 'default', theme: null };

/**
 * Open the paywall.
 * source: 'older_entries' | 'history' | 'themes' | 'reminders' | 'default'
 * theme:  premium theme ID that was tapped (themes only)
 */
function openPaywall({ source = 'default', theme = null } = {}) {
  if (!PAYWALL_SOURCES.includes(source)) source = 'default';
  if (!PREMIUM_THEMES.includes(theme)) theme = null;
  paywallContext = { source, theme };

  const copy = PAYWALL_BY_SOURCE[source] || {};
  paywallHeadline.textContent = copy.headline || PAYWALL_HEADLINE;
  document.getElementById('paywallSubtitle').textContent = copy.subtitle || PAYWALL_SUBTITLE;
  paywallBenefits.replaceChildren(...(copy.benefits || PAYWALL_BENEFITS).map(text => {
    const li = document.createElement('li');
    li.innerHTML = `${ICON_CHECK}<span></span>`;
    li.querySelector('span').textContent = text;
    return li;
  }));

  paywallOverlay.classList.add('visible');
  syncBodyScrollLock();
}

function closePaywall() {
  paywallOverlay.classList.remove('visible');
  syncBodyScrollLock();
}

/** What happens right after a successful purchase or restore, based on where the paywall was opened. */
function afterUnlock() {
  const { source, theme } = paywallContext;
  closePaywall();
  if (source === 'history') {
    openArchiveModal();
  } else if (source === 'themes' && theme) {
    chooseTheme(theme);
  } else if (source === 'reminders') {
    openCustomReminderTimes();
  }
  // older_entries: onPremiumChange(true) already re-rendered today's full list
}

closePaywallBtn.addEventListener('click', closePaywall);
paywallOverlay.addEventListener('click', e => { if (e.target === paywallOverlay) closePaywall(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (paywallOverlay.classList.contains('visible')) closePaywall();
  else closePremiumModal();
});

function unlockLabel() {
  // Localized store price, e.g. "Unlock Premium · $4.99"
  return premiumProduct ? `Unlock Premium · ${premiumProduct.priceString}` : 'Unlock Premium';
}

unlockBtn.addEventListener('click', async () => {
  if (!premiumProduct) return;
  unlockBtn.disabled = true;
  unlockBtn.textContent = 'Processing…';
  const result = await purchasePremium(premiumProduct);
  unlockBtn.disabled = false;
  unlockBtn.textContent = unlockLabel();
  if (result === 'success') {
    onPremiumChange(true);
    afterUnlock();
  }
});

restoreBtn.addEventListener('click', async () => {
  restoreBtn.textContent = 'Restoring…';
  const restored = await restorePurchases();
  restoreBtn.textContent = 'Restore Purchases';
  if (restored) {
    onPremiumChange(true);
    afterUnlock();
  } else {
    restoreBtn.textContent = 'No purchases found';
    setTimeout(() => { restoreBtn.textContent = 'Restore Purchases'; }, 2000);
  }
});

async function loadPremiumProduct() {
  premiumProduct = await getPremiumProduct();
  unlockBtn.textContent = unlockLabel();
  unlockBtn.disabled = !premiumProduct;
}

/* ── Theme picker (premium) ── */
const BASE_THEMES = ['dark', 'light', 'cyberpunk', 'neon', 'deepblue', 'paper'];
const SEASONAL_THEMES = ['snow', 'christmas'];

// Christmas event: Snow is the light variant, Christmas the dark one.
const XMAS_OFF_KEY = 'ij_xmas_off';
const isLightTheme = (theme) => theme === 'light' || theme === 'snow' || theme === 'paper';
const xmasVariant = (theme) => (isLightTheme(theme) ? 'snow' : 'christmas');

// Sun/moon "return to" memory: set only when the toggle leaves a premium theme (e.g. Paper → Dark),
// used only by the very next toggle. Any other theme change (picker, Default, Christmas event) clears it.
const TOGGLE_RETURN_KEY = 'ij_toggle_return';

function applyTheme(theme, { fromToggle = false } = {}) {
  if (!fromToggle) localStorage.removeItem(TOGGLE_RETURN_KEY);
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.innerHTML = isLightTheme(theme) ? ICON_MOON : ICON_SUN;
  localStorage.setItem('ij_theme', theme);
  const seasonal = SEASONAL_THEMES.includes(theme);
  // After tapping "Default", highlight only that card, not also the theme it restored
  const viaDefault = !seasonal && isSeasonalWindow() && localStorage.getItem(XMAS_OFF_KEY) === 'default';
  document.querySelectorAll('.theme-swatch').forEach(s => {
    const key = s.dataset.swatch;
    const selected = key === 'xmas' ? seasonal
      : key === 'default' ? viaDefault
      : key === theme && !viaDefault;
    s.classList.toggle('selected', selected);
  });
}

/** Switch on the Christmas look, remembering the regular theme to return to. */
function enterXmas() {
  const current = document.documentElement.getAttribute('data-theme');
  if (BASE_THEMES.includes(current)) localStorage.setItem('ij_theme_prev', current);
  applyTheme(xmasVariant(current));
}

/** Back to the user's regular theme. */
function leaveXmas() {
  const current = document.documentElement.getAttribute('data-theme');
  const wantLight = isLightTheme(current); // Snow → light side, Christmas → dark side
  const prev = localStorage.getItem('ij_theme_prev');
  // Return to the remembered theme only if it matches the light/dark side the user is on now
  // (they may have flipped Snow ↔ Christmas since) and they can still use it.
  const prevOk = BASE_THEMES.includes(prev)
    && isLightTheme(prev) === wantLight
    && (isPremium || !PREMIUM_THEMES.includes(prev));
  applyTheme(prevOk ? prev : (wantLight ? 'light' : 'dark'));
}

/** Apply a theme the user picked (picker or after buying it from the paywall). */
function chooseTheme(key) {
  // Picking a regular theme also opts out of the event look
  if (isSeasonalWindow()) localStorage.setItem(XMAS_OFF_KEY, 'theme');
  localStorage.removeItem(TOGGLE_RETURN_KEY);
  applyTheme(key);
}

document.querySelectorAll('.theme-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.swatch;
    if (PREMIUM_THEMES.includes(key) && !isPremium) {
      openPaywall({ source: 'themes', theme: key });
      return;
    }
    if (key === 'xmas') {
      localStorage.removeItem(XMAS_OFF_KEY);
      enterXmas();
    } else if (key === 'default') {
      localStorage.setItem(XMAS_OFF_KEY, 'default');
      leaveXmas();
    } else {
      chooseTheme(key);
    }
    tap();
  });
});

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  if (SEASONAL_THEMES.includes(current)) {
    applyTheme(current === 'snow' ? 'christmas' : 'snow', { fromToggle: true });
  } else {
    // Sun/moon flips between light and dark. If the user was on a premium theme (e.g. Paper),
    // remember it so flipping back returns to that theme instead of plain Light/Dark.
    const target = isLightTheme(current) ? 'dark' : 'light';
    const saved = localStorage.getItem(TOGGLE_RETURN_KEY);
    if (current !== 'dark' && current !== 'light') {
      applyTheme(target, { fromToggle: true });
      localStorage.setItem(TOGGLE_RETURN_KEY, current);
    } else if (BASE_THEMES.includes(saved) && isLightTheme(saved) === (target === 'light')
               && (isPremium || !PREMIUM_THEMES.includes(saved))) {
      applyTheme(saved); // consumes the memory
    } else {
      applyTheme(target);
    }
  }
});

/* ── Christmas event: on by default for everyone, November–December ── */

function isSeasonalWindow(now = new Date()) {
  return now.getMonth() >= 10; // November–December
}

function refreshSeasonalThemes() {
  const inSeason = isSeasonalWindow();
  document.querySelectorAll('.theme-swatch[data-seasonal]').forEach(s => {
    s.style.display = inSeason ? '' : 'none';
  });
  // During the event "Default" covers Dark/Light; they come back afterwards
  document.querySelectorAll('.theme-swatch[data-offseason]').forEach(s => {
    s.style.display = inSeason ? 'none' : '';
  });

  const current = document.documentElement.getAttribute('data-theme');
  if (inSeason) {
    if (!localStorage.getItem(XMAS_OFF_KEY) && !SEASONAL_THEMES.includes(current)) enterXmas();
  } else {
    localStorage.removeItem(XMAS_OFF_KEY); // reset for next year's event
    if (SEASONAL_THEMES.includes(current)) leaveXmas();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshSeasonalThemes();
});

/* ── Archive (history) calendar ── */
const archiveOverlay   = document.getElementById('archiveOverlay');
const historyBtn       = document.getElementById('historyBtn');
const closeArchiveBtn  = document.getElementById('closeArchiveBtn');
const closeArchiveBtn2 = document.getElementById('closeArchiveBtn2');
const archiveLocked    = document.getElementById('archiveLocked');
const archiveUnlocked  = document.getElementById('archiveUnlocked');
const archiveDayList   = document.getElementById('archiveDayList');
const archiveUnlockBtn = document.getElementById('archiveUnlockBtn');
const calGrid          = document.getElementById('calGrid');
const calMonthLabel    = document.getElementById('calMonthLabel');
const calPrevBtn       = document.getElementById('calPrevBtn');
const calNextBtn       = document.getElementById('calNextBtn');

let calViewDate = new Date();
let selectedArchiveKey = null;

function entryCountForDate(date) {
  return loadEntriesForKey(dayKey(date)).length;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function renderCalendar() {
  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  const today = new Date();

  calMonthLabel.textContent = `${MONTHS[month]} ${year}`;

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();

  calGrid.innerHTML = '';

  for (let i = 0; i < leadingBlanks; i++) {
    calGrid.appendChild(document.createElement('div'));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const count = entryCountForDate(date);

    const btn = document.createElement('button');
    btn.className = 'cal-day';
    btn.textContent = String(day);
    if (isSameDay(date, today)) btn.classList.add('today');
    if (selectedArchiveKey === dayKey(date)) btn.classList.add('selected');

    if (count > 0) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot';
      btn.appendChild(dot);
      btn.addEventListener('click', () => selectArchiveDay(date));
    } else {
      btn.disabled = true;
    }
    calGrid.appendChild(btn);
  }

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  calNextBtn.disabled = isCurrentMonth;
}

function selectArchiveDay(date) {
  selectedArchiveKey = dayKey(date);
  renderCalendar();

  const entries = loadEntriesForKey(selectedArchiveKey);
  archiveDayList.innerHTML = '';

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

calPrevBtn.addEventListener('click', () => {
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1);
  renderCalendar();
});

calNextBtn.addEventListener('click', () => {
  if (calNextBtn.disabled) return;
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1);
  renderCalendar();
});

function refreshArchiveModalState() {
  archiveLocked.style.display = isPremium ? 'none' : 'block';
  archiveUnlocked.style.display = isPremium ? 'block' : 'none';
  if (isPremium) {
    calViewDate = new Date();
    selectedArchiveKey = null;
    archiveDayList.innerHTML = `<p class="archive-empty">Tap a day with a dot to view its log.</p>`;
    renderCalendar();
  }
}

function openArchiveModal() {
  refreshArchiveModalState();
  archiveOverlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeArchiveModal() {
  archiveOverlay.classList.remove('visible');
  syncBodyScrollLock();
}

historyBtn.addEventListener('click', () => (isPremium ? openArchiveModal() : openPaywall({ source: 'history' })));
closeArchiveBtn.addEventListener('click', closeArchiveModal);
closeArchiveBtn2.addEventListener('click', closeArchiveModal);
archiveOverlay.addEventListener('click', e => { if (e.target === archiveOverlay) closeArchiveModal(); });
archiveUnlockBtn.addEventListener('click', () => {
  closeArchiveModal();
  openPaywall({ source: 'history' });
});

/* ── Purchases boot ── */
// Called only with a successful RevenueCat result (customer info, purchase or restore)
function onPremiumChange(premium) {
  isPremium = premium;
  saveCachedPremium(premium);
  renderTimeline(loadEntries());
  refreshPremiumModalState();
  refreshReminderPremium();
}

refreshPremiumModalState(); // draw the Themes button now from the saved status; RevenueCat updates it later
initPurchases(onPremiumChange);
loadPremiumProduct();

/* ── Boot ── */
const savedTheme = localStorage.getItem('ij_theme');
applyTheme([...BASE_THEMES, ...SEASONAL_THEMES].includes(savedTheme) ? savedTheme : 'dark', { fromToggle: true });
refreshSeasonalThemes();

initDate();
scheduleClockTick();
const _boot = loadEntries();
renderTimeline(_boot);
renderRecap(_boot);
input.focus();

initBackup({
  syncBodyScrollLock,
  tap,
  onEntriesChanged() {
    const entries = loadEntries();
    renderTimeline(entries);
    renderRecap(entries);
  },
});

initReminders({
  dayKey,
  loadEntriesForKey,
  syncBodyScrollLock,
  isPremium: () => isPremium,
  openPaywall: () => openPaywall({ source: 'reminders' }),
  onTodayChanged() {
    const entries = loadEntries();
    renderTimeline(entries);
    renderRecap(entries);
  },
});
