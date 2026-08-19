// RQS host machinery for the Cloudflare coordinator arm (LLP 0090 rollout
// step 4, ENG-25455): eligibility derivation, the HostPlan query subset this
// arm can evaluate natively, params-v1 substitution, routes-manifest shape
// validation, the DO-storage resume keyring, and token decode/verification.
//
// Sharing mechanism: the token/digest algebra is NOT forked — this module
// imports `packages/snapback-client/rqs.mjs` (the same module the browser
// client and the local-arm parity tests use) by relative path, exactly like
// the coordinator already imports `packages/snapback-harness/envelope.mjs`.
// esbuild (Miniflare harness) and Wrangler both bundle the relative import
// into the deployed Worker, so both arms run one algebra.
//
// @ref LLP 0091#0a--token-and-digest-cryptography — mint/verify, keyring
//   custody (coordinator DO storage on this arm), generation digest.
// @ref LLP 0092#0c--manifest--admission — rqsEligible derivation and the
//   params-v1 mapping this arm enforces server-side.

import {
  RqsMintRefusal,
  argsHash,
  digestOfRows,
  hex,
  hmacSha256,
  jcs,
  mintTokenWire,
  sha256,
  tokenTranscript,
} from '../../packages/snapback-client/rqs.mjs';

export { RqsMintRefusal, argsHash, digestOfRows, mintTokenWire };

export const RESUME_TOKEN_WIRE_PREFIX = 'sbrt1';
export const RESUME_TOKEN_MAX_WIRE_BYTES = 1024;
export const RESUME_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const RESUME_KEY_ROTATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const RESUME_KEY_RETIRED_OVERLAP_MS = 14 * 24 * 60 * 60 * 1000;
export const RESUME_KEY_RETIRED_OVERLAP_KEYS = 2;
export const RESUME_KEY_PREFIX = 'sbrq_';
export const RESUME_DIGEST_CONTRACT_VERSION = 'rqs-0A-v1';

