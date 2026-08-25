import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  REPLAY_CEILINGS,
  REPLAY_RETAINED_ROW_OVERHEAD_BYTES,
  __replayTest,
  defineReplay,
  readReplayStatus,
  runReplay,
} from './replay.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const activation = Object.freeze({
  schemaVersion: 'snapback.v1',
  appId: '018f0d90-7b14-7a22-8c33-445566778899',
  schemaHash: `snapback.v1:sessions:schema:${digest('1')}`,
  bundleHash: `snapback.v1:sessions:function:${digest('2')}`,
  inputsHash: `snapback.v1:sessions:inputs:${digest('3')}`,
});
const mutation = Object.freeze({
  artifactKind: 'functionReference', schemaVersion: 'snapback.v1',
  appId: activation.appId, id: `${activation.appId}:apply`, name: 'apply', kind: 'Mutation',
  implementationHash: digest('4'), argsContractHash: digest('5'), resultContractHash: digest('6'),
  expectedGeneration: activation,
  argsContract: Object.freeze({ fields: Object.freeze([
    Object.freeze({
      name: 'seq', required: true,
      value: Object.freeze({ kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER }),
    }),
    Object.freeze({
      name: 'parentId', required: false,
      value: Object.freeze({
        kind: 'union', variants: Object.freeze([
          Object.freeze({ kind: 'null' }),
          Object.freeze({ kind: 'string', maxBytes: 1_024 }),
        ]),
      }),
    }),
  ]) }),
  argumentSchema: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: Object.freeze({
      seq: Object.freeze({ type: 'integer' }),
      parentId: Object.freeze({ type: ['string', 'null'] }),
    }),
    required: Object.freeze(['seq']),
  }),
});
const api = Object.freeze({ apply: mutation });
const lookupQuery = Object.freeze({
  ...mutation,
  id: `${activation.appId}:lookup`,
  name: 'lookup',
  kind: 'Query',
  argsContract: Object.freeze({ fields: Object.freeze([
    Object.freeze({
      name: 'seq', required: true,
      value: Object.freeze({ kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER }),
    }),
    Object.freeze({
      name: 'limit', required: true,
      value: Object.freeze({ kind: 'integer', min: 1, max: 1_024 }),
    }),
    Object.freeze({
      name: 'after', required: false,
      value: Object.freeze({ kind: 'string', maxBytes: 1_024 }),
    }),
  ]) }),
  argumentSchema: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: Object.freeze({
      seq: Object.freeze({ type: 'integer' }),
      limit: Object.freeze({ type: 'integer' }),
      after: Object.freeze({ type: 'string' }),
    }),
    required: Object.freeze(['seq', 'limit']),
  }),
});

const handshake = Object.freeze({
  protocolVersion: 1,
  serverStartupNonce: 'startup-headless-replay-test',
  authorizationStreamIncarnation: '018f0d90-7b11-7a22-8c33-445566778899',
  transitionGeneration: 1,
  activeMode: 'sessions', desiredMode: 'sessions', modeState: 'settled',
  appDataAvailability: 'available', quarantineCode: null,
  clientProtocols: {
    authClient: 1, authInvalidation: 1, authorityDescriptor: 1, authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
    },
    queuedReplay: { available: true, minimumAuthorityDescriptorProtocol: 1, reason: null },
  },
  provider: { key: 'email-code', available: true }, transports: ['bearer'],
  authority: {
    kind: 'humanSession',
    userId: '018f0d90-7b12-7a22-8c33-445566778899',
    sessionId: '018f0d90-7b13-7a22-8c33-445566778899',
    isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b11-7a22-8c33-445566778899',
    sessionGeneration: 1,
  },
  deploymentIdentity: { ...activation, authMode: 'sessions' },
  authorizedLease: null,
});

async function temporary(t, prefix = 'snapback-replay-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(path, value, mode = undefined) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, mode === undefined ? undefined : { mode });
}

function writeActions(path, count, actors = 4) {
  const lines = [];
  for (let seq = 0; seq < count; seq += 1) {
    lines.push(JSON.stringify({
      seq, actor: `actor-${seq % actors}`, fn: 'apply', intent: `intent-${seq}`, args: { seq },
    }));
  }
  writeFileSync(path, `${lines.join('\n')}\n`);
}

