import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertNoUndeclaredSymbolRemovals,
  integrateSymbolLifecycle,
  publishedSymbolsSnapshot,
  registrySymbolIdentities,
  SYMBOL_REMOVAL_UNDECLARED,
  validateSymbolLifecycle,
} from './snapback-publish-core.mjs';

const schema = JSON.parse(readFileSync(
  new URL('../guide/reference/lifecycle.schema.json', import.meta.url),
  'utf8',
));
const currentIdentity = 'npm:@expo/snapback-client#Current';
const successorIdentity = 'npm:@expo/snapback-client#Successor';
const removedIdentity = 'npm:@expo/snapback-client#Removed';
const memberIdentity = `${currentIdentity}.method`;

function lifecycle(symbols, currentIdentities = [currentIdentity, successorIdentity]) {
  return validateSymbolLifecycle({
    document: {
      $schema: './lifecycle.schema.json',
      schemaVersion: 'snapback-symbol-lifecycle.v1',
      symbols,
    },
    schema,
    currentIdentities,
  });
}

function snapshot(identities) {
  return {
    schemaVersion: 'snapback-published-symbols.v1',
    publishedVersion: '0.1.16',
    seededFrom: {
      kind: 'working-tree-registry-seed',
      note: 'Fixture reflects a working-tree registry and is not a rebuilt historical closure.',
    },
    lastRefreshedFrom: null,
    identities: [...identities].sort(),
  };
}

test('lifecycle refuses an identity absent from the registry without removedIn', () => {
  assert.throws(
    () => lifecycle([{ identity: removedIdentity, replacedBy: successorIdentity }]),
    /absent from the current registry and must carry removedIn/u,
  );
  assert.throws(
    () => lifecycle([{ identity: 'not-a-stable-identity', replaces: currentIdentity }]),
    /must match pattern/u,
  );
});

test('lifecycle refuses dangling replaces and replacedBy pointers', () => {
  assert.throws(
    () => lifecycle([{
      identity: successorIdentity,
      replaces: 'npm:@expo/snapback-client#DoesNotExist',
    }]),
    /points to nonexistent identity/u,
  );
});

test('registry entries carry current lifecycle facts and removed-symbol records', () => {
  const facts = lifecycle([
    { identity: removedIdentity, removedIn: '0.1.17', replacedBy: successorIdentity },
    { identity: successorIdentity, replaces: removedIdentity },
    { identity: memberIdentity, replacedBy: successorIdentity },
  ], [currentIdentity, successorIdentity, memberIdentity]);
  const registry = {
    symbols: [
      { identity: currentIdentity, members: [{ identity: memberIdentity }] },
      { identity: successorIdentity, members: [] },
    ],
  };
  integrateSymbolLifecycle(registry, facts);
  assert.deepEqual(registry.symbols[1].lifecycle, { replaces: removedIdentity });
  assert.deepEqual(registry.symbols[0].members[0].lifecycle, { replacedBy: successorIdentity });
  assert.deepEqual(registry.removedSymbols, [{
    identity: removedIdentity,
    module: '@expo/snapback-client',
    name: 'Removed',
    lifecycle: { removedIn: '0.1.17', replacedBy: successorIdentity },
  }]);
});

test('publication refuses undeclared removals with a stable diagnostic and accepts declarations', () => {
  const published = snapshot([currentIdentity, removedIdentity]);
  const empty = lifecycle([]);
  assert.throws(
    () => assertNoUndeclaredSymbolRemovals({
      snapshot: published,
      currentIdentities: [currentIdentity],
      lifecycle: empty,
    }),
    (error) => {
      assert.equal(error.code, SYMBOL_REMOVAL_UNDECLARED);
      assert.match(error.message, new RegExp(removedIdentity, 'u'));
      assert.match(error.message, /add one lifecycle entry/u);
      return true;
    },
  );

  const declared = lifecycle(
    [{ identity: removedIdentity, removedIn: '0.1.17' }],
    [currentIdentity],
  );
  assert.deepEqual(
    assertNoUndeclaredSymbolRemovals({
      snapshot: published,
      currentIdentities: [currentIdentity],
      lifecycle: declared,
    }),
    { removed: [removedIdentity] },
  );
});

test('a successful publication refreshes the snapshot from exact registry identities', () => {
  const previous = snapshot([currentIdentity]);
  const refreshed = publishedSymbolsSnapshot({
    previousSnapshot: previous,
    registry: {
      buildIdentity: { sourceDigest: `sha256:${'b'.repeat(64)}` },
      symbols: [
        { identity: successorIdentity, members: [] },
        { identity: currentIdentity, members: [{ identity: memberIdentity }] },
      ],
    },
    publishedVersion: '0.1.17',
    sourceRevision: 'a'.repeat(40),
    candidateLedgerSha256: 'c'.repeat(64),
    capturedAt: '2026-08-09T12:00:00.000Z',
  });
  assert.equal(refreshed.publishedVersion, '0.1.17');
  assert.equal(refreshed.seededFrom, previous.seededFrom);
  assert.deepEqual(refreshed.identities, [currentIdentity, memberIdentity, successorIdentity].sort());
  assert.equal(refreshed.lastRefreshedFrom.kind, 'successful-candidate-publication');
  assert.equal(refreshed.lastRefreshedFrom.candidateLedgerSha256, 'c'.repeat(64));
  assert.deepEqual(
    registrySymbolIdentities({
      symbols: [{ identity: currentIdentity, members: [{ identity: memberIdentity }] }],
    }),
    [currentIdentity, memberIdentity],
  );
});
