import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  analyzeSources,
  edgeFingerprint,
  enforceMonotonicBaseline,
  enforceSnapshotProtocol,
  formatExpiredWaiverEscalation,
} from './check-module-ownership.mjs';

// @ref LLP 0225#5 — adversarial fixtures prove the accepted analyzer and predecessor protocol.
// These fixtures pin every supported path form and the complete
// set-based/monotonic/unassigned protocol rather than a Boolean gate result.

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'module-ownership');
const BASE_MANIFEST = JSON.parse(readFileSync(join(ROOT, 'ownership.manifest.json'), 'utf8'));

function fixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function manifestFor(assignments) {
  const manifest = structuredClone(BASE_MANIFEST);
  manifest.godFiles = [];
  manifest.mixedModuleScopes = {};
  manifest.uncertainAssignments = {};
  for (const owner of Object.keys(manifest.modulesByOwner)) manifest.modulesByOwner[owner] = [];
  for (const [path, owner] of Object.entries(assignments)) manifest.modulesByOwner[owner].push(path);
  for (const files of Object.values(manifest.modulesByOwner)) files.sort();
  return manifest;
}

function edgePairs(analysis) {
  return new Set(analysis.edges.map((edge) => `${edge.from}->${edge.to}`));
}

test('extractor resolves crate/group/alias/pub-use, module-relative roots, and chained re-exports', () => {
  const sources = new Map([
    ['src/alias_consumer.rs', fixture('aliased-use.rs')],
    ['src/bridge_one.rs', fixture('reexport-one.rs')],
    ['src/bridge_two.rs', fixture('reexport-two.rs')],
    ['src/bridge_glob_one.rs', fixture('reexport-glob-one.rs')],
    ['src/bridge_glob_two.rs', fixture('reexport-glob-two.rs')],
    ['src/chain_consumer.rs', fixture('reexport-consumer.rs')],
    ['src/crate_consumer.rs', fixture('crate-root.rs')],
    ['src/group_consumer.rs', fixture('grouped-use.rs')],
    ['src/glob_chain_consumer.rs', fixture('reexport-glob-consumer.rs')],
    ['src/nested/sibling.rs', fixture('target.rs')],
    ['src/nested/super_consumer.rs', fixture('super-root.rs')],
    ['src/parent.rs', fixture('self-root.rs')],
    ['src/parent/self_target.rs', fixture('target.rs')],
    ['src/pub_use_consumer.rs', fixture('pub-use-crate.rs')],
    ['src/target.rs', fixture('target.rs')],
  ]);
  const manifest = manifestFor(Object.fromEntries([...sources.keys()].map((path) => [
    path,
    path.includes('consumer') || path === 'src/parent.rs'
      ? 'sync-realtime-engine'
      : 'background-services',
  ])));
  const edges = edgePairs(analyzeSources(manifest, sources));

  for (const consumer of [
    'src/alias_consumer.rs',
    'src/crate_consumer.rs',
    'src/group_consumer.rs',
    'src/pub_use_consumer.rs',
  ]) assert(edges.has(`${consumer}->src/target.rs`), `${consumer} must resolve crate::target`);
  assert(edges.has('src/nested/super_consumer.rs->src/nested/sibling.rs'));
  assert(edges.has('src/parent.rs->src/parent/self_target.rs'));
  assert(edges.has('src/chain_consumer.rs->src/bridge_one.rs'));
  assert(edges.has('src/chain_consumer.rs->src/bridge_two.rs'));
  assert(edges.has('src/chain_consumer.rs->src/target.rs'));
  assert(edges.has('src/glob_chain_consumer.rs->src/bridge_glob_one.rs'));
  assert(edges.has('src/glob_chain_consumer.rs->src/bridge_glob_two.rs'));
  assert(edges.has('src/glob_chain_consumer.rs->src/target.rs'));
});