/// Per-cause refusal codes (LLP 0091 §0B.6 registry; the subset this arm can
/// produce — rung-1 table-set and rung-2 witness machinery are deferred on
/// this arm, so their codes never fire here).
export const refusal = Object.freeze({
  TOKEN_MALFORMED: 'SNAPBACK_RESUME_TOKEN_MALFORMED',
  TOKEN_OVERSIZE: 'SNAPBACK_RESUME_TOKEN_OVERSIZE',
  MAC_INVALID: 'SNAPBACK_RESUME_MAC_INVALID',
  KEY_UNKNOWN: 'SNAPBACK_RESUME_KEY_UNKNOWN',
  KEY_RETIRED: 'SNAPBACK_RESUME_KEY_RETIRED',
  TOKEN_EXPIRED: 'SNAPBACK_RESUME_TOKEN_EXPIRED',
  APP_MISMATCH: 'SNAPBACK_RESUME_APP_MISMATCH',
  GENERATION_STALE: 'SNAPBACK_RESUME_GENERATION_STALE',
  STREAM_MISMATCH: 'SNAPBACK_RESUME_STREAM_MISMATCH',
  QUERY_MISMATCH: 'SNAPBACK_RESUME_QUERY_MISMATCH',
  NOT_ELIGIBLE: 'SNAPBACK_RESUME_NOT_ELIGIBLE',
  DIGEST_KIND_MISMATCH: 'SNAPBACK_RESUME_DIGEST_KIND_MISMATCH',
  VERSION_IMPLAUSIBLE: 'SNAPBACK_RESUME_VERSION_IMPLAUSIBLE',
});

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Hash tags shared with cloudflare-arm identities (LLP 0091 §0A.6 / the
// step-1 interim queryArtifact rule, byte-compatible with crates/snapback/src/rqs.rs).
// ---------------------------------------------------------------------------

function sha256Hex(bytes) {
  return hex(sha256(bytes));
}

function tagged(tag, text) {
  const tagBytes = encoder.encode(`${tag}\0`);
  const bodyBytes = encoder.encode(text);
  const joined = new Uint8Array(tagBytes.length + bodyBytes.length);
  joined.set(tagBytes);
  joined.set(bodyBytes, tagBytes.length);
  return joined;
}

/// `sha256:`-prefixed identity of a canonical JSON value (crates/snapback/src/rqs.rs
/// `sha256_identity` parity: untagged SHA-256 over the JCS bytes).
export function sha256Identity(value) {
  return `sha256:${sha256Hex(encoder.encode(jcs(value)))}`;
}

/// Interim content-derived per-function artifact identity (LLP 0091 step-1
/// amendment item 3, standing after step 4): stable within a generation,
/// rotates whenever the served function definition changes.
export function queryArtifactHash(functionDefinition) {
  return `sha256:${sha256Hex(tagged('snapback-rqs-query-artifact-v1', jcs(functionDefinition)))}`;
}

/// LLP 0091 §0A.6 `resumeConfigIdentity`.
export function resumeConfigIdentity(journalPrunePolicy, authMode, routeManifestHash) {
  const canonical = jcs({
    journalPrunePolicy,
    authMode,
    routeManifestHash,
    digestContractVersion: RESUME_DIGEST_CONTRACT_VERSION,
  });
  return `sha256:${sha256Hex(tagged('snapback-rqs-config-v1', canonical))}`;
}

/// LLP 0091 §0A.6 `generation` digest: length-framed components under the
/// `snapback-generation-v1` tag, published as `gen1:` + hex.
export function generationDigest(
  deploymentIdentity,
  schemaIdentity,
  functionsIdentity,
  capabilityIdentity,
  configIdentity,
) {
  const parts = [encoder.encode('snapback-generation-v1\0')];
  for (const component of [
    deploymentIdentity,
    schemaIdentity,
    functionsIdentity,
    capabilityIdentity,
    configIdentity,
  ]) {
    const bytes = encoder.encode(component);
    const frame = new Uint8Array(8);
    new DataView(frame.buffer).setBigUint64(0, BigInt(bytes.length));
    parts.push(frame, bytes);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return `gen1:${sha256Hex(joined)}`;
}

// ---------------------------------------------------------------------------
// Eligibility + HostPlan query subset (LLP 0092 §0C.2 on this arm)
// ---------------------------------------------------------------------------

/// The plan `value` expressions this arm's native evaluator supports. The
/// derivation is fail-closed: anything outside the subset makes the function
/// non-eligible AND non-evaluable, never a silently wrong answer. Mirrors
/// the authority/ambient-input refusals of crates/snapback/src/manifest.rs
/// (`value_expr_uses_authority_or_ambient_input`) by whitelist instead of
/// blacklist.
function supportedFilterValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  if (keys[0] === 'Arg') return typeof value.Arg === 'string';
  if (keys[0] === 'Literal') return true;
  return false;
}

export function hostPlanQuery(fn) {
  const plan = fn?.runtime?.HostPlan?.Query;
  return plan && typeof plan === 'object' ? plan : null;
}

/// Validate a HostPlan query against the subset this arm evaluates natively:
/// one declared table, `Eq` filters over Arg/Literal values, field order
/// clauses, an optional positive integer limit, and no membership filters.
export function validateHostPlanQuery(plan, schemaTables) {
  if (!plan || typeof plan !== 'object') return 'missing plan';
  const table = schemaTables.get(plan.table);
  if (!table) return `unknown table ${plan.table}`;
  const fields = new Set([(table.fields || []).map((field) => field.name), ['_id', '_createdAt', '_updatedAt', '_version']].flat());
  if (!Array.isArray(plan.filters)) return 'filters must be an array';
  for (const filter of plan.filters) {
    if (!filter || filter.op !== 'Eq' || typeof filter.field !== 'string') {
      return 'unsupported filter';
    }
    if (!fields.has(filter.field)) return `unknown filter field ${filter.field}`;
    if (!supportedFilterValue(filter.value)) return 'unsupported filter value';
  }
  const membership = plan.membershipFilters ?? plan.membership_filters ?? [];
  if (!Array.isArray(membership) || membership.length !== 0) {
    return 'membership filters are not supported';
  }
  const order = plan.order || [];
  if (!Array.isArray(order)) return 'order must be an array';
  for (const clause of order) {
    if (!clause || typeof clause.field !== 'string' || !fields.has(clause.field)) {
      return 'unsupported order field';
    }
    if (clause.direction !== 'Asc' && clause.direction !== 'Desc') return 'unsupported order direction';
  }
  if (plan.limit !== null && plan.limit !== undefined) {
    if (!Number.isSafeInteger(plan.limit) || plan.limit <= 0) return 'unsupported limit';
  }
  return null;
}

/// The `rqsEligible` predicate + digest-kind selector, derived (never
/// authored) from the compiled function definition — the same conjunction
/// crates/snapback/src/manifest.rs `rqs_eligible_digest_kind` computes on the local arm:
/// declared `authorityIndependent` on a public LiveQuery with no authority
/// or ambient inputs, plus the closed-inputs proof (a HostPlan query with a
/// complete `singleTable` read summary). On this deploy-time-compiled arm the
/// facts ride the app bundle's function entries; opaque-JS handlers can never
/// be eligible, exactly as on the local arm.
export function rqsEligibleDigestKind(fn, schemaTables) {
  if (fn?.authorityIndependent !== true) return null;
  if (fn.kind !== 'LiveQuery') return null;
  if (fn.authRequirement !== 'public') return null;
  if (Array.isArray(fn.uses) && fn.uses.length > 0) return null;
  const plan = hostPlanQuery(fn);
  if (!plan) return null;
  if (validateHostPlanQuery(plan, schemaTables) !== null) return null;
  const summary = fn.readSetSummary;
  if (
    !summary
    || summary.mode !== 'singleTable'
    || summary.authScopeField != null
    || summary.primaryTable !== plan.table
    || !Array.isArray(summary.tables)
    || summary.tables.length !== 1
    || summary.tables[0] !== plan.table
  ) {
    return null;
  }
  const ordered = (Array.isArray(plan.order) && plan.order.length > 0) || plan.limit != null;
  return ordered ? 'seq1' : 'mset1';
}

/// The `publicInline` disclosure fact (LLP 0092 §0C.3): accepted only on a
/// query with a valid `authorityIndependent` declaration. On this arm the
/// validation profile is the eligibility derivation itself (fail-closed:
/// stricter than the local arm, never wider).
export function publicInlineFact(fn, schemaTables) {
  return fn?.publicInline === true && rqsEligibleDigestKind(fn, schemaTables) !== null;
}

/// Compile the closed HostPlan subset this arm admits into the ordinary
/// storageQuery plan shape. A null return preserves a fail-safe path for a
/// future HostPlan residue that this compiler does not yet understand.
export function compileHostPlanStorageQuery(plan, args) {
  const filters = [];
  for (const filter of plan.filters || []) {
    if (!filter || filter.op !== 'Eq' || !supportedFilterValue(filter.value)) return null;
    const value = Object.hasOwn(filter.value, 'Arg')
      ? args?.[filter.value.Arg]
      : filter.value.Literal;
    // Eq against null/missing matches nothing under the canonical
    // three-valued semantics; avoid asking the typed storage compiler to
    // admit a value that cannot produce a row.
    if (value === null || value === undefined) return { empty: true, plan: null };
    filters.push({ field: filter.field, op: 'Eq', value: { Literal: value } });
  }
  return {
    empty: false,
    plan: {
      table: plan.table,
      indexed_by: plan.indexed_by ?? plan.indexedBy ?? null,
      filters,
      order: plan.order || [],
      limit: plan.limit ?? null,
    },
  };
}

function compareOrderValues(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/// Evaluate a validated HostPlan query over the table's parsed rows. `Eq`
/// against an explicit null matches NOTHING (the ENG-23606 canonical
/// three-valued semantics both Rust hosts and the JS overlay follow).
export function evaluateHostPlanQuery(plan, args, rows) {
  const resolved = plan.filters.map((filter) => ({
    field: filter.field,
    value: 'Arg' in filter.value ? args?.[filter.value.Arg] : filter.value.Literal,
  }));
  let result = rows.filter((row) => resolved.every((filter) => {
    if (filter.value === null || filter.value === undefined) return false;
    const held = filter.field === '_id' ? row._id : row[filter.field];
    return held === filter.value;
  }));
  const order = plan.order || [];
  if (order.length > 0) {
    result = [...result].sort((left, right) => {
      for (const clause of order) {
        const cmp = compareOrderValues(left[clause.field], right[clause.field]);
        if (cmp !== 0) return clause.direction === 'Desc' ? -cmp : cmp;
      }
      // Stable, deterministic tiebreak so seq1 digests are reproducible.
      return compareOrderValues(left._id, right._id);
    });
  }
  if (plan.limit != null) result = result.slice(0, plan.limit);
  return result;
}

// ---------------------------------------------------------------------------
// Routes manifest (0C artifact compiled into the Worker) + params-v1
// ---------------------------------------------------------------------------

const ROUTE_SEGMENT = /^[^/]+$/;

function routeShape(pattern) {
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) return null;
  if (pattern === '/') return [];
  if (pattern.endsWith('/')) return null;
  const segments = pattern.slice(1).split('/');
  const shape = [];
  for (const segment of segments) {
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
      shape.push({ param: name });
    } else {
      if (!ROUTE_SEGMENT.test(segment) || segment.includes(':')) return null;
      shape.push({ static: segment });
    }
  }
  return shape;
}

