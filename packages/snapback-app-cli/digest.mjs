// Agent-oriented, value-free application digest.
//
// @ref LLP 0146#d3-agent-digest — the static section is content-addressed by
// the API-envelope identity and the dynamic section is keyed by a cursor that
// embeds it. Ordering, budgets, and degradation are closed and deterministic.
// @ref LLP 0146#open-questions — OQ10: v0 retains no observation
// history: the dynamic section is always returned whole at coarse resolution.

import { createHash } from 'node:crypto';

export const AGENT_DIGEST_FORMAT_VERSION = 'snapback.agent-digest.v1';
export const AGENT_DIGEST_CURSOR_PREFIX = 'sbad1.';
export const DEFAULT_DIGEST_BUDGET_BYTES = 32_768;
export const DEFAULT_DIGEST_BUDGET_ITEMS = 256;

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value) => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
const byteLength = (value) => Buffer.byteLength(canonicalJson(value));

function digestError(message) {
  const error = new Error(`SNAPBACK_APP_CLI_DIGEST_INVALID: ${message}`);
  error.code = 'SNAPBACK_APP_CLI_DIGEST_INVALID';
  return error;
}

function magnitude(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 'unknown';
  if (value === 0) return '0';
  if (value === 1) return '1';
  if (value < 10) return '2-9';
  if (value < 100) return '10-99';
  if (value < 1_000) return '100-999';
  if (value < 10_000) return '1k-9.9k';
  return '10k+';
}

function safeFunction(fn) {
  return {
    id: fn.id,
    name: fn.name,
    kind: fn.kind,
    authRequirement: fn.authRequirement ?? 'optional-user',
    argsContract: fn.argsContract ?? fn.argsSchema ?? null,
    resultContract: fn.resultContract ?? null,
    readSet: fn.readSetSummary ?? null,
    writeSet: fn.writeSetSummary ?? null,
    requiredCapabilities: [...(fn.requiredCapabilities ?? [])].sort(compare),
  };
}

function staticItems(surface, inspection) {
  const items = [{
    key: 'artifact/identity',
    kind: 'artifact-identity',
    value: {
      appId: surface.appId,
      source: surface.source ?? 'unknown',
      schemaVersion: surface.generation?.schemaVersion ?? surface.schemaManifest?.schemaVersion ?? null,
      schemaHash: surface.generation?.schemaHash ?? surface.schemaManifest?.schemaHash ?? null,
      bundleHash: surface.generation?.bundleHash ?? surface.bundleHash ?? null,
      inputsHash: surface.generation?.inputsHash ?? null,
    },
  }];
  const tables = surface.schemaManifest?.tables ?? inspection?.schema?.tables ?? null;
  if (Array.isArray(tables)) {
    for (const table of [...tables].sort((left, right) => compare(left.name ?? '', right.name ?? ''))) {
      items.push({
        key: `schema/table/${table.name}`,
        kind: 'schema-table',
        value: {
          name: table.name,
          fields: [...(table.fields ?? [])].sort((left, right) => compare(left.name ?? '', right.name ?? '')),
          indexes: [...(table.indexes ?? [])].sort((left, right) => compare(left.name ?? canonicalJson(left), right.name ?? canonicalJson(right))),
          syncable: table.syncable ?? null,
        },
      });
    }
  } else {
    items.push({
      key: 'schema/unavailable',
      kind: 'availability',
      value: { available: false, reason: 'schema-summary-unavailable-on-loaded-surface' },
    });
  }
  for (const fn of [...(surface.functions ?? [])].sort((left, right) => compare(left.id, right.id))) {
    items.push({ key: `operation/${fn.id}`, kind: 'operation-signature', value: safeFunction(fn) });
  }
  const manifest = surface.capabilityManifest ?? inspection?.capabilityManifest ?? null;
  const gaps = [
    ...(manifest?.capabilityGaps ?? []),
    ...(inspection?.capabilityGaps ?? []),
  ].map((entry) => (typeof entry === 'string' ? entry : canonicalJson(entry))).sort(compare);
  items.push({
    key: 'capabilities/resolution',
    kind: 'capability-resolution',
    value: {
      targetProfileId: manifest?.targetProfileId ?? inspection?.targetProfileId ?? null,
      supported: [...(manifest?.supportedCapabilities ?? [])].sort(compare),
      gaps: [...new Set(gaps)],
    },
  });
  return items.sort((left, right) => compare(left.key, right.key));
}

