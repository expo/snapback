import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(packageRoot, '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'snapback-acceptance-package-'));
let api;

before(() => {
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', fixtureRoot,
  ], { cwd: packageRoot, encoding: 'utf8' }));
  const tarball = join(fixtureRoot, packed[0].filename);
  execFileSync('npm', [
    'install', '--ignore-scripts', '--legacy-peer-deps', '--no-package-lock',
    '--no-save', tarball,
  ], { cwd: fixtureRoot, stdio: 'pipe' });
});

before(async () => {
  const consumer = join(fixtureRoot, 'package-import.mjs');
  writeFileSync(consumer, "export * from '@expo/snapback-acceptance';\n");
  api = await import(pathToFileURL(consumer).href);
});

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

const artifacts = Object.freeze({
  artifactKind: 'artifactIndex',
  schemaVersion: 'snapback.v1',
  appId: 'fixture-app',
  schemaHash: 'fixture-schema',
  bundleHash: 'fixture-bundle',
  inputsHash: 'fixture-inputs',
});
const operation = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: artifacts.appId,
  id: 'fixture:list',
  name: 'list',
  kind: 'Query',
  expectedGeneration: Object.freeze({
    schemaVersion: artifacts.schemaVersion,
    appId: artifacts.appId,
    schemaHash: artifacts.schemaHash,
    bundleHash: artifacts.bundleHash,
    inputsHash: artifacts.inputsHash,
  }),
});

function lifecycle(events) {
  return Object.freeze({
    schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
    async start() {
      events.push('start');
      return Object.freeze({
        ready: Object.freeze({ ready: true, serverUrl: 'http://127.0.0.1:1' }),
        loadedIdentity: Object.freeze({ appId: artifacts.appId, bundleHash: artifacts.bundleHash }),
        health: () => Object.freeze({ running: true }),
      });
    },
    async stop() {
      events.push('stop');
      return Object.freeze({ exited: true });
    },
  });
}

function definition(journey, options = {}) {
  return api.defineStarterAcceptance({
    acceptanceFile: import.meta.url,
    artifacts,
    stepTimeoutMs: options.stepTimeoutMs ?? 50,
    overallTimeoutMs: options.overallTimeoutMs ?? 1_000,
    cleanupTimeoutMs: options.cleanupTimeoutMs ?? 200,
    paths: {
      list: {
        id: 'list-path',
        kind: 'success',
        targetProfileId: 'local-dev-sqlite-ibex',
        operation: options.operation ?? operation,
        provenance: 'baseline',
      },
      ...(options.includeDelivery ? {
        delivery: {
          id: 'delivery-path',
          kind: 'success',
          targetProfileId: 'local-dev-sqlite-ibex',
          operation: null,
        },
      } : {}),
    },
    journey,
  });
}

test('packed runner emits an admitted receipt and cleans up in reverse order', async () => {
  const events = [];
  const declared = definition(async ({ defer, paths, step }) => {
    defer(() => events.push('cleanup-first'));
    defer(() => events.push('cleanup-second'));
    await step(paths.list, () => ({ asserted: 'application meaning stays here' }));
    await step(paths.delivery, () => ({ delivered: true }));
  }, { includeDelivery: true });
  const { receipt, exitCode } = await api.runStarterAcceptance(declared, {
    lifecycle: lifecycle(events),
    emit: false,
  });

  assert.equal(exitCode, 0);
  assert.equal(receipt.status, 'passed');
  assert.deepEqual(receipt.operations, { 'list-path': operation.id });
  assert.equal(Object.hasOwn(receipt.lifecycle, 'owned'), false);
  assert.equal(Object.hasOwn(receipt.lifecycle, 'waitLevel'), false);
  assert.equal(Object.hasOwn(receipt.lifecycle, 'firstQueryRetries'), false);
  assert.deepEqual(events, ['start', 'cleanup-second', 'cleanup-first', 'stop']);
  const profile = api.starterVerifyProfileOptions(declared, { id: 'fixture-live' });
  assert.equal(profile.acceptanceFile, fileURLToPath(import.meta.url));
  const admission = api.validatePassingStarterReceipt(receipt, profile.paths, {
    manifests: { functions: { functions: [{ id: operation.id }] } },
  });
  assert.equal(admission.complete, true, JSON.stringify(admission.invalidPaths));
  assert.deepEqual(admission.observedPathIds, ['list-path', 'delivery-path']);
});

