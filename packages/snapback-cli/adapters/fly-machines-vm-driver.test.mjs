// Hermetic driver-protocol tests for the Fly Machines vm driver. They spawn
// the driver executable directly (the control plane's allowlisted adapter
// environment can never set the test-base opt-in, which is itself the
// honesty invariant asserted below) against a local mock provider.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const driverPath = join(here, 'fly-machines-vm-driver.mjs');

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const machine = { id: '849764f2e7dd58', state: 'started', region: 'sjc' };
const events = [
  { id: 'ev1', type: 'start', status: 'started', source: 'flyd', timestamp: 1_000 },
  { id: 'ev2', type: 'exit', status: 'stopped', source: 'flyd', timestamp: 2_000 },
];
let includeSecondMachine = false;
let leaseActive = false;
const server = createServer((request, response) => {
  if (request.headers.authorization !== 'Bearer test-token') {
    response.writeHead(401).end('{"error":"unauthorized"}');
    return;
  }
  if (request.url === '/v1/apps/snapback-drill') {
    response.end(JSON.stringify({ name: 'snapback-drill', organization: { slug: 'personal' } }));
  } else if (request.url === '/v1/apps/snapback-drill/machines') {
    response.end(JSON.stringify(includeSecondMachine
      ? [machine, { id: 'second-machine', state: 'stopped', region: 'sjc' }]
      : [machine]));
  } else if (
    request.url === '/v1/apps/snapback-drill/machines/849764f2e7dd58/lease'
    && request.method === 'POST'
  ) {
    if (leaseActive) {
      response.writeHead(409).end('{"error":"lease exists"}');
    } else {
      leaseActive = true;
      response.writeHead(201).end(JSON.stringify({
        status: 'success',
        data: { nonce: 'fixture-lease-nonce', expires_at: Math.floor(Date.now() / 1000) + 60 },
      }));
    }
  } else if (
    request.url === '/v1/apps/snapback-drill/machines/849764f2e7dd58/lease'
    && request.method === 'DELETE'
  ) {
    if (request.headers['fly-machine-lease-nonce'] !== 'fixture-lease-nonce') {
      response.writeHead(400).end('{"error":"wrong nonce"}');
    } else {
      leaseActive = false;
      response.end('{"status":"success","data":{"ok":true}}');
    }
  } else if (request.url === '/v1/apps/snapback-drill/machines/849764f2e7dd58/events') {
    response.end(JSON.stringify(events));
  } else {
    response.writeHead(404).end('{}');
  }
});
await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;

const target = {
  schemaVersion: 'snapback.target-descriptor.v1',
  targetId: 'fly-snapback-drill-sjc',
  projectId: 'competitive-checkpoint',
  environmentId: 'drill',
  deploymentId: 'fly-machine-849764f2e7dd58',
  databaseId: 'drill-sqlite3',
  streamIncarnation: 'drill-v0',
  targetProfileId: 'single-instance-container-vm.v1',
  productionClass: 'preview',
  createdAtMs: 1,
  adapter: {
    kind: 'singleInstanceContainerVm',
    version: '0.1.0',
    driverPath,
    driverSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    provider: 'fly-machines',
    accountFingerprint: 'fly-org-personal',
    region: 'sjc',
    // The app name derives from the origin host's first label; the .invalid
    // TLD guarantees the TLS probe fails fast, so state maps to degraded —
    // asserted below, which also witnesses the degraded mapping.
    publicOrigin: 'https://snapback-drill.drill-origin.invalid',
    credentialRef: 'secret-store://env/TEST_FLY_TOKEN',
    stateStoreRef: 'provider-secret://fly/unset',
  },
};

// Async spawn: a synchronous spawn would block this process's event loop and
// starve the in-process mock provider the child is fetching from.
function runDriver(request, env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [driverPath], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SNAPBACK_VM_DRIVER_ALLOW_TEST_BASE: '1',
        SNAPBACK_VM_DRIVER_TEST_BASE: base,
        TEST_FLY_TOKEN: 'test-token',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (status) => { clearTimeout(timer); resolvePromise({ status, stdout, stderr }); });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

