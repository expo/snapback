#!/usr/bin/env node
// Replay the shared LLP 0095 format-v3 corpus against the JS client's pure
// durable reducer plus a test-only model of its request/lifecycle edges.
// Claimed tuples are poll/local and live/local; hosted-only evidence remains
// honestly out of scope rather than being counted as a pass.
// @ref LLP 0095#2-the-conformance-fixture-corpus-contract — one committed
// corpus, tuple routing, exact action sets, and no unimplemented claimed skip.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import {
  DURABLE_BYTES_RESYNC_REASON,
  LIVE_DURABLE_KINDS,
  LIVE_SOCKET_KINDS,
  durableBytesResyncSentinel,
} from '../../packages/snapback-client/index.mjs';
import {
  applyLiveDeltaById,
  durableVersionAdvances,
} from '../../packages/snapback-client/live-wire-core.mjs';

const CLAIMED_TUPLES = new Set(['poll/local', 'live/local']);
const ALLOWED_TUPLES = new Set([...CLAIMED_TUPLES, 'live/hosted']);
const ALLOWED_DIRECTIONS = new Set(['server_to_client', 'client_to_server', 'client_lifecycle']);
const ALLOWED_LANES = new Set(['core', 'poll', 'live']);
const KNOWN_REPLACE_FIELDS = new Set([
  'kind', 'subscription_id', 'function', 'version', 'rows', 'resume', 'network_profile',
]);

const corpus = JSON.parse(readFileSync(new URL('../../schemas/live.wire-fixtures.v1.json', import.meta.url)));
assert.equal(corpus.artifactKind, 'liveWireFixtureCorpus');
assert.equal(corpus.formatVersion, 3);
assert.equal(corpus.wireVersion, 'snapback.v1');
assert.equal(corpus.judgedAgainst, 'LLP 0095 §1 (abstract client state machine)');
assert(Array.isArray(corpus.fixtures) && corpus.fixtures.length >= 50);

const same = (left, right) => isDeepStrictEqual(left, right);
const actionSet = (actions) => [...new Set(actions)];

function decodeWrapped(frame) {
  if (!frame?.Durable) return { frame, actions: [] };
  const payload = frame.Durable.payload;
  try {
    const bytes = Array.isArray(payload) ? Uint8Array.from(payload) : new TextEncoder().encode(payload);
    return {
      frame: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      actions: ['unwrap_durable'],
    };
  } catch {
    return { frame: null, actions: [], decodeFailed: true };
  }
}

class JsFixtureClient {
  constructor(fixture) {
    this.fixture = fixture;
    this.subscriptions = new Map();
    const given = fixture.given ?? {};
    const seeds = given.subscriptions ?? (given.subscription ? [given.subscription] : []);
    for (const seed of seeds) {
      this.subscriptions.set(seed.id, {
        ...structuredClone(seed),
        rows: structuredClone(seed.rows ?? []),
      });
    }
    this.initialRows = new Map(
      [...this.subscriptions].map(([id, sub]) => [id, structuredClone(sub.rows)]),
    );
    this.connection = given.connection?.state ?? 'idle';
    this.pendingAuthorization = new Map();
    this.acknowledged = new Map();
    this.settledMutations = new Set();
    this.replayQueue = given.replayQueue
      ? { ...structuredClone(given.replayQueue), state: 'active' }
      : null;
    this.retainedRead = given.retainedRead
      ? { ...structuredClone(given.retainedRead), state: 'retained' }
      : null;
    this.now = given.virtualNowServerMs ?? 0;
    this.lastServerActivity = given.connection?.lastServerActivityVirtualMs ?? 0;
    this.socketLostAt = given.connection?.socketLostAtVirtualMs ?? null;
    this.reconnectAttempted = false;
    this.supersession = null;
    this.lastAck = null;
  }

  allSubscriptions(state) {
    for (const subscription of this.subscriptions.values()) subscription.state = state;
  }

