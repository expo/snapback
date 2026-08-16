import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PACKAGE_NAME_LINEAGE,
  PROMOTION_PACKAGE_NAMES as AUTHORITY_PROMOTION_PACKAGE_NAMES,
} from '../packages/snapback-publication-authority/protocol.mjs';
import {
  aggregatePublicPackageProofs,
  BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS,
  boundedSerializeBrowserValue,
  browserAssetsContainSecretCanary,
  browserForbiddenMarkerVariants,
  computePublicationReceiptProvenance,
  createBoundedAsyncTaskPool,
  createBoundedByteAccumulator,
  createBoundedBrowserSurfaceCollector,
  digestBoundedBrowserFilesystem,
  extractViteClientOrigin,
  findBrowserVisibleLeaks,
  classifyLatestRootObservation,
  LATEST_ROOT_PROPAGATION_ATTEMPT_TIMEOUT_MS,
  LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS,
  LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS,
  LATEST_ROOT_PROPAGATION_WALL_BOUND_MS,
  ledgerNameGeneration,
  measureGitCheckoutIdentity,
  parseArguments,
  parseBoundedJsonBytes,
  PUBLIC_NPM_REGISTRY,
  resolveInstalledBrowserDistribution,
  resolveInstalledBrowserExecutable,
  runAsync,
  validateFinalLatestReceipts,
  validateColdInstallAgentDigest,
  validateLatestRootResolution,
  validateLatestRootPropagationWitness,
  validatePublicPublicationLedger,
  validateRetainedComparatorReceipt,
} from './snapback-package-cold-install-lib.mjs';
import {
  canonicalJcs,
  sha256Hex,
  validatePostPromotionLatestRootReceipts,
} from './snapback-promotion-core.mjs';
import {
  PACKAGE_INVENTORY,
  PROMOTION_PACKAGE_NAMES,
  sourceNamesForScopePreset,
  validateColdInstallBrowserEvidence,
  validateInternalDependencyClosure,
  validatePublicationReceiptProvenance,
  validateQualifiedPlatformReceipts,
  validateQualifiedStagingLedger,
  validateQualifiedTarballs,
} from './snapback-publish-core.mjs';
import { sha256TarEntry } from './snapback-tar-entry.mjs';
import { stopOwnedProcessTree } from './lib/process-tree.mjs';

const script = fileURLToPath(new URL('./snapback-package-cold-install.mjs', import.meta.url));
const DEFAULT_BROWSER_SOURCE_REVISION = '0'.repeat(40);

