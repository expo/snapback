import assert from 'node:assert/strict';

import {
  CODE_MODE_HAZARDOUS_ALIASES_V1,
  codeModeBindings,
  renderCodeModeTypes,
  runCodeMode,
} from './code-mode.mjs';
import { CODE_MODE_HAZARDOUS_ALIASES_V1 as CODEGEN_HAZARDOUS_ALIASES_V1 } from '../snapback-codegen/api-envelope-members.mjs';

assert.deepEqual(CODE_MODE_HAZARDOUS_ALIASES_V1, CODEGEN_HAZARDOUS_ALIASES_V1);

const calls = [];
let liveDisposals = 0;
const client = {
  async query(name, { args }) {
    calls.push({ kind: 'query', name, args });
    if (name === 'refuse') {
      const error = new Error('planted sensitive message');
      error.code = 'SNAPBACK_AUTH_REQUIRED';
      error.status = 401;
      error.diagnostic = { subsystem: 'auth', message: 'planted sensitive message', details: { bearer: 'sbs_planted' } };
      throw error;
    }
    if (name === 'never') return new Promise(() => {});
    return { rows: [{ echoed: args }], version: 1, plantedFact: 'must-not-enter-audit' };
  },
  async mutate(name, { args }) { calls.push({ kind: 'mutation', name, args }); return { result: { name, args } }; },
  async action(name, { args }) { calls.push({ kind: 'action', name, args }); return { result: { name, args } }; },
  startLiveQuery(name, { args, onUpdate }) {
    calls.push({ kind: 'liveQuery', name, args });
    if (name === 'stallWatch') {
      return Object.freeze({
        started: () => new Promise(() => {}),
        dispose() { liveDisposals += 1; },
        settled: async () => {},
      });
    }
    let disposed = false;
    const started = Promise.resolve().then(() => {
      onUpdate([{ sequence: 1, name, args }]);
      setTimeout(() => { if (!disposed) onUpdate([{ sequence: 2, name, args }]); }, 10);
    });
    return Object.freeze({
      started: () => started,
      dispose() { disposed = true; liveDisposals += 1; },
      settled: async () => {},
      get disposed() { return disposed; },
    });
  },
};
const surface = {
  appId: 'code-mode-test',
  envelopeSha256: 'a'.repeat(64),
  generation: null,
  functions: [
    { id: 'code-mode-test:list', name: 'list', kind: 'query', authRequirement: 'optional-user' },
    { id: 'code-mode-test:then', name: 'then', kind: 'query', authRequirement: 'optional-user' },
    { id: 'code-mode-test:refuse', name: 'refuse', kind: 'query', authRequirement: 'authenticated' },
    { id: 'code-mode-test:never', name: 'never', kind: 'query', authRequirement: 'optional-user' },
    { id: 'code-mode-test:write', name: 'write', kind: 'mutation', authRequirement: 'optional-user' },
    { id: 'code-mode-test:act', name: 'act', kind: 'action', authRequirement: 'optional-user' },
    { id: 'code-mode-test:watch', name: 'watch', kind: 'liveQuery', authRequirement: 'optional-user' },
    { id: 'code-mode-test:stallWatch', name: 'stallWatch', kind: 'liveQuery', authRequirement: 'optional-user' },
  ],
};

const frames = [];
const first = await runCodeMode({
  client,
  surface,
  args: ['tail'],
  onStderr: (frame) => frames.push(frame),
  script: `
    type Row = { echoed: unknown };
    const rows = await api.list({ page: 1 }) as Row[];
    const hazardous = await snapback.function('code-mode-test:then')({ via: 'stable-id' });
    const live = [];
    for await (const value of api.watch({ required: true })) {
      live.push(value);
      if (live.length === 2) break;
    }
    signal.addEventListener('abort', () => console.info('cleanup-observed'));
    setTimeout(() => console.error('orphan-timer-fired'), 60_000);
    export default {
      rows,
      hazardous,
      live,
      args,
      processType: typeof process,
      fetchType: typeof fetch,
      hazardousAlias: typeof api.then,
      envelopeHash: snapback.envelopeHash,
    };
  `,
});
assert.equal(first.hasValue, true);
assert.deepEqual(first.value.rows, [{ echoed: { page: 1 } }]);
assert.equal(first.value.hazardousAlias, 'undefined');
assert.equal(first.value.processType, 'undefined');
assert.equal(first.value.fetchType, 'undefined');
assert.deepEqual(first.value.args, ['tail']);
assert.deepEqual(first.value.live.map((entry) => entry[0].sequence), [1, 2]);
assert.equal(liveDisposals, 1, 'breaking the async iterator disposes its parent-owned subscription');
assert.equal(frames.some((frame) => frame.type === 'console' && frame.text === 'cleanup-observed'), true);
assert.equal(frames.some((frame) => JSON.stringify(frame).includes('orphan-timer-fired')), false);
assert.equal(frames.some((frame) => JSON.stringify(frame).includes('plantedFact')), false);
assert.equal(JSON.stringify({ first, frames }).includes('sbs_planted'), false);

