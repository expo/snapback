import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  analyzeSources,
  buildBaselineDocument,
  edgeFingerprint,
  enforceMonotonicBaseline,
  enforceSnapshotProtocol,
  formatExpiredWaiverEscalation,
} from './check-module-ownership.mjs';

// @ref LLP 0225#5 — adversarial fixtures prove the accepted analyzer and predecessor protocol.
// These fixtures pin every supported path form and the complete
// set-based/monotonic/unassigned protocol rather than a Boolean gate result.
// @ref LLP 0273#4 — the full disposition matrix fixes every negative and
// positive conservation/identity/amendment verdict against paired snapshots.

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
    ['src/inline_self_parent.rs', fixture('inline-self-root.rs')],
    ['src/inline_self_parent/nested/self_target.rs', fixture('target.rs')],
    ['src/inline_super_parent.rs', fixture('inline-super-root.rs')],
    ['src/inline_super_parent/sibling.rs', fixture('target.rs')],
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
  assert(edges.has('src/inline_self_parent.rs->src/inline_self_parent/nested/self_target.rs'));
  assert(edges.has('src/inline_super_parent.rs->src/inline_super_parent/sibling.rs'));
  assert(edges.has('src/chain_consumer.rs->src/bridge_one.rs'));
  assert(edges.has('src/chain_consumer.rs->src/bridge_two.rs'));
  assert(edges.has('src/chain_consumer.rs->src/target.rs'));
  assert(edges.has('src/glob_chain_consumer.rs->src/bridge_glob_one.rs'));
  assert(edges.has('src/glob_chain_consumer.rs->src/bridge_glob_two.rs'));
  assert(edges.has('src/glob_chain_consumer.rs->src/target.rs'));
});

function snapshotForSources(manifest, sources, {
  issues = new Map(),
  llps = new Map(),
  revision = 'abc1234',
  frozen = [],
} = {}) {
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
    llps,
    manifest,
    revision,
  };
}

const D1 = {
  kind: 'time-bounded-waiver',
  deadline: '2026-09-01',
  inversionOwners: ['sync-realtime-engine'],
};
const D2 = {
  kind: 'time-bounded-waiver',
  deadline: '2026-10-01',
  inversionOwners: ['sync-realtime-engine'],
};
const D3 = {
  kind: 'time-bounded-waiver',
  deadline: '2026-11-01',
  inversionOwners: ['generation-activation-coordinator'],
};

function scenarioSnapshot(sourcesObject, assignments) {
  const sources = new Map(Object.entries(sourcesObject));
  return snapshotForSources(manifestFor(assignments), sources);
}

function scenarioEdge(snapshot, from, to) {
  const edge = snapshot.analysis.edges.find((candidate) => candidate.from === from && candidate.to === to);
  assert(edge, `scenario edge ${from} -> ${to} must resolve`);
  return edge;
}

function installScenarioRecords(snapshot, definitions, {
  amendments = [],
  llps = new Map(),
} = {}) {
  const path = 'issues/worklist.md';
  const markers = [];
  const records = [];
  for (const definition of definitions) {
    const fingerprint = definition.fingerprint
      ?? edgeFingerprint(scenarioEdge(snapshot, definition.from, definition.to));
    const raw = {
      fingerprint,
      lineage: definition.lineage ?? null,
      obligation: definition.obligation ?? null,
      observationRevision: 'abc1234',
      provenance: definition.provenance
        ?? 'The paired source snapshots derive this exact conserved ownership obligation.',
      ...(definition.origin === undefined && definition.obligation !== null
        ? {}
        : { origin: definition.origin ?? 'freeze' }),
    };
    markers.push(`<!-- module-ownership-frozen-edge: ${JSON.stringify(raw)} -->`);
    records.push({
      fingerprint,
      attribution: {
        lineage: raw.lineage,
        obligation: raw.obligation,
        observationRevision: raw.observationRevision,
        worklist: path,
        provenance: raw.provenance,
        ...(raw.origin === undefined ? {} : { origin: raw.origin }),
      },
    });
  }
  for (const amendment of amendments) {
    markers.push(`<!-- module-ownership-amendment: ${JSON.stringify(amendment)} -->`);
  }
  snapshot.issues = new Map([[path, `# reviewed worklist\n\n${markers.join('\n')}\n`]]);
  snapshot.llps = llps;
  snapshot.baseline.frozenForbiddenEdges = records
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  snapshot.baseline.frozenForbiddenEdgeCount = records.length;
  return snapshot;
}

function functionCarrier(target = 'target', {
  attribute = '',
  name = 'coupling',
  statement = '',
} = {}) {
  return `${attribute}pub fn ${name}() { let _ = core::mem::size_of::<crate::${target}::TargetThing>(); ${statement} }\n`;
}

function targetSource(name = 'TargetThing') {
  return `pub struct ${name};\n`;
}

function assertDispositionRefused(predecessor, current, pattern = /ownership|obligation|forbidden|retained|waiver|amendment/iu) {
  assert.throws(
    () => enforceSnapshotProtocol(current, [predecessor], { today: '2026-08-16' }),
    pattern,
  );
}

function assertDispositionAdmitted(predecessor, current) {
  const result = enforceSnapshotProtocol(current, [predecessor], { today: '2026-08-16' });
  assert.deepEqual(result.inherited, []);
  assert.deepEqual(result.reports[0].introduced, []);
  return result;
}

