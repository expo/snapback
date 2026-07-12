import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { assertFirstBoardPaintBudget } from './startup-timing.mjs';

assert.deepEqual(
  assertFirstBoardPaintBudget(
    { htmlReceivedMs: 10, scriptStartMs: 20, firstBoardPaintMs: 30 },
    50,
  ),
  { responseToBoardMs: 20, codeToBoardMs: 10 },
  'a genuinely fast response-to-board sample must pass',
);

const dir = mkdtempSync(join(tmpdir(), 'snapback-startup-timing-'));
try {
  // Model the exact blind spot from ENG-24386: a statically imported renderer
  // spends meaningful time in module evaluation before the entry body can set
  // scriptStartMs. The old script-to-paint check sees only the tiny tail; the
  // response-bound oracle must see and reject the full delay.
  writeFileSync(join(dir, 'renderer-web-host.mjs'), `
await new Promise((resolve) => setTimeout(resolve, 2600));
export function installContractWebHost() {}
`);
  writeFileSync(join(dir, 'entry.mjs'), `
import { performance } from 'node:perf_hooks';
import { installContractWebHost } from './renderer-web-host.mjs';
export const scriptStartMs = performance.now();
installContractWebHost();
export const firstBoardPaintMs = performance.now();
`);

  const htmlReceivedMs = performance.now();
  const entry = await import(`${pathToFileURL(join(dir, 'entry.mjs')).href}?run=${Date.now()}`);
  const timing = {
    htmlReceivedMs,
    scriptStartMs: entry.scriptStartMs,
    firstBoardPaintMs: entry.firstBoardPaintMs,
  };
  const codeToBoardMs = timing.firstBoardPaintMs - timing.scriptStartMs;
  const responseToBoardMs = timing.firstBoardPaintMs - timing.htmlReceivedMs;
  assert(codeToBoardMs < 100, `entry-body-only metric should miss the static delay: ${JSON.stringify(timing)}`);
  assert(responseToBoardMs >= 2550, `static renderer delay must be observed: ${JSON.stringify(timing)}`);
  assert.throws(
    () => assertFirstBoardPaintBudget(timing, 2200),
    /after HTML response.*entry-body diagnostic/,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('startup-timing.test.mjs: static dependency delay is included in the paint budget');