function records(path) {
  return readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

function dispatchRecord({ seq = 0, actor = 'actor-0', intent = `intent-${seq}`, args = { seq },
  custody = 'minted', transportId = `rp-test-${seq}` } = {}) {
  const functionName = 'apply';
  return {
    v: 'snapback.replay-dispatch.v1', seq, actor, intent,
    function: functionName, selector: 'apply', args,
    carrierBytes: Buffer.byteLength(JSON.stringify({ function: functionName, args })),
    custody, transportId: custody === 'none' ? null : transportId, at: Date.now(),
  };
}

function settledTerminal(dispatch) {
  return {
    v: 'snapback.replay-terminal.v1', seq: dispatch.seq, intent: dispatch.intent,
    outcome: 'settled', code: null, version: dispatch.seq + 1,
    settled: { ids: {} }, retainedBytesCharge: 131_076, ms: 1, at: Date.now(),
  };
}

function installFetchHarness(t, { refusal = null, acknowledgeRefusal = null } = {}) {
  const original = globalThis.fetch;
  const retained = new Map();
  const requests = [];
  const acknowledgements = [];
  let peakRetained = 0;
  let liveQueries = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body === undefined ? {} : JSON.parse(init.body);
    requests.push({ path, body });
    if (path === '/auth/session') {
      if (refusal?.kind === 'auth') {
        return new Response(JSON.stringify({ diagnostic: refusal.diagnostic }), {
          status: 403, headers: { 'content-type': 'application/json' },
        });
      }
      return Response.json(handshake);
    }
    if (path.startsWith('/live/')) {
      liveQueries += 1;
      throw new Error('headless replay registered a live query');
    }
    if (path === '/client-mutations/acknowledge') {
      acknowledgements.push([...body.clientMutationIds]);
      if (acknowledgeRefusal !== null) {
        return new Response(JSON.stringify({ diagnostic: acknowledgeRefusal }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      for (const id of body.clientMutationIds) retained.delete(id);
      return Response.json({ acknowledged: body.clientMutationIds });
    }
    if (path === '/mutation/apply') {
      if (refusal?.kind === 'handler') {
        return new Response(JSON.stringify({
          diagnostic: refusal.diagnostic,
          receipt: { kind: 'mutation', mutationId: body.clientMutationId, outcome: 'rejected' },
        }), { status: 409, headers: { 'content-type': 'application/json' } });
      }
      if (body.clientMutationId && retained.has(body.clientMutationId)) {
        return Response.json(retained.get(body.clientMutationId));
      }
      const response = { version: body.args.seq + 1, result: { id: `row-${body.args.seq}` } };
      if (body.clientMutationId) {
        retained.set(body.clientMutationId, response);
        peakRetained = Math.max(peakRetained, retained.size);
      }
      return Response.json(response);
    }
    throw new Error(`unexpected replay request ${path}`);
  };
  t.after(() => { globalThis.fetch = original; });
  return {
    retained, requests, acknowledgements,
    get liveQueries() { return liveQueries; },
    get peakRetained() { return peakRetained; },
  };
}

function definition(directory, overrides = {}) {
  const readyFile = join(directory, 'ready.json');
  const actions = join(directory, 'actions.jsonl');
  if (!readFileSync(actions, { encoding: 'utf8', flag: 'a+' })) writeActions(actions, 1);
  writeJson(readyFile, { ready: true, serverUrl: 'http://replay.test' });
  return defineReplay({
    readyFile, api, actions, actors: { bearerFor: () => 'sbs-replay-test' },
    receiptsFile: join(directory, 'receipts.jsonl'),
    statusFile: join(directory, 'status.json'),
    ...overrides,
  });
}

test('ceiling preflight names live limits and refuses an unsafe byte window before dispatch', async (t) => {
  const directory = await temporary(t);
  writeActions(join(directory, 'actions.jsonl'), 1);
  const harness = installFetchHarness(t);
  const replay = definition(directory, {
    acknowledgeBytes: REPLAY_CEILINGS.retainedMutationBytesPerAuthority,
  });
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostic.code, 'SNAPBACK_REPLAY_ACK_WINDOW_UNSAFE');
  assert.deepEqual(
    result.receipt.preflight.ceilings.map((entry) => entry.code),
    [
      'SNAPBACK_CLIENT_MUTATION_RETENTION_FULL',
      'SNAPBACK_RELATIONAL_PLAN_INVALID',
      'SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED',
      'SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED',
    ],
  );
  assert.equal(result.receipt.preflight.ceilings[0].recordsPerAuthority, 1_024);
  assert.equal(result.receipt.preflight.ceilings[0].bytesPerAuthority, 8 * 1_024 * 1_024);
  assert.equal(harness.requests.length, 0, 'unsafe preflight dispatched no request');
});

for (const [kind, code, message] of [
  ['handler', 'SNAPBACK_HANDLER_FIXTURE_REFUSED', 'fixture handler said no'],
  ['auth', 'SNAPBACK_AUTH_GRANT_SCOPE_DENIED', 'fixture authority lacks scope'],
]) {
  test(`${kind} refusal preserves server diagnostic and action position`, async (t) => {
    const directory = await temporary(t, `snapback-replay-${kind}-`);
    writeActions(join(directory, 'actions.jsonl'), 1);
    const harness = installFetchHarness(t, {
      refusal: {
        kind,
        diagnostic: {
          code, severity: 'error', subsystem: kind, message,
          details: { effectCommitted: false, effectMayHaveCommitted: false },
        },
      },
    });
    const replay = definition(directory);
    const result = await runReplay(replay);
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.diagnostic.code, code);
    assert.equal(result.receipt.diagnostic.message, message);
    assert.deepEqual(result.receipt.diagnostic.details, {
      effectCommitted: false, effectMayHaveCommitted: false,
    });
    assert.deepEqual(result.receipt.diagnostic.position, {
      seq: 0, intent: 'intent-0', actor: 'actor-0', fn: 'apply',
    });
    const terminal = records(join(directory, 'receipts.jsonl'))
      .find((record) => record.v === 'snapback.replay-terminal.v1');
    assert.equal(terminal.code, code);
    assert.equal(terminal.diagnostic.message, message);
    assert.equal(terminal.diagnostic.position.seq, 0);
    assert.equal(terminal.diagnostic.position.intent, 'intent-0');
    if (kind === 'handler') {
      const dispatch = records(join(directory, 'receipts.jsonl'))
        .find((record) => record.v === 'snapback.replay-dispatch.v1');
      assert.equal(
        harness.acknowledgements.flat().includes(dispatch.transportId),
        false,
        'a typed refusal has no settlement and is never acknowledged',
      );
    }
    const beforeResumeMutations = harness.requests
      .filter(({ path }) => path === '/mutation/apply').length;
    const originalDiagnostic = result.receipt.diagnostic;
    writeFileSync(replay.readyFile, 'not a ready descriptor');
    const resumed = await runReplay(replay, { resume: true });
    assert.equal(resumed.exitCode, 1);
    assert.equal(resumed.receipt.diagnostic.code, code);
    assert.deepEqual(
      resumed.receipt.diagnostic,
      originalDiagnostic,
      'refused-WAL resume republishes the original diagnostic with only its recorded position',
    );
    assert.equal(
      harness.requests.filter(({ path }) => path === '/mutation/apply').length,
      beforeResumeMutations,
      'a refused terminal stops resume before another mutation dispatch',
    );
  });
}

test('none custody stops at a dispatch-only ambiguity unless reexecution is explicit', async (t) => {
  const directory = await temporary(t);
  writeActions(join(directory, 'actions.jsonl'), 2);
  const harness = installFetchHarness(t);
  const replay = definition(directory, { transportCustody: 'none' });
  writeFileSync(replay.receiptsFile, `${JSON.stringify(dispatchRecord({ custody: 'none' }))}\n`);
  const result = await runReplay(replay, { resume: true });
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostic.code, 'SNAPBACK_REPLAY_AMBIGUOUS_NONE');
  assert.equal(harness.requests.filter(({ path }) => path === '/mutation/apply').length, 0);
});

