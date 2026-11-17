import { suite, openPage, wait, click, todayKey } from './helpers.mjs';

// Native journal copy (Application Support file, mocked by sessionStorage): written after changes,
// restored on launch only when localStorage is empty, never overwriting what is there.
const OLD = 'ij_2026_10_3';
const file = p => p.evaluate(() => JSON.parse(sessionStorage.getItem('__journal') || 'null'));
const wipe = async (p, keep = {}) => {
  await p.evaluate(keep => {
    localStorage.clear();
    for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
  }, keep);
  await p.reload(); await wait(900);
};
const reminders = p => p.evaluate(() => JSON.parse(localStorage.getItem('nu_reminders') || 'null'));

export default async function run(browser, urls) {
  const t = suite('Journal copy (backup-safe native file)');
  const tk = todayKey();
  const settings = { enabled: true, asked: true, mode: 'random', times: ['11:00', '16:00'] };

  const p = await openPage(browser, urls.native, {
    local: {
      [tk]: [{ text: 'today one', emoji: null, time: '09:00', id: 1 }],
      [OLD]: [{ text: '옛날 기록', emoji: '☕', time: '08:00', id: 0.5 }],
      // Premium, so the sun/moon toggle can return to Paper
      ij_theme: 'paper', ij_xmas_off: 'theme', ij_premium_cached: '1', nu_reminders: settings, nu_last_export: '2026-11-10T09:00:00.000Z',
    },
  });

  t.section('writing');
  let f = await file(p);
  t.check('existing user: copy written on launch with every day', f && Object.keys(f.days).length === 2, JSON.stringify(f && Object.keys(f.days)));
  t.check('copy holds reminders, theme, opt-in shown, last export',
    f && JSON.parse(f.settings.nu_reminders).enabled === true && JSON.parse(f.settings.nu_reminders).asked === true
      && f.settings.ij_theme === 'paper' && f.settings.ij_xmas_off === 'theme' && f.settings.nu_last_export === '2026-11-10T09:00:00.000Z',
    JSON.stringify(f && f.settings));

  await p.focus('#journalInput');
  await p.keyboard.type('new entry'); await p.keyboard.press('Enter'); await wait(800);
  f = await file(p);
  t.check('new entry copied', f.days[tk].some(e => e.text === 'new entry'));
  await p.evaluate(() => document.querySelector('#timeline .log-row .log-delete').click()); await wait(800);
  f = await file(p);
  t.check('delete copied', f.days[tk].length === 1);
  await click(p, '#themeToggle'); await wait(700);
  f = await file(p);
  t.check('theme change copied', f.settings.ij_theme === 'dark', f.settings.ij_theme);
  await click(p, '#themeToggle'); await wait(700); // back to Paper

  t.section('restore after localStorage was cleared');
  const before = JSON.stringify((await file(p)).days);
  await wipe(p);
  const rows = await p.$$eval('#timeline .log-row .log-text', a => a.map(x => x.textContent));
  t.check('today\'s entries restored and shown', rows.length === 1 && rows[0] === 'today one', JSON.stringify(rows));
  t.check('past days restored', (await p.evaluate(k => localStorage.getItem(k) || '', OLD)).includes('옛날 기록'));
  t.check('theme restored and applied', await p.evaluate(() => localStorage.getItem('ij_theme') === 'paper' && document.documentElement.dataset.theme === 'paper'));
  const r = await reminders(p);
  t.check('reminders restored: on, mode, times, opt-in already shown', r && r.enabled && r.asked && r.mode === 'random' && r.times.join() === '11:00,16:00', JSON.stringify(r));
  t.check('reminders rescheduled', await p.evaluate(() => (window.__scheduled || []).length > 0));
  t.check('last export date restored', await p.evaluate(() => localStorage.getItem('nu_last_export') === '2026-11-10T09:00:00.000Z'));
  t.check('copy not overwritten with empty data', JSON.stringify((await file(p)).days) === before);

  t.section('restore when iOS permission is gone');
  await wipe(p, { __mockPermission: 'denied' });
  const off = await reminders(p);
  t.check('reminders kept off, mode and times kept', off && off.enabled === false && off.mode === 'random' && off.times.join() === '11:00,16:00', JSON.stringify(off));
  t.check('nothing scheduled', await p.evaluate(() => !(window.__scheduled || []).length));
  await click(p, '#remindBtn'); await wait(500);
  t.check('🔔 screen shows "Enable in Settings"', await p.evaluate(() => !document.getElementById('remindBlocked').hidden && !document.getElementById('remindOpenSettings').hidden));
  await p.evaluate(() => localStorage.removeItem('__mockPermission'));

  t.section('never overwrites existing values');
  // Days gone, but the theme and reminder settings still there: those stay as they are
  await wipe(p, { ij_theme: 'light', ij_xmas_off: 'theme', nu_reminders: JSON.stringify({ enabled: false, asked: true, mode: 'random', times: ['09:00'] }) });
  t.check('entries restored', (await p.$$('#timeline .log-row')).length === 1);
  t.check('existing theme kept', await p.evaluate(() => localStorage.getItem('ij_theme') === 'light'));
  const kept = await reminders(p);
  t.check('existing reminder settings kept', kept.enabled === false && kept.times.join() === '09:00', JSON.stringify(kept));
  // Days present: nothing at all is restored
  await p.evaluate(tk => { localStorage.clear(); localStorage.setItem(tk, JSON.stringify([{ text: 'only this', emoji: null, time: '10:00', id: 9 }])); }, tk);
  await p.reload(); await wait(900);
  t.check('localStorage with entries: nothing restored', await p.evaluate(old => !localStorage.getItem(old) && !localStorage.getItem('nu_last_export'), OLD));
  await p.close();

  t.section('new user');
  const fresh = await openPage(browser, urls.native, { local: { ij_theme: 'light', ij_xmas_off: 'theme' } });
  f = await file(fresh);
  t.check('empty copy, nothing invented', f && Object.keys(f.days).length === 0 && (await fresh.$$('#timeline .log-row')).length === 0);
  await fresh.close();
  return t.failures;
}
