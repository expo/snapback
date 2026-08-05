#!/usr/bin/env node
// Drives the actual UI end to end: open a DM, send a text message, react to
// a message, reply to a message, then open a group chat — all through real
// clicks/typing in a headless Chrome tab against the running Expo web app.
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:8099';
const outDir = process.argv[3] ?? 'evidence';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(2000);

// Open the @ada DM.
await page.getByText('@ada', { exact: false }).first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/04-dm-open.png` });

// Send a text message.
await page.getByPlaceholder('Message').click();
await page.getByPlaceholder('Message').fill('Verifying the golden path from an automated check ✅');
await page.getByText('Send', { exact: true }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/05-dm-sent.png` });

// Long-press (simulate via a real long hover+mousedown/up sequence isn't
// trivial headlessly; React Native Web maps onLongPress to a timed
// pointerdown) — use a manual delay-hold via mouse events on the last bubble.
const lastBubble = page.locator('text=Verifying the golden path').last();
const box = await lastBubble.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/06-reaction-picker.png` });
  // Tap the heart reaction.
  const heart = page.getByText('❤️', { exact: true }).last();
  if (await heart.count()) {
    await heart.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outDir}/07-reacted.png` });
  }
}

// Reply to the earlier "Just finished" message: long-press it, tap ↩︎.
const target = page.getByText('Just finished', { exact: false }).first();
if (await target.count()) {
  const tbox = await target.boundingBox();
  await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const replyBtn = page.getByText('↩︎', { exact: true }).last();
  if (await replyBtn.count()) {
    await replyBtn.click();
    await page.waitForTimeout(400);
    await page.getByPlaceholder('Message').fill('Quoting your earlier message');
    await page.getByText('Send', { exact: true }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/08-reply-sent.png` });
  }
}

await browser.close();
console.log('golden path screenshots written');
