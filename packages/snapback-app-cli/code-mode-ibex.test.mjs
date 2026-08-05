import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { runIbexCodeMode } from './code-mode-ibex.mjs';
import { jcsCanonical } from './envelope.mjs';

const hash = (bytes) => `sha256-${createHash('sha256').update(bytes).digest('base64url')}`;
const limits = Object.freeze({
  sourceBytes: 1048576,
  transformedSourceBytes: 4194304,
  sourceMapBytes: 8388608,
  transformArenaBytes: 67108864,
  runWallMs: 120000,
  callEstablishmentMs: 60000,
  brokerOperations: 1000,
  openSubscriptions: 16,
  frameBytes: 1048576,
  resultBytes: 1048576,
  stderrBytes: 1048576,
  heapBytes: 134217728,
  graceMs: 2000,
  openTimers: 1024,
});
const maxima = Object.freeze({
  ...limits,
  runWallMs: 1800000,
  callEstablishmentMs: 300000,
  brokerOperations: 10000,
  openSubscriptions: 256,
  frameBytes: 4194304,
  resultBytes: 16777216,
  stderrBytes: 16777216,
  heapBytes: 536870912,
  graceMs: 10000,
  openTimers: 8192,
});
const digestValue = hash(Buffer.from('identity'));

const fakeBridge = ({ settleAs, graceCall = false, settles = true, onAbort = () => {}, consoleCount = 1, live = false } = {}) => ({
  contract: jcsCanonical({
    schema: 'ibex/app-bound-worker-bridge-contract/1',
    appBindingDigest: digestValue,
    origin: 'https://example.test',
    appId: 'example',
    engineCompatibilityDigest: digestValue,
    language: 'ibex/restricted-worker-language/1',
    languageDigest: digestValue,
    workerPolicy: 'ibex/restricted-worker-policy/1',
    workerPolicyDigest: digestValue,
    broker: 'ibex/restricted-worker-broker/1',
    globalsDigest: digestValue,
    defaults: limits,
    maxima,
  }),
  digestLimits: () => digestValue,
  transformExternalScript: (_path, source) => jcsCanonical({
    schema: 'ibex/external-script-transform/1',
    callableSource: source,
    composedSourceMap: '{}',
    sourceDigest: hash(Buffer.from(source)),
    transformedSourceDigest: hash(Buffer.from(source)),
    sourceMapDigest: hash(Buffer.from('{}')),
    hasDefaultExport: true,
  }),
  create: () => {
    let runId;
    let outgoing = 1;
    const queue = [];
    let settled = false;
    const frame = (type, body) => queue.push({
      tag: 1,
      frame: jcsCanonical({ schema: 'ibex/restricted-worker-broker/1', runId, sequence: outgoing++, type, body }),
    });
    return {
      start(_source, _map, encoded) {
        const start = JSON.parse(encoded);
        runId = start.runId;
        assert.match(start.body.surface.envelopeDigest, /^sha256-[A-Za-z0-9_-]{43}$/u);
        if (live) {
          frame('liveOpen', { subscriptionId: 'live-1', functionId: 'app:watch', args: {}, timeoutMs: 60000 });
        } else {
          frame('call', { callId: '1', functionId: 'app:list', args: {}, timeoutMs: 60000 });
        }
      },
      submit(encoded) {
        const received = JSON.parse(encoded);
        if (received.type === 'abort') {
          onAbort(received.body);
          for (let index = 0; index < consoleCount; index += 1) {
            frame('console', { level: 'log', values: ['cleanup-observed', 'x'.repeat(128)] });
          }
          if (graceCall) frame('call', { callId: '2', functionId: 'app:list', args: {}, timeoutMs: 60000 });
          return;
        }
        if (live && received.type === 'liveOpened') {
          assert.equal(received.body.ok, true);
          return;
        }
        if (live) assert.equal(received.type, 'liveValue');
        else assert.equal(received.type, 'callResult');
        if (settled) {
          assert.equal(received.body.ok, false);
          assert.equal(received.body.error.code, 'SNAPBACK_APP_CLI_ABORTED');
          return;
        }
        if (!settles) return;
        settled = true;
        const value = settleAs ?? (live
          ? received.body.value
          : (received.body.ok ? received.body.value : { caught: true }));
        const text = jcsCanonical(value);
        const bytes = Buffer.from(text);
        frame('settlementBegin', { hasValue: true, byteLength: bytes.length, digest: hash(bytes), chunkCount: 1 });
        frame('settlementChunk', { index: 0, data: bytes.toString('base64url') });
        frame('settlementEnd', {});
      },
      take: () => queue.shift(),
      interrupt() { queue.push({ tag: 4 }); },
      destroy() {},
    };
  },
});

globalThis.__ibexAppBoundWorkerV1 = fakeBridge();
const surface = Object.freeze({
  appId: 'example',
  generation: null,
  envelopeSha256: digestValue,
  functions: Object.freeze([{ id: 'app:list', name: 'list', kind: 'query', argsSchema: null }]),
});
const stderr = [];
const result = await runIbexCodeMode({
  client: { query: async () => ({ rows: [{ id: 1 }] }) },
  surface,
  script: 'export default await api.list({});',
  scriptSource: 'analysis.ts',
  graceMs: 20,
  onStderr: (record) => stderr.push(record),
});
assert.equal(result.hasValue, true);
assert.deepEqual(result.value, [{ id: 1 }]);
assert.equal(result.callsUsed, 1);
assert.equal(stderr.some((record) => record.type === 'audit-call' && record.functionId === 'app:list'), true);
assert.equal(stderr.at(-1).type, 'audit-summary');
assert.equal(JSON.stringify(stderr).includes('"id":1'), false);

