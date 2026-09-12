#!/usr/bin/env node
// @ref LLP 2000#7-performance-is-part-of-the-architecture — report the measured boundary and required fixture bytes explicitly.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, hostname, platform, arch, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'examples/chat/.snapback3/fixtures/hub-seed.json');
const project = join(root, 'examples/chat/.snapback3/build/project.json');
const worker = process.env.SNAPBACK3_WORKER ?? join(root, 'target/release/snapback3-worker');
const metadata = JSON.parse(await readFile(fixture.replace('.json', '.metrics.json'), 'utf8'));
const bytes = await readFile(fixture);
assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
const temporary = await mkdtemp(join(tmpdir(), 'snapback3-hub-'));
const started = performance.now();
const child = spawn(worker, ['--project', project, '--database', join(temporary, 'store.sqlite'), '--seed', fixture, '--dev']);
let stderr = '', nextId = 0;
const pending = new Map();
child.stderr.on('data', chunk => { if (stderr.length < 4_096) stderr += chunk.toString().slice(0, 4_096 - stderr.length); });
const closed = new Promise(resolveExit => child.once('close', (code, signal) => {
  for (const item of pending.values()) item.reject(new Error(`Worker exited ${signal ?? code}: ${stderr}`));
  pending.clear(); resolveExit();
}));
child.on('error', error => { for (const item of pending.values()) item.reject(error); pending.clear(); });
createInterface({ input: child.stdout }).on('line', line => {
  const frame = JSON.parse(line), item = pending.get(frame.id);
  if (!item) return;
  pending.delete(frame.id);
  if (frame.error) item.reject(new Error(`${frame.error.code}: ${frame.error.message}`));
  else item.resolve({ value: frame.result, bytes: Buffer.byteLength(line) + 1, ms: performance.now() - item.start });
});
function call(method, params = {}) {
  return new Promise((resolveCall, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolveCall, reject, start: performance.now() });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 180_000);
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(3));
  return { count: values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: percentile(1) };
};
try {
  const health = await call('health');
  const seedAndStartupMs = performance.now() - started;
  console.error(`Seeded ${metadata.counts.messages} messages in ${seedAndStartupMs.toFixed(1)} ms.`);
  assert.equal(health.value.seq, 1);
  const session = (await call('auth', { action: 'persona', name: metadata.hubPersona })).value;
  const query = async (op, args) => {
    const result = await call('query', { token: session.token, op, args });
    assert(['complete', 'capped'].includes(result.value.state), `${op} must have a complete requested page, got ${result.value.state}`);
    assert(!Object.hasOwn(result.value, 'trace'), 'private execution traces must not be delivered');
    return { ...result, data: expandRows(result.value) };
  };
  let cursor = null, inboxBytes = 0;
  const rooms = new Set(), inboxTimes = [];
  const acquisitionStarted = performance.now();
  do {
    const result = await query('conversations.list', { c: cursor });
    inboxTimes.push(result.ms); inboxBytes += result.bytes;
    for (const item of result.data) rooms.add(item.conversation.id);
    cursor = result.value.next;
  } while (cursor);
  assert.equal(rooms.size, metadata.counts.conversations);
  const inboxAcquisitionMs = performance.now() - acquisitionStarted;
  console.error(`Acquired ${rooms.size} conversations in ${inboxAcquisitionMs.toFixed(1)} ms.`);

  let deliveredMessages = 0, messageBytes = 0;
  const messageTimes = [];
  const messagesStarted = performance.now();
  for (const room of rooms) {
    cursor = null;
    const ids = new Set();
    do {
      const result = await query('messages.page', { conversationId: room, c: cursor });
      messageTimes.push(result.ms); messageBytes += result.bytes;
      for (const item of result.data) {
        const id = item.id;
        assert(id && !ids.has(id), `duplicate/missing message in ${room}`);
        ids.add(id);
      }
      cursor = result.value.next;
    } while (cursor);
    deliveredMessages += ids.size;
  }
  const allMessagesMs = performance.now() - messagesStarted;
  assert.equal(deliveredMessages, metadata.counts.messages);
  const report = {
    measuredAt: new Date().toISOString(), fixture: metadata,
    boundary: 'Release Rust worker over local JSONL, authenticated authorized query envelopes, fresh SQLite seed, sequential reads. Includes IPC, JSON serialization/parsing. Excludes HTTP, browser rendering, client persistence and offline evaluation; not a sibling comparison.',
    machine: { hostname: hostname(), platform: platform(), arch: arch(), cpu: cpus()[0].model, logicalCpus: cpus().length },
    seedAndStartupMs: Number(seedAndStartupMs.toFixed(3)),
    inbox: { rooms: rooms.size, totalMs: Number(inboxAcquisitionMs.toFixed(3)), wireBytes: inboxBytes, ...distribution(inboxTimes) },
    messages: { totalMs: Number(allMessagesMs.toFixed(3)), wireBytes: messageBytes, ...distribution(messageTimes), pages: messageTimes.length, deliveredMessages },
  };
  // Keep "count" consistent with the measured page-latency sample count.
  const output = join(root, 'examples/chat/.snapback3/fixtures/hub-worker-result.json');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
  child.stdin.end();
  const force = setTimeout(() => child.kill('SIGKILL'), 1_000);
  await closed;
  clearTimeout(force);
  await rm(temporary, { recursive: true, force: true });
}

function expandRows(envelope) {
  const rows = new Map(envelope.rows.map(row => [JSON.stringify([row.table, row.id]), row.row]));
  const visit = value => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(visit);
    if (Object.keys(value).length === 1 && value.$row) {
      if (Object.hasOwn(value.$row, '$value')) return Object.fromEntries(Object.entries(value.$row.$value).map(([key, child]) => [key, visit(child)]));
      return rows.get(JSON.stringify([value.$row.table, value.$row.id]));
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  };
  return visit(envelope.data);
}
