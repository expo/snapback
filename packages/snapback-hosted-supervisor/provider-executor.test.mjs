import assert from 'node:assert/strict';

import {
  PROVIDER_LIFECYCLE_OPERATIONS,
  PROVIDER_OPERATION_BLOCKERS,
  __providerExecutorTest,
  createFlyTigrisProviderExecutor,
} from './provider-executor.mjs';
import {
  canonicalJson,
  lifecycleRequestDigest,
  semanticEffectId,
  sha256,
} from './index.mjs';

const digest = (value) => sha256(Buffer.from(value));
const binding = {
  schemaVersion: 'snapback.fly-target-binding.v2',
  targetId: 'target-a',
  bindingGeneration: 1,
  predecessorBindingSha256: null,
  organizationId: 'organization-a',
  appId: 'app-a',
  region: 'sjc',
  publicOrigin: 'https://app-a.example.test',
  activeMachineId: 'machine-a',
  machineRoster: ['machine-a'],
  routedMachineIds: ['machine-a'],
  serviceProcessGroups: ['app'],
  autostopEnabled: false,
  autostartEnabled: true,
  autoscaleEnabled: false,
  volumeId: 'volume-a',
  ociRepository: 'registry.fly.io/app-a',
  ociDigest: digest('image-a'),
  tigrisBucket: 'bucket-a',
  artifactPrefix: 'target-a/artifacts/',
  backupPrefix: 'target-a/backups/',
  controlStatePrefix: 'target-a/control/',
  auditPrefix: 'target-a/audit/',
  logPrefix: 'target-a/logs/',
  cleanupPrefix: 'target-a/cleanup/',
  tlsIssuer: 'letsencrypt-staging',
  certificatePosture: 'same-volume-loopback-caddy',
  externalHeadKey: 'target-a/control/head.json',
  ownershipSentinel: 'sentinel-a',
  supervisorInstallationId: 'installation-a',
  supervisorOciDigest: digest('supervisor-a'),
  credentials: [],
  observedAtMs: 1,
  expiresAtMs: 1_900_000_000_000,
};
const head = {
  schemaVersion: 'snapback.hosted-control-head.v2',
  targetId: binding.targetId,
  generation: 4,
  bindingSha256: __providerExecutorTest.bindingSha256(binding),
  activationGeneration: 2,
  activeReleaseId: digest('release-a'),
  journalRootSha256: digest('journal-a'),
  admissionGeneration: 3,
  spendFloor: 1,
  cleanupFloor: 1,
  replayFloor: 1,
  supervisorIncarnation: 'incarnation-a',
  predecessorSha256: digest('head-before-a'),
  committedAtMs: 1_800_000_000_000,
};
const machine = {
  id: binding.activeMachineId,
  instance_id: 'machine-version-a',
  state: 'started',
  region: binding.region,
  config: {
    image: `${binding.ociRepository}@${binding.ociDigest}`,
    mounts: [{ volume: binding.volumeId }],
    services: [{
      processes: ['app'],
      autostop: false,
      autostart: true,
    }],
  },
};

function lifecycleRequest(operation) {
  const request = {
    schemaVersion: 'snapback.vm-adapter-lifecycle-request.v2',
    operation,
    operationId: `operation-${operation}`,
    attempt: 0,
    targetBinding: binding,
    planSha256: digest(`plan-${operation}`),
    requestSha256: digest(`request-${operation}`),
    predecessorHead: head,
    effectIntent: {
      schemaVersion: 'snapback.provider-effect-intent.v1',
      operationId: `operation-${operation}`,
      operation,
      requestSha256: digest(`request-${operation}`),
      semanticEffectId: `effect-${operation}`,
      targetBindingSha256: __providerExecutorTest.bindingSha256(binding),
      planSha256: digest(`plan-${operation}`),
      effectKind: operation === 'releaseLease' ? 'release' : 'fixture',
      logicalResourceName: 'machine',
      desiredProviderStateSha256: digest(`desired-${operation}`),
      predecessorHeadSha256: __providerExecutorTest.headSha256(head),
    },
    lease: operation === 'releaseLease' ? {
      leaseId: 'lease-a',
      targetId: binding.targetId,
      operationId: 'operation-acquireLease',
      expectedActivationGeneration: head.activationGeneration,
      acquiredAtMs: 1_800_000_000_000,
      expiresAtMs: 1_800_000_060_000,
    } : null,
    confirmationSha256: null,
  };
  request.effectIntent.semanticEffectId = semanticEffectId({
    operationId: request.effectIntent.operationId,
    operation: request.effectIntent.operation,
    targetBindingDigest: request.effectIntent.targetBindingSha256,
    planDigest: request.effectIntent.planSha256,
    effectKind: request.effectIntent.effectKind,
    logicalResourceName: request.effectIntent.logicalResourceName,
    desiredProviderStateSha256: request.effectIntent.desiredProviderStateSha256,
  });
  request.requestSha256 = lifecycleRequestDigest(request);
  request.effectIntent.requestSha256 = request.requestSha256;
  assert.deepEqual(Object.keys(request).sort(), [...__providerExecutorTest.REQUEST_KEYS].sort());
  return request;
}

