// UI and logic tests. Run with `npm test` (needs Google Chrome; set CHROME_PATH if it lives elsewhere).
//
// Two builds of the app are tested in headless Chrome:
//  - web:    www/index.html with the normal bundle (as in a browser, no native features)
//  - native: the same page with tests/mock-capacitor.js standing in for iPhone (reminders, journal file)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests', '.out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'native'), { recursive: true });

await esbuild.build({ entryPoints: [path.join(root, 'src/app.js')], bundle: true, outfile: path.join(root, 'www/bundle.js'), logLevel: 'error' });
await esbuild.build({
  entryPoints: [path.join(root, 'src/app.js')], bundle: true, logLevel: 'error',
  outfile: path.join(out, 'native/bundle.js'),
  alias: { '@capacitor/core': path.join(root, 'tests/mock-capacitor.js') },
});
fs.copyFileSync(path.join(root, 'www/index.html'), path.join(out, 'native/index.html'));
fs.cpSync(path.join(root, 'www/seasonal'), path.join(out, 'native/seasonal'), { recursive: true });
// Pure functions for the logic tests, bundled for Node
await esbuild.build({
  entryPoints: [path.join(root, 'src/reminders.js')], bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
  outfile: path.join(out, 'reminders.node.mjs'),
});

const urls = {
  web: pathToFileURL(path.join(root, 'www/index.html')).href,
  native: pathToFileURL(path.join(out, 'native/index.html')).href,
  remindersModule: pathToFileURL(path.join(out, 'reminders.node.mjs')).href,
};

const suites = ['schedule', 'entries', 'reminders', 'journal'];
const only = process.argv.slice(2);
const browser = await launch();
let failures = 0;
try {
  for (const name of suites.filter(s => !only.length || only.includes(s))) {
    const { default: run } = await import(`./${name}.test.mjs`);
    failures += await run(browser, urls);
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n✗ ${failures} failing` : '\n✓ all passing');
process.exit(failures ? 1 : 0);