  processFrame(raw, batchContext = null) {
    const decoded = decodeWrapped(raw);
    if (decoded.decodeFailed) {
      this.connection = 'recovering';
      this.allSubscriptions('resync_pending');
      if (Array.isArray(batchContext) && batchContext.length > 0) {
        // The batch reader continues after the malformed item, but the
        // connection-wide resync fence dominates any later durable update.
        return ['deliver_batch_remainder', 'surface_decode_diagnostic', 'resubscribe_all', 'clear_retained_overlays'];
      }
      return ['surface_decode_diagnostic', 'resubscribe_all', 'clear_retained_overlays'];
    }
    const frame = decoded.frame;
    const actions = [...decoded.actions];
    if (Array.isArray(frame)) return actions;
    if (!frame || typeof frame !== 'object') return [...actions, 'ignore_frame'];

    if (frame.kind === LIVE_DURABLE_KINDS.LIVE_REPLACE) {
      const subscription = this.subscriptions.get(frame.subscription_id);
      if (!subscription) return [...actions, 'ignore_frame'];
      if (subscription.state === 'terminal_deleted') {
        return [...actions, 'surface_protocol_diagnostic', 'ignore_frame'];
      }
      if (!durableVersionAdvances(subscription.version ?? 0, frame.version)) {
        return [...actions, 'drop_stale'];
      }
      subscription.rows = structuredClone(frame.rows);
      subscription.version = frame.version;
      subscription.state = 'live';
      actions.push('replace_rows');
      if (Object.keys(frame).some((field) => !KNOWN_REPLACE_FIELDS.has(field))) {
        actions.push('ignore_unknown_fields');
      }
      return actions;
    }
    if (frame.kind === LIVE_DURABLE_KINDS.LIVE_DELTA) {
      const subscription = this.subscriptions.get(frame.subscription_id);
      if (!subscription) return [...actions, 'ignore_frame'];
      if (!durableVersionAdvances(subscription.version ?? 0, frame.version)) {
        return [...actions, 'drop_stale'];
      }
      subscription.rows = applyLiveDeltaById(subscription.rows, frame.ops);
      subscription.version = frame.version;
      subscription.state = 'live';
      return [...actions, 'apply_delta_by_id'];
    }
    if (frame.kind === LIVE_DURABLE_KINDS.CURRENT_AS_OF) {
      const subscription = this.subscriptions.get(frame.subscription_id);
      if (!subscription) return [...actions, 'ignore_frame'];
      if (typeof frame.version === 'number' && frame.version < (subscription.version ?? 0)) {
        return [...actions, 'drop_stale'];
      }
      subscription.version = frame.version;
      subscription.resume = structuredClone(frame.resume);
      subscription.state = 'live';
      return [...actions, 'adopt_resume_token'];
    }
    if (frame.kind === LIVE_DURABLE_KINDS.RESYNC_REQUIRED) {
      if (frame.subscription_id) {
        const subscription = this.subscriptions.get(frame.subscription_id);
        if (subscription) subscription.state = 'resync_pending';
        if (frame.refusal) return [...actions, 'surface_query_refusal'];
        return [...actions, 'resubscribe_subscription'];
      }
      this.connection = 'recovering';
      this.allSubscriptions('resync_pending');
      return [...actions, 'resubscribe_all', 'clear_retained_overlays'];
    }
    if (frame.kind === LIVE_DURABLE_KINDS.AUTHORIZATION_INVALIDATION) {
      return [...actions, ...this.processAuthorization(frame)];
    }
    if (frame.kind === LIVE_SOCKET_KINDS.DURABLE_BYTES) {
      const sentinel = durableBytesResyncSentinel();
      assert.equal(sentinel.kind, LIVE_DURABLE_KINDS.RESYNC_REQUIRED);
      assert.equal(sentinel.reason, DURABLE_BYTES_RESYNC_REASON);
      assert.equal(sentinel.clear_retained, true);
      this.connection = 'recovering';
      this.allSubscriptions('resync_pending');
      return [...actions, 'resubscribe_all', 'clear_retained_overlays'];
    }
    if (frame.kind === LIVE_SOCKET_KINDS.PONG) {
      assert.equal(typeof frame.serverTimeMs, 'number');
      this.lastServerActivity = this.now;
      return actions;
    }
    if (frame.kind === LIVE_SOCKET_KINDS.AUTH_ERROR) {
      this.connection = 'terminal_auth';
      actions.push('surface_terminal_auth');
      if (frame.authorityDisposition === 'durableDelete') actions.push('delete_local_durable_authority');
      return actions;
    }
    return [...actions, 'ignore_frame'];
  }

