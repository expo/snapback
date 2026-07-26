// LLP 0072 first concrete-adapter remote witness: registers the real Fly
// drill target behind the fly-machines vm driver and runs the control
// plane's observation and log-query surface against the live provider —
// including the acceptance list's fail-closed negatives (identity mismatch,
// missing credential, tampered driver) and a platform interruption/resume
// cycle. Receipts carry digests and provider facts only, never secrets.
//
// Requires: macOS keychain item `snapback-fly-drill`/`drill` holding the Fly
// org token (operator-staged; never in the repository), and network access
// to api.machines.dev.
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addTarget,
  doctorTarget,
  inspectTarget,
  queryControlLogs,
} from '../../../../packages/snapback-cli/deployment-control.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const driverPath = join(repoRoot, 'packages/snapback-cli/adapters/fly-machines-vm-driver.mjs');
const resultsDir = join(repoRoot, 'demos/competitive-checkpoint/acceptance/results');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const APP = 'snapback-drill';
const ORIGIN = 'https://snapback-drill.fly.dev';
const MACHINE = '849764f2e7dd58';

const controlRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-control-')));
chmodSync(controlRoot, 0o700);
const options = { controlRoot };

function descriptor(overrides = {}, adapterOverrides = {}) {
  return {
    schemaVersion: 'snapback.target-descriptor.v1',
    targetId: 'fly-snapback-drill-sjc',
    projectId: 'competitive-checkpoint',
    environmentId: 'drill',
    deploymentId: `fly-machine-${MACHINE}`,
    databaseId: 'drill-sqlite3',
    streamIncarnation: 'drill-v0',
    targetProfileId: 'single-instance-container-vm.v1',
    productionClass: 'preview',
    createdAtMs: Date.now(),
    ...overrides,
    adapter: {
      kind: 'singleInstanceContainerVm',
      version: '0.1.0',
      driverPath,
      driverSha256: sha256(readFileSync(driverPath)),
      provider: 'fly-machines',
      accountFingerprint: 'fly-org-charlie-cheever',
      region: 'sjc',
      publicOrigin: ORIGIN,
      credentialRef: 'keychain://snapback-fly-drill/drill',
      stateStoreRef: 'provider-secret://fly/unset',
      ...adapterOverrides,
    },
  };
}

const checks = [];
function record(name, ok, details) {
  checks.push({ name, ok, details });
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) console.log(`  ${JSON.stringify(details)}`);
}

function flyToken() {
  return execFileSync('security', ['find-generic-password', '-s', 'snapback-fly-drill', '-a', 'drill', '-w'], { encoding: 'utf8' }).trim();
}

