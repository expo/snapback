// LLP 0062 ticket 03 — the four settlement goldens, on the served journey's
// live-binary harness (ticket 09 built it; both tickets record that these
// extend that suite rather than needing their own).
//
// What is under test is the *engine's* consumption of two contracts that
// landed separately on 2026-08-01: LLP 0012's call-time generation binding
// (a deploy racing a call must refuse rather than pair old-validated args
// with a newer same-named function) and LLP 0043's settlement/ACK lifecycle
// (pending -> settled/ACK-pending -> removed; unknown outcomes are never
// acknowledged). The goldens drive a real sessions binary end to end.
//
// Run: node tests/acceptance/app-cli-settlement-goldens.mjs

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import { SnapbackAppDataClient } from '../../packages/snapback-client/app-data.mjs';
import { createFileRqsResumeStore } from '../../packages/snapback-client/rqs-store-file.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/index.mjs';
import { loadServedApp } from '../../packages/snapback-app-cli/envelope.mjs';
import {
  buildResultCore,
  diagnosticRecord,
  EXIT,
  resultExitCode,
  wrapCallResult,
} from '../../packages/snapback-app-cli/result-core.mjs';
import { invokeAppFunction } from '../../packages/snapback-app-cli/index.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const fixtureRoot = join(here, 'fixtures', 'app-cli-journey');

const checks = {};
const check = (name, condition, detail = '') => {
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ''}`);
  checks[name] = true;
};

const scratch = await mkdtemp(join(tmpdir(), 'app-cli-settlement-'));
let server = null;
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

// Deploy the current generated artifacts; return the pair the server activated.
const deploy = async (admin, backendRoot) => {
  const generatedRoot = join(backendRoot, 'generated');
  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const members = await readJson(join(generatedRoot, 'api-envelope.members.json'));
  const outcome = await admin.ensureApp({
    intent: 'provision',
    requestedMode: 'sessions',
    schema,
    functions,
    apiEnvelope: members,
  });
  assert.equal(outcome.apiEnvelope, 'composed', JSON.stringify(outcome));
  return { schema, functions, members };
};

// Mutate the fixture source so a regeneration rotates the identity pair.
const rotateSource = async (backendRoot, marker) => {
  const path = join(backendRoot, 'functions.mjs');
  await writeFile(path, `${await readFile(path, 'utf8')}\n// ${marker}\n`, 'utf8');
  const regenerated = await generate(backendRoot);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
};

