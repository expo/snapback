import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replay } from './replay.mjs';
import { actionBuilder, ref, OPERATIONS } from './actions.mjs';
import { starterActions } from './starter.mjs';

test('all-verb starter contract; lost acknowledgement retries same key; second replay is empty; changed input refuses', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workroom-replay-')); t.after(() => rm(directory, { recursive: true }));
  assert.deepEqual(new Set([...starterActions()].map(x => x.op)), new Set(OPERATIONS));
  assert.deepEqual(new Set([...starterActions({ conformance: true })].map(x => x.op)), new Set(OPERATIONS));
  const a = actionBuilder('test');
  const actions = [a('W1', 'owner', 'account.register', 'owner', { email: 'owner@workroom.test' }),
    a('W1', 'owner', 'organization.create', 'org', { owner: ref('owner') })];
  const server = new Map(), calls = []; let lost = false;
  const adapter = { async execute(action, context) {
    calls.push(action.key);
    if (action.op === 'organization.create') assert.equal(context.input.owner, 'id-owner');
    if (!server.has(action.key)) server.set(action.key, { status: 'applied',
      receipt: { id: action.key, authoritative: true }, bindings: { [action.entity]: 'id-' + action.entity } });
    if (!lost) { lost = true; throw Object.assign(new Error('lost response'), { code: 'TRANSPORT_UNKNOWN' }); }
    return server.get(action.key);
  }};
  const receipts = join(directory, 'receipts.ndjson');
  assert.equal((await replay(actions, adapter, receipts)).applied, 2);
  assert.equal(calls[0], calls[1]); assert.equal(server.size, 2);
  assert.equal((await replay(actions, adapter, receipts)).skipped, 2); assert.equal(calls.length, 3);
  await assert.rejects(replay([{ ...actions[0], input: { email: 'changed@workroom.test' } }], adapter, receipts), { code: 'REPLAY_INPUT_CHANGED' });
});

test('unknown terminal failure stops instead of skipping dependent work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workroom-refusal-')); t.after(() => rm(directory, { recursive: true }));
  const actions = [...starterActions()]; let calls = 0;
  await assert.rejects(replay(actions, { execute() { calls++; return { status: 'rejected', reason: 'bad' }; } }, join(directory, 'r.ndjson')),
    { code: 'UNEXPECTED_TERMINAL_OUTCOME' });
  assert.equal(calls, 1);
});

test('restarting the driver after a committed lost ack recovers the same entity without another write', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workroom-resume-')); t.after(() => rm(directory, { recursive: true }));
  const a = actionBuilder('resume'), actions = [a('W1', 'owner', 'account.register', 'owner', { email: 'owner@workroom.test' })];
  const authoritative = new Map(); let transportLost = true, writes = 0;
  const adapter = { execute(action) {
    if (!authoritative.has(action.key)) { writes++; authoritative.set(action.key,
      { status: 'applied', receipt: { id: 'server-receipt-1', authoritative: true }, bindings: { owner: 'real-owner-id' } }); }
    if (transportLost) throw Object.assign(new Error('connection lost'), { code: 'TRANSPORT_UNKNOWN' });
    return authoritative.get(action.key);
  }};
  const receipts = join(directory, 'r.ndjson');
  await assert.rejects(replay(actions, adapter, receipts, { transportRetries: 0 }), { code: 'TRANSPORT_UNKNOWN' });
  transportLost = false;
  assert.equal((await replay(actions, adapter, receipts)).aliases.owner, 'real-owner-id'); assert.equal(writes, 1);
  assert.equal((await replay(actions, adapter, receipts)).skipped, 1);
});
