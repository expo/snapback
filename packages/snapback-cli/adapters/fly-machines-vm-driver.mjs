#!/usr/bin/env node
// @ref LLP 0072#adapter-contract-and-first-profile — the first concrete
// provider driver for `single-instance-container-vm.v1`, speaking the closed
// stdin protocol against the real Fly Machines API. This slice implements the
// read-only observation surface (`doctor`, `inspect`) and the bounded
// provider-event `logs` query. It never fabricates provider facts: every
// response digests the raw provider bytes it derived from, `remoteEvidence`
// is true only against the canonical provider endpoint, and read-back
// verification (two independent fetches, equal digests) backs every
// `remoteProviderAttestation`. Lifecycle operations (upload, provision,
// stage, activate, rollback, backup, restore) are NOT implemented here and
// fail closed at the process boundary; `inspectAdmin` refuses in-protocol
// until the served-manifest sourcing is wired (remaining-surface ticket).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const CANONICAL_API_BASE = 'https://api.machines.dev';
const RESPONSE_SCHEMA = 'snapback.vm-adapter-response.v1';
const QUERY_RESPONSE_SCHEMA = 'snapback.vm-adapter-query-response.v1';
const CAPABILITY_GAPS = [
  'control-plane.release-manifest',
  'control-plane.lifecycle-train',
  'control-plane.state-store',
  'control-plane.activation-history',
];

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function boundedText(value, max = 512) {
  return String(value ?? '').replace(/[\0\r\n]/g, ' ').slice(0, max) || 'unknown';
}

// The test base is honored only under an explicit opt-in that the control
// plane's allowlisted adapter environment can never set (LLP 0072: the CLI
// passes only HOME/LANG/PATH-class variables through). A non-canonical base
// forces remoteEvidence:false so fixture runs are structurally incapable of
// minting hosted evidence.
function apiBase() {
  if (process.env.SNAPBACK_VM_DRIVER_ALLOW_TEST_BASE === '1' && process.env.SNAPBACK_VM_DRIVER_TEST_BASE) {
    return { base: process.env.SNAPBACK_VM_DRIVER_TEST_BASE, canonical: false };
  }
  return { base: CANONICAL_API_BASE, canonical: true };
}

function resolveCredential(credentialRef) {
  let reference;
  try {
    reference = new URL(credentialRef);
  } catch {
    return { token: null, status: 'invalid' };
  }
  if (reference.protocol === 'keychain:') {
    const service = reference.host;
    const account = reference.pathname.replace(/^\//, '');
    if (!service || !account) return { token: null, status: 'invalid' };
    try {
      const token = execFileSync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
      }).trim();
      return token ? { token, status: 'ready' } : { token: null, status: 'missing' };
    } catch {
      return { token: null, status: 'missing' };
    }
  }
  if (reference.protocol === 'secret-store:' && reference.host === 'env') {
    const name = reference.pathname.replace(/^\//, '');
    const token = name ? process.env[name] : undefined;
    return token ? { token, status: 'ready' } : { token: null, status: 'missing' };
  }
  return { token: null, status: 'invalid' };
}

async function providerGet(base, token, path) {
  const startedAt = Date.now();
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.text();
  return { status: response.status, body, roundTripMs: Date.now() - startedAt, uri: `${CANONICAL_API_BASE}${path}` };
}

async function probeOriginTls(origin) {
  try {
    const response = await fetch(`${origin}/`, { method: 'HEAD', signal: AbortSignal.timeout(6_000), redirect: 'manual' });
    return { ok: true, detail: `http-${response.status}` };
  } catch (error) {
    return { ok: false, detail: boundedText(error?.cause?.code ?? error?.message ?? 'unreachable', 120) };
  }
}

function mapState(machineState, originTlsOk) {
  if (machineState === 'started') return originTlsOk ? 'active' : 'degraded';
  if (machineState === 'stopped' || machineState === 'suspended') return 'inactive';
  if (machineState === 'created' || machineState === 'starting' || machineState === 'replacing') return 'provisioning';
  if (machineState === 'destroyed' || machineState === 'destroying') return 'retired';
  return 'failed';
}