const hexSurface = Object.freeze({ ...surface, envelopeSha256: 'ab'.repeat(32) });
const hexResult = await runIbexCodeMode({
  client: { query: async () => ({ rows: [{ id: 2 }] }) },
  surface: hexSurface,
  script: 'export default await api.list({});',
  scriptSource: 'hex-envelope.ts',
  graceMs: 1,
});
assert.deepEqual(hexResult.value, [{ id: 2 }]);
delete globalThis.__ibexAppBoundWorkerV1;

// A managed live callback is asynchronous parent work, so it can arrive while
// the restricted worker is idle in iterator.next() and emitting no frames.
// The parent must still drain that snapshot instead of deadlocking until the
// run wall clock expires.
globalThis.__ibexAppBoundWorkerV1 = fakeBridge({ live: true });
const liveSurface = Object.freeze({
  ...surface,
  functions: Object.freeze([{ id: 'app:watch', name: 'watch', kind: 'liveQuery', argsSchema: null }]),
});
let liveDisposed = false;
let liveFallbackToPoll = null;
const liveResult = await runIbexCodeMode({
  client: {
    startLiveQuery(_ref, { onUpdate, fallbackToPoll }) {
      liveFallbackToPoll = fallbackToPoll;
      const established = new Promise((resolve) => {
        setImmediate(() => {
          onUpdate([{ id: 'async-live-value' }]);
          resolve();
        });
      });
      return {
        started: () => established,
        dispose: () => { liveDisposed = true; },
        settled: async () => {},
      };
    },
  },
  surface: liveSurface,
  script: 'let value; for await (const rows of api.watch({})) { value = rows; break; } export default value;',
  scriptSource: 'live-idle-wake.ts',
  timeoutMs: 500,
  graceMs: 20,
  requireLiveStream: true,
});
assert.deepEqual(liveResult.value, [{ id: 'async-live-value' }]);
assert.equal(liveDisposed, true);
assert.equal(liveFallbackToPoll, false);
delete globalThis.__ibexAppBoundWorkerV1;

const planted = 'planted-sensitive-message-details-and-500-row-value';
const largeRows = Array.from({ length: 500 }, (_, index) => ({ index, planted }));
const protectedStderr = [];
globalThis.__ibexAppBoundWorkerV1 = fakeBridge({ settleAs: { count: 500 }, graceCall: true });
const protectedResult = await runIbexCodeMode({
  client: { query: async () => ({ rows: largeRows }) },
  surface,
  script: 'const rows = await api.list({}); signal.addEventListener("abort", async () => { try { await api.list({}); } catch {} console.log("cleanup-observed"); }); export default { count: rows.length };',
  scriptSource: 'leakage.ts',
  graceMs: 20,
  onStderr: (record) => protectedStderr.push(record),
});
assert.deepEqual(protectedResult.value, { count: 500 });
assert.equal(JSON.stringify(protectedStderr).includes(planted), false);
assert.equal(protectedStderr.some((record) => record.type === 'console' && record.values.includes('cleanup-observed')), true);
assert.equal(protectedStderr.some((record) => record.type === 'audit-call' && record.outcome === 'refused-during-grace'), true);
assert.equal(protectedStderr.filter((record) => record.type === 'audit-summary').length, 1);
delete globalThis.__ibexAppBoundWorkerV1;

const elidedStderr = [];
globalThis.__ibexAppBoundWorkerV1 = fakeBridge({ consoleCount: 20 });
await runIbexCodeMode({
  client: { query: async () => ({ rows: [] }) },
  surface,
  script: 'export default await api.list({});',
  scriptSource: 'elision.ts',
  graceMs: 20,
  maxStderrBytes: 1024,
  onStderr: (record) => elidedStderr.push(record),
});
assert.equal(elidedStderr.some((record) => record.type === 'elision'), true);
assert.equal(elidedStderr.at(-1).type, 'audit-summary');
delete globalThis.__ibexAppBoundWorkerV1;

const timeoutStderr = [];
globalThis.__ibexAppBoundWorkerV1 = fakeBridge({ graceCall: true, settles: false });
await assert.rejects(
  runIbexCodeMode({
    client: { query: async () => ({ rows: [] }) },
    surface,
    script: 'await new Promise(() => {}); export default 1;',
    scriptSource: 'timeout.ts',
    timeoutMs: 1,
    graceMs: 20,
    onStderr: (record) => timeoutStderr.push(record),
  }),
  (error) => error.code === 'SNAPBACK_APP_CLI_TIMEOUT' && error.exitCode === 9,
);
assert.equal(timeoutStderr.some((record) => record.type === 'console' && record.values.includes('cleanup-observed')), true);
assert.equal(timeoutStderr.some((record) => record.type === 'audit-call' && record.outcome === 'refused-during-grace'), true);
assert.equal(timeoutStderr.at(-1).type, 'audit-summary');
delete globalThis.__ibexAppBoundWorkerV1;

let signalAbort = null;
globalThis.__ibexAppBoundWorkerV1 = fakeBridge({ settles: false, onAbort: (body) => { signalAbort = body; } });
setImmediate(() => process.emit('SIGTERM'));
await assert.rejects(
  runIbexCodeMode({
    client: { query: async () => ({ rows: [] }) },
    surface,
    script: 'await new Promise(() => {}); export default 1;',
    scriptSource: 'signal.ts',
    graceMs: 1,
  }),
  (error) => error.signalExit === true && error.exitCode === 143,
);
assert.deepEqual(signalAbort, { reason: 'parent-signal', signal: 15 });
delete globalThis.__ibexAppBoundWorkerV1;

console.log('app-bound Ibex code-mode coordinator tests passed');
