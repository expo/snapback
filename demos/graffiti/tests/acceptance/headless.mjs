// Graffiti wall — headless acceptance suite (the required surface).
//
// Proves the durable + ephemeral carrier the Contract wall renders: shared-board
// live sync, append-only last-writer-wins marks, and the boardCursors ephemeral
// presence lane (auth, coalescing, WebSocket publish, TTL expiry, disconnect
// cleanup, rate limiting, oversize rejection, durable-lane isolation).
//
// @ref LLP 0015#acceptance-rules — a demo is complete only when its required
//   checks pass on its required surface, with explicit structured results.
// @ref LLP 0013#delivery-lanes — ephemeral presence must not touch the durable
//   version, must coalesce to latest, and must be connection-owned.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { assert, assertEqual, assertThrows, createSuite } from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));

const schemaManifest = gen('schema.manifest.json');
const functionManifest = gen('functions.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));

const ADA = 'painter_ada';
const GRACE = 'painter_grace';
const BOARD = 'wall';
const scope = { boardId: BOARD };
// DEMO/TEST ONLY: the client mints its own `boardMember` room permission to
// exercise the server-side check. This is the demo's declared `external_auth`
// capability gap — a real app must have a trusted server-side auth provider mint
// this, never the client. See surfaces/contract/main.ts for the full note; the
// "requires the board room permission" check below proves the server DOES
// enforce it (an unpermissioned request is rejected SNAPBACK_EPHEMERAL_UNAUTHORIZED).
const perms = [SnapbackClient.roomPermission('boardMember', scope)];
const cursorRef = api.ephemeral.boardCursors;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = await startServer({ port: 4433, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl);
const suite = createSuite('graffiti / headless');

try {
  await suite.check('health reports local ibex+sqlite target', async () => {
    const health = await db.health();
    assert(health.ok, 'server not ok');
    return health;
  });

  await suite.check('schema load registers cells table + boardCursors ephemeral collection', async () => {
    const res = await db.loadSchema(schemaManifest);
    assertEqual(res.diagnostics.filter((d) => d.severity === 'Error' || d.severity === 'Fatal'), [], 'schema errors');
    const state = await db.inspect();
    const collections = (state.schema?.ephemeralCollections ?? []).map((c) => c.name);
    assert(collections.includes('boardCursors'), `boardCursors not registered: ${collections}`);
    return { ephemeralCollections: collections };
  });

  await suite.check('generated functions load + are inspectable', async () => {
    await db.loadFunctions(functionManifest);
    const state = await db.inspect();
    const names = state.functions.functions.map((f) => f.name).sort();
    assertEqual(names, ['listCells', 'paintCell'], 'function set');
    const listCells = state.functions.functions.find((f) => f.name === 'listCells');
    assertEqual(listCells.syncabilityClass, 'syncable-live', 'listCells is syncable-live');
    assert(state.capabilityManifest.ephemeralWebSocketPublish, 'websocket ephemeral publish capability');
    assertEqual(api.listCells.kind, 'LiveQuery', 'generated listCells reference kind');
    assertEqual(cursorRef.keyMode, 'Connection', 'generated boardCursors reference key mode');
    return { functions: names };
  });

  await suite.check('deterministic reset + declarative seed paints the starter wall', async () => {
    await db.reset();
    await db.seed(seed);
    const rows = (await db.query(api.listCells, { args: { boardId: BOARD }, userId: ADA })).rows;
    assertEqual(rows.length, seed.tables.cells.length, 'seed cell count');
    assert(rows.every((r) => r.boardId === BOARD), 'all cells on the wall board');
    assert(rows.some((r) => r.color === '#e5484d'), 'seed contains the red heart');
    return { cells: rows.length };
  });

  await suite.check('paint is server-authoritative with owned system fields', async () => {
    const created = await db.mutate(api.paintCell, { args: { boardId: BOARD, x: 0, y: 0, color: '#3e63dd' }, userId: ADA });
    assert(typeof created.result === 'string' && created.result.length > 0, 'no id returned');
    assertEqual(created.changed_count, 1, 'changed_count');
    const row = (await db.query(api.listCells, { args: { boardId: BOARD }, userId: ADA })).rows.find((r) => r.x === 0 && r.y === 0);
    for (const f of ['_id', '_version', '_createdAt', '_updatedAt']) assert(row[f] !== undefined, `missing system field ${f}`);
    assertEqual(row.color, '#3e63dd', 'painted color');
    assertEqual(row.authorId, ADA, 'authorId from auth');
    return { id: created.result };
  });

  await suite.check('paint by one painter live-syncs to a peer connection', async () => {
    await db.subscribeLive(api.listCells, { connectionId: 'peerAda', args: { boardId: BOARD }, userId: ADA });
    const graceSub = await db.subscribeLive(api.listCells, { connectionId: 'peerGrace', args: { boardId: BOARD }, userId: GRACE });
    const before = graceSub.snapshot.rows.length;
    await db.mutate(api.paintCell, { args: { boardId: BOARD, x: 22, y: 13, color: '#30a46c' }, userId: ADA });
    const updates = await db.drainUpdates('peerGrace');
    const last = updates.at(-1);
    assert(last, 'peer received no durable update');
    assert(last.rows.length === before + 1, 'peer row count did not grow');
    assert(last.rows.some((r) => r.x === 22 && r.y === 13 && r.color === '#30a46c'), 'peer missing the new pixel');
    return { delivered: updates.length, rows: last.rows.length };
  });

  await suite.check('append-only marks resolve last-writer-wins per coordinate', async () => {
    await db.mutate(api.paintCell, { args: { boardId: BOARD, x: 1, y: 1, color: '#f5d90a' }, userId: ADA });
    await db.mutate(api.paintCell, { args: { boardId: BOARD, x: 1, y: 1, color: '#8e4ec6' }, userId: GRACE });
    const marks = (await db.query(api.listCells, { args: { boardId: BOARD }, userId: ADA })).rows
      .filter((r) => r.x === 1 && r.y === 1)
      .sort((a, b) => a._createdAt - b._createdAt);
    assert(marks.length === 2, `expected two stacked marks, got ${marks.length}`);
    assertEqual(marks.at(-1).color, '#8e4ec6', 'newest mark wins');
    return { stacked: marks.length, winner: marks.at(-1).color };
  });

  await suite.check('ephemeral presence requires the board room permission', async () => {
    await assertThrows(
      () => db.subscribeEphemeral(cursorRef, { connectionId: 'intruder', scope, userId: GRACE }),
      'SNAPBACK_EPHEMERAL_UNAUTHORIZED',
      'non-member subscribe should fail',
    );
    await assertThrows(
      () => db.publishEphemeral(cursorRef, { connectionId: 'intruder', scope, userId: GRACE, value: { x: 1, y: 1, color: '#000', name: 'x' } }),
      'SNAPBACK_EPHEMERAL_UNAUTHORIZED',
      'non-member publish should fail',
    );
    return { permission: perms[0] };
  });

  await suite.check('cursor presence publishes, fans out to a peer, and coalesces to latest', async () => {
    const observer = await db.subscribeEphemeral(cursorRef, { connectionId: 'cursorObserver', scope, userId: GRACE, permissions: perms });
    assertEqual(observer.currentEntries(), [], 'initial presence is empty');
    for (let i = 0; i < 8; i += 1) {
      await db.publishEphemeral(cursorRef, { connectionId: 'cursorAda', scope, userId: ADA, permissions: perms, value: { x: i, y: i + 1, color: '#e5484d', name: 'Ada' } });
    }
    await observer.drain();
    const entries = observer.currentEntries();
    assertEqual(entries.map((e) => e.value), [{ x: 7, y: 8, color: '#e5484d', name: 'Ada' }], 'coalesced to latest cursor');
    return { coalesced: (await db.inspect()).ephemeral.coalescedUpdates };
  });

  await suite.check('cursor presence never advances the durable wall version', async () => {
    const before = (await db.inspect()).storage.version;
    for (let i = 0; i < 6; i += 1) {
      await db.publishEphemeral(cursorRef, { connectionId: 'cursorVersion', scope, userId: ADA, permissions: perms, value: { x: i, y: 0, color: '#12a594', name: 'Ada' } });
    }
    assertEqual((await db.inspect()).storage.version, before, 'ephemeral publishes must not advance durable version');
    return { version: before };
  });

  await suite.check('cursor subscribe + publish ride the live WebSocket, not a private route', async () => {
    // The product transport (LLP 0013 transport contract): the same
    // authenticated live socket that carries durable deltas accepts
    // ephemeral_subscribe/ephemeral_publish requests and acks them in-band.
    const stream = db.openLiveStream('wsCursor');
    try {
      await stream.ready;
      stream.sendJson({
        type: 'ephemeral_subscribe',
        requestId: 'ws-sub',
        request: { collection: cursorRef.name, scope, connection_id: 'wsCursor', auth: SnapbackClient.auth(ADA, { permissions: perms }) },
      });
      const subAck = await stream.nextUpdate();
      assertEqual(subAck.kind, 'ephemeral_ack', 'subscribe ack kind');
      assert(subAck.message?.Snapshot, 'subscribe ack lacks a room snapshot');
      const before = (await db.inspect()).storage.version;
      stream.sendJson({
        type: 'ephemeral_publish',
        requestId: 'ws-pub',
        request: {
          collection: cursorRef.name,
          scope,
          connection_id: 'wsCursor',
          session_id: null,
          user_id: null,
          custom_key: null,
          value: [...new TextEncoder().encode(JSON.stringify({ x: 3, y: 9, color: '#5e6ad2', name: 'Ada' }))],
          ttl_ms: null,
          auth: SnapbackClient.auth(ADA, { permissions: perms }),
        },
      });
      const pubAck = await stream.nextUpdate();
      assertEqual(pubAck.kind, 'ephemeral_ack', 'publish ack kind');
      assertEqual((await db.inspect()).storage.version, before, 'WebSocket cursor publish advanced the durable version');
      return { subscribeAck: subAck.operation, publishAck: pubAck.operation };
    } finally {
      stream.close();
      await db.disconnect('wsCursor');
    }
  });

  await suite.check('disconnect removes the connection-owned cursor', async () => {
    const observer = await db.subscribeEphemeral(cursorRef, { connectionId: 'watcher', scope, userId: GRACE, permissions: perms });
    await db.publishEphemeral(cursorRef, { connectionId: 'leaver', scope, userId: ADA, permissions: perms, value: { x: 4, y: 4, color: '#f76b15', name: 'Ada' } });
    await observer.drain();
    assert(observer.currentEntries().some((e) => e.key === 'leaver'), 'cursor missing before disconnect');
    await db.disconnect('leaver');
    await observer.drain();
    assert(!observer.currentEntries().some((e) => e.key === 'leaver'), 'disconnect should remove the cursor');
    return { ok: true };
  });

  await suite.check('TTL expiry prunes an idle cursor without durable tombstones', async () => {
    const observer = await db.subscribeEphemeral(cursorRef, { connectionId: 'ttlWatcher', scope, userId: GRACE, permissions: perms });
    const durableBefore = (await db.inspect()).storage.version;
    const wallBefore = (await db.query(api.listCells, { args: { boardId: BOARD }, userId: GRACE })).rows.length;
    await db.publishEphemeral(cursorRef, { connectionId: 'idler', scope, userId: ADA, permissions: perms, value: { x: 2, y: 2, color: '#99d52a', name: 'Ada' }, ttlMs: 300 });
    await observer.drain();
    assert(observer.currentEntries().some((e) => e.key === 'idler'), 'cursor missing before TTL expiry');
    // The client overlay prunes by server-provided expiry even if the remove
    // delta is lost (LLP 0013: the TTL is the universal backstop).
    await sleep(400);
    assert(!observer.currentEntries({ prune: true }).some((e) => e.key === 'idler'), 'client TTL backstop should prune the idle cursor');
    // A fresh subscription snapshot excludes the expired entry SERVER-SIDE:
    // prune:false so the assertion observes what the server actually sent,
    // not the client backstop re-hiding a server bug.
    const fresh = await db.subscribeEphemeral(cursorRef, { connectionId: 'ttlRejoin', scope, userId: GRACE, permissions: perms });
    assert(!fresh.currentEntries({ prune: false }).some((e) => e.key === 'idler'), 'fresh snapshot must exclude the expired cursor server-side');
    // That subscribe swept the room (src/ephemeral.rs sweep_room_locked),
    // fanning a Remove delta out to existing subscribers — observe it landing
    // in the first observer's overlay, again without the client backstop.
    await observer.drain();
    assert(!observer.currentEntries({ prune: false }).some((e) => e.key === 'idler'), 'server expiry Remove fan-out must clear the cursor from live subscribers');
    assertEqual((await db.inspect()).storage.version, durableBefore, 'TTL expiry must not touch the durable version');
    const wallAfter = (await db.query(api.listCells, { args: { boardId: BOARD }, userId: GRACE })).rows.length;
    assertEqual(wallAfter, wallBefore, 'TTL expiry must not write durable tombstones');
    return { prunedByTtl: true };
  });

  await suite.check('over-rate cursor publishes are rejected with a structured error', async () => {
    // publishRate.burst is 12 for boardCursors; a 20-publish burst on one
    // fresh connection must trip the limiter without corrupting the room.
    let accepted = 0;
    let rateLimited = 0;
    for (let i = 0; i < 20; i += 1) {
      try {
        await db.publishEphemeral(cursorRef, { connectionId: 'speeder', scope, userId: ADA, permissions: perms, value: { x: i, y: 0, color: '#e93d82', name: 'Ada' } });
        accepted += 1;
      } catch (error) {
        assertEqual(error.diagnostic?.code, 'SNAPBACK_EPHEMERAL_RATE_LIMITED', `unexpected publish failure: ${error.message}`);
        rateLimited += 1;
      }
    }
    assert(rateLimited >= 1, 'burst should trip the rate limiter');
    assert(accepted >= 12, `burst budget should accept at least the declared burst, accepted ${accepted}`);
    const stats = (await db.inspect()).ephemeral;
    assert(stats.rateLimitedPublishes >= rateLimited, 'rate-limited publishes must be observable in diagnostics');
    return { accepted, rateLimited, observable: stats.rateLimitedPublishes };
  });

  await suite.check('oversize cursor payload is rejected', async () => {
    await assertThrows(
      () => db.publishEphemeral(cursorRef, { connectionId: 'fat', scope, userId: ADA, permissions: perms, value: { x: 1, y: 1, color: '#000', name: 'x'.repeat(1100) } }),
      'SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE',
      'oversize cursor should fail',
    );
  });

  await suite.check('durable lane stays first under a cursor flood on one connection', async () => {
    const overlay = await db.subscribeEphemeral(cursorRef, { connectionId: 'mixed', scope, userId: ADA, permissions: perms });
    await db.subscribeLive(api.listCells, { connectionId: 'mixed', args: { boardId: BOARD }, userId: ADA });
    for (let i = 0; i < 8; i += 1) {
      await db.publishEphemeral(cursorRef, { connectionId: 'flooder', scope, userId: ADA, permissions: perms, value: { x: 100 + i, y: 1, color: '#e93d82', name: 'Ada' } });
    }
    await db.mutate(api.paintCell, { args: { boardId: BOARD, x: 7, y: 7, color: '#ad7f58' }, userId: ADA });
    const envelopes = await db.drainEnvelopes('mixed');
    assert(envelopes[0]?.Durable, `first mixed-lane message was not durable: ${JSON.stringify(envelopes[0])}`);
    const durable = JSON.parse(Buffer.from(envelopes[0].Durable.payload).toString('utf8'));
    assert(durable.rows.some((r) => r.x === 7 && r.y === 7 && r.color === '#ad7f58'), 'durable update missing under cursor load');
    for (const env of envelopes.slice(1)) overlay.apply(env);
    assert(overlay.currentEntries().some((e) => e.value.x === 107), 'latest flood cursor missing');
    return { mixedEnvelopes: envelopes.length };
  });

  await suite.check('inspect distinguishes ephemeral fan-out pressure from durable delivery', async () => {
    const state = await db.inspect();
    assert(state.ephemeral.coalescedUpdates >= 1, 'expected coalesced updates');
    assert(state.ephemeral.rateLimitedPublishes >= 1, 'expected rate-limited publish counters');
    assert(typeof state.ephemeral.roomCount === 'number', 'missing ephemeral room count');
    // The suite has provably delivered durable updates by now (the live-sync
    // and flood checks), so the durable-lane counter must be positive, not
    // merely present.
    assert(state.liveDelivery.totalDeliveries >= 1, `expected durable deliveries, got ${state.liveDelivery.totalDeliveries}`);
    return {
      coalesced: state.ephemeral.coalescedUpdates,
      rateLimited: state.ephemeral.rateLimitedPublishes,
      rooms: state.ephemeral.roomCount,
      durableDeliveries: state.liveDelivery.totalDeliveries,
    };
  });

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('graffiti headless acceptance crashed:', error);
  await server.stop();
  process.exit(2);
}
