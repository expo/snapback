import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  api = await import(pathToFileURL(join(
    fixtureRoot,
    'node_modules',
    '@expo',
    'snapback-acceptance',
    'index.mjs',
  )).href);
});

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

const artifacts = Object.freeze({
  artifactKind: 'artifactIndex',
  appId: 'fixture-app',
  bundleHash: 'fixture-bundle',
});
const operation = Object.freeze({ id: 'fixture:list', name: 'list', kind: 'query' });

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
  assert.deepEqual(events, ['start', 'cleanup-second', 'cleanup-first', 'stop']);
  const profile = api.starterVerifyProfileOptions(declared, { id: 'fixture-live' });
  assert.equal(profile.acceptanceFile, fileURLToPath(import.meta.url));
  const admission = api.validatePassingStarterReceipt(receipt, profile.paths, {
    manifests: { functions: { functions: [{ id: operation.id }] } },
  });
  assert.equal(admission.complete, true, JSON.stringify(admission.invalidPaths));
  assert.deepEqual(admission.observedPathIds, ['list-path', 'delivery-path']);
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

test('stale generated operation identity yields the bounded refresh remediation', async () => {
  const staleOperation = Object.freeze({ id: 'fixture:removed', name: 'removed', kind: 'query' });
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
test('verifier receipt-field changes do not require app-source edits', () => {
  const templateRoot = join(workspaceRoot, 'packages', 'snapback-cli', 'templates');
  for (const template of ['react', 'crud-dashboard', 'media-feed', 'expo-chat']) {
    const source = readFileSync(join(templateRoot, template, 'acceptance.mjs'), 'utf8');
    assert.match(source, /from '@expo\/snapback-acceptance'/);
    assert.match(source, /defineStarterAcceptance/);
    assert.doesNotMatch(
      source,
      /snapback\.starter-acceptance\.v1|expectedCheckCount|executedCheckCount|JSON\.stringify\(receipt\)/,
      `${template} must not assemble verifier receipt fields`,
    );
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
