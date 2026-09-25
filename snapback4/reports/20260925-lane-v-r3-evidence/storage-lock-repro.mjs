// A Web Lock does not make another renderer's localStorage cache current.
// Run from snapback4/: node reports/20260925-lane-v-r3-evidence/storage-lock-repro.mjs
// Exit 1 means a same-epoch logout was invisible to the next lock holder.
// This standalone protocol probe uses no credentials or application data.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromiumExecutable, root } from '../../witness/lib.mjs';

const { chromium } = createRequire(join(root, 'package.json'))('playwright-core');
const server = createServer((_request, response) => response.end('<!doctype html>Storage lock probe'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true });
try {
  const context = await browser.newContext();
  const [reader, writer] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([reader, writer].map(page => page.goto(`http://127.0.0.1:${server.address().port}`)));
  let reproduced = false;
  for (let iteration = 0; iteration < 10_000; iteration++) {
    await writer.evaluate(epoch => new Promise(resolve => {
      void navigator.locks.request('session', async () => {
        localStorage.setItem('session', JSON.stringify({ principal: 'test:alice', snapback4Epoch: epoch }));
        resolve();
        await new Promise(release => window.releaseSession = release);
      });
    }), String(iteration));
    await reader.evaluate(() => {
      const captured = JSON.parse(localStorage.getItem('session'));
      window.read = navigator.locks.request('session', () => ({ captured, seen: JSON.parse(localStorage.getItem('session')) }));
    });
    await writer.evaluate(epoch => {
      localStorage.setItem('session', JSON.stringify({ snapback4Logout: epoch }));
      window.releaseSession();
    }, String(iteration));
    const { captured, seen } = await reader.evaluate(() => window.read);
    if (captured?.principal === 'test:alice' && seen?.principal === captured.principal
        && seen.snapback4Epoch === captured.snapback4Epoch && seen.snapback4Logout === undefined) {
      console.log(JSON.stringify({ iteration, captured, seenUnderLock: seen,
        after: await reader.evaluate(() => JSON.parse(localStorage.getItem('session'))) }));
      reproduced = true;
      process.exitCode = 1;
      break;
    }
  }
  if (!reproduced) console.log('No stale authorized read in 10,000 handoffs; this run does not prove coherence.');
} finally {
  await browser.close();
  server.close();
}
