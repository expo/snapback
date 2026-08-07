// UI interaction proof for Rematch (Expo web build) driven through real Chrome.
// Proves: seeded data render, live typing indicators between two clients,
// live message delivery, reply pointers, emoji reactions, and an image
// message picker→upload→render end to end — all through the product UI.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:8095';
const ART = new URL('./artifacts/', import.meta.url).pathname;
mkdirSync(ART, { recursive: true });

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message ?? error) });
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
    throw error;
  }
};

const sel = (id) => `[data-testid="${id}"]`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const contextA = await browser.newContext({ viewport: { width: 480, height: 860 } });
  const contextB = await browser.newContext({ viewport: { width: 480, height: 860 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  pageA.on('pageerror', (e) => console.log('pageA error:', e.message));
  pageB.on('pageerror', (e) => console.log('pageB error:', e.message));

  await step('boot: Ada sees seeded conversation list', async () => {
    await pageA.goto(APP_URL);
    await pageA.waitForSelector(sel('conversation-conv_weekend_ride'), { timeout: 45_000 });
    assert.ok(await pageA.getByText('Weekend Ride 🚴').first().isVisible());
    await pageA.screenshot({ path: `${ART}01-ada-conversation-list.png` });
  });

  await step('boot: Grace persona switch + same list', async () => {
    await pageB.goto(APP_URL);
    await pageB.waitForSelector(sel('persona-grace'), { timeout: 45_000 });
    await pageB.click(sel('persona-grace'));
    await pageB.waitForSelector(sel('conversation-conv_weekend_ride'), { timeout: 30_000 });
    await pageB.screenshot({ path: `${ART}02-grace-conversation-list.png` });
  });

  await step('open group chat on both; seeded history + seeded reactions render', async () => {
    await pageA.click(sel('conversation-conv_weekend_ride'));
    await pageA.waitForSelector(sel('message-msg_7'), { timeout: 30_000 });
    assert.ok(await pageA.getByText('coast road, 60km', { exact: false }).first().isVisible());
    // seeded reaction chips on msg_7 (🔥 from ada, 👍 from grace)
    await pageA.waitForSelector(sel('reaction-msg_7-🔥'), { timeout: 15_000 });
    await pageA.waitForSelector(sel('reaction-msg_7-👍'), { timeout: 15_000 });
    // seeded reply pointer: msg_8 quotes msg_7
    await pageB.click(sel('conversation-conv_weekend_ride'));
    await pageB.waitForSelector(sel('message-msg_8'), { timeout: 30_000 });
    await pageA.screenshot({ path: `${ART}03-ada-chat-seeded.png` });
  });

  await step('typing indicator: Grace types, Ada sees it live', async () => {
    await pageB.fill(sel('composer-input'), 'On my way to the start');
    await pageA.waitForSelector(sel('typing-indicator'), { timeout: 15_000 });
    const text = await pageA.textContent(sel('typing-indicator'));
    assert.match(text, /Grace Hopper is typing/u);
    await pageA.screenshot({ path: `${ART}04-ada-sees-grace-typing.png` });
  });

  await step('typing indicator: Ada types, Grace sees it live', async () => {
    await pageA.fill(sel('composer-input'), 'Bringing spare tubes');
    await pageB.waitForSelector(sel('typing-indicator'), { timeout: 15_000 });
    const text = await pageB.textContent(sel('typing-indicator'));
    assert.match(text, /Ada Lovelace is typing/u);
  });

  await step('live delivery: Grace sends, Ada receives; typing clears', async () => {
    await pageB.click(sel('send-button'));
    await pageA.waitForSelector('text=On my way to the start', { timeout: 15_000 });
    // Grace's typing entry was deleted on send; indicator should clear on Ada.
    await pageA.waitForSelector(sel('typing-indicator'), { state: 'detached', timeout: 15_000 });
    await pageA.screenshot({ path: `${ART}05-ada-received-live-message.png` });
  });

  await step('reply pointer: Ada replies to Grace message, Grace sees quote', async () => {
    const graceMessage = pageA.locator('[data-testid^="message-"]', { hasText: 'On my way to the start' }).last();
    const graceMessageId = await graceMessage.getAttribute('data-testid');
    await pageA.click(sel(`reply-button-${graceMessageId.replace('message-', '')}`));
    await pageA.fill(sel('composer-input'), 'Great — meet at the bridge');
    await pageA.click(sel('send-button'));
    const bubble = pageB.locator('[data-testid^="message-"]', { hasText: 'Great — meet at the bridge' }).last();
    await bubble.waitFor({ timeout: 15_000 });
    assert.match(await bubble.textContent(), /On my way to the start/u, 'quoted preview shows replied-to text');
    await pageB.screenshot({ path: `${ART}06-grace-sees-reply-quote.png` });
  });

  await step('reaction: Ada reacts ❤️ to msg_9, Grace sees the chip live', async () => {
    await pageA.click(sel('react-button-msg_9'));
    await pageA.click(sel('emoji-msg_9-❤️'));
    await pageB.waitForSelector(sel('reaction-msg_9-❤️'), { timeout: 15_000 });
    const chip = await pageB.textContent(sel('reaction-msg_9-❤️'));
    assert.match(chip, /1/u);
    await pageB.screenshot({ path: `${ART}07-grace-sees-reaction.png` });
  });

  await step('image message: Ada picks a file, uploads, Grace renders it', async () => {
    const [chooser] = await Promise.all([
      pageA.waitForEvent('filechooser', { timeout: 15_000 }),
      pageA.click(sel('pick-image')),
    ]);
    await chooser.setFiles(new URL('./artifacts/test-image.png', import.meta.url).pathname);
    await pageA.fill(sel('composer-input'), 'Sunset from the lighthouse');
    await pageA.click(sel('send-button'));
    const image = pageB.locator('[data-testid^="message-image-"]').last();
    await image.waitFor({ timeout: 45_000 });
    const assetTestId = await image.getAttribute('data-testid');
    const assetId = assetTestId.replace('message-image-', '');
    assert.ok(assetId.length > 0, 'asset id present');
    // Verify the served rendition bytes really exist (pasteable public URL).
    let served = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      served = await pageB.request.get(`http://127.0.0.1:4287/assets/public/${assetId}/thumb`);
      if (served.status() === 200) break;
      await pageB.waitForTimeout(500);
    }
    assert.equal(served.status(), 200, 'public rendition serves 200 (after publication)');
    assert.ok((await served.body()).length > 500, 'rendition has real bytes');
    await pageB.waitForTimeout(700);
    await pageB.screenshot({ path: `${ART}08-grace-sees-image-message.png` });
    await pageA.screenshot({ path: `${ART}09-ada-sent-image-message.png` });
    console.log('image asset id:', assetId);
  });

  await step('third persona: Kai sees the whole new history', async () => {
    await pageB.click(sel('back-button'));
    await pageB.click(sel('persona-kai'));
    await pageB.waitForSelector(sel('conversation-conv_weekend_ride'), { timeout: 30_000 });
    await pageB.click(sel('conversation-conv_weekend_ride'));
    await pageB.waitForSelector('text=Great — meet at the bridge', { timeout: 15_000 });
    await pageB.screenshot({ path: `${ART}10-kai-sees-history.png` });
  });

  console.log('\nUI PROOF SUMMARY');
  for (const entry of results) console.log(` ${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}`);
  const failed = results.filter((entry) => !entry.ok).length;
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  await browser.close();
}
