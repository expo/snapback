// Two authenticated principals exercise six ordinary Familiar hook-owned live
// references and one equivalent relational reference under the same writes.
// The receipt is deliberately state-rich so a 15-second miss preserves the
// authority, outbox, snapshot-version, and subscription facts at the miss.
//
// @ref LLP 0295#1d-current-source-qualification-and-developer-loop-cost — the
// six-reference observation must be classified before choosing a mechanism.
// @ref LLP 0253#s62-usequery — stable args and the Familiar total projection
// are part of the reproduction rather than a source-checkout approximation.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import {
  SnapbackProvider,
  useMutation,
  useQuery,
  useQueryState,
} from '../../packages/snapback-react/familiar.mjs';
import { createSnapbackReactCoreProvider } from '../../packages/snapback-react/implementation.mjs';
import { asUser } from '../../demos/_kit/as-user.mjs';
import { importGeneratedModule } from '../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const fixtureRoot = join(here, 'fixtures', 'familiar-six-subscription-contention');
const referenceNames = Object.freeze([
  'profiles', 'posts', 'follows', 'likes', 'reposts', 'replies',
]);
const emptyArgs = Object.freeze({});
const observationCeilingMs = 15_000;
const lateConvergenceCeilingMs = 60_000;
const writesPerArm = 6;
const r1ObservationMode = process.env.SNAPBACK_R1_CONTENTION_OBSERVATION === '1';
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

function stateSummary(state) {
  return {
    status: state.status,
    connection: state.connection,
    freshness: state.freshness,
    errorCode: state.error?.code ?? state.error?.diagnostic?.code ?? null,
  };
}

function tableSummary(rows, labels) {
  return Object.fromEntries(
    [...(Array.isArray(rows) ? rows : [])]
      .sort((left, right) => left.ownerId.localeCompare(right.ownerId))
      .map((row) => [
        labels.get(row.ownerId) ?? `unknown:${String(row.ownerId).slice(0, 12)}`,
        { revision: row.revision, enabled: row.enabled },
      ]),
  );
}

function ordinaryTables(values, labels) {
  return Object.fromEntries(referenceNames.map((name) => [
    name,
    tableSummary(values[name]?.data, labels),
  ]));
}

function relationalTables(value, labels) {
  const row = Array.isArray(value?.data) ? value.data[0] : null;
  return Object.fromEntries(referenceNames.map((name) => [
    name,
    tableSummary(row?.[name], labels),
  ]));
}

function tablesAreCoherent(tables) {
  const byPrincipal = new Map();
  for (const name of referenceNames) {
    for (const [principal, value] of Object.entries(tables[name])) {
      const seen = byPrincipal.get(principal) ?? [];
      seen.push(value.revision);
      byPrincipal.set(principal, seen);
    }
  }
  return [...byPrincipal.values()].every((revisions) => (
    revisions.length === referenceNames.length
      && new Set(revisions).size === 1
  ));
}

function tablesMatch(tables, expected, labels) {
  for (const name of referenceNames) {
    const table = tables[name];
    if (Object.keys(table).length !== expected.size) return false;
    for (const [userId, value] of expected) {
      const actual = table[labels.get(userId)];
      if (!actual || actual.revision !== value.revision || actual.enabled !== value.enabled) {
        return false;
      }
    }
  }
  return true;
}

function SixReferenceProbe({ api, labels, publish, installMutation }) {
  const values = {
    profiles: {
      data: useQuery(api.contention.profiles, emptyArgs),
      state: useQueryState(api.contention.profiles, emptyArgs),
    },
    posts: {
      data: useQuery(api.contention.posts, emptyArgs),
      state: useQueryState(api.contention.posts, emptyArgs),
    },
    follows: {
      data: useQuery(api.contention.follows, emptyArgs),
      state: useQueryState(api.contention.follows, emptyArgs),
    },
    likes: {
      data: useQuery(api.contention.likes, emptyArgs),
      state: useQueryState(api.contention.likes, emptyArgs),
    },
    reposts: {
      data: useQuery(api.contention.reposts, emptyArgs),
      state: useQueryState(api.contention.reposts, emptyArgs),
    },
    replies: {
      data: useQuery(api.contention.replies, emptyArgs),
      state: useQueryState(api.contention.replies, emptyArgs),
    },
  };
  const mutate = useMutation(api.contention.setState);
  React.useEffect(() => installMutation(mutate), [installMutation, mutate]);
  React.useEffect(() => {
    publish({
      tables: ordinaryTables(values, labels),
      states: Object.fromEntries(referenceNames.map((name) => [
        name, stateSummary(values[name].state),
      ])),
    });
  });
  return null;
}