test('status synthesis distinguishes gone and live-but-stale processes', async (t) => {
  const directory = await temporary(t);
  const deadFile = join(directory, 'dead.json');
  const stalledFile = join(directory, 'stalled.json');
  const base = {
    v: 'snapback.replay-status.v1', state: 'running', settled: 4, total: 10,
    failed: 0, lastSeq: 3, receiptsFile: join(directory, 'receipts.jsonl'),
    checkpointCadenceMs: 1, updatedAt: Date.now() - 10_000,
  };
  writeJson(deadFile, { ...base, pid: 2_147_483_000 });
  writeJson(stalledFile, { ...base, pid: process.pid });
  assert.equal(readReplayStatus(deadFile).state, 'dead');
  assert.equal(readReplayStatus(deadFile).recovery, 'resume');
  assert.equal(readReplayStatus(stalledFile).state, 'stalled');
  assert.equal(readReplayStatus(stalledFile).recovery, 'wait-or-signal');
});

test('the O_EXCL WAL fence excludes a second live runner without touching its artifacts', async (t) => {
  const directory = await temporary(t);
  writeActions(join(directory, 'actions.jsonl'), 1);
  const replay = definition(directory);
  writeJson(`${replay.receiptsFile}.lock`, { pid: process.pid, startToken: 'held', at: Date.now() }, 0o600);
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostic.code, 'SNAPBACK_REPLAY_RUNNER_ACTIVE');
  assert.throws(() => readFileSync(replay.receiptsFile), { code: 'ENOENT' });
  assert.throws(() => readFileSync(replay.statusFile), { code: 'ENOENT' });
});

test('stale fence replacement is CAS-guarded and recorded before replay proceeds', async (t) => {
  const directory = await temporary(t);
  writeActions(join(directory, 'actions.jsonl'), 1);
  installFetchHarness(t);
  const replay = definition(directory);
  writeJson(
    `${replay.receiptsFile}.lock`,
    { pid: 2_147_483_000, startToken: 'stale-owner', at: 1 },
    0o600,
  );
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 0);
  assert.equal(
    records(replay.receiptsFile).some((record) => (
      record.v === 'snapback.replay-fence.v1'
      && record.event === 'stale-broken'
      && record.stale.startToken === 'stale-owner'
    )),
    true,
  );
});

const generatedIrReference = Object.freeze({
  ...mutation,
  artifactKind: 'functionReference', schemaVersion: 'snapback.v1',
  appId: activation.appId, id: `${activation.appId}:apply`, name: 'apply', kind: 'Mutation',
  implementationHash: digest('4'), argsContractHash: digest('5'), resultContractHash: digest('6'),
  expectedGeneration: activation,
  argumentSchema: {
    type: 'object', additionalProperties: false,
    properties: { seq: { type: 'integer' } }, required: ['seq'],
  },
  mutationIr: {
    format: 'snapback.generated-mutation-ir.v1', operationHash: digest('7'),
    sourceIdentity: {
      functionId: `${activation.appId}:apply`, implementationHash: digest('4'),
      activation,
    },
    schemaIdentity: {
      schemaVersion: 'snapback.v1', appId: activation.appId, schemaHash: activation.schemaHash,
    },
    capabilityClass: 'local-executable',
    capabilityCode: 'SNAPBACK_GENERATED_IR_LOCAL_EXECUTABLE',
    declaredEffectClass: 'snapback.browser-ir.insert-get-guard-patch.v1',
    declaredReads: [], localReadRequirements: [],
    schema: { tables: [{ name: 'rows', fields: [{ name: 'seq' }] }] },
    plan: {
      steps: [{ Insert: { table: 'rows', values: { seq: { Arg: 'seq' } }, bind_id_as: 'rowId' } }],
      return_value: { Binding: 'rowId' },
    },
    mintSites: ['plan/steps/0/insert/row-id'], usesRuntimeNow: false, boundedSkew: null,
  },
});

test('generated IR refuses at preflight before WAL or network activity', async (t) => {
  const directory = await temporary(t);
  writeActions(join(directory, 'actions.jsonl'), 1);
  const harness = installFetchHarness(t);
  const replay = definition(directory, {
    api: { apply: generatedIrReference }, transportCustody: 'none', acknowledgeEvery: 1,
  });
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostic.code, 'SNAPBACK_REPLAY_GENERATED_IR_UNSUPPORTED');
  assert.equal(result.receipt.preflight.custody.generatedIrReferences, 1);
  assert.equal(harness.requests.length, 0);
  assert.equal(
    records(replay.receiptsFile).some((record) => record.v === 'snapback.replay-dispatch.v1'),
    false,
  );
});

