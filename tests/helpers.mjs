import puppeteer from 'puppeteer-core';

export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const wait = ms => new Promise(r => setTimeout(r, ms));

export function dayKeyOf(d) {
  return `ij_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`;
}
export const todayKey = () => dayKeyOf(new Date());

/** A suite: `check(label, ok, extra)` prints PASS/FAIL and counts failures. */
export function suite(name) {
  let failures = 0;
  console.log(`\n■ ${name}`);
  return {
    check(label, ok, extra = '') {
      if (!ok) failures++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra && !ok ? '  ' + extra : ''}`);
    },
    section: title => console.log(`  ── ${title}`),
    get failures() { return failures; },
  };
}

export async function launch() {
  return puppeteer.launch({ executablePath: CHROME, headless: true });
}

/**
 * New phone-sized page at `url` with fresh storage set from `local` (localStorage, values are
 * strings or JSON-able) and `session` (sessionStorage), then reloaded so the app boots with it.
 */
export async function openPage(browser, url, { local = {}, session = {}, width = 393, height = 852 } = {}) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  page error:', e.message));
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(url);
  await page.evaluate((local, session) => {
    localStorage.clear();
    sessionStorage.clear();
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, local, session);
  await page.reload();
  await wait(600);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  return page;
}

export const click = (page, selector) => page.$eval(selector, el => el.click());
