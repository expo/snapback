// Channel A boot-payload consumption (LLP 0090 D2 rollout step 3,
// ENG-25454; contract LLP 0092 §0E.1/§0C.5).
//
// The serving seam embeds the read-mode bundle response as a non-executable
// `<script type="application/json" id="__snapback_boot">` data block. This
// module reads it before mount and builds the preload registry keyed by the
// canonical authority-independent alias key (`rqsEntryKey` — query name +
// JCS args, deliberately no authority component), so an anonymously minted
// preload is consumable under any authenticated store identity without a
// duplicate store or subscription. Entries are handed to the kit's
// `preloadedResume` seam, which digest-verifies and arbitrates against
// Channel B persisted state before anything renders (retained/pending until
// the first authoritative answer).

import {
  validateAuthorizationInvalidationConnection,
  validateResolutionTicket,
  validateResyncObligation,
  validateScopeId,
} from '@expo/snapback-contract/auth-invalidation';
import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import {
  argsHash,
  rowsMatchDigest,
  sha256 as sha256PureJs,
} from './rqs.mjs';
import { rqsEntryKey } from './rqs-store.mjs';

export const RQS_BOOT_ELEMENT_ID = '__snapback_boot';

/// Read and parse the embedded boot payload. The element's textContent is
/// `JSON.parse`d directly — the §0E.1 escapes decode transparently and no
/// other decoding step may run first. Returns null when absent or unparsable
/// (degraded pageloads simply have no payload).
export function readInlineBootPayload({
  document = globalThis.document,
  elementId = RQS_BOOT_ELEMENT_ID,
} = {}) {
  const element = document?.getElementById?.(elementId);
  if (!element) return null;
  try {
    const parsed = JSON.parse(element.textContent);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Build the preload registry from a boot payload. Only entries carrying a
 * `resume` object preload (`rqsEligible` per the closed union — a
 * server-minted token is the eligibility proof the alias-key promotion
 * check keys on, LLP 0092 §0C.5); `resume: null` entries never enter the
 * registry. `consume(name, args)` is one-shot so a store is seeded exactly
 * once per pageload.
 */
export function createRqsPreloadRegistry(payload) {
  const entries = new Map();
  for (const entry of payload?.entries ?? []) {
    if (!entry || typeof entry.function !== 'string') continue;
    if (!entry.resume || typeof entry.resume.token !== 'string' || !entry.resume.meta) continue;
    const key = rqsEntryKey(entry.function, entry.args ?? {});
    if (key === null) continue;
    entries.set(key, {
      rows: Array.isArray(entry.rows) ? entry.rows : [],
      resume: entry.resume,
    });
  }
  return {
    route: typeof payload?.route === 'string' ? payload.route : null,
    generation: typeof payload?.generation === 'string' ? payload.generation : null,
    versionStream: typeof payload?.versionStream === 'string' ? payload.versionStream : null,
    get size() {
      return entries.size;
    },
    lookup(name, args = {}) {
      const key = rqsEntryKey(name, args);
      return key === null ? null : entries.get(key) ?? null;
    },
    consume(name, args = {}) {
      const key = rqsEntryKey(name, args);
      if (key === null) return null;
      const entry = entries.get(key) ?? null;
      if (entry !== null) entries.delete(key);
      return entry;
    },
  };
}

/// Convenience boot helper: read the document payload and return the
/// registry (an empty registry when no payload is embedded).
export function readRqsPreloadRegistry(options = {}) {
  return createRqsPreloadRegistry(readInlineBootPayload(options));
}

const MIXED_FORMAT_VERSION = 2;
const MIXED_PROFILE = 'mixed-route.v2';
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const utf8 = new TextEncoder();
const artifactCanonicalLimits = Object.freeze({
  maxDepth: 64,
  maxNodes: 65_536,
  maxObjectFields: 1_024,
  maxArrayEntries: 4_096,
  maxStringUtf8Bytes: 4 * 1024 * 1024,
  maxKeyUtf8Bytes: 16 * 1024 * 1024,
});

function mixedRefusal(code, message, details = {}) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
  return error;
}

function invalidMixed(message, details = {}) {
  throw mixedRefusal('SNAPBACK_RQS_MIXED_GROUP_INVALID', message, details);
}

function plainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value, required, optional, where) {
  if (!plainRecord(value)) invalidMixed(`${where} must be a plain closed record`);
  const keys = Reflect.ownKeys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    invalidMixed(`${where} has missing or unknown fields`, {
      where,
      keys: keys.filter((key) => typeof key === 'string').sort(),
    });
  }
}