async function observe(target) {
  const { base, canonical } = apiBase();
  const credential = resolveCredential(target.adapter.credentialRef);
  const app = new URL(target.adapter.publicOrigin).hostname.split('.')[0];
  const diagnostics = [];
  if (credential.status !== 'ready') {
    return { observation: null, credentialStatus: credential.status, diagnostics: [{ code: 'SNAPBACK_ADAPTER_CREDENTIAL_UNAVAILABLE', severity: 'error', message: `credential handle resolution failed (${credential.status})` }], canonical, raw: [] };
  }
  const appRead = await providerGet(base, credential.token, `/v1/apps/${app}`);
  const machinesRead = await providerGet(base, credential.token, `/v1/apps/${app}/machines`);
  if (appRead.status === 401 || appRead.status === 403) {
    return { observation: null, credentialStatus: 'invalid', diagnostics: [{ code: 'SNAPBACK_ADAPTER_CREDENTIAL_REJECTED', severity: 'error', message: `provider rejected the credential (http ${appRead.status})` }], canonical, raw: [] };
  }
  if (appRead.status !== 200 || machinesRead.status !== 200) {
    return { observation: null, credentialStatus: 'unknown', diagnostics: [{ code: 'SNAPBACK_ADAPTER_PROVIDER_READ_FAILED', severity: 'error', message: `provider read failed (app http ${appRead.status}, machines http ${machinesRead.status})` }], canonical, raw: [] };
  }
  const appFacts = JSON.parse(appRead.body);
  const machines = JSON.parse(machinesRead.body);
  const machine = machines.find((entry) => entry.state === 'started') ?? machines[0];
  if (!machine) {
    return { observation: null, credentialStatus: 'ready', diagnostics: [{ code: 'SNAPBACK_ADAPTER_NO_MACHINE', severity: 'error', message: 'application has no machines' }], canonical, raw: [] };
  }
  const originTls = await probeOriginTls(target.adapter.publicOrigin);
  if (!originTls.ok) {
    diagnostics.push({ code: 'SNAPBACK_ADAPTER_ORIGIN_TLS_DEGRADED', severity: 'warning', message: `public origin TLS probe failed: ${originTls.detail}` });
  }
  const observation = {
    targetId: target.targetId,
    environmentId: target.environmentId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    targetProfileId: target.targetProfileId,
    provider: target.adapter.provider,
    accountFingerprint: `fly-org-${boundedText(appFacts.organization?.slug ?? 'unknown', 64)}`,
    region: boundedText(machine.region ?? 'unknown', 32),
    publicOrigin: target.adapter.publicOrigin,
    resourceId: boundedText(machine.id, 64),
    state: mapState(machine.state, originTls.ok),
    activationGeneration: 0,
    activeReleaseId: null,
    applicationSentinelSha256: null,
    credentialStatus: 'ready',
    providerFactsSha256: sha256(Buffer.from(canonicalJson({ app: appFacts, machines, originTls }))),
    observedAtMs: Date.now(),
    capabilityGaps: CAPABILITY_GAPS,
  };
  return { observation, credentialStatus: 'ready', diagnostics, canonical, raw: [appRead, machinesRead], machine, app };
}

function refusalObservationResponse(request, result) {
  return {
    schemaVersion: RESPONSE_SCHEMA,
    operation: request.operation,
    operationId: request.operationId,
    ok: false,
    observation: null,
    diagnostics: result.diagnostics,
  };
}

async function handleObservation(request) {
  const result = await observe(request.target);
  if (!result.observation) return refusalObservationResponse(request, result);
  return {
    schemaVersion: RESPONSE_SCHEMA,
    operation: request.operation,
    operationId: request.operationId,
    ok: true,
    observation: result.observation,
    diagnostics: result.diagnostics,
  };
}

function severityForEvent(type) {
  return type === 'exit' || type === 'destroy' ? 'warning' : 'info';
}