function shapesOverlap(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left.static !== undefined && right.static !== undefined && left.static !== right.static) {
      return false;
    }
  }
  return true;
}

/// Validate the compiled routes manifest (LLP 0092 §0C.1): exact v1 pattern
/// shapes, no overlapping patterns, 1..32 queries per entry, every named
/// function a known query kind with a statically valid params-v1 mapping.
/// Returns null or a human-readable reason (the deploy-time analog of the
/// local arm's `SNAPBACK_ROUTES_MANIFEST_INVALID` ensure refusal — this arm
/// treats an invalid compiled manifest as absent, fail-closed).
export function validateRoutesManifest(manifest, functionsByName, schemaTables) {
  if (!manifest || typeof manifest !== 'object') return 'manifest must be an object';
  if (manifest.formatVersion !== 1) return 'unrecognized formatVersion';
  if (!Array.isArray(manifest.routes) || manifest.routes.length === 0) return 'routes must be a non-empty array';
  const shapes = [];
  for (const entry of manifest.routes) {
    const shape = routeShape(entry?.route);
    if (shape === null) return `invalid route pattern ${String(entry?.route)}`;
    for (const [existingRoute, existingShape] of shapes) {
      if (shapesOverlap(shape, existingShape)) {
        return `route patterns ${existingRoute} and ${entry.route} can match the same path`;
      }
    }
    shapes.push([entry.route, shape]);
    const params = new Set(shape.filter((segment) => segment.param).map((segment) => segment.param));
    if (!Array.isArray(entry.queries) || entry.queries.length === 0 || entry.queries.length > 32) {
      return `route ${entry.route} must name 1..32 queries`;
    }
    for (const spec of entry.queries) {
      const fn = functionsByName(spec?.function);
      if (!fn) return `route ${entry.route} names unknown function ${String(spec?.function)}`;
      if (fn.kind !== 'LiveQuery' && fn.kind !== 'Query') {
        return `route ${entry.route} names non-query function ${spec.function}`;
      }
      const mappingError = validateArgsMapping(spec.args, params, fn, schemaTables);
      if (mappingError) return `route ${entry.route} query ${spec.function}: ${mappingError}`;
    }
  }
  return null;
}

function isPlainRouteObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isParamRef(value) {
  return (
    isPlainRouteObject(value)
    && Object.keys(value).length === 1
    && Object.hasOwn(value, '$param')
  );
}

/// AST-derived per-arg route types (LLP 0092 §0E.6 step-3 sharpening): a plan
/// filter comparing a schema field against `Arg(name)` types that arg from
/// the schema field type. This remains the byte-compatible depth-1 authority.
export function functionRouteArgTypes(fn, schemaTables) {
  const plan = hostPlanQuery(fn);
  if (!plan) return new Map();
  const table = schemaTables.get(plan.table);
  const fieldTypes = new Map((table?.fields || []).map((field) => [field.name, field.type]));
  const types = new Map();
  for (const filter of plan.filters || []) {
    if (!filter?.value || typeof filter.value !== 'object' || typeof filter.value.Arg !== 'string') continue;
    const fieldType = filter.field === '_id' ? 'string' : fieldTypes.get(filter.field);
    if (fieldType === 'string') types.set(filter.value.Arg, 'string');
    else if (fieldType === 'integer') types.set(filter.value.Arg, 'integer');
    else if (fieldType === 'real') types.set(filter.value.Arg, 'number');
    else if (fieldType === 'boolean') types.set(filter.value.Arg, 'boolean');
  }
  return types;
}