const GENERATED_REFERENCE_HYDRATION_KEYS = new Set([
  'authoringProfile',
  'retention',
  'delivery',
  'artifacts',
]);

function cloneOwnRecord(value, { omit = new Set(), replace = new Map() } = {}) {
  if (!plainRecord(value)) return value;
  const clone = Object.create(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value)) {
    if (omit.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (replace.has(key) && Object.hasOwn(descriptor, 'value')) {
      descriptor.value = replace.get(key);
    }
    Object.defineProperty(clone, key, descriptor);
  }
  return clone;
}

function normalizeGeneratedMixedReference(reference) {
  if (!plainRecord(reference) || !Array.isArray(reference.queries)) return reference;
  const queries = reference.queries.map((child) => {
    if (!plainRecord(child) || !plainRecord(child.ref)) return child;
    // @ref LLP 0157#d2--plan-identity — codegen hydrates the portable function reference with these exact local
    // consumer annotations. Remove only that closed, known set at registry
    // admission; preserve every other own key so the portable validator still
    // rejects unknown enumerable, non-enumerable, and symbol metadata.
    const ref = cloneOwnRecord(child.ref, { omit: GENERATED_REFERENCE_HYDRATION_KEYS });
    return cloneOwnRecord(child, { replace: new Map([['ref', ref]]) });
  });
  return cloneOwnRecord(reference, { replace: new Map([['queries', queries]]) });
}

function nonempty(value, where) {
  if (typeof value !== 'string' || value.length === 0) {
    invalidMixed(`${where} must be a nonempty string`, { where });
  }
  return value;
}

function canonicalArtifact(value) {
  try {
    return canonicalizeClientValueV1(value, { limits: artifactCanonicalLimits });
  } catch (cause) {
    invalidMixed('mixed artifact contains a noncanonical value', {
      cause: cause?.code ?? cause?.message ?? String(cause),
    });
  }
}