test('React cold-install fixture broadly typechecks generated TypeScript without Exact', () => {
  const templateRoot = fileURLToPath(
    new URL('../packages/snapback-cli/templates/react/', import.meta.url),
  );
  const manifest = JSON.parse(readFileSync(join(templateRoot, 'package.json'), 'utf8'));
  const tsconfig = JSON.parse(readFileSync(join(templateRoot, 'tsconfig.json'), 'utf8'));
  assert.equal(manifest.scripts?.typecheck, 'tsc --noEmit');
  assert.equal(manifest.scripts?.lint, 'oxlint .');
  assert.equal(typeof manifest.devDependencies?.oxlint, 'string');
  assert.equal(Object.hasOwn(manifest.dependencies ?? {}, '@exact/contract'), false);
  assert.equal(Object.hasOwn(manifest.devDependencies ?? {}, '@exact/contract'), false);
  assert(tsconfig.include.includes('snapback/generated/**/*.ts'));
  assert.equal(Object.hasOwn(tsconfig, 'exclude'), false);

  const harness = readFileSync(script, 'utf8');
  assert.match(harness, /node_modules', '@exact', 'contract'/u);
  assert.match(harness, /endsWith\('\.contract-meta\.ts'\)/u);
  assert.match(harness, /\['run', 'typecheck'\]/u);
  assert.match(harness, /\['run', 'lint'\]/u);
});

const packagedAgentDigest = ({ appId = 'partitime-external', functions = ['createEvent'] } = {}) => ({
  artifactKind: 'agentDigest',
  formatVersion: 'snapback.agent-digest.v1',
  sections: {
    static: {
      items: [
        {
          key: 'artifact/identity',
          kind: 'artifact-identity',
          value: { appId },
        },
        ...functions.map((name) => ({
          key: `operation/${appId}:${name}`,
          kind: 'operation-signature',
          value: { id: `${appId}:${name}`, name },
        })),
      ],
    },
  },
});

test('cold-install app identity follows the agent-digest static contract', () => {
  assert.deepEqual(
    validateColdInstallAgentDigest(packagedAgentDigest(), {
      expectedAppId: 'partitime-external',
      requiredFunctionName: 'createEvent',
    }),
    {
      appId: 'partitime-external',
      functionId: 'partitime-external:createEvent',
    },
  );
  assert.throws(
    () => validateColdInstallAgentDigest({
      appId: 'partitime-external',
      functions: [{ name: 'createEvent' }],
    }, {
      expectedAppId: 'partitime-external',
      requiredFunctionName: 'createEvent',
    }),
    /unsupported introspection digest/u,
  );
  assert.throws(
    () => validateColdInstallAgentDigest(packagedAgentDigest({ appId: 'other' }), {
      expectedAppId: 'partitime-external',
      requiredFunctionName: 'createEvent',
    }),
    /unexpected CLI app id other/u,
  );
  assert.throws(
    () => validateColdInstallAgentDigest(packagedAgentDigest({ functions: [] }), {
      expectedAppId: 'partitime-external',
      requiredFunctionName: 'createEvent',
    }),
    /did not discover createEvent/u,
  );
});

test('structured Vite readiness survives JSON-encoded ANSI presentation', () => {
  const viteLine = [
    '  \u001b[32m➜\u001b[39m  ',
    '\u001b[1mLocal\u001b[22m:   ',
    '\u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m',
  ].join('');
  const output = [
    '> snapback dev snapback --client . --client-command vite',
    JSON.stringify({
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'client-output',
      stream: 'stdout',
      line: viteLine,
    }),
  ].join('\n');
  assert.equal(extractViteClientOrigin(output), 'http://localhost:5173/');
  for (const [host, expected] of [
    ['127.0.0.1', 'http://127.0.0.1:4173/'],
    ['[::1]', 'http://[::1]:6173/'],
  ]) {
    assert.equal(
      extractViteClientOrigin(JSON.stringify({
        schemaVersion: 'snapback.dev.v1',
        ok: true,
        state: 'client-output',
        stream: 'stdout',
        line: `  ➜  Local: http://${host}:${host === '127.0.0.1' ? '4173' : '6173'}/`,
      })),
      expected,
    );
  }
  assert.equal(
    extractViteClientOrigin('  ➜  Local: http://localhost:5173/'),
    null,
    'unstructured terminal text is not readiness authority',
  );
  assert.equal(
    extractViteClientOrigin(JSON.stringify({
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'client-output',
      stream: 'stdout',
      line: 'Local: https://example.com:5173/',
    })),
    null,
  );
  for (const event of [
    {
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'client-output',
      stream: 'stdout',
      line: 'warning: stale ➜ Local: http://localhost:5173/',
    },
    {
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'client-output',
      stream: 'stdout',
      line: '➜ Local: http://localhost:5173/not-the-ready-url',
    },
    {
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'control-ready',
      stream: 'stdout',
      line: '➜ Local: http://localhost:5173/',
    },
    {
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'client-output',
      stream: 'stderr',
      line: '➜ Local: http://localhost:5173/',
    },
  ]) {
    assert.equal(
      extractViteClientOrigin(JSON.stringify(event)),
      null,
      'only the complete structured Vite stdout readiness record is authority',
    );
  }
  assert.throws(
    () => extractViteClientOrigin('x'.repeat(8 * 1024 * 1024 + 1)),
    /dev output exceeded its byte bound/u,
  );
});

test('packed runtime entry hashing streams entries larger than the old child buffer', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-large-tar-entry-'));
  try {
    const packageRoot = join(temporary, 'package');
    const binaryRoot = join(packageRoot, 'bin');
    mkdirSync(binaryRoot, { recursive: true });
    const binary = join(binaryRoot, 'snapback');
    const binaryBytes = 65 * 1024 * 1024;
    const block = Buffer.alloc(1024 * 1024, 0x5a);
    const descriptor = openSync(binary, 'wx', 0o700);
    try {
      for (let offset = 0; offset < binaryBytes; offset += block.byteLength) {
        writeSync(
          descriptor,
          block,
          0,
          Math.min(block.byteLength, binaryBytes - offset),
        );
      }
    } finally {
      closeSync(descriptor);
    }
    const archive = join(temporary, 'runtime.tgz');
    const packed = spawnSync(
      'tar',
      ['-czf', archive, '-C', temporary, 'package/bin/snapback'],
      { encoding: 'utf8' },
    );
    assert.equal(packed.status, 0, packed.stderr);

    const expected = createHash('sha256');
    for (let offset = 0; offset < binaryBytes; offset += block.byteLength) {
      expected.update(block.subarray(0, Math.min(block.byteLength, binaryBytes - offset)));
    }
    assert.equal(
      sha256TarEntry(archive, 'package/bin/snapback'),
      expected.digest('hex'),
    );
    assert.throws(
      () => sha256TarEntry(archive, 'package/bin/snapback', { maxBytes: binaryBytes - 1 }),
      /exceeded its .*byte bound/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('resolveInstalledBrowserExecutable binds the only installed headless shell', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-browser-executable-'));
  try {
    const browserDirectory = join(
      temporary,
      'chromium_headless_shell-1234',
      'chrome-headless-shell-linux64',
    );
    mkdirSync(browserDirectory, { recursive: true });
    const executable = join(browserDirectory, 'chrome-headless-shell');
    writeFileSync(executable, 'browser');
    assert.equal(resolveInstalledBrowserExecutable(temporary), executable);

    const duplicateDirectory = join(
      temporary,
      'chromium_headless_shell-5678',
      'chrome-linux',
    );
    mkdirSync(duplicateDirectory, { recursive: true });
    writeFileSync(join(duplicateDirectory, 'headless_shell'), 'browser');
    assert.equal(resolveInstalledBrowserExecutable(temporary), null);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('browser distribution identity streams every entry and refuses links, escapes, and bounds', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-browser-tree-'));
  try {
    const distribution = join(temporary, 'chromium_headless_shell-1234');
    const bin = join(distribution, 'chrome-headless-shell-linux64');
    mkdirSync(bin, { recursive: true });
    const executable = join(bin, 'chrome-headless-shell');
    const support = join(distribution, 'support.dat');
    writeFileSync(executable, 'browser-one');
    writeFileSync(support, 'same-size-a');
    const resolved = resolveInstalledBrowserDistribution(temporary);
    assert.equal(resolved?.distributionRoot, distribution);
    assert.equal(resolved?.executablePath, executable);

    const limits = {
      domain: 'snapback-test-browser-tree-v1',
      roots: [['chromium-headless-shell', distribution]],
      executablePath: executable,
      maxEntries: 10,
      maxTotalBytes: 1024,
      maxFileBytes: 1024,
    };
    const first = await digestBoundedBrowserFilesystem(limits);
    assert.equal(first.fileCount, 2);
    assert.equal(first.executableBytes, Buffer.byteLength('browser-one'));
    writeFileSync(support, 'same-size-b');
    const second = await digestBoundedBrowserFilesystem(limits);
    assert.notEqual(second.sha256, first.sha256, 'same-size content drift changes the tree digest');

    const link = join(distribution, 'linked-support');
    symlinkSync(support, link);
    await assert.rejects(
      digestBoundedBrowserFilesystem(limits),
      /contains a symlink/u,
    );
    rmSync(link);
    await assert.rejects(
      digestBoundedBrowserFilesystem({ ...limits, maxEntries: 1 }),
      /entry bound/u,
    );
    await assert.rejects(
      digestBoundedBrowserFilesystem({ ...limits, maxFileBytes: 4 }),
      /file exceeded/u,
    );
    const outsideExecutable = join(temporary, 'outside-headless-shell');
    writeFileSync(outsideExecutable, 'outside');
    await assert.rejects(
      digestBoundedBrowserFilesystem({ ...limits, executablePath: outsideExecutable }),
      /contained regular file/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('measured checkout identity reads HEAD and dirty state from Git itself', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-browser-git-'));
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: temporary, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git(['init', '--quiet']);
    writeFileSync(join(temporary, 'proof.txt'), 'clean\n');
    git(['add', 'proof.txt']);
    git([
      '-c', 'user.name=Snapback Browser Proof',
      '-c', 'user.email=snapback-browser-proof@example.invalid',
      'commit', '--quiet', '-m', 'fixture',
    ]);
    const clean = measureGitCheckoutIdentity(temporary);
    assert.equal(clean.revision, git(['rev-parse', 'HEAD']));
    assert.equal(clean.dirty, false);
    writeFileSync(join(temporary, 'proof.txt'), 'dirty\n');
    assert.equal(measureGitCheckoutIdentity(temporary).dirty, true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('browser deep serializer covers nested maps, sets, buffers, and refuses byte/count/depth excess', async () => {
  const secret = `deep-browser-secret-${'d'.repeat(48)}`;
  const value = {
    nested: new Map([
      ['set', new Set([{ bytes: new TextEncoder().encode(secret) }])],
    ]),
  };
  const limits = {
    maxBytes: 16 * 1024,
    maxDepth: 8,
    maxNodes: 100,
    maxProperties: 100,
  };
  const rendered = await boundedSerializeBrowserValue(value, limits);
  assert.match(rendered, /"\$type":"map"/u);
  assert.match(rendered, /"\$type":"set"/u);
  assert.ok(rendered.includes(Buffer.from(secret).toString('base64')));
  await assert.rejects(
    boundedSerializeBrowserValue({ a: { b: { c: true } } }, { ...limits, maxDepth: 1 }),
    /depth bound/u,
  );
  await assert.rejects(
    boundedSerializeBrowserValue(Array.from({ length: 20 }, (_, index) => index), {
      ...limits,
      maxProperties: 5,
    }),
    /property bound/u,
  );
  await assert.rejects(
    boundedSerializeBrowserValue('x'.repeat(1024), { ...limits, maxBytes: 128 }),
    /byte bound/u,
  );
});

test('browser deep serializer traverses custom classes, functions, accessors, and proxies', async () => {
  const classSecret = `class-secret-${'a'.repeat(48)}`;
  const functionSecret = `function-secret-${'b'.repeat(48)}`;
  const proxySecret = `proxy-secret-${'c'.repeat(48)}`;
  class SecretBox {}
  const box = new SecretBox();
  Object.defineProperty(box, 'revealed', {
    configurable: true,
    enumerable: false,
    get: () => ({ nested: classSecret }),
  });
  function callable() {}
  callable.privateState = { nested: functionSecret };
  const proxied = new Proxy({ nested: null }, {
    get(target, key, receiver) {
      if (key === 'nested') return { secret: proxySecret };
      return Reflect.get(target, key, receiver);
    },
    ownKeys() {
      return ['nested'];
    },
  });
  const rendered = await boundedSerializeBrowserValue(
    { box, callable, proxied },
    {
      maxBytes: 64 * 1024,
      maxDepth: 12,
      maxNodes: 500,
      maxProperties: 500,
    },
  );
  assert.ok(rendered.includes(classSecret));
  assert.ok(rendered.includes(functionSecret));
  assert.ok(rendered.includes(proxySecret));

  await assert.rejects(
    boundedSerializeBrowserValue(new Proxy({}, {
      ownKeys() {
        throw new Error('proxy ownKeys refused');
      },
    }), {
      maxBytes: 1024,
      maxDepth: 4,
      maxNodes: 20,
      maxProperties: 20,
    }),
    /proxy ownKeys refused/u,
  );
  const oversized = {};
  Object.defineProperty(oversized, 'payload', {
    get: () => 'x'.repeat(4096),
  });
  await assert.rejects(
    boundedSerializeBrowserValue(oversized, {
      maxBytes: 256,
      maxDepth: 4,
      maxNodes: 20,
      maxProperties: 20,
    }),
    /byte bound/u,
  );
});

test('host collection results are explicitly post-return bounded, not pre-allocation bounded', async () => {
  assert.ok(Object.isFrozen(BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS));
  assert.deepEqual(BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS, [
    'BrowserContext.serviceWorkers()',
    'Cache.keys()',
    'CacheStorage.keys()',
    'ConsoleMessage.args()',
    'IDBFactory.databases()',
    'Page.workers()',
    'Performance.getEntriesByType("resource")',
    'Reflect.ownKeys(browser value)',
    'Reflect.ownKeys(globalThis)',
  ]);
  const target = {};
  for (let index = 0; index < 128; index += 1) target[`key-${index}`] = index;
  let ownKeysReturned = false;
  const value = new Proxy(target, {
    ownKeys(current) {
      const keys = Reflect.ownKeys(current);
      ownKeysReturned = true;
      return keys;
    },
  });
  await assert.rejects(
    boundedSerializeBrowserValue(value, {
      maxBytes: 1024,
      maxDepth: 4,
      maxNodes: 20,
      maxProperties: 4,
    }),
    /property bound/u,
  );
  assert.equal(
    ownKeysReturned,
    true,
    'the host collection exists before the serializer can apply its post-return property bound',
  );
});

test('proof-owned collection copies remain incrementally bounded after host return', () => {
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /Object\.entries\(request\.headers/u);
  assert.doesNotMatch(source, /\[\.\.\.request\.headers\.entries\(\)\]/u);
  assert.doesNotMatch(source, /\[\.\.\.response\.headers\.entries\(\)\]/u);
  assert.doesNotMatch(source, /\[\.\.\.store\.indexNames\]/u);
  assert.match(source, /boundedHeaderEntries\(request\.headers/u);
  assert.match(source, /store\.indexNames\.length > maxProperties/u);
});

test('bounded async evidence pool limits concurrency and fails closed on task count', async () => {
  const pool = createBoundedAsyncTaskPool({ maxTasks: 8, maxConcurrency: 2 });
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 8 }, () => pool.add(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    active -= 1;
  }));
  await Promise.all(tasks);
  const settled = await pool.settle();
  assert.equal(peak, 2);
  assert.equal(settled.peakActive, 2);

  const refusing = createBoundedAsyncTaskPool({ maxTasks: 1, maxConcurrency: 1 });
  const first = refusing.add(async () => {});
  await assert.rejects(refusing.add(async () => {}), /task bound/u);
  await first;
  await assert.rejects(refusing.settle(), /task bound/u);
});

test('response, cache, IndexedDB, WebSocket, and chunked byte limits fail before retention', () => {
  for (const kind of [
    'response-body',
    'cache-body',
    'indexeddb-record',
    'websocket-frame-received',
  ]) {
    const collector = createBoundedBrowserSurfaceCollector({
      forbiddenMarkers: [],
      maxSurfaceBytes: 8,
      maxTotalBytes: 16,
      maxSurfaces: 2,
    });
    assert.throws(() => collector.add(kind, Buffer.alloc(9)), /scan bound/u, kind);
    assert.equal(collector.sanitizedSummary().surfaceManifest.length, 0, kind);
  }
  const chunked = createBoundedByteAccumulator({
    label: 'chunked response',
    maxBytes: 8,
    maxChunks: 2,
  });
  chunked.add(Buffer.alloc(4));
  chunked.add(Buffer.alloc(4));
  assert.equal(chunked.finish().byteLength, 8);
  assert.throws(() => chunked.add(Buffer.alloc(1)), /chunk bound/u);
});

function browserJourneyFixture(overrides = {}) {
  const {
    capture: captureOverrides = {},
    captureSha256: captureSha256Override,
    sourceRevision = DEFAULT_BROWSER_SOURCE_REVISION,
    ...journeyOverrides
  } = overrides;
  const {
    browser: captureBrowserOverrides = {},
    coverage: captureCoverageOverrides = {},
    surfaceManifest: captureSurfaceManifest,
    ...captureFieldOverrides
  } = captureOverrides;
  const surfaceManifest = captureSurfaceManifest ?? [
    { kind: 'request', bytesScanned: 80 },
    { kind: 'response-metadata', bytesScanned: 100 },
    { kind: 'response-body', bytesScanned: 200 },
    { kind: 'response-metadata', bytesScanned: 100 },
    { kind: 'response-body', bytesScanned: 300 },
    { kind: 'websocket-url', bytesScanned: 40 },
    { kind: 'websocket-handshake-request', bytesScanned: 80 },
    { kind: 'websocket-handshake-response', bytesScanned: 80 },
    { kind: 'websocket-frame-received', bytesScanned: 120 },
    { kind: 'page-state', bytesScanned: 500 },
    { kind: 'cache-metadata', bytesScanned: 20 },
    { kind: 'indexeddb-metadata', bytesScanned: 20 },
  ].map((entry, index) => ({
    ...entry,
    contentSha256: ((index % 15) + 1).toString(16).repeat(64),
  }));
  const capture = {
    schemaVersion: 'snapback.package-browser-capture.v1',
    sourceRevision,
    sourceDirty: false,
    startedAtMs: 1_000_000,
    completedAtMs: 1_001_000,
    maxSurfaceBytes: 16 * 1024 * 1024,
    maxTotalBytes: 128 * 1024 * 1024,
    maxSurfaces: 20_000,
    totalBytesScanned: surfaceManifest.reduce((sum, entry) => sum + entry.bytesScanned, 0),
    surfaceManifest,
    coverage: {
      asyncTasksObserved: 4,
      asyncTasksPeakConcurrency: 2,
      consoleArgumentsObserved: 0,
      consoleArgumentsScanned: 0,
      consoleMessagesObserved: 0,
      networkResourcesObserved: 1,
      requestBodiesObserved: 0,
      requestBodiesScanned: 0,
      responseBodiesObserved: 2,
      responseBodiesScanned: 2,
      workersObserved: 0,
      workersScanned: 0,
      serviceWorkersObserved: 0,
      serviceWorkersScanned: 0,
      cacheEntriesObserved: 0,
      cacheEntriesScanned: 0,
      indexedDbRecordsObserved: 0,
      indexedDbRecordsScanned: 0,
      webSocketFramesObserved: 1,
      webSocketFramesScanned: 1,
      webSocketHandshakesObserved: 1,
      webSocketHandshakesScanned: 1,
      scanTruncated: false,
      ...captureCoverageOverrides,
    },
    browser: {
      packageVersion: '1.62.0',
      packageTreeSha256: '8'.repeat(64),
      packageTreeEntries: 100,
      packageTreeBytes: 100_000,
      distributionSha256: '7'.repeat(64),
      distributionEntries: 50,
      distributionBytes: 2_000_000,
      executableSha256: '9'.repeat(64),
      executableBytes: 1_000_000,
      ...captureBrowserOverrides,
    },
    forbiddenMarkerKindsChecked: [
      'admin-token',
      'admin-token-file',
      'backend-origin',
      'browser-secret-canary',
      'database-path',
      'ready-file',
      'repository-path',
      'runtime-path',
    ],
    captureSanitized: true,
    forbiddenValueRetention: 'none',
    materializationBoundary: {
      cdpEventMaterialization: 'not-bounded-by-this-proof',
      chromiumInternalMaterialization: 'not-bounded-by-this-proof',
      proofInvokedHostCollectionApis: [
        ...BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS,
      ],
      proofInvokedHostCollectionResults:
        'post-return-bounded-not-pre-allocation-bounded',
      proofOwnedCopiesAndEncodings: 'bounded-before-allocation-after-host-return',
      requestPostDataProtocolCapBytes: 16 * 1024 * 1024,
      resourceProtocolCapBytes: 16 * 1024 * 1024,
      totalResourceProtocolCapBytes: 128 * 1024 * 1024,
      unprovableCompletenessPolicy: 'fail-closed',
    },
    ...captureFieldOverrides,
  };
  return {
    schemaVersion: 'snapback.package-browser-journey.v1',
    browserPackage: 'playwright',
    browserPackageVersion: '1.62.0',
    engine: 'chromium',
    engineVersion: '144.0.7559.0',
    headless: true,
    initialSeededTodoCount: 1,
    postMutationTodoCount: 2,
    reloadedTodoCount: 2,
    liveFramesAfterMutation: 1,
    browserReadableSurfaceCount: capture.surfaceManifest.length,
    forbiddenMarkerKindsChecked: capture.forbiddenMarkerKindsChecked,
    capture,
    captureSha256: captureSha256Override ?? sha256Hex(canonicalJcs(capture)),
    checks: {
      realBrowserRendered: true,
      renderedSeededTodo: true,
      generatedMutationPerformed: true,
      nativeLiveUpdateObserved: true,
      webSocketLiveFrameObserved: true,
      reloadPreservedMutation: true,
      browserReadableBackendOriginAbsent: true,
      browserReadableAdminTokenAbsent: true,
      browserReadableFilesystemPathsAbsent: true,
      browserReadableCanaryAbsent: true,
    },
    ...journeyOverrides,
  };
}

function browserReceiptEvidence(
  sourceRevision = DEFAULT_BROWSER_SOURCE_REVISION,
  overrides = {},
) {
  return {
    sourceRevision,
    sourceDirty: false,
    browserJourney: browserJourneyFixture({
      sourceRevision,
      ...(overrides.browserJourney ?? {}),
    }),
    checks: {
      packedReactRealBrowserSeedLiveReload: true,
      browserPrivateSurfaceAbsence: true,
      ...(overrides.checks ?? {}),
    },
  };
}

function retainedComparatorReceiptFixture({
  sourceRevision,
  version,
  runtimeBinarySha256 = '9'.repeat(64),
  executorPackageNames = {
    cli: '@expo/snapback-cli',
    client: '@expo/snapback-client',
  },
}) {
  const startedAtMs = 1_785_280_000_000;
  const expectedChecks = [
    ['native-live-delivery', 'cross-client native live delivery'],
    ['atomic-declared-writes', 'atomic declared write set'],
    [
      'rejected-mutation-rollback',
      'rejected mutation rollback without durable version change',
    ],
    ['presence-cleanup', 'TTL and disconnect presence cleanup'],
    ['ephemeral-durable-separation', 'ephemeral publish does not advance durable version'],
  ].map(([id, name]) => ({ id, name }));
  const comparatorReceipt = {
    schemaVersion: 'snapback.comparator-receipt.v1',
    profileId: 'package-green-fixture',
    title: 'package comparator green fixture',
    status: 'passed',
    exitCode: 0,
    startedAtMs,
    finishedAtMs: startedAtMs + 50,
    durationMs: 50,
    executorPackages: {
      cli: {
        name: executorPackageNames.cli,
        version,
        algorithm: 'sha256-package-files-path-length-content.v1',
        files: [
          'cli.mjs',
          'comparator-profile.mjs',
          'fixtures/comparator/green.config.mjs',
          'package.json',
        ],
        sha256: `sha256:${'ab'.repeat(32)}`,
      },
      client: {
        name: executorPackageNames.client,
        version,
        algorithm: 'sha256-package-files-path-length-content.v1',
        files: ['index.mjs', 'package.json'],
        sha256: `sha256:${'cd'.repeat(32)}`,
      },
    },
    identity: {
      target: {
        available: true,
        kind: 'local-isolated',
        profileId: 'local-dev-sqlite-ibex',
        serverUrl: 'http://127.0.0.1:4289/',
        databaseMode: 'isolated-file',
        managed: true,
      },
      artifact: {
        available: true,
        appId: 'app',
        bundleHash: `sha256:${'c'.repeat(16)}`,
        inputsHash: 'd'.repeat(64),
        schemaHash: `sha256:${'e'.repeat(16)}`,
      },
      binary: {
        available: true,
        path: '/tmp/snapback-runtime/bin/snapback',
        sha256: `sha256:${runtimeBinarySha256}`,
        crateVersion: '0.1.0',
        gitCommit: sourceRevision,
        gitDirty: false,
        buildProfile: 'release',
        startupNonce: '019fab74-e246-7e72-ab8e-b9d81f8f4ecd',
      },
    },
    expectedChecks,
    checks: expectedChecks.map(({ id, name }, index) => ({
      id,
      name,
      status: 'passed',
      startedAtMs: startedAtMs + index * 10,
      finishedAtMs: startedAtMs + (index + 1) * 10,
      durationMs: 10,
      details: {
        'native-live-delivery': {
          observerIdentity: 'fixture_observer',
          actorIdentity: 'fixture_actor',
          identitySources: {
            observer: 'dev-asserted',
            actor: 'dev-asserted',
          },
          transport: 'push',
          subscriptionId: 'sub_fixture_1',
          deliveredVersion: 2,
        },
        'atomic-declared-writes': {
          declaredWrites: ['primary', 'activity'],
          changed: ['primary', 'activity'],
          beforeVersion: 2,
          afterVersion: 3,
        },
        'rejected-mutation-rollback': {
          diagnosticCode: 'SNAPBACK_HANDLER_FAILED',
          beforeVersion: 3,
          afterVersion: 3,
        },
        'presence-cleanup': {
          disconnectRemoved: true,
          ttlRemoved: true,
          ttlMs: 5,
        },
        'ephemeral-durable-separation': {
          beforeVersion: 3,
          afterVersion: 3,
        },
      }[id],
      diagnostic: null,
    })),
    capabilityGaps: [],
    cleanup: {
      attempted: true,
      ok: true,
      managed: true,
      leaderExited: true,
      temporaryStateRemoved: true,
      errors: [],
    },
    nonclaims: [
      'browser rendering or framework-hook behavior',
      'hosted-target parity',
      'performance, scale, migration, backup, rollback, and cost properties',
      'dev-asserted identity labels are behavioral witnesses, not authenticated-principal evidence',
    ],
    diagnostic: null,
  };
  return {
    comparatorReceipt,
    comparatorReceiptSha256: sha256Hex(canonicalJcs(comparatorReceipt)),
  };
}

test('retained comparator evidence preserves governed details and refuses digest or identity drift', () => {
  const sourceRevision = '7'.repeat(40);
  const version = '0.1.1';
  const runtimeBinarySha256 = '8'.repeat(64);
  const retained = retainedComparatorReceiptFixture({
    sourceRevision,
    version,
    runtimeBinarySha256,
  });
  const projection = validateRetainedComparatorReceipt(retained, {
    sourceRevision,
    version,
    expectedRuntimeBinarySha256: runtimeBinarySha256,
  });
  assert.equal(projection.receiptSha256, retained.comparatorReceiptSha256);
  assert.deepEqual(projection.checkIds, [
    'native-live-delivery',
    'atomic-declared-writes',
    'rejected-mutation-rollback',
    'presence-cleanup',
    'ephemeral-durable-separation',
  ]);

  const digestDrift = structuredClone(retained);
  digestDrift.comparatorReceipt.cleanup.ok = false;
  assert.throws(
    () => validateRetainedComparatorReceipt(digestDrift, {
      sourceRevision,
      version,
      expectedRuntimeBinarySha256: runtimeBinarySha256,
    }),
    /digest drifted/u,
  );

  const identityDrift = structuredClone(retained);
  identityDrift.comparatorReceipt.identity.binary.gitCommit = '6'.repeat(40);
  identityDrift.comparatorReceiptSha256 = sha256Hex(canonicalJcs(
    identityDrift.comparatorReceipt,
  ));
  assert.throws(
    () => validateRetainedComparatorReceipt(identityDrift, {
      sourceRevision,
      version,
      expectedRuntimeBinarySha256: runtimeBinarySha256,
    }),
    /binary identity drifted/u,
  );
});

test('retained comparator evidence refuses self-digested vacuous semantics', () => {
  const sourceRevision = '7'.repeat(40);
  const version = '0.1.1';
  const validateMutation = (mutate, message) => {
    const retained = retainedComparatorReceiptFixture({ sourceRevision, version });
    mutate(retained.comparatorReceipt);
    retained.comparatorReceiptSha256 = sha256Hex(canonicalJcs(retained.comparatorReceipt));
    assert.throws(
      () => validateRetainedComparatorReceipt(retained, { sourceRevision, version }),
      message,
    );
  };

  validateMutation(
    (receipt) => { receipt.checks[0].details = {}; },
    /native live-delivery details|native live-delivery witness/u,
  );
  validateMutation(
    (receipt) => { receipt.nonclaims = ['none']; },
    /cleanup or nonclaims/u,
  );
  validateMutation(
    (receipt) => {
      receipt.executorPackages.cli.sha256 = `sha256:${'0'.repeat(64)}`;
    },
    /package digests are vacuous/u,
  );
  validateMutation(
    (receipt) => { receipt.profileId = 'x'; },
    /not one complete passing run/u,
  );
  validateMutation(
    (receipt) => { receipt.identity.artifact.bundleHash = 'x'; },
    /artifact identity drifted/u,
  );
  validateMutation(
    (receipt) => { receipt.identity.binary.startupNonce = 'x'; },
    /binary identity drifted/u,
  );
});

test('publication JSON envelopes bound bytes, depth, nodes, and strings', () => {
  assert.throws(
    () => parseBoundedJsonBytes(
      Buffer.from(JSON.stringify({ value: '1234567890' })),
      'oversized bytes',
      { maxBytes: 8 },
    ),
    /byte bound/u,
  );

  let deep = 'leaf';
  for (let index = 0; index < 18; index += 1) deep = { child: deep };
  assert.throws(
    () => parseBoundedJsonBytes(
      Buffer.from(JSON.stringify(deep)),
      'deep receipt',
      { maxDepth: 16 },
    ),
    /depth-16/u,
  );

  assert.throws(
    () => parseBoundedJsonBytes(
      Buffer.from(JSON.stringify({ values: Array.from({ length: 30 }, () => 1) })),
      'wide receipt',
      { maxNodes: 20, maxArrayLength: 100 },
    ),
    /20-node/u,
  );

  assert.throws(
    () => parseBoundedJsonBytes(
      Buffer.from(JSON.stringify({ value: '123456789' })),
      'long-string receipt',
      { maxStringBytes: 8 },
    ),
    /string-byte/u,
  );
});

function githubReceiptProvenance({
  revision,
  workflow,
  operationId = null,
  ref = 'refs/heads/main',
  runId = '123456789',
  runAttempt = '1',
  runHeadSha = 'f'.repeat(40),
}) {
  return {
    sourceCheckout: { headSha: revision, dirty: false },
    proofHarnessCheckout: { headSha: runHeadSha, dirty: false },
    easProof: null,
    githubProof: {
      repository: 'expo/snapback',
      workflowRef: `expo/snapback/.github/workflows/${workflow}@${ref}`,
      ref,
      eventName: workflow === 'qualified-package-staging.yml'
        ? 'push'
        : 'workflow_dispatch',
      runId,
      runAttempt,
      runHeadSha,
      operationId,
    },
    machine: {
      runnerEnvironment: 'github-hosted',
      separatelyProvisionedCleanMachine: true,
      githubRunId: runId,
      githubRunAttempt: runAttempt,
      githubRepository: 'expo/snapback',
      githubWorkflowSha: runHeadSha,
      easBuildId: null,
      easGitCommitHash: null,
      easOperationId: null,
      easProjectId: null,
      easRunner: null,
      easWorkflowFilename: null,
      easWorkflowRef: null,
      easWorkflowRunId: null,
      proofHarnessRevision: runHeadSha,
    },
  };
}

function easReceiptProvenance({
  revision,
  workflow,
  operationId = null,
  buildId = 'f51831f0-ea30-406a-8c5f-f8e1cc57d39c',
  projectId = '4ce68822-5695-4658-8b2c-fd1a3c48086d',
  workflowRunId = '019fbd18-6ad1-744b-98cd-684945ae0ad7',
  gitCommitHash = revision,
}) {
  const workflowRef = `.eas/workflows/${workflow}@${gitCommitHash}`;
  return {
    sourceCheckout: { headSha: revision, dirty: false },
    proofHarnessCheckout: { headSha: gitCommitHash, dirty: false },
    easProof: {
      buildId,
      gitCommitHash,
      operationId,
      projectId,
      runner: 'eas-build',
      workflowFilename: workflow,
      workflowRef,
      workflowRunId,
    },
    githubProof: null,
    machine: {
      runnerEnvironment: 'eas-hosted',
      separatelyProvisionedCleanMachine: true,
      githubRunId: null,
      githubRunAttempt: null,
      githubRepository: null,
      githubWorkflowSha: null,
      easBuildId: buildId,
      easGitCommitHash: gitCommitHash,
      easOperationId: operationId,
      easProjectId: projectId,
      easRunner: 'eas-build',
      easWorkflowFilename: workflow,
      easWorkflowRef: workflowRef,
      easWorkflowRunId: workflowRunId,
      proofHarnessRevision: gitCommitHash,
    },
  };
}

test('computes GitHub, EAS, incomplete EAS, and local receipt provenance', () => {
  const githubEnvironment = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'expo/snapback',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_RUN_ID: '123456789',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_WORKFLOW_REF:
      'expo/snapback/.github/workflows/public-package-proof.yml@refs/heads/main',
    RUNNER_ENVIRONMENT: 'github-hosted',
    SNAPBACK_PROOF_OPERATION_ID: 'proof-operation',
  };
  const github = computePublicationReceiptProvenance(githubEnvironment);
  assert.equal(github.cleanMachine, true);
  assert.equal(github.easProof, null);
  assert.deepEqual(github.githubProof, {
    repository: 'expo/snapback',
    workflowRef:
      'expo/snapback/.github/workflows/public-package-proof.yml@refs/heads/main',
    ref: 'refs/heads/main',
    eventName: 'workflow_dispatch',
    runId: '123456789',
    runAttempt: '2',
    runHeadSha: 'a'.repeat(40),
    operationId: 'proof-operation',
  });
  assert.equal(github.machine.runnerEnvironment, 'github-hosted');
  assert.equal(github.machine.separatelyProvisionedCleanMachine, true);
  assert.equal(github.machine.githubRunId, '123456789');
  assert.equal(github.machine.easBuildId, null);

  const easEnvironment = {
    EAS_BUILD: 'true',
    EAS_BUILD_GIT_COMMIT_HASH: 'b'.repeat(40),
    EAS_BUILD_ID: 'f51831f0-ea30-406a-8c5f-f8e1cc57d39c',
    EAS_BUILD_PROJECT_ID: '4ce68822-5695-4658-8b2c-fd1a3c48086d',
    EAS_BUILD_RUNNER: 'eas-build',
    RUNNER_ENVIRONMENT: 'eas-hosted',
    SNAPBACK_EAS_WORKFLOW_FILENAME: 'qualified-package-staging.yml',
    SNAPBACK_EAS_WORKFLOW_RUN_ID: '019fbd18-6ad1-744b-98cd-684945ae0ad7',
    SNAPBACK_PROOF_OPERATION_ID: 'proof-operation',
  };
  const eas = computePublicationReceiptProvenance(easEnvironment);
  assert.equal(eas.cleanMachine, true);
  assert.equal(eas.githubProof, null);
  assert.deepEqual(eas.easProof, {
    buildId: 'f51831f0-ea30-406a-8c5f-f8e1cc57d39c',
    gitCommitHash: 'b'.repeat(40),
    operationId: 'proof-operation',
    projectId: '4ce68822-5695-4658-8b2c-fd1a3c48086d',
    runner: 'eas-build',
    workflowFilename: 'qualified-package-staging.yml',
    workflowRef: `.eas/workflows/qualified-package-staging.yml@${'b'.repeat(40)}`,
    workflowRunId: '019fbd18-6ad1-744b-98cd-684945ae0ad7',
  });
  assert.equal(eas.machine.runnerEnvironment, 'eas-hosted');
  assert.equal(eas.machine.separatelyProvisionedCleanMachine, true);
  assert.equal(eas.machine.githubRunId, null);
  assert.equal(eas.machine.easBuildId, eas.easProof.buildId);
  assert.equal(eas.machine.easWorkflowRef, eas.easProof.workflowRef);

  const incompleteEasEnvironment = { ...easEnvironment };
  delete incompleteEasEnvironment.EAS_BUILD_ID;
  const incompleteEas = computePublicationReceiptProvenance(incompleteEasEnvironment);
  assert.equal(incompleteEas.cleanMachine, false);
  assert.equal(incompleteEas.githubProof, null);
  assert.equal(incompleteEas.easProof, null);
  assert.equal(incompleteEas.machine.separatelyProvisionedCleanMachine, false);
  assert.equal(incompleteEas.machine.easBuildId, null);

  const local = computePublicationReceiptProvenance({});
  assert.equal(local.cleanMachine, false);
  assert.equal(local.githubProof, null);
  assert.equal(local.easProof, null);
  assert.equal(local.machine.runnerEnvironment, 'local');
  assert.equal(local.machine.separatelyProvisionedCleanMachine, false);
  assert.equal(local.machine.easBuildId, null);
  assert.equal(local.machine.githubRunId, null);
});

test('browser secret proof allows API field names but refuses an injected canary', () => {
  const canary = `snapback-cold-canary-${'a'.repeat(48)}`;
  const publicApiNames = 'x-snapback-admin-token SNAPBACK_ADMIN_TOKEN';
  assert.equal(browserAssetsContainSecretCanary(publicApiNames, canary), false);
  assert.equal(
    browserAssetsContainSecretCanary(`${publicApiNames} ${canary}`, canary),
    true,
  );
  assert.throws(
    () => browserAssetsContainSecretCanary(publicApiNames, 'guessable'),
    /unguessable/u,
  );
});

test('browser-visible leak scanner reports marker classes without retaining secret values', () => {
  const secret = `snapback-cold-canary-${'b'.repeat(48)}`;
  const backend = 'http://127.0.0.1:45731';
  const surfaceSecrets = Object.fromEntries(
    ['console', 'response', 'cache', 'indexeddb', 'websocket', 'worker']
      .map((kind, index) => [kind, `${kind}-leak-${String(index).repeat(48)}`]),
  );
  assert.deepEqual(
    findBrowserVisibleLeaks({
      surfaces: [
        `window.__bad = ${JSON.stringify(secret)}`,
        `fetch(${JSON.stringify(backend)})`,
        Buffer.from(surfaceSecrets.console),
        Buffer.from(surfaceSecrets.response),
        Buffer.from(surfaceSecrets.cache),
        Buffer.from(surfaceSecrets.indexeddb),
        Buffer.from(surfaceSecrets.websocket),
        Buffer.from(surfaceSecrets.worker),
      ],
      forbiddenMarkers: [
        { kind: 'browser-secret-canary', value: secret },
        { kind: 'backend-origin', value: backend },
        { kind: 'runtime-path', value: '/private/runtime/snapback' },
        ...Object.entries(surfaceSecrets).map(([kind, value]) => ({
          kind: `${kind}-fixture`,
          value,
        })),
      ],
    }),
    [
      'backend-origin',
      'browser-secret-canary',
      'cache-fixture',
      'console-fixture',
      'indexeddb-fixture',
      'response-fixture',
      'websocket-fixture',
      'worker-fixture',
    ],
  );
  assert.throws(
    () => findBrowserVisibleLeaks({
      surfaces: ['safe'],
      forbiddenMarkers: [{ kind: 'admin-token', value: '' }],
    }),
    /non-empty kind\/value pairs/u,
  );
});

test('browser origin scanner normalizes HTTP(S), WS(S), and encoded forms', () => {
  const backend = 'http://127.0.0.1:45731';
  const marker = { kind: 'backend-origin', value: backend };
  assert.ok(browserForbiddenMarkerVariants(marker).includes('ws://127.0.0.1:45731'));
  for (const surface of [
    'ws://127.0.0.1:45731/live/connection/stream',
    'wss://127.0.0.1:45731/live/connection/stream',
    'https://127.0.0.1:45731/health',
    encodeURIComponent(backend),
    encodeURIComponent('ws://127.0.0.1:45731'),
    Buffer.from('wss://127.0.0.1:45731').toString('base64'),
  ]) {
    assert.deepEqual(
      findBrowserVisibleLeaks({ surfaces: [surface], forbiddenMarkers: [marker] }),
      ['backend-origin'],
      surface,
    );
  }
});

test('bounded browser scanner covers binary bytes and retains only sanitized shape', () => {
  const secret = `snapback-cold-canary-${'c'.repeat(48)}`;
  const forbiddenMarkers = [{ kind: 'browser-secret-canary', value: secret }];
  const collector = createBoundedBrowserSurfaceCollector({
    forbiddenMarkers,
    maxSurfaceBytes: 1024,
    maxTotalBytes: 2048,
  });
  collector.add('response-body', Buffer.from(`binary-prefix\0${secret}\0binary-suffix`));
  assert.deepEqual(collector.findLeaks(), ['browser-secret-canary']);
  const summary = collector.sanitizedSummary();
  assert.equal(summary.totalBytesScanned, Buffer.byteLength(`binary-prefix\0${secret}\0binary-suffix`));
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(secret, 'u'));
  assert.throws(
    () => collector.add('response-body', Buffer.alloc(1025)),
    /scan bound/u,
  );

  const sameSizeLeft = createBoundedBrowserSurfaceCollector({
    forbiddenMarkers: [],
    maxSurfaceBytes: 64,
    maxTotalBytes: 64,
    maxSurfaces: 1,
  });
  const sameSizeRight = createBoundedBrowserSurfaceCollector({
    forbiddenMarkers: [],
    maxSurfaceBytes: 64,
    maxTotalBytes: 64,
    maxSurfaces: 1,
  });
  sameSizeLeft.add('response-body', 'left');
  sameSizeRight.add('response-body', 'rift');
  const leftCommitment = sameSizeLeft.sanitizedSummary().surfaceManifest[0];
  const rightCommitment = sameSizeRight.sanitizedSummary().surfaceManifest[0];
  assert.equal(leftCommitment.bytesScanned, rightCommitment.bytesScanned);
  assert.notEqual(leftCommitment.contentSha256, rightCommitment.contentSha256);
  assert.doesNotMatch(JSON.stringify(leftCommitment), /left/u);
  assert.throws(() => sameSizeLeft.add('response-body', 'more'), /surface bound/u);
});

test('bounded browser scanner streams text, catches cross-chunk markers, and refuses before commit', () => {
  const secret = `cross-chunk-secret-${'z'.repeat(48)}`;
  const forbiddenMarkers = [{ kind: 'admin-token', value: secret }];
  const collector = createBoundedBrowserSurfaceCollector({
    forbiddenMarkers,
    maxSurfaceBytes: 128 * 1024,
    maxTotalBytes: 128 * 1024,
    maxSurfaces: 1,
  });
  collector.add('page-state', `${'p'.repeat((64 * 1024) - 8)}${secret}`);
  assert.deepEqual(collector.findLeaks(), ['admin-token']);
  assert.equal(collector.sanitizedSummary().surfaceManifest.length, 1);
  assert.throws(
    () => collector.findLeaks([...forbiddenMarkers]),
    /fixed before collection/u,
  );

  const refusing = createBoundedBrowserSurfaceCollector({
    forbiddenMarkers: [],
    maxSurfaceBytes: 32,
    maxTotalBytes: 64,
    maxSurfaces: 1,
  });
  assert.throws(() => refusing.add('page-state', 'x'.repeat(33)), /scan bound/u);
  assert.deepEqual(refusing.sanitizedSummary().surfaceManifest, []);
  assert.equal(refusing.sanitizedSummary().totalBytesScanned, 0);
});

test('qualified browser evidence fails closed on simulated, non-live, stale, or under-scanned journeys', () => {
  const valid = browserReceiptEvidence();
  assert.equal(validateColdInstallBrowserEvidence(valid), valid.browserJourney);
  for (const mutation of [
    (receipt) => { receipt.browserJourney.headless = false; },
    (receipt) => { receipt.browserJourney.liveFramesAfterMutation = 0; },
    (receipt) => { receipt.browserJourney.reloadedTodoCount = 1; },
    (receipt) => { receipt.browserJourney.checks.nativeLiveUpdateObserved = false; },
    (receipt) => {
      receipt.browserJourney.forbiddenMarkerKindsChecked =
        receipt.browserJourney.forbiddenMarkerKindsChecked.filter((kind) => kind !== 'runtime-path');
    },
    (receipt) => { delete receipt.browserJourney.capture; },
    (receipt) => { receipt.browserJourney.capture.surfaceManifest[0].bytesScanned += 1; },
    (receipt) => {
      receipt.browserJourney.capture.surfaceManifest[0].contentSha256 = 'not-a-digest';
    },
    (receipt) => { receipt.browserJourney.capture.sourceRevision = 'f'.repeat(40); },
    (receipt) => { receipt.browserJourney.capture.sourceDirty = true; },
    (receipt) => {
      receipt.browserJourney.capture.materializationBoundary.cdpEventMaterialization =
        'bounded-before-allocation';
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => {
      receipt.browserJourney.capture.materializationBoundary
        .proofInvokedHostCollectionApis.pop();
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => {
      receipt.browserJourney.capture.materializationBoundary
        .proofInvokedHostCollectionResults = 'bounded-before-allocation';
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => {
      receipt.browserJourney.capture.materializationBoundary
        .proofOwnedCopiesAndEncodings = 'bounded-before-allocation';
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => { receipt.browserJourney.capture.completedAtMs += 11 * 60 * 1000; },
    (receipt) => {
      receipt.browserJourney.capture.coverage.responseBodiesScanned = 1;
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => {
      receipt.browserJourney.capture.browser.executableSha256 = 'not-a-digest';
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => {
      receipt.browserJourney.capture.browser.distributionSha256 = 'not-a-digest';
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => {
      receipt.browserJourney.capture.coverage.webSocketHandshakesScanned = 0;
      receipt.browserJourney.captureSha256 =
        sha256Hex(canonicalJcs(receipt.browserJourney.capture));
    },
    (receipt) => { receipt.checks.browserPrivateSurfaceAbsence = false; },
  ]) {
    const receipt = structuredClone(valid);
    mutation(receipt);
    assert.throws(
      () => validateColdInstallBrowserEvidence(receipt),
      /real-browser seed\/live\/reload\/private-surface proof|unknown or missing members/u,
    );
  }
});

function runCli(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 5_000,
  });
}

test('--help exits before reading the ledger or staging packages', () => {
  const missingLedger = join(tmpdir(), `snapback-cold-install-help-${process.pid}`, 'missing.json');
  const result = runCli(['--ledger', missingLedger, '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage:/u);
  assert.match(result.stdout, /--ledger <path>/u);
  assert.match(result.stdout, /--install-source <staged\|public>/u);
  assert.match(result.stdout, /--registry <url>/u);
  assert.match(result.stdout, /--root-selector <exact\|latest>/u);
  assert.match(result.stdout, /--source-checkout <path>/u);
  assert.match(result.stdout, /--proof-harness-revision <sha>/u);
  assert.match(result.stdout, /--receipt <path>/u);
  assert.match(result.stdout, /--keep/u);
  assert.equal(result.stderr, '');
});

test('unknown flags and stale positional arguments fail before the proof', () => {
  for (const args of [
    ['--install-source', 'tarball'],
    ['tarball'],
    ['--receipt'],
    ['--install-source', 'somewhere-else'],
    ['--registry', 'file:///tmp/registry'],
    ['--root-selector', 'latest'],
    ['--help', '--unknown'],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, `unexpected success for ${args.join(' ')}`);
    assert.match(result.stderr, /snapback-package-cold-install:/u);
    assert.doesNotMatch(result.stderr, /publication ledger is missing/u);
  }
});

test('public-install arguments are explicit and normalized', () => {
  assert.deepEqual(
    parseArguments([
      '--install-source', 'public',
      '--registry', 'https://registry.example.test/',
      '--ledger', 'publication.json',
      '--receipt', 'proof.json',
      '--keep',
    ]),
    {
      help: false,
      ledger: 'publication.json',
      installSource: 'public',
      registry: 'https://registry.example.test',
      receipt: 'proof.json',
      keep: true,
      rootSelector: 'exact',
      expectedPriorRootVersion: null,
      authorizedLeaseSha256: null,
      publicationEpoch: null,
      sourceCheckout: null,
      proofHarnessRevision: null,
    },
  );
  assert.equal(
    parseArguments([
      '--install-source', 'public',
      '--source-checkout', '/tmp/package-source',
      '--proof-harness-revision', 'a'.repeat(40),
    ]).proofHarnessRevision,
    'a'.repeat(40),
  );
  assert.throws(
    () => parseArguments([
      '--install-source', 'public',
      '--source-checkout', '/tmp/package-source',
    ]),
    /must be provided together/u,
  );
  const latest = parseArguments([
    '--install-source', 'public',
    '--root-selector', 'latest',
    '--expected-prior-root-version', '0.1.0',
    '--authorized-lease-sha256', 'b'.repeat(64),
    '--publication-epoch', '7',
  ]);
  assert.equal(latest.expectedPriorRootVersion, '0.1.0');
  assert.equal(latest.authorizedLeaseSha256, 'b'.repeat(64));
  assert.equal(latest.publicationEpoch, 7);
  assert.throws(
    () => parseArguments([
      '--install-source', 'public',
      '--expected-prior-root-version', '0.1.0',
    ]),
    /latest-root authority arguments/u,
  );
});

function closedCandidateFixture() {
  const revision = '1'.repeat(40);
  const version = '0.1.1';
  const candidate = {
    schemaVersion: 'snapback.package-candidate-ledger.v1',
    mode: 'publish',
    sourceDirty: false,
    revision,
    registry: PUBLIC_NPM_REGISTRY,
    tag: `bakeoff-0-1-1-${revision.slice(0, 12)}`,
    scopePreset: 'identity',
    version,
    runtimePlatforms: ['darwin-arm64', 'linux-x64'],
    qualifiedLedgerSha256: '2'.repeat(64),
    qualifiedPlatformReceipts: [
      { platform: 'darwin-arm64', sha256: '3'.repeat(64) },
      { platform: 'linux-x64', sha256: '4'.repeat(64) },
    ],
    telemetryCurrentness: {
      schemaVersion: 'snapback.telemetry-phase1-evidence-assessment.v1',
      valid: true,
      evidenceState: 'HISTORICAL_VALID',
      state: 'CURRENT',
      sourceRevision: revision,
      headRevision: revision,
      sourceDigest: '5'.repeat(64),
      currentDigest: '5'.repeat(64),
      ageHours: 1,
      maxAgeHours: 24,
      changedSourceFileCount: 0,
      changedSourceFiles: [],
      changedSourceFilesTruncated: false,
      acceptedForOrdinaryMerge: true,
      acceptedForReleaseOrCapabilityPromotion: true,
      rollingFullProofRequested: false,
    },
    packages: PACKAGE_INVENTORY.map(([sourceName, name], publicationOrder) => ({
      publicationOrder,
      sourceName,
      name,
      version,
      dependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
      devDependencies: {},
      tarball: `package-${publicationOrder}.tgz`,
      sha256: 'a'.repeat(64),
      runtimeBinarySha256: sourceName.startsWith('@expo/snapback-runtime-')
        ? 'b'.repeat(64)
        : null,
      runtimeSupportSha256: sourceName.startsWith('@expo/snapback-runtime-')
        ? 'c'.repeat(64)
        : null,
      files: 2,
      unpackedSize: 100,
      status: 'published',
      candidateTagVerified: true,
      registrySha256: 'a'.repeat(64),
      registryIntegrity: `sha512-${'d'.repeat(80)}`,
      registryShasum: 'e'.repeat(40),
    })),
  };
  candidate.candidateLedgerSha256 = sha256Hex(canonicalJcs(candidate));
  return candidate;
}

test('all dependency classes require direct exact terminal internal versions', () => {
  for (const section of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'devDependencies',
  ]) {
    const valid = {
      name: '@expo/snapback-react',
      [section]: {
        '@expo/snapback-client': '0.1.1',
      },
    };
    assert.equal(validateInternalDependencyClosure(valid, '0.1.1'), undefined);
    for (const [dependency, value] of [
      ['@expo/snapback-client', '^0.1.1'],
      ['@expo/snapback-client', 'latest'],
      ['@expo/snapback-client', '0.1.0'],
      ['@expo/snapback-client', 'npm:@expo/snapback-client@0.1.1'],
      ['@snapback/client', 'npm:@ccheever/snapback-client@0.1.1'],
      ['@ccheever/snapback-client', '0.1.1'],
      ['@expo/snapback-unknown', '0.1.1'],
    ]) {
      assert.throws(
        () => validateInternalDependencyClosure({
          name: '@expo/snapback-react',
          [section]: { [dependency]: value },
        }, '0.1.1'),
        /pre-migration|candidate vector|package inventory/u,
      );
    }
  }
  // Recorded legacy closures (decision-9 lineage) still validate under the
  // retired ccheever preset: @snapback source keys with exact npm aliases.
  assert.equal(
    validateInternalDependencyClosure({
      name: '@ccheever/snapback-react',
      dependencies: {
        '@snapback/client': 'npm:@ccheever/snapback-client@0.1.1',
      },
    }, '0.1.1', 'ccheever'),
    undefined,
  );
  assert.throws(
    () => validateInternalDependencyClosure({
      name: '@ccheever/snapback-react',
      dependencies: { '@snapback/client': 'npm:@ccheever/snapback-client@latest' },
    }, '0.1.1', 'ccheever'),
    /exact alias/u,
  );
});

test('create-snapback-app remains the terminal packing row with a closed CLI dependency', () => {
  assert.deepEqual(PACKAGE_INVENTORY.at(-1), [
    'create-snapback-app',
    'create-snapback-app',
  ]);
  assert.equal(PROMOTION_PACKAGE_NAMES.at(-2), 'create-snapback-app');
  assert.equal(PROMOTION_PACKAGE_NAMES.at(-1), '@expo/snapback');
  const sourceNames = sourceNamesForScopePreset('identity');
  assert.equal(sourceNames['create-snapback-app'], 'create-snapback-app');
  assert.equal(Object.values(sourceNames).filter(
    (name) => name === 'create-snapback-app',
  ).length, 1);
  assert.equal(validateInternalDependencyClosure({
    name: 'create-snapback-app',
    dependencies: { '@expo/snapback-cli': '0.1.1' },
  }, '0.1.1'), undefined);
});

test('umbrella publication metadata closes and stamps every internal dependency', () => {
  const manifest = JSON.parse(readFileSync(
    new URL('../packages/snapback-umbrella/package.json', import.meta.url),
    'utf8',
  ));
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.publishConfig.access, 'public');
  const stamped = structuredClone(manifest);
  stamped.version = '0.1.21';
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(stamped[section] ?? {})) {
      if (PACKAGE_INVENTORY.some(([sourceName]) => sourceName === dependency)) {
        stamped[section][dependency] = stamped.version;
      }
    }
  }
  assert.equal(validateInternalDependencyClosure(stamped, stamped.version), undefined);
  assert.deepEqual(
    new Set(Object.keys(manifest.exports)),
    new Set(['./server', './values', './react', './package.json']),
  );
  const files = new Set(manifest.files);
  for (const target of Object.values(manifest.exports).flatMap((entry) => (
    typeof entry === 'string' ? [entry] : Object.values(entry)
  ))) {
    if (target !== './package.json') assert.equal(files.has(target.slice(2)), true, target);
  }
  assert.equal(ledgerNameGeneration('identity').umbrella, '@expo/snapback');
  assert.equal(ledgerNameGeneration('ccheever').umbrella, undefined);
});

test('promotion inventory is the full public package inventory from one authority', () => {
  assert.strictEqual(PROMOTION_PACKAGE_NAMES, AUTHORITY_PROMOTION_PACKAGE_NAMES);
  assert.deepEqual(PROMOTION_PACKAGE_NAMES, [
    '@expo/snapback-runtime-darwin-arm64',
    '@expo/snapback-runtime-linux-x64',
    '@expo/snapback-contract',
    '@expo/snapback-client',
    '@expo/snapback-codegen',
    '@expo/snapback-vite',
    '@expo/snapback-react',
    '@expo/snapback-expo',
    '@expo/snapback-app-cli',
    '@expo/snapback-cli',
    'create-snapback-app',
    '@expo/snapback',
  ]);
  assert.equal(PROMOTION_PACKAGE_NAMES.length, PACKAGE_INVENTORY.length);
  assert.deepEqual(
    [...PROMOTION_PACKAGE_NAMES].sort(),
    PACKAGE_INVENTORY.map(([, publicName]) => publicName).sort(),
  );
  assert.equal(Object.keys(PACKAGE_NAME_LINEAGE).length, 9);
  assert.equal(PACKAGE_NAME_LINEAGE['@expo/snapback-expo'], undefined);
  assert.equal(PACKAGE_NAME_LINEAGE['create-snapback-app'], undefined);
  assert.equal(PACKAGE_NAME_LINEAGE['@expo/snapback'], undefined);
});

test('public-install ledger validation requires the complete immutable closure', () => {
  const sourceNames = [
    '@expo/snapback-runtime-darwin-arm64',
    '@expo/snapback-runtime-linux-x64',
    '@expo/snapback-contract',
  ];
  const ledger = {
    schemaVersion: 'snapback.package-publication.v1',
    mode: 'publish',
    sourceDirty: false,
    revision: '0'.repeat(40),
    registry: PUBLIC_NPM_REGISTRY,
    tag: 'latest',
    scopePreset: 'identity',
    version: '0.1.0',
    packages: sourceNames.map((sourceName) => ({
      sourceName,
      name: sourceName,
      version: '0.1.0',
      status: 'published',
      sha256: 'a'.repeat(64),
      registrySha256: 'a'.repeat(64),
    })),
  };
  assert.deepEqual(
    [...validatePublicPublicationLedger(ledger, sourceNames).keys()],
    sourceNames,
  );
  assert.throws(
    () => validatePublicPublicationLedger({ ...ledger, mode: 'dry-run' }, sourceNames),
    /successful publication ledger/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({ ...ledger, sourceDirty: undefined }, sourceNames),
    /dirty-source publication ledger/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({
      ...ledger,
      registry: 'https://registry.example.test',
    }, sourceNames),
    /official npm registry/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({ ...ledger, tag: 'next' }, sourceNames),
    /legacy public ledger must select latest/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({
      ...ledger,
      packages: ledger.packages.slice(1),
    }, sourceNames),
    /not the exact expected package closure/u,
  );
  assert.throws(
    () => validatePublicPublicationLedger({
      ...ledger,
      packages: ledger.packages.map((entry, index) => (
        index === 0 ? { ...entry, status: 'publish-failed' } : entry
      )),
    }, sourceNames),
    /no successful public status/u,
  );
});

test('candidate ledger validation binds its non-default tag and self-digest', () => {
  const sourceNames = PACKAGE_INVENTORY.map(([sourceName]) => sourceName);
  const candidate = closedCandidateFixture();
  assert.equal(
    validatePublicPublicationLedger(candidate, sourceNames).size,
    sourceNames.length,
  );
  assert.throws(
    () => validatePublicPublicationLedger({
      ...candidate,
      candidateLedgerSha256: 'b'.repeat(64),
    }, sourceNames),
    /self-digest mismatch/u,
  );
  const unverified = structuredClone(candidate);
  unverified.packages[0].candidateTagVerified = false;
  const { candidateLedgerSha256: _digest, ...withoutDigest } = unverified;
  unverified.candidateLedgerSha256 = sha256Hex(canonicalJcs(withoutDigest));
  assert.throws(
    () => validatePublicPublicationLedger(unverified, sourceNames),
    /candidate tag was not verified/u,
  );
  const staleTelemetry = structuredClone(candidate);
  staleTelemetry.telemetryCurrentness.state = 'LAGGING';
  staleTelemetry.telemetryCurrentness.acceptedForReleaseOrCapabilityPromotion = false;
  const { candidateLedgerSha256: _staleDigest, ...staleWithoutDigest } = staleTelemetry;
  staleTelemetry.candidateLedgerSha256 = sha256Hex(canonicalJcs(staleWithoutDigest));
  assert.throws(
    () => validatePublicPublicationLedger(staleTelemetry, sourceNames),
    /telemetry evidence is not exact-current/u,
  );
  const open = structuredClone(candidate);
  open.unreviewed = true;
  const { candidateLedgerSha256: _openDigest, ...openWithoutDigest } = open;
  open.candidateLedgerSha256 = sha256Hex(canonicalJcs(openWithoutDigest));
  assert.throws(
    () => validatePublicPublicationLedger(open, sourceNames),
    /unknown or missing members/u,
  );
});

test('qualified staging bytes require clean proofs from both platforms', () => {
  const candidate = closedCandidateFixture();
  const qualified = {
    schemaVersion: 'snapback.package-qualified-staging-ledger.v1',
    mode: 'dry-run',
    sourceDirty: false,
    revision: candidate.revision,
    registry: candidate.registry,
    tag: candidate.tag,
    scopePreset: candidate.scopePreset,
    version: candidate.version,
    runtimePlatforms: candidate.runtimePlatforms,
    packages: candidate.packages.map((row) => ({
      publicationOrder: row.publicationOrder,
      sourceName: row.sourceName,
      name: row.name,
      version: row.version,
      dependencies: row.dependencies,
      optionalDependencies: row.optionalDependencies,
      peerDependencies: row.peerDependencies,
      devDependencies: row.devDependencies,
      tarball: row.tarball,
      sha256: row.sha256,
      runtimeBinarySha256: row.runtimeBinarySha256,
      runtimeSupportSha256: row.runtimeSupportSha256,
      files: row.files,
      unpackedSize: row.unpackedSize,
      status: 'dry-run-ok',
    })),
  };
  qualified.stagedLedgerSha256 = sha256Hex(canonicalJcs(qualified));
  assert.equal(validateQualifiedStagingLedger(qualified), qualified);
  const record = (platform, architecture, sha256, family = 'github') => {
    const provenance = family === 'eas'
      ? easReceiptProvenance({
        revision: qualified.revision,
        workflow: 'qualified-package-staging.yml',
      })
      : githubReceiptProvenance({
        revision: qualified.revision,
        workflow: 'qualified-package-staging.yml',
        ref: 'refs/tags/qualified-package-staging-test',
      });
    return {
      sha256,
      receipt: {
        ...provenance,
        schemaVersion: 'snapback.package-cold-install.v1',
        ok: true,
        installSource: 'staged',
        rootSelector: 'exact',
        publicationLedgerSchema: qualified.schemaVersion,
        sourceRevision: qualified.revision,
        sourceDirty: false,
        version: qualified.version,
        scopePreset: qualified.scopePreset,
        machine: {
          ...provenance.machine,
          platform,
          architecture,
        },
        packages: qualified.packages.map((row) => ({
          sourceName: row.sourceName,
          publishedName: row.name,
          version: row.version,
          sha256: row.sha256,
        })),
        ...retainedComparatorReceiptFixture({
          sourceRevision: qualified.revision,
          version: qualified.version,
          executorPackageNames: {
            cli: qualified.packages.find(
              (row) => row.sourceName === '@expo/snapback-cli',
            ).name,
            client: qualified.packages.find(
              (row) => row.sourceName === '@expo/snapback-client',
            ).name,
          },
          runtimeBinarySha256: qualified.packages.find((row) => (
            row.sourceName === (
              platform === 'darwin'
                ? '@expo/snapback-runtime-darwin-arm64'
                : '@expo/snapback-runtime-linux-x64'
            )
          )).runtimeBinarySha256,
        }),
        checks: {
          stagedRegistryAliasResolution: true,
          noSiblingSourceCheckout: true,
          packedExpoChatScaffoldTypecheckStaticAndLiveAcceptance: true,
          packedCreateSnapbackAppScaffoldFromCleanDirectory: true,
          packedUmbrellaDoorwaysFromTarball: true,
          ...browserReceiptEvidence(qualified.revision).checks,
        },
        browserJourney: browserJourneyFixture({ sourceRevision: qualified.revision }),
      },
    };
  };
  const records = [
    record('darwin', 'arm64', '5'.repeat(64)),
    record('linux', 'x64', '6'.repeat(64)),
  ];
  assert.deepEqual(
    validateQualifiedPlatformReceipts({ ledger: qualified, records }),
    [
      { platform: 'darwin-arm64', sha256: '5'.repeat(64) },
      { platform: 'linux-x64', sha256: '6'.repeat(64) },
    ],
  );
  const easRecords = [
    record('darwin', 'arm64', '5'.repeat(64), 'eas'),
    record('linux', 'x64', '6'.repeat(64), 'eas'),
  ];
  assert.deepEqual(
    validateQualifiedPlatformReceipts({ ledger: qualified, records: easRecords }),
    [
      { platform: 'darwin-arm64', sha256: '5'.repeat(64) },
      { platform: 'linux-x64', sha256: '6'.repeat(64) },
    ],
  );
  assert.throws(
    () => validatePublicationReceiptProvenance(easRecords[0].receipt, {
      expectedRevision: qualified.revision,
      expectedWorkflow: 'qualified-package-staging.yml',
      expectedOperationId: null,
    }),
    /EAS-hosted provenance is not allowed/u,
  );

  const refusalCases = [
    {
      name: 'missing proof',
      mutate(receipt) {
        receipt.easProof = null;
        receipt.githubProof = null;
      },
    },
    {
      name: 'both proofs',
      mutate(receipt, family) {
        if (family === 'github') {
          receipt.easProof = easReceiptProvenance({
            revision: qualified.revision,
            workflow: 'qualified-package-staging.yml',
          }).easProof;
        } else {
          receipt.githubProof = githubReceiptProvenance({
            revision: qualified.revision,
            workflow: 'qualified-package-staging.yml',
          }).githubProof;
        }
      },
    },
    {
      name: 'machine proof binding mismatch',
      mutate(receipt, family) {
        if (family === 'github') receipt.machine.githubRunId = '999';
        else receipt.machine.easBuildId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      },
    },
    {
      name: 'proof shape drift',
      mutate(receipt, family) {
        const proof = family === 'github' ? receipt.githubProof : receipt.easProof;
        proof.unexpected = true;
      },
    },
    {
      name: 'wrong workflow binding',
      mutate(receipt, family) {
        if (family === 'github') {
          receipt.githubProof.workflowRef =
            `expo/snapback/.github/workflows/evil.yml@${receipt.githubProof.ref}`;
        } else {
          receipt.easProof.workflowFilename = 'evil.yml';
          receipt.easProof.workflowRef =
            `.eas/workflows/evil.yml@${receipt.easProof.gitCommitHash}`;
          receipt.machine.easWorkflowFilename = receipt.easProof.workflowFilename;
          receipt.machine.easWorkflowRef = receipt.easProof.workflowRef;
        }
      },
    },
    {
      name: 'wrong runner environment',
      mutate(receipt) {
        receipt.machine.runnerEnvironment = 'local';
      },
    },
    {
      name: 'not separately provisioned',
      mutate(receipt) {
        receipt.machine.separatelyProvisionedCleanMachine = false;
      },
    },
    {
      name: 'proof harness commit mismatch',
      mutate(receipt) {
        receipt.proofHarnessCheckout.headSha = 'c'.repeat(40);
      },
    },
  ];
  for (const [family, validRecords] of [
    ['github', records],
    ['eas', easRecords],
  ]) {
    for (const refusal of refusalCases) {
      const invalidRecords = structuredClone(validRecords);
      refusal.mutate(invalidRecords[0].receipt, family);
      assert.throws(
        () => validateQualifiedPlatformReceipts({
          ledger: qualified,
          records: invalidRecords,
        }),
        /both|neither|unknown or missing|GitHub-hosted|EAS-hosted|proof harness/u,
        `${family} provenance accepted ${refusal.name}`,
      );
    }
  }
  for (const mutate of [
    (receipt) => {
      receipt.easProof.buildId = 'not-a-uuid';
      receipt.machine.easBuildId = receipt.easProof.buildId;
    },
    (receipt) => {
      receipt.easProof.projectId = 'not-a-uuid';
      receipt.machine.easProjectId = receipt.easProof.projectId;
    },
    (receipt) => {
      receipt.easProof.runner = 'local-build-plugin';
      receipt.machine.easRunner = receipt.easProof.runner;
    },
    (receipt) => {
      receipt.easProof.operationId = 'unexpected-operation';
      receipt.machine.easOperationId = receipt.easProof.operationId;
    },
  ]) {
    const invalidRecords = structuredClone(easRecords);
    mutate(invalidRecords[0].receipt);
    assert.throws(
      () => validateQualifiedPlatformReceipts({
        ledger: qualified,
        records: invalidRecords,
      }),
      /EAS-hosted|operation correlation/u,
    );
  }
  records[1].receipt.packages[0].sha256 = '7'.repeat(64);
  assert.throws(
    () => validateQualifiedPlatformReceipts({ ledger: qualified, records }),
    /staged receipt bytes drifted/u,
  );
});

test('real publication consumes the exact qualified tarballs without restaging', () => {
  const candidate = closedCandidateFixture();
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-qualified-bytes-'));
  try {
    const bytes = Buffer.from('immutable qualified package bytes');
    const digest = sha256Hex(bytes);
    const qualified = {
      schemaVersion: 'snapback.package-qualified-staging-ledger.v1',
      mode: 'dry-run',
      sourceDirty: false,
      revision: candidate.revision,
      registry: candidate.registry,
      tag: candidate.tag,
      scopePreset: candidate.scopePreset,
      version: candidate.version,
      runtimePlatforms: candidate.runtimePlatforms,
      packages: candidate.packages.map((row) => ({
        publicationOrder: row.publicationOrder,
        sourceName: row.sourceName,
        name: row.name,
        version: row.version,
        dependencies: row.dependencies,
        optionalDependencies: row.optionalDependencies,
        peerDependencies: row.peerDependencies,
        devDependencies: row.devDependencies,
        tarball: row.tarball,
        sha256: digest,
        runtimeBinarySha256: row.runtimeBinarySha256,
        runtimeSupportSha256: row.runtimeSupportSha256,
        files: row.files,
        unpackedSize: row.unpackedSize,
        status: 'dry-run-ok',
      })),
    };
    qualified.stagedLedgerSha256 = sha256Hex(canonicalJcs(qualified));
    for (const row of qualified.packages) {
      writeFileSync(join(temporary, row.tarball), bytes);
    }
    assert.equal(
      validateQualifiedTarballs({ ledger: qualified, root: temporary }).length,
      PACKAGE_INVENTORY.length,
    );
    writeFileSync(join(temporary, qualified.packages[4].tarball), 'restaged drift');
    assert.throws(
      () => validateQualifiedTarballs({ ledger: qualified, root: temporary }),
      /qualified tarball bytes changed/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('latest-root proof binds the root closure and complete default-tag vector', () => {
  const candidate = closedCandidateFixture();
  const tree = {
    dependencies: {
      '@expo/snapback-cli': {
        version: candidate.version,
        dependencies: {
          '@expo/snapback-client': {
            version: candidate.version,
            dependencies: {
              '@expo/snapback-contract': { version: candidate.version },
            },
          },
          '@expo/snapback-codegen': { version: candidate.version },
          '@expo/snapback-runtime-darwin-arm64': { version: candidate.version },
          '@expo/snapback-runtime-linux-x64': {},
        },
      },
    },
  };
  const tagVector = Object.fromEntries(candidate.packages.map((row) => [
    row.name,
    row.version,
  ]));
  const resolution = validateLatestRootResolution({
    tree,
    ledger: candidate,
    hostRuntime: '@expo/snapback-runtime-darwin-arm64',
    tagVector,
  });
  assert.equal(resolution.selected, candidate.version);
  assert.equal(Object.keys(resolution.defaultTagVector).length, PACKAGE_INVENTORY.length);
  assert.deepEqual(
    resolution.omittedOptionalPlatformRuntimes,
    [{
      sourceName: '@expo/snapback-runtime-linux-x64',
      treePath: [
        '@expo/snapback-cli',
        '@expo/snapback-runtime-linux-x64',
      ],
    }],
  );
  const missingRequired = structuredClone(tree);
  missingRequired.dependencies['@expo/snapback-cli'].dependencies['@expo/snapback-client'] = {};
  assert.throws(
    () => validateLatestRootResolution({
      tree: missingRequired,
      ledger: candidate,
      hostRuntime: '@expo/snapback-runtime-darwin-arm64',
      tagVector,
    }),
    /dependency @expo\/snapback-client has no installed version/u,
  );
  const missingHostRuntime = structuredClone(tree);
  missingHostRuntime.dependencies['@expo/snapback-cli'].dependencies[
    '@expo/snapback-runtime-darwin-arm64'
  ] = {};
  assert.throws(
    () => validateLatestRootResolution({
      tree: missingHostRuntime,
      ledger: candidate,
      hostRuntime: '@expo/snapback-runtime-darwin-arm64',
      tagVector,
    }),
    /dependency @expo\/snapback-runtime-darwin-arm64 has no installed version/u,
  );
  const duplicateOmission = structuredClone(tree);
  duplicateOmission.dependencies['@expo/snapback-cli'].dependencies[
    '@expo/snapback-client'
  ].dependencies['@expo/snapback-runtime-linux-x64'] = {};
  assert.throws(
    () => validateLatestRootResolution({
      tree: duplicateOmission,
      ledger: candidate,
      hostRuntime: '@expo/snapback-runtime-darwin-arm64',
      tagVector,
    }),
    /dependency @expo\/snapback-runtime-linux-x64 has no installed version/u,
  );
  const materializedOpposite = structuredClone(tree);
  materializedOpposite.dependencies['@expo/snapback-runtime-linux-x64'] = {
    version: candidate.version,
  };
  assert.throws(
    () => validateLatestRootResolution({
      tree: materializedOpposite,
      ledger: candidate,
      hostRuntime: '@expo/snapback-runtime-darwin-arm64',
      tagVector,
    }),
    /materialized the opposite platform runtime/u,
  );
  assert.throws(
    () => validateLatestRootResolution({
      tree,
      ledger: candidate,
      hostRuntime: '@expo/snapback-runtime-darwin-arm64',
      tagVector: { ...tagVector, [candidate.packages[0].name]: '0.1.0' },
    }),
    /default-tag vector drifted/u,
  );
});

test('latest-root host classification retries only one coherent signed prior root', () => {
  const candidate = closedCandidateFixture();
  const makeTree = (version) => ({
    dependencies: {
      '@expo/snapback-cli': {
        version,
        dependencies: {
          '@expo/snapback-client': {
            version,
            dependencies: {
              '@expo/snapback-contract': { version },
            },
          },
          '@expo/snapback-codegen': { version },
          '@expo/snapback-runtime-darwin-arm64': { version },
          '@expo/snapback-runtime-linux-x64': {},
        },
      },
    },
  });
  const tagVector = Object.fromEntries(candidate.packages.map((row) => [
    row.name,
    row.version,
  ]));
  assert.equal(classifyLatestRootObservation({
    tree: makeTree(candidate.version),
    ledger: candidate,
    hostRuntime: '@expo/snapback-runtime-darwin-arm64',
    tagVector,
    expectedPriorRootVersion: '0.1.0',
  }).classification, 'candidate-complete');
  assert.deepEqual(classifyLatestRootObservation({
    tree: makeTree('0.1.0'),
    ledger: candidate,
    hostRuntime: '@expo/snapback-runtime-darwin-arm64',
    tagVector,
    expectedPriorRootVersion: '0.1.0',
  }), {
    classification: 'signed-prior-stale',
    rootVersion: '0.1.0',
    resolution: null,
  });
  for (const [tree, pattern] of [
    [makeTree('0.0.9'), /third root/u],
    [{ dependencies: {} }, /no exact top-level CLI root/u],
    [(() => {
      const value = makeTree(candidate.version);
      delete value.dependencies['@expo/snapback-cli'].dependencies['@expo/snapback-client'];
      return value;
    })(), /omits @expo\/snapback-client/u],
    [(() => {
      const value = makeTree('0.1.0');
      value.dependencies['@expo/snapback-cli'].dependencies['@expo/snapback-client'].version = '9.9.9';
      return value;
    })(), /mixed or unsigned dependency/u],
  ]) {
    assert.throws(() => classifyLatestRootObservation({
      tree,
      ledger: candidate,
      hostRuntime: '@expo/snapback-runtime-darwin-arm64',
      tagVector,
      expectedPriorRootVersion: '0.1.0',
    }), pattern);
  }
});

test('a mid-propagation tag vector retries inside the authorized prior/candidate envelope', () => {
  const candidate = closedCandidateFixture();
  const expectedPriorRootVersion = '0.1.0';
  const makeTree = (version) => ({
    dependencies: {
      '@expo/snapback-cli': {
        version,
        dependencies: {
          '@expo/snapback-client': {
            version,
            dependencies: {
              '@expo/snapback-contract': { version },
            },
          },
          '@expo/snapback-codegen': { version },
          '@expo/snapback-runtime-darwin-arm64': { version },
          '@expo/snapback-runtime-linux-x64': {},
        },
      },
    },
  });
  const candidateTagVector = Object.fromEntries(candidate.packages.map((row) => [
    row.name,
    row.version,
  ]));
  const mixedTagVector = {
    ...candidateTagVector,
    [candidate.packages[0].name]: expectedPriorRootVersion,
  };
  assert.deepEqual(classifyLatestRootObservation({
    tree: makeTree(candidate.version),
    ledger: candidate,
    hostRuntime: '@expo/snapback-runtime-darwin-arm64',
    tagVector: mixedTagVector,
    expectedPriorRootVersion,
  }), {
    classification: 'tag-vector-propagating',
    rootVersion: candidate.version,
    resolution: null,
  });
  assert.deepEqual(classifyLatestRootObservation({
    tree: makeTree(expectedPriorRootVersion),
    ledger: candidate,
    hostRuntime: '@expo/snapback-runtime-darwin-arm64',
    tagVector: mixedTagVector,
    expectedPriorRootVersion,
  }), {
    classification: 'signed-prior-stale',
    rootVersion: expectedPriorRootVersion,
    resolution: null,
  });
  for (const observed of ['0.0.9', null]) {
    assert.throws(() => classifyLatestRootObservation({
      tree: makeTree(candidate.version),
      ledger: candidate,
      hostRuntime: '@expo/snapback-runtime-darwin-arm64',
      tagVector: {
        ...candidateTagVector,
        [candidate.packages[0].name]: observed,
      },
      expectedPriorRootVersion,
    }), /latest default-tag vector drifted/u);
  }
  assert.throws(() => validateLatestRootResolution({
    tree: makeTree(candidate.version),
    ledger: candidate,
    hostRuntime: '@expo/snapback-runtime-darwin-arm64',
    tagVector: mixedTagVector,
  }), /latest default-tag vector drifted/u);
  // The final resolution has no authorized prior: a missing tag must never
  // satisfy null === null inside the classification envelope.
  assert.throws(() => validateLatestRootResolution({
    tree: makeTree(candidate.version),
    ledger: candidate,
    hostRuntime: '@expo/snapback-runtime-darwin-arm64',
    tagVector: {
      ...candidateTagVector,
      [candidate.packages[0].name]: null,
    },
  }), /latest default-tag vector drifted/u);
});

function latestRootPropagationFixture({
  candidate,
  operationId,
  platform,
  resolution,
  attempts = ['signed-prior-stale', 'candidate-complete'],
  propagationStartGapMs = 0,
}) {
  const startedAtMs = Date.parse('2026-07-28T19:00:10.000Z');
  const attemptRows = attempts.map((classification, index) => {
    const attemptStartedAtMs =
      startedAtMs + index * (LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS + 1_000);
    const attemptCompletedAtMs = attemptStartedAtMs + 1_000;
    return {
      attempt: index + 1,
      startedAt: new Date(attemptStartedAtMs).toISOString(),
      completedAt: new Date(attemptCompletedAtMs).toISOString(),
      durationMs: 1_000,
      installTimeoutMs: LATEST_ROOT_PROPAGATION_ATTEMPT_TIMEOUT_MS,
      cacheIdentitySha256: String(index + 1).repeat(64),
      rootVersion: classification === 'signed-prior-stale'
        ? '0.1.0'
        : candidate.version,
      classification,
      npmTreeSha256: String(index + 3).repeat(64),
      tagVectorSha256: '9'.repeat(64),
    };
  });
  return {
    schemaVersion: 'snapback.latest-root-host-retry.v1',
    authorizedLeaseSha256: 'a'.repeat(64),
    publicationEpoch: 17,
    operationId,
    platform,
    candidateLedgerSha256: candidate.candidateLedgerSha256,
    package: '@expo/snapback-cli',
    candidateRootVersion: candidate.version,
    expectedPriorRootVersion: '0.1.0',
    registry: PUBLIC_NPM_REGISTRY,
    wallBoundMs: LATEST_ROOT_PROPAGATION_WALL_BOUND_MS,
    maxAttempts: LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS,
    retryDelayMs: LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS,
    cachePolicy: 'unique-empty-per-attempt',
    lifecycleScripts: 'disabled',
    startedAt: new Date(startedAtMs - propagationStartGapMs).toISOString(),
    completedAt: attemptRows.at(-1).completedAt,
    status: 'candidate-complete',
    distinctCacheCount: attemptRows.length,
    attempts: attemptRows,
    finalCandidateClosureSha256: sha256Hex(canonicalJcs(resolution)),
  };
}

test('latest-root propagation witness closes policy, authority, caches, and timeline', () => {
  assert.ok(
    (LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS - 1)
      * LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS
      + 1_000
      <= LATEST_ROOT_PROPAGATION_WALL_BOUND_MS,
    'attempt cap must permit one bounded attempt after npm metadata max-age',
  );
  const candidate = closedCandidateFixture();
  const operationId = 'release-propagation-test';
  const platform = 'darwin-arm64';
  const resolution = { root: '@expo/snapback-cli', selected: candidate.version };
  const witness = latestRootPropagationFixture({
    candidate,
    operationId,
    platform,
    resolution,
  });
  const validate = (value) => validateLatestRootPropagationWitness({
    witness: value,
    expectedPriorRootVersion: '0.1.0',
    expectedCandidateRootVersion: candidate.version,
    expectedAuthorizedLeaseSha256: 'a'.repeat(64),
    expectedPublicationEpoch: 17,
    expectedCandidateLedgerSha256: candidate.candidateLedgerSha256,
    expectedOperationId: operationId,
    expectedPlatform: platform,
    latestRootResolution: resolution,
  });
  assert.equal(validate(witness), witness);
  assert.equal(validate(latestRootPropagationFixture({
    candidate,
    operationId,
    platform,
    resolution,
    propagationStartGapMs: 1,
  })).status, 'candidate-complete');
  const tagVectorPropagatingWitness = latestRootPropagationFixture({
    candidate,
    operationId,
    platform,
    resolution,
    attempts: ['tag-vector-propagating', 'candidate-complete'],
  });
  assert.equal(validate(tagVectorPropagatingWitness), tagVectorPropagatingWitness);
  const tagVectorWrongRoot = structuredClone(tagVectorPropagatingWitness);
  tagVectorWrongRoot.attempts[0].rootVersion = '0.1.0';
  assert.throws(
    () => validate(tagVectorWrongRoot),
    /propagation attempt .* drifted/u,
  );
  const signedPriorWrongRoot = structuredClone(witness);
  signedPriorWrongRoot.attempts[0].rootVersion = candidate.version;
  assert.throws(
    () => validate(signedPriorWrongRoot),
    /propagation attempt .* drifted/u,
  );
  for (const mutate of [
    (value) => { value.retryDelayMs = 0; },
    (value) => { value.wallBoundMs = 1; },
    (value) => { value.maxAttempts = 1; },
    (value) => { value.cachePolicy = 'shared'; },
    (value) => { value.lifecycleScripts = 'enabled'; },
    (value) => { value.registry = 'https://registry.example.test'; },
    (value) => { value.package = '@ccheever/other'; },
    (value) => { value.authorizedLeaseSha256 = 'b'.repeat(64); },
    (value) => { value.publicationEpoch = 18; },
    (value) => { value.expectedPriorRootVersion = '0.0.9'; },
    (value) => { value.candidateRootVersion = '0.1.2'; },
    (value) => { value.candidateLedgerSha256 = 'e'.repeat(64); },
    (value) => {
      value.attempts[1].cacheIdentitySha256 =
        value.attempts[0].cacheIdentitySha256;
    },
    (value) => {
      value.attempts[1].startedAt =
        new Date(Date.parse(value.attempts[0].completedAt) + 1).toISOString();
    },
    (value) => { value.attempts[0].classification = 'candidate-complete'; },
    (value) => { value.finalCandidateClosureSha256 = 'f'.repeat(64); },
  ]) {
    const candidateWitness = structuredClone(witness);
    mutate(candidateWitness);
    assert.throws(() => validate(candidateWitness), /latest-root propagation/u);
  }
});

function finalLatestReceiptsFixture({
  expectedHeadSha = 'f'.repeat(40),
  runHeadSha = expectedHeadSha,
} = {}) {
  const candidate = closedCandidateFixture();
  const operationId = 'release-final-proof-test';
  const runId = 123456789;
  const record = (platform, architecture, receiptSha256) => {
    const hostRuntime = platform === 'darwin'
      ? '@expo/snapback-runtime-darwin-arm64'
      : '@expo/snapback-runtime-linux-x64';
    const latestRootResolution = {
      root: '@expo/snapback-cli',
      selected: candidate.version,
      installed: Object.fromEntries([
        '@expo/snapback-cli',
        '@expo/snapback-client',
        '@expo/snapback-codegen',
        '@expo/snapback-contract',
        hostRuntime,
      ].map((sourceName) => [sourceName, candidate.version])),
      omittedOptionalPlatformRuntimes: [{
        sourceName: platform === 'darwin'
          ? '@expo/snapback-runtime-linux-x64'
          : '@expo/snapback-runtime-darwin-arm64',
        treePath: [
          '@expo/snapback-cli',
          platform === 'darwin'
            ? '@expo/snapback-runtime-linux-x64'
            : '@expo/snapback-runtime-darwin-arm64',
        ],
      }],
      defaultTagVector: Object.fromEntries(candidate.packages.map((row) => [
        row.name,
        row.version,
      ])),
    };
    return {
      sha256: receiptSha256,
      githubArtifact: {
        platform: `${platform}-${architecture}`,
        artifactId: platform === 'darwin' ? 700 : 701,
        artifactName:
          `snapback-${platform}-${architecture}-latest-public-package-receipt-${runId}`,
        apiDigest: `sha256:${'6'.repeat(64)}`,
        archiveSha256: '6'.repeat(64),
        receiptFilename:
          `snapback-${platform}-${architecture}-public-package-receipt.json`,
        receiptSha256,
      },
      receipt: {
      ...githubReceiptProvenance({
        revision: candidate.revision,
        workflow: 'public-package-proof.yml',
        operationId,
        runId: String(runId),
        runHeadSha,
      }),
      schemaVersion: 'snapback.package-cold-install.v2',
      ok: true,
      rootSelector: 'latest',
      latestRootResolution,
      latestRootPropagation: latestRootPropagationFixture({
        candidate,
        operationId,
        platform: `${platform}-${architecture}`,
        resolution: latestRootResolution,
      }),
      candidateLedgerSha256: candidate.candidateLedgerSha256,
      sourceRevision: candidate.revision,
      sourceDirty: false,
      version: candidate.version,
      scopePreset: candidate.scopePreset,
      installSource: 'public',
      registry: PUBLIC_NPM_REGISTRY,
      machine: {
        ...githubReceiptProvenance({
          revision: candidate.revision,
          workflow: 'public-package-proof.yml',
          operationId,
          runId: String(runId),
          runHeadSha,
        }).machine,
        platform,
        architecture,
        runtimePackage: hostRuntime,
      },
      packages: candidate.packages.map((row) => ({
        sourceName: row.sourceName,
        publishedName: row.name,
        version: row.version,
        sha256: row.sha256,
        registrySha256: row.registrySha256,
      })),
      ...retainedComparatorReceiptFixture({
        sourceRevision: candidate.revision,
        version: candidate.version,
        executorPackageNames: {
          cli: candidate.packages.find(
            (row) => row.sourceName === '@expo/snapback-cli',
          ).name,
          client: candidate.packages.find(
            (row) => row.sourceName === '@expo/snapback-client',
          ).name,
        },
        runtimeBinarySha256: candidate.packages.find(
          (row) => row.sourceName === hostRuntime,
        ).runtimeBinarySha256,
      }),
      checks: {
        latestRootCandidateClosure: true,
        publicRegistryTarballDigestMatch: true,
        packedExpoChatScaffoldTypecheckStaticAndLiveAcceptance: true,
        packedCreateSnapbackAppScaffoldFromCleanDirectory: true,
        packedUmbrellaDoorwaysFromTarball: true,
        ...browserReceiptEvidence(candidate.revision).checks,
      },
      browserJourney: browserJourneyFixture({ sourceRevision: candidate.revision }),
    },
    };
  };
  const records = [
    record('darwin', 'arm64', '7'.repeat(64)),
    record('linux', 'x64', '8'.repeat(64)),
  ];
  const githubCollection = {
    schemaVersion: 'snapback.github-latest-root-proof-collection.v3',
    authorizedLeaseSha256: 'a'.repeat(64),
    publicationEpoch: 17,
    expectedPriorRootVersion: '0.1.0',
    candidateLedgerSha256: candidate.candidateLedgerSha256,
    candidateRootVersion: candidate.version,
    repository: 'expo/snapback',
    workflow: 'public-package-proof.yml',
    workflowId: 42,
    workflowPath: '.github/workflows/public-package-proof.yml@refs/heads/main',
    ref: 'main',
    expectedHeadSha,
    runHeadSha,
    operationId,
    ledgerRevision: candidate.revision,
    runId,
    runAttempt: 1,
    dispatchStartedAt: '2026-07-28T19:00:00.000Z',
    runCreatedAt: '2026-07-28T19:00:01.000Z',
    runStartedAt: '2026-07-28T19:00:02.000Z',
    collectedAt: '2026-07-28T19:04:00.000Z',
    artifacts: records.map((row) => row.githubArtifact),
  };
  const finalValidation = (
    candidateRecords,
    collection = githubCollection,
  ) => validateFinalLatestReceipts({
    ledger: candidate,
    records: candidateRecords,
    githubCollection: collection,
    expectedPriorRootVersion: '0.1.0',
    expectedAuthorizedLeaseSha256: 'a'.repeat(64),
    expectedPublicationEpoch: 17,
  });
  return {
    candidate,
    finalValidation,
    githubCollection,
    operationId,
    records,
  };
}

test('final latest-root receipts are candidate- and platform-closed', () => {
  const {
    candidate,
    finalValidation,
    githubCollection,
    operationId,
    records,
  } = finalLatestReceiptsFixture();
  const final = finalValidation(records);
  assert.equal(
    validatePostPromotionLatestRootReceipts(final, operationId),
    final,
  );
  assert.deepEqual(final.map((row) => row.platform), ['darwin-arm64', 'linux-x64']);
  assert.equal(final[0].browserCaptureSha256, records[0].receipt.browserJourney.captureSha256);
  assert.equal(
    final[0].browserDistributionSha256,
    records[0].receipt.browserJourney.capture.browser.distributionSha256,
  );
  assert.equal(
    final[0].browserExecutableSha256,
    records[0].receipt.browserJourney.capture.browser.executableSha256,
  );
  for (const mutate of [
    (value) => { value.expectedPriorRootVersion = '0.0.9'; },
    (value) => { value.authorizedLeaseSha256 = 'b'.repeat(64); },
    (value) => { value.publicationEpoch = 18; },
    (value) => { value.candidateLedgerSha256 = 'c'.repeat(64); },
    (value) => { value.candidateRootVersion = '0.1.2'; },
  ]) {
    const driftedCollection = structuredClone(githubCollection);
    mutate(driftedCollection);
    assert.throws(
      () => finalValidation(records, driftedCollection),
      /closed GitHub proof collection/u,
    );
  }
  const witnessPolicyDrift = structuredClone(records);
  witnessPolicyDrift[0].receipt.latestRootPropagation.cachePolicy = 'shared';
  assert.throws(
    () => finalValidation(witnessPolicyDrift),
    /propagation witness/u,
  );
  const vectorDrift = structuredClone(records);
  vectorDrift[0].receipt.latestRootResolution.defaultTagVector[
    candidate.packages[0].name
  ] = '0.1.0';
  assert.throws(
    () => finalValidation(vectorDrift),
    /candidate closure digest drifted/u,
  );
  const packageDrift = structuredClone(records);
  packageDrift[1].receipt.packages[2].registrySha256 = '9'.repeat(64);
  assert.throws(
    () => finalValidation(packageDrift),
    /package evidence drifted/u,
  );
  const installedDrift = structuredClone(records);
  installedDrift[0].receipt.latestRootResolution.installed['@expo/snapback-codegen'] = '0.1.0';
  assert.throws(
    () => finalValidation(installedDrift),
    /candidate closure digest drifted/u,
  );
  const materializedOpposite = structuredClone(records);
  materializedOpposite[0].receipt.latestRootResolution.installed[
    '@expo/snapback-runtime-linux-x64'
  ] = candidate.version;
  assert.throws(
    () => finalValidation(materializedOpposite),
    /candidate closure digest drifted/u,
  );
  const harnessDrift = structuredClone(records);
  harnessDrift[1].receipt.proofHarnessCheckout.headSha = 'e'.repeat(40);
  assert.throws(
    () => finalValidation(harnessDrift),
    /proof harness/u,
  );
});

test('final latest-root receipts bind an advanced run head independently of the plan head', () => {
  const expectedHeadSha = 'f'.repeat(40);
  const runHeadSha = 'e'.repeat(40);
  const { finalValidation, records } = finalLatestReceiptsFixture({
    expectedHeadSha,
    runHeadSha,
  });
  assert.equal(finalValidation(records).length, 2);

  const driftedRecords = structuredClone(records);
  driftedRecords[0].receipt.githubProof.runHeadSha = expectedHeadSha;
  assert.throws(() => finalValidation(driftedRecords));
});

test('aggregate proof requires one public clean receipt for every runtime tuple', () => {
  const sourceNames = [
    '@expo/snapback-runtime-darwin-arm64',
    '@expo/snapback-runtime-linux-x64',
    '@expo/snapback-contract',
    '@expo/snapback-client',
    '@expo/snapback-expo',
    '@expo/snapback-cli',
  ];
  const ledger = {
    schemaVersion: 'snapback.package-publication.v1',
    mode: 'publish',
    sourceDirty: false,
    revision: '0123456789abcdef0123456789abcdef01234567',
    registry: PUBLIC_NPM_REGISTRY,
    tag: 'latest',
    scopePreset: 'identity',
    version: '0.1.0',
    packages: sourceNames.map((sourceName) => ({
      sourceName,
      name: sourceName,
      version: '0.1.0',
      status: 'published',
      sha256: 'a'.repeat(64),
      registrySha256: 'b'.repeat(64),
    })),
  };
  const platformReceipt = (platform, architecture) => ({
    ...githubReceiptProvenance({
      revision: ledger.revision,
      workflow: 'public-package-proof.yml',
      operationId: 'public-exact-proof',
    }),
    schemaVersion: 'snapback.package-cold-install.v1',
    ok: true,
    platformClaimSatisfied: true,
    sourceRevision: ledger.revision,
    sourceDirty: false,
    publicationMode: 'publish',
    installSource: 'public',
    registry: PUBLIC_NPM_REGISTRY,
    scopePreset: 'identity',
    version: '0.1.0',
    machine: {
      ...githubReceiptProvenance({
        revision: ledger.revision,
        workflow: 'public-package-proof.yml',
        operationId: 'public-exact-proof',
      }).machine,
      platform,
      architecture,
      runtimePackage: platform === 'darwin'
        ? '@expo/snapback-runtime-darwin-arm64'
        : '@expo/snapback-runtime-linux-x64',
    },
    packages: ledger.packages.map((entry) => ({
      sourceName: entry.sourceName,
      publishedName: entry.name,
      version: entry.version,
      registrySha256: entry.registrySha256,
    })),
    ...retainedComparatorReceiptFixture({
      sourceRevision: ledger.revision,
      version: ledger.version,
      executorPackageNames: {
        cli: '@expo/snapback-cli',
        client: '@expo/snapback-client',
      },
    }),
    checks: {
      publicRegistryAliasResolution: true,
      publicRegistryTarballDigestMatch: true,
      registryTarballCount: sourceNames.length,
      noSiblingSourceCheckout: true,
      localCodegenOffline: true,
      remoteCodegenOffline: true,
      packagedCliIntrospection: true,
      packagedRuntimeDoctor: true,
      packagedComparatorProfile: true,
      packagedScaffoldAndOfflineGenerate: true,
      packagedDeployBuildAndVerify: true,
      packagedManagedDevReadyAttachWatchAndStop: true,
      packedReactWebTypecheckTestBuildAndLiveAcceptance: true,
      packedReactOneCommandBackendViteJourney: true,
      ...browserReceiptEvidence(ledger.revision).checks,
      packedReactExpoTypecheckAndIosExport: true,
      packagedViteRelativeVersionedSeedSeam: true,
      browserAdapterBundle: true,
    },
    browserJourney: browserJourneyFixture({ sourceRevision: ledger.revision }),
  });
  const receipts = [
    {
      path: 'darwin.json',
      sha256: 'c'.repeat(64),
      receipt: platformReceipt('darwin', 'arm64'),
    },
    {
      path: 'linux.json',
      sha256: 'd'.repeat(64),
      receipt: platformReceipt('linux', 'x64'),
    },
  ];
  const aggregate = aggregatePublicPackageProofs({
    ledger,
    expectedSourceNames: sourceNames,
    expectedPlatforms: new Map([
      ['darwin-arm64', '@expo/snapback-runtime-darwin-arm64'],
      ['linux-x64', '@expo/snapback-runtime-linux-x64'],
    ]),
    receipts,
  });
  assert.equal(aggregate.claimSatisfied, true);
  assert.equal(aggregate.platforms.length, 2);
  assert.equal(
    aggregate.checks.packedExpoChatScaffoldTypecheckStaticAndLiveAcceptanceOnEveryPlatform,
    false,
    'an identity ledger without the creator row remains a pre-scaffold-proof closure',
  );
  assert.equal(
    aggregate.checks.packedCreateSnapbackAppScaffoldFromCleanDirectoryOnEveryPlatform,
    false,
  );
  assert.equal(
    aggregate.platforms[0].browserPackageTreeSha256,
    receipts[0].receipt.browserJourney.capture.browser.packageTreeSha256,
  );
  assert.deepEqual(aggregate.nonclaims, []);
  assert.throws(
    () => aggregatePublicPackageProofs({
      ledger,
      expectedSourceNames: sourceNames,
      expectedPlatforms: new Map([
        ['darwin-arm64', '@expo/snapback-runtime-darwin-arm64'],
        ['linux-x64', '@expo/snapback-runtime-linux-x64'],
      ]),
      receipts: receipts.slice(0, 1),
    }),
    /missing platform receipt: linux-x64/u,
  );
  assert.throws(
    () => aggregatePublicPackageProofs({
      ledger,
      expectedSourceNames: sourceNames,
      expectedPlatforms: new Map([
        ['darwin-arm64', '@expo/snapback-runtime-darwin-arm64'],
        ['linux-x64', '@expo/snapback-runtime-linux-x64'],
      ]),
      receipts: receipts.map((record, index) => index === 0
        ? {
            ...record,
            receipt: {
              ...record.receipt,
              checks: {
                ...record.receipt.checks,
                packagedRuntimeDoctor: false,
              },
            },
          }
        : record),
    }),
    /complete packaged-loop proof/u,
  );
  for (const mutate of [
    (receipt) => { delete receipt.proofHarnessCheckout; },
    (receipt) => { receipt.proofHarnessCheckout.dirty = true; },
    (receipt) => { receipt.proofHarnessCheckout.headSha = 'e'.repeat(40); },
  ]) {
    const harnessDrift = structuredClone(receipts);
    mutate(harnessDrift[0].receipt);
    assert.throws(
      () => aggregatePublicPackageProofs({
        ledger,
        expectedSourceNames: sourceNames,
        expectedPlatforms: new Map([
          ['darwin-arm64', '@expo/snapback-runtime-darwin-arm64'],
          ['linux-x64', '@expo/snapback-runtime-linux-x64'],
        ]),
        receipts: harnessDrift,
      }),
      /proof harness/u,
    );
  }
});

test('spawn ENOENT rejects without hanging or escaping the promise', async () => {
  const missingCommand = `snapback-command-that-does-not-exist-${process.pid}`;
  let deadline;
  try {
    await assert.rejects(
      Promise.race([
        runAsync(missingCommand, []),
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('runAsync did not settle after spawn ENOENT')),
            2_000,
          );
        }),
      ]),
      (error) => {
        assert.match(error.message, /failed to spawn/u);
        assert.equal(error.cause?.code, 'ENOENT');
        return true;
      },
    );
  } finally {
    clearTimeout(deadline);
  }
});

test('owned cold-install teardown retires descendants that retain captured pipes', {
  skip: process.platform === 'win32',
}, async () => {
  const child = spawn(process.execPath, ['-e', [
    'const { spawn } = require("node:child_process");',
    'const descendant = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] });',
    'console.log(`descendant:${descendant.pid}`);',
    'process.stdin.resume();',
    'process.stdin.once("end", () => process.exit(0));',
  ].join(' ')], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 2_000;
  while (!/descendant:\d+/u.test(output) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  const descendantPid = Number(/descendant:(\d+)/u.exec(output)?.[1]);
  assert(Number.isInteger(descendantPid), `fixture did not publish its descendant pid: ${output}`);

  const cleanup = await stopOwnedProcessTree(child, {
    gracefulTimeoutMs: 50,
    leaderCloseTimeoutMs: 500,
    processGroupTimeoutMs: 2_000,
    processGroupPollMs: 5,
  });
  assert.equal(cleanup.ok, true, JSON.stringify(cleanup));
  assert.equal(cleanup.cleanup.mechanism, 'process-group');
  assert.equal(cleanup.cleanup.exitAttested, true);
  assert.equal(cleanup.leaderClosed, true);
  assert.throws(
    () => process.kill(descendantPid, 0),
    (error) => error?.code === 'ESRCH',
  );
});