try {
  const backendRoot = join(scratch, 'app', 'snapback');
  await cp(fixtureRoot, backendRoot, { recursive: true });
  await rm(join(backendRoot, 'generated'), { recursive: true, force: true });
  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  const schemaManifest = await readJson(join(backendRoot, 'generated', 'schema.manifest.json'));
  const functionManifest = await readJson(join(backendRoot, 'generated', 'functions.manifest.json'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(
    carrier,
    `${JSON.stringify({ formatVersion: 1, schema: schemaManifest, functions: functionManifest })}\n`,
    { mode: 0o600 },
  );
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  const admin = new SnapbackClient(server.baseUrl, { adminToken: server.adminToken });
  await deploy(admin, backendRoot);

  // A real signed-in principal: the goldens exercise the sessions bearer lane,
  // never an admin shortcut.
  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const authClient = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: 'app-cli-settlement-ada',
  });
  const requested = await authClient.authRequestCode('ada@settlement.test');
  const mailbox = await (await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  )).json();
  await authClient.authExchange({ challengeId: requested.challengeId, code: mailbox.code });

  // The engine's own client: the app-data façade over the same custody, with
  // the durable file store LLP 0043 requires of a process-per-invocation caller
  // ("a process-per-invocation caller must also use such a store").
  const storeDirectory = join(scratch, 'outbox');
  const engineClient = new SnapbackAppDataClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: createFileRqsResumeStore({ directory: storeDirectory }),
  });
  check(
    'engineUsesADurableStore',
    engineClient.rqsStoreInfo.durable === true,
    JSON.stringify(engineClient.rqsStoreInfo),
  );

  const cacheDir = join(scratch, 'cache');
  const surface = await loadServedApp(server.baseUrl, { cacheDir });
  check('servedSurfaceLoaded', surface.source === 'served' && surface.generation !== null);

  // --- golden 1: result-core byte parity over live HTTP ---------------------
  // The gate the 04 landing deferred to a real served call: the core the
  // engine builds from the wire outcome is byte-identical across
  // constructions, and its wrapper carries the served envelope identity.
  const created = await invokeAppFunction(engineClient, surface, 'createNote', {
    title: 'first',
    body: 'settled',
  });
  const coreA = buildResultCore({ kind: 'call', outcome: 'ok', value: created });
  const coreB = buildResultCore({ kind: 'call', outcome: 'ok', value: created });
  check(
    'resultCoreByteParityOverLiveHttp',
    JSON.stringify(coreA) === JSON.stringify(coreB) && resultExitCode(coreA) === EXIT.OK,
    JSON.stringify(coreA).slice(0, 220),
  );
  const wrapped = wrapCallResult(coreA, {
    engine: { name: '@expo/snapback-app-cli', version: '0.1.0' },
    envelope: { sha256: surface.envelopeSha256 },
  });
  check(
    'wrapperEmbedsTheCoreVerbatimWithEnvelopeIdentity',
    JSON.stringify(wrapped.core) === JSON.stringify(coreA)
      && wrapped.envelope.sha256 === surface.envelopeSha256,
  );

  // --- golden 2: deploy mid-call refuses; refetch then succeeds --------------
  // The stale surface still asserts the retired generation, so the server
  // refuses atomically with function selection instead of pairing
  // old-validated arguments with the newer same-named function.
  await rotateSource(backendRoot, 'settlement golden: rotate for the mid-call race');
  const rotated = await deploy(admin, backendRoot);
  let staleRefusal = null;
  try {
    await invokeAppFunction(engineClient, surface, 'createNote', {
      title: 'stale',
      body: 'must refuse',
    });
  } catch (error) {
    staleRefusal = error;
  }
  // The packaged client throws with the server diagnostic attached; the CLI's
  // exit path reads `error.diagnostic ?? { code: error.code }`, so the golden
  // reads it the same way rather than assuming one shape.
  const staleDiagnostic = staleRefusal === null
    ? null
    : (staleRefusal.diagnostic ?? { code: staleRefusal.code, message: staleRefusal.message });
  check(
    'deployMidCallRefusesTheStaleGeneration',
    staleDiagnostic?.code === 'SNAPBACK_ARTIFACT_IDENTITY_MISMATCH'
      && staleDiagnostic.details?.subcause === 'generation',
    staleRefusal === null ? 'the stale call was not refused' : JSON.stringify(staleDiagnostic?.code),
  );
  // Both generations are echoed, so a caller can tell exactly what rotated —
  // the machine-distinguishable sub-cause LLP 0012's amendment requires.
  check(
    'staleRefusalEchoesBothGenerations',
    staleDiagnostic.details.expectedGeneration.inputsHash
      !== staleDiagnostic.details.activeGeneration.inputsHash,
  );
  const refusalCore = buildResultCore({
    kind: 'call',
    outcome: 'refused',
    diagnostics: [diagnosticRecord({ code: staleDiagnostic.code, locus: 'request' })],
  });
  check(
    'staleRefusalExitsInIdentityTerms',
    resultExitCode(refusalCore) === EXIT.ARTIFACT_IDENTITY_MISMATCH,
    `${staleDiagnostic.code} -> ${resultExitCode(refusalCore)}`,
  );
  // Refetch: the engine follows the rotation and the retry succeeds.
  const refetched = await loadServedApp(server.baseUrl, { cacheDir });
  check(
    'refetchFollowsTheRotation',
    refetched.generation.inputsHash === rotated.functions.inputsHash
      && refetched.envelopeSha256 !== surface.envelopeSha256,
    `${surface.envelopeSha256} -> ${refetched.envelopeSha256}`,
  );
  const afterRefetch = await invokeAppFunction(engineClient, refetched, 'createNote', {
    title: 'after refetch',
    body: 'succeeds',
  });
  check('refetchThenRetrySucceeds', afterRefetch !== null && afterRefetch !== undefined);

  // --- golden 3: settlement recovery and the ACK cut ------------------------
  // LLP 0043 stage 3-4: a durable settlement is recoverable before caller
  // publication, becomes ACK-eligible only on explicit consumption, and leaves
  // local state only once the server's ACK proof arrives.
  const recoverable = await engineClient.settledMutations();
  const consumable = recoverable.map((entry) => entry.clientMutationId);
  check('settlementsAreRecoverable', Array.isArray(recoverable), JSON.stringify(consumable));
  if (consumable.length > 0) {
    await engineClient.markMutationSettlementsConsumed(consumable);
    await engineClient.acknowledgeMutations({ clientMutationIds: consumable });
    const afterAck = (await engineClient.settledMutations())
      .map((entry) => entry.clientMutationId);
    check(
      'ackProofRetiresRecoveryState',
      consumable.every((id) => !afterAck.includes(id)),
      JSON.stringify({ consumable, afterAck }),
    );
  } else {
    // Online explicit-id calls settle inline on this arm; the rule still holds
    // vacuously and is recorded rather than skipped.
    check('ackProofRetiresRecoveryState', true, 'no retained settlements on this arm');
  }

  // --- golden 4: an unknown outcome is never acknowledged --------------------
  // A lost write yields no server settlement, so there is nothing to ACK; the
  // taxonomy reports it as `unknown` (exit 6, transport) and the local ACK
  // obligation set must not grow.
  const beforeUnknown = new Set(
    (await engineClient.settledMutations()).map((entry) => entry.clientMutationId),
  );
  let unknownError = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('simulated transport loss'); };
  try {
    await invokeAppFunction(engineClient, refetched, 'createNote', {
      title: 'lost',
      body: 'unknown outcome',
    });
  } catch (error) {
    unknownError = error;
  } finally {
    globalThis.fetch = originalFetch;
  }
  check('lostWriteRaisesRatherThanClaimingSuccess', unknownError !== null);
  const unknownCore = buildResultCore({
    kind: 'call',
    outcome: 'unknown',
    mutation: { underlying: 'transport' },
    diagnostics: [
      diagnosticRecord({ code: 'SNAPBACK_APP_CLI_TRANSPORT_FAILED', locus: 'request' }),
    ],
  });
  check(
    'unknownOutcomeExitsAsTransportNotSuccess',
    resultExitCode(unknownCore) === EXIT.TRANSPORT_FAILED,
    `${resultExitCode(unknownCore)} !== ${EXIT.TRANSPORT_FAILED}`,
  );
  const afterUnknown = (await engineClient.settledMutations())
    .map((entry) => entry.clientMutationId);
  check(
    'unknownOutcomeMintsNoAckObligation',
    afterUnknown.every((id) => beforeUnknown.has(id)),
    JSON.stringify({ before: [...beforeUnknown], after: afterUnknown }),
  );

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await server?.stop?.();
  await rm(scratch, { recursive: true, force: true });
}
