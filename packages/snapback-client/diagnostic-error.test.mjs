import assert from 'node:assert/strict';

import {
  SnapbackClient,
  SnapbackDiagnosticError,
  isSnapbackDiagnosticError,
} from './index.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

const reference = (kind, name) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'diagnostic-error-test',
  id: `diagnostic-error-test:${name}`,
  name,
  kind,
  implementationHash: 'sha256:implementation',
  argsContractHash: 'sha256:args',
  argsContract: { fields: [] },
  argumentSchema: { type: 'object', additionalProperties: false, properties: {} },
  resultContractHash: 'sha256:result',
});

const outcomes = new Map([
  ['/query/refusedQuery', new Response(JSON.stringify({
    diagnostic: {
      code: 'SNAPBACK_APP_REFUSAL',
      message: 'query refused',
      details: { appCode: 'QUERY_NO', retryable: false, effectCommitted: false },
    },
  }), { status: 409, headers: { 'content-type': 'application/json' } })],
  ['/mutation/refusedMutation', new Response(JSON.stringify({
    diagnostic: {
      code: 'SNAPBACK_APP_REFUSAL',
      message: 'mutation refused',
      details: { appCode: 'MUTATION_NO', retryable: false, effectCommitted: false },
    },
  }), { status: 409, headers: { 'content-type': 'application/json' } })],
  ['/action/refusedAction', new Response(JSON.stringify({
    ok: false,
    diagnostic: {
      code: 'SNAPBACK_APP_REFUSAL',
      message: 'action refused',
      details: { appCode: 'ACTION_NO', retryable: false },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })],
  ['/action/successAction', new Response(JSON.stringify({ ok: true, result: { value: 7 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })],
]);

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalNodeEnv = process.env.NODE_ENV;
const warnings = [];
process.env.NODE_ENV = 'development';
globalThis.fetch = async (url) => {
  const pathname = new URL(url).pathname;
  const response = outcomes.get(pathname);
  assert(response, `unexpected request ${pathname}`);
  return response.clone();
};
console.warn = (...parts) => warnings.push(parts.join(' '));

try {
  const client = new SnapbackClient('http://diagnostics.invalid');
  for (const [operation, call, expectedMayCommit] of [
    ['query', () => client.query(reference('Query', 'refusedQuery')), false],
    ['mutation', () => client.mutate(reference('Mutation', 'refusedMutation'), { queue: false }), false],
    ['action', () => client.run(reference('Action', 'refusedAction')), true],
  ]) {
    await assert.rejects(call, (error) => {
      assert(error instanceof SnapbackDiagnosticError, operation);
      assert(isSnapbackDiagnosticError(error), operation);
      assert.equal(error.code, 'SNAPBACK_APP_REFUSAL', operation);
      assert.equal(error.diagnostic.code, error.code, operation);
      assert.equal(error.operation, operation, operation);
      assert.equal(error.retryable, false, operation);
      assert.equal(error.effectMayHaveCommitted, expectedMayCommit, operation);
      return true;
    });
  }

  assert.deepEqual(
    await client.run(reference('Action', 'successAction')),
    { value: 7 },
    'run resolves only the plain typed action result',
  );
  const raw = await client.action(reference('Action', 'refusedAction'));
  assert.equal(raw.ok, false, 'deprecated action retains the raw refusal envelope');
  await client.action(reference('Action', 'successAction'));
  assert.equal(warnings.length, 1, 'action deprecation is emitted once per module instance');
  assert.match(warnings[0], /client\.run\(\).*isSnapbackDiagnosticError/u);

  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'diagnostic-test', durable: true });
  const queuedClient = new SnapbackClient('http://queued.invalid', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const queued = await queuedClient.mutate('queuedMutation', { args: { value: 1 } });
  assert.equal(queued.status, 'queued', 'queued dispatch remains a resolved union');
  assert.equal(queued.queued, true);
  await queuedClient.closeAuth();
} finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}

console.log('diagnostic-error.test.mjs: query/run/mutation guard parity, action compatibility, and deprecation passed');
