// Acceptance entry: node tests/accept.mjs [--only m1,m2]
// Spins one headless Chromium, runs milestone suites, prints a tally.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/Users/ccheever/clique-sb4-20260913-full-3models/lanes/muse-snapback4/choreo/node_modules/playwright');
const { results } = await import('./helpers.mjs');
const { runM1 } = await import('./m1.mjs');
const { runM2 } = await import('./m2.mjs');
const { runM3 } = await import('./m3.mjs');
const { runM4 } = await import('./m4.mjs');
const { runM5 } = await import('./m5.mjs');

const { runLive } = await import('./m-live.mjs');
const { runM6 } = await import('./m6.mjs');
const { runM8 } = await import('./m8.mjs');
const { runM7 } = await import('./m7.mjs');

const suites = { m1: runM1, m2: runM2, m3: runM3, m4: runM4, m5: runM5, live: runLive, m6: runM6, m7: runM7, m8: runM8 };
function flagValue(name) {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return '';
}
const onlyArg = flagValue('--only');
const milestoneArg = flagValue('--milestone');
const only = new Set(
  milestoneArg ? milestoneArg.split(',').filter((x) => Object.hasOwn(suites, x)) : onlyArg ? onlyArg.split(',') : Object.keys(suites),
);
if (milestoneArg && [...only].length === 0) {
  console.log(`unknown milestone: ${milestoneArg}`);
  process.exit(2);
}

const browser = await chromium.launch();
let threw = null;
try {
  for (const [name, fn] of Object.entries(suites)) {
    if (!only.has(name)) continue;
    console.log(`--- suite ${name} ---`);
    try {
      await fn(browser);
    } catch (e) {
      threw = threw ?? e;
      console.log(`SUITE-ERROR ${name}: ${String(e && e.stack || e).slice(0, 500)}`);
    }
  }
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok);
console.log(`\nTALLY total=${results.length} pass=${pass} fail=${fail.length}`);
for (const f of fail) console.log(`FAIL ${f.id} — ${f.detail}`);
process.exit(fail.length || threw ? 1 : 0);