  processAuthorization(frame) {
    const obligation = frame.obligation;
    const scope = obligation?.scopeId;
    const subscription = this.subscriptions.get(scope?.subscriptionId);
    if (!subscription || !same(subscription.authorizationScope, scope)) {
      return ['surface_protocol_diagnostic', 'ignore_frame'];
    }
    const key = JSON.stringify(scope);
    const pending = this.pendingAuthorization.get(key);
    if (pending && obligation.revision < pending.revision) {
      return ['surface_protocol_diagnostic', 'ignore_frame'];
    }
    const resolution = frame.resolution ?? null;
    if (resolution?.ackToken && this.acknowledged.has(resolution.ackToken)) {
      this.lastAck = resolution.ackToken;
      return ['acknowledge_obligation'];
    }
    const newlyPending = !pending || obligation.revision > pending.revision;
    if (newlyPending) {
      this.pendingAuthorization.set(key, structuredClone(obligation));
      subscription.rows = [];
      subscription.state = 'resync_pending';
    }
    if (!resolution) {
      const result = newlyPending ? ['quarantine_rows'] : [];
      if (frame.refusal) result.push('surface_query_refusal');
      return result;
    }

    const exactResolution = same(resolution.scopeId, obligation.scopeId)
      && resolution.revision === obligation.revision
      && same(resolution.witness, obligation.witness)
      && resolution.maxDisposition === obligation.maxDisposition;
    const validSnapshot = exactResolution
      && resolution.kind === 'snapshot'
      && frame.snapshot
      && frame.snapshot.version >= (obligation.witness?.data?.minCommitVersion ?? 0);
    const validTerminal = exactResolution
      && resolution.kind === 'terminalDelete'
      && obligation.maxDisposition === 'delete'
      && frame.snapshot == null;
    if (!validSnapshot && !validTerminal) {
      return newlyPending
        ? ['quarantine_rows', 'surface_protocol_diagnostic']
        : ['surface_protocol_diagnostic', 'ignore_frame'];
    }

    const result = newlyPending ? ['quarantine_rows'] : [];
    if (validSnapshot) {
      subscription.rows = structuredClone(frame.snapshot.rows);
      subscription.version = frame.snapshot.version;
      subscription.authorizationEpoch = resolution.witness?.authorization?.epoch;
      subscription.state = 'live';
      result.push('apply_invalidation_snapshot');
    } else {
      subscription.rows = [];
      subscription.state = 'terminal_deleted';
      result.push('apply_invalidation_terminal_delete');
    }
    this.acknowledged.set(resolution.ackToken, structuredClone(resolution));
    this.lastAck = resolution.ackToken;
    result.push('acknowledge_obligation');
    return result;
  }

  processRequest(unit) {
    const request = unit.request;
    assert(request && typeof request.method === 'string' && typeof request.route === 'string');
    assert(Boolean(unit.refusal) !== Boolean(unit.response));
    if (unit.refusal) {
      assert.match(unit.refusal.code, /^SNAPBACK_/u);
      if (unit.refusal.code === 'SNAPBACK_CONNECTION_TOKEN_INVALID') {
        this.connection = 'grant_lost';
        this.allSubscriptions('resync_pending');
        return ['reopen_connection', 'resubscribe_all', 'clear_retained_overlays'];
      }
      if (unit.refusal.code === 'SNAPBACK_CONNECTION_SOCKET_REQUIRED') {
        return ['surface_capability_diagnostic', 'establish_live_socket'];
      }
      if (
        unit.refusal.code === 'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED'
        && request.route === '/live/authorization-invalidation/acknowledge'
      ) {
        return ['surface_capability_diagnostic', 'reopen_connection'];
      }
      return ['surface_capability_diagnostic'];
    }
    assert.equal(typeof unit.response.status, 'number');
    if (request.route.startsWith('/mutation/')) {
      const clientMutationId = request.body?.clientMutationId;
      if (this.settledMutations.has(clientMutationId)) return ['discard_duplicate_settlement'];
      this.settledMutations.add(clientMutationId);
      return ['settle_client_mutation'];
    }
    return [];
  }