function dynamicItems(inspection) {
  const tables = inspection?.storage?.tables;
  const diagnostics = Array.isArray(inspection?.recentDiagnostics)
    ? inspection.recentDiagnostics
    : [];
  const refusalCounts = new Map();
  for (const entry of diagnostics) {
    const code = typeof entry?.code === 'string' ? entry.code : null;
    const refusal = entry?.severity === 'error'
      || (code !== null && /(REFUS|DENIED|UNAUTHORIZED|FORBIDDEN|MISMATCH)/.test(code));
    if (code !== null && refusal) refusalCounts.set(code, (refusalCounts.get(code) ?? 0) + 1);
  }
  const conformance = Array.isArray(inspection?.declarationConformance)
    ? inspection.declarationConformance
    : null;
  return [
    {
      key: 'dynamic/storage-magnitudes',
      kind: 'row-count-magnitudes',
      value: {
        available: false,
        reason: 'row-counts-unavailable-on-public-app-data-inspection-v0',
        tableCountMagnitude: magnitude(Array.isArray(tables) ? tables.length : -1),
      },
    },
    {
      key: 'dynamic/recent-refusals',
      kind: 'recent-refusal-codes',
      value: {
        codes: [...refusalCounts.entries()].sort(([left], [right]) => compare(left, right)).map(([code, count]) => ({
          code,
          countMagnitude: magnitude(count),
        })),
        source: inspection === null ? 'unavailable' : 'public-redacted-diagnostics',
      },
    },
    {
      key: 'dynamic/declaration-conformance',
      kind: 'd1-conformance-verdicts',
      value: conformance === null
        ? {
          available: false,
          reason: 'd1-conformance-not-projected-on-public-app-data-plane-v0',
        }
        : {
          available: true,
          verdicts: [...conformance].map((entry) => ({
            functionId: entry.functionId ?? null,
            status: entry.status ?? 'unknown',
          })).sort((left, right) => compare(left.functionId ?? '', right.functionId ?? '')),
        },
    },
  ];
}

function cursorToken(payload) {
  return `${AGENT_DIGEST_CURSOR_PREFIX}${Buffer.from(canonicalJson(payload)).toString('base64url')}`;
}

export function parseDigestCursor(value, { nowMs = Date.now() } = {}) {
  if (typeof value !== 'string' || !value.startsWith(AGENT_DIGEST_CURSOR_PREFIX)) {
    return { status: 'unknown-cursor', cursor: null };
  }
  try {
    const cursor = JSON.parse(Buffer.from(value.slice(AGENT_DIGEST_CURSOR_PREFIX.length), 'base64url').toString('utf8'));
    if (
      !plainObject(cursor)
      || cursor.version !== 1
      || typeof cursor.envelopeHash !== 'string'
      || !plainObject(cursor.staticIndex)
      || typeof cursor.dynamicHash !== 'string'
      || typeof cursor.staticIndexComplete !== 'boolean'
    ) return { status: 'unknown-cursor', cursor: null };
    if (cursor.expiresAtMs !== null && (!Number.isSafeInteger(cursor.expiresAtMs) || cursor.expiresAtMs <= nowMs)) {
      return { status: 'expired-cursor', cursor };
    }
    return { status: 'known-cursor', cursor };
  } catch {
    return { status: 'unknown-cursor', cursor: null };
  }
}

