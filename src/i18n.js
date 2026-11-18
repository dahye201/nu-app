// UI language: Korean when the iPhone's preferred language is Korean, English otherwise.
// Picked once at startup; there is no in-app switch. Native strings (notification actions)
// follow the same choice through ko.lproj / en.lproj.

function detectLang() {
  try {
    const first = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return first.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  } catch {
    return 'en';
  }
}

export const lang = detectLang();
export const isKo = lang === 'ko';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const en = {
  // Header
  'header.history': 'Past days',
  'header.historyTitle': 'History',
  'header.reminders': 'Reminders',
  'header.remindersOn': 'Reminders, on',
  'header.remindersOff': 'Reminders, off',
  'header.toggleTitle': 'Toggle theme',
  'header.toggle': 'Toggle dark/light mode',
  'header.premium': 'Premium features',
  'header.themes': 'Themes',

  // Themes
  'themes.title': 'Themes',
  'themes.pick': 'Pick a theme:',
  'themes.pickPremium': 'Premium unlocked. Pick a theme:',
  'themes.free': 'FREE',
  'themes.aria': name => `${name} theme`,
  'theme.xmas': 'Christmas',
  'theme.default': 'Default',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.cyberpunk': 'Cyberpunk',
  'theme.neon': 'Neon',
  'theme.deepblue': 'Deep Blue',
  'theme.paper': 'Paper',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.premium': 'Premium',

  // Reminder opt-in
  'ask.title': 'Nice, first one logged.',
  'ask.body': "Want a nudge for the next one?<br>We'll check in twice a day, at random moments.<br>Just reply to the notification to log.",
  'ask.on': 'Turn on reminders',
  'ask.later': 'Not now',
  'ask.footnote': 'No streaks. No guilt. Turn off anytime.',

  // Reminder settings
  'rm.title': 'Reminders',
  'rm.openSettings': 'Enable in Settings',
  'rm.when': 'When',
  'rm.timesAria': 'Reminder times',
  'rm.random': 'Random, twice a day',
  'rm.custom': 'At my times',
  'rm.lockedAria': label => `${label}, Premium`,
  'rm.addTime': '+ Add time',
  'rm.addTimeAria': 'Add a reminder time',
  'rm.remove': time => `Remove ${time}`,
  'rm.paused': 'Paused for today',
  'rm.resume': 'Resume',
  'rm.skip': 'Skipped if you logged in the last hour.',
  'rm.reply': 'Reply right from the notification.',
  'rm.window': (from, to) => `Twice a day, between ${from} and ${to}.`,
  'rm.next': when => `Next reminder: ${when}`,
  'rm.today': time => `Today at ${time}`,
  'rm.tomorrow': time => `Tomorrow at ${time}`,
  'rm.weekday': (day, time) => `${day} at ${time}`,
  'rm.unavailable': 'Reminders work in the nu. iPhone app.',
  'rm.denied': 'Notifications are off for nu.',

  // Back up & restore
  'backup.aria': 'Back up and restore',
  'backup.title': 'Back up & restore',
  'backup.intro': 'Your entries live only on this phone. Save a copy as a file in Files, iCloud Drive or a message to yourself, and import it on a new phone.',
  'backup.export': 'Export all entries',
  'backup.import': 'Import a backup',
  'backup.importBtn': 'Import',
  'backup.summary': (entries, days) => `${plural(entries, 'entry', 'entries')} across ${plural(days, 'day', 'days')} on this phone.`,
  'backup.empty': 'No entries on this phone yet.',
  'backup.shareTitle': 'Save your nu. backup',
  'backup.notBackup': "This file isn't a nu. backup.",
  'backup.newer': 'This backup is from a newer version of nu. Update the app, then try again.',
  'backup.importFailed': "Couldn't import",
  'backup.nothingNew': 'Nothing new to import',
  'backup.allThere': 'Every entry in this backup is already on this phone.',
  'backup.noEntries': 'This backup has no entries.',
  'backup.confirm': n => `Import ${plural(n, 'entry', 'entries')}?`,
  'backup.fromDays': n => `From ${plural(n, 'day', 'days')}.`,
  'backup.existing': n => `${n} already on this phone will be skipped.`,
  'backup.invalid': n => `${n} couldn't be read and will be skipped.`,
  'backup.safe': 'Nothing on this phone is deleted or changed.',
  'backup.imported': 'Imported',
  'backup.added': n => `${plural(n, 'entry', 'entries')} added to your journal.`,
  'backup.exportFailed': "Couldn't export",
  'backup.tryAgain': 'Something went wrong. Please try again.',

  // Paywall
  'pw.aria': 'nu. Premium',
  'pw.title': 'Premium',
  'pw.unlock': 'Unlock Premium',
  'pw.unlockPrice': price => `Unlock Premium · ${price}`,
  'pw.processing': 'Processing…',
  'pw.note': 'One-time payment. No subscription, ever.',
  'pw.restore': 'Restore Purchases',
  'pw.restoring': 'Restoring…',
  'pw.noPurchases': 'No purchases found',
  'pw.benefit.reminders': 'Choose your own reminder times',
  'pw.benefit.history': 'Browse any past day',
  'pw.benefit.entries': 'Access all your daily entries',
  'pw.benefit.themes': 'Unlock exclusive themes',
  'pw.reminders.headline': 'Reminders on your schedule.',
  'pw.reminders.subtitle': 'Nudges at the moments that fit your day.',
  'pw.history.headline': 'Look back at any day.',
  'pw.history.subtitle': 'Your memories, always within reach.',
  'pw.entries.headline': 'See all of today,\nand every day before.',
  'pw.entries.subtitle': 'Nothing you log is ever out of sight.',
  'pw.themes.headline': 'Make nu. yours.',
  'pw.themes.subtitle': 'Pick the look that helps you focus.',

  // History
  'history.aria': 'nu. History',
  'history.title': 'History',
  'history.locked': 'Viewing past days is a premium feature.',
  'history.prev': 'Previous month',
  'history.next': 'Next month',
  'history.weekdays': ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  'history.hint': 'Tap a day with a dot to view its log.',

  // Today
  'main.placeholder': 'What did you just finish? What is the next tiny step?',
  'main.good': 'Good',
  'main.neutral': 'Neutral',
  'main.tired': 'Tired',
  'main.moreEmojis': 'More emojis',
  'main.emojiPicker': 'Emoji picker',
  'main.entries': 'Journal entries',
  'main.empty': 'No entries yet — start writing above.',
  'main.locked': n => `${n} earlier ${n === 1 ? 'entry' : 'entries'} today`,
  'main.lockedAria': n => `${n} earlier ${n === 1 ? 'entry' : 'entries'} today. Unlock with Premium`,
  'main.copy': "Copy today's log",
  'main.copied': 'Copied! 👍',
  'main.copyFailed': 'Copy failed — try again',
  'main.shareTitle': "Today's log",

  // Entry edit / delete
  'entry.deleted': 'Entry deleted',
  'entry.undo': 'Undo',
  'entry.delete': 'Delete',
  'entry.edit': 'Edit entry',
  'entry.mood': emoji => `Mood ${emoji}. Change`,
  'entry.addMood': 'Add mood',
  'entry.chooseMood': 'Choose a mood',
};

