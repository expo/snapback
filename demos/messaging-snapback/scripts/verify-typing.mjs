#!/usr/bin/env node
// Verifies the live typing-indicator path: opens the Weekend Trip group chat
// in a real browser tab, then — from a second, independent Snapback client
// standing in for "another device" — publishes ephemeral typing presence for
// Priya into that same conversation room, and screenshots the tab to prove
// "Priya Rao is typing…" appears without any page reload (a genuine
// server-pushed live update, not a poll).
import { chromium } from 'playwright-core';
import { SnapbackClient } from '../../../packages/snapback-client/index.mjs';
import api from '../snapback/generated/api.mjs';

const url = process.argv[2] ?? 'http://localhost:8099';
const origin = process.argv[3] ?? 'http://127.0.0.1:4421';
const outPath = process.argv[4] ?? 'evidence/03-typing.png';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(2000);
await page.getByText('Weekend Trip', { exact: false }).first().click();
await page.waitForTimeout(2000);

// Find conv_group_trip's id and simulate Priya typing from a second client.
const client = new SnapbackClient(origin, { rqsStore: null });
const conversations = await client.query(api.myConversations, { args: {}, userId: 'lin' });
const trip = conversations.rows.find((c) => c.title.includes('Weekend Trip'));
const scope = { conversationId: trip._id };
const overlay = await client.subscribeEphemeral(api.ephemeral.typing, {
  connectionId: 'simulated-priya-device',
  scope,
  userId: 'priya',
  permissions: [SnapbackClient.roomPermission('m_conversationMemberships', scope)],
});
await overlay.publish({ userHandle: 'priya', name: 'Priya Rao' }, { ttlMs: api.ephemeral.typing.maxTtlMs });

await page.getByText('Priya Rao is typing…', { exact: true }).waitFor({
  state: 'visible',
  timeout: 5_000,
});
await page.screenshot({ path: outPath });

overlay.dispose();
await client.closeAuth();
await browser.close();
console.log(`wrote ${outPath}`);