function envelopeIdentity(surface, allStaticItems) {
  if (typeof surface.envelopeSha256 === 'string' && surface.envelopeSha256.length > 0) {
    return { hash: surface.envelopeSha256, kind: 'served-api-envelope' };
  }
  return {
    hash: sha256({ appId: surface.appId, staticItems: allStaticItems }),
    kind: 'local-generated-static-projection',
  };
}

function requestedStaticDelta(allItems, currentHash, changedSince, nowMs) {
  if (changedSince === null || changedSince === undefined || changedSince === '') {
    return { mode: 'full', reason: 'no-cursor', items: allItems, removedKeys: [] };
  }
  if (!changedSince.startsWith(AGENT_DIGEST_CURSOR_PREFIX)) {
    if (changedSince === currentHash) {
      return { mode: 'delta', reason: 'bare-envelope-hash-match', items: [], removedKeys: [] };
    }
    return { mode: 'full', reason: 'bare-envelope-hash-changed', items: allItems, removedKeys: [] };
  }
  const parsed = parseDigestCursor(changedSince, { nowMs });
  if (parsed.status !== 'known-cursor') {
    return { mode: 'full', reason: parsed.status, items: allItems, removedKeys: [] };
  }
  if (parsed.cursor.envelopeHash === currentHash) {
    return { mode: 'delta', reason: 'envelope-unchanged', items: [], removedKeys: [] };
  }
  if (!parsed.cursor.staticIndexComplete) {
    return { mode: 'full', reason: 'cursor-static-index-incomplete', items: allItems, removedKeys: [] };
  }
  const currentIndex = Object.fromEntries(allItems.map((item) => [item.key, sha256(item)]));
  return {
    mode: 'delta',
    reason: 'envelope-changed',
    items: allItems.filter((item) => parsed.cursor.staticIndex[item.key] !== currentIndex[item.key]),
    removedKeys: Object.keys(parsed.cursor.staticIndex).filter((key) => !Object.hasOwn(currentIndex, key)).sort(compare),
  };
}

function elision(section, omitted, reason, fullBytes) {
  return {
    section,
    omittedItems: omitted,
    reason,
    request: {
      flag: '--budget-bytes',
      atLeast: fullBytes,
      companionFlag: '--budget-items',
    },
  };
}

function renderDigest({
  envelope,
  principalClass,
  principalSource,
  change,
  staticAll,
  dynamicAll,
  staticEmitted,
  dynamicEmitted,
  staticIndexComplete,
  budgetBytes,
  budgetItems,
  fullBytes,
}) {
  const staticIndex = Object.fromEntries(staticAll.map((item) => [item.key, sha256(item)]));
  const cursorPayload = {
    version: 1,
    envelopeHash: envelope.hash,
    staticIndex: staticIndexComplete ? staticIndex : Object.fromEntries(staticEmitted.map((item) => [item.key, staticIndex[item.key]])),
    staticIndexComplete,
    dynamicHash: sha256(dynamicAll),
    expiresAtMs: null,
  };
  const digestCursor = cursorToken(cursorPayload);
  const elisions = [];
  const omittedStatic = change.items.length - staticEmitted.length;
  const omittedDynamic = dynamicAll.length - dynamicEmitted.length;
  if (omittedStatic > 0) elisions.push(elision('static', omittedStatic, 'byte-or-item-budget', fullBytes));
  if (omittedDynamic > 0) elisions.push(elision('dynamic', omittedDynamic, 'byte-or-item-budget', fullBytes));
  const document = {
    artifactKind: 'agentDigest',
    formatVersion: AGENT_DIGEST_FORMAT_VERSION,
    envelopeHash: envelope.hash,
    envelopeIdentityKind: envelope.kind,
    digestCursor,
    principalClass,
    principalSource,
    changeReason: change.reason,
    budget: {
      bytes: budgetBytes,
      items: budgetItems,
      emittedBytes: 0,
      emittedItems: staticEmitted.length + dynamicEmitted.length,
      withinBudget: true,
    },
    sections: {
      static: {
        key: envelope.hash,
        mode: change.mode,
        items: staticEmitted,
        removedKeys: change.removedKeys,
      },
      dynamic: {
        key: digestCursor,
        mode: 'full',
        resolution: 'coarse',
        reason: 'coarse-resolution-v0-no-observation-retention',
        items: dynamicEmitted,
      },
    },
    elisions,
    nonclaims: [
      'dynamic cursor v0 retains no observation history and therefore supplies no custody or replay guarantee',
      'row values, arguments, result payloads, credentials, and raw diagnostic details are never included',
      'D1 verdict availability does not imply LLP 0115 CV-14 semantic-review custody',
    ],
  };
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const emittedBytes = byteLength(document);
    document.budget.emittedBytes = emittedBytes;
    document.budget.withinBudget = emittedBytes <= budgetBytes;
  }
  return document;
}

