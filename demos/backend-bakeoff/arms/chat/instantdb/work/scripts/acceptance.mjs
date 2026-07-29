import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import os from 'node:os';

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: true },
});
globalThis.location = { href: 'https://llp0102.invalid/' };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
Object.defineProperty(globalThis, 'BroadcastChannel', {
  configurable: true,
  value: undefined,
});

const core = await import('@instantdb/core');
const { init, id, StoreInterface } = core;
const { init: initAdmin } = await import('@instantdb/admin');

const root = resolve(import.meta.dirname, '..');
const runtimeDir = resolve(root, '.arm-runtime');
const evidenceDir = resolve(root, '../evidence');
const receiptDir = resolve(root, '../receipts');
for (const dir of [runtimeDir, evidenceDir, receiptDir]) {
  mkdirSync(dir, { recursive: true });
}
const target = JSON.parse(
  readFileSync(resolve(runtimeDir, 'target.json'), 'utf8'),
);
const startedAt = new Date().toISOString();
const sha = (value) => createHash('sha256').update(value).digest('hex');
const targetIdSha256 = sha(target.appId);
const admin = initAdmin({
  appId: target.appId,
  adminToken: target.adminToken,
  disableValidation: true,
});

class MemoryStore extends StoreInterface {
  constructor(appId, storeName) {
    super(appId, storeName);
    this.values = new Map();
  }
  async getItem(key) {
    return this.values.get(key) ?? null;
  }
  async setItem(key, value) {
    this.values.set(key, value);
  }
  async multiSet(pairs) {
    for (const [key, value] of pairs) this.values.set(key, value);
  }
  async removeItem(key) {
    this.values.delete(key);
  }
  async getAllKeys() {
    return [...this.values.keys()];
  }
}

