// Authored lifecycle facts are the only durable evidence that a public symbol
// was renamed or deliberately removed. Keep validation and publication-diff
// semantics shared by the registry generator and publication pipeline.
// @ref LLP 0194#amendment-2026-08-09-authored-symbol-lifecycle-facts —
// lifecycle facts are authored, never inferred from successive registries.

import Ajv2020 from 'ajv/dist/2020.js';

export const SYMBOL_LIFECYCLE_SCHEMA_VERSION = 'snapback-symbol-lifecycle.v1';
export const PUBLISHED_SYMBOLS_SCHEMA_VERSION = 'snapback-published-symbols.v1';
export const SYMBOL_LIFECYCLE_INVALID = 'SNAPBACK_SYMBOL_LIFECYCLE_INVALID';
export const SYMBOL_REMOVAL_UNDECLARED = 'SNAPBACK_SYMBOL_REMOVAL_UNDECLARED';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SYMBOL_IDENTITY = /^npm:[^#]+#[^#]+$/u;

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function lifecycleFacts(entry) {
  return Object.fromEntries(
    ['replaces', 'removedIn', 'replacedBy']
      .filter((field) => entry[field] !== undefined)
      .map((field) => [field, entry[field]]),
  );
}

export function registrySymbolIdentities(registry) {
  return registry.symbols.flatMap((symbol) => [
    symbol.identity,
    ...(symbol.members ?? []).map(({ identity }) => identity),
  ]);
}

function formatSchemaErrors(errors) {
  return (errors ?? []).map((error) => {
    const location = error.instancePath || '/';
    return `${location} ${error.message}`;
  }).join('; ');
}

/** Validate the JSON Schema shape and the registry-relative identity rules. */
export function validateSymbolLifecycle({ document, schema, currentIdentities }) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(document)) {
    throw codedError(
      SYMBOL_LIFECYCLE_INVALID,
      `lifecycle metadata does not match ${SYMBOL_LIFECYCLE_SCHEMA_VERSION}: ${formatSchemaErrors(validate.errors)}`,
    );
  }

  const current = new Set(currentIdentities);
  const byIdentity = new Map();
  for (const entry of document.symbols) {
    if (byIdentity.has(entry.identity)) {
      throw codedError(
        SYMBOL_LIFECYCLE_INVALID,
        `lifecycle identity ${entry.identity} is declared more than once`,
      );
    }
    byIdentity.set(entry.identity, entry);
    const resolves = current.has(entry.identity);
    if (!resolves && entry.removedIn === undefined) {
      throw codedError(
        SYMBOL_LIFECYCLE_INVALID,
        `${entry.identity} is absent from the current registry and must carry removedIn`,
      );
    }
    if (resolves && entry.removedIn !== undefined) {
      throw codedError(
        SYMBOL_LIFECYCLE_INVALID,
        `${entry.identity} still resolves in the current registry and cannot carry removedIn`,
      );
    }
  }

  const known = new Set([...current, ...byIdentity.keys()]);
  for (const entry of document.symbols) {
    for (const field of ['replaces', 'replacedBy']) {
      const pointer = entry[field];
      if (pointer !== undefined && !known.has(pointer)) {
        throw codedError(
          SYMBOL_LIFECYCLE_INVALID,
          `${entry.identity}.${field} points to nonexistent identity ${pointer}`,
        );
      }
    }
  }

  return {
    document,
    byIdentity,
    removedEntries: document.symbols.filter(({ identity }) => !current.has(identity)),
  };
}

/** Embed authored facts without changing the current-symbol membership. */
export function integrateSymbolLifecycle(registry, lifecycle) {
  let currentSymbolsWithFacts = 0;
  for (const symbol of registry.symbols) {
    const entry = lifecycle.byIdentity.get(symbol.identity);
    if (entry) {
      symbol.lifecycle = lifecycleFacts(entry);
      currentSymbolsWithFacts += 1;
    }
    for (const member of symbol.members ?? []) {
      const memberEntry = lifecycle.byIdentity.get(member.identity);
      if (memberEntry) {
        member.lifecycle = lifecycleFacts(memberEntry);
        currentSymbolsWithFacts += 1;
      }
    }
  }
  registry.lifecycle = {
    schemaVersion: lifecycle.document.schemaVersion,
    authoredPath: 'guide/reference/lifecycle.json',
    currentSymbolsWithFacts,
    removedSymbols: lifecycle.removedEntries.length,
  };
  registry.removedSymbols = lifecycle.removedEntries
    .map((entry) => {
      const [moduleIdentity, name = ''] = entry.identity.split('#');
      return {
        identity: entry.identity,
        module: moduleIdentity.replace(/^npm:/u, ''),
        name,
        lifecycle: lifecycleFacts(entry),
      };
    })
    .sort((left, right) => left.identity.localeCompare(right.identity));
  return registry;
}

