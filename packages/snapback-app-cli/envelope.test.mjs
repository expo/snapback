import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  API_ENVELOPE_ARTIFACT_KIND,
  API_ENVELOPE_FORMAT_V1,
  DECLARATION_MEMBER_KEY,
  envelopeDigest,
  jcsCanonical,
  memberDigest,
  operationMemberKey,
  verifyEnvelopeBytes,
  discoverServedApp,
  loadServedApp,
  readCachedEnvelope,
} from './envelope.mjs';
import { invokeAppFunction } from './index.mjs';
import { EXIT, classifyDiagnosticExit, diagnosticRecord } from './result-core.mjs';

// Test-side composer: builds canonical envelope bytes with the module's own
// primitives. Legitimate for unit fidelity because the server re-derives and
// re-verifies everything; the cross-language anchor below pins these
// primitives byte-for-byte against the Rust authority.
const composeEnvelope = ({
  appId = 'anchor-app',
  tuple = { schemaVersion: 'snapback.v1', authMode: 'sessions' },
  inputsHash = `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  bundleHash = `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
  functions = undefined,
  operations = undefined,
  declaration = 'export const bindings = {};\n',
} = {}) => {
  const resolvedOperations = operations ?? {
    'anchor-app:addNote': { name: 'addNote', argsSchema: { type: 'object', properties: { title: { type: 'string' } } } },
    'anchor-app:listNotes': { name: 'listNotes', argsSchema: { type: 'object', properties: {} } },
  };
  const resolvedFunctions = functions ?? {
    artifactKind: 'functionManifest',
    appId,
    inputsHash,
    bundleHash,
    functions: [
      { id: 'anchor-app:addNote', name: 'addNote', kind: 'Mutation', authRequirement: 'authenticated' },
      { id: 'anchor-app:listNotes', name: 'listNotes', kind: 'Query', authRequirement: 'authenticated' },
    ],
  };
  const memberDigests = {};
  for (const [stableId, operation] of Object.entries(resolvedOperations)) {
    memberDigests[operationMemberKey(stableId)] = memberDigest(jcsCanonical(operation.argsSchema));
  }
  memberDigests[DECLARATION_MEMBER_KEY] = memberDigest(declaration);
  const document = {
    artifactKind: API_ENVELOPE_ARTIFACT_KIND,
    formatVersion: API_ENVELOPE_FORMAT_V1,
    appId,
    tuple,
    inputsHash,
    bundleHash,
    functions: resolvedFunctions,
    operations: resolvedOperations,
    declarations: { appBindings: declaration },
    memberDigests,
  };
  const canonical = jcsCanonical(document);
  return {
    document,
    canonical,
    bytes: Buffer.from(canonical, 'utf8'),
    sha256: envelopeDigest(canonical),
  };
};

// --- Cross-language anchor ---------------------------------------------------
// The same fixture is pinned in src/api_envelope.rs
// (`js_engine_anchor_envelope_parses_and_digests_identically`): identical
// canonical bytes, identical content address, on both sides of the wire.
const anchor = composeEnvelope();
export const ANCHOR_CANONICAL = anchor.canonical;
export const ANCHOR_SHA256 = anchor.sha256;
// Pinned: a drift in either language's canonicalization or digesting breaks
// this constant on that side and the twin constant in the Rust suite.
assert.equal(ANCHOR_SHA256, 'ae62a5543e096aba479faa7f3c00314922448e736e673606b0a3ef3407b5d905');
{
  const verified = verifyEnvelopeBytes(anchor.bytes, { expectedSha256: anchor.sha256, expectedAppId: 'anchor-app' });
  assert.equal(verified.sha256, anchor.sha256);
  assert.equal(verified.envelope.appId, 'anchor-app');
  assert.equal(verified.canonical, anchor.canonical);
}