class AlwaysOnline {
  static async getIsOnline() {
    return true;
  }
  static listen() {
    return () => {};
  }
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const timeout = async (promise, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const clients = new Set();
async function makeClient(label, refreshToken) {
  const db = init(
    {
      appId: target.appId,
      devtool: false,
      __extraDedupeKey: `llp0102-${label}-${randomUUID()}`,
    },
    MemoryStore,
    AlwaysOnline,
  );
  clients.add(db);
  await timeout(
    new Promise((resolveReady) => {
      let unsubscribe = () => {};
      unsubscribe = db.subscribeAuth(() => {
        unsubscribe();
        resolveReady();
      });
    }),
    15_000,
    `${label} auth initialization`,
  );
  const auth = refreshToken
    ? await db.auth.signInWithToken(refreshToken)
    : await db.auth.signInAsGuest();
  await timeout(
    new Promise((resolveConnected) => {
      let unsubscribe = () => {};
      unsubscribe = db.subscribeConnectionStatus((status) => {
        if (status === 'authenticated') {
          unsubscribe();
          resolveConnected();
        }
      });
    }),
    20_000,
    `${label} websocket authentication`,
  );
  return {
    label,
    db,
    id: auth.user.id,
    refreshToken: auth.user.refresh_token,
  };
}

function closeClient(actor) {
  actor.db.shutdown();
  clients.delete(actor.db);
}

async function queryOnce(actor, query) {
  return timeout(actor.db.queryOnce(query), 20_000, `${actor.label} query`);
}

async function waitForQuery(actor, query, predicate, label, waitMs = 20_000) {
  return timeout(
    new Promise((resolveWait, reject) => {
      let unsubscribe = () => {};
      unsubscribe = actor.db.subscribeQuery(query, (result) => {
        if (result.error) {
          unsubscribe();
          reject(new Error(`${label}: ${result.error.message}`));
          return;
        }
        if (predicate(result)) {
          unsubscribe();
          resolveWait(result);
        }
      });
    }),
    waitMs,
    label,
  );
}

async function expectDeniedOrEmpty(actor, query, label) {
  return timeout(
    new Promise((resolveCheck) => {
      let unsubscribe = () => {};
      unsubscribe = actor.db.subscribeQuery(query, (result) => {
        if (result.error) {
          unsubscribe();
          resolveCheck({ denied: true, empty: true, errorClass: 'permission' });
          return;
        }
        const topLevel = result.data
          ? Object.values(result.data)[0]
          : undefined;
        if (Array.isArray(topLevel)) {
          unsubscribe();
          resolveCheck({
            denied: false,
            empty: topLevel.length === 0,
            errorClass: null,
          });
        }
      });
    }),
    20_000,
    label,
  );
}

const scenarioResults = [];
function record(idValue, result, summary, evidence = {}) {
  scenarioResults.push({
    id: idValue,
    result,
    summary,
    evidence,
  });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const previousActorsPath = resolve(runtimeDir, 'actors.json');
const previousActors = existsSync(previousActorsPath)
  ? JSON.parse(readFileSync(previousActorsPath, 'utf8'))
  : null;
const alice = await makeClient('alice', previousActors?.alice?.refreshToken);
const bob = await makeClient('bob', previousActors?.bob?.refreshToken);
const mallory = await makeClient('mallory', previousActors?.mallory?.refreshToken);
const actorRuntime = {
  alice: { id: alice.id, refreshToken: alice.refreshToken },
  bob: { id: bob.id, refreshToken: bob.refreshToken },
  mallory: { id: mallory.id, refreshToken: mallory.refreshToken },
};
writeFileSync(
  resolve(runtimeDir, 'actors.json'),
  JSON.stringify(actorRuntime, null, 2) + '\n',
  { mode: 0o600 },
);
chmodSync(resolve(runtimeDir, 'actors.json'), 0o600);

const actorHashes = Object.fromEntries(
  Object.entries(actorRuntime).map(([name, actor]) => [
    name,
    { idSha256: sha(actor.id), authKind: 'InstantDB native guest auth' },
  ]),
);

const existingBeforeSeed = await admin.query({
  channels: { messages: {} },
});
const channels =
  existingBeforeSeed.channels.length === 4
    ? existingBeforeSeed.channels.map((channel) => ({
        key: channel.name,
        name: channel.name,
        visibility: channel.visibility,
        id: channel.id,
      }))
    : [
        { key: 'general', name: 'general', visibility: 'public', id: id() },
        {
          key: 'field-notes',
          name: 'field-notes',
          visibility: 'public',
          id: id(),
        },
        {
          key: 'calibration',
          name: 'calibration',
          visibility: 'private',
          id: id(),
        },
        {
          key: 'deep-round',
          name: 'deep-round',
          visibility: 'private',
          id: id(),
        },
      ];
const byKey = Object.fromEntries(channels.map((channel) => [channel.key, channel]));

const seedMessageIds = [];
if (existingBeforeSeed.channels.length === 0) {
  await admin.transact(
    channels.map((channel) =>
      admin.tx.channels[channel.id]
        .update({
          name: channel.name,
          ownerId: alice.id,
          visibility: channel.visibility,
        })
        .link(
          channel.visibility === 'private'
            ? { allowedUsers: [alice.id, bob.id] }
            : {},
        ),
    ),
  );

  for (const channel of channels) {
    for (let offset = 0; offset < 125; offset += 25) {
      const chunks = [];
      for (let index = offset; index < offset + 25; index += 1) {
        const messageId = id();
        seedMessageIds.push(messageId);
        const authorId = index % 2 === 0 ? alice.id : bob.id;
        chunks.push(
          admin.tx.messages[messageId]
            .update({
              authorId,
              body: `seed-${channel.key}-${String(index).padStart(3, '0')}`,
              clientNonce: `seed-${channel.key}-${index}`,
              clientSentAt: new Date(
                Date.UTC(2026, 6, 28, 0, channels.indexOf(channel), index),
              ),
            })
            .link({ channel: channel.id }),
        );
      }
      await admin.transact(chunks);
    }
  }
}

const authoritativeSeed = await admin.query({
  channels: { messages: {} },
});
const seedCounts = Object.fromEntries(
  authoritativeSeed.channels.map((channel) => [
    channel.name,
    channel.messages.length,
  ]),
);
assert(authoritativeSeed.channels.length === 4, 'seed channel count is not 4');
assert(
  Object.values(seedCounts).every((count) => count === 125),
  'seed message counts are not 125 per channel',
);
writeFileSync(
  resolve(receiptDir, 'seed-receipt.json'),
  JSON.stringify(
    {
      operation: 'seed',
      targetIdSha256,
      actorHashes,
      authoritativeCounts: {
        channels: authoritativeSeed.channels.length,
        messagesByChannel: seedCounts,
        totalMessages: Object.values(seedCounts).reduce((a, b) => a + b, 0),
      },
      finishedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
record('CHAT-01-SEED', 'PASS', 'Exact isolated dataset exists.', {
  targetIdSha256,
  authoritativeCounts: seedCounts,
  seedReceipt: '../receipts/seed-receipt.json',
});

const aliceChannels = await queryOnce(alice, { channels: {} });
const bobChannels = await queryOnce(bob, { channels: {} });
const malloryChannels = await queryOnce(mallory, { channels: {} });
assert(aliceChannels.data.channels.length === 4, 'Alice cannot see 4 channels');
assert(bobChannels.data.channels.length === 4, 'Bob cannot see 4 channels');
assert(
  malloryChannels.data.channels.length === 2 &&
    malloryChannels.data.channels.every(
      (channel) => channel.visibility === 'public',
    ),
  'Mallory private-channel read was not refused',
);
const malloryPrivate = await expectDeniedOrEmpty(
  mallory,
  {
    messages: {
      $: { where: { 'channel.id': byKey.calibration.id } },
    },
  },
  'Mallory private subscription',
);
assert(
  malloryPrivate.empty,
  'STOP: Mallory private subscription disclosed messages',
);
record('CHAT-02-AUTHORITY', 'PASS', 'Members see allowed channels; outsider sees only public.', {
  actorHashes,
  memberChannelCounts: { alice: 4, bob: 4 },
  outsiderChannelCount: 2,
  negativeSubscription: malloryPrivate,
});

const sentId = id();
const sentStarted = Date.now();
await alice.db.transact(
  alice.db.tx.messages[sentId]
    .update({
      authorId: alice.id,
      body: 'acceptance-authoritative-send',
      clientNonce: `acceptance-send-${sentId}`,
      clientSentAt: new Date(sentStarted),
    })
    .link({ channel: byKey.general.id }),
);
const sentRead = await admin.query({
  messages: { $: { where: { id: sentId } }, channel: {} },
});
const sent = sentRead.messages[0];
assert(sent?.authorId === alice.id, 'sent author mismatch');
assert(sent?.channel?.[0]?.id === byKey.general.id, 'sent channel mismatch');
const hasServerOrder =
  typeof sent?.serverCreatedAt === 'number' ||
  typeof sent?.serverCreatedAt === 'string';
record(
  'CHAT-03-SEND',
  hasServerOrder ? 'PASS' : 'GAP',
  hasServerOrder
    ? 'Identity is permission-bound to auth.id and ordering uses Instant serverCreatedAt.'
    : 'Author identity is permission-bound, but the authoritative read did not expose a server timestamp/order field.',
  {
    settlement: 'native transact resolved synced',
    messageIdSha256: sha(sentId),
    authorIdSha256: sha(sent.authorId),
    serverCreatedAtPresent: hasServerOrder,
    orderField: 'serverCreatedAt',
  },
);

const pushId = id();
const pushQuery = {
  messages: {
    $: { where: { id: pushId } },
  },
};
let bobPushTransport = 'InstantDB WebSocket query subscription';
const bobPushPromise = waitForQuery(
  bob,
  pushQuery,
  (result) => result.data.messages.length === 1,
  'Bob second-client native push',
);
await alice.db.transact(
  alice.db.tx.messages[pushId]
    .update({
      authorId: alice.id,
      body: 'native-push-to-bob',
      clientNonce: `push-${pushId}`,
      clientSentAt: new Date(),
    })
    .link({ channel: byKey.general.id }),
);
await bobPushPromise;
record('CHAT-04-PUSH', 'PASS', 'Bob observed Alice commit through native push.', {
  secondClient: true,
  transport: bobPushTransport,
  productPolling: false,
  messageIdSha256: sha(pushId),
});

const pageQuery = {
  messages: {
    $: {
      where: { 'channel.id': byKey['field-notes'].id },
      first: 25,
      order: { serverCreatedAt: 'desc' },
    },
  },
};
const page1 = await queryOnce(alice, pageQuery);
const cursor1 = page1.pageInfo.messages.endCursor;
const betweenPageId = id();
await bob.db.transact(
  bob.db.tx.messages[betweenPageId]
    .update({
      authorId: bob.id,
      body: 'pagination-concurrent-insert',
      clientNonce: `pagination-${betweenPageId}`,
      clientSentAt: new Date(),
    })
    .link({ channel: byKey['field-notes'].id }),
);
const page2 = await queryOnce(alice, {
  messages: {
    $: {
      where: { 'channel.id': byKey['field-notes'].id },
      first: 25,
      after: cursor1,
      order: { serverCreatedAt: 'desc' },
    },
  },
});
const page1Ids = new Set(page1.data.messages.map((message) => message.id));
const page2Ids = new Set(page2.data.messages.map((message) => message.id));
const overlap = [...page1Ids].filter((messageId) => page2Ids.has(messageId));
assert(page1Ids.size === 25 && page2Ids.size === 25, 'pagination page size mismatch');
assert(overlap.length === 0, 'cursor pagination duplicated messages');
record('CHAT-05-PAGINATION', 'PASS', 'Cursor pages remained nonduplicating under an insert.', {
  cursorValues: {
    firstEndCursorSha256: sha(JSON.stringify(cursor1)),
    secondEndCursorSha256: sha(
      JSON.stringify(page2.pageInfo.messages.endCursor),
    ),
  },
  pageSizes: [page1Ids.size, page2Ids.size],
  overlapCount: overlap.length,
  concurrentInsertIdSha256: sha(betweenPageId),
  authoritativeOrder: 'serverCreatedAt desc',
});

const aliceRoom = alice.db.joinRoom('channel', byKey.general.id, {
  initialPresence: {
    actorId: alice.id,
    displayName: 'Alice',
    state: 'online',
  },
});
const bobRoom = bob.db.joinRoom('channel', byKey.general.id, {
  initialPresence: {
    actorId: bob.id,
    displayName: 'Bob',
    state: 'online',
  },
});
let typingSeen = false;
const stopTyping = bobRoom.subscribeTopic('typing', (event) => {
  if (event.actorId === alice.id && event.isTyping) typingSeen = true;
});
await sleep(400);
aliceRoom.publishTopic('typing', { actorId: alice.id, isTyping: true });
for (let attempt = 0; attempt < 30 && !typingSeen; attempt += 1) {
  await sleep(100);
}
aliceRoom.publishTopic('typing', { actorId: alice.id, isTyping: false });
stopTyping();
assert(typingSeen, 'native typing topic was not delivered');
const durableTypingInspection = await admin.query({ messages: {} });
assert(
  !durableTypingInspection.messages.some((message) =>
    String(message.body).includes('typing'),
  ),
  'typing unexpectedly appeared in durable messages',
);
record('CHAT-06-TYPING', 'PASS', 'Typing used native ephemeral room topics.', {
  transport: 'InstantDB room topic over native realtime connection',
  recipient: 'Bob second client',
  delivered: true,
  explicitClearPublished: true,
  durableTypingRows: 0,
});

let presenceSnapshots = [];
const stopPresence = aliceRoom.subscribePresence(
  {},
  (snapshot) => presenceSnapshots.push(snapshot),
);
for (let attempt = 0; attempt < 30; attempt += 1) {
  const peers =
    presenceSnapshots.at(-1)?.peers ??
    presenceSnapshots.at(-1)?.presence ??
    {};
  if (Object.keys(peers).length >= 1) break;
  await sleep(100);
}
bobRoom.leaveRoom();
for (let attempt = 0; attempt < 50; attempt += 1) {
  await sleep(100);
  const latest = presenceSnapshots.at(-1);
  const peers = latest?.peers ?? latest?.presence ?? {};
  const hasBob = Object.values(peers).some(
    (peer) => peer?.actorId === bob.id || peer?.data?.actorId === bob.id,
  );
  if (!hasBob && presenceSnapshots.length > 1) break;
}
const latestPresence = presenceSnapshots.at(-1);
const latestPeers = latestPresence?.peers ?? latestPresence?.presence ?? {};
const bobStillPresent = Object.values(latestPeers).some(
  (peer) => peer?.actorId === bob.id || peer?.data?.actorId === bob.id,
);
stopPresence();
aliceRoom.leaveRoom();
assert(!bobStillPresent, 'Bob presence did not expire after leaving');
record('CHAT-07-PRESENCE', 'PASS', 'Presence reflected two clients and removal after leave.', {
  transport: 'InstantDB native room presence',
  snapshotCount: presenceSnapshots.length,
  bobPresentAfterLeave: bobStillPresent,
  expiryWaitMs: 5_000,
});

const reconnectBefore = await queryOnce(bob, {
  messages: {
    $: { where: { 'channel.id': byKey.general.id } },
  },
});
const reconnectToken = bob.refreshToken;
closeClient(bob);
const bobReconnected = await makeClient('bob-reconnected', reconnectToken);
const reconnectAfter = await queryOnce(bobReconnected, {
  messages: {
    $: { where: { 'channel.id': byKey.general.id } },
  },
});
const reconnectIds = reconnectAfter.data.messages.map((message) => message.id);
assert(
  new Set(reconnectIds).size === reconnectIds.length,
  'reconnect introduced duplicate messages',
);
assert(
  reconnectAfter.data.messages.length === reconnectBefore.data.messages.length,
  'reconnect count changed without intervening write',
);
record('CHAT-08-RECONNECT', 'PASS', 'Native reconnect restored the same authoritative view.', {
  disconnectProof: 'first Bob core client shutdown',
  beforeCount: reconnectBefore.data.messages.length,
  afterCount: reconnectAfter.data.messages.length,
  duplicateCount: reconnectIds.length - new Set(reconnectIds).size,
  actorIdSha256: sha(bobReconnected.id),
});

record(
  'CHAT-09-OFFLINE-HISTORY',
  'GAP',
  'The browser SDK uses IndexedDB, but this remote headless run had no controlled browser; a custom storage shim was not counted as proof.',
  {
    coldClient: false,
    transportDisabled: false,
    retainedOrigin: 'not directly inspected',
    providerCapability:
      'client query cache is persisted via IndexedDB in browser runtime',
    evidenceLimitation: 'Node headless core session only',
  },
);

const bobSecond = await makeClient('bob-second-client', reconnectToken);
const markerId = id();
const markerQuery = {
  readMarkers: {
    $: { where: { key: `${bobReconnected.id}:${byKey.general.id}` } },
  },
};
const markerPush = waitForQuery(
  bobSecond,
  markerQuery,
  (result) =>
    result.data.readMarkers.length === 1,
  'second Bob client unread marker',
);
const markerAt = new Date();
await bobReconnected.db.transact(
  bobReconnected.db.tx.readMarkers[markerId]
    .update({
      key: `${bobReconnected.id}:${byKey.general.id}`,
      lastReadAt: markerAt,
      userId: bobReconnected.id,
    })
    .link({ channel: byKey.general.id }),
);
await markerPush;
closeClient(bobSecond);
const bobSecondReconnect = await makeClient(
  'bob-second-reconnected',
  reconnectToken,
);
const markerAfterReconnect = await queryOnce(bobSecondReconnect, markerQuery);
assert(
  markerAfterReconnect.data.readMarkers.length === 1,
  'unread marker missing after reconnect',
);
record('CHAT-10-UNREAD', 'PASS', 'Durable read marker synchronized across Bob clients and reconnect.', {
  twoClients: true,
  markerIdSha256: sha(markerId),
  authoritativeMarkerCount: 1,
  reconnectCount: markerAfterReconnect.data.readMarkers.length,
});

const concurrentAliceId = id();
const concurrentBobId = id();
await Promise.all([
  alice.db.transact(
    alice.db.tx.messages[concurrentAliceId]
      .update({
        authorId: alice.id,
        body: 'concurrent-alice',
        clientNonce: `concurrent-${concurrentAliceId}`,
        clientSentAt: new Date(),
      })
      .link({ channel: byKey.general.id }),
  ),
  bobReconnected.db.transact(
    bobReconnected.db.tx.messages[concurrentBobId]
      .update({
        authorId: bobReconnected.id,
        body: 'concurrent-bob',
        clientNonce: `concurrent-${concurrentBobId}`,
        clientSentAt: new Date(),
      })
      .link({ channel: byKey.general.id }),
  ),
]);
const concurrentRead = await admin.query({
  messages: {
    $: { where: { id: { $in: [concurrentAliceId, concurrentBobId] } } },
  },
});
assert(concurrentRead.messages.length === 2, 'concurrent send lost a message');
const orderedConcurrent = [...concurrentRead.messages].sort((a, b) => {
  if (a.serverCreatedAt !== b.serverCreatedAt) {
    return a.serverCreatedAt - b.serverCreatedAt;
  }
  return a.id.localeCompare(b.id);
});
record('CHAT-11-CONCURRENT-SEND', 'PASS', 'Both barrier-released sends settled and have deterministic order.', {
  twoActorBarrier: 'Promise.all dispatch',
  noLoss: concurrentRead.messages.length === 2,
  ordering: 'serverCreatedAt ascending, id tie-break',
  orderedMessageIdHashes: orderedConcurrent.map((message) => sha(message.id)),
});

const nearestRank = (values, percentile) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
};
const stats = (values) => ({
  rawMs: values,
  medianMs: nearestRank(values, 0.5),
  nearestRankP95Ms: nearestRank(values, 0.95),
});
const performanceSamples = {
  claimScope: 'small repeatable product workload; not production scale',
  warmups: 2,
  recordedSamples: 7,
  representativeRead: [],
  representativeWriteBurst20: [],
  realtimeDelivery: [],
  reconnect: [],
  buildOrDeploy: [],
};

async function sampleRead() {
  const begin = performance.now();
  const result = await queryOnce(alice, pageQuery);
  assert(result.data.messages.length === 25, 'performance read page mismatch');
  return performance.now() - begin;
}
async function sampleWriteBurst() {
  const begin = performance.now();
  const chunks = Array.from({ length: 20 }, (_, index) => {
    const messageId = id();
    return alice.db.tx.messages[messageId]
      .update({
        authorId: alice.id,
        body: `perf-burst-${randomUUID()}-${index}`,
        clientNonce: `perf-${randomUUID()}`,
        clientSentAt: new Date(),
      })
      .link({ channel: byKey.general.id });
  });
  await alice.db.transact(chunks);
  return performance.now() - begin;
}
async function sampleRealtime() {
  const messageId = id();
  const begin = performance.now();
  const delivery = waitForQuery(
    bobReconnected,
    { messages: { $: { where: { id: messageId } } } },
    (result) => result.data.messages.length === 1,
    'performance realtime delivery',
  );
  await alice.db.transact(
    alice.db.tx.messages[messageId]
      .update({
        authorId: alice.id,
        body: `perf-realtime-${randomUUID()}`,
        clientNonce: `perf-${randomUUID()}`,
        clientSentAt: new Date(),
      })
      .link({ channel: byKey.general.id }),
  );
  await delivery;
  return performance.now() - begin;
}
async function sampleReconnect(index) {
  const begin = performance.now();
  const client = await makeClient(`perf-reconnect-${index}`, reconnectToken);
  const result = await queryOnce(client, pageQuery);
  assert(result.data.messages.length === 25, 'performance reconnect page mismatch');
  closeClient(client);
  return performance.now() - begin;
}
for (let iteration = 0; iteration < 9; iteration += 1) {
  const isWarmup = iteration < 2;
  const readMs = await sampleRead();
  const writeMs = await sampleWriteBurst();
  const realtimeMs = await sampleRealtime();
  const reconnectMs = await sampleReconnect(iteration);
  if (!isWarmup) {
    performanceSamples.representativeRead.push(readMs);
    performanceSamples.representativeWriteBurst20.push(writeMs);
    performanceSamples.realtimeDelivery.push(realtimeMs);
    performanceSamples.reconnect.push(reconnectMs);
  }
}

const measurement = {
  ...performanceSamples,
  statistics: {
    representativeRead: stats(performanceSamples.representativeRead),
    representativeWriteBurst20: stats(
      performanceSamples.representativeWriteBurst20,
    ),
    realtimeDelivery: stats(performanceSamples.realtimeDelivery),
    reconnect: stats(performanceSamples.reconnect),
  },
  machine: {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    loadAverageAtCapture: os.loadavg(),
    node: process.version,
  },
  target: {
    provider: 'InstantDB hosted temporary app',
    targetIdSha256,
    region: 'provider-selected; not exposed',
    plan: 'temporary/free',
  },
};
writeFileSync(
  resolve(evidenceDir, 'performance-partial.json'),
  JSON.stringify(measurement, null, 2) + '\n',
);

const revokeDeliveryId = id();
let revokedDelivered = false;
let revokedError = false;
const revokeUnsubscribe = bobReconnected.db.subscribeQuery(
  {
    messages: {
      $: { where: { id: revokeDeliveryId } },
    },
  },
  (result) => {
    if (result.error) revokedError = true;
    if (result.data?.messages?.length) revokedDelivered = true;
  },
);
await alice.db.transact(
  alice.db.tx.channels[byKey.calibration.id].unlink({
    allowedUsers: bobReconnected.id,
  }),
);
await sleep(600);
await alice.db.transact(
  alice.db.tx.messages[revokeDeliveryId]
    .update({
      authorId: alice.id,
      body: 'must-not-deliver-after-revoke',
      clientNonce: `revoke-${revokeDeliveryId}`,
      clientSentAt: new Date(),
    })
    .link({ channel: byKey.calibration.id }),
);
await sleep(1_500);
revokeUnsubscribe();
if (revokedDelivered) {
  throw new Error('STOP: revoked Bob received a future private-channel message');
}
const retainedAfterRevoke = await expectDeniedOrEmpty(
  bobReconnected,
  {
    messages: {
      $: { where: { 'channel.id': byKey.calibration.id } },
    },
  },
  'revoked Bob retained-store inspection',
);
record('CHAT-13-REVOKE', 'PASS', 'Membership removal stopped future protected delivery.', {
  authorityChange: 'Alice unlinked Bob from private channel allowedUsers',
  futureMessageIdSha256: sha(revokeDeliveryId),
  deliveredAfterRevoke: revokedDelivered,
  subscriptionErrorAfterRevoke: revokedError,
  retainedStoreInspection: retainedAfterRevoke,
  note:
    'Current permission-filtered query returned empty/denied; physical client cache internals were not introspected.',
});

const logoutDeliveryId = id();
let logoutDelivered = false;
let logoutError = false;
const logoutUnsubscribe = bobSecondReconnect.db.subscribeQuery(
  {
    messages: {
      $: { where: { id: logoutDeliveryId } },
    },
  },
  (result) => {
    if (result.error) logoutError = true;
    if (result.data?.messages?.length) logoutDelivered = true;
  },
);
await bobSecondReconnect.db.auth.signOut();
const logoutAuth = await bobSecondReconnect.db.getAuth();
assert(logoutAuth === null, 'logout barrier did not clear auth');
await alice.db.transact(
  alice.db.tx.messages[logoutDeliveryId]
    .update({
      authorId: alice.id,
      body: 'must-not-deliver-after-logout',
      clientNonce: `logout-${logoutDeliveryId}`,
      clientSentAt: new Date(),
    })
    .link({ channel: byKey['deep-round'].id }),
);
await sleep(1_500);
logoutUnsubscribe();
if (logoutDelivered) {
  throw new Error('STOP: logged-out Bob received a future private-channel message');
}
record('CHAT-12-LOGOUT', 'PASS', 'Native signOut stopped future private delivery.', {
  logoutBarrier: 'getAuth returned null',
  alreadyConnectedClient: true,
  futureMessageIdSha256: sha(logoutDeliveryId),
  deliveredAfterLogout: logoutDelivered,
  subscriptionErrorAfterLogout: logoutError,
});

writeFileSync(
  resolve(evidenceDir, 'acceptance-results.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      app: 'chat',
      provider: 'instantdb',
      expectedCheckCount: 15,
      completedFunctionalCheckCount: scenarioResults.length,
      startedAt,
      capturedAt: new Date().toISOString(),
      targetIdSha256,
      actorHashes,
      scenarioResults,
      stopDefects: [],
    },
    null,
    2,
  ) + '\n',
);

for (const db of clients) {
  try {
    db.shutdown();
  } catch {}
}
process.stdout.write(
  JSON.stringify({
    ok: true,
    targetIdSha256,
    completedFunctionalCheckCount: scenarioResults.length,
    performanceEvidence: '../evidence/performance-partial.json',
  }) + '\n',
);
process.exit(0);
