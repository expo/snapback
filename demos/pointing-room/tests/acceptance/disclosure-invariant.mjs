// Pointing Room — two-principal disclosure invariant proof.
//
// Principal A votes "13" in Planning. Principal B then subscribes to that
// room's liveTally. This suite captures B's raw HTTP subscription snapshot and
// raw WebSocket frames: the exact bytes contain value:null and no value:"13"
// before reveal. A vote cast in Platform never enters Planning's bytes, then a
// Planning reveal delivers value:"13".

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asUser } from '../../../_kit/as-user.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { importGeneratedModule, readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const backendDir = resolve(here, '..', '..', 'snapback');
const generatedRoot = join(backendDir, 'generated');
const serverBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
const schema = readGeneratedJson(generatedRoot, 'schema.manifest.json');
const functions = readGeneratedJson(generatedRoot, 'functions.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');
const PLANNING_ROOM_ID = 'room_planning';
const PLATFORM_ROOM_ID = 'room_platform';
const DECLARED_BOUNDARY_ASSERTION =
  'liveTally fieldBoundary: owner sees value before reveal; non-owner sees null; both see value after reveal';
const liveTallyDefinition = functions.functions.find(({ name }) => name === 'liveTally');
assert.ok(liveTallyDefinition, 'generated manifest contains liveTally');
assert.deepEqual(liveTallyDefinition.fieldBoundary, {
  fields: ['value'],
  condition: 'the round is revealed or the caller owns the vote',
}, `${DECLARED_BOUNDARY_ASSERTION} — manifest declaration`);
const liveTallyResultFields = new Set(
  liveTallyDefinition.resultContract.record.fields.map(({ name }) => name),
);
for (const field of liveTallyDefinition.fieldBoundary.fields) {
  assert(liveTallyResultFields.has(field), `${DECLARED_BOUNDARY_ASSERTION} — ${field} is a result field`);
}

