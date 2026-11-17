import { suite, openPage, wait, click, todayKey } from './helpers.mjs';

// The 🔔 screen on "iPhone" (mocked native plugins): Premium lock, next reminder, Paused for today · Resume.
const state = p => p.evaluate(() => {
  const d = new Date().getDate();
  return {
    paused: !document.getElementById('remindPaused').hidden,
    // spaced by CSS gap, so the text itself has no spaces around "·"
    pausedText: document.getElementById('remindPaused').textContent.replace(/\s+/g, ' ').trim(),
    next: document.getElementById('remindNext').hidden ? '' : document.getElementById('remindNext').textContent,
    lines: [...document.querySelectorAll('#remindHint p')].filter(x => !x.hidden).map(x => x.textContent),
    today: (window.__scheduled || []).filter(r => new Date(r.at).getDate() === d).length,
    calls: window.__calls.join(),
    pill: getComputedStyle(document.querySelector('[data-mode="custom"] .rm-tag')).display !== 'none',
  };
});

async function settingsPage(browser, url, { mode = 'random', premium = '0', paused = false, times = ['23:50'], entryMinutesAgo = null } = {}) {
  const local = {
    ij_theme: 'light', ij_xmas_off: 'theme', ij_premium_cached: premium,
    nu_reminders: { enabled: true, asked: true, mode, times },
  };
  if (paused) local.__mockSkip = '1';
  if (entryMinutesAgo !== null) local[todayKey()] = [{ text: 'x', emoji: null, time: '12:00', id: Date.now() - entryMinutesAgo * 60000 }];
  const p = await openPage(browser, url, { local });
  await click(p, '#remindBtn'); await wait(500);
  return p;
}

export default async function run(browser, urls) {
  const t = suite('Reminders screen');
  const late = new Date().getHours() >= 23; // "today" checks need some day left

  t.section('Premium lock');
  let p = await settingsPage(browser, urls.native, { premium: '0' });
  t.check('free: "At my times" shows the Premium pill', (await state(p)).pill);
  await click(p, '[data-mode="custom"]'); await wait(300);
  t.check('free: "At my times" opens the paywall with the reminders headline',
    await p.evaluate(() => document.getElementById('paywallOverlay').classList.contains('visible') && document.getElementById('paywallHeadline').textContent === 'Reminders on your schedule.'));
  await p.close();
  p = await settingsPage(browser, urls.native, { premium: '1' });
  t.check('premium: no Premium pill', !(await state(p)).pill);
  await p.close();

  t.section('Hints and next reminder');
  p = await settingsPage(browser, urls.native, { mode: 'random' });
  let s = await state(p);
  t.check('random: next reminder shown', /^Next reminder: (Today|Tomorrow) at \d/.test(s.next), s.next);
  t.check('random: 1-hour skip rule shown', s.lines.includes('Skipped if you logged in the last hour.'), JSON.stringify(s.lines));
  await p.close();
  p = await settingsPage(browser, urls.native, { mode: 'custom', premium: '1', entryMinutesAgo: 5 });
  s = await state(p);
  t.check('custom: no skip rule line', !s.lines.some(l => l.startsWith('Skipped')), JSON.stringify(s.lines));
  if (!late) t.check('custom: fires even 5 minutes after an entry', s.next === 'Next reminder: Today at 23:50', s.next);
  await p.close();

  t.section('Paused for today · Resume');
  p = await settingsPage(browser, urls.native, { mode: 'random', paused: true });
  s = await state(p);
  t.check('paused: "Paused for today · Resume" shown', s.paused && s.pausedText === 'Paused for today·Resume', s.pausedText);
  t.check('paused: next reminder is tomorrow, nothing today', s.next.startsWith('Next reminder: Tomorrow') && s.today === 0, s.next);
  await click(p, '#remindResume'); await wait(400);
  s = await state(p);
  t.check('Resume: line hides, "Not today" cleared natively', !s.paused && s.calls.includes('clearSkipDay'));
  const minsLeft = 20 * 60 - (new Date().getHours() * 60 + new Date().getMinutes());
  if (minsLeft >= 60) t.check('Resume: random check-ins back today', s.today > 0 && s.next.startsWith('Next reminder: Today'), s.next);
  else t.check('Resume after 19:00: random check-ins start tomorrow', s.today === 0 && s.next.startsWith('Next reminder: Tomorrow'), s.next);
  await p.close();

  p = await settingsPage(browser, urls.native, { mode: 'custom', premium: '1', paused: true });
  await p.$eval('#remindAddTime', el => { el.value = '23:55'; el.dispatchEvent(new Event('blur')); }); await wait(400);
  s = await state(p);
  t.check('adding a time resumes today', !s.paused && s.calls.includes('clearSkipDay') && (late || s.today === 2), JSON.stringify(s));
  await p.close();

  p = await settingsPage(browser, urls.native, { mode: 'custom', premium: '1', paused: true });
  await click(p, '[data-mode="random"]'); await wait(400);
  t.check('switching mode resumes today', (await state(p)).calls.includes('clearSkipDay'));
  await p.close();

  p = await settingsPage(browser, urls.native, { mode: 'random', paused: true });
  await click(p, '[data-mode="random"]'); await wait(400);
  s = await state(p);
  t.check('tapping the current mode does not resume', s.paused && !s.calls.includes('clearSkipDay'));
  await click(p, '#remindEnabled'); await wait(400);
  await click(p, '#remindEnabled'); await wait(400);
  s = await state(p);
  t.check('turning reminders off and on resumes today', !s.paused && s.calls.includes('clearSkipDay'));
  await p.close();
  return t.failures;
}