// @ref LLP 0295#program-invariant-vertical-paved-path-coherence — one packed
// fixture binds generated lifecycle truth to the acceptance binding and the
// ordinary bootstrap admission that consumes it.
test('packed Expo guest lifecycle, binding offer, and bootstrap admission agree', async () => {
  const generatedRoot = join(
    workspaceRoot,
    'packages',
    'snapback-cli',
    'templates',
    'expo-chat',
    'snapback',
    'generated',
  );
  const [{ app, api: generatedApi }, { createSnapbackAppClient }] = await Promise.all([
    import(pathToFileURL(join(generatedRoot, 'api.mjs')).href),
    import(pathToFileURL(join(workspaceRoot, 'packages', 'snapback-client', 'index.mjs')).href),
  ]);
  const lifecycleManifest = JSON.parse(readFileSync(
    join(generatedRoot, 'client-lifecycle.v1.json'),
    'utf8',
  ));
  const generatedArtifacts = JSON.parse(readFileSync(
    join(generatedRoot, 'artifacts.json'),
    'utf8',
  ));
  const shippedEntries = lifecycleManifest.rows.authEntryMechanisms.entries.filter(
    (entry) => entry.configured && entry.phase === 'shipped',
  );
  const guestEntry = shippedEntries.find((entry) => entry.mechanism === 'guest-v1');
  assert.equal(guestEntry?.targetCapability, 'auth.guest-sessions');

  const verticalAcceptance = api.defineStarterAcceptance({
    acceptanceFile: import.meta.url,
    appRoot: packageRoot,
    artifacts: generatedArtifacts,
    overallTimeoutMs: 1_000,
    cleanupTimeoutMs: 200,
    paths: {
      guestBootstrap: {
        id: 'guest-lifecycle-binding-bootstrap',
        kind: 'success',
        targetProfileId: 'local-dev-sqlite-ibex',
        operation: generatedApi.conversations,
      },
    },
    async journey({ bindingFor, paths, step }) {
      await step(paths.guestBootstrap, async () => {
        const binding = bindingFor(app, {
          // Preserve the shipped template's 0.1.26 caller shape so reverting
          // the acceptance projection fails specifically on guest admission.
          offeredCapabilities: ['auth.passwords'],
        });
        for (const entry of shippedEntries) {
          assert(app.authBootstrap.entryMechanisms.includes(entry.mechanism));
          assert(binding.capabilities.offered.includes(entry.targetCapability));
        }
        const client = await createSnapbackAppClient({
          app,
          binding,
          platform: Object.freeze({ kind: 'memory', cryptoObject: webcrypto }),
          rqsStore: null,
        });
        try {
          assert.equal(client.bootstrapState().status, 'ready');
        } finally {
          await client.dispose();
        }
        return {
          mechanism: guestEntry.mechanism,
          targetCapability: guestEntry.targetCapability,
          bootstrap: 'admitted',
        };
      });
    },
  });

  const originalFetch = globalThis.fetch;
  const priorRqsSetting = process.env.SNAPBACK_CLIENT_RQS_STORE;
  process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/auth/session');
    return Response.json({
      protocolVersion: 1,
      serverStartupNonce: 'guest-vertical-fixture',
      authorizationStreamIncarnation: '018f0d90-ab20-7a22-8c33-445566778899',
      transitionGeneration: 0,
      activeMode: 'sessions',
      desiredMode: 'sessions',
      modeState: 'settled',
      appDataAvailability: 'available',
      quarantineCode: null,
      clientProtocols: {
        authClient: 1,
        authInvalidation: null,
        authorityDescriptor: 1,
        authorizedLease: null,
      },
      availability: {
        onlineRequestResponse: { available: true, reason: null },
        authScopedLive: {
          available: false,
          minimumAuthInvalidationProtocol: 1,
          reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED',
        },
        retainedReads: {
          available: false,
          minimumAuthInvalidationProtocol: 1,
          minimumAuthorizedLeaseProtocol: 1,
          reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
        },
        queuedReplay: {
          available: true,
          minimumAuthorityDescriptorProtocol: 1,
          reason: null,
        },
      },
      provider: { key: 'guest', available: true },
      transports: ['bearer'],
      authority: {
        kind: 'anonymous',
        userId: null,
        sessionId: null,
        isAuthenticated: false,
      },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: '018f0d90-ab20-7a22-8c33-445566778899',
        sessionGeneration: 0,
      },
      deploymentIdentity: {
        schemaVersion: generatedArtifacts.schemaVersion,
        authMode: 'sessions',
        appId: generatedArtifacts.appId,
        schemaHash: generatedArtifacts.schemaHash,
        bundleHash: generatedArtifacts.bundleHash,
        inputsHash: generatedArtifacts.inputsHash,
      },
      authorizedLease: null,
    });
  };
  try {
    const events = [];
    const { receipt, exitCode } = await api.runStarterAcceptance(verticalAcceptance, {
      lifecycle: Object.freeze({
        schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
        async start() {
          events.push('start');
          return Object.freeze({
            ready: Object.freeze({ ready: true, serverUrl: 'http://127.0.0.1:1' }),
            loadedIdentity: Object.freeze({
              appId: generatedArtifacts.appId,
              bundleHash: generatedArtifacts.bundleHash,
            }),
            health: () => Object.freeze({ running: true }),
          });
        },
        async stop() {
          events.push('stop');
          return Object.freeze({ exited: true });
        },
      }),
      emit: false,
    });
    assert.equal(exitCode, 0, JSON.stringify(receipt.diagnostic));
    assert.equal(receipt.status, 'passed');
    assert.deepEqual(events, ['start', 'stop']);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorRqsSetting === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    else process.env.SNAPBACK_CLIENT_RQS_STORE = priorRqsSetting;
  }
});