function fixture({ driftRoster = false, driftHead = false } = {}) {
  let rosterReads = 0;
  let headReads = 0;
  let leaseOpen = true;
  let effectArmed = false;
  let authorityCalls = 0;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ url, method, effectArmed });
    if (url.endsWith('/machines')) {
      rosterReads += 1;
      return new Response(JSON.stringify(
        driftRoster && rosterReads % 2 === 0 ? [machine, { ...machine, id: 'machine-b' }] : [machine],
      ), { status: 200 });
    }
    if (url.endsWith('/lease') && method === 'GET') {
      if (!leaseOpen) return new Response('{"error":"not found"}', { status: 404 });
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          nonce: 'lease-a',
          expires_at: 1_800_000_060,
          version: 'lease-version-a',
        },
      }), { status: 200 });
    }
    if (url.endsWith('/lease') && method === 'DELETE') {
      assert.equal(effectArmed, true, 'effect journal hook must commit before provider DELETE');
      assert.equal(options.headers['fly-machine-lease-nonce'], 'lease-a');
      leaseOpen = false;
      return new Response('{"status":"success","data":{"ok":true}}', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  const readTigrisControlHead = async () => {
    authorityCalls += 1;
    headReads += 1;
    return {
      bytes: Buffer.from(canonicalJson(
        driftHead && headReads % 2 === 0 ? { ...head, generation: 5 } : head,
      )),
      version: driftHead && headReads % 2 === 0 ? 'etag-b' : 'etag-a',
    };
  };
  const executor = createFlyTigrisProviderExecutor({
    fetchImpl,
    flyApiBase: 'http://provider.fixture',
    resolveFlyControlToken: async () => {
      authorityCalls += 1;
      return 'secret-token-never-returned';
    },
    readTigrisControlHead,
    now: () => 1_800_000_000_000,
  });
  return {
    calls,
    authorityCalls: () => authorityCalls,
    executor,
    arm() { effectArmed = true; },
  };
}

assert.equal(PROVIDER_LIFECYCLE_OPERATIONS.length, 17);
assert.equal(new Set(PROVIDER_LIFECYCLE_OPERATIONS).size, 17);
assert.deepEqual(
  Object.keys(PROVIDER_OPERATION_BLOCKERS).sort(),
  PROVIDER_LIFECYCLE_OPERATIONS.slice().sort(),
);

for (const operation of PROVIDER_LIFECYCLE_OPERATIONS) {
  const run = fixture();
  const { calls, executor } = run;
  const response = await executor.execute(lifecycleRequest(operation));
  assert.equal(response.operation, operation);
  assert.equal(response.ok, false);
  assert.equal(response.terminal.outcome, 'notApplied');
  assert.equal(response.terminal.reason, 'closedCarrierPrerequisiteMissing');
  assert.equal(calls.length, 0, 'carrier-incomplete operations must not touch Fly');
  assert.equal(run.authorityCalls(), 0, 'carrier-incomplete operations must not resolve credentials or read Tigris');
  assert(!canonicalJson(response).includes('secret-token-never-returned'));
}

{
  const run = fixture();
  const request = lifecycleRequest('releaseLease');
  request.effectIntent.logicalResourceName = 'another-machine';
  await assert.rejects(
    () => run.executor.execute(request),
    { code: 'SNAPBACK_HOSTED_LIFECYCLE_DIGEST_DRIFT' },
  );
  assert.equal(run.calls.length, 0);
  assert.equal(run.authorityCalls(), 0);
}

console.log('Fly/Tigris provider executor tests passed');