function sourceSnapshot({
  edge = true,
  fromPath = 'src/service.rs',
  fromOwner = 'sync-realtime-engine',
  issues = new Map(),
  revision = 'abc1234',
  frozen = [],
} = {}) {
  const sources = new Map([
    [fromPath, edge ? 'use crate::other::Thing;\n' : 'pub struct Service;\n'],
    ['src/other.rs', 'pub struct Thing;\n'],
  ]);
  const manifest = manifestFor({
    [fromPath]: fromOwner,
    'src/other.rs': 'background-services',
  });
  const analysis = analyzeSources(manifest, sources);
  return {
    analysis,
    baseline: {
      schemaVersion: 'snapback.module-ownership-baseline.v2',
      manifestSchemaVersion: 'snapback.module-ownership-manifest.v1',
      moduleCount: analysis.moduleCount,
      edgeCount: analysis.edges.length,
      edges: analysis.edges,
      frozenForbiddenEdgeCount: frozen.length,
      frozenForbiddenEdges: frozen,
    },
    issues,
    manifest,
    revision,
  };
}

function worklistRecord(fingerprint, disposition, overrides = {}) {
  const raw = {
    fingerprint,
    disposition,
    observationRevision: 'abc1234',
    provenance: 'The predecessor source proves this edge predates the landing.',
    ...overrides,
  };
  return {
    baseline: {
      fingerprint,
      attribution: {
        disposition: raw.disposition,
        observationRevision: raw.observationRevision,
        worklist: 'issues/worklist.md',
        provenance: raw.provenance,
        ...(raw.inversionOwner === undefined ? {} : { inversionOwner: raw.inversionOwner }),
        ...(raw.deadline === undefined ? {} : { deadline: raw.deadline }),
        ...(raw.predecessorFingerprint === undefined
          ? {}
          : { predecessorFingerprint: raw.predecessorFingerprint }),
      },
    },
    issues: new Map([[
      'issues/worklist.md',
      `# reviewed worklist\n\n<!-- module-ownership-frozen-edge: ${JSON.stringify(raw)} -->\n`,
    ]]),
  };
}

function trackingIssue(fingerprints) {
  return new Map([[
    'issues/outstanding.md',
    `# outstanding\n\n**Status:** Open\n\nObserved at \`abc1234\`.\n\n${fingerprints.join('\n')}\n`,
  ]]);
}

test('monotonic baseline refuses silent growth and admits attributed analyzer discoveries', () => {
  const predecessor = sourceSnapshot();
  const fingerprint = edgeFingerprint(predecessor.analysis.edges[0]);
  const silent = sourceSnapshot({ frozen: [{ fingerprint }] });
  assert.throws(
    () => enforceMonotonicBaseline(silent, predecessor),
    /silent forbidden-edge baseline growth/u,
  );

  const record = worklistRecord(fingerprint, 'analyzer-upgrade');
  const attributed = sourceSnapshot({ issues: record.issues, frozen: [record.baseline] });
  assert.deepEqual(enforceMonotonicBaseline(attributed, predecessor).growth, [fingerprint]);
});

test('new forbidden-edge growth is admitted by a current time-bounded waiver', () => {
  const predecessor = sourceSnapshot({ edge: false });
  const currentGraph = sourceSnapshot();
  const fingerprint = edgeFingerprint(currentGraph.analysis.edges[0]);
  const waiver = worklistRecord(fingerprint, 'time-bounded-waiver', {
    deadline: '2026-08-12',
    inversionOwner: 'sync-realtime-engine',
  });
  const current = sourceSnapshot({ issues: waiver.issues, frozen: [waiver.baseline] });
  assert.deepEqual(
    enforceSnapshotProtocol(current, [predecessor], { today: '2026-08-12' }).reports[0].baseline.growth,
    [fingerprint],
  );
});

test('new forbidden-edge growth is refused by an expired time-bounded waiver', () => {
  const predecessor = sourceSnapshot({ edge: false });
  const currentGraph = sourceSnapshot();
  const fingerprint = edgeFingerprint(currentGraph.analysis.edges[0]);
  const waiver = worklistRecord(fingerprint, 'time-bounded-waiver', {
    deadline: '2026-08-11',
    inversionOwner: 'sync-realtime-engine',
  });
  const current = sourceSnapshot({ issues: waiver.issues, frozen: [waiver.baseline] });
  assert.throws(
    () => enforceSnapshotProtocol(current, [predecessor], { today: '2026-08-12' }),
    /waiver expired 2026-08-11/u,
  );
});