function RelationalProbe({ api, labels, publish, installMutation }) {
  const value = {
    data: useQuery(api.contention.relationalState, emptyArgs),
    state: useQueryState(api.contention.relationalState, emptyArgs),
  };
  const mutate = useMutation(api.contention.setState);
  React.useEffect(() => installMutation(mutate), [installMutation, mutate]);
  React.useEffect(() => {
    publish({
      tables: relationalTables(value, labels),
      states: { relationalState: stateSummary(value.state) },
    });
  });
  return null;
}

async function until(predicate, message, ceilingMs = observationCeilingMs) {
  const deadline = Date.now() + ceilingMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => { await tick(); });
  }
  throw new Error(`timed out after ${ceilingMs}ms waiting for ${message}`);
}

function instrumentLiveQueries(session, label, labels) {
  const frames = [];
  const original = session.client.startLiveQuery;
  session.client.startLiveQuery = function startLiveQuery(reference, options = {}) {
    return original.call(this, reference, {
      ...options,
      onUpdate(rows, detail = {}) {
        const leaf = reference.name.split('.').at(-1);
        const tables = leaf === 'relationalState'
          ? relationalTables({ data: rows }, labels)
          : { [leaf]: tableSummary(rows, labels) };
        frames.push({
          principal: label,
          reference: reference.name,
          kind: detail.kind ?? null,
          freshness: detail.freshness ?? null,
          version: Number.isSafeInteger(detail.version) ? detail.version : null,
          tables,
        });
        act(() => { options.onUpdate?.(rows, detail); });
      },
    });
  };
  return {
    frames,
    restore() { session.client.startLiveQuery = original; },
  };
}

function transportSummary(frames) {
  const references = {};
  for (const frame of frames) {
    const current = references[frame.reference] ?? {
      frames: 0,
      versions: [],
      kinds: {},
      lastTables: null,
    };
    current.frames += 1;
    if (frame.version !== null) current.versions.push(frame.version);
    current.kinds[frame.kind ?? 'unspecified'] = (current.kinds[frame.kind ?? 'unspecified'] ?? 0) + 1;
    current.lastTables = frame.tables;
    references[frame.reference] = current;
  }
  return Object.fromEntries(Object.entries(references).map(([name, value]) => [name, {
    frames: value.frames,
    firstVersion: value.versions.at(0) ?? null,
    lastVersion: value.versions.at(-1) ?? null,
    distinctVersions: new Set(value.versions).size,
    kinds: value.kinds,
    lastTables: value.lastTables,
  }]));
}

function authState(session) {
  const authority = session.coordinator.authority;
  const capture = session.coordinator.capture();
  return {
    phase: session.coordinator.phase,
    capture: {
      authorityEpoch: capture.authorityEpoch,
      custodyRevision: capture.custodyRevision,
    },
    authority: authority === null ? null : {
      kind: authority.kind,
      isAuthenticated: authority.isAuthenticated,
      userId: authority.userId,
      sessionId: authority.sessionId,
      authorizationStreamIncarnation: authority.authorizationStreamIncarnation ?? null,
    },
    terminal: session.client.authTerminalStatus(),
  };
}

function providerState(provider) {
  const state = provider.inspection();
  return {
    stores: state.stores,
    consumers: state.consumers,
    serverSubscriptions: state.serverSubscriptions,
    leases: state.leases,
    listeners: state.listeners,
    terminal: state.terminal,
    custodyPaused: state.custodyPaused,
    hostPaused: state.hostPaused,
    diagnostics: state.diagnostics.map((entry) => entry?.code ?? entry?.diagnostic?.code ?? null),
  };
}

