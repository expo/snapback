#!/usr/bin/env node
// Quick verification screenshot helper: drives the system Chrome via
// playwright-core against the running `expo start --web` dev server.
// Usage: node screenshot.mjs <url> <outPath> [waitMs] [clickText]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:8099';
const outPath = process.argv[3] ?? '/tmp/messaging-screenshot.png';
const waitMs = Number(process.argv[4] ?? 2500);
const clickText = process.argv[5];

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(waitMs);
if (clickText) {
  await page.getByText(clickText, { exact: false }).first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: outPath });
await browser.close();
console.log(`wrote ${outPath}`);
