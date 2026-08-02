// Served-envelope ingestion, engine side (LLP 0062 §5; ticket 0062-02 step 4).
//
// The engine trusts its own verification, never the transport: every served
// envelope is re-verified client-side with the same admission rules the
// server's Rust authority applies (canonicity, grammar bounds, member
// digests, content address) before a single byte of it shapes a call. The
// server-side mirror is `src/api_envelope.rs`; the two are pinned to each
// other by a cross-language anchor fixture asserted in both suites.

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { fetchPublicArtifact } from '@expo/snapback-client/app-data';

export const API_ENVELOPE_ARTIFACT_KIND = 'apiEnvelope';
export const API_ENVELOPE_FORMAT_V1 = 'snapback.api-envelope.v1';
export const APP_API_DISCOVERY_ARTIFACT_KIND = 'appApiDiscovery';
export const APP_API_DISCOVERY_FORMAT_V1 = 'snapback.app-api-discovery.v1';

// Bounds mirror src/api_envelope.rs verbatim; a divergence is a defect.
export const API_ENVELOPE_MAX_BYTES = 8 * 1024 * 1024;
export const API_ENVELOPE_MAX_FUNCTIONS = 4_096;
export const API_ENVELOPE_MAX_OPERATION_SCHEMAS = 4_096;
export const API_ENVELOPE_MAX_SCHEMA_DEPTH = 32;
export const API_ENVELOPE_MAX_DECLARATION_BYTES = 2 * 1024 * 1024;

const ENVELOPE_DIGEST_DOMAIN = 'snapback:api-envelope:v1\n';
const MEMBER_DIGEST_DOMAIN = 'snapback:api-envelope-member:v1\n';
export const DECLARATION_MEMBER_KEY = 'declaration:appBindings';
export const operationMemberKey = (stableId) => `operation:${stableId}`;

const envelopeError = (code, message, details = undefined) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = Object.freeze({
    code,
    message,
    ...(details === undefined ? {} : { details: Object.freeze({ ...details }) }),
  });
  return error;
};