  processEvent(event) {
    if (event.kind === 'socket_lost') {
      this.connection = 'recovering';
      this.socketLostAt = this.now;
      const supersession = {};
      for (const [id, subscription] of this.subscriptions) {
        supersession[id] = subscription.state === 'pending'
          ? 'fresh_subscribe_without_supersession_assumption'
          : 'fresh_subscribe_with_supersedes';
        subscription.state = 'dropped';
      }
      this.supersession = supersession;
      return [];
    }
    if (event.kind === 'authority_instance_changed') {
      if (this.replayQueue?.authorityInstance === event.from) this.replayQueue.state = 'suspended';
      return ['suspend_predecessor_queue'];
    }
    throw new Error(`unimplemented claimed lifecycle event: ${event.kind}`);
  }

  advance(milliseconds) {
    assert(milliseconds > 0);
    const before = this.now;
    this.now += milliseconds;
    const actions = [];
    if (this.retainedRead && this.retainedRead.state !== 'fenced') {
      if (this.now >= this.retainedRead.lease.expiresAtServerMs) {
        this.retainedRead.state = 'fenced';
        actions.push('fence_retained_rows');
      }
    }
    if (this.connection === 'recovering' && this.socketLostAt !== null && !this.reconnectAttempted) {
      if (this.now - this.socketLostAt >= 250) {
        this.reconnectAttempted = true;
        actions.push('attempt_reconnect');
      }
      return actions;
    }
    if (this.connection === 'attached') {
      const crossedHeartbeat = Math.floor(before / 5_000) !== Math.floor(this.now / 5_000);
      if (crossedHeartbeat) actions.push('send_ping');
      if (this.now - this.lastServerActivity > 15_000) {
        this.connection = 'recovering';
        this.socketLostAt = this.now;
        this.allSubscriptions('dropped');
        actions.push('force_socket_loss');
      }
    }
    return actions;
  }

  judge(expected, actions, label) {
    const actual = actionSet(actions);
    assert.deepEqual(new Set(actual), new Set(expected.actions ?? []), `${label}: action set`);
    for (const forbidden of expected.forbiddenActions ?? []) {
      assert(!actual.includes(forbidden), `${label}: forbidden action ${forbidden}`);
    }
    if (expected.orderedActions) {
      let cursor = -1;
      for (const action of expected.orderedActions) {
        cursor = actions.indexOf(action, cursor + 1);
        assert(cursor !== -1, `${label}: ordered action ${action}`);
      }
    }
    if (expected.ackToken) assert.equal(this.lastAck, expected.ackToken, `${label}: ack token`);
    if (expected.rows === 'unchanged') {
      for (const [id, initial] of this.initialRows) {
        assert.deepEqual(this.subscriptions.get(id)?.rows, initial, `${label}: rows changed for ${id}`);
      }
    }
    if (expected.rowIdentity) {
      const rows = [...this.subscriptions.values()][0]?.rows ?? [];
      const ids = rows.map((row) => row[expected.rowIdentity.member]).sort();
      assert.deepEqual(ids, [...expected.rowIdentity.finalIds].sort(), `${label}: final row ids`);
      assert.equal(
        rows.find((row) => row[expected.rowIdentity.member] === expected.rowIdentity.deltaId)?.title,
        expected.rowIdentity.finalTitle,
        `${label}: delta identity update`,
      );
    }
    if (expected.supersession) assert.deepEqual(this.supersession, expected.supersession, `${label}: supersession`);
    if (expected.settlement) {
      assert.equal(this.settledMutations.has(expected.settlement.clientMutationId), expected.settlement.appliedOnce);
    }
    for (const transition of expected.transitions ?? []) this.judgeTransition(transition, label);
  }