test('minted actor custody consumes the CLI ok/data.token envelope without --json', async (t) => {
  const directory = await temporary(t, 'snapback-replay-session-mint-');
  writeActions(join(directory, 'actions.jsonl'), 1);
  const adminTokenFile = join(directory, 'admin-token');
  writeFileSync(adminTokenFile, 'admin-test\n');
  writeJson(join(directory, 'ready.json'), {
    ready: true, serverUrl: 'http://replay.test', adminTokenFile,
  });
  const runtime = join(directory, 'fake-snapback.mjs');
  writeFileSync(runtime, `#!/usr/bin/env node
if (process.argv.includes('--json')) process.exit(91);
process.stdout.write(JSON.stringify({ok:true,data:{token:'sbs-minted-cli-envelope'}}));
`);
  chmodSync(runtime, 0o700);
  const originalRuntime = process.env.SNAPBACK_RUNTIME_BINARY;
  process.env.SNAPBACK_RUNTIME_BINARY = runtime;
  t.after(() => {
    if (originalRuntime === undefined) delete process.env.SNAPBACK_RUNTIME_BINARY;
    else process.env.SNAPBACK_RUNTIME_BINARY = originalRuntime;
  });
  installFetchHarness(t);
  const replay = definition(directory, { actors: { mint: {} } });
  writeJson(replay.readyFile, { ready: true, serverUrl: 'http://replay.test', adminTokenFile });
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 0, JSON.stringify(result.receipt.diagnostic));
  assert.equal(
    JSON.parse(readFileSync(replay.sessionCustodyFile, 'utf8')).actors['actor-0'].token,
    'sbs-minted-cli-envelope',
  );
});

test('session-mint failure redacts raw child stdout and stderr', async (t) => {
  const directory = await temporary(t, 'snapback-replay-session-mint-redaction-');
  writeActions(join(directory, 'actions.jsonl'), 1);
  const adminTokenFile = join(directory, 'admin-token');
  writeFileSync(adminTokenFile, 'admin-test\n');
  writeJson(join(directory, 'ready.json'), {
    ready: true, serverUrl: 'http://replay.test', adminTokenFile,
  });
  const runtime = join(directory, 'fake-snapback-failure.mjs');
  writeFileSync(runtime, `#!/usr/bin/env node
process.stderr.write('secret-stderr-token');
process.stdout.write(JSON.stringify({ok:false,data:{token:'secret-stdout-token'},diagnostics:[{code:'SNAPBACK_AUTH_POLICY_UNAVAILABLE'}]}));
process.exit(1);
`);
  chmodSync(runtime, 0o700);
  const originalRuntime = process.env.SNAPBACK_RUNTIME_BINARY;
  process.env.SNAPBACK_RUNTIME_BINARY = runtime;
  t.after(() => {
    if (originalRuntime === undefined) delete process.env.SNAPBACK_RUNTIME_BINARY;
    else process.env.SNAPBACK_RUNTIME_BINARY = originalRuntime;
  });
  const replay = definition(directory, { actors: { mint: {} } });
  writeJson(replay.readyFile, { ready: true, serverUrl: 'http://replay.test', adminTokenFile });
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostic.code, 'SNAPBACK_REPLAY_SESSION_MINT_FAILED');
  assert.deepEqual(result.receipt.diagnostic.details.diagnosticCodes, [
    'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
  ]);
  const diagnostic = JSON.stringify(result.receipt.diagnostic);
  assert.equal(diagnostic.includes('secret-stderr-token'), false);
  assert.equal(diagnostic.includes('secret-stdout-token'), false);
});

test('resolved dispatch carriers are byte-capped before WAL append or mutation send', async (t) => {
  const directory = await temporary(t, 'snapback-replay-carrier-cap-');
  writeActions(join(directory, 'actions.jsonl'), 1);
  const harness = installFetchHarness(t);
  const replay = definition(directory, {
    mapper: (ctx) => ({ fn: 'apply', args: { seq: ctx.action.seq, payload: 'x'.repeat(1_100_000) } }),
  });
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostic.code, 'SNAPBACK_REPLAY_DISPATCH_CARRIER_TOO_LARGE');
  assert.equal(harness.requests.some(({ path }) => path === '/mutation/apply'), false);
  assert.equal(
    records(replay.receiptsFile).some((record) => record.v === 'snapback.replay-dispatch.v1'),
    false,
  );
});

test('ACK failures cannot append a second terminal for an already-settled sequence', async (t) => {
  const directory = await temporary(t, 'snapback-replay-ack-terminal-');
  writeActions(join(directory, 'actions.jsonl'), 1);
  installFetchHarness(t, {
    acknowledgeRefusal: {
      code: 'SNAPBACK_REQUEST_JSON_INVALID', message: 'fixture ACK failed',
      details: { effectCommitted: false, effectMayHaveCommitted: false },
    },
  });
  const replay = definition(directory, { acknowledgeEvery: 1 });
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 1);
  const terminals = records(replay.receiptsFile)
    .filter((record) => record.v === 'snapback.replay-terminal.v1');
  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].outcome, 'settled');
});

