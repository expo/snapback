// After generating target/social-export, installing its dependencies, checking,
// and exporting web to dist, run this file from snapback4. Its backend is
// isolated on an ephemeral port; browser routing leaves shared port 4400 alone.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';
import { devServer, chromiumExecutable } from '../../witness/lib.mjs';
const workspace = resolve(import.meta.dirname, '../..');
const project = resolve(workspace, process.argv[2] ?? 'target/social-export');
const host = await devServer({ seed: [], sourceDir: join(project, 'snapback') });
const dir = join(project, 'dist');
const contentTypes = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.html': 'text/html' };
const web = createServer((req, res) => {
  const path = join(dir, decodeURIComponent(new URL(req.url, 'http://local').pathname));
  const file = existsSync(path) && extname(path) ? path : join(dir, 'index.html');
  res.setHeader('content-type', contentTypes[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('http://127.0.0.1:4400/**', async route => {
    const request = route.request();
    try {
      const response = await route.fetch({ timeout: 0, url: host.api + new URL(request.url()).pathname + new URL(request.url()).search });
      await route.fulfill({ response });
    } catch { await route.abort().catch(() => {}); }
  });
  await page.goto(`http://127.0.0.1:${web.address().port}`);
  await page.getByText('Continue as a guest', { exact: true }).click();
  await page.getByLabel('New post', { exact: true }).fill('A public package post');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.getByText('A public package post', { exact: true }).waitFor();
  await page.getByRole('tab', { name: /Chats/ }).click();
  await page.getByLabel('Chat title', { exact: true }).fill('Exported app chat');
  await page.getByRole('button', { name: 'Create chat', exact: true }).click();
  await page.getByTestId('composer').fill('Hello from Expo web');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Hello from Expo web', { exact: true }).waitFor();
  await page.getByTestId('composer').fill('draft stays mounted');
  await page.getByRole('button', { name: 'Leave chat', exact: true }).click();
  await page.getByText(/Membership unavailable or left/).waitFor();
  if (await page.getByTestId('composer').inputValue() !== 'draft stays mounted') throw Error('lost draft after leave');
  await page.getByText('Hello from Expo web', { exact: true }).waitFor();
  if (errors.length) throw Error(errors.join('\n'));
  console.log('PASS: installed npm client + Expo Router production web export: guest, Following post, chat, send, retained leave, stable draft; no page errors');
} finally { await browser.close(); web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); await host.close(); }