/// Contract-derived route types for object-reachable argument paths.
/// @ref LLP 0092#dated-amendment-structured-route-group-arguments-2026-08-08
///   — LLP 0131's carried argsContract replaces the old no-schema premise at
///   nested positions, while depth 1 keeps functionRouteArgTypes unchanged.
export function functionRouteNestedArgTypes(fn) {
  const types = new Map();
  const collect = (fields, path) => {
    if (!Array.isArray(fields)) return;
    for (const field of fields) {
      if (!field || typeof field.name !== 'string') continue;
      const nextPath = [...path, field.name];
      const node = field.value;
      let type = null;
      if (['string', 'principal', 'assetRef', 'id'].includes(node?.kind)) type = 'string';
      else if (node?.kind === 'integer') type = 'integer';
      else if (node?.kind === 'finiteReal') type = 'number';
      else if (node?.kind === 'boolean') type = 'boolean';
      else if (node?.kind === 'object') collect(node.fields, nextPath);
      if (type !== null) types.set(JSON.stringify(nextPath), type);
    }
  };
  collect(fn?.argsContract?.fields, []);
  return types;
}

function validateArgsMapping(mapping, routeParams, fn, schemaTables) {
  if (!isPlainRouteObject(mapping)) {
    return 'args mapping must be an object';
  }
  const argTypes = functionRouteArgTypes(fn, schemaTables);
  const nestedArgTypes = functionRouteNestedArgTypes(fn);
  const visit = (value, path, insideArray) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const error = visit(entry, path, true);
        if (error) return error;
      }
      return null;
    }
    if (!isPlainRouteObject(value)) {
      return value === null || ['string', 'number', 'boolean'].includes(typeof value)
        ? null
        : 'unsupported literal';
    }
    if (Object.hasOwn(value, '$param')) {
      if (path.length === 0) return 'a bare root $param has no named arg position';
      if (insideArray) return 'a $param reference is nested inside an array literal';
      if (!isParamRef(value) || typeof value.$param !== 'string') {
        return 'malformed $param reference';
      }
      if (!routeParams.has(value.$param)) return `$param ${value.$param} is not in the route pattern`;
      const type = path.length === 1
        ? argTypes.get(path[0])
        : nestedArgTypes.get(JSON.stringify(path));
      if (type === undefined) {
        return path.length === 1
          ? `referenced arg ${path[0]} has no schema-typed target`
          : `referenced path ${path.join('.')} has no contract-typed target`;
      }
      return null;
    }
    for (const [name, entry] of Object.entries(value)) {
      const error = visit(entry, [...path, name], insideArray);
      if (error) return error;
    }
    return null;
  };
  return visit(mapping, [], false);
}