test('aliased actors share one auth-fingerprint ACK window and preflight composition', async (t) => {
  const directory = await temporary(t, 'snapback-replay-aliased-auth-');
  writeActions(join(directory, 'actions.jsonl'), 24, 8);
  const harness = installFetchHarness(t);
  const replay = definition(directory, { acknowledgeEvery: 8, acknowledgeBytes: 7_000_000 });
  const result = await runReplay(replay);
  assert.equal(result.exitCode, 0, JSON.stringify(result.receipt.diagnostic));
  assert.equal(result.receipt.preflight.authorityComposition.authFingerprints, 1);
  assert.equal(result.receipt.preflight.authorityComposition.largestAliasedActorCount, 8);
  assert.equal(result.receipt.preflight.advisories[0].code, 'SNAPBACK_REPLAY_BEARER_RETENTION_UNKNOWN');
  assert.ok(harness.peakRetained <= 8, `aliased authority retained peak ${harness.peakRetained}`);
  assert.deepEqual(harness.acknowledgements.map((batch) => batch.length), [8, 8, 8]);
});

test('strict WAL analysis rejects unknown outcomes, sequence gaps, and unmatched ACK ids', () => {
  const first = dispatchRecord();
  const firstTerminal = settledTerminal(first);
  const secondGap = dispatchRecord({ seq: 2, intent: 'intent-2', actor: 'actor-0' });
  for (const [label, wal] of [
    ['unknown terminal outcome', [first, { ...firstTerminal, outcome: 'mystery' }]],
    ['dispatch sequence gap', [first, firstTerminal, secondGap]],
    ['unmatched ACK id', [first, firstTerminal, {
      v: 'snapback.replay-ack.v1', actor: 'actor-0', through: ['rp-unknown'], at: Date.now(),
    }]],
  ]) {
    assert.throws(
      () => __replayTest.analyzeWal(wal),
      (error) => error?.code === 'SNAPBACK_REPLAY_WAL_INVALID',
      label,
    );
  }
});

test('strict WAL reader rejects malformed and blank JSONL lines', async (t) => {
  const directory = await temporary(t, 'snapback-replay-malformed-wal-');
  for (const [name, text] of [
    ['malformed', '{not-json}\n'],
    ['blank', `${JSON.stringify(dispatchRecord())}\n\n`],
  ]) {
    const path = join(directory, `${name}.jsonl`);
    writeFileSync(path, text);
    assert.throws(
      () => __replayTest.readWal(path),
      (error) => error?.code === 'SNAPBACK_REPLAY_WAL_INVALID',
      name,
    );
  }
});

test('scaled CI replay runs 2,000 actions over four actors in both custody modes with bounded RSS', async (t) => {
  const directory = await temporary(t, 'snapback-replay-scale-');
  const actionFile = join(directory, 'actions.jsonl');
  writeActions(actionFile, 2_000, 4);
  const harness = installFetchHarness(t);
  const before = process.memoryUsage().rss;
  let peak = before;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10);
  try {
    for (const custody of ['minted', 'none']) {
      const lane = join(directory, custody);
      mkdirSync(lane);
      writeFileSync(join(lane, 'actions.jsonl'), readFileSync(actionFile));
      const result = await runReplay(definition(lane, {
        transportCustody: custody, clientPool: 4, acknowledgeEvery: 64,
      }));
      assert.equal(result.exitCode, 0, JSON.stringify(result.receipt.diagnostic));
      assert.equal(result.receipt.actions.settled, 2_000);
      assert.equal(result.receipt.pool.maximumObserved, 4);
    }
  } finally {
    clearInterval(sampler);
  }
  const rssPeakGrowth = Math.max(0, peak - before);
  assert.ok(rssPeakGrowth <= 192 * 1_024 * 1_024, `peak RSS grew ${rssPeakGrowth} bytes`);
  assert.equal(harness.liveQueries, 0);
  assert.equal(harness.retained.size, 0, 'graceful exit drains every retained settlement');
  assert.equal(REPLAY_RETAINED_ROW_OVERHEAD_BYTES, 131_072);
});