function reactSummary(surface) {
  const incoherent = surface.reactFrames.filter((frame) => !tablesAreCoherent(frame.tables));
  return {
    renders: surface.reactFrames.length,
    incoherentRenders: incoherent.length,
    last: surface.current,
  };
}

function diagnosticCode(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

function liveEvaluationDelta(arm, field) {
  const before = arm.before.server.liveEvaluation?.[field];
  const after = arm.after.server.liveEvaluation?.[field];
  assert.equal(Number.isSafeInteger(before), true, `${arm.arm} before ${field} must be inspectable`);
  assert.equal(Number.isSafeInteger(after), true, `${arm.arm} after ${field} must be inspectable`);
  return after - before;
}

function assertPrincipalAvailable(principal, {
  context,
  expectedSubscriptions,
}) {
  assert.equal(principal.auth.phase, 'settled', `${context} auth must be settled`);
  assert.equal(principal.auth.authority?.kind, 'session', `${context} must retain session authority`);
  assert.equal(
    principal.auth.authority?.isAuthenticated,
    true,
    `${context} must retain authenticated authority`,
  );
  assert.equal(principal.auth.terminal?.terminated, false, `${context} auth must not be terminal`);

  // asUser deliberately installs no RQS store. That makes queued outbox work
  // structurally unavailable; pending:0 alone would be a tautology and is not
  // used as evidence against an outbox explanation.
  assert.equal(principal.outbox.supported, false, `${context} must have no queued outbox`);

  assert.equal(principal.subscriptions.provider.terminal, false, `${context} provider must be live`);
  assert.equal(
    principal.subscriptions.provider.custodyPaused,
    false,
    `${context} provider custody must not be paused`,
  );
  assert.equal(
    principal.subscriptions.provider.hostPaused,
    false,
    `${context} provider host must not be paused`,
  );
  assert.equal(
    principal.subscriptions.provider.stores,
    expectedSubscriptions,
    `${context} provider store count`,
  );
  assert.equal(
    principal.subscriptions.provider.serverSubscriptions,
    expectedSubscriptions,
    `${context} provider subscription count`,
  );
  assert.equal(
    principal.subscriptions.client.managerCount,
    1,
    `${context} must retain one client connection manager`,
  );
  assert.equal(
    principal.subscriptions.client.managers[0]?.open,
    true,
    `${context} client socket must be open`,
  );
  assert.equal(
    principal.subscriptions.client.managers[0]?.closed,
    false,
    `${context} client socket must not be closed`,
  );

  const states = principal.snapshot.last?.states ?? {};
  assert.equal(
    Object.keys(states).length,
    expectedSubscriptions,
    `${context} must retain every React query state`,
  );
  for (const [reference, state] of Object.entries(states)) {
    assert.ok(
      state.status === 'ready' || state.status === 'refreshing',
      `${context} ${reference} must remain ready or refreshing`,
    );
    assert.equal(state.connection, 'live', `${context} ${reference} connection must remain live`);
    assert.equal(state.freshness, 'current', `${context} ${reference} must remain current`);
    assert.equal(state.errorCode, null, `${context} ${reference} must have no query error`);
  }
}

function assertArmBoundaryFacts(arm) {
  for (const [boundary, state] of [['before', arm.before], ['after', arm.after]]) {
    for (const [label, principal] of Object.entries(state.principals)) {
      assertPrincipalAvailable(principal, {
        context: `${arm.arm} ${boundary} ${label}`,
        expectedSubscriptions: arm.expectedSubscriptionsPerPrincipal,
      });
    }
  }
}

function assertMissClassificationFacts(arm, miss) {
  const expectedSubscriptions = arm.expectedSubscriptionsPerPrincipal;
  for (const [label, principal] of Object.entries(miss.state.principals)) {
    const context = `${arm.arm} revision ${miss.revision} miss ${label}`;
    assertPrincipalAvailable(principal, { context, expectedSubscriptions });
    const transport = Object.values(principal.transport);
    assert.equal(
      transport.length,
      expectedSubscriptions,
      `${context} must retain transport facts for every reference`,
    );
    const lastVersions = transport
      .map((reference) => reference.lastVersion)
      .filter((version) => Number.isSafeInteger(version));
    assert.equal(
      lastVersions.length,
      expectedSubscriptions,
      `${context} must retain every transport snapshot version`,
    );
    assert.ok(
      lastVersions.every((version) => version >= 0),
      `${context} must report a non-negative version for every reference`,
    );
  }
  assert.equal(
    miss.state.server.subscriptions,
    expectedSubscriptions * Object.keys(miss.state.principals).length,
    `${arm.arm} revision ${miss.revision} must retain every server subscription`,
  );
  const beforeOverloads = (
    arm.before.server.recentDiagnostics.SNAPBACK_LIVE_OVERLOAD_DEGRADE ?? 0
  );
  const missOverloads = (
    miss.state.server.recentDiagnostics.SNAPBACK_LIVE_OVERLOAD_DEGRADE ?? 0
  );
  assert.ok(
    missOverloads > beforeOverloads,
    `${arm.arm} revision ${miss.revision} must coincide with an overload conversion`,
  );
}

async function mountSurface({ arm, session, label, binding, api, labels }) {
  const connectionId = `familiar-contention-${arm}-${label}`;
  const provider = createSnapbackReactCoreProvider(binding, { connectionId });
  const surface = {
    arm,
    connectionId,
    provider,
    renderer: null,
    current: null,
    mutate: null,
    reactFrames: [],
  };
  const publish = (value) => {
    surface.current = value;
    surface.reactFrames.push(value);
  };
  const installMutation = (mutate) => { surface.mutate = mutate; };
  const Probe = arm === 'six-references' ? SixReferenceProbe : RelationalProbe;
  await act(async () => {
    surface.renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(Probe, { api, labels, publish, installMutation }),
    ));
    await tick();
  });
  await until(
    () => surface.mutate !== null
      && surface.current !== null
      && Object.values(surface.current.states).every((state) => state.status === 'ready'),
    `${arm} ${label} hooks to become ready`,
  );
  return surface;
}

