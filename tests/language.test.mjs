import { suite, openPage, wait, click, todayKey } from './helpers.mjs';

// Korean UI when the iPhone's preferred language is Korean, English otherwise (no in-app switch).
const KO_LINES = [
  '좋은 아침! 첫 번째 작은 할 일은 뭐예요?', '방금 뭐 끝냈어요? 한 줄이면 충분해요.', '커피 한 잔 들었어요? 다음 할 일 적어봐요.', '지금 뭐 하고 있어요?',
  '잠깐, 다음엔 뭐 할 거예요?', '어디까지 했어요? 적어두고 다시 하던 거 해요.', '흐름 놓쳤어요? 한 줄이면 다시 돌아와요.', '점심, 회의, 쇼츠… 방금 뭐 했어요?', '오후 체크인: 방금 무슨 일 있었어요?',
  "뭐라도 했어요? '물 마심'도 기록이에요.", '마무리 중이에요? 방금 끝낸 일 한 줄만요.', '잠깐 체크인: 지금 뭐 하는 중이에요?', '짧게 하나만: 지금 손에 잡은 일은?',
  '선물 고르는 중? 방금 한 일 적어봐요 🎁', '머리가 안 돌아가요? ❄️ 마지막에 한 거 하나만 적어봐요.', '포근하게 한 줄: 다음 할 일 하나만 🎄',
];
const hangul = s => /[가-힣]/.test(s);

const read = p => p.evaluate(() => ({
  lang: document.documentElement.lang,
  placeholder: document.getElementById('journalInput').placeholder,
  date: document.querySelector('#dateText .date-month').textContent,
  empty: (document.querySelector('.empty-hint') || {}).textContent || '',
  copy: document.getElementById('copyBtn').textContent,
  toast: document.getElementById('entryToast').textContent.replace(/\s+/g, ''),
  rmTitle: document.querySelector('#remindOverlay .modal-brand').textContent,
  rmWhen: document.getElementById('remindHintWhen').textContent,
  rmNext: document.getElementById('remindNext').textContent,
  swatch: document.querySelector('[data-swatch="paper"] .swatch-label').textContent,
  weekdays: [...document.querySelectorAll('#calWeekdays span')].map(s => s.textContent).join(''),
  bodies: (window.__scheduled || []).map(r => r.body),
  recap: window.__recap ? window.__recap.body : null,
  recap5: (window.__recapBodies || [])[4] || null,
}));