const ko = {
  'header.history': '지난 기록',
  'header.historyTitle': '지난 기록',
  'header.reminders': '알림',
  'header.remindersOn': '알림, 켜짐',
  'header.remindersOff': '알림, 꺼짐',
  'header.toggleTitle': '테마 전환',
  'header.toggle': '다크/라이트 모드 전환',
  'header.premium': '프리미엄 기능',
  'header.themes': '테마',

  'themes.title': '테마',
  'themes.pick': '테마를 골라보세요',
  'themes.pickPremium': '프리미엄 이용 중이에요. 테마를 골라보세요',
  'themes.free': '무료',
  'themes.aria': name => `${name} 테마`,
  'theme.xmas': '크리스마스',
  'theme.default': '기본',
  'theme.dark': '다크',
  'theme.light': '라이트',
  'theme.cyberpunk': '사이버펑크',
  'theme.neon': '네온',
  'theme.deepblue': '딥 블루',
  'theme.paper': '페이퍼',
  'common.close': '닫기',
  'common.cancel': '취소',
  'common.done': '완료',
  'common.premium': '프리미엄',

  'ask.title': '좋아요, 첫 기록 완료!',
  'ask.body': '다음 기록도 살짝 챙겨드릴까요?<br>하루 두 번, 랜덤한 때에 물어볼게요.<br>알림에 바로 답장하면 기록돼요.',
  'ask.on': '알림 켜기',
  'ask.later': '나중에',
  'ask.footnote': '연속 기록 압박도, 죄책감도 없어요. 언제든 끌 수 있어요.',

  'rm.title': '알림',
  'rm.openSettings': '설정에서 켜기',
  'rm.when': '언제',
  'rm.timesAria': '알림 시간',
  'rm.random': '하루 두 번, 랜덤',
  'rm.custom': '내가 정한 시간',
  'rm.lockedAria': label => `${label}, 프리미엄`,
  'rm.addTime': '+ 시간 추가',
  'rm.addTimeAria': '알림 시간 추가',
  'rm.remove': time => `${time} 삭제`,
  'rm.paused': '오늘은 쉬는 중',
  'rm.resume': '다시 켜기',
  'rm.skip': '최근 1시간 안에 기록했다면 건너뛰어요.',
  'rm.reply': '알림에서 바로 답장할 수 있어요.',
  'rm.window': (from, to) => `하루 두 번, ${from}~${to} 사이에 와요.`,
  'rm.next': when => `다음 알림: ${when}`,
  'rm.today': time => `오늘 ${time}`,
  'rm.tomorrow': time => `내일 ${time}`,
  'rm.weekday': (day, time) => `${day} ${time}`,
  'rm.unavailable': '알림은 nu. 아이폰 앱에서 쓸 수 있어요.',
  'rm.denied': 'nu. 알림이 꺼져 있어요.',

  'backup.aria': '백업 및 복원',
  'backup.title': '백업 및 복원',
  'backup.intro': '기록은 이 폰에만 저장돼요. 파일 앱, iCloud Drive, 나에게 보내는 메시지 등에 사본을 저장해두고, 새 폰에서 가져오세요.',
  'backup.export': '모든 기록 내보내기',
  'backup.import': '백업 가져오기',
  'backup.importBtn': '가져오기',
  'backup.summary': (entries, days) => `이 폰에 ${days}일 동안의 기록 ${entries}개가 있어요.`,
  'backup.empty': '아직 이 폰에 기록이 없어요.',
  'backup.shareTitle': 'nu. 백업 저장',
  'backup.notBackup': '이 파일은 nu. 백업이 아니에요.',
  'backup.newer': '더 새로운 버전의 nu.에서 만든 백업이에요. 앱을 업데이트한 뒤 다시 시도해주세요.',
  'backup.importFailed': '가져오지 못했어요',
  'backup.nothingNew': '새로 가져올 기록이 없어요',
  'backup.allThere': '이 백업의 기록이 모두 이미 이 폰에 있어요.',
  'backup.noEntries': '이 백업에는 기록이 없어요.',
  'backup.confirm': n => `기록 ${n}개를 가져올까요?`,
  'backup.fromDays': n => `${n}일 분량이에요.`,
  'backup.existing': n => `이미 있는 ${n}개는 건너뛰어요.`,
  'backup.invalid': n => `읽을 수 없는 ${n}개는 건너뛰어요.`,
  'backup.safe': '이 폰의 기록은 지워지거나 바뀌지 않아요.',
  'backup.imported': '가져오기 완료',
  'backup.added': n => `기록 ${n}개를 추가했어요.`,
  'backup.exportFailed': '내보내지 못했어요',
  'backup.tryAgain': '문제가 생겼어요. 다시 시도해주세요.',

  'pw.aria': 'nu. 프리미엄',
  'pw.title': '프리미엄',
  'pw.unlock': '프리미엄 잠금 해제',
  'pw.unlockPrice': price => `프리미엄 잠금 해제 · ${price}`,
  'pw.processing': '처리 중…',
  'pw.note': '한 번만 결제해요. 구독은 절대 없어요.',
  'pw.restore': '구매 복원',
  'pw.restoring': '복원 중…',
  'pw.noPurchases': '구매 내역이 없어요',
  'pw.benefit.reminders': '알림 시간 직접 정하기',
  'pw.benefit.history': '지난 날 기록 모두 보기',
  'pw.benefit.entries': '오늘 기록 전부 보기',
  'pw.benefit.themes': '전용 테마 잠금 해제',
  'pw.reminders.headline': '내 하루에 맞춘 알림.',
  'pw.reminders.subtitle': '딱 필요한 순간에 살짝 챙겨드려요.',
  'pw.history.headline': '어느 날이든 다시 보기.',
  'pw.history.subtitle': '지난 기록이 언제나 손 닿는 곳에.',
  'pw.entries.headline': '오늘 기록 전부,\n지난 날까지 모두.',
  'pw.entries.subtitle': '적은 건 하나도 놓치지 않아요.',
  'pw.themes.headline': '나만의 nu.로.',
  'pw.themes.subtitle': '집중이 잘 되는 분위기를 골라보세요.',

  'history.aria': 'nu. 지난 기록',
  'history.title': '지난 기록',
  'history.locked': '지난 날 기록 보기는 프리미엄 기능이에요.',
  'history.prev': '이전 달',
  'history.next': '다음 달',
  'history.weekdays': ['일', '월', '화', '수', '목', '금', '토'],
  'history.hint': '점이 있는 날을 누르면 기록을 볼 수 있어요.',

  'main.placeholder': '방금 끝낸 일, 그리고 다음 할 일 하나',
  'main.good': '좋음',
  'main.neutral': '보통',
  'main.tired': '피곤',
  'main.moreEmojis': '이모지 더 보기',
  'main.emojiPicker': '이모지 선택',
  'main.entries': '기록 목록',
  'main.empty': '아직 기록이 없어요 — 위에 적어보세요.',
  'main.locked': n => `오늘 이전 기록 ${n}개`,
  'main.lockedAria': n => `오늘 이전 기록 ${n}개. 프리미엄으로 잠금 해제`,
  'main.copy': '오늘 기록 복사',
  'main.copied': '복사했어요! 👍',
  'main.copyFailed': '복사 실패 — 다시 해보세요',
  'main.shareTitle': '오늘의 기록',

  'entry.deleted': '기록 삭제됨',
  'entry.undo': '되돌리기',
  'entry.delete': '삭제',
  'entry.edit': '기록 수정',
  'entry.mood': emoji => `기분 ${emoji}. 바꾸기`,
  'entry.addMood': '기분 추가',
  'entry.chooseMood': '기분 고르기',
};