function waitFor(predicate, timeoutMs = 10_000) {
  const started = Date.now();
  return new Promise((resolveWait, reject) => {
    const poll = () => {
      if (predicate()) return resolveWait();
      if (Date.now() - started >= timeoutMs) return reject(new Error('timed out waiting for replay child'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function nextChildMessage(child, timeoutMs = 10_000) {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for child IPC')), timeoutMs);
    child.once('message', (message) => {
      clearTimeout(timeout);
      resolveMessage(message);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test('competing detached runner refuses before changing shared config, status, or WAL', async (t) => {
  const directory = await temporary(t, 'snapback-replay-detached-fence-');
  let entered = false;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (request.url === '/auth/session') {
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify(handshake));
      }
      if (request.url === '/mutation/apply') {
        entered = true;
        return undefined;
      }
      response.writeHead(404).end();
    });
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise((resolveClose) => server.close(resolveClose));
  });
  const readyFile = join(directory, 'ready.json');
  const actions = join(directory, 'actions.jsonl');
  const apiFile = join(directory, 'api.mjs');
  const bearerFile = join(directory, 'bearer.mjs');
  const receiptsFile = join(directory, 'receipts.jsonl');
  const statusFile = join(directory, 'status.json');
  writeJson(readyFile, { ready: true, serverUrl: `http://127.0.0.1:${server.address().port}` });
  writeActions(actions, 1, 1);
  writeFileSync(apiFile, `export const apply = Object.freeze(${JSON.stringify(mutation)});\n`);
  writeFileSync(bearerFile, "export const bearerFor = async () => 'sbs-detached-fence';\n");
  const replay = defineReplay({
    readyFile, api: apiFile, actions, actors: { bearerFor: bearerFile },
    receiptsFile, statusFile, checkpointCadenceMs: 60_000,
  });
  const first = await runReplay(replay, { detach: true });
  assert.equal(first.exitCode, 0);
  t.after(() => {
    try { process.kill(first.receipt.pid, 'SIGKILL'); } catch {}
  });
  await waitFor(() => entered && readReplayStatus(statusFile).state === 'running');
  const configFile = `${statusFile}.definition.json`;
  const before = {
    config: readFileSync(configFile, 'utf8'),
    status: readFileSync(statusFile, 'utf8'),
    wal: readFileSync(receiptsFile, 'utf8'),
  };
  const contender = await runReplay(replay, { detach: true });
  assert.equal(contender.exitCode, 1);
  assert.equal(contender.receipt.diagnostic.code, 'SNAPBACK_REPLAY_RUNNER_ACTIVE');
  assert.equal(readFileSync(configFile, 'utf8'), before.config);
  assert.equal(readFileSync(statusFile, 'utf8'), before.status);
  assert.equal(readFileSync(receiptsFile, 'utf8'), before.wal);
});

test('detached config invalid is observable through the status file', async (t) => {
  const directory = await temporary(t, 'snapback-replay-detach-invalid-');
  const configFile = join(directory, 'status.json.definition.json');
  const receiptsFile = join(directory, 'receipts.jsonl');
  const statusFile = join(directory, 'status.json');
  const worker = join(import.meta.dirname, 'replay-worker.mjs');
  const child = spawn(process.execPath, [worker, configFile], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  child.send({
    v: 'snapback.replay-worker-prepare.v1', receiptsFile, statusFile,
  });
  assert.equal((await nextChildMessage(child)).v, 'snapback.replay-worker-fenced.v1');
  writeJson(configFile, { v: 'not-a-detached-definition' }, 0o600);
  child.send({ v: 'snapback.replay-worker-start.v1' });
  const failed = await nextChildMessage(child);
  assert.equal(failed.v, 'snapback.replay-worker-failed.v1');
  assert.equal(failed.diagnostic.code, 'SNAPBACK_REPLAY_DETACH_CONFIG_INVALID');
  const status = readReplayStatus(statusFile);
  assert.equal(status.state, 'failed');
  assert.equal(status.diagnostic.code, 'SNAPBACK_REPLAY_DETACH_CONFIG_INVALID');
});

test('SIGKILL resume reuses minted custody, rebuilds the map, and executes the ambiguous action once', async (t) => {
  const directory = await temporary(t, 'snapback-replay-kill-');
  const retained = new Map();
  let effects = [];
  let blockSeq = 2;
  let blocked = false;
  let queryRequests = 0;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const answer = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.url === '/auth/session') return answer(200, handshake);
      if (request.url === '/client-mutations/acknowledge') {
        for (const id of body.clientMutationIds) retained.delete(id);
        return answer(200, { acknowledged: body.clientMutationIds });
      }
      if (request.url === '/query/lookup') {
        queryRequests += 1;
        return answer(200, { version: effects.length, rows: [], cursor: null });
      }
      if (request.url !== '/mutation/apply') return answer(404, {});
      const prior = retained.get(body.clientMutationId);
      const identity = JSON.stringify({
        authorization: request.headers.authorization ?? null,
        function: request.url,
        args: body.args,
      });
      if (prior) {
        if (prior.identity !== identity) {
          return answer(409, { diagnostic: {
            code: 'SNAPBACK_AUTH_STALE_RESULT',
            message: 'fixture retained identity collision',
            details: { effectCommitted: false, effectMayHaveCommitted: false },
          } });
        }
        return answer(200, prior.outcome);
      }
      const result = {
        version: effects.length + 1,
        result: { id: `row-${body.args.seq}`, parentId: body.args.parentId ?? null },
      };
      effects.push(result.result);
      retained.set(body.clientMutationId, { identity, outcome: result });
      if (body.args.seq === blockSeq && !blocked) {
        blocked = true;
        return undefined;
      }
      return answer(200, result);
    });
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const serverUrl = `http://127.0.0.1:${server.address().port}`;
  const actions = join(directory, 'actions.jsonl');
  writeActions(actions, 4, 1);
  const readyFile = join(directory, 'ready.json');
  writeJson(readyFile, { ready: true, serverUrl });
  const apiFile = join(directory, 'api.mjs');
  writeFileSync(apiFile, `export const apply = Object.freeze(${JSON.stringify(mutation)});
export const lookup = Object.freeze(${JSON.stringify(lookupQuery)});\n`);
  const bearerFile = join(directory, 'bearer.mjs');
  writeFileSync(bearerFile, "export const bearerFor = async () => 'sbs-stable-replay-test';\n");
  const mapperFile = join(directory, 'mapper.mjs');
  writeFileSync(mapperFile, `export async function mapper(ctx) {
    const seq = ctx.action.seq;
    await ctx.query('lookup', {args:{seq}, pageSize:1});
    const prior = seq === 0 ? null : ctx.settled('intent-' + (seq - 1));
    return {fn:'apply', args:{seq, parentId: prior?.ids?.id ?? null}};
  }\n`);
  const receiptsFile = join(directory, 'kill-receipts.jsonl');
  const statusFile = join(directory, 'kill-status.json');
  const definitionOptions = {
    readyFile, api: apiFile, actions, mapper: mapperFile,
    actors: { bearerFor: bearerFile }, transportCustody: 'minted',
    acknowledgeEvery: 64, receiptsFile, statusFile,
  };
  const configFile = join(directory, 'child.json');
  writeJson(configFile, { definition: definitionOptions, resume: false });
  const child = spawn(process.execPath, [join(import.meta.dirname, 'replay-child.fixture.mjs'), configFile], {
    stdio: 'ignore',
  });
  await waitFor(() => {
    if (blocked) return true;
    try { return readReplayStatus(statusFile).state === 'failed'; } catch { return false; }
  });
  assert.equal(blocked, true, JSON.stringify(readReplayStatus(statusFile).diagnostic));
  child.kill('SIGKILL');
  await new Promise((resolveExit) => child.once('exit', resolveExit));
  assert.equal(readReplayStatus(statusFile).state, 'dead');

  blockSeq = null;
  const resumed = await runReplay(defineReplay({
    ...definitionOptions, actors: { bearerFor: () => 'sbs-stable-replay-test' },
  }), { resume: true });
  assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.receipt.diagnostic));
  assert.equal(resumed.receipt.actions.skipped, 2);
  assert.equal(
    queryRequests,
    4,
    'resume did not re-run mapper/ctx.query for two terminal lines or the dispatch-only carrier',
  );
  assert.equal(effects.length, 4, 'the crash-ambiguous action was not executed twice');
  assert.equal(retained.size, 0, 'resume drains every terminal-lined retained settlement');
  assert.deepEqual(effects, [
    { id: 'row-0', parentId: null },
    { id: 'row-1', parentId: 'row-0' },
    { id: 'row-2', parentId: 'row-1' },
    { id: 'row-3', parentId: 'row-2' },
  ]);
  const resumedDigest = createHash('sha256').update(JSON.stringify(effects)).digest('hex');

  retained.clear(); effects = []; blocked = false; blockSeq = null;
  const uninterruptedDirectory = join(directory, 'uninterrupted');
  mkdirSync(uninterruptedDirectory);
  const uninterruptedActions = join(uninterruptedDirectory, 'actions.jsonl');
  writeFileSync(uninterruptedActions, readFileSync(actions));
  const uninterrupted = await runReplay(defineReplay({
    ...definitionOptions,
    actions: uninterruptedActions,
    actors: { bearerFor: () => 'sbs-stable-replay-test' },
    receiptsFile: join(uninterruptedDirectory, 'receipts.jsonl'),
    statusFile: join(uninterruptedDirectory, 'status.json'),
  }));
  assert.equal(uninterrupted.exitCode, 0, JSON.stringify(uninterrupted.receipt.diagnostic));
  const uninterruptedDigest = createHash('sha256').update(JSON.stringify(effects)).digest('hex');
  assert.equal(resumedDigest, uninterruptedDigest);

  retained.clear(); effects = [];
  const detachedDirectory = join(directory, 'detached');
  mkdirSync(detachedDirectory);
  const detachedActions = join(detachedDirectory, 'actions.jsonl');
  writeFileSync(detachedActions, readFileSync(actions));
  const detachedStatus = join(detachedDirectory, 'status.json');
  const detached = await runReplay(defineReplay({
    ...definitionOptions,
    actions: detachedActions,
    receiptsFile: join(detachedDirectory, 'receipts.jsonl'),
    statusFile: detachedStatus,
  }), { detach: true });
  assert.equal(detached.receipt.status, 'detached');
  await waitFor(() => {
    try { return readReplayStatus(detachedStatus).state === 'complete'; } catch { return false; }
  });
  assert.equal(readReplayStatus(detachedStatus).state, 'complete');
});

