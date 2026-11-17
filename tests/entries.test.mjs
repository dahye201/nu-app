import { suite, openPage, wait, todayKey, dayKeyOf, click } from './helpers.mjs';

// Edit (tap), delete (swipe, with Undo), in today's list and History, in every free theme.
const SEED = [
  { text: 'Opened my laptop', emoji: null, time: '09:12', id: 1000 },
  { text: '점심 먹고 샤워하기', emoji: '😐', time: '12:40', id: 2000 },
  { text: 'Finished the report ✅', emoji: '🧠', time: '15:05', id: 3000, pid: 'reply-abc' },
];
// The toast's text: "Entry deleted", a "·" separator, the Undo button (spaced by CSS gap, not text)
const TOAST_TEXT = 'Entry deleted·Undo';

const stored = (p, key = todayKey()) => p.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), key);
const rowBox = (p, id, scope = '#timeline') => p.$eval(`${scope} .log-row[data-id="${id}"] .log-entry`, el => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
async function tapAt(p, x, y) { await p.touchscreen.tap(x, y); await wait(150); }
async function swipe(p, box, distance) {
  const y = box.y + box.h / 2;
  const x0 = box.x + box.w - 20;
  await p.touchscreen.touchStart(x0, y);
  for (let i = 1; i <= 12; i++) { await p.touchscreen.touchMove(x0 - (distance * i) / 12, y); await wait(10); }
  await p.touchscreen.touchEnd();
  await wait(350);
}
const toastState = p => p.$eval('#entryToast', el => ({ visible: el.classList.contains('visible'), text: el.textContent.replace(/\s+/g, ' ').trim() }));
const tombstones = p => p.evaluate(() => JSON.parse(localStorage.getItem('nu_deleted_pids') || '[]').map(x => x.pid));

function themePage(browser, url, theme, premium = '0', extra = {}) {
  return openPage(browser, url, {
    local: {
      [todayKey()]: SEED, ...extra, ij_theme: theme, ij_premium_cached: premium,
      ...(['snow', 'christmas'].includes(theme) ? {} : { ij_xmas_off: 'theme' }),
    },
  });
}

export default async function run(browser, urls) {
  const t = suite('Entries: edit, delete, undo');

  for (const theme of ['light', 'dark', 'christmas', 'snow']) {
    t.section(theme);
    const p = await themePage(browser, urls.web, theme);

    let box = await rowBox(p, 1000);
    await tapAt(p, box.x + 120, box.y + box.h / 2);
    t.check('tap opens the inline editor', await p.evaluate(() => document.activeElement?.classList.contains('log-text') && !!document.querySelector('.log-row.editing')));
    await p.keyboard.type(' and made coffee');
    await p.keyboard.press('Enter'); await wait(200);
    let e = (await stored(p)).find(x => x.id === 1000);
    t.check('English edit saved, time unchanged', e.text === 'Opened my laptop and made coffee' && e.time === '09:12', JSON.stringify(e));

    box = await rowBox(p, 2000);
    await tapAt(p, box.x + 120, box.y + box.h / 2);
    await p.keyboard.type(' 완료');
    await p.$eval('#timeline .log-row.editing .log-mood', el => el.click()); await wait(150);
    t.check('mood panel opens while editing', !!(await p.$('#entryMoodPanel')));
    await p.$eval('#entryMoodPanel button:nth-child(1)', el => el.click()); await wait(100);
    const stillEditing = await p.evaluate(() => !!document.querySelector('.log-row.editing'));
    await tapAt(p, 200, 820); await wait(200);
    e = (await stored(p)).find(x => x.id === 2000);
    t.check('Korean edit + mood saved on tap outside, time unchanged', stillEditing && e.text === '점심 먹고 샤워하기 완료' && e.emoji !== '😐' && e.time === '12:40', JSON.stringify(e));

    box = await rowBox(p, 2000);
    await tapAt(p, box.x + 120, box.y + box.h / 2);
    await p.$eval('#timeline .log-row.editing .log-mood', el => el.click()); await wait(120);
    await p.$eval('#entryMoodPanel button.selected', el => el.click()); await wait(100);
    await p.keyboard.press('Enter'); await wait(200);
    e = (await stored(p)).find(x => x.id === 2000);
    t.check('tapping the same mood clears it', e.emoji === null, JSON.stringify(e));

    box = await rowBox(p, 3000);
    await swipe(p, box, 110);
    const revealedW = await p.$eval('#timeline .log-row[data-id="3000"] .log-delete', el => el.getBoundingClientRect().width);
    t.check('partial swipe reveals the red Delete action', revealedW > 60, `width=${Math.round(revealedW)}`);
    await p.$eval('#timeline .log-row[data-id="3000"] .log-delete', el => el.click()); await wait(250);
    let list = await stored(p);
    const toast = await toastState(p);
    t.check('Delete removes the entry and shows "Entry deleted · Undo"', !list.some(x => x.id === 3000) && toast.visible && toast.text === TOAST_TEXT, JSON.stringify(toast));
    t.check('deleted notification reply is remembered (won\'t come back)', (await tombstones(p)).includes('reply-abc'));
    if (theme === 'snow') {
      const snowTop = await p.$eval('.snow-bottom', el => el.getBoundingClientRect().top);
      const toastBottom = await p.$eval('#entryToast', el => el.getBoundingClientRect().bottom);
      t.check('toast sits above the snow bank', toastBottom <= snowTop + 1, `toastBottom=${Math.round(toastBottom)} snowTop=${Math.round(snowTop)}`);
    }
    await click(p, '#entryToast button'); await wait(200);
    list = await stored(p);
    e = list.find(x => x.id === 3000);
    const order = list.map(x => x.id).join(',');
    const shown = await p.$$eval('#timeline .log-row', rows => rows.map(r => r.dataset.id).join(','));
    t.check('Undo restores with original time, mood and place', e && e.time === '15:05' && e.emoji === '🧠' && e.pid === 'reply-abc' && order === '1000,2000,3000' && shown === '3000,2000,1000', `stored=${order} shown=${shown}`);
    t.check('Undo forgets the deleted-reply note', !(await tombstones(p)).includes('reply-abc'));

    box = await rowBox(p, 1000);
    await swipe(p, box, box.w * 0.8);
    list = await stored(p);
    t.check('full swipe deletes directly', !list.some(x => x.id === 1000) && (await toastState(p)).visible);
    await click(p, '#entryToast button'); await wait(200);

    box = await rowBox(p, 1000);
    await tapAt(p, box.x + 120, box.y + box.h / 2);
    await p.evaluate(() => { document.querySelector('.log-row.editing .log-text').textContent = ''; });
    await p.keyboard.press('Enter'); await wait(250);
    list = await stored(p);
    t.check('empty text + save deletes, with Undo', !list.some(x => x.id === 1000) && (await toastState(p)).visible);
    await click(p, '#entryToast button'); await wait(200);

    box = await rowBox(p, 2000);
    await swipe(p, box, box.w * 0.8);
    const copied = await p.evaluate(() => {
      let out = '';
      navigator.clipboard.writeText = async text => { out = text; };
      document.getElementById('copyBtn').click();
      return new Promise(r => setTimeout(() => r(out), 100));
    });
    t.check('deleted entry not in Copy today\'s log', !!copied && !copied.includes('점심'), JSON.stringify(copied));
    await p.close();
  }

  t.section('locked row (free, 7 entries)');
  {
    const seven = Array.from({ length: 7 }, (_, i) => ({ text: 'entry ' + i, emoji: null, time: `1${i}:00`, id: 100 + i }));
    const p = await openPage(browser, urls.web, { local: { [todayKey()]: seven, ij_theme: 'light', ij_xmas_off: 'theme' } });
    t.check('locked row is not swipeable or editable', await p.evaluate(() => { const r = document.querySelector('.locked-row'); return !!r && !r.closest('.log-row'); }));
    await p.close();
  }

  t.section('History (premium)');
  {
    const d = new Date(); d.setDate(d.getDate() - 2);
    const pastKey = dayKeyOf(d);
    const p = await themePage(browser, urls.web, 'light', '1', { [pastKey]: [{ text: 'Old entry', emoji: '☕', time: '08:30', id: 500 }, { text: '두 번째', emoji: null, time: '10:00', id: 600 }] });
    await click(p, '#historyBtn'); await wait(300);
    await p.evaluate(() => [...document.querySelectorAll('.cal-day')].filter(x => x.querySelector('.cal-dot'))[0].click());
    await wait(300);
    let box = await rowBox(p, 500, '#archiveDayList');
    await tapAt(p, box.x + 100, box.y + box.h / 2);
    await p.keyboard.type(' ☕☕');
    await p.keyboard.press('Enter'); await wait(250);
    const e = (await stored(p, pastKey)).find(x => x.id === 500);
    t.check('edit saved, time unchanged', e.text === 'Old entry ☕☕' && e.time === '08:30', JSON.stringify(e));
    box = await rowBox(p, 600, '#archiveDayList');
    await swipe(p, box, box.w * 0.8);
    let list = await stored(p, pastKey);
    const z = await p.$eval('#entryToast', el => +getComputedStyle(el).zIndex);
    t.check('full swipe deletes; toast shows above the popup', !list.some(x => x.id === 600) && (await toastState(p)).visible && z > 210);
    await click(p, '#entryToast button'); await wait(250);
    list = await stored(p, pastKey);
    const shown = await p.$$eval('#archiveDayList .log-row', rows => rows.map(r => r.dataset.id).join(','));
    t.check('Undo restores in place', list.map(x => x.id).join(',') === '500,600' && shown === '600,500', `shown=${shown}`);
    t.check('Back up & restore is inside History', await p.evaluate(() => !!document.querySelector('#archiveOverlay #backupBtn') && !document.querySelector('.container #backupBtn')));
    await p.close();
  }
  return t.failures;
}