const DECIMAL_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/// Per-request params-v1 substitution (LLP 0092 §0E.6): decode each `$param`
/// by its depth-1 AST type or nested argument-contract type; any failure is
/// `SNAPBACK_BUNDLE_PARAMS_INVALID` at the endpoint.
export function substituteParamsV1(mapping, params, argTypes, nestedArgTypes) {
  const substitute = (value, path, insideArray) => {
    if (Array.isArray(value)) {
      const output = [];
      for (const entry of value) {
        const substituted = substitute(entry, path, true);
        if (substituted.error) return substituted;
        output.push(substituted.value);
      }
      return { value: output };
    }
    if (isPlainRouteObject(value)) {
      if (Object.hasOwn(value, '$param')) {
        if (path.length === 0 || insideArray || !isParamRef(value) || typeof value.$param !== 'string') {
          return { error: 'untypable or malformed route parameter reference' };
        }
        const raw = params[value.$param];
        if (typeof raw !== 'string') return { error: `missing route param ${value.$param}` };
        const type = path.length === 1
          ? argTypes.get(path[0])
          : nestedArgTypes.get(JSON.stringify(path));
        if (type === 'string') {
          return { value: raw };
        } else if (type === 'number' || type === 'integer') {
          if (!DECIMAL_NUMBER.test(raw)) return { error: `param ${value.$param} is not a number` };
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) return { error: `param ${value.$param} is not finite` };
          let canonical;
          try {
            canonical = jcs(parsed);
          } catch {
            return { error: `param ${value.$param} does not round-trip` };
          }
          if (canonical !== raw) return { error: `param ${value.$param} does not round-trip` };
          if (type === 'integer' && !Number.isSafeInteger(parsed)) {
            return { error: `param ${value.$param} is not an in-band integer` };
          }
          return { value: parsed };
        } else if (type === 'boolean') {
          if (raw !== 'true' && raw !== 'false') {
            return { error: `param ${value.$param} is not a boolean` };
          }
          return { value: raw === 'true' };
        } else {
          return { error: `arg path ${path.join('.')} has no typed target` };
        }
      }
      const output = {};
      for (const [name, entry] of Object.entries(value)) {
        const substituted = substitute(entry, [...path, name], insideArray);
        if (substituted.error) return substituted;
        output[name] = substituted.value;
      }
      return { value: output };
    }
    return { value };
  };
  const substituted = substitute(mapping, [], false);
  if (substituted.error) return substituted;
  if (!isPlainRouteObject(substituted.value)) {
    return { error: 'args mapping must be an object' };
  }
  return { args: substituted.value };
}

// ---------------------------------------------------------------------------
// DO-storage resume keyring (LLP 0091 §0A.1 custody: coordinator DO storage)
// ---------------------------------------------------------------------------

export const RESUME_KEYS_TABLE = '_snapback_rqs_keys';