async function disposeSurface(surface) {
  await act(async () => {
    surface.renderer.unmount();
    await tick();
  });
  await surface.provider.dispose();
}

function latencySummary(samples) {
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) => ordered[Math.min(
    ordered.length - 1,
    Math.ceil(ordered.length * fraction) - 1,
  )];
  return {
    samplesMs: samples,
    minMs: ordered[0],
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: ordered.at(-1),
  };
}

async function captureArmState({ surfaces, sessions, instruments, frameOffsets }) {
  const principals = {};
  for (let index = 0; index < sessions.length; index += 1) {
    const { label, session } = sessions[index];
    const surface = surfaces[index];
    principals[label] = {
      auth: authState(session),
      outbox: await session.client.outboxStatus(),
      snapshot: reactSummary(surface),
      subscriptions: {
        provider: providerState(surface.provider),
        client: session.client.localResourceInspection([surface.connectionId]),
      },
      transport: transportSummary(instruments[index].frames.slice(frameOffsets[index])),
    };
  }
  const serverInspection = await sessions[0].session.client.inspect();
  const recentDiagnostics = {};
  for (const diagnostic of serverInspection.recentDiagnostics ?? []) {
    const code = diagnostic.code ?? 'unspecified';
    recentDiagnostics[code] = (recentDiagnostics[code] ?? 0) + 1;
  }
  return {
    principals,
    server: {
      activeConnections: serverInspection.activeConnections ?? null,
      subscriptions: serverInspection.subscriptions?.length ?? null,
      liveEvaluation: serverInspection.liveEvaluation ?? null,
      liveCoalesce: serverInspection.liveCoalesce ?? null,
      liveWatermarks: serverInspection.liveWatermarks ?? null,
      recentDiagnostics,
    },
  };
}