const DICTS = { en, ko };

/** Translated string for `key`; entries that take values are called with `args`. Falls back to English. */
export function t(key, ...args) {
  const value = key in DICTS[lang] ? DICTS[lang][key] : en[key];
  if (value === undefined) return key;
  return typeof value === 'function' ? value(...args) : value;
}

/* ── Dates (formatted for the detected language) ── */
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Header date: "November 18" / "11월 18일" */
export function formatMonthDay(d) {
  return isKo ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${EN_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Wed, November 18, 2026" / "2026년 11월 18일 수요일" */
export function formatFullDate(d) {
  return isKo
    ? `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${KO_DAYS[d.getDay()]}요일`
    : `${EN_DAYS[d.getDay()]}, ${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Calendar heading: "November 2026" / "2026년 11월" */
export function formatMonthYear(year, month) {
  return isKo ? `${year}년 ${month + 1}월` : `${EN_MONTHS[month]} ${year}`;
}

/** Full weekday name: "Thursday" / "목요일" */
export function formatWeekday(d) {
  return d.toLocaleDateString(isKo ? 'ko-KR' : 'en-US', { weekday: 'long' });
}

/**
 * Fills the static page from the dictionary. Elements are tagged in index.html:
 * data-i18n (text), data-i18n-html (text with <br>), data-i18n-placeholder,
 * data-i18n-aria (aria-label), data-i18n-title (title).
 */
export function translatePage(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.dataset.i18nTitle)); });
}