// 1. doctor: live read-back echoes identity, maps started+TLS-failed to
//    degraded, derives the account fingerprint from the provider org.
{
  const request = { schemaVersion: 'snapback.vm-adapter-request.v1', operation: 'doctor', operationId: 'op-doctor-1', target };
  const child = await runDriver(request);
  assert.equal(child.status, 0, child.stderr);
  const response = JSON.parse(child.stdout);
  assert.equal(response.schemaVersion, 'snapback.vm-adapter-response.v1');
  assert.equal(response.operationId, 'op-doctor-1');
  assert.equal(response.ok, true);
  assert.equal(response.observation.resourceId, '849764f2e7dd58');
  assert.equal(response.observation.state, 'degraded');
  assert.equal(response.observation.accountFingerprint, 'fly-org-personal');
  assert.equal(response.observation.credentialStatus, 'ready');
  assert.equal(response.observation.activeReleaseId, null);
  assert.ok(response.observation.capabilityGaps.includes('control-plane.lifecycle-train'));
  assert.ok(/^sha256:[0-9a-f]{64}$/.test(response.observation.providerFactsSha256));
  assert.ok(response.diagnostics.some((d) => d.code === 'SNAPBACK_ADAPTER_ORIGIN_TLS_DEGRADED'));
}

// 2. Missing credential resolves fail-closed, in protocol.
{
  const request = { schemaVersion: 'snapback.vm-adapter-request.v1', operation: 'doctor', operationId: 'op-doctor-2', target };
  const child = await runDriver(request, { TEST_FLY_TOKEN: '' });
  assert.equal(child.status, 0, child.stderr);
  const response = JSON.parse(child.stdout);
  assert.equal(response.ok, false);
  assert.equal(response.observation, null);
  assert.ok(response.diagnostics.some((d) => d.code === 'SNAPBACK_ADAPTER_CREDENTIAL_UNAVAILABLE'));
}

// 3. Rejected credential is 'invalid', in protocol.
{
  const request = { schemaVersion: 'snapback.vm-adapter-request.v1', operation: 'inspect', operationId: 'op-inspect-1', target };
  const child = await runDriver(request, { TEST_FLY_TOKEN: 'wrong-token' });
  const response = JSON.parse(child.stdout);
  assert.equal(response.ok, false);
  assert.ok(response.diagnostics.some((d) => d.code === 'SNAPBACK_ADAPTER_CREDENTIAL_REJECTED'));
}

// 4. logs query: closed page shape, bounded entries, digest chain — and the
//    HONESTY INVARIANT: under a non-canonical provider base the response must
//    say remoteEvidence:false with no attestation, so a fixture run can never
//    mint hosted evidence.
{
  const request = {
    schemaVersion: 'snapback.vm-adapter-query-request.v1',
    operation: 'logs',
    operationId: 'op-logs-1',
    target,
    query: { sinceMs: 0, untilMs: 5_000, limit: 10, cursor: null },
  };
  const child = await runDriver(request);
  assert.equal(child.status, 0, child.stderr);
  const response = JSON.parse(child.stdout);
  assert.equal(response.ok, true);
  assert.equal(response.remoteEvidence, false);
  assert.deepEqual(response.evidence, []);
  assert.equal(response.logs.entries.length, 2);
  assert.equal(response.logs.entries[0].eventCode, 'fly-machine-start');
  assert.equal(response.logs.entries[1].severity, 'warning');
  assert.equal(response.logs.droppedEvents, 0);
  const expectedInput = sha256(Buffer.from(`snapback-vm-adapter-query-input-v1\0${canonicalJson(request)}`));
  assert.equal(response.inputSha256, expectedInput);
  const { outputSha256, ...content } = response;
  assert.equal(outputSha256, sha256(Buffer.from(`snapback-vm-adapter-query-output-v1\0${canonicalJson(content)}`)));
  // Window filtering.
  const narrow = await runDriver({ ...request, operationId: 'op-logs-2', query: { sinceMs: 1_500, untilMs: 5_000, limit: 10, cursor: null } });
  assert.equal(JSON.parse(narrow.stdout).logs.entries.length, 1);
}

