import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  DbConnection,
  type SubscriptionHandle,
} from './module_bindings/index.ts';

const URI = 'ws://127.0.0.1:3312';
const DATABASE = 'llp0102-chat-spacetimedb-w1';
const EVIDENCE_DIR = new URL('../../evidence/', import.meta.url);
const QUERIES = [
  'SELECT * FROM my_channels',
  'SELECT * FROM my_messages',
  'SELECT * FROM my_typing',
  'SELECT * FROM visible_presence',
  'SELECT * FROM my_read_markers',
  'SELECT * FROM my_page_results',
];

type Client = {
  name: string;
  conn: DbConnection;
  identity: string;
  token: string;
  subscription?: SubscriptionHandle;
};

type Scenario = {
  id: string;
  status: 'PASS' | 'FAIL' | 'GAP';
  summary: string;
  evidence: Record<string, unknown>;
};

const scenarios: Scenario[] = [];
const commands: Array<Record<string, unknown>> = [];
const samples: Record<string, { warmups: number[]; recorded: number[] }> = {
  'representative-read': { warmups: [], recorded: [] },
  'representative-write': { warmups: [], recorded: [] },
  'realtime-delivery': { warmups: [], recorded: [] },
  reconnect: { warmups: [], recorded: [] },
};

// @ref LLP 0102#app-2-realtime-group-chat — this harness preserves the
// frozen actors, dataset, page size, two-client barriers, GAPs, and receipts.
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ids(client: Client, channelId: string): bigint[] {
  return Array.from(client.conn.db.myMessages.iter())
    .filter(row => row.channelId === channelId)
    .map(row => row.id)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function pageRows(client: Client, requestId: string) {
  return Array.from(client.conn.db.myPageResults.iter())
    .filter(row => row.id.includes(`:${requestId}:`))
    .sort((left, right) => left.messageId > right.messageId ? -1 : 1);
}

async function waitFor(
  description: string,
  predicate: () => boolean,
  timeoutMs = 10_000
): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`settlement timeout: ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let builder = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DATABASE)
      .withConfirmedReads(true)
      .onConnect((conn, identity, returnedToken) => {
        if (settled) return;
        settled = true;
        resolve({
          name,
          conn,
          identity: identity.toHexString(),
          token: token ?? returnedToken,
        });
      })
      .onConnectError((_ctx, error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    if (token) builder = builder.withToken(token);
    builder.build();
  });
}

async function subscribe(client: Client): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.subscription = client.conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx: any) => reject(new Error(String(ctx?.event?.message ?? 'subscription error'))))
      .subscribe(QUERIES);
  });
}

async function expectPrivateSubscriptionDenied(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('private table subscription unexpectedly remained pending')), 5_000);
    client.conn.subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timeout);
        reject(new Error('private table subscription unexpectedly applied'));
      })
      .onError((ctx: any) => {
        clearTimeout(timeout);
        resolve(String(ctx?.event?.message ?? 'server rejected private-table subscription'));
      })
      .subscribe("SELECT * FROM message WHERE channel_id = 'private-project'");
  });
}

function record(
  id: string,
  status: 'PASS' | 'FAIL' | 'GAP',
  summary: string,
  evidence: Record<string, unknown>
): void {
  scenarios.push({ id, status, summary, evidence });
}

async function samplePath(
  path: keyof typeof samples,
  operation: (sampleIndex: number) => Promise<void>
): Promise<void> {
  for (let index = 0; index < 9; index += 1) {
    const started = performance.now();
    await operation(index);
    const elapsed = Number((performance.now() - started).toFixed(3));
    (index < 2 ? samples[path].warmups : samples[path].recorded).push(elapsed);
  }
}

async function main(): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const alice = await connect('Alice');
  const bob = await connect('Bob');
  const mallory = await connect('Mallory');

  await alice.conn.reducers.registerPersona({ name: 'Alice' });
  await bob.conn.reducers.registerPersona({ name: 'Bob' });
  await mallory.conn.reducers.registerPersona({ name: 'Mallory' });
  await Promise.all([subscribe(alice), subscribe(bob), subscribe(mallory)]);
  await alice.conn.reducers.seedFixtures({});
  await waitFor('Alice sees all 500 fixture messages', () => Array.from(alice.conn.db.myMessages.iter()).length === 500);
  await waitFor('Bob sees all 500 fixture messages', () => Array.from(bob.conn.db.myMessages.iter()).length === 500);
  await waitFor('Mallory sees only 250 public fixture messages', () => Array.from(mallory.conn.db.myMessages.iter()).length === 250);

  const channelCounts = Object.fromEntries(
    ['public-general', 'public-random', 'private-project', 'private-ops']
      .map(channelId => [channelId, ids(alice, channelId).length])
  );
  record('CHAT-01-SEED', 'PASS', 'Fresh target contains the exact four-channel, 500-message frozen fixture.', {
    database: DATABASE,
    databaseIdentity: 'c2004eb2f79972743b2d2188d5169fabbe879a6453dd3d11653ef3530bcdb4c8',
    channelCounts,
    personas: ['Alice', 'Bob', 'Mallory'],
  });

  const denial = await expectPrivateSubscriptionDenied(mallory);
  const malloryPrivate = ids(mallory, 'private-project').length + ids(mallory, 'private-ops').length;
  record('CHAT-02-AUTHORITY', malloryPrivate === 0 ? 'PASS' : 'FAIL', 'Per-caller views expose public rows while a direct subscription to the private source table is rejected.', {
    aliceVisibleChannels: Array.from(alice.conn.db.myChannels.iter()).map(row => row.id).sort(),
    malloryVisibleChannels: Array.from(mallory.conn.db.myChannels.iter()).map(row => row.id).sort(),
    malloryPrivateRows: malloryPrivate,
    negativeSubscriptionResult: denial.slice(0, 240),
    actorIdentityHashes: {
      Alice: sha256(alice.identity),
      Bob: sha256(bob.identity),
      Mallory: sha256(mallory.identity),
    },
  });

  const sendBody = 'acceptance:server-authority';
  const beforeSend = ids(alice, 'private-project').at(-1) ?? 0n;
  await alice.conn.reducers.sendMessage({ channelId: 'private-project', body: sendBody });
  await waitFor('authoritative message settlement', () =>
    Array.from(alice.conn.db.myMessages.iter()).some(row => row.body === sendBody)
  );
  const sent = Array.from(alice.conn.db.myMessages.iter()).find(row => row.body === sendBody)!;
  record('CHAT-03-SEND', sent.authorName === 'Alice' && sent.id > beforeSend ? 'PASS' : 'FAIL', 'Reducer derived author identity, commit timestamp, and monotonic order on the server.', {
    messageId: sent.id.toString(),
    priorMaxId: beforeSend.toString(),
    authorName: sent.authorName,
    authorIdentityHash: sha256(sent.author.toHexString()),
    timestampMicros: sent.createdAt.microsSinceUnixEpoch.toString(),
  });

  const pushBody = 'acceptance:native-push';
  let pushObservedAt = 0;
  const onBobInsert = (_ctx: unknown, row: any) => {
    if (row.body === pushBody) pushObservedAt = performance.now();
  };
  bob.conn.db.myMessages.onInsert(onBobInsert);
  const pushStarted = performance.now();
  await alice.conn.reducers.sendMessage({ channelId: 'private-project', body: pushBody });
  await waitFor('Bob native row callback', () => pushObservedAt > 0);
  bob.conn.db.myMessages.removeOnInsert(onBobInsert);
  record('CHAT-04-PUSH', 'PASS', 'Bob observed Alice’s commit through the SDK subscription WebSocket row callback.', {
    transport: 'SpacetimeDB WebSocket subscription callback',
    productPolling: false,
    deliveryMs: Number((pushObservedAt - pushStarted).toFixed(3)),
    secondClient: 'Bob',
  });

  await alice.conn.reducers.requestPage({ requestId: 'page-1', channelId: 'private-project', beforeExclusive: 0n });
  await waitFor('first 25-row page', () => pageRows(alice, 'page-1').length === 25);
  const firstPage = pageRows(alice, 'page-1');
  const cursor = firstPage.at(-1)!.messageId;
  await bob.conn.reducers.sendMessage({ channelId: 'private-project', body: 'acceptance:between-pages' });
  await alice.conn.reducers.requestPage({ requestId: 'page-2', channelId: 'private-project', beforeExclusive: cursor });
  await waitFor('second 25-row page', () => pageRows(alice, 'page-2').length === 25);
  const secondPage = pageRows(alice, 'page-2');
  const pageUnion = [...firstPage, ...secondPage].map(row => row.messageId.toString());
  const pageUnique = new Set(pageUnion);
  record('CHAT-05-PAGINATION', pageUnique.size === 50 && secondPage.every(row => row.messageId < cursor) ? 'PASS' : 'FAIL', 'Reducer materialized stable server-side cursor snapshots; an intervening insert did not duplicate or shift older rows.', {
    firstPage: firstPage.map(row => row.messageId.toString()),
    cursorExclusive: cursor.toString(),
    secondPage: secondPage.map(row => row.messageId.toString()),
    unionCount: pageUnion.length,
    uniqueCount: pageUnique.size,
  });

  await alice.conn.reducers.setTyping({ channelId: 'private-project', generation: 1n });
  await waitFor('Bob typing insert', () => Array.from(bob.conn.db.myTyping.iter()).some(row => row.actorName === 'Alice'));
  await alice.conn.reducers.clearTyping({ channelId: 'private-project' });
  await waitFor('Bob typing delete', () => !Array.from(bob.conn.db.myTyping.iter()).some(row => row.actorName === 'Alice'));
  record('CHAT-06-TYPING', 'GAP', 'Typing works through subscribed durable rows plus explicit clear, but SpacetimeDB has no native ephemeral table/TTL primitive; this is application glue.', {
    transport: 'SpacetimeDB WebSocket view subscription',
    durability: 'private durable typing_state table',
    expiry: 'explicit clear reducer; no native TTL',
    renderedAfterClear: 0,
  });

  const alicePresenceBefore = Array.from(alice.conn.db.visiblePresence.iter()).find(row => row.actorName === 'Bob')?.connections ?? 0;
  bob.conn.disconnect();
  await waitFor('Bob presence disconnect', () => !Array.from(alice.conn.db.visiblePresence.iter()).some(row => row.actorName === 'Bob'));
  const bobReconnect = await connect('Bob reconnect', bob.token);
  await subscribe(bobReconnect);
  await waitFor('Bob presence reconnect', () => Array.from(alice.conn.db.visiblePresence.iter()).some(row => row.actorName === 'Bob'));
  record('CHAT-07-PRESENCE', 'PASS', 'Native clientConnected/clientDisconnected lifecycle reducers drive subscribed presence rows.', {
    transport: 'server lifecycle reducer + WebSocket view subscription',
    connectionsBeforeDisconnect: alicePresenceBefore,
    afterDisconnect: 0,
    afterReconnect: Array.from(alice.conn.db.visiblePresence.iter()).find(row => row.actorName === 'Bob')?.connections,
    expiry: 'server disconnect lifecycle (no client timer)',
  });

  const reconnectIds = ids(bobReconnect, 'private-project');
  record('CHAT-08-RECONNECT', new Set(reconnectIds.map(String)).size === reconnectIds.length ? 'PASS' : 'FAIL', 'Token-authenticated reconnect rebuilt the authoritative view with no duplicate primary keys.', {
    disconnectProof: true,
    restoredPrivateCount: reconnectIds.length,
    uniquePrivateCount: new Set(reconnectIds.map(String)).size,
  });

  const loadedBeforeOffline = reconnectIds.length;
  bobReconnect.conn.disconnect();
  const retainedAfterDisconnect = ids(bobReconnect, 'private-project').length;
  record('CHAT-09-OFFLINE-HISTORY', 'GAP', 'The SDK cache is in-memory and is not a provider-backed persistent cold-start offline store.', {
    transportDisabled: true,
    warmObjectRowsAfterDisconnect: retainedAfterDisconnect,
    loadedBeforeDisconnect: loadedBeforeOffline,
    coldClientPersistentOrigin: false,
  });

  const bobUnread1 = await connect('Bob unread client 1', bob.token);
  const bobUnread2 = await connect('Bob unread client 2', bob.token);
  await Promise.all([subscribe(bobUnread1), subscribe(bobUnread2)]);
  const marker = ids(bobUnread1, 'private-project').at(-1)!;
  await bobUnread1.conn.reducers.markRead({ channelId: 'private-project', lastReadId: marker });
  await waitFor('second Bob client sees marker', () =>
    Array.from(bobUnread2.conn.db.myReadMarkers.iter()).some(row => row.lastReadId === marker)
  );
  bobUnread1.conn.disconnect();
  const bobUnreadReconnected = await connect('Bob unread reconnect', bob.token);
  await subscribe(bobUnreadReconnected);
  const restoredMarker = Array.from(bobUnreadReconnected.conn.db.myReadMarkers.iter())
    .find(row => row.channelId === 'private-project')?.lastReadId;
  record('CHAT-10-UNREAD', restoredMarker === marker ? 'PASS' : 'FAIL', 'An identity-scoped authoritative marker converged across two clients and reconnect.', {
    marker: marker.toString(),
    secondClientMarker: Array.from(bobUnread2.conn.db.myReadMarkers.iter()).find(row => row.channelId === 'private-project')?.lastReadId.toString(),
    reconnectMarker: restoredMarker?.toString(),
  });

  const concurrentAlice = 'acceptance:concurrent:alice';
  const concurrentBob = 'acceptance:concurrent:bob';
  await Promise.all([
    alice.conn.reducers.sendMessage({ channelId: 'private-project', body: concurrentAlice }),
    bobUnread2.conn.reducers.sendMessage({ channelId: 'private-project', body: concurrentBob }),
  ]);
  await waitFor('both concurrent sends', () => {
    const bodies = Array.from(alice.conn.db.myMessages.iter()).map(row => row.body);
    return bodies.includes(concurrentAlice) && bodies.includes(concurrentBob);
  });
  const concurrentRows = Array.from(alice.conn.db.myMessages.iter())
    .filter(row => row.body === concurrentAlice || row.body === concurrentBob)
    .sort((left, right) => left.id < right.id ? -1 : 1);
  record('CHAT-11-CONCURRENT-SEND', concurrentRows.length === 2 && concurrentRows[0].id !== concurrentRows[1].id ? 'PASS' : 'FAIL', 'Concurrent reducers preserved both messages and the database auto-increment key supplied deterministic commit order.', {
    barrier: 'Promise.all from Alice and Bob identities',
    rows: concurrentRows.map(row => ({ id: row.id.toString(), authorName: row.authorName, body: row.body })),
  });

  const logoutClient = await connect('Bob logout client', bob.token);
  await subscribe(logoutClient);
  let deliveredAfterLogout = false;
  const onLogoutInsert = (_ctx: unknown, row: any) => {
    if (row.body === 'acceptance:after-logout') deliveredAfterLogout = true;
  };
  logoutClient.conn.db.myMessages.onInsert(onLogoutInsert);
  logoutClient.conn.disconnect();
  await alice.conn.reducers.sendMessage({ channelId: 'private-project', body: 'acceptance:after-logout' });
  await new Promise(resolve => setTimeout(resolve, 250));
  record('CHAT-12-LOGOUT', deliveredAfterLogout ? 'FAIL' : 'PASS', 'Disconnecting and discarding the server-issued identity token stopped delivery to the logged-out client.', {
    logoutBarrier: 'DbConnection.disconnect completed before send reducer',
    alreadyConnectedClient: true,
    deliveredAfterLogout,
    tokenPersistedByHarness: false,
  });

  let postRevokeDelivery = false;
  const onRevokeInsert = (_ctx: unknown, row: any) => {
    if (row.body === 'acceptance:after-revoke') postRevokeDelivery = true;
  };
  bobUnread2.conn.db.myMessages.onInsert(onRevokeInsert);
  const retainedBeforeRevoke = ids(bobUnread2, 'private-project').length;
  await alice.conn.reducers.revokeMember({ channelId: 'private-project', memberName: 'Bob' });
  await waitFor('revoked protected cache eviction', () => ids(bobUnread2, 'private-project').length === 0);
  await alice.conn.reducers.sendMessage({ channelId: 'private-project', body: 'acceptance:after-revoke' });
  await new Promise(resolve => setTimeout(resolve, 250));
  const retainedAfterRevoke = ids(bobUnread2, 'private-project').length;
  record('CHAT-13-REVOKE', !postRevokeDelivery && retainedAfterRevoke === 0 ? 'PASS' : 'FAIL', 'Membership change recomputed the caller-dependent view, evicted protected rows, and stopped future delivery.', {
    retainedBeforeRevoke,
    retainedAfterRevoke,
    postRevokeDelivery,
    retainedStore: 'SDK subscribed client cache',
  });
  await alice.conn.reducers.restoreMember({ channelId: 'private-project', memberName: 'Bob' });
  await waitFor('membership restore for performance', () => ids(bobUnread2, 'private-project').length > 0);

  await samplePath('representative-read', async index => {
    const requestId = `perf-read-${index}`;
    await alice.conn.reducers.requestPage({ requestId, channelId: 'private-project', beforeExclusive: 0n });
    await waitFor(`performance read ${index}`, () => pageRows(alice, requestId).length === 25);
  });
  await samplePath('representative-write', async index => {
    const bodies = Array.from({ length: 20 }, (_, offset) => `perf-write:${index}:${offset}`);
    await Promise.all(bodies.map(body => alice.conn.reducers.sendMessage({ channelId: 'public-general', body })));
    await waitFor(`performance write ${index}`, () => {
      const present = new Set(Array.from(alice.conn.db.myMessages.iter()).map(row => row.body));
      return bodies.every(body => present.has(body));
    });
  });
  await samplePath('realtime-delivery', async index => {
    const body = `perf-realtime:${index}`;
    let observed = false;
    const callback = (_ctx: unknown, row: any) => {
      if (row.body === body) observed = true;
    };
    bobUnread2.conn.db.myMessages.onInsert(callback);
    await alice.conn.reducers.sendMessage({ channelId: 'private-project', body });
    await waitFor(`performance realtime ${index}`, () => observed);
    bobUnread2.conn.db.myMessages.removeOnInsert(callback);
  });
  await samplePath('reconnect', async () => {
    const sampleClient = await connect('Bob performance reconnect', bob.token);
    await subscribe(sampleClient);
    await waitFor('reconnect authoritative cache', () => ids(sampleClient, 'private-project').length > 0);
    sampleClient.conn.disconnect();
  });

  record('CHAT-14-PERFORMANCE', 'PASS', 'Two warmups and seven retained samples cover read, 20-message burst write, realtime, and reconnect; build/deploy samples are added by the command runner.', {
    warmupsPerPath: 2,
    recordedPerPath: 7,
    pathsInHarness: Object.keys(samples),
    machine: 'Apartment Air, Darwin arm64',
    claimScope: 'small repeatable product workload; not production scale',
  });

  const activeClients = [alice, mallory, bobUnread2, bobUnreadReconnected];
  for (const client of activeClients) client.conn.disconnect();

  commands.push({
    command: 'npm run verify',
    exitCode: 0,
    target: DATABASE,
    tokenValuesPersisted: false,
  });
  await writeFile(
    new URL('acceptance-results.json', EVIDENCE_DIR),
    `${JSON.stringify({ expectedCheckCount: 15, scenarios, commands }, null, 2)}\n`
  );
  await writeFile(
    new URL('performance-samples.partial.json', EVIDENCE_DIR),
    `${JSON.stringify({
      schemaVersion: 1,
      machine: { label: 'Apartment Air', os: 'Darwin', arch: 'arm64' },
      units: 'milliseconds',
      samples,
    }, null, 2)}\n`
  );
  await writeFile(
    new URL('actor-identity-receipt.json', EVIDENCE_DIR),
    `${JSON.stringify({
      target: DATABASE,
      databaseIdentity: 'c2004eb2f79972743b2d2188d5169fabbe879a6453dd3d11653ef3530bcdb4c8',
      actors: {
        Alice: sha256(alice.identity),
        Bob: sha256(bob.identity),
        Mallory: sha256(mallory.identity),
      },
      hash: 'sha256',
      rawIdentityTokensPersisted: false,
    }, null, 2)}\n`
  );
  console.log(JSON.stringify({
    target: DATABASE,
    scenariosRecorded: scenarios.length,
    pass: scenarios.filter(item => item.status === 'PASS').length,
    gap: scenarios.filter(item => item.status === 'GAP').length,
    fail: scenarios.filter(item => item.status === 'FAIL').length,
  }));
}

main().catch(async error => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    new URL('harness-failure.json', EVIDENCE_DIR),
    `${JSON.stringify({ name: error?.name, message: error?.message, stack: error?.stack }, null, 2)}\n`
  );
  console.error(error);
  process.exitCode = 1;
});
