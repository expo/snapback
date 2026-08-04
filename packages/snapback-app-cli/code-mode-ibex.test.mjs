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

const fakeBridge = () => ({
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
    const frame = (type, body) => queue.push({
      tag: 1,
      frame: jcsCanonical({ schema: 'ibex/restricted-worker-broker/1', runId, sequence: outgoing++, type, body }),
    });
    return {
      start(_source, _map, encoded) {
        const start = JSON.parse(encoded);
        runId = start.runId;
        assert.match(start.body.surface.envelopeDigest, /^sha256-[A-Za-z0-9_-]{43}$/u);
        frame('call', { callId: '1', functionId: 'app:list', args: {}, timeoutMs: 60000 });
      },
      submit(encoded) {
        const received = JSON.parse(encoded);
        assert.equal(received.type, 'callResult');
        assert.equal(received.body.ok, true);
        const text = jcsCanonical(received.body.value);
        const bytes = Buffer.from(text);
        frame('settlementBegin', { hasValue: true, byteLength: bytes.length, digest: hash(bytes), chunkCount: 1 });
        frame('settlementChunk', { index: 0, data: bytes.toString('base64url') });
        frame('settlementEnd', {});
      },
      take: () => queue.shift(),
      interrupt() {},
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
const result = await runIbexCodeMode({
  client: { query: async () => ({ rows: [{ id: 1 }] }) },
  surface,
  script: 'export default await api.list({});',
  scriptSource: 'analysis.ts',
});
assert.equal(result.hasValue, true);
assert.deepEqual(result.value, [{ id: 1 }]);
assert.equal(result.callsUsed, 1);

const hexSurface = Object.freeze({ ...surface, envelopeSha256: 'ab'.repeat(32) });
const hexResult = await runIbexCodeMode({
  client: { query: async () => ({ rows: [{ id: 2 }] }) },
  surface: hexSurface,
  script: 'export default await api.list({});',
  scriptSource: 'hex-envelope.ts',
});
assert.deepEqual(hexResult.value, [{ id: 2 }]);
delete globalThis.__ibexAppBoundWorkerV1;

console.log('app-bound Ibex code-mode coordinator tests passed');