function pathAliasSnapshot(fromOwner, consumerSource) {
  const sources = new Map([
    ['src/path_consumer.rs', consumerSource],
    ['src/path-target.rs', fixture('target.rs')],
  ]);
  const manifest = manifestFor({
    'src/path_consumer.rs': fromOwner,
    'src/path-target.rs': 'background-services',
  });
  return snapshotForSources(manifest, sources);
}

test('#[path] module aliases name forbidden edges and preserve allowed-direction edges', () => {
  const pathAlias = fixture('path-module-alias.rs');
  const forbidden = pathAliasSnapshot('sync-realtime-engine', pathAlias);
  const forbiddenEdge = 'src/path_consumer.rs (sync-realtime-engine) → src/path-target.rs (background-services)';
  assert(edgePairs(forbidden.analysis).has('src/path_consumer.rs->src/path-target.rs'));
  assert.equal(forbidden.analysis.unresolvedReferenceCount, 0);
  assert.throws(
    () => enforceSnapshotProtocol(
      forbidden,
      [pathAliasSnapshot('sync-realtime-engine', 'pub struct Consumer;\n')],
    ),
    (error) => {
      assert.match(error.message, /introduced forbidden module edges/u);
      assert(error.message.includes(forbiddenEdge), `refusal must name ${forbiddenEdge}`);
      return true;
    },
  );

  const allowed = pathAliasSnapshot('transport-adapters', pathAlias);
  assert(edgePairs(allowed.analysis).has('src/path_consumer.rs->src/path-target.rs'));
  assert.equal(allowed.analysis.unresolvedReferenceCount, 0);
  const protocol = enforceSnapshotProtocol(
    allowed,
    [pathAliasSnapshot('transport-adapters', 'pub struct Consumer;\n')],
  );
  assert.deepEqual(protocol.inherited, []);
  assert.deepEqual(protocol.reports[0].introduced, []);
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
  return snapshotForSources(manifest, sources, { frozen, issues, revision });
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
  assert.equal(formatExpiredWaiverEscalation(protocol.expiredWaivers), '; 1 expired waiver (escalate)');
  assert.equal(formatExpiredWaiverEscalation([fingerprint, `${fingerprint} again`]), '; 2 expired waivers (escalate)');
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
    /need open issues\/ tickets/u,
  );
  const inherited = sourceSnapshot({ issues: trackingIssue([inheritedFingerprint]) });
  assert.equal(enforceSnapshotProtocol(inherited, [redPredecessor]).ticket, 'issues/outstanding.md');
});

function twoEdgeSnapshot({ issues = new Map(), revision = 'abc1234' } = {}) {
  const sources = new Map([
    ['src/service.rs', 'use crate::other::Thing;\nuse crate::second::SecondThing;\n'],
    ['src/other.rs', 'pub struct Thing;\n'],
    ['src/second.rs', 'pub struct SecondThing;\n'],
  ]);
  const manifest = manifestFor({
    'src/service.rs': 'sync-realtime-engine',
    'src/other.rs': 'background-services',
    'src/second.rs': 'background-services',
  });
  return snapshotForSources(manifest, sources, { issues, revision });
}

test('separate tracking tickets may jointly cover inherited outstanding edges', () => {
  const predecessor = twoEdgeSnapshot();
  const fingerprints = predecessor.analysis.edges.map(edgeFingerprint);
  const issues = new Map([
    ['issues/first.md', `# first wave\n\n**Status:** Open\n\nObserved at \`abc1234\`.\n\n${fingerprints[0]}\n`],
    ['issues/second.md', `# second wave\n\n**Status:** Open\n\nRe-observed at \`def5678\`.\n\n${fingerprints[1]}\n`],
  ]);
  const protocol = enforceSnapshotProtocol(twoEdgeSnapshot({ issues }), [predecessor]);

  assert.deepEqual(protocol.tickets, ['issues/first.md', 'issues/second.md']);
  assert.equal(protocol.ticket, 'issues/first.md, issues/second.md');
});

test('tracking tickets require an explicit backticked observed-at revision', () => {
  const predecessor = sourceSnapshot();
  const fingerprint = edgeFingerprint(predecessor.analysis.edges[0]);
  const issues = new Map([[
    'issues/loose.md',
    `# loose observation\n\n**Status:** Open\n\nObserved at abc1234.\n\n${fingerprint}\n`,
  ]]);

  assert.throws(
    () => enforceSnapshotProtocol(sourceSnapshot({ issues }), [predecessor]),
    /explicit observed-at revision/u,
  );
});

test('tracking tickets accept backticked colon observation-revision forms', () => {
  const predecessor = sourceSnapshot();
  const fingerprint = edgeFingerprint(predecessor.analysis.edges[0]);
  for (const [index, revisionLine] of [
    'Observed at: `abc1234`.',
    'Observation revision: `abc1234`.',
  ].entries()) {
    const issues = new Map([[
      `issues/colon-${index}.md`,
      `# colon observation\n\n**Status:** Open\n\n${revisionLine}\n\n${fingerprint}\n`,
    ]]);
    const protocol = enforceSnapshotProtocol(sourceSnapshot({ issues }), [predecessor]);
    assert.equal(protocol.ticket, `issues/colon-${index}.md`);
  }
});