test('minted session sidecar survives SIGKILL and resumes without reminting', async (t) => {
  const directory = await temporary(t, 'snapback-replay-minted-sidecar-kill-');
  const retained = new Map();
  const effects = [];
  let blocked = false;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const answer = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.url === '/auth/session') return answer(200, handshake);
      if (request.url === '/client-mutations/acknowledge') {
        for (const id of body.clientMutationIds) retained.delete(id);
        return answer(200, { acknowledged: body.clientMutationIds.length });
      }
      if (request.url !== '/mutation/apply') return answer(404, {});
      const prior = retained.get(body.clientMutationId);
      if (prior !== undefined) return answer(200, prior);
      const outcome = { version: effects.length + 1, result: { id: `row-${body.args.seq}` } };
      effects.push(outcome.result);
      retained.set(body.clientMutationId, outcome);
      if (!blocked) {
        blocked = true;
        return undefined;
      }
      return answer(200, outcome);
    });
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise((resolveClose) => server.close(resolveClose));
  });

  const readyFile = join(directory, 'ready.json');
  const adminTokenFile = join(directory, 'admin-token');
  const actions = join(directory, 'actions.jsonl');
  const apiFile = join(directory, 'api.mjs');
  const receiptsFile = join(directory, 'receipts.jsonl');
  const statusFile = join(directory, 'status.json');
  writeFileSync(adminTokenFile, 'admin-test\n');
  writeJson(readyFile, {
    ready: true,
    serverUrl: `http://127.0.0.1:${server.address().port}`,
    adminTokenFile,
  });
  writeActions(actions, 2, 1);
  writeFileSync(apiFile, `export const apply = Object.freeze(${JSON.stringify(mutation)});\n`);
  const runtime = join(directory, 'fake-snapback.mjs');
  writeFileSync(runtime, `#!/usr/bin/env node
if (process.argv.includes('--json')) process.exit(91);
process.stdout.write(JSON.stringify({ok:true,data:{token:'sbs-sidecar-survives-kill'}}));
`);
  chmodSync(runtime, 0o700);
  const originalRuntime = process.env.SNAPBACK_RUNTIME_BINARY;
  process.env.SNAPBACK_RUNTIME_BINARY = runtime;
  t.after(() => {
    if (originalRuntime === undefined) delete process.env.SNAPBACK_RUNTIME_BINARY;
    else process.env.SNAPBACK_RUNTIME_BINARY = originalRuntime;
  });

  const definitionOptions = {
    readyFile, api: apiFile, actions, actors: { mint: {} }, transportCustody: 'minted',
    acknowledgeEvery: 64, receiptsFile, statusFile,
  };
  const configFile = join(directory, 'child.json');
  writeJson(configFile, { definition: definitionOptions, resume: false });
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, 'replay-child.fixture.mjs'), configFile],
    { stdio: 'ignore' },
  );
  await waitFor(() => blocked);
  child.kill('SIGKILL');
  await new Promise((resolveExit) => child.once('exit', resolveExit));
  const custody = JSON.parse(readFileSync(`${receiptsFile}.sessions.json`, 'utf8'));
  assert.equal(custody.actors['actor-0'].token, 'sbs-sidecar-survives-kill');

  // If resume tries to mint again, spawn now fails. Success proves the
  // crash-ambiguous retry reuses the persisted authority carrier.
  process.env.SNAPBACK_RUNTIME_BINARY = join(directory, 'mint-must-not-run');
  const resumed = await runReplay(defineReplay(definitionOptions), { resume: true });
  assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.receipt.diagnostic));
  assert.equal(effects.length, 2);
  assert.equal(retained.size, 0);
});