async function handleQuery(request) {
  const refuse = (code, message) => finishQuery(request, {
    ok: false,
    remoteEvidence: false,
    observation: null,
    evidence: [],
    logs: null,
    inspection: null,
    diagnostics: [{ code, severity: 'error', message }],
  });
  if (request.operation === 'inspectAdmin') {
    return refuse('SNAPBACK_ADAPTER_INSPECTION_UNAVAILABLE', 'authenticated inspection requires the served capability-manifest sourcing, which is recorded remaining surface for this driver');
  }
  if (request.operation !== 'logs') {
    return refuse('SNAPBACK_ADAPTER_OPERATION_UNSUPPORTED', `query operation ${boundedText(request.operation, 64)} is not implemented by this driver`);
  }
  const result = await observe(request.target);
  if (!result.observation) {
    return finishQuery(request, {
      ok: false,
      remoteEvidence: false,
      observation: null,
      evidence: [],
      logs: null,
      inspection: null,
      diagnostics: result.diagnostics,
    });
  }
  const { base, canonical } = apiBase();
  const credential = resolveCredential(request.target.adapter.credentialRef);
  const eventsPath = `/v1/apps/${result.app}/machines/${result.machine.id}/events`;
  // Read-back verification: two independent provider reads must agree byte
  // for byte before the attestation may say verified:true.
  const firstRead = await providerGet(base, credential.token, eventsPath);
  const secondRead = await providerGet(base, credential.token, eventsPath);
  if (firstRead.status !== 200 || secondRead.status !== 200) {
    return refuse('SNAPBACK_ADAPTER_PROVIDER_READ_FAILED', `provider event read failed (http ${firstRead.status}/${secondRead.status})`);
  }
  if (sha256(Buffer.from(firstRead.body)) !== sha256(Buffer.from(secondRead.body))) {
    return refuse('SNAPBACK_ADAPTER_READBACK_UNSTABLE', 'provider event read-back did not verify byte-identically');
  }
  const events = JSON.parse(firstRead.body);
  const query = request.query;
  const entries = events
    .map((event) => ({
      timestampMs: Number(event.timestamp) || 0,
      severity: severityForEvent(String(event.type ?? 'unknown')),
      deploymentId: request.target.deploymentId,
      releaseId: null,
      activationGeneration: 0,
      streamIncarnation: request.target.streamIncarnation,
      correlationId: boundedText(event.id ?? 'unknown-event', 128).replace(/[^A-Za-z0-9._-]/g, '-'),
      eventCode: `fly-machine-${boundedText(event.type ?? 'unknown', 32).replace(/[^A-Za-z0-9._-]/g, '-')}`,
      eventVersion: 1,
      payload: [
        { name: 'eventType', value: boundedText(event.type, 64) },
        { name: 'eventStatus', value: boundedText(event.status, 64) },
        { name: 'eventSource', value: boundedText(event.source, 64) },
      ],
    }))
    .filter((entry) => entry.timestampMs >= query.sinceMs && entry.timestampMs <= query.untilMs)
    .slice(0, query.limit);
  return finishQuery(request, {
    ok: true,
    remoteEvidence: canonical,
    observation: result.observation,
    evidence: canonical ? [{
      kind: 'remoteProviderAttestation',
      uri: firstRead.uri,
      sha256: sha256(Buffer.from(firstRead.body)),
      bytes: Buffer.byteLength(firstRead.body),
      verified: true,
    }] : [],
    logs: {
      entries,
      nextCursor: null,
      retentionClass: 'fly-platform-machine-events',
      indexingClass: 'provider-api-scan',
      deliveryLatencyMs: firstRead.roundTripMs,
      droppedEvents: 0,
      backpressure: false,
    },
    inspection: null,
    diagnostics: result.diagnostics,
  });
}

function finishQuery(request, content) {
  const inputSha256 = sha256(Buffer.from(`snapback-vm-adapter-query-input-v1\0${canonicalJson(request)}`));
  const withoutOutput = {
    schemaVersion: QUERY_RESPONSE_SCHEMA,
    operation: request.operation,
    operationId: request.operationId,
    inputSha256,
    ...content,
  };
  const outputSha256 = sha256(Buffer.from(`snapback-vm-adapter-query-output-v1\0${canonicalJson(withoutOutput)}`));
  return { ...withoutOutput, outputSha256 };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let request;
  try {
    request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.stderr.write('fly-machines-vm-driver: stdin was not one JSON request\n');
    process.exit(3);
  }
  if (request?.schemaVersion === 'snapback.vm-adapter-request.v1' && ['doctor', 'inspect'].includes(request.operation)) {
    process.stdout.write(`${JSON.stringify(await handleObservation(request))}\n`);
    return;
  }
  if (request?.schemaVersion === 'snapback.vm-adapter-query-request.v1') {
    process.stdout.write(`${JSON.stringify(await handleQuery(request))}\n`);
    return;
  }
  // Lifecycle and any unrecognized operations fail closed at the process
  // boundary: this driver has not implemented them and must not pretend.
  process.stderr.write(`fly-machines-vm-driver: unimplemented operation ${boundedText(request?.operation, 64)} (${boundedText(request?.schemaVersion, 64)})\n`);
  process.exit(3);
}

main().catch((error) => {
  process.stderr.write(`fly-machines-vm-driver: ${boundedText(error?.stack ?? error, 2000)}\n`);
  process.exit(3);
});