test('expired waivers in committed snapshots remain admitted and report escalation', () => {
  const graph = sourceSnapshot();
  const fingerprint = edgeFingerprint(graph.analysis.edges[0]);
  const waiver = worklistRecord(fingerprint, 'time-bounded-waiver', {
    deadline: '2026-08-11',
    inversionOwner: 'sync-realtime-engine',
  });
  const predecessor = sourceSnapshot({ issues: waiver.issues, frozen: [waiver.baseline] });
  const current = sourceSnapshot({ issues: waiver.issues, frozen: [waiver.baseline] });
  const protocol = enforceSnapshotProtocol(current, [predecessor], { today: '2026-08-12' });

  assert.deepEqual(protocol.expiredWaivers, [fingerprint]);
  assert.equal(formatExpiredWaiverEscalation(protocol.expiredWaivers), '; 1 expired waivers (escalate)');
});

test('relocation re-keys a removed frozen edge only with retained attribution', () => {
  const oldGraph = sourceSnapshot();
  const oldFingerprint = edgeFingerprint(oldGraph.analysis.edges[0]);
  const predecessor = sourceSnapshot({ frozen: [{ fingerprint: oldFingerprint }] });
  const movedGraph = sourceSnapshot({ fromPath: 'src/moved_service.rs' });
  const movedFingerprint = edgeFingerprint(movedGraph.analysis.edges[0]);
  const unlinked = worklistRecord(movedFingerprint, 'relocation');
  assert.throws(
    () => enforceMonotonicBaseline(sourceSnapshot({
      fromPath: 'src/moved_service.rs',
      issues: unlinked.issues,
      frozen: [unlinked.baseline],
    }), predecessor),
    /exact predecessorFingerprint/u,
  );
  const relocation = worklistRecord(movedFingerprint, 'relocation', {
    predecessorFingerprint: oldFingerprint,
  });
  const current = sourceSnapshot({
    fromPath: 'src/moved_service.rs',
    issues: relocation.issues,
    frozen: [relocation.baseline],
  });
  const result = enforceMonotonicBaseline(current, predecessor);
  assert.deepEqual(result.growth, [movedFingerprint]);
  assert.deepEqual(result.removed, [oldFingerprint]);
});

test('set protocol blocks introduced reds and requires a pushed-tree ticket for inherited reds', () => {
  const cleanPredecessor = sourceSnapshot({ edge: false });
  const introducedGraph = sourceSnapshot();
  const introducedFingerprint = edgeFingerprint(introducedGraph.analysis.edges[0]);
  const introduced = sourceSnapshot({ issues: trackingIssue([introducedFingerprint]) });
  assert.throws(
    () => enforceSnapshotProtocol(introduced, [cleanPredecessor]),
    /introduced forbidden module edges/u,
  );

  const redPredecessor = sourceSnapshot();
  const inheritedFingerprint = edgeFingerprint(redPredecessor.analysis.edges[0]);
  assert.throws(
    () => enforceSnapshotProtocol(sourceSnapshot(), [redPredecessor]),
    /need an open issues\/ ticket/u,
  );
  const inherited = sourceSnapshot({ issues: trackingIssue([inheritedFingerprint]) });
  assert.equal(enforceSnapshotProtocol(inherited, [redPredecessor]).ticket, 'issues/outstanding.md');
});

test('legacy unassigned modules are shrink-only across the predecessor comparison', () => {
  const predecessor = sourceSnapshot({ fromOwner: 'unassigned' });
  const current = sourceSnapshot({ fromOwner: 'unassigned' });
  current.manifest.modulesByOwner.unassigned.push('src/new_residue.rs');
  current.manifest.modulesByOwner.unassigned.sort();
  assert.throws(
    () => enforceSnapshotProtocol(current, [predecessor]),
    /legacy unassigned bucket is shrink-only/u,
  );
});