const scratch = mkdtempSync(join(tmpdir(), 'pointing-room-'));
const carrier = join(scratch, 'startup-artifacts.json');
writeFileSync(
  carrier,
  `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
  { mode: 0o600 },
);

const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  serverBinary,
  startupArtifacts: carrier,
  captureImpersonationCapability: true,
});

const clients = [];
const handles = [];
const realFetch = globalThis.fetch;
const RealWebSocket = globalThis.WebSocket;

async function mintSession(email, clientStoreId) {
  const session = await asUser(server, schema.appId, email, {
    clientStoreId,
    fetchImpl: realFetch,
  });
  clients.push(session.client);
  return session;
}

function capture(session) {
  return session.coordinator.capture();
}

function mutate(session, reference, args) {
  return session.client.mutate(reference, {
    args,
    authorityCapture: capture(session),
  });
}

async function eventually(check, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return check();
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

try {
  const admin = new SnapbackClient(server.baseUrl, {
    authClientProtocol: 1,
    custody: 'anonymous-public',
    adminToken: server.adminToken,
  });
  clients.push(admin);
  await admin.reset(seed);

  const a = await mintSession('ada@pointing-room.local', 'pointing-room-a');
  const b = await mintSession('grace@pointing-room.local', 'pointing-room-b');
  assert.notEqual(a.credential.session.userId, b.credential.session.userId);

  const started = await mutate(a, api.startRound, {
    roomId: PLANNING_ROOM_ID,
    topic: 'Estimate the disclosure boundary',
  });
  const roundId = started.result;
  assert.equal(typeof roundId, 'string');
  await mutate(a, api.castVote, { roundId, value: '13' });
  const platformStarted = await mutate(a, api.startRound, {
    roomId: PLATFORM_ROOM_ID,
    topic: 'Keep platform work isolated',
  });
  const platformRoundId = platformStarted.result;
  assert.equal(typeof platformRoundId, 'string');

  const ownBeforeReveal = await a.client.query(api.liveTally, {
    args: { roomId: PLANNING_ROOM_ID },
    authorityCapture: capture(a),
  });
  assert.equal(ownBeforeReveal.rows.length, 1);
  assert.equal(ownBeforeReveal.rows[0].userId, a.credential.session.userId);
  for (const field of liveTallyDefinition.fieldBoundary.fields) {
    assert.equal(
      ownBeforeReveal.rows[0][field],
      '13',
      `${DECLARED_BOUNDARY_ASSERTION} — owner ${field} before reveal`,
    );
  }

  const subscribeBodies = [];
  const websocketFrames = [];
  globalThis.fetch = async (input, init) => {
    const response = await realFetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/live/liveTally/subscribe')) {
      subscribeBodies.push(await response.clone().text());
    }
    return response;
  };
  globalThis.WebSocket = class CapturedWebSocket extends RealWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      this.addEventListener('message', (event) => {
        websocketFrames.push(typeof event.data === 'string' ? event.data : String(event.data));
      });
    }
  };

  let bRows = [];
  const bLive = await b.client.liveQuery(api.liveTally, {
    connectionId: 'pointing-room-b-wire',
    args: { roomId: PLANNING_ROOM_ID },
    authorityCapture: capture(b),
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate(rows) {
      bRows = rows;
    },
    onConnectionChange() {},
  });
  handles.push(bLive);
  bRows = bLive.rows;

  assert.equal(subscribeBodies.length, 1, 'captured B liveTally subscription response bytes');
  const hiddenBytes = subscribeBodies[0];
  assert(hiddenBytes.includes(`"roomId":"${PLANNING_ROOM_ID}"`), `B wire snapshot lacks the Planning scope: ${hiddenBytes}`);
  assert.equal(
    hiddenBytes.includes(PLATFORM_ROOM_ID),
    false,
    `Platform row leaked in B's Planning snapshot: ${hiddenBytes}`,
  );
  assert(hiddenBytes.includes('"value":null'), `B wire snapshot lacks explicit null: ${hiddenBytes}`);
  assert.equal(
    hiddenBytes.includes('"value":"13"'),
    false,
    `A's vote leaked in B's pre-reveal wire bytes: ${hiddenBytes}`,
  );
  assert.equal(bRows.length, 1);
  assert.equal(bRows[0].roomId, PLANNING_ROOM_ID);
  assert.equal(bRows[0].roundId, roundId);
  assert.equal(bRows[0].userId, a.credential.session.userId);
  assert.equal(bRows[0].hasVoted, true);
  for (const field of liveTallyDefinition.fieldBoundary.fields) {
    assert.equal(
      bRows[0][field],
      null,
      `${DECLARED_BOUNDARY_ASSERTION} — non-owner ${field} before reveal`,
    );
  }

  await mutate(a, api.castVote, { roundId: platformRoundId, value: '8' });
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  const planningWireAfterPlatformVote = [hiddenBytes, ...websocketFrames].join('\n');
  assert.equal(
    planningWireAfterPlatformVote.includes(PLATFORM_ROOM_ID),
    false,
    `Platform room id leaked into Planning frames: ${planningWireAfterPlatformVote}`,
  );
  assert.equal(
    planningWireAfterPlatformVote.includes('"value":"8"'),
    false,
    `Platform vote leaked into Planning frames: ${planningWireAfterPlatformVote}`,
  );
  assert.equal(bRows.length, 1, 'Platform commit did not add a row to Planning');
  assert.equal(bRows[0].roomId, PLANNING_ROOM_ID);
  assert.equal(bRows[0].value, null, 'Planning masking survives a cross-room vote');

  await mutate(a, api.revealRound, { roundId });
  await eventually(() => {
    assert(
      websocketFrames.some((frame) => frame.includes('"value":"13"')),
      `B has not received A's revealed vote on the WebSocket: ${JSON.stringify(websocketFrames)}`,
    );
    assert.equal(bRows[0]?.value, '13');
    assert.equal(bRows[0]?.roomId, PLANNING_ROOM_ID);
  }, 'revealed tally did not reach B');

  const ownAfterReveal = await a.client.query(api.liveTally, {
    args: { roomId: PLANNING_ROOM_ID },
    authorityCapture: capture(a),
  });
  assert.equal(ownAfterReveal.rows.length, 1);
  for (const field of liveTallyDefinition.fieldBoundary.fields) {
    assert.equal(
      ownAfterReveal.rows[0][field],
      '13',
      `${DECLARED_BOUNDARY_ASSERTION} — owner ${field} after reveal`,
    );
    assert.equal(
      bRows[0][field],
      '13',
      `${DECLARED_BOUNDARY_ASSERTION} — non-owner ${field} after reveal`,
    );
  }

  assert.equal(
    websocketFrames.some((frame) => frame.includes(PLATFORM_ROOM_ID) || frame.includes('"value":"8"')),
    false,
    `Platform vote appeared in Planning WebSocket frames: ${JSON.stringify(websocketFrames)}`,
  );

  const revealedBytes = websocketFrames.find((frame) => frame.includes('"value":"13"'));
  assert.equal(typeof revealedBytes, 'string');
  const revealedFrame = JSON.parse(revealedBytes);
  assert.equal(typeof revealedFrame.kind, 'string', 'revealed bytes are a typed wire envelope');

  await mutate(a, api.revealRound, { roundId });
  await assert.rejects(
    () => mutate(b, api.castVote, { roundId, value: '8' }),
    (error) => {
      assert.equal(error?.diagnostic?.code ?? error?.code, 'SNAPBACK_APP_REFUSAL');
      assert.equal(
        error?.diagnostic?.details?.appCode ?? error?.appCode,
        'ROUND_REVEALED',
      );
      return true;
    },
  );

  console.log('PASS pointing-room disclosure invariant');
  console.log(JSON.stringify({
    principals: {
      a: a.credential.session.userId,
      b: b.credential.session.userId,
    },
    hiddenWireBytes: hiddenBytes,
    crossRoomFrames: websocketFrames.length,
    isolatedRoomId: PLATFORM_ROOM_ID,
    revealedWireBytes: revealedBytes,
    revealedEnvelopeKind: revealedFrame.kind,
    declaredFieldBoundary: liveTallyDefinition.fieldBoundary,
  }));
} finally {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = RealWebSocket;
  for (const handle of handles.reverse()) {
    try { handle.dispose?.(); } catch {}
  }
  for (const client of clients.reverse()) {
    try { await client.dispose?.(); } catch {}
  }
  await server.stop();
}
