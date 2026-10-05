// @ref LLP 3000#publication-suite-under-contention — readiness in a replacement document cannot prove continuity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runFile } from '../../../scripts/run-client-tests.mjs';
import { createBrowserServer } from './helpers/browser-server.mjs';

for (const [name, reload, inject, history] of [
  ['page-code reload between evaluations fails the test', false, true],
  ['an explicitly allowed reload passes', true, false],
  ['an allowed reload does not excuse a later page-code reload', true, true],
  ['an undeclared same-document navigation fails', false, false, 'reject'],
  ['an explicitly allowed same-document navigation passes', false, false, 'allow'],
  ['a same-document allowance cannot excuse a reload', false, true, 'allow'],
]) test(name, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-navigation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'navigation.test.mjs');
  writeFileSync(file, `
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadBrowserPage, reloadBrowserPage } from ${JSON.stringify(new URL('./helpers/browser-server.mjs', import.meta.url).href)};
import { hangBudget } from ${JSON.stringify(new URL('./helpers/wait.mjs', import.meta.url).href)};
import { chromiumExecutable } from ${JSON.stringify(new URL('../../../witness/lib.mjs', import.meta.url).href)};
const { chromium } = createRequire(${JSON.stringify(new URL('../../../package.json', import.meta.url).href)})('playwright-core');
test('document continuity', async t => {
  const browser = await chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
  await page.route('http://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<script>window.ready = true;</script>' }));
  await loadBrowserPage(t, page, 'http://fixture.test/', { allowSameDocumentNavigation: ${history === 'allow'} });
  await page.waitForFunction(() => window.ready);
  ${history ? `await page.evaluate(() => history.replaceState(null, '', '/room'));` : ''}
  ${reload ? 'await reloadBrowserPage(page);' : ''}
  ${inject ? `
  const navigated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
  await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
  await navigated;
  ` : ''}
  // These assertions still pass after replacement, just as in the reported gap.
  await page.waitForFunction(() => window.ready);
  assert.equal(await page.evaluate(() => window.ready), true);
  t.diagnostic('readiness assertions passed');
});


`);
  let output = '';
  const result = await runFile(file, { onOutput: text => { output += text; } });
  assert.match(output, /readiness assertions passed/);
  assert.equal(result.reason, undefined, output);
  const fails = inject || history === 'reject';
  assert.equal(result.code, fails ? 1 : 0, output);
  assert.equal(result.passed, !fails, output);
  assert.equal(result.counts.fail, fails ? 1 : 0, output);
  if (fails) assert.match(output, /unexpected main-frame navigation in immutable browser fixture/);
});

test('a fixture atomically binds port zero even if Vite\'s probed port is taken', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-navigation-port-'));
  let server;
  const blocker = createServer();
  t.after(async () => {
    try { await server?.close(); }
    finally {
      await new Promise(resolve => blocker.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });
  writeFileSync(join(dir, 'index.html'), '<title>private fixture</title>');
  server = await createBrowserServer({ root: dir, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [dir] } } });
  const listen = server.httpServer.listen.bind(server.httpServer);
  let probed;
  server.httpServer.listen = (port, ...args) => {
    probed = port;
    // Vite has released its probe. Occupy that exact port before its real bind.
    const listening = once(blocker, 'listening');
    blocker.listen(port, '127.0.0.1');
    void listening.then(() => listen(port, ...args)).catch(error => server.httpServer.emit('error', error));
    return server.httpServer;
  };
  await server.listen();
  assert.ok(probed > 0, 'the control must occupy the concrete port selected by Vite');
  assert.notEqual(server.httpServer.address().port, probed);
  const url = server.resolvedUrls.local[0];
  assert.equal(Number(new URL(url).port), server.httpServer.address().port);
  assert.match(await (await fetch(url)).text(), /private fixture/);
});