// The complete V2 lifecycle vocabulary is packaged now, but no new effect is
// implied by that packaging. Every V2 request receives a structured
// notApplied terminal until the standing-supervisor executor owns it.
{
  const request = {
    schemaVersion: 'snapback.vm-adapter-lifecycle-request.v2',
    operation: 'provisionInactive',
    operationId: 'op-v2-refusal',
    requestSha256: `sha256:${'1'.repeat(64)}`,
    effectIntent: { semanticEffectId: 'effect-v2-refusal' },
    predecessorHead: {
      schemaVersion: 'snapback.hosted-control-head.v2',
      targetId: target.targetId,
      generation: 0,
      bindingSha256: `sha256:${'2'.repeat(64)}`,
      activationGeneration: 0,
      activeReleaseId: null,
      journalRootSha256: `sha256:${'3'.repeat(64)}`,
      admissionGeneration: 0,
      spendFloor: 0,
      cleanupFloor: 0,
      replayFloor: 0,
      supervisorIncarnation: 'fixture-supervisor',
      predecessorSha256: null,
      committedAtMs: 1,
    },
  };
  const child = await runDriver(request);
  assert.equal(child.status, 0, child.stderr);
  const response = JSON.parse(child.stdout);
  assert.equal(response.schemaVersion, 'snapback.vm-adapter-lifecycle-response.v2');
  assert.equal(response.ok, false);
  assert.equal(response.remoteEvidence, false);
  assert.equal(response.terminal.outcome, 'notApplied');
  assert.equal(response.terminal.semanticEffectId, 'effect-v2-refusal');
  assert.equal(response.controlHead.targetId, target.targetId);
  assert.ok(response.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_HOSTED_SUPERVISOR_EXECUTOR_UNAVAILABLE',
  ));
}

// 5. inspectAdmin refuses in protocol (recorded remaining surface).
{
  const request = {
    schemaVersion: 'snapback.vm-adapter-query-request.v1',
    operation: 'inspectAdmin',
    operationId: 'op-inspect-admin-1',
    target,
    query: { sinceMs: 0, untilMs: 5_000, limit: 10, cursor: null },
  };
  const response = JSON.parse((await runDriver(request)).stdout);
  assert.equal(response.ok, false);
  assert.ok(response.diagnostics.some((d) => d.code === 'SNAPBACK_ADAPTER_INSPECTION_UNAVAILABLE'));
}

// 6. The two exact provider lease operations work against the fixture but can
// never mint remote evidence from its noncanonical base. Every remaining
// lifecycle spelling refuses in protocol.
{
  const acquireRequest = {
    schemaVersion: 'snapback.vm-adapter-lifecycle-request.v1',
    operation: 'acquireLease',
    operationId: 'op-lease',
    attempt: 1,
    target,
    plan: {},
    releaseDirectory: '',
    lease: null,
  };
  const acquired = JSON.parse((await runDriver(acquireRequest)).stdout);
  assert.equal(acquired.ok, true);
  assert.equal(acquired.remoteEvidence, false);
  assert.equal(acquired.lease.leaseId, 'fixture-lease-nonce');
  const conflict = JSON.parse((await runDriver({ ...acquireRequest, operationId: 'op-lease-conflict' })).stdout);
  assert.equal(conflict.ok, false);
  assert.ok(conflict.diagnostics.some((d) => d.code === 'SNAPBACK_DEPLOY_LEASE_CONFLICT'));
  const released = JSON.parse((await runDriver({
    ...acquireRequest,
    operation: 'releaseLease',
    lease: acquired.lease,
  })).stdout);
  assert.equal(released.ok, true);
  assert.equal(released.lease, null);
  const unsupported = JSON.parse((await runDriver({
    ...acquireRequest,
    operation: 'activateGeneration',
  })).stdout);
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.diagnostics.some((d) => d.code === 'SNAPBACK_ADAPTER_OPERATION_UNSUPPORTED'));

  includeSecondMachine = true;
  const unsafe = JSON.parse((await runDriver({
    schemaVersion: 'snapback.vm-adapter-request.v1',
    operation: 'doctor',
    operationId: 'op-unsafe-roster',
    target,
  })).stdout);
  assert.equal(unsafe.ok, false);
  assert.ok(unsafe.diagnostics.some((d) => d.code === 'SNAPBACK_EPHEMERAL_ROUTING_UNSAFE'));
  includeSecondMachine = false;

  const malformed = spawnSync(process.execPath, [driverPath], { input: 'not json\n', encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH } });
  assert.equal(malformed.status, 3);
}

server.close();
console.log('fly-machines-vm-driver.test.mjs: all cases passed');