export default async function run(browser, urls) {
  const t = suite('Language (Korean / English by device)');
  const local = { ij_theme: 'light', ij_xmas_off: 'theme', nu_reminders: { enabled: true, asked: true, mode: 'random', times: ['11:00'] } };

  t.section('Korean iPhone');
  const ko = await openPage(browser, urls.native, { local, language: 'ko-KR' });
  await click(ko, '#remindBtn'); await wait(500);
  let s = await read(ko);
  const m = new Date();
  t.check('html lang is ko', s.lang === 'ko', s.lang);
  t.check('placeholder in Korean', s.placeholder === '방금 끝낸 일, 그리고 다음 할 일 하나', s.placeholder);
  t.check('header date in Korean', s.date === `${m.getMonth() + 1}월 ${m.getDate()}일`, s.date);
  t.check('empty list hint in Korean', s.empty === '아직 기록이 없어요 — 위에 적어보세요.', s.empty);
  t.check('undo toast in Korean', s.toast === '기록삭제됨·되돌리기', s.toast);
  t.check('🔔 screen title in Korean', s.rmTitle === '알림', s.rmTitle);
  t.check('random window line in Korean (24-hour device)', s.rmWhen === '하루 두 번, 10:00~20:00 사이에 와요.', s.rmWhen);
  t.check('next reminder line in Korean', /^다음 알림: (오늘|내일) \d/.test(s.rmNext), s.rmNext);
  t.check('theme names stay in English', s.swatch === 'Paper', s.swatch);
  const recapLine = await ko.evaluate(() => document.getElementById('remindHintRecap').textContent);
  t.check('recap line in Korean', recapLine === '기록한 날엔 저녁 8시 30분에 짧은 요약이 와요.', recapLine);
  t.check('themes popup: title then swatches, no subtitle', await ko.evaluate(() => !document.querySelector('#premiumUnlocked .modal-price-line')));
  t.check('recap texts in Korean (native bumps use these)', s.recap5 === '오늘 5개 기록했어요. 알찬 하루였어요.', s.recap5);
  t.check('calendar weekdays in Korean', s.weekdays === '일월화수목금토', s.weekdays);
  t.check('scheduled check-ins use the Korean pool', s.bodies.length > 0 && s.bodies.every(b => KO_LINES.includes(b)), s.bodies.join(' | '));
  // Every visible text node has Korean in it (times, emoji and the nu. logo aside)
  const leftovers = await ko.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode, text = n.textContent.trim();
      if (!text || !/[A-Za-z]{2,}/.test(text) || /[가-힣]/.test(text)) continue;
      if (n.parentElement.closest('script,style,svg,.day-block,.paywall-title,.theme-swatch')) continue; // "nu. Premium" stays English
      out.push(text);
    }
    return out;
  });
  t.check('no English text left in the page', leftovers.length === 0, leftovers.join(' | '));
  await ko.close();

  t.section('Korean: entries and copy');
  const ko2 = await openPage(browser, urls.native, { language: 'ko', local: { ...local, [todayKey()]: [{ text: '메일 보냄', emoji: null, time: '09:00', id: Date.now() - 3600000 }] } });
  s = await read(ko2);
  t.check('copy button in Korean', s.copy === '오늘 기록 복사', s.copy);
  if (new Date().getHours() * 60 + new Date().getMinutes() < 20 * 60 + 30) t.check('evening recap in Korean', s.recap === '오늘 1개 기록했어요. 그거면 충분해요.', s.recap);
  await ko2.close();

  t.section('Back up & restore: last backup line');
  const lastOf = async (language, extra) => {
    const p = await openPage(browser, urls.native, { language, local: { ...local, ij_premium_cached: '1', [todayKey()]: [{ text: 'x', emoji: null, time: '09:00', id: 1 }], ...extra } });
    await click(p, '#historyBtn'); await wait(300); await click(p, '#backupBtn'); await wait(300);
    const out = await p.evaluate(() => [document.getElementById('backupSummary').textContent, document.getElementById('backupLast').textContent]);
    if (!extra.nu_last_export && language === 'en-US') t.check('backup sheet opens on top of History', await p.evaluate(() => document.elementFromPoint(196, 426).closest('.modal-overlay')?.id === 'backupOverlay'));
    await p.close();
    return out;
  };
  const y = new Date().getFullYear();
  let [count, last] = await lastOf('en-US', {});
  t.check('en: count without "on this phone"', count === '1 entry across 1 day.', count);
  t.check('en: never backed up', last === 'Last backup: never', last);
  [, last] = await lastOf('en-US', { nu_last_export: new Date(y, 10, 12, 9).toISOString() });
  t.check('en: "Last backup: Nov 12" this year', last === 'Last backup: Nov 12', last);
  [, last] = await lastOf('en-US', { nu_last_export: new Date(y - 1, 10, 12, 9).toISOString() });
  t.check('en: year added for another year', last === `Last backup: Nov 12, ${y - 1}`, last);
  [count, last] = await lastOf('ko-KR', {});
  t.check('ko: count', count === '1일 동안 1개 기록', count);
  t.check('ko: never backed up', last === '마지막 백업: 없음', last);
  [, last] = await lastOf('ko-KR', { nu_last_export: new Date(y, 10, 12, 9).toISOString() });
  t.check('ko: "마지막 백업: 11월 12일"', last === '마지막 백업: 11월 12일', last);

  t.section('English iPhone (and any other language)');
  for (const language of ['en-US', 'ja-JP']) {
    const en = await openPage(browser, urls.native, { local, language });
    await click(en, '#remindBtn'); await wait(500);
    s = await read(en);
    t.check(`${language}: placeholder in English`, s.placeholder === 'What did you just finish? What is the next tiny step?', s.placeholder);
    t.check(`${language}: no Korean in the 🔔 screen`, !hangul(s.rmTitle + s.rmWhen + s.rmNext), s.rmWhen);
    t.check(`${language}: check-ins in English`, s.bodies.length > 0 && !s.bodies.some(hangul), s.bodies.join(' | '));
    await en.close();
  }
  return t.failures;
}
