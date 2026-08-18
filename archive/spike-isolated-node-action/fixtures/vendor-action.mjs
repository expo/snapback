import { createTokenAuth } from '@octokit/auth-token';
import { scryptSync } from 'node:crypto';

const workerEntryStartedAt = performance.now();
const startupCalibration = globalThis.__snapbackCalibration.snapshot();
const sdkStartedAt = performance.now();
const auth = createTokenAuth('github_pat_spike_fixture_not_a_credential');
const authentication = await auth();
const sdkResponse = await fetch('https://api.github.com/user', {
  headers: { authorization: `${authentication.tokenType} ${authentication.token}` },
});
const sdkBody = await sdkResponse.json();
const sdkWallMs = performance.now() - sdkStartedAt;

function sourceMapProbe() {
  throw new Error('ISOLATED_NODE_SOURCE_MAP_PROBE');
}

let sourceMapStack;
try {
  sourceMapProbe();
} catch (error) {
  sourceMapStack = error.stack;
}

// The Clique-P2 gateway called scryptSync with Node defaults. Pin those
// defaults explicitly so a Node upgrade cannot silently change this control.
const scryptParameters = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const cryptoWallSamplesMs = [];
let scryptDigest;
for (let sample = 0; sample < 5; sample += 1) {
  const cryptoStartedAt = performance.now();
  scryptDigest = scryptSync(
    'correct horse battery staple',
    new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    32,
    scryptParameters,
  ).toString('hex');
  cryptoWallSamplesMs.push(performance.now() - cryptoStartedAt);
}
const cryptoWallMs = [...cryptoWallSamplesMs].sort((left, right) => left - right)[2];

const importProbe = globalThis.__snapbackCalibration.deniedImport;
const importSurfaces = [
  ['fs', 'node:fs'],
  ['net', 'node:net'],
  ['tls', 'node:tls'],
  ['dns', 'node:dns'],
  ['http', 'node:http'],
  ['https', 'node:https'],
  ['dgram', 'node:dgram'],
  ['child_process', 'node:child_process'],
  ['worker_threads', 'node:worker_threads'],
  ['cluster', 'node:cluster'],
  ['vm', 'node:vm'],
  ['module', 'node:module'],
];
const imports = Object.fromEntries(await Promise.all(importSurfaces.map(async ([name, specifier]) => (
  [name, await importProbe(specifier)]
))));

const absentSurfaces = {
  process: { absent: typeof globalThis.process === 'undefined' },
  env: { absent: typeof globalThis.process?.env === 'undefined' },
  require: { absent: typeof globalThis.require === 'undefined' },
  module: { absent: typeof globalThis.module === 'undefined', import: imports.module },
  WebAssembly: { absent: typeof globalThis.WebAssembly === 'undefined' },
  fs: { absent: typeof globalThis.fs === 'undefined', import: imports.fs },
  net: { absent: typeof globalThis.net === 'undefined', import: imports.net },
  tls: { absent: typeof globalThis.tls === 'undefined', import: imports.tls },
  dns: { absent: typeof globalThis.dns === 'undefined', import: imports.dns },
  http: { absent: typeof globalThis.http === 'undefined', import: imports.http },
  https: { absent: typeof globalThis.https === 'undefined', import: imports.https },
  dgram: { absent: typeof globalThis.dgram === 'undefined', import: imports.dgram },
  child_process: { absent: typeof globalThis.child_process === 'undefined', import: imports.child_process },
  worker_threads: { absent: typeof globalThis.worker_threads === 'undefined', import: imports.worker_threads },
  cluster: { absent: typeof globalThis.cluster === 'undefined', import: imports.cluster },
  vm: { absent: typeof globalThis.vm === 'undefined', import: imports.vm },
};

const calibration = globalThis.__snapbackCalibration.snapshot();
console.log(JSON.stringify({
  schemaVersion: 'isolated-node-action-spike.worker-result.v1',
  sdk: {
    package: '@octokit/auth-token',
    responseStatus: sdkResponse.status,
    responseIdentity: { id: sdkBody.id, login: sdkBody.login },
    wallMs: sdkWallMs,
    brokerRequests: calibration.brokerRequests,
  },
  nativeCrypto: {
    implementation: 'node:crypto.scryptSync',
    thirdPartyPackage: null,
    parameters: scryptParameters,
    samples: 5,
    wallSamplesMs: cryptoWallSamplesMs,
    digestPrefix: scryptDigest.slice(0, 16),
    wallMs: cryptoWallMs,
    wallStatistic: 'median',
  },
  absentSurfaces,
  sourceMapStack,
  coldStartMs: workerEntryStartedAt - startupCalibration.preloadStartedAt,
  rssBytes: calibration.rssBytes,
}));
