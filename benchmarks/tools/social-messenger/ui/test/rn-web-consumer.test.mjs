import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { build } from 'esbuild';
import { chromium } from 'playwright';

const IMAGE_ONE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" fill="%235B5CE2"/%3E%3C/svg%3E';
const IMAGE_TWO =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" fill="%2317A673"/%3E%3C/svg%3E';

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address().port));
  });
}

function close(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
}

test('RN Web preserves the frozen M2 and M5 semantic contract in Chromium', async () => {
  const output = await mkdtemp(join(tmpdir(), 'social-ui-rn-web-'));
  const bundlePath = join(output, 'consumer.js');
  const htmlPath = join(output, 'index.html');
  await build({
    alias: { 'react-native': 'react-native-web' },
    bundle: true,
    entryPoints: [new URL('./rn-web-consumer.tsx', import.meta.url).pathname],
    outfile: bundlePath,
    platform: 'browser',
  });
  await writeFile(htmlPath, '<!doctype html><html><body><main id="root"></main><script src="/consumer.js"></script></body></html>');
  const server = createServer(async (request, response) => {
    const path = request.url === '/consumer.js' ? bundlePath : htmlPath;
    response.setHeader('content-type', request.url === '/consumer.js' ? 'text/javascript' : 'text/html');
    response.end(await readFile(path));
  });
  const port = await listen(server);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });

    const followingTab = page.getByTestId('sm-feed-tab-following');
    const globalTab = page.getByTestId('sm-feed-tab-global');
    await assert.doesNotReject(followingTab.waitFor());
    assert.equal(await followingTab.getAttribute('aria-selected'), 'true');
    assert.equal(await globalTab.getAttribute('aria-selected'), 'false');
    await globalTab.click();
    assert.equal(await followingTab.getAttribute('aria-selected'), 'false');
    assert.equal(await globalTab.getAttribute('aria-selected'), 'true');

    const follow = page.getByTestId('sm-profile-follow');
    assert.equal(await follow.getAttribute('aria-pressed'), 'true');
    await follow.click();
    assert.equal(await follow.getAttribute('aria-pressed'), 'false');

    const firstCard = page.getByTestId('sm-feed-item').first();
    assert.equal(await firstCard.getByTestId('sm-feed-author-avatar').getAttribute('aria-valuetext'), 'alice');
    assert.equal(await firstCard.getByTestId('sm-feed-author-avatar').getAttribute('data-source-uri'), IMAGE_ONE);
    assert.equal(await firstCard.getByTestId('sm-feed-repost-attribution').getAttribute('aria-valuetext'), 'carol');
    assert.equal(await firstCard.getByTestId('sm-feed-media').getAttribute('aria-valuetext'), 'image');
    assert.equal(await firstCard.getByTestId('sm-feed-media').getAttribute('data-source-uri'), IMAGE_ONE);
    assert.equal(await firstCard.getByTestId('sm-post-like').getAttribute('aria-pressed'), 'true');
    assert.equal(await firstCard.getByTestId('sm-post-repost').getAttribute('aria-pressed'), 'true');

    const videoMedia = page.getByTestId('sm-feed-media').nth(1);
    assert.equal(await videoMedia.getAttribute('aria-valuetext'), 'video');
    assert.equal(await videoMedia.getAttribute('data-source-uri'), IMAGE_TWO);

    assert.equal(await page.getByTestId('sm-chats-item').getAttribute('aria-valuetext'), 'dm:bob');
    assert.equal(await page.getByTestId('sm-convo-receipt').getAttribute('aria-valuetext'), 'read');

    const colors = page.getByTestId('sm-chatsettings-color');
    assert.equal(await colors.nth(0).getAttribute('aria-valuetext'), '#5B5CE2');
    assert.equal(await colors.nth(0).getAttribute('aria-pressed'), 'true');
    assert.equal(await colors.nth(1).getAttribute('aria-pressed'), 'false');
    await colors.nth(1).click();
    assert.equal(await colors.nth(0).getAttribute('aria-pressed'), 'false');
    assert.equal(await colors.nth(1).getAttribute('aria-pressed'), 'true');

    const background = page.getByTestId('sm-chatsettings-background');
    const preview = page.getByTestId('sm-chatsettings-background-preview');
    assert.equal(await preview.getAttribute('data-source-uri'), IMAGE_ONE);
    await background.click();
    await page.waitForFunction(
      ({ expected }) => document.querySelector('[data-testid="sm-chatsettings-background-preview"]')?.getAttribute('data-source-uri') === expected,
      { expected: IMAGE_TWO },
    );

    const disappearing = page.getByTestId('sm-chatsettings-disappearing');
    assert.equal(await disappearing.nth(1).getAttribute('aria-valuetext'), '24h');
    assert.equal(await disappearing.nth(1).getAttribute('aria-pressed'), 'true');

    const viewOnce = page.getByTestId('sm-convo-viewonce');
    assert.equal(await viewOnce.getAttribute('aria-valuetext'), 'unopened');
    await viewOnce.click();
    assert.equal(await viewOnce.getAttribute('aria-valuetext'), 'opened');
    assert.equal(await viewOnce.getAttribute('aria-disabled'), 'true');
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await browser.close();
    await close(server);
    await rm(output, { recursive: true, force: true });
  }
});