export function validatePublishedSymbolsSnapshot(document) {
  if (
    document === null
    || typeof document !== 'object'
    || Array.isArray(document)
    || document.schemaVersion !== PUBLISHED_SYMBOLS_SCHEMA_VERSION
    || !SEMVER.test(document.publishedVersion ?? '')
    || document.seededFrom === null
    || typeof document.seededFrom !== 'object'
    || Array.isArray(document.seededFrom)
    || typeof document.seededFrom.note !== 'string'
    || !document.seededFrom.note.includes('not a rebuilt historical closure')
    || !Array.isArray(document.identities)
  ) {
    throw codedError(
      SYMBOL_LIFECYCLE_INVALID,
      `published-symbol snapshot does not match ${PUBLISHED_SYMBOLS_SCHEMA_VERSION}`,
    );
  }
  const expected = [...document.identities].sort();
  if (
    document.identities.some((identity) => typeof identity !== 'string' || !SYMBOL_IDENTITY.test(identity))
    || new Set(document.identities).size !== document.identities.length
    || expected.some((identity, index) => identity !== document.identities[index])
  ) {
    throw codedError(
      SYMBOL_LIFECYCLE_INVALID,
      'published-symbol identities must be unique, sorted stable npm identities',
    );
  }
  return document;
}

/** Refuse removals; deliberately do not attempt rename inference. */
export function assertNoUndeclaredSymbolRemovals({ snapshot, currentIdentities, lifecycle }) {
  validatePublishedSymbolsSnapshot(snapshot);
  const current = new Set(currentIdentities);
  const undeclared = snapshot.identities.filter((identity) => {
    if (current.has(identity)) return false;
    return lifecycle.byIdentity.get(identity)?.removedIn === undefined;
  });
  if (undeclared.length > 0) {
    throw codedError(
      SYMBOL_REMOVAL_UNDECLARED,
      `published symbols disappeared without authored removedIn facts:\n${undeclared.map((identity) => `- ${identity}`).join('\n')}\n`
        + 'Fix: add one lifecycle entry per symbol to guide/reference/lifecycle.json with removedIn (and replacedBy when applicable). Renames are never inferred.',
    );
  }
  return { removed: snapshot.identities.filter((identity) => !current.has(identity)) };
}

/** Build the next committed snapshot after a complete successful publication. */
export function publishedSymbolsSnapshot({
  previousSnapshot,
  registry,
  publishedVersion,
  sourceRevision,
  candidateLedgerSha256,
  capturedAt,
}) {
  validatePublishedSymbolsSnapshot(previousSnapshot);
  if (
    !SEMVER.test(publishedVersion ?? '')
    || !/^[0-9a-f]{40}$/u.test(sourceRevision ?? '')
    || !/^[0-9a-f]{64}$/u.test(candidateLedgerSha256 ?? '')
    || !/^sha256:[0-9a-f]{64}$/u.test(registry.buildIdentity?.sourceDigest ?? '')
    || Number.isNaN(Date.parse(capturedAt ?? ''))
  ) {
    throw codedError(SYMBOL_LIFECYCLE_INVALID, 'successful publication snapshot provenance is malformed');
  }
  const identities = registrySymbolIdentities(registry).sort();
  const snapshot = {
    schemaVersion: PUBLISHED_SYMBOLS_SCHEMA_VERSION,
    publishedVersion,
    seededFrom: previousSnapshot.seededFrom,
    lastRefreshedFrom: {
      kind: 'successful-candidate-publication',
      publishedVersion,
      sourceRevision,
      candidateLedgerSha256,
      registrySourceDigest: registry.buildIdentity.sourceDigest,
      capturedAt,
    },
    identities,
  };
  return validatePublishedSymbolsSnapshot(snapshot);
}