// RFC 8785 canonical serialization for round-tripped JSON. JavaScript's
// native string sort and JSON.stringify number/string forms are the JCS
// rules; anything that cannot round-trip byte-identically fails the
// canonicity gate downstream, which is the fail-closed outcome we want.
export function jcsCanonical(value) {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return JSON.stringify(value);
  if (kind === 'number') {
    if (!Number.isFinite(value)) {
      throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_NONCANONICAL', 'envelope contains a non-finite number');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (kind !== 'object') {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_NONCANONICAL', `envelope contains a non-JSON ${kind}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcsCanonical(item)).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${jcsCanonical(value[key])}`,
  ).join(',')}}`;
}

const sha256HexOver = (domain, canonical) => createHash('sha256')
  .update(domain, 'utf8')
  .update(canonical, 'utf8')
  .digest('hex');

export const memberDigest = (canonical) => sha256HexOver(MEMBER_DIGEST_DOMAIN, canonical);
export const envelopeDigest = (canonical) => sha256HexOver(ENVELOPE_DIGEST_DOMAIN, canonical);

const jsonDepthWithin = (value, depth, limit) => {
  if (depth > limit) return false;
  if (Array.isArray(value)) return value.every((item) => jsonDepthWithin(item, depth + 1, limit));
  if (value !== null && typeof value === 'object') {
    return Object.values(value).every((item) => jsonDepthWithin(item, depth + 1, limit));
  }
  return true;
};

const HEX64 = /^[0-9a-f]{64}$/;

/// Verify received envelope bytes under the full client-side mirror of the
/// server's admission rules, plus the checks only a consumer can anchor:
/// the content address it asked for and the discovery identity it followed.
export function verifyEnvelopeBytes(bytes, {
  expectedSha256 = null,
  expectedAppId = null,
} = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.byteLength > API_ENVELOPE_MAX_BYTES) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
      `envelope is ${buffer.byteLength} bytes, over the ${API_ENVELOPE_MAX_BYTES}-byte bound`,
    );
  }
  const text = buffer.toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    const error = envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'envelope is not admissible JSON');
    error.cause = cause;
    throw error;
  }
  if (!jsonDepthWithin(parsed, 0, API_ENVELOPE_MAX_SCHEMA_DEPTH)) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
      `nesting exceeds the ${API_ENVELOPE_MAX_SCHEMA_DEPTH}-level envelope bound`,
    );
  }

  // Canonicity is verified, not assumed — byte equality with what arrived.
  const canonical = jcsCanonical(parsed);
  if (Buffer.compare(Buffer.from(canonical, 'utf8'), buffer) !== 0) {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_NONCANONICAL', 'envelope bytes are not RFC 8785 canonical');
  }

  // Mirror the server's deny_unknown_fields posture: the canonicity and
  // digest gates already bind every byte, but an unknown top-level member is
  // refused loudly rather than carried into a trusted surface.
  const KNOWN_TOP_LEVEL = new Set([
    'artifactKind', 'formatVersion', 'appId', 'tuple', 'inputsHash',
    'bundleHash', 'functions', 'operations', 'declarations', 'memberDigests',
  ]);
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const key of Object.keys(parsed)) {
      if (!KNOWN_TOP_LEVEL.has(key)) {
        throw envelopeError(
          'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
          `envelope carries an unknown member '${key}'`,
        );
      }
    }
  }
  if (typeof parsed?.tuple?.schemaVersion !== 'string' || typeof parsed?.tuple?.authMode !== 'string') {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'envelope carries no artifact tuple');
  }
  if (parsed?.artifactKind !== API_ENVELOPE_ARTIFACT_KIND) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
      `unexpected artifactKind '${parsed?.artifactKind ?? null}'`,
    );
  }
  if (parsed.formatVersion !== API_ENVELOPE_FORMAT_V1) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_VERSION_UNSUPPORTED',
      `unsupported formatVersion '${parsed.formatVersion}'`,
      { formatVersion: String(parsed.formatVersion) },
    );
  }
  if (typeof parsed.appId !== 'string' || parsed.appId.length === 0) {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'envelope carries no app id');
  }
  const projectedFunctions = parsed.functions?.functions;
  if (!Array.isArray(projectedFunctions)) {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'envelope projection carries no function list');
  }
  if (projectedFunctions.length > API_ENVELOPE_MAX_FUNCTIONS) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
      `function count exceeds the ${API_ENVELOPE_MAX_FUNCTIONS} bound`,
    );
  }
  const operations = parsed.operations;
  if (operations === null || typeof operations !== 'object' || Array.isArray(operations)) {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'envelope carries no operations map');
  }
  if (Object.keys(operations).length > API_ENVELOPE_MAX_OPERATION_SCHEMAS) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
      `operation count exceeds the ${API_ENVELOPE_MAX_OPERATION_SCHEMAS} bound`,
    );
  }
  const declaration = parsed.declarations?.appBindings;
  if (typeof declaration !== 'string') {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'envelope carries no appBindings declaration');
  }
  if (declaration.length > API_ENVELOPE_MAX_DECLARATION_BYTES) {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'declaration text exceeds the envelope bound');
  }
  const memberDigests = parsed.memberDigests;
  if (memberDigests === null || typeof memberDigests !== 'object' || Array.isArray(memberDigests)) {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'envelope carries no member digest map');
  }

  // Member digests: the map covers exactly the members, and every digest
  // recomputes. A forged or swapped member fails here even when the
  // envelope's own structure is impeccable.
  const expectedKeys = [
    ...Object.keys(operations).map((id) => operationMemberKey(id)),
    DECLARATION_MEMBER_KEY,
  ].sort();
  const carriedKeys = Object.keys(memberDigests).sort();
  if (expectedKeys.length !== carriedKeys.length
    || expectedKeys.some((key, index) => key !== carriedKeys[index])) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_MEMBER_DIGEST_MISMATCH',
      'member digest map does not cover exactly the envelope members',
    );
  }
  for (const [stableId, operation] of Object.entries(operations)) {
    const computed = memberDigest(jcsCanonical(operation?.argsSchema ?? null));
    if (computed !== memberDigests[operationMemberKey(stableId)]) {
      throw envelopeError(
        'SNAPBACK_APP_CLI_ENVELOPE_MEMBER_DIGEST_MISMATCH',
        `operation '${stableId}' schema digest does not match`,
        { operation: stableId },
      );
    }
  }
  if (memberDigest(declaration) !== memberDigests[DECLARATION_MEMBER_KEY]) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_MEMBER_DIGEST_MISMATCH',
      'declaration digest does not match',
    );
  }

  // Internal correspondence — the client-side half of the server's
  // correspondence rules: header identity agrees with the nested
  // projection, and the operation set pairs the projected function set.
  const headerInputs = typeof parsed.inputsHash === 'string' ? parsed.inputsHash : null;
  const headerBundle = typeof parsed.bundleHash === 'string' ? parsed.bundleHash : null;
  const projectionInputs = typeof parsed.functions?.inputsHash === 'string' ? parsed.functions.inputsHash : null;
  const projectionBundle = typeof parsed.functions?.bundleHash === 'string' ? parsed.functions.bundleHash : null;
  if (headerInputs !== projectionInputs || headerBundle !== projectionBundle) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_CORRESPONDENCE_FAILED',
      'envelope header identity disagrees with its own projection',
    );
  }
  const functionIds = projectedFunctions
    .map((fn) => (typeof fn?.id === 'string' ? fn.id : null));
  if (functionIds.some((id) => id === null)) {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'projected function without a stable id');
  }
  const sortedFunctionIds = [...functionIds].sort();
  const sortedOperationIds = Object.keys(operations).sort();
  if (sortedFunctionIds.length !== sortedOperationIds.length
    || sortedFunctionIds.some((id, index) => id !== sortedOperationIds[index])) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_CORRESPONDENCE_FAILED',
      'envelope operation set does not match its projected function set',
    );
  }

  // The consumer-side anchors: the content address requested and the
  // discovery identity followed.
  const sha256 = envelopeDigest(canonical);
  if (expectedSha256 !== null && sha256 !== expectedSha256) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_DIGEST_MISMATCH',
      'envelope content address does not match the requested hash',
      { expected: expectedSha256, computed: sha256 },
    );
  }
  if (expectedAppId !== null && parsed.appId !== expectedAppId) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_CORRESPONDENCE_FAILED',
      'envelope app id does not match the discovery document',
      { discovery: expectedAppId, envelope: parsed.appId },
    );
  }
  return Object.freeze({ envelope: parsed, sha256, canonical });
}

const discoveryError = (payload, status) => {
  const diagnostic = payload?.diagnostic ?? {
    code: 'SNAPBACK_APP_CLI_HTTP_FAILED',
    message: `discovery failed with HTTP ${status}`,
  };
  const error = envelopeError(diagnostic.code, diagnostic.message, diagnostic.details);
  error.status = status;
  return error;
};

/// Discover the served surface. Distinguishes, without conflation: a
/// sessions target with a current envelope, a sessions target whose
/// generation is envelope-less, a dev target (typed refusal — the engine
/// belongs on `/inspect` and local artifacts there), and an older server
/// with no `/app-api/*` routes at all.
export async function discoverServedApp(baseUrl) {
  const response = await fetchPublicArtifact(baseUrl, '/app-api/current', {
    ingressClass: 'discovery',
  });
  const text = response.bodyText();
  const payload = (() => {
    try { return JSON.parse(text); } catch { return null; }
  })();
  if (!response.ok) {
    const code = payload?.diagnostic?.code ?? null;
    if (code === 'SNAPBACK_APP_API_UNAVAILABLE') {
      return Object.freeze({ status: 'unavailable', reason: 'dev-target', diagnostic: payload.diagnostic });
    }
    if (response.status === 404 && code === null) {
      // An older server with no /app-api family: honest degradation to the
      // landed local-artifact path (LLP 0024 amendment: identity absent).
      return Object.freeze({ status: 'unavailable', reason: 'route-absent', diagnostic: null });
    }
    throw discoveryError(payload, response.status);
  }
  if (payload?.artifactKind !== APP_API_DISCOVERY_ARTIFACT_KIND
    || payload.formatVersion !== APP_API_DISCOVERY_FORMAT_V1
    || typeof payload.appId !== 'string'
    || payload.tuple === null || typeof payload.tuple !== 'object'
    || payload.envelope === null || typeof payload.envelope !== 'object') {
    throw envelopeError(
      'SNAPBACK_APP_CLI_DISCOVERY_INVALID',
      'discovery document does not match the admission grammar',
    );
  }
  if (payload.envelope.state === 'absent') {
    return Object.freeze({ status: 'envelope-absent', discovery: payload });
  }
  if (payload.envelope.state !== 'current' || !HEX64.test(payload.envelope.sha256 ?? '')) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_DISCOVERY_INVALID',
      'discovery document carries an inadmissible envelope reference',
    );
  }
  return Object.freeze({ status: 'current', discovery: payload, sha256: payload.envelope.sha256 });
}

export async function fetchServedEnvelope(baseUrl, sha256, { expectedAppId = null } = {}) {
  if (!HEX64.test(sha256)) {
    throw envelopeError('SNAPBACK_APP_CLI_ENVELOPE_DIGEST_MISMATCH', 'envelope hash must be 64 lowercase hex characters');
  }
  const response = await fetchPublicArtifact(baseUrl, `/app-api/envelope/${sha256}`);
  if (!response.ok) {
    const payload = (() => {
      try { return JSON.parse(response.bodyText()); } catch { return null; }
    })();
    throw discoveryError(payload, response.status);
  }
  return verifyEnvelopeBytes(response.bytes, { expectedSha256: sha256, expectedAppId });
}

// --- The envelope cache -----------------------------------------------------
//
// Keyed by (normalized origin, app id, envelope hash), with a last-known-good
// pointer per (origin, app). Writes are atomic (temp + rename) under a
// best-effort advisory lock; per-origin and global bounds evict oldest-first.
// Offline, the cached envelope serves `--help`/`introspect`/`types` only.

export const DEFAULT_CACHE_LIMITS = Object.freeze({
  perOriginEnvelopes: 8,
  globalBytes: 64 * 1024 * 1024,
});

export const defaultCacheDir = () => join(homedir(), '.snapback', 'app-cli', 'envelopes');

const originKeyFor = (baseUrl) => {
  let origin;
  try {
    origin = new URL(baseUrl).origin.toLowerCase();
  } catch {
    throw envelopeError('SNAPBACK_APP_CLI_USAGE', `'${baseUrl}' is not an absolute server URL`);
  }
  return origin.replace(/[^a-z0-9.-]/g, '_');
};

const withAdvisoryLock = async (root, action) => {
  const lockPath = join(root, '.lock');
  const deadline = Date.now() + 2_000;
  let held = false;
  for (;;) {
    try {
      await mkdir(lockPath);
      held = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const age = await stat(lockPath).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity);
      if (age > 10_000) {
        // A stale lock from a dead process: advisory means best-effort, so
        // take it over rather than wedging every future engine run.
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) break; // advisory: proceed unlocked
      await new Promise((tick) => { setTimeout(tick, 50); });
    }
  }
  try {
    return await action();
  } finally {
    if (held) await rm(lockPath, { recursive: true, force: true }).catch(() => {});
  }
};

const atomicWrite = async (path, contents) => {
  const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await writeFile(temp, contents);
  await rename(temp, path);
};

const listCachedEnvelopes = async (dir) => {
  const entries = await readdir(dir).catch(() => []);
  const files = [];
  for (const name of entries) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info) files.push({ name, path, mtimeMs: info.mtimeMs, size: info.size });
  }
  return files.sort((a, b) => a.mtimeMs - b.mtimeMs);
};

export async function storeCachedEnvelope(cacheDir, baseUrl, verified, { limits = DEFAULT_CACHE_LIMITS } = {}) {
  const root = resolve(cacheDir);
  const appDir = join(root, originKeyFor(baseUrl), verified.envelope.appId);
  await mkdir(appDir, { recursive: true });
  return withAdvisoryLock(root, async () => {
    await atomicWrite(join(appDir, `${verified.sha256}.json`), verified.canonical);
    await atomicWrite(join(appDir, 'current'), `${verified.sha256}\n`);
    // Per-origin bound: keep the newest N envelopes for this app.
    const cached = await listCachedEnvelopes(appDir);
    const excess = cached.length - limits.perOriginEnvelopes;
    for (let index = 0; index < excess; index += 1) {
      await rm(cached[index].path, { force: true });
    }
    // Global bound: evict oldest-first across the whole cache.
    let total = 0;
    const everything = [];
    const origins = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const origin of origins) {
      if (!origin.isDirectory() || origin.name === '.lock') continue;
      const apps = await readdir(join(root, origin.name), { withFileTypes: true }).catch(() => []);
      for (const app of apps) {
        if (!app.isDirectory()) continue;
        const files = await listCachedEnvelopes(join(root, origin.name, app.name));
        for (const file of files) { total += file.size; everything.push(file); }
      }
    }
    everything.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of everything) {
      if (total <= limits.globalBytes) break;
      await rm(file.path, { force: true });
      total -= file.size;
    }
  });
}

export async function readCachedEnvelope(cacheDir, baseUrl, appId) {
  const appDir = join(resolve(cacheDir), originKeyFor(baseUrl), appId);
  const pointer = (await readFile(join(appDir, 'current'), 'utf8').catch(() => '')).trim();
  if (!HEX64.test(pointer)) return null;
  const bytes = await readFile(join(appDir, `${pointer}.json`)).catch(() => null);
  if (bytes === null) return null;
  // Verify-on-read: a corrupted or tampered cache entry degrades to absent
  // rather than shaping a call surface.
  try {
    return verifyEnvelopeBytes(bytes, { expectedSha256: pointer, expectedAppId: appId });
  } catch {
    return null;
  }
}

const FUNCTION_KINDS = new Map([
  ['Query', 'query'],
  ['LiveQuery', 'liveQuery'],
  ['Mutation', 'mutation'],
  ['Action', 'action'],
]);

const GENERATION_KEYS = ['schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash'];

const surfaceFromEnvelope = (verified, discovery, { offline }) => {
  const { envelope } = verified;
  const functions = envelope.functions.functions.map((fn) => {
    const kind = FUNCTION_KINDS.get(fn?.kind);
    if (!kind || typeof fn?.name !== 'string' || typeof fn?.id !== 'string') {
      throw envelopeError(
        'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
        'envelope projection contains an unsupported function entry',
        { function: fn?.name ?? null, kind: fn?.kind ?? null },
      );
    }
    return Object.freeze({
      id: fn.id,
      name: fn.name,
      kind,
      authRequirement: fn.authRequirement ?? null,
      argsSchema: envelope.operations[fn.id]?.argsSchema ?? null,
    });
  });
  const tupleIdentity = discovery === null ? null : {
    schemaVersion: discovery.tuple.schemaVersion,
    appId: discovery.appId,
    schemaHash: discovery.tuple.schemaHash,
    bundleHash: discovery.tuple.bundleHash,
    inputsHash: discovery.tuple.inputsHash,
  };
  const generation = tupleIdentity !== null
    && GENERATION_KEYS.every((key) => typeof tupleIdentity[key] === 'string' && tupleIdentity[key].length > 0)
    ? Object.freeze(tupleIdentity)
    : null;
  // The discovery tuple and the envelope must agree on the identity they
  // both carry; a disagreement means the two documents describe different
  // deployments and neither may shape a call.
  if (discovery !== null) {
    const tupleInputs = discovery.tuple.inputsHash ?? null;
    const tupleBundle = discovery.tuple.bundleHash ?? null;
    const envelopeInputs = envelope.inputsHash ?? null;
    const envelopeBundle = envelope.bundleHash ?? null;
    if ((tupleInputs !== null && envelopeInputs !== null && tupleInputs !== envelopeInputs)
      || (tupleBundle !== null && envelopeBundle !== null && tupleBundle !== envelopeBundle)) {
      throw envelopeError(
        'SNAPBACK_APP_CLI_ENVELOPE_CORRESPONDENCE_FAILED',
        'discovery tuple identity disagrees with the fetched envelope',
      );
    }
  }
  return Object.freeze({
    source: 'served',
    offline,
    appId: envelope.appId,
    envelopeSha256: verified.sha256,
    bundleHash: envelope.bundleHash ?? null,
    generation,
    functions: Object.freeze(functions),
  });
};

/// Load a served app surface with zero local artifact files.
///
/// Online: discovery → cached-or-fetched content-addressed envelope →
/// client-side verification → cache (rotating the last-known-good pointer on
/// redeploy). Offline: the cached envelope only, and the surface is marked so
/// projections keep it to `--help`/`introspect`/`types`.
export async function loadServedApp(baseUrl, {
  cacheDir = defaultCacheDir(),
  offline = false,
  appId = null,
} = {}) {
  if (offline) {
    if (typeof appId !== 'string' || appId.length === 0) {
      throw envelopeError('SNAPBACK_APP_CLI_USAGE', 'offline served mode requires --app <appId> to select the cached surface');
    }
    const cached = await readCachedEnvelope(cacheDir, baseUrl, appId);
    if (cached === null) {
      throw envelopeError(
        'SNAPBACK_APP_CLI_ENVELOPE_ABSENT',
        'no verified cached envelope for this server and app; run online first',
        { subCause: 'cache-empty' },
      );
    }
    return surfaceFromEnvelope(cached, null, { offline: true });
  }
  const discovered = await discoverServedApp(baseUrl);
  if (discovered.status === 'unavailable') {
    return discovered; // the caller owns the local-artifact fallback
  }
  if (discovered.status === 'envelope-absent') {
    // Residue #10: an envelope-less sessions generation is an identity-
    // establishment failure for a served engine (exit 7), never exit 8.
    throw envelopeError(
      'SNAPBACK_APP_CLI_ENVELOPE_ABSENT',
      'this generation activated without an API envelope; redeploy with envelope members to serve the app CLI',
      { subCause: 'envelope-absent', appId: discovered.discovery.appId },
    );
  }
  const cached = await readCachedEnvelope(cacheDir, baseUrl, discovered.discovery.appId);
  const verified = cached !== null && cached.sha256 === discovered.sha256
    ? cached
    : await fetchServedEnvelope(baseUrl, discovered.sha256, {
      expectedAppId: discovered.discovery.appId,
    });
  if (cached === null || cached.sha256 !== discovered.sha256) {
    await storeCachedEnvelope(cacheDir, baseUrl, verified);
  }
  return surfaceFromEnvelope(verified, discovered.discovery, { offline: false });
}

// --- the `app-cli.target` eligibility descriptor (LLP 0062 §4) --------------
//
// §4's rule is that the engine "never infers any of this from a URL" — and
// that rule has teeth only because the target states its own eligibility. The
// descriptor rides the capability manifest and is echoed by sessions
// discovery, so the engine reads it credential-free, before selecting any
// principal. Absence is capability-absent, never an assumed yes.

/** The closed principal-class vocabulary of §4's matrix. */
export const PRINCIPAL_CLASSES = Object.freeze(['anonymous', 'dev', 'session', 'agent']);