test('three kill/resume cycles stay bounded on one auth fingerprint', async (t) => {
  const directory = await temporary(t, 'snapback-replay-three-kills-');
  const retained = new Map();
  const effects = [];
  const acknowledgementSizes = [];
  let peakRetained = 0;
  let blockSeq = null;
  let blocked = false;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const answer = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.url === '/auth/session') return answer(200, handshake);
      if (request.url === '/client-mutations/acknowledge') {
        acknowledgementSizes.push(body.clientMutationIds.length);
        for (const id of body.clientMutationIds) retained.delete(id);
        return answer(200, { acknowledged: body.clientMutationIds.length });
      }
      if (request.url !== '/mutation/apply') return answer(404, {});
      const prior = retained.get(body.clientMutationId);
      if (prior !== undefined) return answer(200, prior);
      const result = { version: effects.length + 1, result: { id: `row-${body.args.seq}` } };
      effects.push(result.result);
      retained.set(body.clientMutationId, result);
      peakRetained = Math.max(peakRetained, retained.size);
      if (body.args.seq === blockSeq && !blocked) {
        blocked = true;
        return undefined;
      }
      return answer(200, result);
    });
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise((resolveClose) => server.close(resolveClose));
  });
  const readyFile = join(directory, 'ready.json');
  const actions = join(directory, 'actions.jsonl');
  const apiFile = join(directory, 'api.mjs');
  const bearerFile = join(directory, 'bearer.mjs');
  const receiptsFile = join(directory, 'receipts.jsonl');
  const statusFile = join(directory, 'status.json');
  writeJson(readyFile, { ready: true, serverUrl: `http://127.0.0.1:${server.address().port}` });
  writeActions(actions, 6, 1);
  writeFileSync(apiFile, `export const apply = Object.freeze(${JSON.stringify(mutation)});\n`);
  writeFileSync(bearerFile, "export const bearerFor = async () => 'sbs-three-kills';\n");
  const definitionOptions = {
    readyFile, api: apiFile, actions, actors: { bearerFor: bearerFile },
    transportCustody: 'minted', acknowledgeEvery: 2, acknowledgeBytes: 7_000_000,
    receiptsFile, statusFile,
  };
  const configFile = join(directory, 'child.json');
  for (const [cycle, target] of [1, 3, 5].entries()) {
    blockSeq = target;
    blocked = false;
    writeJson(configFile, { definition: definitionOptions, resume: cycle > 0 });
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, 'replay-child.fixture.mjs'), configFile],
      { stdio: 'ignore' },
    );
    await waitFor(() => blocked);
    child.kill('SIGKILL');
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    assert.equal(readReplayStatus(statusFile).state, 'dead');
    assert.ok(retained.size <= 2, `cycle ${cycle + 1} retained ${retained.size}`);
  }
  blockSeq = null;
  const resumed = await runReplay(defineReplay({
    ...definitionOptions, actors: { bearerFor: () => 'sbs-three-kills' },
  }), { resume: true });
  assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.receipt.diagnostic));
  assert.equal(effects.length, 6, 'each crash-ambiguous action executed exactly once');
  assert.equal(retained.size, 0, 'final resume drains every settled identity');
  assert.ok(peakRetained <= 2, `retained peak ${peakRetained} crossed the per-fingerprint window`);
  assert.ok(acknowledgementSizes.every((size) => size <= 2));
});

test('JavaScript and kernel retain the same ACK ceiling constants', () => {
  const rust = readFileSync(new URL('../../crates/snapback-kernel/src/storage.rs', import.meta.url), 'utf8');
  assert.match(rust, /HEADLESS_REPLAY_RETAINED_ROW_OVERHEAD_BYTES: u64 =\s*2 \* CLIENT_MUTATION_MAX_RESULT_BYTES/u);
  assert.equal(REPLAY_CEILINGS.retainedMutationResultBytes, 65_536);
  assert.equal(REPLAY_CEILINGS.retainedMutationRecordsPerAuthority, 1_024);
  assert.equal(REPLAY_CEILINGS.retainedMutationBytesPerAuthority, 8 * 1_024 * 1_024);
  assert.equal(REPLAY_RETAINED_ROW_OVERHEAD_BYTES, 2 * REPLAY_CEILINGS.retainedMutationResultBytes);
  assert.equal(__replayTest.chargeForResult(null), 131_076);
});