test('timeout and failed assertion remain failed while bounded cleanup still runs', async (t) => {
  await t.test('step timeout', async () => {
    const events = [];
    const declared = definition(async ({ defer, paths, step }) => {
      defer(() => events.push('cleanup'));
      await step(paths.list, () => new Promise(() => {}), { timeoutMs: 10 });
    });
    const { receipt, exitCode } = await api.runStarterAcceptance(declared, {
      lifecycle: lifecycle(events),
      emit: false,
    });
    assert.equal(exitCode, 1);
    assert.equal(receipt.diagnostic.code, 'SNAPBACK_STARTER_ACCEPTANCE_STEP_TIMEOUT');
    assert.equal(receipt.cleanup.clientResourcesReleased, true);
    assert.equal(receipt.cleanup.devExited, true);
    assert.deepEqual(events, ['start', 'cleanup', 'stop']);
  });

  await t.test('application assertion failure', async () => {
    const events = [];
    const declared = definition(async ({ defer, paths, step }) => {
      defer(() => events.push('cleanup'));
      await step(paths.list, () => assert.equal('actual', 'expected'));
    });
    const { receipt } = await api.runStarterAcceptance(declared, {
      lifecycle: lifecycle(events),
      emit: false,
    });
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.diagnostic.code, 'ERR_ASSERTION');
    assert.deepEqual(events, ['start', 'cleanup', 'stop']);
  });
});

test('non-JSON-safe journey detail is a typed harness failure', async () => {
  const declared = definition(async ({ paths, step }) => {
    await step(paths.list, () => ({ malformed: Symbol('not-json') }));
  });
  const { receipt } = await api.runStarterAcceptance(declared, {
    lifecycle: lifecycle([]),
    emit: false,
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.diagnostic.code, 'SNAPBACK_STARTER_ACCEPTANCE_STEP_RESULT_INVALID');
});

test('journey TypeErrors retain product failure identity instead of becoming detail errors', async () => {
  const declared = definition(async ({ paths, step }) => {
    await step(paths.list, () => {
      const error = new TypeError('product callback shape failed');
      error.code = 'PRODUCT_CALLBACK_TYPE_ERROR';
      throw error;
    });
  });
  const { receipt } = await api.runStarterAcceptance(declared, {
    lifecycle: lifecycle([]),
    emit: false,
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.diagnostic.code, 'PRODUCT_CALLBACK_TYPE_ERROR');
  assert.equal(receipt.diagnostic.message, 'product callback shape failed');
});

test('definition binds generated reference discriminants and exact artifact generation', () => {
  for (const forged of [
    { ...operation, artifactKind: 'hand-authored-reference' },
    { ...operation, schemaVersion: '' },
    { ...operation, appId: 'other-app' },
    { ...operation, expectedGeneration: { ...operation.expectedGeneration, inputsHash: 'other-inputs' } },
  ]) {
    assert.throws(
      () => definition(async () => {}, { operation: forged }),
      /must be functionReference|must be non-empty|must match artifacts/u,
    );
  }
});

test('step accepts only exact tokens from its own definition and every declared path must run', async (t) => {
  await t.test('raw string and cloned tokens refuse', async () => {
    for (const tokenSelector of [
      () => 'list-path',
      (paths) => ({ ...paths.list }),
    ]) {
      const declared = definition(async ({ paths, step }) => {
        await step(tokenSelector(paths), () => ({ observed: true }));
      });
      const { receipt } = await api.runStarterAcceptance(declared, {
        lifecycle: lifecycle([]),
        emit: false,
      });
      assert.equal(receipt.status, 'failed');
      assert.equal(receipt.diagnostic.code, 'ERR_ASSERTION');
      assert.match(receipt.diagnostic.message, /only a path token issued by this acceptance definition/u);
    }
  });

  await t.test('declared path shortfall fails before a passing receipt', async () => {
    const declared = definition(async ({ paths, step }) => {
      await step(paths.list, () => ({ observed: true }));
    }, { includeDelivery: true });
    const { receipt } = await api.runStarterAcceptance(declared, {
      lifecycle: lifecycle([]),
      emit: false,
    });
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.expectedCheckCount, 2);
    assert.equal(receipt.executedCheckCount, 1);
    assert.equal(receipt.diagnostic.code, 'SNAPBACK_STARTER_ACCEPTANCE_PATH_NOT_OBSERVED');
    assert.match(receipt.diagnostic.message, /delivery-path/u);
  });

  await t.test('a journey returning before any declared path fails', async () => {
    const declared = definition(async () => {});
    const { receipt, exitCode } = await api.runStarterAcceptance(declared, {
      lifecycle: lifecycle([]),
      emit: false,
    });
    assert.equal(exitCode, 1);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.executedCheckCount, 0);
    assert.equal(receipt.diagnostic.code, 'SNAPBACK_STARTER_ACCEPTANCE_PATH_NOT_OBSERVED');
    assert.match(receipt.diagnostic.message, /list-path/u);
  });

  await t.test('a caught failed step does not satisfy its path', async () => {
    const declared = definition(async ({ paths, step }) => {
      try {
        await step(paths.list, () => {
          throw new Error('product failed');
        });
      } catch {}
      await step(paths.delivery, () => ({ delivered: true }));
    }, { includeDelivery: true });
    const { receipt, exitCode } = await api.runStarterAcceptance(declared, {
      lifecycle: lifecycle([]),
      emit: false,
    });
    assert.equal(exitCode, 1);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.expectedCheckCount, 2);
    assert.equal(receipt.executedCheckCount, 1);
    assert.deepEqual(receipt.checks.map(({ id }) => id), ['delivery-path']);
    assert.equal(receipt.diagnostic.code, 'SNAPBACK_STARTER_ACCEPTANCE_PATH_NOT_OBSERVED');
    assert.match(receipt.diagnostic.message, /list-path/u);
  });
});