/** Read the descriptor a discovery document echoes, or null when absent. */
export const targetDescriptor = (discovery) => {
  const descriptor = discovery?.appCliDescriptor ?? null;
  if (descriptor === null || typeof descriptor !== 'object') return null;
  if (descriptor.capabilityId !== 'app-cli.target') return null;
  if (!Array.isArray(descriptor.principalClasses)) return null;
  return descriptor;
};

/**
 * Whether the target states it admits a principal class. A capability-absent
 * target admits only `anonymous` — the engine still sends anonymous calls and
 * lets the server's own invocation gate answer, which is exactly §4's
 * "mirrors that and no more"; every credentialed lane refuses client-side
 * rather than presenting a credential to a target that never claimed to take
 * one.
 */
export function targetAdmitsPrincipal(discovery, principalClass) {
  if (!PRINCIPAL_CLASSES.includes(principalClass)) {
    throw envelopeError(
      'SNAPBACK_APP_CLI_USAGE',
      `unknown principal class '${principalClass}'`,
      { admitted: PRINCIPAL_CLASSES },
    );
  }
  const descriptor = targetDescriptor(discovery);
  if (descriptor === null) return principalClass === 'anonymous';
  return descriptor.principalClasses.includes(principalClass);
}

/**
 * The typed refusal a credentialed lane raises when the target does not state
 * the class. Presenting a credential anyway is the disclosure this refusal
 * exists to prevent.
 */
export function refuseUnadmittedPrincipal(discovery, principalClass) {
  const descriptor = targetDescriptor(discovery);
  throw envelopeError(
    'SNAPBACK_APP_CLI_PRINCIPAL_UNSUPPORTED',
    descriptor === null
      ? `this target advertises no app-cli.target capability, so '${principalClass}' cannot be presented`
      : `this target does not admit the '${principalClass}' principal class`,
    {
      principalClass,
      admitted: descriptor === null ? ['anonymous'] : descriptor.principalClasses,
    },
  );
}