const caught = await runCodeMode({
  client,
  surface,
  principalClass: 'session',
  script: `
    let code = null;
    try { await api.refuse({}); } catch (error) { code = error.code; }
    export default { code };
  `,
});
assert.deepEqual(caught.value, { code: 'SNAPBACK_AUTH_REQUIRED' });

const requestsBeforePreflight = calls.length;
await assert.rejects(
  runCodeMode({ client, surface, script: 'export default await api.refuse({});' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_USAGE' && error.exitCode === 2,
);
assert.equal(calls.length, requestsBeforePreflight, 'anonymous authenticated-call preflight dispatches nothing');

await assert.rejects(
  runCodeMode({ client, surface, principalClass: 'session', script: 'export default await api.refuse({});' }),
  (error) => error.code === 'SNAPBACK_AUTH_REQUIRED' && error.exitCode === 3,
);
await assert.rejects(
  runCodeMode({ client, surface, callTimeoutMs: 20, script: 'export default await api.never({}, { timeoutMs: 20 });' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_TIMEOUT' && error.exitCode === 9,
);
await assert.rejects(
  runCodeMode({ client, surface, callTimeoutMs: 20, script: 'for await (const value of api.stallWatch({}, { timeoutMs: 20 })) { export default value; }' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_USAGE' && error.exitCode === 2,
  'the one default export must be top-level',
);
await assert.rejects(
  runCodeMode({
    client,
    surface,
    callTimeoutMs: 20,
    script: 'const iterator = api.stallWatch({}, { timeoutMs: 20 })[Symbol.asyncIterator](); export default await iterator.next();',
  }),
  (error) => error.code === 'SNAPBACK_APP_CLI_TIMEOUT' && error.exitCode === 9,
);
await assert.rejects(
  runCodeMode({
    client,
    surface,
    maxSubscriptions: 1,
    script: `
      const one = api.watch({ one: true })[Symbol.asyncIterator]();
      const two = api.watch({ two: true })[Symbol.asyncIterator]();
      export default await Promise.all([one.next(), two.next()]);
    `,
  }),
  (error) => error.code === 'SNAPBACK_APP_CLI_RESOURCE_EXCEEDED' && error.exitCode === 11,
);
await assert.rejects(
  runCodeMode({ client, surface, maxCalls: 1, script: 'await api.list({}); export default await api.list({});' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_RESOURCE_EXCEEDED' && error.exitCode === 11,
);
for (const script of [
  "import fs from 'node:fs'; export default null;",
  "export default await import('node:fs');",
  'enum Nope { A }; export default Nope.A;',
  'namespace Nope { export const a = 1 }; export default Nope.a;',
  'export const extra = 1; export default extra;',
]) {
  await assert.rejects(
    runCodeMode({ client, surface, script }),
    (error) => error.code === 'SNAPBACK_APP_CLI_USAGE' && error.exitCode === 2,
  );
}
await assert.rejects(
  runCodeMode({ client, surface, script: 'export default new Date();' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_SCRIPT_ERROR' && error.exitCode === 10,
);
await assert.rejects(
  runCodeMode({ client, surface, script: 'export default undefined;' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_SCRIPT_ERROR' && error.exitCode === 10,
);
await assert.rejects(
  runCodeMode({ client, surface, script: 'const x = {}; Object.defineProperty(x, "secret", { enumerable: true, get() { return 1; } }); export default x;' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_SCRIPT_ERROR' && error.exitCode === 10,
);
await assert.rejects(
  runCodeMode({ client, surface, script: 'const x = []; x.length = 1; x.extra = 1; export default x;' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_SCRIPT_ERROR' && error.exitCode === 10,
);
await assert.rejects(
  runCodeMode({ client, surface, maxOutputBytes: 32, script: 'export default "x".repeat(100);' }),
  (error) => error.code === 'SNAPBACK_APP_CLI_RESOURCE_EXCEEDED' && error.exitCode === 11,
);
const empty = await runCodeMode({ client, surface, script: 'const complete: boolean = true;' });
assert.equal(empty.hasValue, false);

const types = renderCodeModeTypes(surface);
assert.match(types, /declare const api/u);
assert.match(types, /readonly "list"/u);
assert.doesNotMatch(types, /readonly "then"/u);
assert.match(types, /function\(id: string\)/u);
assert.throws(
  () => codeModeBindings({ functions: [{ id: 'bad:id', name: 'bad-name', kind: 'query' }] }),
  (error) => error.code === 'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
);

console.log('code-mode.test.mjs: broker ABI, language profile, ceilings, cleanup, and non-transmission pass');
