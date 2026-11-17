import { suite } from './helpers.mjs';

// Reminder timing rules (pure functions, no browser)
export default async function run(_browser, urls) {
  const t = suite('Reminder schedule rules');
  const { buildSchedule, resumedRandomTimes, randomTimesFor } = await import(urls.remindersModule);

  const now = new Date(2026, 10, 17, 15, 30);
  const at = (h, m) => new Date(2026, 10, 17, h, m).getTime();
  const todayTimes = list => list.filter(r => new Date(r.at).getDate() === 17).map(r => new Date(r.at).toTimeString().slice(0, 5)).join(',');
  const times = ['15:40', '16:00', '17:00'];

  t.check('custom times always fire, even right after an entry (lastEntryAt 0)',
    todayTimes(buildSchedule({ now, times, lastEntryAt: 0 })) === '15:40,16:00,17:00');
  t.check('random: skipped within 1 hour after an entry',
    todayTimes(buildSchedule({ now, times, lastEntryAt: at(15, 25) })) === '17:00');
  t.check('random: entry 3.5 hours ago skips nothing',
    todayTimes(buildSchedule({ now, times, lastEntryAt: at(12, 0) })) === '15:40,16:00,17:00');
  t.check('"Not today" day is left out',
    todayTimes(buildSchedule({ now, times, skipDay: '2026-11-17' })) === '');

  const random = randomTimesFor(new Date(2026, 10, 18), 'seed');
  const mins = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  t.check('random day: two times between 10:00 and 20:00, at least 3 hours apart',
    random.length === 2 && mins(random[0]) >= 600 && mins(random[1]) <= 1200 && mins(random[1]) - mins(random[0]) >= 180, random.join());

  // Resume: drawn from 15 minutes after Resume until 20:00; none with under an hour left
  const resume = (h, m) => resumedRandomTimes(at(h, m), 'seed');
  const morning = resume(8, 0);
  t.check('Resume in the morning: two times from 10:00', morning.length === 2 && mins(morning[0]) >= 600, morning.join());
  const afternoon = resume(15, 45);
  t.check('Resume 15:45: two times, the first at least 15 minutes later', afternoon.length === 2 && mins(afternoon[0]) >= 15 * 60 + 60, afternoon.join());
  const evening = resume(18, 30);
  t.check('Resume 18:30: one time (under 3 hours left), after 18:45', evening.length === 1 && mins(evening[0]) >= 18 * 60 + 45 && mins(evening[0]) <= 1200, evening.join());
  t.check('Resume 19:05: less than an hour left, nothing until tomorrow', resume(19, 5).length === 0);
  t.check('Resume 21:00: nothing until tomorrow', resume(21, 0).length === 0);
  t.check('same Resume moment gives the same times', resume(15, 45).join() === afternoon.join());
  return t.failures;
}