export function ensureResumeKeyTable(sql) {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS ${RESUME_KEYS_TABLE} (
       key_id TEXT PRIMARY KEY,
       secret TEXT NOT NULL,
       created_at_ms INTEGER NOT NULL,
       retired_at_ms INTEGER
     )`,
  );
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlNoPadEncode(bytes) {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : null;
    const c = index + 2 < bytes.length ? bytes[index + 2] : null;
    out += BASE64URL[a >> 2];
    out += BASE64URL[((a & 0x03) << 4) | (b === null ? 0 : b >> 4)];
    if (b !== null) out += BASE64URL[((b & 0x0f) << 2) | (c === null ? 0 : c >> 6)];
    if (c !== null) out += BASE64URL[c & 0x3f];
  }
  return out;
}

export function base64UrlNoPadDecode(text) {
  if (typeof text !== 'string' || /[^A-Za-z0-9_-]/.test(text)) return null;
  const remainder = text.length % 4;
  if (remainder === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const ch of text) {
    const value = BASE64URL.indexOf(ch);
    if (value === -1) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[offset] = (buffer >> bits) & 0xff;
      offset += 1;
    }
  }
  // Reject non-canonical trailing bits so decode is injective.
  if ((buffer & ((1 << bits) - 1)) !== 0) return null;
  return out.subarray(0, offset);
}

const KEY_ID_PATTERN = /^sbrq_[A-Za-z0-9_-]{22}$/;

function readResumeKeys(sql) {
  return [...sql.exec(
    `SELECT key_id, secret, created_at_ms, retired_at_ms FROM ${RESUME_KEYS_TABLE}`,
  )].map((record) => ({
    keyId: String(record.key_id),
    secret: String(record.secret),
    createdAtMs: Number(record.created_at_ms),
    retiredAtMs: record.retired_at_ms == null ? null : Number(record.retired_at_ms),
  }));
}

function mintResumeKey(sql, nowMs) {
  const idBytes = new Uint8Array(16);
  crypto.getRandomValues(idBytes);
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const keyId = `${RESUME_KEY_PREFIX}${base64UrlNoPadEncode(idBytes)}`;
  sql.exec(
    `INSERT INTO ${RESUME_KEYS_TABLE} (key_id, secret, created_at_ms) VALUES (?, ?, ?)`,
    keyId,
    base64UrlNoPadEncode(secretBytes),
    nowMs,
  );
  return { keyId, secret: secretBytes };
}

/// The active minting key, rotating on the §0A.1 cadence. The ring is purely
/// storage-resident — no in-memory copy — so hibernation, eviction, and DO
/// restart trivially preserve it (key loss stays availability-only: a wiped
/// ring refuses outstanding tokens to rung 3).
export function activeResumeKey(sql, nowMs) {
  const keys = readResumeKeys(sql);
  const active = keys
    .filter((key) => key.retiredAtMs === null)
    .sort((left, right) => right.createdAtMs - left.createdAtMs)[0] ?? null;
  if (active && nowMs - active.createdAtMs < RESUME_KEY_ROTATION_AGE_MS) {
    const secret = base64UrlNoPadDecode(active.secret);
    if (secret && secret.length === 32) return { keyId: active.keyId, secret };
    // Corrupt secret: availability-only — retire it and mint fresh.
  }
  if (active) {
    sql.exec(`UPDATE ${RESUME_KEYS_TABLE} SET retired_at_ms = ? WHERE key_id = ?`, nowMs, active.keyId);
  }
  const minted = mintResumeKey(sql, nowMs);
  pruneResumeKeys(sql, nowMs);
  return minted;
}

function pruneResumeKeys(sql, nowMs) {
  const retired = readResumeKeys(sql)
    .filter((key) => key.retiredAtMs !== null)
    .sort((left, right) => right.retiredAtMs - left.retiredAtMs);
  const keep = new Set(
    retired
      .slice(0, RESUME_KEY_RETIRED_OVERLAP_KEYS)
      .filter((key) => nowMs - key.retiredAtMs <= RESUME_KEY_RETIRED_OVERLAP_MS)
      .map((key) => key.keyId),
  );
  for (const key of retired) {
    if (!keep.has(key.keyId)) {
      sql.exec(`DELETE FROM ${RESUME_KEYS_TABLE} WHERE key_id = ?`, key.keyId);
    }
  }
}

function verificationResumeKey(sql, keyId, nowMs) {
  const keys = readResumeKeys(sql);
  const key = keys.find((entry) => entry.keyId === keyId);
  if (!key) return { error: refusal.KEY_UNKNOWN };
  if (key.retiredAtMs !== null) {
    const retired = keys
      .filter((entry) => entry.retiredAtMs !== null)
      .sort((left, right) => right.retiredAtMs - left.retiredAtMs)
      .slice(0, RESUME_KEY_RETIRED_OVERLAP_KEYS);
    const insideWindow = retired.some((entry) => entry.keyId === keyId)
      && nowMs - key.retiredAtMs <= RESUME_KEY_RETIRED_OVERLAP_MS;
    if (!insideWindow) return { error: refusal.KEY_RETIRED };
  }
  const secret = base64UrlNoPadDecode(key.secret);
  if (!secret || secret.length !== 32) return { error: refusal.KEY_UNKNOWN };
  return { secret };
}

const TOKEN_BODY_KEYS = new Set([
  'app', 'generation', 'versionStream', 'version', 'queryArtifact',
  'argsHash', 'digestKind', 'contentDigest', 'issuedAt', 'authPartition',
]);

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

/// Decode and cryptographically verify a presented `tokenWire` (crates/snapback/src/rqs.rs
/// `decode_and_verify` parity): framing, size cap, key resolution under the
/// overlap window, MAC over the rebuilt transcript, and the `issuedAt`
/// staleness backstop. Semantic admission is the caller's.
export function decodeAndVerifyToken(sql, tokenWire, nowMs, maxAgeMs = RESUME_TOKEN_MAX_AGE_MS) {
  if (typeof tokenWire !== 'string') return { error: refusal.TOKEN_MALFORMED };
  if (tokenWire.length > RESUME_TOKEN_MAX_WIRE_BYTES) return { error: refusal.TOKEN_OVERSIZE };
  const parts = tokenWire.split('.');
  if (parts.length !== 4) return { error: refusal.TOKEN_MALFORMED };
  const [prefix, keyId, bodyPart, macPart] = parts;
  if (prefix !== RESUME_TOKEN_WIRE_PREFIX) return { error: refusal.TOKEN_MALFORMED };
  if (!KEY_ID_PATTERN.test(keyId)) return { error: refusal.TOKEN_MALFORMED };
  const bodyBytes = base64UrlNoPadDecode(bodyPart);
  const macBytes = base64UrlNoPadDecode(macPart);
  if (!bodyBytes || !macBytes || macBytes.length !== 32) return { error: refusal.TOKEN_MALFORMED };
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes));
  } catch {
    return { error: refusal.TOKEN_MALFORMED };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: refusal.TOKEN_MALFORMED };
  // `deny_unknown_fields` posture: only the minting family decodes its own
  // tokens; unknown fields require sbrt2 (LLP 0091 §0A.1).
  for (const key of Object.keys(body)) {
    if (!TOKEN_BODY_KEYS.has(key)) return { error: refusal.TOKEN_MALFORMED };
  }
  if (
    typeof body.app !== 'string'
    || typeof body.generation !== 'string'
    || typeof body.versionStream !== 'string'
    || !Number.isSafeInteger(body.version) || body.version < 0
    || typeof body.queryArtifact !== 'string'
    || typeof body.argsHash !== 'string'
    || typeof body.digestKind !== 'string'
    || typeof body.contentDigest !== 'string'
    || !Number.isSafeInteger(body.issuedAt) || body.issuedAt < 0
  ) {
    return { error: refusal.TOKEN_MALFORMED };
  }
  if (Object.hasOwn(body, 'authPartition')) {
    // Reserved v2 door: absent (not null) in v1 tokens.
    return { error: refusal.TOKEN_MALFORMED };
  }
  const key = verificationResumeKey(sql, keyId, nowMs);
  if (key.error) return { error: key.error };
  const expected = hmacSha256(key.secret, tokenTranscript(keyId, body));
  if (!constantTimeEqual(expected, macBytes)) return { error: refusal.MAC_INVALID };
  if (body.issuedAt > nowMs) return { error: refusal.TOKEN_MALFORMED };
  if (nowMs - body.issuedAt > maxAgeMs) return { error: refusal.TOKEN_EXPIRED };
  return { body };
}
