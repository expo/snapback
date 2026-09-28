// Generated scale fixture; no calibration store or credentials required.
// scripts/build-wasm.sh; SNAPBACK4_BIN=target/production/snapback4 node witness/receipts-scale.mjs [report.json]
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root } from './lib.mjs';
import { signup } from '../packages/snapback4/dist/auth.js';
import { createClient } from '../packages/snapback4/dist/client.js';

const output = process.argv[2] ?? join(root, 'target/receipts-scale.json');
const sourceDir = mkdtempSync(join(root, 'target/rg-receipts-source-'));
let source = readFileSync(join(root, 'crates/snapback4-lang/src/guide/receipts.rs'), 'utf8').split('```quarry\n')[1].split('```')[0];
// Expiring source plus row-keyed unread counts reproduces the certification
// shape, while all receipt/rule forms come from the tested current guide.
source = 'use identity password\n' + source.replace('  at: time\n', '  at: time\n  tombstone: bool default false\n  expiresAt: time ?\n  expire at .expiresAt\n  immutable expiresAt\n');
source += '\nview unread: count messages by members m\n  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .ordinal > m.joinedOrdinal and .sender != m.principal and not .tombstone\nquery unreadFor(member: members):\n  return unread[member]\nquery message(id: messages):\n  return messages[id]\n';
writeFileSync(join(sourceDir, 'schema.q'), source);
const clients = [], network = [], browserErrors = [];
let h;
const result = { fixture: { members: 50, busyMessages: 10000, conversations: 100 }, unreadChecks: [], warmups: 3, samples: [], pass: false };
try {
  h = await launch({ seed: [], sourceDir, entrySource: `import ${JSON.stringify(join(root, 'witness/receipts-scale-browser.tsx'))};` });
  const { page, api } = h;
  page.on('pageerror', e => { browserErrors.push(e.message); console.error('browser:', e.message); });
  const accounts = [];
  for (let n = 0; n < 50; n++) {
    const email = `receipt${n}@witness.invalid`, password = 'generated-witness-password';
    const signed = await signup(api, email, password); assert.ok(signed.ok, JSON.stringify(signed));
    accounts.push({ email, password, session: signed.session });
    clients.push(createClient({ url: api, session: signed.session }));
  }
  const rows = [];
  for (let n = 0; n < 50; n++) rows.push({ table: 'profiles', row: { id: `p${n}`, principal: accounts[n].session.principal, name: `Peer ${n}` } });
  for (let g = 0; g < 100; g++) {
    const id = g ? `quiet${g}` : 'busy', count = g ? 10 : 10000, members = g ? 2 : 50;
    rows.push({ table: 'conversations', row: { id, title: `Group ${g}`, creatorId: accounts[0].session.principal, lastOrdinal: count } });
    for (let p = 0; p < members; p++) rows.push({ table: 'members', row: { id: `${id}-p${p}`, conversation: id, principal: accounts[p].session.principal, joinedOrdinal: 0, deliveredOrdinal: 0, seenOrdinal: count } });
    for (let n = 1; n <= count; n++) rows.push({ table: 'messages', row: { id: `${id}-m${n}`, conversation: id, sender: accounts[n % members].session.principal, ordinal: n, recipients: members - 1, text: `history ${g}/${n}`, at: 1700000000000 + n } });
  }
  // Small-range oracle inside the same 100-conversation fixture. For peer 0
  // only ordinal 7 qualifies; for peer 1 only 6 and 10 do. The other rows
  // exercise read/join floors, self-sends, a tombstone (8) and expiry (9).
  for (const { table, row } of rows) {
    if (table === 'members' && row.id === 'quiet99-p0') Object.assign(row, { seenOrdinal: 3, joinedOrdinal: 5 });
    if (table === 'members' && row.id === 'quiet99-p1') Object.assign(row, { seenOrdinal: 4, joinedOrdinal: 2 });
    if (table === 'messages' && row.id === 'quiet99-m8') row.tombstone = true;
    if (table === 'messages' && row.id === 'quiet99-m9') row.expiresAt = 1;
  }
  const seeded = await fetch(api + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json());
  assert.equal(seeded.seeded, rows.length, JSON.stringify(seeded));
  const q = name => ({ name, kind: 'query' }), m = name => ({ name, kind: 'mutation' });
  async function unread(peer, member, expected, phase) {
    const read = await clients[peer].query(q('unreadFor'), { member });
    result.unreadChecks.push({ phase, member, expected, actual: read.data });
    assert.equal(read.complete, true, `unread ${phase}: ${JSON.stringify(read)}`);
    assert.equal(read.data, expected, `exact unread for ${member} ${phase}: ${JSON.stringify(read)}`);
  }
  await unread(0, 'quiet99-p0', 1, 'seeded mixed range');
  await unread(1, 'quiet99-p1', 2, 'seeded mixed range');
  page.on('response', async response => {
    const path = new URL(response.url()).pathname;
    if (!['/sync', '/changes'].includes(path)) return;
    try {
      const body = await response.text(), value = JSON.parse(body), tables = {};
      for (const e of value.events ?? []) tables[e.table] = (tables[e.table] ?? 0) + 1;
      network.push({ at: performance.now(), path, bytes: Buffer.byteLength(body), tables, serverTiming: response.headers()['server-timing'], timing: response.request().timing() });
    } catch {}
  });
  const cold = performance.now();
  result.cold = await page.evaluate(({ api, account }) => window.startReceipts(api, account.email, account.password), { api, account: accounts[0] });
  await page.waitForSelector('[data-message="history 0/10000"]');
  result.coldWebReadyMs = performance.now() - cold;
  const localUnread = await page.evaluate(() => window.readUnread('quiet99-p0'));
  assert.equal(localUnread.complete, true, 'Chromium certifies the seeded unread view');
  assert.equal(localUnread.data, 1, 'Chromium reads the seeded unread view');
  result.unreadChecks.push({ phase: 'Chromium seeded range', member: 'quiet99-p0', expected: 1, actual: localUnread.data });
  for (let i = 0; i < 23; i++) {
    const text = `receipt-scale-${i}`, at = performance.now();
    await page.locator('#text').fill(text); await page.locator('#send').click();
    await page.locator(`[data-message="${text}"]`).waitFor();
    const domMs = performance.now() - at;
    let message;
    for (let j = 0; j < 300; j++) {
      const read = await clients[0].query(q('history'), { conversation: 'busy' });
      message = read.data?.find(r => r.text === text);
      if (message) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(message, 'server settlement within 30 seconds');
    const sendRenderMs = performance.now() - at;
    await unread(0, 'busy-p0', 0, `sample ${i} self-send`);
    await unread(1, 'busy-p1', 1, `sample ${i} before seen`);
    for (const peer of clients.slice(1)) {
      assert.equal((await peer.query(q('message'), { id: message.id })).data?.text, text);
      for (const [name, args] of [['delivered', { conversation: 'busy', from: message.ordinal, through: message.ordinal }], ['seen', { conversation: 'busy', through: message.ordinal }]]) {
        const write = await peer.mutate(m(name), args); assert.equal(write.state, 'sent', JSON.stringify(write));
      }
    }
    await page.locator(`[data-message="${text}"][data-receipt="read"]`).waitFor({ timeout: 30000 });
    const sample = { i, domMs, sendRenderMs, readConvergenceMs: performance.now() - at };
    console.log(JSON.stringify(sample)); result.samples.push(sample);
    await unread(1, 'busy-p1', 0, `sample ${i} after seen`);
  }
  const p95 = key => result.samples.slice(3).map(x => x[key]).sort((a, b) => a - b)[18];
  result.domP95Ms = p95('domMs'); result.sendRenderP95Ms = p95('sendRenderMs'); result.readConvergenceP95Ms = p95('readConvergenceMs');
  const work = await page.evaluate(() => ({ saves: window.receiptStats.saves.length,
    metadataWrites: window.receiptStats.calls.filter(x => x.op === 'set_meta').length }));
  const receipts = 49 * result.samples.length * 2;
  // Bound actual durable work as well as this machine's wall time. Four saves
  // and two metadata writes per incoming receipt, plus startup slack, leave
  // room for delivery/clock/settlement while refusing a save per rendered hook.
  result.work = { ...work, receipts, saveLimit: 4 * receipts + 100, metadataLimit: 2 * receipts + 100 };
  assert.ok(work.saves <= result.work.saveLimit, `receipt persistence amplification: ${JSON.stringify(result.work)}`);
  assert.ok(work.metadataWrites <= result.work.metadataLimit, `receipt metadata amplification: ${JSON.stringify(result.work)}`);
  result.pass = result.sendRenderP95Ms < 1000;
  assert.deepEqual(browserErrors, [], 'no browser exceptions');
  assert.ok(result.pass, `send/render p95 ${result.sendRenderP95Ms}ms exceeds 1s`);
} catch (error) { result.pass = false; result.error = String(error); console.error(result.error); process.exitCode = 1; }
finally {
  if (h) { result.browser = await h.page.evaluate(() => window.receiptStats).catch(() => null); await h.page.evaluate(() => window.closeReceipts()).catch(() => {}); }
  result.network = network; writeFileSync(output, JSON.stringify(result, null, 2));
  await Promise.all(clients.map(c => c.close())); await h?.close(); rmSync(sourceDir, { recursive: true });
}