test('admission correlates each operation and passed check to the exact registered path id', async () => {
  const declared = definition(async ({ paths, step }) => {
    await step(paths.list, () => ({ observed: true }));
  });
  const { receipt } = await api.runStarterAcceptance(declared, {
    lifecycle: lifecycle([]),
    emit: false,
  });
  const forgedSharedOperationReceipt = {
    ...receipt,
    expectedCheckCount: 2,
    executedCheckCount: 2,
    checks: [...receipt.checks, { id: 'second-path', status: 'passed', details: null }],
  };
  const registeredPaths = [
    { id: 'list-path', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex', functionId: operation.id },
    { id: 'second-path', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex', functionId: operation.id },
  ];
  const admission = api.validatePassingStarterReceipt(forgedSharedOperationReceipt, registeredPaths, {
    identity: artifacts,
    manifests: { functions: { functions: [{ id: operation.id }] } },
  });
  assert.equal(admission.complete, false);
  assert(admission.invalidPaths.some(({ path, expected }) => (
    path === '$.operations.secondPath' || path === '$.operations["second-path"]'
      ? expected.state === `exact-registered-function-id:${operation.id}`
      : false
  )), JSON.stringify(admission.invalidPaths));
  assert.deepEqual(admission.observedPathIds, ['list-path']);
});

test('overall, retry, and lifecycle-stop deadlines abort underlying work', async (t) => {
  await t.test('hung lifecycle start receives overall abort', async () => {
    let startAborted = false;
    const declared = definition(async () => {}, { overallTimeoutMs: 80, cleanupTimeoutMs: 20 });
    const hungLifecycle = Object.freeze({
      schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
      async start({ signal }) {
        signal.addEventListener('abort', () => { startAborted = true; }, { once: true });
        return new Promise(() => {});
      },
      async stop() { return { exited: true }; },
    });
    const started = Date.now();
    const { receipt } = await api.runStarterAcceptance(declared, {
      lifecycle: hungLifecycle,
      emit: false,
    });
    assert(Date.now() - started < 500);
    assert.equal(startAborted, true);
    assert([
      'SNAPBACK_STARTER_ACCEPTANCE_LIFECYCLE_START_TIMEOUT',
      'SNAPBACK_STARTER_ACCEPTANCE_OVERALL_TIMEOUT',
    ].includes(receipt.diagnostic.code));
  });

  await t.test('hung retry predicate receives its scoped abort', async () => {
    let predicateSignal = null;
    const declared = definition(async ({ paths, step, until }) => {
      await step(paths.list, () => until((signal) => {
        predicateSignal = signal;
        return new Promise(() => {});
      }, 'hung predicate', { timeoutMs: 20 }));
    }, { overallTimeoutMs: 200, cleanupTimeoutMs: 40 });
    const { receipt } = await api.runStarterAcceptance(declared, {
      lifecycle: lifecycle([]),
      emit: false,
    });
    assert.equal(predicateSignal?.aborted, true);
    assert.equal(receipt.diagnostic.code, 'SNAPBACK_STARTER_ACCEPTANCE_RETRY_TIMEOUT');
  });

  await t.test('caller retry signal remains combined with the execution deadline', async () => {
    const callerController = new AbortController();
    let predicateSignal = null;
    let predicateCalls = 0;
    const declared = definition(async ({ paths, step, until }) => {
      await step(paths.list, () => until((signal) => {
        predicateSignal = signal;
        predicateCalls += 1;
        return false;
      }, 'overall-bounded predicate', {
        timeoutMs: 5_000,
        intervalMs: 5,
        signal: callerController.signal,
      }));
    }, { stepTimeoutMs: 5_000, overallTimeoutMs: 100, cleanupTimeoutMs: 25 });
    const { receipt } = await api.runStarterAcceptance(declared, {
      lifecycle: lifecycle([]),
      emit: false,
    });
    const callsAtReturn = predicateCalls;
    const abortedAtReturn = predicateSignal?.aborted;
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
    callerController.abort('test complete');
    assert.equal(receipt.diagnostic.code, 'SNAPBACK_STARTER_ACCEPTANCE_OVERALL_TIMEOUT');
    assert.equal(abortedAtReturn, true);
    assert.equal(predicateCalls, callsAtReturn, 'retry work continued after the runner returned');
  });

  await t.test('hung client inspection is cancelled by disposing the client', async () => {
    let disposed = false;
    const adminClient = {
      inspect() {
        if (disposed) return Promise.resolve({ subscriptions: [] });
        return new Promise(() => {});
      },
      dispose() { disposed = true; },
    };
    const declared = definition(async () => {}, { overallTimeoutMs: 120, cleanupTimeoutMs: 40 });
    const inspectionLifecycle = Object.freeze({
      schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
      async start() {
        return {
          ready: { ready: true, serverUrl: 'http://127.0.0.1:1' },
          adminClient,
        };
      },
      async stop() { return { exited: true }; },
    });
    const { receipt } = await api.runStarterAcceptance(declared, {
      lifecycle: inspectionLifecycle,
      emit: false,
    });
    assert.equal(disposed, true);
    assert.equal(receipt.status, 'failed');
    assert([
      'SNAPBACK_STARTER_ACCEPTANCE_CLIENT_INSPECTION_TIMEOUT',
      'SNAPBACK_STARTER_ACCEPTANCE_OVERALL_TIMEOUT',
    ].includes(receipt.diagnostic.code));
  });

  await t.test('session-mint timeout kills its spawned child', async (testContext) => {
    if (process.platform === 'win32') {
      testContext.skip('fixture executable uses a POSIX shebang');
      return;
    }
    const temporary = mkdtempSync(join(tmpdir(), 'snapback-acceptance-mint-timeout-'));
    try {
      const executable = join(temporary, 'snapback');
      const pidFile = join(temporary, 'mint.pid');
      const quotedPidFile = pidFile.replaceAll("'", "'\"'\"'");
      writeFileSync(executable, `#!/bin/sh
printf '%s' "$$" > '${quotedPidFile}'
while :; do sleep 1; done
`);
      chmodSync(executable, 0o755);
      const declared = definition(async ({ mintSession }) => {
        await mintSession({ email: 'bounded@example.test' });
      }, { stepTimeoutMs: 2_000, overallTimeoutMs: 3_000, cleanupTimeoutMs: 500 });
      const mintLifecycle = Object.freeze({
        schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
        async start() {
          return {
            ready: { ready: true, serverUrl: 'http://127.0.0.1:1' },
            loadedIdentity: { appId: artifacts.appId, bundleHash: artifacts.bundleHash },
            executable,
            readyFile: join(temporary, 'ready.json'),
            adminToken: 'fixture-admin-token',
          };
        },
        async stop() { return { exited: true }; },
      });
      const { receipt } = await api.runStarterAcceptance(declared, {
        lifecycle: mintLifecycle,
        emit: false,
      });
      let pid;
      try {
        pid = Number(readFileSync(pidFile, 'utf8'));
      } catch (error) {
        assert.fail(`session-mint child did not publish its pid: ${error.message}; receipt=${JSON.stringify(receipt)}`);
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          assert.equal(error.code, 'ESRCH');
          break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
        if (attempt === 19) assert.fail(`session-mint child ${pid} survived cancellation`);
      }
      assert.equal(receipt.status, 'failed');
      assert.equal(receipt.diagnostic.code, 'SNAPBACK_STARTER_ACCEPTANCE_SESSION_MINT_TIMEOUT');
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  await t.test('hung cleanup cannot starve managed dev child termination', async (managedChildTest) => {
    if (process.platform === 'win32') {
      managedChildTest.skip('fixture executable uses a POSIX shebang');
      return;
    }

    for (const scenario of [
      {
        name: 'external abort',
        diagnosticCode: 'SNAPBACK_STARTER_ACCEPTANCE_INTERRUPTED',
        abortExternally: true,
      },
      {
        name: 'overall timeout',
        diagnosticCode: 'SNAPBACK_STARTER_ACCEPTANCE_OVERALL_TIMEOUT',
        abortExternally: false,
      },
    ]) {
      await managedChildTest.test(scenario.name, async () => {
        const appRoot = mkdtempSync(join(tmpdir(), `snapback-acceptance-${scenario.name.replace(' ', '-')}-`));
        const pidFile = join(appRoot, 'dev.pid');
        const controller = new AbortController();
        let pid = null;
        try {
          const binRoot = join(appRoot, 'node_modules', '.bin');
          mkdirSync(binRoot, { recursive: true });
          const executable = join(binRoot, 'snapback');
          writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv[2];
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (command === 'wait') {
  fs.writeFileSync(arg('--ready-file'), JSON.stringify({ ready: true, serverUrl: 'http://127.0.0.1:1' }));
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
} else if (command === 'dev') {
  fs.writeFileSync(process.env.SNAPBACK_TEST_DEV_PID_FILE, String(process.pid));
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
`);
          chmodSync(executable, 0o755);
          const managed = api.createManagedDevLifecycleAdapter();
          let cleanupCalls = 0;
          let cleanupSignalAborted = false;
          let stopCalls = 0;
          const managedLifecycle = Object.freeze({
            schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
            async start(input) {
              const state = await managed.start(input);
              return Object.freeze({
                ...state,
                loadedIdentity: Object.freeze({
                  appId: artifacts.appId,
                  bundleHash: artifacts.bundleHash,
                }),
              });
            },
            async stop(state, options) {
              stopCalls += 1;
              return managed.stop(state, options);
            },
          });
          let journeyStarted;
          const started = new Promise((resolveStarted) => { journeyStarted = resolveStarted; });
          const declared = api.defineStarterAcceptance({
            acceptanceFile: import.meta.url,
            appRoot,
            artifacts,
            stepTimeoutMs: 5_000,
            overallTimeoutMs: 1_500,
            cleanupTimeoutMs: 80,
            paths: {
              list: {
                id: 'list-path',
                kind: 'success',
                targetProfileId: 'local-dev-sqlite-ibex',
                operation,
              },
            },
            async journey({ defer, paths, step }) {
              defer((cleanupSignal) => new Promise((resolveCleanup, rejectCleanup) => {
                cleanupCalls += 1;
                const aborted = () => {
                  cleanupSignalAborted = true;
                  rejectCleanup(cleanupSignal.reason);
                };
                cleanupSignal.addEventListener('abort', aborted, { once: true });
                if (cleanupSignal.aborted) aborted();
              }));
              await step(paths.list, (signal) => new Promise((resolveStep, rejectStep) => {
                journeyStarted();
                signal.addEventListener('abort', () => rejectStep(signal.reason), { once: true });
              }));
            },
          });
          const running = api.runStarterAcceptance(declared, {
            lifecycle: managedLifecycle,
            environment: { SNAPBACK_TEST_DEV_PID_FILE: pidFile },
            ...(scenario.abortExternally ? { signal: controller.signal } : {}),
            emit: false,
          });
          await started;
          for (let attempt = 0; attempt < 100 && !existsSync(pidFile); attempt += 1) {
            await new Promise((resolveWait) => setTimeout(resolveWait, 5));
          }
          pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : null;
          if (scenario.abortExternally) controller.abort('SIGTERM');
          const { receipt } = await running;
          assert(Number.isSafeInteger(pid) && pid > 0, 'managed dev child did not publish its pid');
          assert.equal(cleanupCalls, 1);
          assert.equal(cleanupSignalAborted, true);
          assert.equal(stopCalls, 1);
          assert.equal(receipt.status, 'failed');
          assert.equal(receipt.diagnostic.code, scenario.diagnosticCode);
          for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
              process.kill(pid, 0);
            } catch (error) {
              assert.equal(error.code, 'ESRCH');
              break;
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 10));
          }
          assert.throws(
            () => process.kill(pid, 0),
            (error) => error?.code === 'ESRCH',
            `managed dev child ${pid} survived ${scenario.name} cleanup`,
          );
        } finally {
          controller.abort('test cleanup');
          if (Number.isSafeInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch (error) {
              if (error?.code !== 'ESRCH') throw error;
            }
          }
          rmSync(appRoot, { recursive: true, force: true });
        }
      });
    }
  });

  await t.test('hung lifecycle stop receives cleanup abort and returns a bounded receipt', async () => {
    let stopAborted = false;
    const declared = definition(async ({ paths, step }) => {
      await step(paths.list, () => ({ observed: true }));
    }, { overallTimeoutMs: 140, cleanupTimeoutMs: 60 });
    const hungStopLifecycle = Object.freeze({
      schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
      async start() {
        return {
          ready: { ready: true, serverUrl: 'http://127.0.0.1:1' },
          loadedIdentity: { appId: artifacts.appId, bundleHash: artifacts.bundleHash },
        };
      },
      async stop(_state, { signal }) {
        signal.addEventListener('abort', () => { stopAborted = true; }, { once: true });
        return new Promise(() => {});
      },
    });
    const started = Date.now();
    const { receipt } = await api.runStarterAcceptance(declared, {
      lifecycle: hungStopLifecycle,
      emit: false,
    });
    assert(Date.now() - started < 500);
    assert.equal(stopAborted, true);
    assert.equal(receipt.status, 'failed');
    assert([
      'SNAPBACK_STARTER_ACCEPTANCE_LIFECYCLE_STOP_TIMEOUT',
      'SNAPBACK_STARTER_ACCEPTANCE_OVERALL_TIMEOUT',
    ].includes(receipt.diagnostic.code));
  });
});

test('managed lifecycle freezes an event snapshot while later stdout events remain collectable', async (t) => {
  if (process.platform === 'win32') {
    t.skip('fixture executable uses a POSIX shebang');
    return;
  }
  const appRoot = mkdtempSync(join(tmpdir(), 'snapback-acceptance-managed-events-'));
  const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-acceptance-managed-state-'));
  try {
    const binRoot = join(appRoot, 'node_modules', '.bin');
    mkdirSync(binRoot, { recursive: true });
    const executable = join(binRoot, 'snapback');
    writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv[2];
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (command === 'wait') {
  const readyFile = arg('--ready-file');
  fs.writeFileSync(readyFile, JSON.stringify({ ready: true, serverUrl: 'http://127.0.0.1:1' }));
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
} else if (command === 'dev') {
  setTimeout(() => process.stdout.write(JSON.stringify({ schemaVersion: 'snapback.dev.v1', state: 'post-ready' }) + '\\n'), 25);
  process.once('SIGTERM', () => {
    process.stdout.write(JSON.stringify({ schemaVersion: 'snapback.dev.v1', state: 'server-exited' }) + '\\n');
    setTimeout(() => process.exit(0), 5);
  });
}
`);
    chmodSync(executable, 0o755);
    const adapter = api.createManagedDevLifecycleAdapter();
    const controller = new AbortController();
    const state = await adapter.start({
      appRoot,
      stateRoot,
      readinessTimeoutMs: 1_000,
      environment: process.env,
      signal: controller.signal,
    });
    assert.equal(Object.isFrozen(state.lifecycleEvents), true);
    const snapshotLength = state.lifecycleEvents.length;
    await new Promise((resolveWait) => setTimeout(resolveWait, 60));
    assert.equal(state.lifecycleEvents.length, snapshotLength);
    assert.deepEqual(await adapter.stop(state, { signal: controller.signal }), { exited: true });
  } finally {
    rmSync(appRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('stale generated operation identity yields the bounded refresh remediation', async () => {
  const staleOperation = Object.freeze({
    ...operation,
    id: 'fixture:removed',
    name: 'removed',
  });
  const declared = definition(
    async ({ paths, step }) => step(paths.list, () => ({ observed: true })),
    { operation: staleOperation },
  );
  const { receipt } = await api.runStarterAcceptance(declared, {
    lifecycle: lifecycle([]),
    emit: false,
  });
  const profile = api.starterVerifyProfileOptions(declared, { id: 'fixture-live' });
  const admission = api.validatePassingStarterReceipt(receipt, profile.paths, {
    manifests: { functions: { functions: [{ id: operation.id }] } },
  });
  assert.equal(admission.complete, false);
  assert.equal(admission.remediation.kind, 'refresh-generated-operation-registration');
  assert.deepEqual(admission.remediation.staleRegistrationPaths, [{
    pathId: 'list-path',
    pathIdTruncated: false,
    functionId: staleOperation.id,
    functionIdTruncated: false,
  }]);
});

// @ref LLP 0275#d6-treat-template-cold-install-closure-as-a-release-requirement — this
// regression proves receipt-shape compatibility is isolated in the package and
// verifier; app sources retain only generated identities and product meaning.
test('template apps delegate receipt projection and admission to package entrypoints', () => {
  const templateRoot = join(workspaceRoot, 'packages', 'snapback-cli', 'templates');
  for (const template of ['react', 'crud-dashboard', 'media-feed', 'expo-chat']) {
    const source = readFileSync(join(templateRoot, template, 'acceptance.mjs'), 'utf8');
    assert.match(source, /from '@expo\/snapback-acceptance'/);
    assert.match(source, /defineStarterAcceptance/);
  }
  const verifier = readFileSync(join(
    workspaceRoot,
    'packages',
    'snapback-cli',
    'verify.mjs',
  ), 'utf8');
  assert.match(verifier, /validatePassingStarterReceiptFromPackage/);
  assert.match(verifier, /parseStarterAcceptanceReceiptFromPackage/);
  assert.match(verifier, /starterConformanceProjection/);
});

test('package-only receipt schema evolution admits unchanged application source', () => {
  const evolutionRoot = mkdtempSync(join(tmpdir(), 'snapback-acceptance-evolution-'));
  try {
    const installedPackage = join(
      fixtureRoot,
      'node_modules',
      '@expo',
      'snapback-acceptance',
    );
    const evolvedPackage = join(
      evolutionRoot,
      'node_modules',
      '@expo',
      'snapback-acceptance',
    );
    mkdirSync(dirname(evolvedPackage), { recursive: true });
    cpSync(installedPackage, evolvedPackage, { recursive: true });
    writeFileSync(join(evolutionRoot, 'package.json'), '{"type":"module"}\n');
    const appSource = `
import {
  defineStarterAcceptance,
} from '@expo/snapback-acceptance';

const artifacts = Object.freeze(${JSON.stringify(artifacts)});
const operation = Object.freeze(${JSON.stringify(operation)});
export const acceptance = defineStarterAcceptance({
  acceptanceFile: import.meta.url,
  appRoot: import.meta.dirname,
  artifacts,
  overallTimeoutMs: 1000,
  cleanupTimeoutMs: 200,
  paths: {
    list: {
      id: 'list-path',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation,
    },
  },
  async journey({ paths, step }) {
    await step(paths.list, () => ({ applicationAssertion: true }));
  },
});
`;
    const appPath = join(evolutionRoot, 'acceptance.mjs');
    writeFileSync(appPath, appSource);
    const appHashBefore = createHash('sha256').update(readFileSync(appPath)).digest('hex');

    const mutatedApplicationPath = join(evolutionRoot, 'mutated-application.mjs');
    writeFileSync(mutatedApplicationPath, `
import { runStarterAcceptance } from '@expo/snapback-acceptance';
import { acceptance } from './acceptance.mjs';
const lifecycle = Object.freeze({
  schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
  async start() {
    return Object.freeze({
      ready: Object.freeze({ ready: true, serverUrl: 'http://127.0.0.1:1' }),
      loadedIdentity: Object.freeze({
        appId: acceptance.artifacts.appId,
        bundleHash: acceptance.artifacts.bundleHash,
      }),
    });
  },
  async stop() { return Object.freeze({ exited: true }); },
});
const { receipt } = await runStarterAcceptance(acceptance, { lifecycle, emit: false });
const field = 'compatibility' + 'Epoch';
process.stdout.write(JSON['string' + 'ify']({ ...receipt, [field]: 2 }) + '\\n');
`);
    const mutatedStdout = execFileSync(process.execPath, [mutatedApplicationPath], {
      cwd: evolutionRoot,
      encoding: 'utf8',
    });
    const mutatedParsed = api.parseStarterAcceptanceReceipt(mutatedStdout);
    const mutatedAdmission = api.validatePassingStarterReceipt(
      mutatedParsed.receipt,
      [{
        id: 'list-path',
        kind: 'success',
        targetProfileId: 'local-dev-sqlite-ibex',
        functionId: operation.id,
      }],
      {
        ...artifacts,
        manifests: { functions: { functions: [{ id: operation.id }] } },
      },
    );
    assert.equal(mutatedAdmission.complete, false);
    assert(mutatedAdmission.invalidPaths.some(({ path, expected, observed }) => (
      path === '$.compatibilityEpoch'
        && expected.state === 'package-projector-owned-fields-only'
        && observed.state === 'unexpected-field'
    )), JSON.stringify(mutatedAdmission.invalidPaths));

    const packageIndex = join(evolvedPackage, 'index.mjs');
    const originalPackageSource = readFileSync(packageIndex, 'utf8');
    const evolvedPackageSource = originalPackageSource
      .replace(
        '    schemaVersion: STARTER_ACCEPTANCE_SCHEMA_VERSION,\n    status:',
        '    schemaVersion: STARTER_ACCEPTANCE_SCHEMA_VERSION,\n    compatibilityEpoch: 2,\n    status:',
      )
      .replace(
        "  'schemaVersion',\n  'status',",
        "  'schemaVersion',\n  'compatibilityEpoch',\n  'status',",
      )
      .replace(
        '  const expectedCheckCount = requireLiteral(',
        `  requireLiteral(
    '$.compatibilityEpoch', receipt, 'compatibilityEpoch', 'integer', '2',
    (value) => value === 2,
  );

  const expectedCheckCount = requireLiteral(`,
      );
    assert.notEqual(evolvedPackageSource, originalPackageSource);
    assert.match(evolvedPackageSource, /compatibilityEpoch: 2/u);
    writeFileSync(packageIndex, evolvedPackageSource);

    const runnerPath = join(evolutionRoot, 'runner.mjs');
    writeFileSync(runnerPath, `
import { runStarterAcceptance } from '@expo/snapback-acceptance';
import { acceptance } from './acceptance.mjs';
const lifecycle = Object.freeze({
  schemaVersion: 'snapback.starter-lifecycle-adapter.v1',
  async start() {
    return Object.freeze({
      ready: Object.freeze({ ready: true, serverUrl: 'http://127.0.0.1:1' }),
      loadedIdentity: Object.freeze({
        appId: acceptance.artifacts.appId,
        bundleHash: acceptance.artifacts.bundleHash,
      }),
    });
  },
  async stop() { return Object.freeze({ exited: true }); },
});
await runStarterAcceptance(acceptance, { lifecycle, emit: true });
`);
    const receiptStdout = execFileSync(process.execPath, [runnerPath], {
      cwd: evolutionRoot,
      encoding: 'utf8',
    });
    const verifierPath = join(evolutionRoot, 'verifier.mjs');
    writeFileSync(verifierPath, `
import {
  parseStarterAcceptanceReceipt,
  validatePassingStarterReceipt,
} from '@expo/snapback-acceptance';
import { acceptance } from './acceptance.mjs';
let stdout = '';
for await (const chunk of process.stdin) stdout += chunk;
const parsed = parseStarterAcceptanceReceipt(stdout);
const paths = Object.values(acceptance.paths).map(({ id, kind, targetProfileId, functionId }) => ({
  id, kind, targetProfileId, functionId,
}));
const admission = validatePassingStarterReceipt(parsed.receipt, paths, {
  identity: acceptance.artifacts,
  manifests: { functions: { functions: [{ id: ${JSON.stringify(operation.id)} }] } },
});
process.stdout.write(JSON.stringify({ receipt: parsed.receipt, admission }));
`);
    const verified = JSON.parse(execFileSync(process.execPath, [verifierPath], {
      cwd: evolutionRoot,
      encoding: 'utf8',
      input: receiptStdout,
    }));
    assert(verified.receipt, JSON.stringify({ receiptStdout, verified }));
    assert.equal(verified.receipt.compatibilityEpoch, 2);
    assert.equal(verified.admission.complete, true, JSON.stringify(verified.admission.invalidPaths));
    const appHashAfter = createHash('sha256').update(readFileSync(appPath)).digest('hex');
    assert.equal(appHashAfter, appHashBefore, 'application source changed during package schema evolution');
  } finally {
    rmSync(evolutionRoot, { recursive: true, force: true });
  }
});

test('tarball-installed declarations compile against the real client and verifier types', () => {
  writeFileSync(join(fixtureRoot, 'package.json'), '{"type":"module"}\n');
  const consumer = join(fixtureRoot, 'types-consumer.ts');
  writeFileSync(consumer, `
import {
  starterVerifyProfileOptions,
  type StarterAcceptanceDefinition,
  type StarterJourneyContext,
} from '@expo/snapback-acceptance';
import {
  createSnapbackAppClient,
  type SnapbackApplicationDescriptorV1,
  type SnapbackAppBindingV1,
  type SnapbackAppClientPlatform,
} from '@expo/snapback-client';
import {
  defineStarterVerifyProfile,
  type StarterVerifyProfileOptions,
} from '@expo/snapback-cli/verify';

declare const context: StarterJourneyContext;
declare const app: SnapbackApplicationDescriptorV1;
declare const acceptance: StarterAcceptanceDefinition;
const binding: SnapbackAppBindingV1 = context.bindingFor(app);
const platform: SnapbackAppClientPlatform = 'memory';
void createSnapbackAppClient({ app, binding, platform });
const profile: StarterVerifyProfileOptions = starterVerifyProfileOptions(acceptance, {
  id: 'typed-consumer',
});
defineStarterVerifyProfile(profile);
`);
  const tsconfig = join(fixtureRoot, 'tsconfig.json');
  // The acceptance declaration comes from its installed tarball; resolve its
  // peer imports to the real published declaration entrypoints, never ambient
  // synthetic module declarations.
  writeFileSync(tsconfig, `${JSON.stringify({
    compilerOptions: {
      noEmit: true,
      strict: true,
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM'],
      baseUrl: fixtureRoot,
      paths: {
        '@expo/snapback-client': [join(workspaceRoot, 'packages', 'snapback-client', 'index.d.mts')],
        '@expo/snapback-contract/*': [join(workspaceRoot, 'packages', 'snapback-contract', '*.d.mts')],
        '@expo/snapback-cli/verify': [join(workspaceRoot, 'packages', 'snapback-cli', 'verify.d.mts')],
      },
    },
    files: [consumer],
  }, null, 2)}\n`);
  execFileSync(join(workspaceRoot, 'node_modules', '.bin', 'tsc'), [
    '--project', tsconfig,
  ], { cwd: fixtureRoot, encoding: 'utf8', stdio: 'pipe' });
});
