// LLP 0062 ticket 09 — the live-binary served journey.
//
// Every earlier leg of the served story was proven against fakes or in
// isolation: codegen's members (package suite), the server's composition
// (Rust suite), the engine's verification (package suite). This is the loop
// closed against a real binary: codegen emits the members, the managed
// provision intent carries them, the server composes and self-verifies the
// envelope from its own projection, serves it under `/app-api/*`, and the
// engine discovers, re-verifies, caches, and drives the app from it with
// zero local artifact files.
//
// Run: node tests/acceptance/app-cli-served-journey.mjs

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/index.mjs';
import {
  discoverServedApp,
  fetchServedEnvelope,
  loadServedApp,
  verifyEnvelopeBytes,
} from '../../packages/snapback-app-cli/envelope.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const fixtureRoot = join(here, 'fixtures', 'app-cli-journey');

const checks = {};
const check = (name, condition, detail = '') => {
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ''}`);
  checks[name] = true;
};

const scratch = await mkdtemp(join(tmpdir(), 'app-cli-journey-'));
let server = null;
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

try {
  // --- codegen emits the members ------------------------------------------
  const backendRoot = join(scratch, 'app', 'snapback');
  await cp(fixtureRoot, backendRoot, { recursive: true });
  await rm(join(backendRoot, 'generated'), { recursive: true, force: true });
  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const generatedRoot = join(backendRoot, 'generated');
  const schemaManifest = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functionManifest = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const members = await readJson(join(generatedRoot, 'api-envelope.members.json'));

  check(
    'codegenEmitsMembers',
    Object.keys(members.operations).length === functionManifest.functions.length
      && typeof members.declarations.appBindings === 'string'
      && Object.keys(members.memberDigests).length === functionManifest.functions.length + 1,
    JSON.stringify(Object.keys(members.operations)),
  );
  // Keyed by stable id, and the declarations carry kind-specific signatures.
  check(
    'membersKeyedByStableId',
    functionManifest.functions.every((fn) => members.operations[fn.id]?.name === fn.name)
      && members.declarations.appBindings.includes('AsyncIterable') === functionManifest.functions.some((fn) => fn.kind === 'LiveQuery'),
  );

  // --- the server composes at activation -----------------------------------
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

  // A cold sessions boot carries no members: the generation is explicitly
  // envelope-less, and the engine says so in identity terms rather than
  // pretending the app is unavailable.
  const beforeProvision = await discoverServedApp(server.baseUrl);
  check(
    'coldBootIsEnvelopeAbsent',
    beforeProvision.status === 'envelope-absent',
    JSON.stringify(beforeProvision),
  );
  await assert.rejects(
    () => loadServedApp(server.baseUrl, { cacheDir: join(scratch, 'cache-empty') }),
    (error) => error.code === 'SNAPBACK_APP_CLI_ENVELOPE_ABSENT',
  );

  const admin = new SnapbackClient(server.baseUrl, { adminToken: server.adminToken });
  const provision = await admin.ensureApp({
    intent: 'provision',
    requestedMode: 'sessions',
    schema: schemaManifest,
    functions: functionManifest,
    apiEnvelope: members,
  });
  check('provisionComposesEnvelope', provision.apiEnvelope === 'composed', JSON.stringify(provision));

  // --- the engine discovers, verifies, and caches ---------------------------
  const discovered = await discoverServedApp(server.baseUrl);
  check(
    'discoveryNamesTheEnvelope',
    discovered.status === 'current' && /^[0-9a-f]{64}$/.test(discovered.sha256),
    JSON.stringify(discovered.discovery ?? discovered),
  );
  check(
    'discoveryCarriesTheActiveTuple',
    discovered.discovery.tuple.inputsHash === functionManifest.inputsHash
      && discovered.discovery.tuple.authMode === 'sessions',
  );

  const verified = await fetchServedEnvelope(server.baseUrl, discovered.sha256, {
    expectedAppId: schemaManifest.appId,
  });
  check(
    'servedEnvelopeVerifiesClientSide',
    verified.sha256 === discovered.sha256 && verified.envelope.appId === schemaManifest.appId,
  );
  // The server composed the envelope from its own projection; the members the
  // engine reads back are exactly the ones codegen produced.
  check(
    'composedMembersRoundTrip',
    functionManifest.functions.every((fn) => {
      const served = verified.envelope.operations[fn.id];
      return served?.name === fn.name
        && JSON.stringify(served.argsSchema) === JSON.stringify(members.operations[fn.id].argsSchema);
    })
      && verified.envelope.declarations.appBindings === members.declarations.appBindings,
  );

  // Tamper: a single flipped byte in the served bytes must refuse against the
  // content address rather than shape a call.
  const tampered = Buffer.from(verified.canonical.replace('"appId"', '"appiD"'), 'utf8');
  assert.throws(
    () => verifyEnvelopeBytes(tampered, { expectedSha256: discovered.sha256 }),
    (error) => typeof error.code === 'string' && error.code.startsWith('SNAPBACK_APP_CLI_'),
  );
  checks.tamperRefusesClientSide = true;

  const cacheDir = join(scratch, 'cache');
  const surface = await loadServedApp(server.baseUrl, { cacheDir });
  // Zero local artifact files: every callable the app declares is on the
  // surface, with its argument schema, carrying the five-key generation the
  // engine asserts as `expectedGeneration` on every call.
  check(
    'engineDrivesTheServedSurface',
    surface.source === 'served'
      && surface.offline === false
      && functionManifest.functions.every((fn) => {
        const served = surface.functions.find((entry) => entry.id === fn.id);
        // The engine normalizes kinds to its own lowercase vocabulary.
        return served?.name === fn.name
          && served.kind === fn.kind.toLowerCase()
          && served.argsSchema !== null;
      }),
    JSON.stringify(surface.functions.map((f) => ({ id: f.id, kind: f.kind, hasSchema: f.argsSchema !== null }))),
  );
  check(
    'servedSurfaceCarriesTheGeneration',
    surface.generation !== null
      && surface.generation.inputsHash === functionManifest.inputsHash
      && surface.generation.appId === schemaManifest.appId,
    JSON.stringify(surface.generation),
  );

  // --- offline introspection from the verified cache ------------------------
  const offline = await loadServedApp(server.baseUrl, {
    cacheDir,
    offline: true,
    appId: schemaManifest.appId,
  });
  check(
    'offlineServesFromVerifiedCache',
    offline.offline === true
      && offline.source === 'served'
      && offline.functions.length === functionManifest.functions.length,
  );

  // --- identity rotates with the generation ---------------------------------
  await writeFile(
    join(backendRoot, 'functions.mjs'),
    `${await readFile(join(backendRoot, 'functions.mjs'), 'utf8')}\n// journey: rotate the generation\n`,
    'utf8',
  );
  const regenerated = await generate(backendRoot);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  // The pair must stay coherent: the inputs hash spans both manifests, so a
  // regeneration rotates the schema side too even when only functions moved.
  const rotatedSchema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const rotatedFunctions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const rotatedMembers = await readJson(join(generatedRoot, 'api-envelope.members.json'));
  const rotated = await admin.ensureApp({
    intent: 'provision',
    requestedMode: 'sessions',
    schema: rotatedSchema,
    functions: rotatedFunctions,
    apiEnvelope: rotatedMembers,
  });
  check('redeployRecomposes', rotated.apiEnvelope === 'composed');
  const afterRotation = await discoverServedApp(server.baseUrl);
  check(
    'redeployRotatesEnvelopeIdentity',
    afterRotation.status === 'current'
      && afterRotation.discovery.tuple.inputsHash === rotatedFunctions.inputsHash,
    `${discovered.sha256} -> ${afterRotation.sha256}`,
  );
  const rotatedSurface = await loadServedApp(server.baseUrl, { cacheDir });
  check(
    'engineFollowsTheRotation',
    rotatedSurface.offline === false
      && rotatedSurface.envelopeSha256 !== surface.envelopeSha256
      && rotatedSurface.generation.inputsHash === rotatedFunctions.inputsHash,
    `${surface.envelopeSha256} -> ${rotatedSurface.envelopeSha256}`,
  );

  // --- the app still runs under real bearer custody -------------------------
  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const user = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: 'app-cli-journey-ada',
  });
  const requested = await user.authRequestCode('ada@journey.test');
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
  await user.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
  check('sessionsCustodyStillWorks', true);

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await server?.stop?.();
  await rm(scratch, { recursive: true, force: true });
}