function compactMissState(state) {
  return {
    principals: Object.fromEntries(Object.entries(state.principals).map(([label, principal]) => [
      label,
      {
        auth: principal.auth,
        outbox: principal.outbox,
        snapshot: principal.snapshot,
        subscriptions: principal.subscriptions,
        transport: Object.fromEntries(Object.entries(principal.transport).map(([name, value]) => [
          name,
          {
            frames: value.frames,
            lastVersion: value.lastVersion,
            kinds: value.kinds,
          },
        ])),
      },
    ])),
    server: state.server,
  };
}

async function runArm({
  arm,
  sessions,
  bindings,
  api,
  labels,
  expected,
  firstRevision,
  instruments,
}) {
  const frameOffsets = instruments.map((instrument) => instrument.frames.length);
  const surfaces = [];
  try {
    for (let index = 0; index < sessions.length; index += 1) {
      surfaces.push(await mountSurface({
        arm,
        session: sessions[index].session,
        label: sessions[index].label,
        binding: bindings[index],
        api,
        labels,
      }));
    }
    await until(
      () => surfaces.every((surface) => tablesMatch(surface.current.tables, expected, labels)),
      `${arm} initial snapshots to agree`,
    );
    const expectedSubscriptions = arm === 'six-references' ? 6 : 1;
    for (const surface of surfaces) {
      assert.equal(providerState(surface.provider).stores, expectedSubscriptions);
      assert.equal(providerState(surface.provider).serverSubscriptions, expectedSubscriptions);
    }
    const before = await captureArmState({ surfaces, sessions, instruments, frameOffsets });
    const settlementLatencies = [];
    const convergenceLatencies = [];
    const totalLatencies = [];
    const misses = [];
    const mutationOutcomes = [];
    for (let offset = 0; offset < writesPerArm; offset += 1) {
      const writerIndex = offset % sessions.length;
      const writer = sessions[writerIndex];
      const revision = firstRevision + offset;
      const enabled = revision % 2 === 0;
      const started = performance.now();
      let mutationResult;
      try {
        await act(async () => {
          mutationResult = await surfaces[writerIndex].mutate({ revision, enabled });
        });
      } catch (error) {
        mutationOutcomes.push({
          revision,
          writer: writer.label,
          status: 'rejected',
          code: diagnosticCode(error),
        });
        throw error;
      }
      mutationOutcomes.push({
        revision,
        writer: writer.label,
        status: 'fulfilled',
        code: null,
      });
      const settled = performance.now();
      const settlementMs = Math.round(settled - started);
      assert.deepEqual(mutationResult, { revision, changed: 6 });
      expected.set(writer.session.userId, { revision, enabled });
      try {
        await until(
          () => surfaces.every((surface) => tablesMatch(surface.current.tables, expected, labels)),
          `${arm} revision ${revision} to reach both principals`,
        );
      } catch (error) {
        const miss = await captureArmState({ surfaces, sessions, instruments, frameOffsets });
        misses.push({
          revision,
          writer: writer.label,
          settlementMs,
          afterSettlementMs: Math.round(performance.now() - settled),
          state: compactMissState(miss),
        });
        assertMissClassificationFacts({
          arm,
          expectedSubscriptionsPerPrincipal: expectedSubscriptions,
          before,
        }, misses.at(-1));
        try {
          await until(
            () => surfaces.every((surface) => tablesMatch(surface.current.tables, expected, labels)),
            `${arm} revision ${revision} late convergence`,
            lateConvergenceCeilingMs,
          );
        } catch (lateError) {
          const lateState = await captureArmState({
            surfaces, sessions, instruments, frameOffsets,
          });
          throw new Error(
            `${lateError.message}\ninitial-miss=${JSON.stringify(miss, null, 2)}`
              + `\nlate-state=${JSON.stringify(lateState, null, 2)}`,
            { cause: lateError },
          );
        }
      }
      const converged = performance.now();
      settlementLatencies.push(settlementMs);
      convergenceLatencies.push(Math.round(converged - settled));
      totalLatencies.push(Math.round(converged - started));
      for (const { session } of sessions) {
        const outbox = await session.client.outboxStatus();
        assert.equal(outbox.supported, false, `${arm} intentionally has no queued outbox`);
        assert.equal(session.client.authTerminalStatus().terminated, false);
      }
    }
    const after = await captureArmState({ surfaces, sessions, instruments, frameOffsets });
    return {
      arm,
      writes: writesPerArm,
      observationCeilingMs,
      expectedSubscriptionsPerPrincipal: expectedSubscriptions,
      mutationOutcomes,
      misses,
      before,
      after,
      settlement: latencySummary(settlementLatencies),
      convergenceAfterSettlement: latencySummary(convergenceLatencies),
      total: latencySummary(totalLatencies),
    };
  } finally {
    // React's test renderer owns one process-global act scope. Dispose the two
    // principal surfaces in order so cleanup cannot overlap that scope and
    // poison the following comparison arm.
    for (const surface of surfaces) await disposeSurface(surface);
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'snapback-familiar-six-contention-'));
let server = null;
const sessions = [];
const instruments = [];