test('legacy unassigned modules are shrink-only across the predecessor comparison', () => {
  const predecessor = sourceSnapshot({ fromOwner: 'unassigned' });
  const current = sourceSnapshot({ fromOwner: 'unassigned' });
  current.manifest.modulesByOwner.unassigned.push('src/new_residue.rs');
  current.manifest.modulesByOwner.unassigned.sort();
  const permittedOwners = Object.keys(current.manifest.owners)
    .filter((owner) => owner !== 'unassigned');
  assert.equal(permittedOwners.length, 7);
  assert.throws(
    () => enforceSnapshotProtocol(current, [predecessor]),
    (error) => {
      assert.match(error.message, /legacy unassigned bucket is shrink-only/u);
      assert(
        error.message.includes(`permitted owners: ${permittedOwners.join(', ')}`),
        'refusal must name every real owner from the manifest',
      );
      return true;
    },
  );
});

test('LLP 0273 §4 negative matrix N1-N9b derives conservation without move proof', async (t) => {
  await t.test('N1 endpoint assertion', () => {
    const assignments = {
      'src/g.rs': 'sync-realtime-engine',
      'src/target.rs': 'background-services',
    };
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier(),
      'src/target.rs': targetSource(),
    }, assignments);
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: null }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/g.rs': functionCarrier(),
      'src/u.rs': functionCarrier('target', { name: 'unrelated' }),
      'src/target.rs': targetSource(),
    }, { ...assignments, 'src/u.rs': 'sync-realtime-engine' });
    installScenarioRecords(current, [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: null },
      { from: 'src/u.rs', to: 'src/target.rs', obligation: null, lineage: { kind: 'relocation', predecessors: [prior] } },
    ]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N1b retained-record swap', () => {
    const assignments = { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' };
    const sources = { 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() };
    const predecessor = installScenarioRecords(scenarioSnapshot(sources, assignments), [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: D1 },
    ]);
    const current = installScenarioRecords(scenarioSnapshot(sources, assignments), [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: D2 },
    ]);
    assertDispositionRefused(predecessor, current, /retained frozen-edge record changed/u);
  });

  await t.test('N2 extractedFrom assertion is not evidence', () => {
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier(),
      'src/target.rs': targetSource(),
    }, { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: null }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/g.rs': functionCarrier(),
      'src/x.rs': functionCarrier('target', { name: 'planted' }),
      'src/target.rs': targetSource(),
    }, {
      'src/g.rs': 'sync-realtime-engine',
      'src/x.rs': 'sync-realtime-engine',
      'src/target.rs': 'background-services',
    });
    current.manifest.extractedFrom = { 'src/x.rs': 'src/g.rs' };
    installScenarioRecords(current, [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: null },
      { from: 'src/x.rs', to: 'src/target.rs', obligation: null, lineage: { kind: 'relocation', predecessors: [prior] } },
    ]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N2b obligation-null launder', () => {
    const assignments = { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' };
    const sources = { 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() };
    const predecessor = installScenarioRecords(scenarioSnapshot(sources, assignments), [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: D1 },
    ]);
    const current = installScenarioRecords(scenarioSnapshot(sources, assignments), [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: null },
    ]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N3 name-only overlap cannot mint a fresh clock', () => {
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier('target', { name: 'handle' }),
      'src/target.rs': targetSource(),
    }, { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/m.rs': functionCarrier('target', { name: 'handle', statement: 'let changed = true;' }),
      'src/target.rs': targetSource(),
    }, { 'src/m.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(current, [{
      from: 'src/m.rs', to: 'src/target.rs', obligation: D2,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N4 rename cannot drop a waiver', () => {
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier(), 'src/target.rs': targetSource(),
    }, { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/g2.rs': functionCarrier(), 'src/target.rs': targetSource(),
    }, { 'src/g2.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(current, [{
      from: 'src/g2.rs', to: 'src/target.rs', obligation: null,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N5 owner re-key cannot drop or re-date', () => {
    const sources = { 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() };
    const predecessor = installScenarioRecords(scenarioSnapshot(sources, {
      'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services',
    }), [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = installScenarioRecords(scenarioSnapshot(sources, {
      'src/g.rs': 'generation-activation-coordinator', 'src/target.rs': 'background-services',
    }), [{
      from: 'src/g.rs', to: 'src/target.rs', obligation: D2,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N6 import plant gains no grandfathering', () => {
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier(),
      'src/m.rs': functionCarrier(),
      'src/target.rs': targetSource(),
    }, {
      'src/g.rs': 'sync-realtime-engine',
      'src/m.rs': 'transport-adapters',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/g.rs': 'pub struct G;\n',
      'src/m.rs': functionCarrier(),
      'src/target.rs': targetSource(),
    }, {
      'src/g.rs': 'sync-realtime-engine',
      'src/m.rs': 'sync-realtime-engine',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(current, [{
      from: 'src/m.rs', to: 'src/target.rs', obligation: D2,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N7 clone-and-mutate requires a fresh surplus attribution', () => {
    const original = functionCarrier();
    const predecessor = scenarioSnapshot({ 'src/g.rs': original, 'src/target.rs': targetSource() }, {
      'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/g.rs': functionCarrier('target', { statement: 'let edited = 1;' }),
      'src/m.rs': original,
      'src/target.rs': targetSource(),
    }, {
      'src/g.rs': 'sync-realtime-engine', 'src/m.rs': 'sync-realtime-engine',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(current, [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: D1 },
      { from: 'src/m.rs', to: 'src/target.rs', obligation: D1, lineage: { kind: 'split', predecessors: [prior] } },
    ]);
    assertDispositionRefused(predecessor, current, /must not replay/u);
  });

  await t.test('N7b coincidental delete/add cannot reset the clock', () => {
    const predecessor = scenarioSnapshot({ 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() }, {
      'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({ 'src/m.rs': functionCarrier(), 'src/target.rs': targetSource() }, {
      'src/m.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services',
    });
    installScenarioRecords(current, [{
      from: 'src/m.rs', to: 'src/target.rs', obligation: D2,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N8 fan-out cannot replay one waiver', () => {
    const predecessor = scenarioSnapshot({ 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() }, {
      'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const currentSources = { 'src/target.rs': targetSource() };
    const currentAssignments = { 'src/target.rs': 'background-services' };
    for (const path of ['src/m1.rs', 'src/m2.rs', 'src/m3.rs']) {
      currentSources[path] = functionCarrier();
      currentAssignments[path] = 'sync-realtime-engine';
    }
    const current = scenarioSnapshot(currentSources, currentAssignments);
    installScenarioRecords(current, ['src/m1.rs', 'src/m2.rs', 'src/m3.rs'].map((from) => ({
      from, to: 'src/target.rs', obligation: D1,
      lineage: { kind: 'split', predecessors: [prior] },
    })));
    assertDispositionRefused(predecessor, current, /must not replay/u);
  });

  await t.test('N9 edited move cannot get a fresh later clock', () => {
    const predecessor = scenarioSnapshot({ 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() }, {
      'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/m.rs': functionCarrier('target', { attribute: '#[inline]\n' }),
      'src/target.rs': targetSource(),
    }, { 'src/m.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(current, [{
      from: 'src/m.rs', to: 'src/target.rs', obligation: D2,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N9b two-push copy/delete sheds the weak clock and strengthens the survivor', () => {
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier('target', { name: 'strict' }),
      'src/m.rs': functionCarrier('target', { name: 'weak' }),
      'src/target.rs': targetSource(),
    }, {
      'src/g.rs': 'sync-realtime-engine', 'src/m.rs': 'sync-realtime-engine',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: D1 },
      { from: 'src/m.rs', to: 'src/target.rs', obligation: D2 },
    ]);
    const current = scenarioSnapshot({
      'src/m.rs': functionCarrier('target', { name: 'weak' }),
      'src/target.rs': targetSource(),
    }, { 'src/m.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(current, [{ from: 'src/m.rs', to: 'src/target.rs', obligation: D1 }]);
    assertDispositionAdmitted(predecessor, current);
  });
});

test('LLP 0273 §4 negative matrix N10-N20 closes content and k=0 launders', async (t) => {
  const carrierSet = (snapshot, from, to) => new Set(
    snapshot.analysis.edgeOccurrences.get(JSON.stringify([
      from,
      snapshot.analysis.assignment.get(from),
      to,
      snapshot.analysis.assignment.get(to),
    ]))?.keys() ?? [],
  );
  const reliableTargetPair = ({
    currentFoo,
    currentBar,
    extraCurrentAssignments = {},
    extraCurrentSources = {},
  }) => {
    const host = 'pub fn coupling() { let _ = core::mem::size_of::<crate::bridge::Alias>(); }\n';
    const predecessor = scenarioSnapshot({
      'src/h.rs': host,
      'src/bridge.rs': 'pub use crate::foo::TargetThing as Alias;\n',
      'src/foo.rs': 'pub struct Boilerplate;\npub struct TargetThing;\n',
    }, {
      'src/h.rs': 'sync-realtime-engine',
      'src/bridge.rs': 'storage-migration-kernel',
      'src/foo.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [
      { from: 'src/h.rs', to: 'src/foo.rs', obligation: D1 },
      { from: 'src/bridge.rs', to: 'src/foo.rs', obligation: D1 },
    ]);
    const currentSources = {
      'src/h.rs': host,
      'src/bridge.rs': 'pub use crate::bar::TargetThing as Alias;\n',
      ...(currentFoo === null ? {} : { 'src/foo.rs': currentFoo }),
      'src/bar.rs': currentBar,
      ...extraCurrentSources,
    };
    const currentAssignments = {
      'src/h.rs': 'sync-realtime-engine',
      'src/bridge.rs': 'storage-migration-kernel',
      ...(currentFoo === null ? {} : { 'src/foo.rs': 'background-services' }),
      'src/bar.rs': 'background-services',
      ...extraCurrentAssignments,
    };
    return { predecessor, current: scenarioSnapshot(currentSources, currentAssignments) };
  };

  await t.test('N10 literal bytes remain load-bearing', () => {
    const assignments = { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' };
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier('target', { statement: 'let role = "read-only";' }),
      'src/target.rs': targetSource(),
    }, assignments);
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const current = scenarioSnapshot({
      'src/g.rs': functionCarrier('target', { statement: 'let role = "admin";' }),
      'src/target.rs': targetSource(),
    }, assignments);
    installScenarioRecords(current, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D2 }]);
    assert.notDeepEqual(
      carrierSet(predecessor, 'src/g.rs', 'src/target.rs'),
      carrierSet(current, 'src/g.rs', 'src/target.rs'),
    );
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N10b doc attributes remain load-bearing', () => {
    const assignments = { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' };
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier('target', { attribute: '/// read-only\n' }),
      'src/target.rs': targetSource(),
    }, assignments);
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const current = scenarioSnapshot({
      'src/g.rs': functionCarrier('target', { attribute: '/// admin\n' }),
      'src/target.rs': targetSource(),
    }, assignments);
    installScenarioRecords(current, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D2 }]);
    assert.notDeepEqual(
      carrierSet(predecessor, 'src/g.rs', 'src/target.rs'),
      carrierSet(current, 'src/g.rs', 'src/target.rs'),
    );
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N11 owner relabel cannot silently retire a live allowed edge', () => {
    const sources = { 'src/service_a.rs': functionCarrier('service_b'), 'src/service_b.rs': targetSource() };
    const predecessor = scenarioSnapshot(sources, {
      'src/service_a.rs': 'sync-realtime-engine', 'src/service_b.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/service_a.rs', to: 'src/service_b.rs', obligation: D1 }]);
    const current = scenarioSnapshot(sources, {
      'src/service_a.rs': 'transport-adapters', 'src/service_b.rs': 'background-services',
    });
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N11b a same-push grant is absent from predecessor bytes', () => {
    const sources = { 'src/service_a.rs': functionCarrier('service_b'), 'src/service_b.rs': targetSource() };
    const predecessor = scenarioSnapshot(sources, {
      'src/service_a.rs': 'sync-realtime-engine', 'src/service_b.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/service_a.rs', to: 'src/service_b.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/service_a.rs', 'src/service_b.rs'));
    const current = scenarioSnapshot(sources, {
      'src/service_a.rs': 'transport-adapters', 'src/service_b.rs': 'background-services',
    });
    const next = edgeFingerprint(scenarioEdge(current, 'src/service_a.rs', 'src/service_b.rs'));
    const priorFields = { obligation: D1 };
    const newFields = { obligation: null };
    const grant = {
      grantId: 'same-push-forge', scope: { fingerprint: prior },
      kind: 'ownership-correction', direction: 'weaken', priorFields, newFields,
    };
    const amendment = {
      priorFingerprint: prior, newFingerprint: next, priorFields, newFields,
      kind: 'ownership-correction',
      authorization: { record: 'llp/0999-forged.decision.md', clauseId: grant.grantId },
      provenance: 'The owner correction is deliberately forged in the current tree only.',
    };
    installScenarioRecords(current, [], {
      amendments: [amendment],
      llps: new Map([['llp/0999-forged.decision.md', `<!-- module-ownership-amendment-grant: ${JSON.stringify(grant)} -->`]]),
    });
    assertDispositionRefused(predecessor, current, /absent from predecessor/u);
  });

  await t.test('N12 merge keeps the strictest deadline and owner union', () => {
    const predecessor = scenarioSnapshot({
      'src/g1.rs': functionCarrier('target', { name: 'one' }),
      'src/g2.rs': functionCarrier('target', { name: 'two' }),
      'src/target.rs': targetSource(),
    }, {
      'src/g1.rs': 'sync-realtime-engine', 'src/g2.rs': 'generation-activation-coordinator',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [
      { from: 'src/g1.rs', to: 'src/target.rs', obligation: D1 },
      { from: 'src/g2.rs', to: 'src/target.rs', obligation: D3 },
    ]);
    const predecessors = predecessor.baseline.frozenForbiddenEdges.map((record) => record.fingerprint);
    const current = scenarioSnapshot({
      'src/m.rs': `${functionCarrier('target', { name: 'one', statement: 'let edited = 1;' })}${functionCarrier('target', { name: 'two', statement: 'let edited = 2;' })}`,
      'src/target.rs': targetSource(),
    }, { 'src/m.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(current, [{
      from: 'src/m.rs', to: 'src/target.rs', obligation: D3,
      lineage: { kind: 'merge', predecessors },
    }]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N12b a freeze cannot annihilate a waiver in a merge', () => {
    const predecessor = scenarioSnapshot({
      'src/g1.rs': functionCarrier('target', { name: 'one' }),
      'src/g2.rs': functionCarrier('target', { name: 'two' }),
      'src/target.rs': targetSource(),
    }, {
      'src/g1.rs': 'sync-realtime-engine', 'src/g2.rs': 'sync-realtime-engine',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [
      { from: 'src/g1.rs', to: 'src/target.rs', obligation: D1 },
      { from: 'src/g2.rs', to: 'src/target.rs', obligation: null },
    ]);
    const predecessors = predecessor.baseline.frozenForbiddenEdges.map((record) => record.fingerprint);
    const current = scenarioSnapshot({
      'src/m.rs': `${functionCarrier('target', { name: 'one' })}${functionCarrier('target', { name: 'two' })}`,
      'src/target.rs': targetSource(),
    }, { 'src/m.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(current, [{
      from: 'src/m.rs', to: 'src/target.rs', obligation: null,
      lineage: { kind: 'merge', predecessors },
    }]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N13 swapped definition items cannot forge a target rename', () => {
    const { predecessor, current } = reliableTargetPair({
      currentFoo: null,
      currentBar: 'pub struct Boilerplate;\npub struct TargetThing { pub changed: bool }\n',
    });
    assertDispositionRefused(predecessor, current, /ambiguous ownership target removal/u);
  });

  await t.test('N14 edited owner relabel is caught over analysis.edges', () => {
    const predecessor = scenarioSnapshot({
      'src/service_a.rs': `pub struct Stable;\n${functionCarrier('service_b')}`,
      'src/service_b.rs': targetSource(),
    }, { 'src/service_a.rs': 'sync-realtime-engine', 'src/service_b.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/service_a.rs', to: 'src/service_b.rs', obligation: D1 }]);
    const current = scenarioSnapshot({
      'src/service_a.rs': `pub struct Stable;\n${functionCarrier('service_b', { attribute: '#[inline]\n' })}`,
      'src/service_b.rs': targetSource(),
    }, { 'src/service_a.rs': 'transport-adapters', 'src/service_b.rs': 'background-services' });
    assertDispositionRefused(predecessor, current, /discharge refused/u);
  });

  await t.test('N15 same-owner collapse is caught without violationReason', () => {
    const predecessor = scenarioSnapshot({
      'src/service_a.rs': `pub struct Stable;\n${functionCarrier('service_b')}`,
      'src/service_b.rs': targetSource(),
    }, { 'src/service_a.rs': 'sync-realtime-engine', 'src/service_b.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/service_a.rs', to: 'src/service_b.rs', obligation: D1 }]);
    const current = scenarioSnapshot({
      'src/service_a.rs': `pub struct Stable;\n${functionCarrier('service_b', { attribute: '#[inline]\n' })}`,
      'src/service_b.rs': targetSource(),
    }, { 'src/service_a.rs': 'background-services', 'src/service_b.rs': 'background-services' });
    assertDispositionRefused(predecessor, current, /discharge refused/u);
  });

  await t.test('N16 record-less target rename carries rather than re-dates', () => {
    const { predecessor, current } = reliableTargetPair({
      currentFoo: null,
      currentBar: 'pub struct Boilerplate;\npub struct TargetThing;\n',
    });
    const predecessors = predecessor.baseline.frozenForbiddenEdges.map((record) => record.fingerprint);
    installScenarioRecords(current, [
      { from: 'src/h.rs', to: 'src/bar.rs', obligation: D2, lineage: { kind: 'module-relocation', predecessors } },
      { from: 'src/bridge.rs', to: 'src/bar.rs', obligation: D2, lineage: { kind: 'module-relocation', predecessors } },
    ]);
    assertDispositionRefused(predecessor, current);
  });

  await t.test('N17 target husk cannot short-circuit the leftover set', () => {
    const { predecessor, current } = reliableTargetPair({
      currentFoo: 'pub struct Stub;\n',
      currentBar: 'pub struct Boilerplate;\npub struct TargetThing { pub changed: bool }\n',
    });
    assertDispositionRefused(predecessor, current, /ambiguous ownership target removal/u);
  });

  await t.test('N18 parked-copy identity sink cannot win over live leftover', () => {
    const { predecessor, current } = reliableTargetPair({
      currentFoo: null,
      currentBar: 'pub struct Boilerplate;\npub struct TargetThing { pub changed: bool }\n',
      extraCurrentSources: {
        'src/unused_foo.rs': 'pub struct Boilerplate;\npub struct TargetThing;\n',
      },
      extraCurrentAssignments: { 'src/unused_foo.rs': 'background-services' },
    });
    assertDispositionRefused(predecessor, current, /ambiguous ownership target removal/u);
  });

  await t.test('N18b same-path parked copy still computes L after S', () => {
    const { predecessor, current } = reliableTargetPair({
      currentFoo: 'pub struct Boilerplate;\npub struct TargetThing;\n',
      currentBar: 'pub struct Boilerplate;\npub struct TargetThing { pub changed: bool }\n',
    });
    assertDispositionRefused(predecessor, current, /ambiguous ownership target removal/u);
  });

  await t.test('N19 obligated-host rename plus edit computes LH', () => {
    const predecessor = scenarioSnapshot({
      'src/service_a.rs': `pub struct Stable;\n${functionCarrier('service_b')}`,
      'src/service_b.rs': targetSource(),
    }, { 'src/service_a.rs': 'sync-realtime-engine', 'src/service_b.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/service_a.rs', to: 'src/service_b.rs', obligation: D1 }]);
    const current = scenarioSnapshot({
      'src/service_a2.rs': `pub struct Stable;\n${functionCarrier('service_b', { attribute: '#[inline]\n' })}`,
      'src/service_b.rs': targetSource(),
    }, { 'src/service_a2.rs': 'transport-adapters', 'src/service_b.rs': 'background-services' });
    assertDispositionRefused(predecessor, current, /discharge refused/u);
  });

  await t.test('N20 a present host husk cannot short-circuit LH', () => {
    const predecessor = scenarioSnapshot({
      'src/service_a.rs': `pub struct Stable;\n${functionCarrier('service_b')}`,
      'src/service_b.rs': targetSource(),
    }, { 'src/service_a.rs': 'sync-realtime-engine', 'src/service_b.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/service_a.rs', to: 'src/service_b.rs', obligation: D1 }]);
    const current = scenarioSnapshot({
      'src/service_a.rs': 'pub struct Stub;\n',
      'src/service_a2.rs': `pub struct Stable;\n${functionCarrier('service_b', { attribute: '#[inline]\n' })}`,
      'src/service_b.rs': targetSource(),
    }, {
      'src/service_a.rs': 'sync-realtime-engine',
      'src/service_a2.rs': 'transport-adapters',
      'src/service_b.rs': 'background-services',
    });
    assertDispositionRefused(predecessor, current, /discharge refused/u);
  });
});

test('LLP 0273 §4 positive matrix P1-P8 admits honest conservation', async (t) => {
  await t.test('P1 genuine god-file extraction carries verbatim', () => {
    const predecessor = scenarioSnapshot({
      'src/local.rs': functionCarrier('connected_clients'),
      'src/connected_clients.rs': targetSource(),
    }, { 'src/local.rs': 'sync-realtime-engine', 'src/connected_clients.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/local.rs', to: 'src/connected_clients.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/local.rs', 'src/connected_clients.rs'));
    const current = scenarioSnapshot({
      'src/server/writer_gate.rs': functionCarrier('connected_clients'),
      'src/connected_clients.rs': targetSource(),
    }, {
      'src/server/writer_gate.rs': 'sync-realtime-engine',
      'src/connected_clients.rs': 'background-services',
    });
    installScenarioRecords(current, [{
      from: 'src/server/writer_gate.rs', to: 'src/connected_clients.rs', obligation: D1,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    assertDispositionAdmitted(predecessor, current);
  });

  await t.test('P2 forbidden owner re-key carries verbatim', () => {
    const sources = { 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() };
    const predecessor = scenarioSnapshot(sources, {
      'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot(sources, {
      'src/g.rs': 'generation-activation-coordinator', 'src/target.rs': 'background-services',
    });
    installScenarioRecords(current, [{
      from: 'src/g.rs', to: 'src/target.rs', obligation: D1,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    assertDispositionAdmitted(predecessor, current);
  });

  await t.test('P3 method-granular carrier admits extraction from a large impl', () => {
    const method = 'pub fn coupling() { let _ = core::mem::size_of::<crate::target::TargetThing>(); }';
    const otherMethods = Array.from({ length: 40 }, (_, index) => `pub fn other_${index}() {}`).join('\n');
    const predecessor = scenarioSnapshot({
      'src/g.rs': `pub struct Host;\nimpl Host { ${method}\n${otherMethods} }\n`,
      'src/target.rs': targetSource(),
    }, { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/g.rs': `pub struct Host;\nimpl Host { ${otherMethods} }\n`,
      'src/m.rs': `pub struct Moved;\nimpl Moved { ${method} }\n`,
      'src/target.rs': targetSource(),
    }, {
      'src/g.rs': 'sync-realtime-engine', 'src/m.rs': 'sync-realtime-engine',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(current, [{
      from: 'src/m.rs', to: 'src/target.rs', obligation: D1,
      lineage: { kind: 'relocation', predecessors: [prior] },
    }]);
    const priorCarriers = predecessor.analysis.edgeOccurrences.get(JSON.stringify([
      'src/g.rs', 'sync-realtime-engine', 'src/target.rs', 'background-services',
    ]));
    const currentCarriers = current.analysis.edgeOccurrences.get(JSON.stringify([
      'src/m.rs', 'sync-realtime-engine', 'src/target.rs', 'background-services',
    ]));
    assert([...priorCarriers.keys()].some((fingerprint) => currentCarriers.has(fingerprint)));
    assertDispositionAdmitted(predecessor, current);
  });

  await t.test('P4 honest merge admits through byte-scan promotion', () => {
    const one = functionCarrier('target', { name: 'one' });
    const two = functionCarrier('target', { name: 'two' });
    const predecessor = scenarioSnapshot({
      'src/g1.rs': one, 'src/g2.rs': two, 'src/target.rs': targetSource(),
    }, {
      'src/g1.rs': 'sync-realtime-engine',
      'src/g2.rs': 'generation-activation-coordinator',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [
      { from: 'src/g1.rs', to: 'src/target.rs', obligation: D1 },
      { from: 'src/g2.rs', to: 'src/target.rs', obligation: D3 },
    ]);
    const predecessors = predecessor.baseline.frozenForbiddenEdges.map((record) => record.fingerprint);
    const current = scenarioSnapshot({
      'src/m.rs': `${one}${two}`, 'src/target.rs': targetSource(),
    }, { 'src/m.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(current, [{
      from: 'src/m.rs', to: 'src/target.rs',
      obligation: {
        kind: 'time-bounded-waiver',
        deadline: D1.deadline,
        inversionOwners: ['generation-activation-coordinator', 'sync-realtime-engine'],
      },
      lineage: { kind: 'merge', predecessors },
    }]);
    assertDispositionAdmitted(predecessor, current);
  });

  await t.test('P5 predecessor grant authorizes an exact deadline extension', () => {
    const sources = { 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() };
    const assignments = { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' };
    const predecessor = scenarioSnapshot(sources, assignments);
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const fingerprint = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const priorFields = { obligation: D1 };
    const newFields = { obligation: D2 };
    const grant = {
      grantId: 'deadline-extension-p5', scope: { fingerprint }, kind: 'deadline-change',
      direction: 'weaken', priorFields, newFields,
    };
    predecessor.llps = new Map([[
      'llp/0998-amendments.decision.md',
      `<!-- module-ownership-amendment-grant: ${JSON.stringify(grant)} -->`,
    ]]);
    const amendment = {
      priorFingerprint: fingerprint, newFingerprint: fingerprint,
      priorFields, newFields, kind: 'deadline-change',
      authorization: { record: 'llp/0998-amendments.decision.md', clauseId: grant.grantId },
      provenance: 'The predecessor grant authorizes exactly this bounded deadline extension.',
    };
    const current = scenarioSnapshot(sources, assignments);
    installScenarioRecords(current, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D2 }], {
      amendments: [amendment],
    });
    assertDispositionAdmitted(predecessor, current);
    const candidate = buildBaselineDocument(
      current.analysis,
      current.manifest,
      predecessor,
      current.issues,
      current.llps,
    );
    assert.deepEqual(
      candidate.frozenForbiddenEdges[0].attribution.obligation,
      D2,
      '--update-baseline builder must retain the authorized new fields',
    );
  });

  await t.test('P6 honest burn-down discharges after resolved and byte backstops clear', () => {
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier(), 'src/target.rs': targetSource(),
    }, { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const current = scenarioSnapshot({
      'src/g.rs': 'pub struct Stable;\n', 'src/target.rs': targetSource(),
    }, { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    assertDispositionAdmitted(predecessor, current);
  });

  await t.test('P7 computed-identity genuine removal ignores unrelated pre-existing targets', () => {
    const predecessor = scenarioSnapshot({
      'src/g.rs': `${functionCarrier('foo')}pub fn unrelated() { let _ = crate::kernel::Kernel; }\n`,
      'src/foo.rs': 'pub struct TargetThing;\n',
      'src/kernel.rs': 'pub struct Kernel;\n',
    }, {
      'src/g.rs': 'sync-realtime-engine', 'src/foo.rs': 'background-services',
      'src/kernel.rs': 'storage-migration-kernel',
    });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/foo.rs', obligation: D1 }]);
    const current = scenarioSnapshot({
      'src/g.rs': 'pub fn unrelated() { let _ = crate::kernel::Kernel; }\n',
      'src/kernel.rs': 'pub struct Kernel;\n',
    }, { 'src/g.rs': 'sync-realtime-engine', 'src/kernel.rs': 'storage-migration-kernel' });
    assertDispositionAdmitted(predecessor, current);
  });

  await t.test('P8 honest split carries one obligation and freshly attributes the surplus', () => {
    const predecessor = scenarioSnapshot({
      'src/g.rs': functionCarrier(), 'src/target.rs': targetSource(),
    }, { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' });
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const current = scenarioSnapshot({
      'src/m1.rs': functionCarrier('target', { name: 'one' }),
      'src/m2.rs': functionCarrier('target', { name: 'two' }),
      'src/target.rs': targetSource(),
    }, {
      'src/m1.rs': 'sync-realtime-engine', 'src/m2.rs': 'sync-realtime-engine',
      'src/target.rs': 'background-services',
    });
    installScenarioRecords(current, [
      { from: 'src/m1.rs', to: 'src/target.rs', obligation: D1, lineage: { kind: 'split', predecessors: [prior] } },
      { from: 'src/m2.rs', to: 'src/target.rs', obligation: D2, lineage: { kind: 'split', predecessors: [prior] } },
    ]);
    assertDispositionAdmitted(predecessor, current);

    const candidate = buildBaselineDocument(
      current.analysis,
      current.manifest,
      predecessor,
      current.issues,
      current.llps,
    );
    const updated = { ...current, baseline: candidate };
    assertDispositionAdmitted(predecessor, updated);
    assert.equal(candidate.frozenForbiddenEdgeCount, 2);
  });
});

test('LLP 0273 §3.7 grants are predecessor-byte exact and globally unambiguous', async (t) => {
  await t.test('valid ownership-correction grant retires an allowed live edge', () => {
    const sources = { 'src/service_a.rs': functionCarrier('service_b'), 'src/service_b.rs': targetSource() };
    const predecessor = scenarioSnapshot(sources, {
      'src/service_a.rs': 'sync-realtime-engine', 'src/service_b.rs': 'background-services',
    });
    installScenarioRecords(predecessor, [{ from: 'src/service_a.rs', to: 'src/service_b.rs', obligation: D1 }]);
    const prior = edgeFingerprint(scenarioEdge(predecessor, 'src/service_a.rs', 'src/service_b.rs'));
    const current = scenarioSnapshot(sources, {
      'src/service_a.rs': 'transport-adapters', 'src/service_b.rs': 'background-services',
    });
    const next = edgeFingerprint(scenarioEdge(current, 'src/service_a.rs', 'src/service_b.rs'));
    const priorFields = { obligation: D1 };
    const newFields = { obligation: null };
    const grant = {
      grantId: 'authorized-owner-correction', scope: { target: 'src/service_b.rs' },
      kind: 'ownership-correction', direction: 'weaken', priorFields, newFields,
    };
    predecessor.llps = new Map([[
      'llp/0997-owner-correction.decision.md',
      `<!-- module-ownership-amendment-grant: ${JSON.stringify(grant)} -->`,
    ]]);
    installScenarioRecords(current, [], { amendments: [{
      priorFingerprint: prior, newFingerprint: next, priorFields, newFields,
      kind: 'ownership-correction',
      authorization: {
        record: 'llp/0997-owner-correction.decision.md',
        clauseId: grant.grantId,
      },
      provenance: 'The predecessor decision grants exactly this ownership correction transition.',
    }] });
    assertDispositionAdmitted(predecessor, current);
  });

  await t.test('duplicate predecessor grantId is a gate red', () => {
    const assignments = { 'src/g.rs': 'sync-realtime-engine', 'src/target.rs': 'background-services' };
    const sources = { 'src/g.rs': functionCarrier(), 'src/target.rs': targetSource() };
    const predecessor = scenarioSnapshot(sources, assignments);
    installScenarioRecords(predecessor, [{ from: 'src/g.rs', to: 'src/target.rs', obligation: D1 }]);
    const fingerprint = edgeFingerprint(scenarioEdge(predecessor, 'src/g.rs', 'src/target.rs'));
    const grant = {
      grantId: 'duplicate-grant', scope: { fingerprint }, kind: 'deadline-change',
      direction: 'any', priorFields: null, newFields: null,
    };
    predecessor.llps = new Map([
      ['llp/0995-one.decision.md', `<!-- module-ownership-amendment-grant: ${JSON.stringify(grant)} -->`],
      ['llp/0996-two.decision.md', `<!-- module-ownership-amendment-grant: ${JSON.stringify(grant)} -->`],
    ]);
    const current = installScenarioRecords(scenarioSnapshot(sources, assignments), [
      { from: 'src/g.rs', to: 'src/target.rs', obligation: D1 },
    ]);
    assertDispositionRefused(predecessor, current, /duplicate amendment grantId/u);
  });
});