function domainHash(domain, value) {
  const digest = sha256PureJs(utf8.encode(`${domain}${canonicalArtifact(value)}`));
  return `sha256:${[...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function validateGeneratedFunctionReference(reference, group, where) {
  exactRecord(reference, [
    'artifactKind', 'schemaVersion', 'appId', 'id', 'name', 'kind',
    'implementationHash', 'argsContractHash', 'resultContractHash',
    'expectedGeneration',
  ], ['authoredSourceHash', 'authRequirement'], where);
  if (
    reference.artifactKind !== 'functionReference'
    || reference.schemaVersion !== group.schemaVersion
    || reference.appId !== group.appId
    || reference.id !== `${group.appId}:${reference.name}`
    || !['Query', 'LiveQuery'].includes(reference.kind)
    || !SHA256.test(reference.implementationHash ?? '')
    || !SHA256.test(reference.argsContractHash ?? '')
    || !SHA256.test(reference.resultContractHash ?? '')
    || (Object.hasOwn(reference, 'authRequirement')
      && !['public', 'optional-user', 'authenticated'].includes(reference.authRequirement))
    || (Object.hasOwn(reference, 'authoredSourceHash')
      && !SHA256.test(reference.authoredSourceHash ?? ''))
  ) invalidMixed(`${where} is not the complete generated query reference`);
  nonempty(reference.name, `${where}.name`);
  exactRecord(reference.expectedGeneration, [
    'schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash',
  ], [], `${where}.expectedGeneration`);
  if (
    reference.expectedGeneration.appId !== group.appId
    || reference.expectedGeneration.schemaVersion !== reference.schemaVersion
    || !['schemaHash', 'bundleHash', 'inputsHash'].every((field) => (
      typeof reference.expectedGeneration[field] === 'string'
      && reference.expectedGeneration[field].length > 0
    ))
  ) invalidMixed(`${where}.expectedGeneration is inconsistent`);
}

function validateLiveness(value, where) {
  if (value?.kind === 'none') {
    exactRecord(value, ['kind'], [], where);
    return 'read-only';
  }
  if (value?.kind === 'admitted') {
    exactRecord(value, ['kind', 'delivery', 'pageDomain'], [], where);
    if (value.delivery !== 'live_replace' || value.pageDomain !== 'whole-result') {
      invalidMixed(`${where} requests an unadmitted mixed-route delivery`);
    }
    return 'registered-live';
  }
  invalidMixed(`${where} has an unknown liveness kind`);
}

function validateMixedNode(child, group, position) {
  // @ref LLP 0157#d2--plan-identity — only this hash-bound owner fact may
  // classify a mixed child; reference and response shape are consistency
  // checks and never replacement liveness oracles.
  const where = `queryGroupReference.queries[${position}]`;
  exactRecord(child, [
    'name', 'ref', 'args', 'nodePlan', 'nodePlanHash', 'liveness',
  ], [], where);
  nonempty(child.name, `${where}.name`);
  validateGeneratedFunctionReference(child.ref, group, `${where}.ref`);
  if (!SHA256.test(child.nodePlanHash ?? '')) {
    invalidMixed(`${where}.nodePlanHash is not NodePlanHashV1`);
  }
  exactRecord(child.nodePlan, [
    'format', 'classId', 'classVersion', 'normalizedPlan',
    'argumentBindings', 'capability',
  ], [], `${where}.nodePlan`);
  if (
    child.nodePlan.format !== 'snapback.node-plan.v1'
    || child.nodePlan.classId !== 'exported_query_v1'
    || child.nodePlan.classVersion !== 1
    || !Array.isArray(child.nodePlan.argumentBindings)
  ) invalidMixed(`${where}.nodePlan has an unadmitted node class`);
  exactRecord(child.nodePlan.normalizedPlan, [
    'format', 'runtime', 'argsContractHash', 'resultContractHash',
    'authRequirement', 'authorityIndependent', 'authorizationDependence',
    'readSetSummary', 'effectCeiling',
  ], [], `${where}.nodePlan.normalizedPlan`);
  if (
    child.nodePlan.normalizedPlan.format !== 'snapback.exported-query-plan.v1'
    || child.nodePlan.normalizedPlan.argsContractHash !== child.ref.argsContractHash
    || child.nodePlan.normalizedPlan.resultContractHash !== child.ref.resultContractHash
    || typeof child.nodePlan.normalizedPlan.authorityIndependent !== 'boolean'
    || !Array.isArray(child.nodePlan.normalizedPlan.authorizationDependence)
  ) invalidMixed(`${where}.nodePlan normalized export facts disagree with its reference`);
  for (const [bindingIndex, binding] of child.nodePlan.argumentBindings.entries()) {
    const bindingWhere = `${where}.nodePlan.argumentBindings[${bindingIndex}]`;
    exactRecord(binding, ['name', 'contract', 'contractHash'], [], bindingWhere);
    nonempty(binding.name, `${bindingWhere}.name`);
    exactRecord(binding.contract, ['format', 'required', 'value'], [], `${bindingWhere}.contract`);
    if (
      binding.contract.format !== 'snapback.argument-binding-contract.v1'
      || typeof binding.contract.required !== 'boolean'
      || binding.contractHash !== domainHash(
        'snapback:argument-binding-contract:v1:',
        binding.contract,
      )
    ) invalidMixed(`${bindingWhere} does not reproduce its contract hash`);
  }
  exactRecord(child.nodePlan.capability, [
    'exportKind', 'live', 'retention', 'requiredCapabilityIds',
  ], [], `${where}.nodePlan.capability`);
  if (
    child.nodePlan.capability.exportKind !== child.ref.kind
    || !['none', 'opaque-authorized-snapshot-v1', 'result-transform-snapshot-v1']
      .includes(child.nodePlan.capability.retention)
    || !Array.isArray(child.nodePlan.capability.requiredCapabilityIds)
  ) invalidMixed(`${where}.nodePlan capability is inconsistent`);
  let priorCapability = null;
  for (const capabilityId of child.nodePlan.capability.requiredCapabilityIds) {
    nonempty(capabilityId, `${where}.nodePlan.capability.requiredCapabilityIds[]`);
    if (priorCapability !== null && priorCapability >= capabilityId) {
      invalidMixed(`${where}.nodePlan capability ids are not sorted and unique`);
    }
    priorCapability = capabilityId;
  }
  const delivery = validateLiveness(
    child.nodePlan.capability.live,
    `${where}.nodePlan.capability.live`,
  );
  if (canonicalArtifact(child.liveness) !== canonicalArtifact(child.nodePlan.capability.live)) {
    invalidMixed(`${where}.liveness is not the hash-bound capability fact`);
  }
  if (
    (delivery === 'read-only' && child.nodePlan.capability.exportKind !== 'Query')
    || (delivery === 'registered-live' && child.nodePlan.capability.exportKind !== 'LiveQuery')
  ) invalidMixed(`${where} carries an impossible export-kind/liveness pair`);
  if (domainHash('snapback:node-plan:v1:', child.nodePlan) !== child.nodePlanHash) {
    invalidMixed(`${where}.nodePlanHash does not reproduce its node plan`);
  }
  canonicalArtifact(child.args);
  return delivery;
}

function routeParamNames(route) {
  if (route === '/') return [];
  return route.split('/').filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1));
}

function materializeMixedArgs(template, params, where) {
  if (!plainRecord(template)) invalidMixed(`${where} must be a generated args record`);
  const materialize = (value, path) => {
    if (plainRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, '$param')) {
      if (typeof value.$param !== 'string' || typeof params[value.$param] !== 'string') {
        invalidMixed(`${path} has an unresolved route parameter`);
      }
      return params[value.$param];
    }
    if (plainRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(
        ([name, entry]) => [name, materialize(entry, `${path}.${name}`)],
      ));
    }
    // Array interiors are literal-only under params-v1.
    return value;
  };
  return Object.fromEntries(Object.entries(template).map(
    ([name, value]) => [name, materialize(value, `${where}.${name}`)],
  ));
}

function validateMixedReference(reference, params) {
  exactRecord(reference, [
    'artifactKind', 'formatVersion', 'profile', 'schemaVersion', 'appId', 'id',
    'route', 'definitionHash', 'planHash', 'queries',
  ], ['persist'], 'queryGroupReference');
  if (
    reference.artifactKind !== 'queryGroupReference'
    || reference.formatVersion !== MIXED_FORMAT_VERSION
    || reference.profile !== MIXED_PROFILE
    || reference.id !== `${reference.appId}:query-group-v2:${reference.route}`
    || !SHA256.test(reference.definitionHash ?? '')
    || !SHA256.test(reference.planHash ?? '')
    || !Array.isArray(reference.queries)
    || reference.queries.length < 1
    || reference.queries.length > 32
    || (Object.hasOwn(reference, 'persist') && reference.persist !== false)
  ) invalidMixed('queryGroupReference is not the closed mixed-route v2 artifact');
  nonempty(reference.schemaVersion, 'queryGroupReference.schemaVersion');
  nonempty(reference.appId, 'queryGroupReference.appId');
  nonempty(reference.route, 'queryGroupReference.route');
  if (!plainRecord(params)) invalidMixed('mixed route params must be a closed string record');
  const expectedParams = routeParamNames(reference.route).sort();
  const actualParams = Object.keys(params).sort();
  if (
    expectedParams.length !== actualParams.length
    || expectedParams.some((name, index) => name !== actualParams[index])
    || actualParams.some((name) => typeof params[name] !== 'string')
  ) invalidMixed('mixed route params do not exactly cover the generated route');
  const names = new Set();
  const identities = new Set();
  const nodes = [];
  const expectedArgs = [];
  const deliveries = [];
  for (const [position, child] of reference.queries.entries()) {
    const delivery = validateMixedNode(child, reference, position);
    if (names.has(child.name)) invalidMixed('mixed child names are not unique');
    names.add(child.name);
    const identity = `${child.ref.id}\u0000${canonicalArtifact(child.args)}`;
    if (identities.has(identity)) invalidMixed('mixed route repeats a function and canonical args');
    identities.add(identity);
    nodes.push({ position, nodePlan: child.nodePlan, nodePlanHash: child.nodePlanHash });
    expectedArgs.push(materializeMixedArgs(child.args, params, `queryGroupReference.queries[${position}].args`));
    deliveries.push(delivery);
  }
  if (!deliveries.includes('registered-live') || !deliveries.includes('read-only')) {
    invalidMixed('mixed-route v2 requires at least one explicit child of each liveness class');
  }
  const routeQueries = reference.queries.map((child) => ({
    function: child.ref.name,
    args: child.args,
  }));
  const mergedArgs = {
    format: 'snapback.mixed-route-args.v2',
    route: reference.route,
    queries: routeQueries,
  };
  const normalizedCompositePlan = {
    format: 'snapback.normalized-composite-plan.v1',
    profileId: MIXED_PROFILE,
    nodes,
    mergedArgsContractHash: domainHash('snapback:mixed-route-args:v2:', mergedArgs),
    classification: {
      callable: true,
      live: { kind: 'none' },
      invalidation: 'none',
      retention: 'none',
    },
    parentAuthorizationGroups: [],
  };
  if (domainHash('snapback:plan-hash:v1:', normalizedCompositePlan) !== reference.planHash) {
    invalidMixed('mixed planHash does not reproduce its ordered child bindings');
  }
  const definition = {
    route: reference.route,
    queries: routeQueries,
    ...(reference.persist === false ? { persist: false } : {}),
    planHash: reference.planHash,
  };
  if (
    domainHash('snapback:query-group-reference:v2\n', definition)
      !== reference.definitionHash
  ) invalidMixed('mixed definitionHash does not reproduce its closed definition');
  return { deliveries, expectedArgs };
}

function validateMixedResume(resume, child, rows, args, bundle, where) {
  if (resume === null) return null;
  exactRecord(resume, ['token', 'meta'], [], where);
  exactRecord(resume.meta, [
    'app', 'argsHash', 'contentDigest', 'generation', 'queryArtifact',
    'version', 'versionStream',
  ], [], `${where}.meta`);
  if (
    typeof resume.token !== 'string'
    || !resume.token.startsWith('sbrt1.')
    || resume.token.length > 1_024
    || resume.meta.app !== child.ref.appId
    || resume.meta.argsHash !== argsHash(args)
    || typeof resume.meta.queryArtifact !== 'string'
    || resume.meta.queryArtifact.length === 0
    || resume.meta.generation !== bundle.generation
    || resume.meta.versionStream !== bundle.versionStream
    || resume.meta.version !== bundle.commitVersion
    || !rowsMatchDigest(rows, resume.meta.contentDigest)
  ) invalidMixed(`${where} does not bind the returned child result`);
  canonicalArtifact(resume);
  return resume;
}

function createMixedRegisteredRegistry(bundle, reference, params) {
  const { deliveries, expectedArgs } = validateMixedReference(reference, params);
  exactRecord(bundle, [
    'formatVersion', 'profile', 'planHash', 'commitVersion', 'generation',
    'versionStream', 'entries', 'connection', 'aggregate',
  ], [], 'bundle');
  if (
    bundle.formatVersion !== MIXED_FORMAT_VERSION
    || bundle.profile !== MIXED_PROFILE
    || bundle.planHash !== reference.planHash
    || !Number.isSafeInteger(bundle.commitVersion)
    || bundle.commitVersion < 0
    || typeof bundle.generation !== 'string'
    || bundle.generation.length === 0
    || typeof bundle.versionStream !== 'string'
    || bundle.versionStream.length === 0
    || !Array.isArray(bundle.entries)
    || bundle.entries.length !== reference.queries.length
  ) invalidMixed('bundle does not match the mixed-route v2 artifact');
  exactRecord(bundle.connection, ['connectionId', 'grant', 'attachDeadline'], [
    'authorizationInvalidation',
  ], 'bundle.connection');
  if (
    typeof bundle.connection.connectionId !== 'string'
    || bundle.connection.connectionId.length === 0
    || typeof bundle.connection.grant !== 'string'
    || bundle.connection.grant.length === 0
    || !Number.isSafeInteger(bundle.connection.attachDeadline)
    || bundle.connection.attachDeadline < 0
  ) invalidMixed('bundle.connection is incomplete');
  let connectionAuthorizationInvalidation = null;
  if (
    Object.hasOwn(bundle.connection, 'authorizationInvalidation')
    && bundle.connection.authorizationInvalidation !== null
  ) {
    try {
      connectionAuthorizationInvalidation = validateAuthorizationInvalidationConnection(
        bundle.connection.authorizationInvalidation,
        'bundle.connection.authorizationInvalidation',
      );
    } catch (cause) {
      invalidMixed('bundle.connection authorization projection is invalid', {
        cause: cause?.code ?? cause?.message ?? String(cause),
      });
    }
  }
  exactRecord(bundle.aggregate, [
    'kind', 'weakest', 'liveChildren', 'readOnlyChildren',
  ], [], 'bundle.aggregate');
  const liveChildren = deliveries.filter((delivery) => delivery === 'registered-live').length;
  const readOnlyChildren = deliveries.length - liveChildren;
  if (
    bundle.aggregate.kind !== 'mixed'
    || bundle.aggregate.weakest !== 'read-only'
    || bundle.aggregate.liveChildren !== liveChildren
    || bundle.aggregate.readOnlyChildren !== readOnlyChildren
  ) invalidMixed('bundle aggregate is not the explicit weakest child state');

  const entries = new Map();
  const subscriptionIds = new Set();
  let sawAuthorization = false;
  for (const [position, response] of bundle.entries.entries()) {
    const child = reference.queries[position];
    const delivery = deliveries[position];
    const live = delivery === 'registered-live';
    exactRecord(response, ['function', 'args', 'rows', 'resume', 'delivery'], live
      ? ['subscriptionId', 'authorization']
      : [], `bundle.entries[${position}]`);
    exactRecord(response.delivery, ['kind', 'nodePlanHash'], [], `bundle.entries[${position}].delivery`);
    if (
      response.function !== child.ref.name
      || canonicalArtifact(response.args) !== canonicalArtifact(expectedArgs[position])
      || !Array.isArray(response.rows)
      || response.delivery.kind !== delivery
      || response.delivery.nodePlanHash !== child.nodePlanHash
      || (live && (
        typeof response.subscriptionId !== 'string'
        || response.subscriptionId.length === 0
        || subscriptionIds.has(response.subscriptionId)
      ))
    ) invalidMixed(`bundle.entries[${position}] crosses its bound child identity`);
    if (live) subscriptionIds.add(response.subscriptionId);
    let authorization = null;
    if (Object.hasOwn(response, 'authorization')) {
      exactRecord(response.authorization, ['scope', 'invalidation'], [], `bundle.entries[${position}].authorization`);
      try {
        authorization = {
          scope: validateScopeId(
            response.authorization.scope,
            `bundle.entries[${position}].authorization.scope`,
          ),
          invalidation: (() => {
            if (response.authorization.invalidation === null) return null;
            const invalidationWhere = `bundle.entries[${position}].authorization.invalidation`;
            exactRecord(
              response.authorization.invalidation,
              ['obligation', 'resolution'],
              [],
              invalidationWhere,
            );
            return {
              obligation: validateResyncObligation(
                response.authorization.invalidation.obligation,
                `${invalidationWhere}.obligation`,
              ),
              resolution: response.authorization.invalidation.resolution === null
                ? null
                : validateResolutionTicket(
                    response.authorization.invalidation.resolution,
                    `${invalidationWhere}.resolution`,
                  ),
            };
          })(),
        };
      } catch (cause) {
        invalidMixed(`bundle.entries[${position}] authorization projection is invalid`, {
          cause: cause?.code ?? cause?.message ?? String(cause),
        });
      }
      if (
        authorization.scope.kind !== 'subscription'
        || authorization.scope.subscriptionId !== response.subscriptionId
      ) invalidMixed(`bundle.entries[${position}] authorization crossed its subscription`);
      canonicalArtifact(authorization);
      sawAuthorization = true;
    }
    const resume = validateMixedResume(
      response.resume,
      child,
      response.rows,
      response.args,
      bundle,
      `bundle.entries[${position}].resume`,
    );
    const key = rqsEntryKey(response.function, response.args);
    if (key === null || entries.has(key)) {
      invalidMixed(`bundle.entries[${position}] has no unique canonical child key`);
    }
    entries.set(key, live
      ? {
          bootDelivery: 'registered-live',
          subscriptionId: response.subscriptionId,
          rows: response.rows,
          version: bundle.commitVersion,
          resume,
          ...(authorization !== null
            ? { authorization }
            : {}),
          attachDeadline: bundle.connection.attachDeadline,
        }
      : {
          bootDelivery: 'read-only',
          subscriptionId: null,
          rows: response.rows,
          version: bundle.commitVersion,
          resume,
          freshness: 'snapshot',
          attachDeadline: null,
        });
  }
  if (sawAuthorization && connectionAuthorizationInvalidation === null) {
    invalidMixed('auth-scoped mixed children lack the connection authorization projection');
  }
  return {
    formatVersion: MIXED_FORMAT_VERSION,
    profile: MIXED_PROFILE,
    planHash: reference.planHash,
    aggregate: { ...bundle.aggregate },
    connection: {
      connectionId: bundle.connection.connectionId,
      grant: bundle.connection.grant,
      attachDeadline: bundle.connection.attachDeadline,
    },
    generation: bundle.generation,
    versionStream: bundle.versionStream,
    get size() {
      return entries.size;
    },
    lookup(name, args = {}) {
      const key = rqsEntryKey(name, args);
      return key === null ? null : entries.get(key) ?? null;
    },
    consume(name, args = {}) {
      const key = rqsEntryKey(name, args);
      if (key === null) return null;
      const entry = entries.get(key) ?? null;
      if (entry !== null) entries.delete(key);
      return entry;
    },
  };
}

/**
 * Build a registered-boot registry from a register-mode bundle response
 * (LLP 0090 D4 rollout step 7; contract LLP 0092 §0D.1). Legacy format-1
 * entries all carry a `subscriptionId`. Mixed format-2 entries instead use
 * their explicit, hash-bound liveness fact: admitted children are consumed
 * one-shot into `liveQuery`'s `registeredSubscription` seam, while `none`
 * children are ordinary one-shot snapshot results and cannot enter that
 * seam. Every entry's `version` is the bundle's single `commitVersion` (all
 * snapshots were evaluated at that one cut), and `resume` stays `null` for
 * auth-scoped entries — the closed union rides through unchanged.
 *
 * The connection facts (`connectionId`, `grant`, `attachDeadline`) are
 * surfaced so the boot can hand `connectionId` to its surface/handles; the
 * grant itself was already adopted into the client's connection-grant cache
 * by `fetchBundle`.
 */
export function createRqsRegisteredRegistry(bundle, reference = null, params = {}) {
  const bundleVersion = bundle?.formatVersion;
  const referenceVersion = reference?.formatVersion;
  if (bundleVersion != null || referenceVersion != null) {
    if (bundleVersion !== MIXED_FORMAT_VERSION || referenceVersion !== MIXED_FORMAT_VERSION) {
      throw mixedRefusal(
        'SNAPBACK_RQS_MIXED_GROUP_VERSION_UNSUPPORTED',
        'mixed registered boot requires matching formatVersion 2 bundle and artifact',
        { bundleVersion: bundleVersion ?? null, referenceVersion: referenceVersion ?? null },
      );
    }
    return createMixedRegisteredRegistry(
      bundle,
      normalizeGeneratedMixedReference(reference),
      params,
    );
  }
  const entries = new Map();
  const commitVersion = typeof bundle?.commitVersion === 'number' ? bundle.commitVersion : 0;
  const attachDeadline = Number.isSafeInteger(bundle?.connection?.attachDeadline)
    && bundle.connection.attachDeadline >= 0
    ? bundle.connection.attachDeadline
    : null;
  const connection = typeof bundle?.connection?.connectionId === 'string'
    && bundle.connection.connectionId.length > 0
    && typeof bundle.connection.grant === 'string'
    && bundle.connection.grant.length > 0
    ? {
        connectionId: bundle.connection.connectionId,
        grant: bundle.connection.grant,
        attachDeadline,
      }
    : null;
  for (const entry of bundle?.entries ?? []) {
    if (!entry || typeof entry.function !== 'string') continue;
    if (typeof entry.subscriptionId !== 'string' || entry.subscriptionId.length === 0) continue;
    const key = rqsEntryKey(entry.function, entry.args ?? {});
    if (key === null) continue;
    entries.set(key, {
      subscriptionId: entry.subscriptionId,
      rows: Array.isArray(entry.rows) ? entry.rows : [],
      version: commitVersion,
      resume: entry.resume && typeof entry.resume.token === 'string' ? entry.resume : null,
      // @ref LLP 0092#0d4-attach-grace-reaping-and-pending-owner-bounds —
      // every adopted registration is usable only inside its bundle owner's
      // exact server-authored attach window.
      attachDeadline,
    });
  }
  return {
    connection,
    generation: typeof bundle?.generation === 'string' ? bundle.generation : null,
    versionStream: typeof bundle?.versionStream === 'string' ? bundle.versionStream : null,
    get size() {
      return entries.size;
    },
    lookup(name, args = {}) {
      const key = rqsEntryKey(name, args);
      return key === null ? null : entries.get(key) ?? null;
    },
    consume(name, args = {}) {
      const key = rqsEntryKey(name, args);
      if (key === null) return null;
      const entry = entries.get(key) ?? null;
      if (entry !== null) entries.delete(key);
      return entry;
    },
  };
}
