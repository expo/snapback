import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCli } from './index.mjs';

const hash = (kind, character) => `snapback.v1:sessions:${kind}:sha256:${character.repeat(64)}`;
const activation = {
  schemaVersion: 'snapback.v1', appId: '018f0d90-7b14-7a22-8c33-445566778899',
  schemaHash: hash('schema', '1'), bundleHash: hash('function', '2'), inputsHash: hash('inputs', '3'),
};
const reference = {
  artifactKind: 'functionReference', schemaVersion: 'snapback.v1', appId: activation.appId,
  id: `${activation.appId}:apply`, name: 'apply', kind: 'Mutation',
  implementationHash: `sha256:${'4'.repeat(64)}`,
  argsContractHash: `sha256:${'5'.repeat(64)}`,
  resultContractHash: `sha256:${'6'.repeat(64)}`,
  expectedGeneration: activation,
  argsContract: { fields: [{
    name: 'seq', required: true,
    value: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
  }] },
  argumentSchema: {
    type: 'object', additionalProperties: false,
    properties: { seq: { type: 'integer' } }, required: ['seq'],
  },
};
const handshake = {
  protocolVersion: 1, serverStartupNonce: 'startup-replay-cli',
  authorizationStreamIncarnation: '018f0d90-7b11-7a22-8c33-445566778899',
  transitionGeneration: 1, activeMode: 'sessions', desiredMode: 'sessions', modeState: 'settled',
  appDataAvailability: 'available', quarantineCode: null,
  clientProtocols: {
    authClient: 1, authInvalidation: 1, authorityDescriptor: 1, authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false, minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1, reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
    },
    queuedReplay: { available: true, minimumAuthorityDescriptorProtocol: 1, reason: null },
  },
  provider: { key: 'email-code', available: true }, transports: ['bearer'],
  authority: {
    kind: 'humanSession', userId: '018f0d90-7b12-7a22-8c33-445566778899',
    sessionId: '018f0d90-7b13-7a22-8c33-445566778899', isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1, authorityInstanceId: '018f0d90-7b11-7a22-8c33-445566778899',
    sessionGeneration: 1,
  },
  deploymentIdentity: { ...activation, authMode: 'sessions' }, authorizedLease: null,
};

for (const [kind, code, message] of [
  ['handler', 'SNAPBACK_HANDLER_CLI_REFUSED', 'CLI handler refusal is verbatim'],
  ['auth', 'SNAPBACK_AUTH_GRANT_SCOPE_DENIED', 'CLI auth refusal is verbatim'],
]) {
  test(`snapback replay --json preserves ${kind} diagnostic and position`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), `snapback-replay-cli-${kind}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const backend = join(root, 'snapback');
    const generated = join(backend, 'generated');
    const control = join(root, '.snapback');
    mkdirSync(generated, { recursive: true });
    mkdirSync(control, { recursive: true });
    const actions = join(root, 'actions.jsonl');
    const readyFile = join(control, 'dev.ready.json');
    const receiptsFile = join(control, 'replay-receipts.jsonl');
    writeFileSync(join(generated, 'api.mjs'), `export const apply = Object.freeze(${JSON.stringify(reference)});\n`);
    writeFileSync(actions, `${JSON.stringify({
      seq: 0, actor: 'actor-0', fn: 'apply', intent: 'cli-intent', args: { seq: 0 },
    })}\n`);
    writeFileSync(readyFile, `${JSON.stringify({ ready: true, serverUrl: 'http://replay-cli.test' })}\n`);
    writeFileSync(`${receiptsFile}.sessions.json`, `${JSON.stringify({
      v: 'snapback.replay-session-custody.v1', readyFile,
      actors: { 'actor-0': { email: 'actor-0@replay.invalid', token: 'sbs-cli-test', mintedAt: 1 } },
    })}\n`, { mode: 0o600 });
    chmodSync(`${receiptsFile}.sessions.json`, 0o600);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/session') {
        if (kind === 'auth') {
          return new Response(JSON.stringify({ diagnostic: {
            code, severity: 'error', subsystem: 'auth', message,
            details: { effectCommitted: false, effectMayHaveCommitted: false },
          } }), { status: 403, headers: { 'content-type': 'application/json' } });
        }
        return Response.json(handshake);
      }
      if (path === '/mutation/apply') {
        return new Response(JSON.stringify({
          diagnostic: {
            code, severity: 'error', subsystem: 'runtime', message,
            details: { effectCommitted: false, effectMayHaveCommitted: false },
          },
          receipt: { kind: 'mutation', mutationId: JSON.parse(init.body).clientMutationId, outcome: 'rejected' },
        }), { status: 409, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected CLI replay request ${path}`);
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const output = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => output.push(values.join(' '));
    console.error = () => {};
    t.after(() => { console.log = originalLog; console.error = originalError; });
    const exitCode = await runCli([
      'replay', backend, '--actions', actions, '--json',
    ], { cwd: root });
    assert.equal(exitCode, 1);
    assert.equal(output.length, 1, '--json wrote exactly one stdout document');
    const receipt = JSON.parse(output[0]);
    assert.equal(receipt.diagnostic.code, code);
    assert.equal(receipt.diagnostic.message, message);
    assert.equal(receipt.diagnostic.position.seq, 0);
    assert.equal(receipt.diagnostic.position.intent, 'cli-intent');
  });
}