try {
  const backendRoot = join(scratch, 'snapback');
  await cp(fixtureRoot, backendRoot, { recursive: true });
  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const generatedRoot = join(backendRoot, 'generated');
  const schema = JSON.parse(await readFile(join(generatedRoot, 'schema.manifest.json'), 'utf8'));
  const functions = JSON.parse(await readFile(join(generatedRoot, 'functions.manifest.json'), 'utf8'));
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  await writeFile(startupArtifacts, `${JSON.stringify({
    formatVersion: 1,
    schema,
    functions,
  })}\n`, { mode: 0o600 });
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts,
    captureImpersonationCapability: true,
  });
  assert.equal(
    server.identity?.verdict,
    'verified',
    `contention qualification requires a current-source server, got ${JSON.stringify(server.identity)}`,
  );
  const selectedServerBinary = resolve(
    repositoryRoot,
    server.runtimeRecovery?.selectedBinary ?? '',
  );
  assert.notEqual(
    server.runtimeRecovery?.selectedBinary,
    undefined,
    'server launch must report the selected runtime binary',
  );
  const serverBinarySha256 = createHash('sha256')
    .update(await readFile(selectedServerBinary))
    .digest('hex');
  const alice = await asUser(server, schema.appId, 'alice@familiar-contention.test', {
    clientStoreId: 'familiar-contention-alice',
  });
  sessions.push({ label: 'alice', session: alice });
  const bob = await asUser(server, schema.appId, 'bob@familiar-contention.test', {
    clientStoreId: 'familiar-contention-bob',
  });
  sessions.push({ label: 'bob', session: bob });
  const labels = new Map(sessions.map(({ label, session }) => [session.userId, label]));
  for (const { label, session } of sessions) {
    instruments.push(instrumentLiveQueries(session, label, labels));
  }
  const { api, app } = await importGeneratedModule(generatedRoot, 'api.mjs');
  const bindings = await Promise.all(sessions.map(({ session }) => (
    session.client.prepareReactBinding({ generatedManifest: app })
  )));
  const expected = new Map();
  const sixReferences = await runArm({
    arm: 'six-references',
    sessions,
    bindings,
    api,
    labels,
    expected,
    firstRevision: 1,
    instruments,
  });
  const relationalReference = await runArm({
    arm: 'relational-reference',
    sessions,
    bindings,
    api,
    labels,
    expected,
    firstRevision: 1 + writesPerArm,
    instruments,
  });
  const overloadDegrades = {
    sixReferences: (
      sixReferences.after.server.recentDiagnostics.SNAPBACK_LIVE_OVERLOAD_DEGRADE ?? 0
    ) - (
      sixReferences.before.server.recentDiagnostics.SNAPBACK_LIVE_OVERLOAD_DEGRADE ?? 0
    ),
    relationalReference: (
      relationalReference.after.server.recentDiagnostics.SNAPBACK_LIVE_OVERLOAD_DEGRADE ?? 0
    ) - (
      relationalReference.before.server.recentDiagnostics.SNAPBACK_LIVE_OVERLOAD_DEGRADE ?? 0
    ),
  };
  assertArmBoundaryFacts(sixReferences);
  assertArmBoundaryFacts(relationalReference);
  if (!r1ObservationMode) {
    assert.ok(
      sixReferences.misses.length > 0,
      'six independent references must reproduce at least one post-settlement contention miss',
    );
  }
  assert.equal(
    relationalReference.misses.length,
    0,
    'the equivalent relational reference must stay within the observation ceiling',
  );
  if (!r1ObservationMode || sixReferences.misses.length > 0) {
    assert.ok(
      overloadDegrades.sixReferences > 0,
      'an independent-arm miss must record the documented overload conversion',
    );
  }
  assert.equal(
    overloadDegrades.relationalReference,
    0,
    'the relational control must not record an overload conversion',
  );
  const schedulerTurns = {
    sixReferences: {
      started: liveEvaluationDelta(sixReferences, 'evaluationsStarted'),
      finished: liveEvaluationDelta(sixReferences, 'evaluationsFinished'),
      abandoned: liveEvaluationDelta(sixReferences, 'evaluationsAbandoned'),
    },
    relationalReference: {
      started: liveEvaluationDelta(relationalReference, 'evaluationsStarted'),
      finished: liveEvaluationDelta(relationalReference, 'evaluationsFinished'),
      abandoned: liveEvaluationDelta(relationalReference, 'evaluationsAbandoned'),
    },
  };
  assert.deepEqual(
    schedulerTurns.sixReferences,
    { started: writesPerArm * 12, finished: writesPerArm * 12, abandoned: 0 },
    'six references for two principals must consume twelve scheduler turns per write',
  );
  assert.deepEqual(
    schedulerTurns.relationalReference,
    { started: writesPerArm * 2, finished: writesPerArm * 2, abandoned: 0 },
    'one relational reference for two principals must consume two scheduler turns per write',
  );
  const mutationOutcomes = [
    ...sixReferences.mutationOutcomes,
    ...relationalReference.mutationOutcomes,
  ];
  const mutationFailures = mutationOutcomes.filter((outcome) => outcome.status !== 'fulfilled');
  const authorizationSuspensions = mutationOutcomes.filter(
    (outcome) => outcome.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
  ).length;
  assert.equal(mutationFailures.length, 0, 'every settled-only Familiar mutation must fulfill');
  assert.equal(authorizationSuspensions, 0, 'no mutation may hit authorization suspension');
  const receipt = {
    schemaVersion: 'snapback.familiar-six-subscription-contention.v1',
    ok: true,
    principals: ['alice', 'bob'],
    classification: {
      category: sixReferences.misses.length > 0
        ? 'b-documented-composition-bound'
        : 'independent-form-green-within-observation-ceiling',
      owner: 'LLP 0200 §2.5',
      basis: sixReferences.misses.length > 0
        ? 'affected subscription count multiplied by serial evaluation cost exceeded max_hold'
        : 'all twelve independent subscriptions stayed live/current and all writes converged within 15 seconds',
    },
    classificationEvidence: {
      sixReferenceMisses: sixReferences.misses.length,
      relationalReferenceMisses: relationalReference.misses.length,
      mutationOutcomes,
      authorizationSuspensions,
      outbox: {
        supported: false,
        reason: 'asUser installs rqsStore:null; Familiar useMutation is queue:false',
      },
      overloadDegrades,
      schedulerTurns,
    },
    runtime: {
      launchRung: server.launch?.rung ?? null,
      identity: server.identity,
      serverBinary: selectedServerBinary,
      serverBinarySha256,
    },
    arms: [sixReferences, relationalReference],
  };
  const receiptPath = process.env.SNAPBACK_ACCEPTANCE_RECEIPT_PATH ?? null;
  if (receiptPath !== null) {
    const resolvedReceiptPath = resolve(receiptPath);
    await mkdir(dirname(resolvedReceiptPath), { recursive: true });
    await writeFile(resolvedReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  for (const instrument of instruments) instrument.restore();
  await Promise.allSettled(sessions.map(({ session }) => session.dispose()));
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