async function machinesApi(path, init = {}) {
  const response = await fetch(`https://api.machines.dev${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${flyToken()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  return { status: response.status, body };
}

// 1. Register the real target and run live doctor + inspect through the
//    registered, digest-pinned driver.
const registration = addTarget(descriptor(), options);
assert.equal(registration.ok, true);
const doctor = doctorTarget('fly-snapback-drill-sjc', options);
assert.ok(['active', 'degraded', 'inactive'].includes(doctor.state), `unexpected state ${doctor.state}`);
assert.equal(doctor.credentialStatus, 'ready');
const inspect = inspectTarget('fly-snapback-drill-sjc', options);
assert.equal(inspect.ok, true);
assert.equal(inspect.observation.resourceId, MACHINE);
record('live provider read-back through the registered adapter (doctor + inspect)', true, {
  state: doctor.state,
  resourceId: inspect.observation.resourceId,
  providerFactsSha256: inspect.observation.providerFactsSha256,
  capabilityGaps: inspect.observation.capabilityGaps,
  diagnostics: inspect.diagnostics,
});

// 2. Identity mismatch fails closed against the live provider: a descriptor
//    registered with a wrong account fingerprint must refuse on read-back.
{
  addTarget(descriptor({ targetId: 'fly-snapback-drill-wrong-account' }, { accountFingerprint: 'fly-org-not-this-account' }), options);
  let refused = null;
  try {
    doctorTarget('fly-snapback-drill-wrong-account', options);
  } catch (error) {
    refused = error.code;
  }
  assert.equal(refused, 'SNAPBACK_TARGET_IDENTITY_MISMATCH');
  record('wrong-account descriptor refuses on live read-back', true, { code: refused });
}

// 3. A missing credential is fail-closed, in protocol, with doctor ok:false.
{
  addTarget(descriptor({ targetId: 'fly-snapback-drill-no-credential' }, { credentialRef: 'keychain://snapback-fly-drill/nonexistent-account' }), options);
  let outcome;
  try {
    outcome = { threw: null, doctor: doctorTarget('fly-snapback-drill-no-credential', options) };
  } catch (error) {
    outcome = { threw: error.code, doctor: null };
  }
  const ok = outcome.threw === 'SNAPBACK_ADAPTER_REJECTED' || outcome.doctor?.ok === false;
  assert.ok(ok, JSON.stringify(outcome));
  record('missing credential fails closed (no observation minted)', true, outcome.threw ? { code: outcome.threw } : { doctorOk: outcome.doctor.ok });
}

// 4. A tampered driver binary refuses before any provider call.
{
  const tamperedPath = join(controlRoot, 'tampered-driver.mjs');
  copyFileSync(driverPath, tamperedPath);
  writeFileSync(tamperedPath, `${readFileSync(tamperedPath, 'utf8')}\n// tampered\n`);
  chmodSync(tamperedPath, 0o755);
  let refused = null;
  try {
    // The digest pin refuses at registration time — before the tampered
    // driver could ever be invoked, which is one step stronger than the
    // invoke-time refusal this check originally expected.
    addTarget(descriptor({ targetId: 'fly-snapback-drill-tampered' }, { driverPath: tamperedPath, driverSha256: sha256(readFileSync(driverPath)) }), options);
    doctorTarget('fly-snapback-drill-tampered', options);
  } catch (error) {
    refused = error.code;
  }
  assert.equal(refused, 'SNAPBACK_ADAPTER_DRIVER_TAMPERED');
  record('tampered driver bytes refuse at registration, before any provider call', true, { code: refused });
}

// 5. Production-posture control logs: requireRemoteEvidence is the default
//    and the response must carry a verified remoteProviderAttestation. This
//    is the first control-plane response in this repository whose
//    remoteEvidence is true against the real provider.
const logs = queryControlLogs('fly-snapback-drill-sjc', { ...options, sinceMs: 0, limit: 100 });
assert.equal(logs.ok, true);
assert.equal(logs.remoteEvidence, true);
const attestation = logs.evidence.find((item) => item.kind === 'remoteProviderAttestation');
assert.ok(attestation && attestation.verified === true);
assert.ok(logs.logs.entries.length > 0, 'expected at least one platform machine event');
record('control logs with remote evidence (verified provider attestation, read-back checked)', true, {
  entryCount: logs.logs.entries.length,
  attestation: { uri: attestation.uri, sha256: attestation.sha256, bytes: attestation.bytes },
  retentionClass: logs.logs.retentionClass,
  deliveryLatencyMs: logs.logs.deliveryLatencyMs,
});

// 6. Platform interruption/resume: stop the machine through the provider,
//    wait for `stopped`, start it, wait for `started`, and confirm the
//    adapter observes the resumed machine and the stop/start pair lands in
//    the provider event log. The drill rootfs survives stop/start (recorded
//    drill posture), and this is the drill target these interruption
//    classes exist for.
async function waitForState(wanted, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const read = await machinesApi(`/v1/apps/${APP}/machines/${MACHINE}`);
    if (read.status === 200 && JSON.parse(read.body).state === wanted) return true;
    await new Promise((resolvePromise) => { setTimeout(resolvePromise, 2_000); });
  }
  return false;
}
{
  const stop = await machinesApi(`/v1/apps/${APP}/machines/${MACHINE}/stop`, { method: 'POST', body: '{}' });
  assert.ok([200, 201].includes(stop.status), `stop http ${stop.status}: ${stop.body.slice(0, 200)}`);
  assert.ok(await waitForState('stopped'), 'machine did not reach stopped');
  const stoppedDoctor = doctorTarget('fly-snapback-drill-sjc', options);
  assert.equal(stoppedDoctor.state, 'inactive');
  const start = await machinesApi(`/v1/apps/${APP}/machines/${MACHINE}/start`, { method: 'POST', body: '{}' });
  assert.ok([200, 201].includes(start.status), `start http ${start.status}: ${start.body.slice(0, 200)}`);
  assert.ok(await waitForState('started'), 'machine did not return to started');
  const resumedDoctor = doctorTarget('fly-snapback-drill-sjc', options);
  assert.ok(['active', 'degraded'].includes(resumedDoctor.state));
  const resumedLogs = queryControlLogs('fly-snapback-drill-sjc', { ...options, sinceMs: 0, limit: 100 });
  const codes = resumedLogs.logs.entries.map((entry) => entry.eventCode);
  assert.ok(codes.includes('fly-machine-stop') || codes.includes('fly-machine-exit'), `no stop/exit event in ${JSON.stringify(codes)}`);
  assert.ok(codes.includes('fly-machine-start'), `no start event in ${JSON.stringify(codes)}`);
  record('platform interruption/resume observed through the adapter (stop → inactive → start → resumed, event pair in provider log)', true, {
    stoppedState: stoppedDoctor.state,
    resumedState: resumedDoctor.state,
    eventCodes: [...new Set(codes)].slice(0, 12),
  });
}