// --- Verification refusals ---------------------------------------------------
{
  // Non-canonical bytes: one inserted space breaks byte-equality.
  const spaced = Buffer.from(anchor.canonical.replace('{"', '{ "'), 'utf8');
  assert.throws(() => verifyEnvelopeBytes(spaced), /SNAPBACK_APP_CLI_ENVELOPE_NONCANONICAL/);

  // A value edit keeps canonical form but moves the content address.
  const edited = composeEnvelope({ declaration: 'export const bindings = { edited: true };\n' });
  assert.throws(
    () => verifyEnvelopeBytes(edited.bytes, { expectedSha256: anchor.sha256 }),
    /SNAPBACK_APP_CLI_ENVELOPE_DIGEST_MISMATCH/,
  );

  // A forged member: the operation schema changes, the digest map does not.
  const forgedDocument = JSON.parse(anchor.canonical);
  forgedDocument.operations['anchor-app:addNote'].argsSchema.properties.title.type = 'number';
  const forged = Buffer.from(jcsCanonical(forgedDocument), 'utf8');
  assert.throws(() => verifyEnvelopeBytes(forged), /SNAPBACK_APP_CLI_ENVELOPE_MEMBER_DIGEST_MISMATCH/);

  // Unknown format version is the exit-8 admission class, nothing else.
  const versioned = JSON.parse(anchor.canonical);
  versioned.formatVersion = 'snapback.api-envelope.v2';
  assert.throws(
    () => verifyEnvelopeBytes(Buffer.from(jcsCanonical(versioned), 'utf8')),
    /SNAPBACK_APP_CLI_ENVELOPE_VERSION_UNSUPPORTED/,
  );

  // An unknown top-level member refuses loudly (deny_unknown_fields mirror).
  const smuggled = JSON.parse(anchor.canonical);
  smuggled.sourceBundle = 'export const secret = 1;';
  assert.throws(
    () => verifyEnvelopeBytes(Buffer.from(jcsCanonical(smuggled), 'utf8')),
    /unknown member 'sourceBundle'/,
  );

  // Operations that do not pair the projected function set.
  const unpaired = composeEnvelope({
    operations: {
      'anchor-app:addNote': { name: 'addNote', argsSchema: { type: 'object' } },
    },
  });
  assert.throws(
    () => verifyEnvelopeBytes(unpaired.bytes),
    /SNAPBACK_APP_CLI_ENVELOPE_CORRESPONDENCE_FAILED/,
  );

  // Header identity that disagrees with the nested projection.
  const skewed = composeEnvelope({ inputsHash: `snapback.v1:sessions:inputs:sha256:${'d'.repeat(64)}` });
  const skewedDocument = JSON.parse(skewed.canonical);
  skewedDocument.functions.inputsHash = `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`;
  assert.throws(
    () => verifyEnvelopeBytes(Buffer.from(jcsCanonical(skewedDocument), 'utf8')),
    /SNAPBACK_APP_CLI_ENVELOPE_CORRESPONDENCE_FAILED/,
  );
}

// --- Exit taxonomy for the ingestion codes -----------------------------------
{
  const exitOf = (code) => classifyDiagnosticExit(diagnosticRecord({ code, locus: 'engine' }));
  assert.equal(exitOf('SNAPBACK_APP_CLI_ENVELOPE_DIGEST_MISMATCH'), EXIT.ARTIFACT_IDENTITY_MISMATCH);
  assert.equal(exitOf('SNAPBACK_APP_CLI_ENVELOPE_MEMBER_DIGEST_MISMATCH'), EXIT.ARTIFACT_IDENTITY_MISMATCH);
  assert.equal(exitOf('SNAPBACK_APP_CLI_ENVELOPE_NONCANONICAL'), EXIT.ARTIFACT_IDENTITY_MISMATCH);
  assert.equal(exitOf('SNAPBACK_APP_CLI_ENVELOPE_CORRESPONDENCE_FAILED'), EXIT.ARTIFACT_IDENTITY_MISMATCH);
  assert.equal(exitOf('SNAPBACK_APP_CLI_ENVELOPE_ABSENT'), EXIT.ARTIFACT_IDENTITY_MISMATCH);
  assert.equal(exitOf('SNAPBACK_APP_CLI_ENVELOPE_VERSION_UNSUPPORTED'), EXIT.VERSION_MISMATCH);
  assert.equal(exitOf('SNAPBACK_APP_CLI_OFFLINE_CACHED_SURFACE'), EXIT.USAGE);
  assert.equal(exitOf('SNAPBACK_APP_API_UNAVAILABLE'), EXIT.USAGE);
  assert.equal(exitOf('SNAPBACK_APP_API_ENVELOPE_UNKNOWN'), EXIT.ARTIFACT_IDENTITY_MISMATCH);
}

// --- Served discovery, fetch, cache, rotation, offline ----------------------
const state = {
  mode: 'current',
  envelope: anchor,
  envelopeFetches: 0,
  tuple: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
};
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/app-api/current') {
    if (state.mode === 'dev') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        diagnostic: {
          code: 'SNAPBACK_APP_API_UNAVAILABLE',
          message: 'app-api discovery is served by sessions targets only',
        },
      }));
      return;
    }
    if (state.mode === 'route-absent') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({
      artifactKind: 'appApiDiscovery',
      formatVersion: 'snapback.app-api-discovery.v1',
      appId: 'anchor-app',
      tuple: state.tuple,
      envelope: state.mode === 'absent'
        ? { state: 'absent' }
        : { state: 'current', sha256: state.envelope.sha256 },
      appCliTarget: false,
      engineRange: null,
    }));
    return;
  }
  const match = url.pathname.match(/^\/app-api\/envelope\/([0-9a-f]{64})$/);
  if (match) {
    if (match[1] !== state.envelope.sha256) {
      response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({
        diagnostic: { code: 'SNAPBACK_APP_API_ENVELOPE_UNKNOWN', message: 'no retained envelope has that hash' },
      }));
      return;
    }
    state.envelopeFetches += 1;
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': 'identity',
      'cache-control': 'public, max-age=31536000, immutable, no-transform',
      etag: `"${state.envelope.sha256}"`,
    });
    response.end(state.envelope.bytes);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});
