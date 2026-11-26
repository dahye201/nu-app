import { suite, openPage, wait, click, todayKey, dayKeyOf } from './helpers.mjs';

// Home screen widget: the latest entry time handed to the native side, and opening from the widget
// (nu://write) going straight to the input.
const at = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
const focused = p => p.evaluate(() => document.activeElement?.id === 'journalInput');

export default async function run(browser, urls) {
  const t = suite('Home screen widget');
  const tk = todayKey();
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yk = dayKeyOf(yesterday);
  const nine = at(now, 9, 0);

  t.section('latest entry time');
  const p = await openPage(browser, urls.native, {
    local: {
      [yk]: [{ text: 'yesterday', emoji: null, time: '22:00', id: at(yesterday, 22, 0) }],
      // An id that is not a time (old test data, imports): the day and HH:MM are used
      [tk]: [{ text: 'morning', emoji: null, time: '08:30', id: 1 }, { text: 'nine', emoji: null, time: '09:00', id: nine }],
    },
  });
  t.check('sent on launch: newest entry of all days', await p.evaluate(() => window.__widgetAt) === nine, String(await p.evaluate(() => window.__widgetAt)));

  await p.focus('#journalInput');
  await p.keyboard.type('just now'); await p.keyboard.press('Enter'); await wait(800);
  const added = await p.evaluate(k => JSON.parse(localStorage.getItem(k)).find(e => e.text === 'just now').id, tk);
  t.check('new entry: its time is sent', await p.evaluate(() => window.__widgetAt) === added);

  const sends = await p.evaluate(() => window.__widgetSends.length);
  await p.evaluate(k => {
    const list = JSON.parse(localStorage.getItem(k));
    list.find(e => e.text === 'nine').text = 'nine (edited)';
    localStorage.setItem(k, JSON.stringify(list));
  }, tk);
  await click(p, '#themeToggle'); await wait(800); // any change writes the journal copy
  t.check('change that keeps the latest time: nothing re-sent', await p.evaluate(() => window.__widgetSends.length) === sends);
  await click(p, '#themeToggle'); await wait(500);

  await p.evaluate(() => document.querySelector('#timeline .log-row .log-delete').click()); await wait(800);
  t.check('newest entry deleted: the one before it is sent', await p.evaluate(() => window.__widgetAt) === nine, String(await p.evaluate(() => window.__widgetAt)));

  for (let i = 0; i < 2; i++) { await p.evaluate(() => document.querySelector('#timeline .log-row .log-delete').click()); await wait(800); }
  t.check('all of today deleted: yesterday\'s last entry is sent', await p.evaluate(() => window.__widgetAt) === at(yesterday, 22, 0), String(await p.evaluate(() => window.__widgetAt)));
  await p.close();

  const fresh = await openPage(browser, urls.native);
  t.check('new user, no entries: null is sent', await fresh.evaluate(() => window.__widgetAt === null));
  await fresh.close();

  t.section('opening from the widget');
  const q = await openPage(browser, urls.native, { local: { [tk]: [{ text: 'x', emoji: null, time: '09:00', id: nine }] } });
  await q.evaluate(() => sessionStorage.setItem('__widgetWrite', '1'));
  await q.reload(); await wait(900);
  t.check('launched from the widget: input focused', await focused(q));
  t.check('request taken once', await q.evaluate(() => sessionStorage.getItem('__widgetWrite') === null));

  await q.evaluate(() => document.activeElement.blur());
  await click(q, '#historyBtn'); await wait(300); // free: opens the paywall
  t.check('(a popup is open)', await q.evaluate(() => !!document.querySelector('.modal-overlay.visible')));
  await q.evaluate(() => window.__openFromWidget()); await wait(300);
  t.check('while running: popups closed', await q.evaluate(() => !document.querySelector('.modal-overlay.visible') && document.body.style.overflow === ''));
  t.check('while running: input focused', await focused(q));

  await q.evaluate(() => document.querySelector('#timeline .log-row .log-entry').click()); await wait(300);
  await q.keyboard.type(' more');
  await q.evaluate(() => window.__openFromWidget()); await wait(400);
  const text = await q.evaluate(k => JSON.parse(localStorage.getItem(k))[0].text, tk);
  t.check('entry being edited is saved first', text === 'x more' && !(await q.evaluate(() => !!document.querySelector('.log-row.editing'))), text);
  t.check('then input focused', await focused(q));
  await q.close();

  t.section('web build');
  const w = await openPage(browser, urls.web, { local: { [tk]: [{ text: 'x', emoji: null, time: '09:00', id: nine }] } });
  t.check('no widget calls on the web', await w.evaluate(() => window.__widgetAt === undefined));
  await w.close();

  return t.failures;
}