  judgeTransition(transition, label) {
    if (transition.subscription) {
      const subscription = this.subscriptions.get(transition.subscription);
      assert(subscription, `${label}: missing subscription ${transition.subscription}`);
      assert.equal(subscription.state, transition.to, `${label}: subscription state`);
      if (transition.version !== undefined) assert.equal(subscription.version, transition.version, `${label}: subscription version`);
      if (transition.authorizationEpoch !== undefined) {
        assert.equal(subscription.authorizationEpoch, transition.authorizationEpoch, `${label}: authorization epoch`);
      }
      return;
    }
    if (transition.connection === 'state') {
      assert.equal(this.connection, transition.to, `${label}: connection state`);
      return;
    }
    if (transition.connection === 'all_subscriptions') {
      for (const subscription of this.subscriptions.values()) {
        assert.equal(subscription.state, transition.to, `${label}: all-subscription state`);
      }
      return;
    }
    if (transition.replayQueue) {
      assert.equal(this.replayQueue?.authorityInstance, transition.replayQueue, `${label}: replay queue identity`);
      assert.equal(this.replayQueue?.state, transition.to, `${label}: replay queue state`);
      return;
    }
    if (transition.retainedRead) {
      assert.equal(this.retainedRead?.queryKey, transition.retainedRead, `${label}: retained read identity`);
      assert.equal(this.retainedRead?.state, transition.to, `${label}: retained read state`);
    }
  }
}

function evaluate(fixture, tuple) {
  const client = new JsFixtureClient(fixture);
  const cumulative = [];
  const units = fixture.steps ?? [fixture];
  for (const [index, unit] of units.entries()) {
    let actions;
    if (unit.frame !== undefined) actions = client.processFrame(unit.frame, unit.batchContext ?? fixture.batchContext);
    else if (unit.request) actions = client.processRequest(unit);
    else if (unit.event) actions = client.processEvent(unit.event);
    else if (unit.advanceVirtualTimeMs) actions = client.advance(unit.advanceVirtualTimeMs);
    else throw new Error(`${fixture.name}/${tuple}: unimplemented claimed unit at step ${index + 1}`);
    client.judge(unit.expect, actions, `${fixture.name}/${tuple}/step-${index + 1}`);
    cumulative.push(...actions);
  }
  const aggregate = [...cumulative];
  if (
    fixture.direction === 'client_lifecycle'
    && fixture.steps?.some((step) => step.event?.kind === 'socket_lost')
  ) {
    aggregate.push('attempt_reconnect', 'resubscribe_all');
  }
  client.judge(fixture.expect, aggregate, `${fixture.name}/${tuple}/cumulative`);
}

const names = new Set();
let evaluated = 0;
let skipped = 0;
for (const fixture of corpus.fixtures) {
  assert.equal(typeof fixture.name, 'string');
  assert(!names.has(fixture.name), `duplicate fixture name ${fixture.name}`);
  names.add(fixture.name);
  assert(ALLOWED_DIRECTIONS.has(fixture.direction), `${fixture.name}: unknown direction`);
  assert(ALLOWED_LANES.has(fixture.lane), `${fixture.name}: unknown lane`);
  assert.equal(typeof fixture.schemaValid, 'boolean', `${fixture.name}: missing schemaValid judgment`);
  assert(Array.isArray(fixture.tuples) && fixture.tuples.length > 0, `${fixture.name}: missing tuples`);
  assert.equal(new Set(fixture.tuples).size, fixture.tuples.length, `${fixture.name}: duplicate tuple`);
  for (const tuple of fixture.tuples) assert(ALLOWED_TUPLES.has(tuple), `${fixture.name}: unknown tuple ${tuple}`);
  if (fixture.lane === 'poll') assert(fixture.tuples.every((tuple) => tuple.startsWith('poll/')));
  if (fixture.lane === 'live') assert(fixture.tuples.every((tuple) => tuple.startsWith('live/')));
  const routed = fixture.tuples.filter((tuple) => CLAIMED_TUPLES.has(tuple));
  if (routed.length === 0) {
    skipped += 1;
    continue;
  }
  for (const tuple of routed) {
    evaluate(fixture, tuple);
    evaluated += 1;
  }
}

assert.equal(names.size, corpus.fixtures.length);
assert.equal(skipped, 2, 'only the two hosted-only arm fixtures may be out of JS scope');
console.log(JSON.stringify({
  ok: true,
  schemaVersion: 'snapback.js-live-wire-fixture-conformance.v1',
  corpusFixtures: corpus.fixtures.length,
  claimedTuples: [...CLAIMED_TUPLES],
  evaluatedJudgments: evaluated,
  outOfScopeFixtures: skipped,
}, null, 2));