await new Promise((ready) => { server.listen(0, '127.0.0.1', ready); });
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const cacheDir = await mkdtemp(join(tmpdir(), 'snapback-envelope-cache-'));

try {
  // Zero local artifact files: discovery → fetch → verify → surface.
  const surface = await loadServedApp(baseUrl, { cacheDir });
  assert.equal(surface.source, 'served');
  assert.equal(surface.offline, false);
  assert.equal(surface.appId, 'anchor-app');
  assert.equal(surface.envelopeSha256, anchor.sha256);
  assert.deepEqual(surface.functions.map((fn) => fn.name).sort(), ['addNote', 'listNotes']);
  assert.equal(surface.functions.find((fn) => fn.name === 'addNote').kind, 'mutation');
  // The discovery tuple supplied the full five-key generation identity.
  assert.equal(surface.generation.appId, 'anchor-app');
  assert.equal(surface.generation.inputsHash, state.tuple.inputsHash);
  assert.equal(state.envelopeFetches, 1);

  // The generation binds calls: the selector carries expectedGeneration.
  const seenSelectors = [];
  const fakeClient = {
    mutate(selector, invocation) { seenSelectors.push({ selector, invocation }); return { ok: true }; },
  };
  await invokeAppFunction(fakeClient, surface, 'addNote', { title: 'hello' });
  assert.equal(seenSelectors[0].selector.name, 'addNote');
  assert.deepEqual(seenSelectors[0].selector.expectedGeneration, surface.generation);

  // Cached-hit fast path: the second load re-verifies from cache, no fetch.
  const again = await loadServedApp(baseUrl, { cacheDir });
  assert.equal(again.envelopeSha256, anchor.sha256);
  assert.equal(state.envelopeFetches, 1);
  const cached = await readCachedEnvelope(cacheDir, baseUrl, 'anchor-app');
  assert.equal(cached.sha256, anchor.sha256);

  // Rotation: a redeploy publishes a new envelope; the engine fetches it and
  // moves the last-known-good pointer.
  const successor = composeEnvelope({ declaration: 'export const bindings = { v: 2 };\n' });
  state.envelope = successor;
  const rotated = await loadServedApp(baseUrl, { cacheDir });
  assert.equal(rotated.envelopeSha256, successor.sha256);
  assert.equal(state.envelopeFetches, 2);
  assert.equal((await readCachedEnvelope(cacheDir, baseUrl, 'anchor-app')).sha256, successor.sha256);

  // Offline: the cached surface answers introspection only.
  const offline = await loadServedApp(baseUrl, { cacheDir, offline: true, appId: 'anchor-app' });
  assert.equal(offline.offline, true);
  assert.equal(offline.envelopeSha256, successor.sha256);
  await assert.rejects(
    invokeAppFunction(fakeClient, offline, 'addNote', {}),
    /SNAPBACK_APP_CLI_OFFLINE_CACHED_SURFACE/,
  );

  // Verify-on-read: a tampered cache entry degrades to absent.
  const cachedPath = join(
    cacheDir,
    new URL(baseUrl).origin.toLowerCase().replace(/[^a-z0-9.-]/g, '_'),
    'anchor-app',
    `${successor.sha256}.json`,
  );
  const original = await readFile(cachedPath);
  await writeFile(cachedPath, Buffer.concat([original, Buffer.from(' ')]));
  assert.equal(await readCachedEnvelope(cacheDir, baseUrl, 'anchor-app'), null);
  await writeFile(cachedPath, original);

  // Envelope-absent: identity establishment fails with the typed class-7 code.
  state.mode = 'absent';
  await assert.rejects(loadServedApp(baseUrl, { cacheDir }), /SNAPBACK_APP_CLI_ENVELOPE_ABSENT/);

  // Dev target and route-absent both degrade as typed unavailability.
  state.mode = 'dev';
  assert.deepEqual((await loadServedApp(baseUrl, { cacheDir })).reason, 'dev-target');
  state.mode = 'route-absent';
  assert.deepEqual((await loadServedApp(baseUrl, { cacheDir })).reason, 'route-absent');
  assert.equal((await discoverServedApp(baseUrl)).status, 'unavailable');
} finally {
  server.close();
  await rm(cacheDir, { recursive: true, force: true });
}

process.stdout.write('envelope.test.mjs passed\n');
process.exit(0);
