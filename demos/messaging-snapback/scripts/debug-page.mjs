#!/usr/bin/env node
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:8099';
const clickText = process.argv[3];

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText));
page.on('response', (res) => {
  if (res.url().includes('/assets/')) console.log('[response]', res.status(), res.url());
});
await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(2000);
if (clickText) {
  await page.getByText(clickText, { exact: false }).first().click();
  await page.waitForTimeout(3000);
}
await browser.close();