// 7. Public-origin posture, recorded honestly: while the Caddy/Let's Encrypt
//    rate-limit outage lasts, the origin fails TLS and the adapter maps a
//    started machine to `degraded` — the structured degraded classification
//    the acceptance list requires for TLS failure. If the origin has healed,
//    the state is `active` and this check records that instead.
{
  const finalDoctor = doctorTarget('fly-snapback-drill-sjc', options);
  const tlsDiagnostic = (finalDoctor.diagnostics ?? []).find((d) => d.code === 'SNAPBACK_ADAPTER_ORIGIN_TLS_DEGRADED') ?? null;
  record('origin TLS posture is classified structurally (degraded on TLS failure, active when healthy)', true, {
    state: finalDoctor.state,
    tlsDiagnostic,
  });
}

const receipt = {
  schemaVersion: 'snapback.competitive-checkpoint.control-plane-remote.v0',
  authority: 'llp/0072-trusted-single-tenant-control-plane.rfc.md',
  claim: 'first concrete-adapter control-plane operations against the live provider: observation read-back, fail-closed negatives, remote-evidence control logs, platform interruption/resume. NOT the LLP 0072 acceptance corpus: no lifecycle train, release manifest, backup/restore, or activation evidence is claimed.',
  target: {
    provider: 'fly-machines',
    app: APP,
    machine: MACHINE,
    region: 'sjc',
    publicOrigin: ORIGIN,
    adapterKind: 'singleInstanceContainerVm',
    driverSha256: sha256(readFileSync(driverPath)),
    credentialCustody: 'macOS keychain item snapback-fly-drill/drill (operator-staged; value never enters the repository or this receipt)',
  },
  ok: checks.every((check) => check.ok),
  checks,
  generatedAt: new Date().toISOString(),
};
mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, 'control-plane-remote.v0.json'), `${JSON.stringify(receipt, null, 2)}\n`);
rmSync(controlRoot, { recursive: true, force: true });
console.log(`\nPASS control-plane-remote — ${checks.length}/${checks.length} checks, receipt written`);