export function buildAgentDigest({
  surface,
  inspection = null,
  principalClass = 'anonymous',
  principalSource = 'default',
  changedSince = null,
  budgetBytes = DEFAULT_DIGEST_BUDGET_BYTES,
  budgetItems = DEFAULT_DIGEST_BUDGET_ITEMS,
  nowMs = Date.now(),
}) {
  if (!plainObject(surface) || typeof surface.appId !== 'string') throw digestError('surface must carry an appId');
  if (changedSince !== null && changedSince !== undefined && typeof changedSince !== 'string') throw digestError('changedSince must be a string or null');
  if (typeof principalClass !== 'string' || principalClass.length === 0) throw digestError('principalClass must be a non-empty string');
  if (typeof principalSource !== 'string' || principalSource.length === 0) throw digestError('principalSource must be a non-empty string');
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 256) throw digestError('budgetBytes must be an integer of at least 256');
  if (!Number.isSafeInteger(budgetItems) || budgetItems < 0) throw digestError('budgetItems must be a non-negative integer');
  const staticAll = staticItems(surface, inspection);
  const dynamicAll = dynamicItems(inspection);
  const envelope = envelopeIdentity(surface, staticAll);
  const change = requestedStaticDelta(staticAll, envelope.hash, changedSince, nowMs);
  const fullProbe = renderDigest({
    envelope, principalClass, principalSource, change,
    staticAll, dynamicAll,
    staticEmitted: change.items,
    dynamicEmitted: dynamicAll,
    staticIndexComplete: true,
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetItems: Number.MAX_SAFE_INTEGER,
    fullBytes: 0,
  });
  const fullBytes = byteLength(fullProbe);
  let staticEmitted = [...change.items];
  let dynamicEmitted = [...dynamicAll];
  let cursorIndexComplete = true;
  while (staticEmitted.length + dynamicEmitted.length > budgetItems) {
    if (dynamicEmitted.length > 0) dynamicEmitted.pop();
    else staticEmitted.pop();
  }
  let document;
  for (;;) {
    document = renderDigest({
      envelope, principalClass, principalSource, change,
      staticAll, dynamicAll, staticEmitted, dynamicEmitted,
      staticIndexComplete: cursorIndexComplete && staticEmitted.length === change.items.length,
      budgetBytes, budgetItems, fullBytes,
    });
    if (byteLength(document) <= budgetBytes) break;
    if (staticEmitted.length === 0 && dynamicEmitted.length === 0 && cursorIndexComplete) {
      cursorIndexComplete = false;
      continue;
    }
    if (staticEmitted.length === 0 && dynamicEmitted.length === 0) break;
    if (dynamicEmitted.length > 0) dynamicEmitted.pop();
    else if (staticEmitted.length > 0) staticEmitted.pop();
    else break;
  }
  if (!document.budget.withinBudget && document.elisions.length === 0) {
    document.elisions.push(elision('document', staticAll.length + dynamicAll.length, 'budget-smaller-than-minimum-envelope', fullBytes));
    document.budget.emittedBytes = byteLength(document);
    document.budget.withinBudget = document.budget.emittedBytes <= budgetBytes;
  }
  return Object.freeze(document);
}
