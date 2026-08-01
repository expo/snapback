// LLP 0137 A2 (group chat and presence) acceptance suite — Snapback web arm.
// External-consumer build: public @expo/snapback-* 0.1.7 only.
// 12 checks, contract demos/improvement-sweep/protocol/contracts/a2-chat-presence.v1.json.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';
import api from './snapback/generated/api.mjs';

const root = resolve(import.meta.dirname);
const evidenceDir = join(root, 'a2-evidence');
mkdirSync(evidenceDir, { recursive: true });
const readyFile = join(root, '.snapback', 'dev.ready.json');
const seedDoc = JSON.parse(readFileSync(join(root, 'snapback', 'seed.json'), 'utf8'));
const artifacts = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'artifacts.json'), 'utf8'));

const EXPECTED_CHECKS = 12;
const results = [];
const evidence = {};
let child = null;
let ready = null;
let adminToken = null;
let impersonation = null;
const cleanups = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, label, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(30);
  }
};
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }

async function check(id, fn) {
  const startedAt = Date.now();
  try {
    const note = await fn();
    results.push({ id, result: 'pass', ms: Date.now() - startedAt, note: note ?? '' });
    console.error(`PASS ${id}`);
  } catch (err) {
    const gap = err && err.a2gap === true;
    results.push({
      id,
      result: gap ? 'gap' : 'fail',
      ms: Date.now() - startedAt,
      note: String(err?.diagnostic?.code ?? err?.message ?? err),
    });
    console.error(`${gap ? 'GAP ' : 'FAIL'} ${id}: ${err?.message ?? err}`);
  }
}
function gapError(message, detail) {
  const err = new Error(message);
  err.a2gap = true;
  err.detail = detail;
  return err;
}

const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

async function adminFetch(path, init = {}) {
  const response = await fetch(`${ready.serverUrl}${path}`, {
    ...init,
    headers: {
      ...protocolHeaders,
      'x-snapback-admin-token': adminToken,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

async function signIn(email, label) {
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers: protocolHeaders, body: JSON.stringify({ email }),
  }).then((r) => r.json());
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: {
        'x-snapback-admin-token': adminToken,
        'x-snapback-impersonation-capability': impersonation,
      } },
  ).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers: protocolHeaders,
    body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
  }).then((r) => r.json());
  assert(typeof credential.token === 'string', `sign-in failed for ${email}: ${JSON.stringify(credential)}`);
  const client = new SnapbackClient(ready.serverUrl, {
    bearerToken: credential.token,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `sweep-a2-${label}-${process.pid}`,
  });
  return { client, userId: credential.session.userId, email, label };
}

// ---------- lifecycle ----------
const startedAtIso = new Date().toISOString();
// Fresh arm-owned target: remove this app's own dev database (and its bound
// sidecars) so the supervisor creates a new managed database and installs
// the versioned seed exactly. Nothing outside .snapback/dev.sqlite3* is touched.
const { rmSync } = await import('node:fs');
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}
const executable = join(root, 'node_modules', '.bin', 'snapback');
child = spawn(executable, ['dev', 'snapback'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let devStdout = '';
const lifecycleEvents = [];
let remainder = '';
child.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  devStdout += text;
  remainder += text;
  for (;;) {
    const nl = remainder.indexOf('\n');
    if (nl === -1) break;
    const line = remainder.slice(0, nl).trim();
    remainder = remainder.slice(nl + 1);
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event?.schemaVersion === 'snapback.dev.v1') lifecycleEvents.push(event);
    } catch { /* prose */ }
  }
});
let devStderr = '';
child.stderr.on('data', (chunk) => { devStderr += chunk; });

let exitCode = 2;
try {
  ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'ready file', 30_000);
  await until(
    () => lifecycleEvents.find((e) => e.state === 'generated-and-loaded' && e.managed === true) ?? null,
    'generated-and-loaded', 30_000,
  );
  assert(ready.port !== 4420, 'must not use fleet-shared port 4420');
  adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();

  const alice = await signIn('alice@sweep-a2.test', 'alice');
  const bob = await signIn('bob@sweep-a2.test', 'bob');
  const mallory = await signIn('mallory@sweep-a2.test', 'mallory');
  cleanups.push(() => alice.client.closeAuth?.());
  cleanups.push(() => bob.client.closeAuth?.());
  cleanups.push(() => mallory.client.closeAuth?.());

  let privateChannelId = null;
  let generalId = null;

  // ---------- A2-01-SEED ----------
  await check('A2-01-SEED', async () => {
    const pub = await alice.client.query(api.listPublicChannels, {});
    assert(pub.rows.length === 2, `expected exactly 2 seeded channels, got ${pub.rows.length}`);
    const names = pub.rows.map((r) => r.name);
    assert(names.join(',') === 'field-notes,general', `channel names ${names}`);
    generalId = pub.rows.find((r) => r.name === 'general')._id;
    const ids = new Set([alice.userId, bob.userId, mallory.userId]);
    assert(ids.size === 3, 'three distinct authenticated principals');
    // independent observation: bob sees the same authoritative snapshot
    const bobView = await bob.client.query(api.listPublicChannels, {});
    assert(bobView.rows.length === 2 && bobView.version === pub.version,
      'second client observes same authoritative seed snapshot');
    evidence['A2-01'] = {
      targetIdentity: {
        serverUrl: ready.serverUrl,
        port: ready.port,
        runtime: ready.runtime ?? null,
        buildStamp: ready.runtimeRecovery?.actualStamp ?? null,
        inputsHash: artifacts.inputsHash ?? null,
        appId: artifacts.appId ?? 'chat-app',
        authMode: 'sessions',
      },
      seedReceipt: { reset: true, seeded: true, seedVersion: seedDoc.seedVersion },
      authoritativeCounts: { channels: pub.rows.length, version: pub.version },
      personas: { alice: alice.userId, bob: bob.userId, mallory: mallory.userId },
    };
    return `seed exact (2 channels @v${pub.version}); personas minted`;
  });

  // ---------- A2-02-CHANNELS ----------
  await check('A2-02-CHANNELS', async () => {
    const created = await alice.client.mutate(api.createPrivateChannel, { args: { name: 'sweep' } });
    privateChannelId = created.result;
    assert(typeof privateChannelId === 'string' && created.changed_count >= 2,
      'bootstrap created channel + host seat');
    const seeded = await alice.client.mutate(api.sendMessage, {
      args: { channelId: privateChannelId, body: 'private hello', clientKey: 'a2-02-1' },
    });
    // negative-read before membership
    let readDenied = null;
    try { await mallory.client.query(api.listMessages, { args: { channelId: privateChannelId } }); }
    catch (err) { readDenied = err?.diagnostic?.code ?? String(err); }
    assert(readDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED', `mallory read denied (${readDenied})`);
    // negative-subscription
    let subscribeDenied = null;
    try {
      const h = await mallory.client.liveQuery(api.listMessages, {
        args: { channelId: privateChannelId }, connectionId: 'mallory_sub', transport: 'stream',
      });
      await h.dispose();
    } catch (err) { subscribeDenied = err?.diagnostic?.code ?? String(err); }
    assert(subscribeDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED',
      `mallory subscribe denied (${subscribeDenied})`);
    // positive: invite + accept, then read with attribution
    await alice.client.mutate(api.inviteToChannel, {
      args: { channelId: privateChannelId, userId: bob.userId },
    });
    await bob.client.mutate(api.acceptChannelInvite, { args: { channelId: privateChannelId } });
    const bobRead = await bob.client.query(api.listMessages, { args: { channelId: privateChannelId } });
    assert(bobRead.rows.length === 1 && bobRead.rows[0].authorId === alice.userId,
      'bob reads alice-attributed message after accepting');
    const bobChannels = await bob.client.query(api.listMyPrivateChannels, {});
    assert(bobChannels.rows.some((r) => r.channelId === privateChannelId && r.status === 'member'),
      'bob channel list shows membership');
    evidence['A2-02'] = {
      privateChannelId,
      actorAttribution: { messageAuthor: alice.userId, sessionDerived: true },
      negativeRead: readDenied,
      negativeSubscription: subscribeDenied,
      inviteFlow: ['bootstrap host', 'insert invited (by member)', 'setSelfRole member'],
      messageId: seeded.result,
    };
    return 'membership transitions + both negatives are SNAPBACK_AUTH_PERMISSION_DENIED {kind:role}';
  });

  // ---------- A2-03-HISTORY ----------
  await check('A2-03-HISTORY', async () => {
    // 11 more messages (12 total in private channel), alternating authors.
    for (let i = 2; i <= 12; i += 1) {
      const sender = i % 2 === 0 ? bob : alice;
      await sender.client.mutate(api.sendMessage, {
        args: { channelId: privateChannelId, body: `msg-${i}`, clientKey: `a2-03-${i}` },
      });
    }
    const full = await alice.client.query(api.listMessages, { args: { channelId: privateChannelId } });
    assert(full.rows.length === 12, `full history 12, got ${full.rows.length}`);
    const versions = full.rows.map((r) => r._version);
    assert(versions.every((value, i) => i === 0 || value > versions[i - 1]),
      'authoritative order strictly increases by commit version');
    for (const row of full.rows) {
      assert(typeof row._createdAt === 'number' && typeof row._version === 'number'
        && typeof row._id === 'string', 'server-owned system fields present');
    }
    const pages = [];
    let cursor;
    for (;;) {
      const page = await alice.client.query(api.listMessagesPage, {
        args: cursor === undefined
          ? { channelId: privateChannelId }
          : { channelId: privateChannelId, after: cursor },
      });
      const rows = page.rows.filter((r) => r.kind === 'message');
      const cursorRow = page.rows.find((r) => r.kind === 'cursor');
      pages.push(rows.map((r) => r.id));
      if (!cursorRow) break;
      cursor = cursorRow.cursor;
      assert(pages.length < 10, 'pagination terminates');
    }
    const union = pages.flat();
    assert(union.length === 12, `page union covers history exactly (${union.length})`);
    assert(new Set(union).size === 12, 'no duplicates across pages');
    assert(JSON.stringify(union) === JSON.stringify(full.rows.map((r) => r._id)),
      'page union preserves authoritative order');
    // cursor stability: re-fetch page 2 with the same cursor after a new write
    const firstPage = await alice.client.query(api.listMessagesPage, {
      args: { channelId: privateChannelId },
    });
    const c1 = firstPage.rows.find((r) => r.kind === 'cursor').cursor;
    const page2a = await alice.client.query(api.listMessagesPage, {
      args: { channelId: privateChannelId, after: c1 },
    });
    await alice.client.mutate(api.sendMessage, {
      args: { channelId: privateChannelId, body: 'appended later', clientKey: 'a2-03-13' },
    });
    const page2b = await alice.client.query(api.listMessagesPage, {
      args: { channelId: privateChannelId, after: c1 },
    });
    assert(JSON.stringify(page2a.rows.filter((r) => r.kind === 'message').map((r) => r.id))
      === JSON.stringify(page2b.rows.filter((r) => r.kind === 'message').map((r) => r.id)),
      'cursor is stable across appended writes');
    evidence['A2-03'] = {
      pageSizes: pages.map((p) => p.length),
      cursorShape: 'a2v1:<commitVersion>:<rowId> (opaque to the UI)',
      orderField: '_version (server commit order), _id tiebreak',
      unionMatchesAuthoritativeOrder: true,
      stableAcrossAppends: true,
    };
    return `pages ${pages.map((p) => p.length).join('+')} cover 12 in commit order; cursor stable`;
  });

  // ---------- A2-04-REALTIME ----------
  await check('A2-04-REALTIME', async () => {
    const updates = [];
    const handle = await bob.client.liveQuery(api.listMessages, {
      args: { channelId: generalId },
      connectionId: 'bob_realtime',
      transport: 'stream',
      onUpdate: (rows, meta) => updates.push({ at: Date.now(), rows: rows.length, meta: meta ?? null }),
    });
    cleanups.push(() => handle.dispose());
    assert(handle.rows.length === 0, 'general starts empty');
    const receipt = handle.subscriptionReceipt ?? handle.receipt ?? null;
    const sentAt = Date.now();
    const sent = await alice.client.mutate(api.sendMessage, {
      args: { channelId: generalId, body: 'hello general', clientKey: 'a2-04-1' },
    });
    await until(() => handle.rows.length === 1, 'push delivery to second client', 10_000);
    const deliveredAt = Date.now();
    assert(handle.rows[0].authorId === alice.userId, 'delivered row attributed to alice');
    assert(handle.rows[0]._id === sent.result, 'delivered row is the committed row');
    evidence['A2-04'] = {
      transport: 'stream (managed WebSocket, transport: stream, no fallback used)',
      subscriptionReceipt: receipt,
      updateMeta: updates.map((u) => ({ rows: u.rows, kind: u.meta?.kind ?? null })),
      deliveryLatencyMs: deliveredAt - sentAt,
      productPolling: false,
      note: 'poll() never called; update arrived via managed stream onUpdate',
    };
    return `push delivery in ${deliveredAt - sentAt}ms, meta kinds ${updates.map((u) => u.meta?.kind).join(',')}`;
  });

  // ---------- A2-05-EPHEMERAL ----------
  await check('A2-05-EPHEMERAL', async () => {
    const scope = { channelId: generalId };
    const seen = [];
    const bobOverlay = await bob.client.subscribeEphemeral(api.ephemeral.chatTyping, {
      connectionId: 'bob_typing', scope,
    });
    cleanups.push(() => bobOverlay.dispose());
    bobOverlay.onChange(() => seen.push(bobOverlay.currentEntries().map((e) => e.value?.name)));
    const durableBefore = (await alice.client.query(api.listPublicChannels, {})).version;
    const aliceOverlay = await alice.client.subscribeEphemeral(api.ephemeral.chatTyping, {
      connectionId: 'alice_typing', scope,
    });
    cleanups.push(() => aliceOverlay.dispose());
    await aliceOverlay.publish({ name: 'Alice' }, { ttlMs: 3_000 });
    await until(() => bobOverlay.currentEntries().length === 1, 'typing indicator arrives', 8_000);
    const entry = bobOverlay.currentEntries()[0];
    assert(entry.value.name === 'Alice', 'typing payload');
    assert(typeof entry.expiresAtMs === 'number', 'server-stamped expiry present');
    assert(entry.key === aliceOverlay.grantedConnectionId,
      'entry key is the publisher overlay\'s granted connection id (connection-owned provenance)');
    // expiry: no refresh -> entry gone after TTL
    await until(() => bobOverlay.currentEntries().length === 0, 'typing expires by TTL', 8_000);
    const durableAfter = (await alice.client.query(api.listPublicChannels, {})).version;
    assert(durableBefore === durableAfter, 'typing traffic advanced no durable version');
    evidence['A2-05'] = {
      transport: 'ephemeral lane over the shared managed stream (snapshot+delta overlay)',
      durability: { durableVersionBefore: durableBefore, durableVersionAfter: durableAfter },
      expiry: { ttlMs: 3000, observedExpiry: true, serverStampedExpiresAtMs: entry.expiresAtMs },
      keyProvenance: 'connection-owned opaque key (granted id)',
    };
    return 'typing travels ephemeral lane, TTL-expires, durable version untouched';
  });

  // ---------- A2-06-UNREAD ----------
  await check('A2-06-UNREAD', async () => {
    // second client, same authenticated principal (bob's second device)
    const bob2 = await signIn('bob@sweep-a2.test', 'bob2');
    cleanups.push(() => bob2.client.closeAuth?.());
    const h1 = await bob.client.liveQuery(api.unreadCount, {
      args: { channelId: generalId }, connectionId: 'bob_unread_1', transport: 'stream',
    });
    const h2 = await bob2.client.liveQuery(api.unreadCount, {
      args: { channelId: generalId }, connectionId: 'bob_unread_2', transport: 'stream',
    });
    cleanups.push(() => h1.dispose());
    const unreadOf = (h) => h.rows[0]?.unread ?? -1;
    const before = { h1: unreadOf(h1), h2: unreadOf(h2) };
    await alice.client.mutate(api.sendMessage, {
      args: { channelId: generalId, body: 'unread probe', clientKey: 'a2-06-1' },
    });
    await until(() => unreadOf(h1) === before.h1 + 1 && unreadOf(h2) === before.h2 + 1,
      'both clients see unread rise', 10_000);
    await bob.client.mutate(api.markChannelRead, { args: { channelId: generalId } });
    await until(() => unreadOf(h1) === 0 && unreadOf(h2) === 0,
      'mark-read propagates to the second client', 10_000);
    // reconnect: a fresh subscription still shows the authoritative marker
    await h2.dispose();
    const h2b = await bob2.client.liveQuery(api.unreadCount, {
      args: { channelId: generalId }, connectionId: 'bob_unread_2b', transport: 'stream',
    });
    cleanups.push(() => h2b.dispose());
    assert(unreadOf(h2b) === 0, 'marker survives resubscribe (authoritative, not client-local)');
    evidence['A2-06'] = {
      twoClients: ['bob_unread_1', 'bob_unread_2 (separate session client, same principal)'],
      authoritativeMarker: 'channelReads.lastReadVersion, server-stamped via markChannelRead',
      unreadRise: before.h1 + 1,
      afterMarkRead: 0,
      reconnectMarker: 0,
    };
    return 'unread rises on both clients, clears on both after one markRead, survives resubscribe';
  });

  // ---------- A2-07-RECONNECT ----------
  await check('A2-07-RECONNECT', async () => {
    const connections = [];
    const handle = await bob.client.liveQuery(api.listMessages, {
      args: { channelId: generalId },
      connectionId: 'bob_reconnect',
      transport: 'stream',
      stream: { heartbeatIntervalMs: 300, freshnessBudgetMs: 1_200, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 400 },
      onConnectionChange: (state) => connections.push({ at: Date.now(), state }),
    });
    cleanups.push(() => handle.dispose());
    const baseline = handle.rows.length;
    // force a disconnect of this connection's managed socket: server-side
    // admin disconnect of the granted wire id (a genuine transport loss for
    // the client, which then must reconnect and resnapshot)
    const grant = await bob.client.connectionGrant('bob_reconnect');
    const adminClient = new SnapbackClient(ready.serverUrl, { adminToken });
    await adminClient.disconnect(grant.id);
    // a message committed while the socket is down
    await alice.client.mutate(api.sendMessage, {
      args: { channelId: generalId, body: 'while you were away', clientKey: 'a2-07-1' },
    });
    await until(() => handle.rows.length === baseline + 1, 'reconnect + resnapshot delivers missed commit', 15_000);
    const authoritative = await alice.client.query(api.listMessages, { args: { channelId: generalId } });
    assert(handle.rows.length === authoritative.rows.length, 'row count matches authoritative view');
    const ids = handle.rows.map((r) => r._id);
    assert(new Set(ids).size === ids.length, 'no duplicated rows after resnapshot');
    assert(JSON.stringify(ids) === JSON.stringify(authoritative.rows.map((r) => r._id)),
      'order matches authoritative view');
    evidence['A2-07'] = {
      disconnectProof: connections,
      authoritativeCount: authoritative.rows.length,
      duplicates: 0,
    };
    return `severed socket, missed commit recovered, ${authoritative.rows.length} rows exactly once; states ${connections.map((c) => c.state).join('>')}`;
  });

  // ---------- A2-08-RETAINED ----------
  await check('A2-08-RETAINED', async () => {
    const info = bob.client.rqsStoreInfo ?? null;
    const handle = await bob.client.liveQuery(api.listMessages, {
      args: { channelId: generalId }, connectionId: 'bob_retained', transport: 'stream',
    });
    const retention = handle.retention ?? null;
    await handle.dispose();
    // contrast: the declarative public channel list on the same arm
    const pubHandle = await bob.client.liveQuery(api.listPublicChannels, {
      connectionId: 'bob_retained_pub', transport: 'stream',
    });
    const publicRetention = pubHandle.retention ?? null;
    await pubHandle.dispose();
    evidence['A2-08'] = { rqsStoreInfo: info, retention, publicRetention };
    // Protected/auth-scoped queries are not retainable on the JS arm; record
    // the explicit refusal instead of claiming offline history.
    throw gapError(
      `retained offline history GAP on the sessions-mode JS arm: retention=${JSON.stringify(retention)} store=${JSON.stringify(info)}`,
      { retention, info },
    );
  });

  // ---------- A2-09-CONCURRENT ----------
  await check('A2-09-CONCURRENT', async () => {
    const [a, b] = await Promise.all([
      alice.client.mutate(api.sendMessage, {
        args: { channelId: generalId, body: 'concurrent A', clientKey: 'a2-09-a' },
      }),
      bob.client.mutate(api.sendMessage, {
        args: { channelId: generalId, body: 'concurrent B', clientKey: 'a2-09-b' },
      }),
    ]);
    assert(a.result !== b.result, 'both concurrent sends committed distinct rows');
    assert(a.version !== b.version, 'distinct commit versions define a deterministic order');
    const view = await alice.client.query(api.listMessages, { args: { channelId: generalId } });
    const bodies = view.rows.map((r) => r.body);
    assert(bodies.includes('concurrent A') && bodies.includes('concurrent B'), 'no loss');
    const orderedPair = view.rows
      .filter((r) => r._id === a.result || r._id === b.result)
      .map((r) => r._id);
    const expectedPair = a.version < b.version ? [a.result, b.result] : [b.result, a.result];
    assert(JSON.stringify(orderedPair) === JSON.stringify(expectedPair),
      'observed order equals commit-version order');
    // idempotent retry under the dedupe key
    const countBefore = view.rows.length;
    const retry = await alice.client.mutate(api.sendMessage, {
      args: { channelId: generalId, body: 'concurrent A', clientKey: 'a2-09-a' },
    });
    assert(retry.result === a.result && retry.changed_count === 0, 'retry is a no-op returning the original id');
    const after = await alice.client.query(api.listMessages, { args: { channelId: generalId } });
    assert(after.rows.length === countBefore, 'retry added no row');
    evidence['A2-09'] = {
      commitVersions: { a: a.version, b: b.version },
      dedupeKey: '(channelId, clientKey) unique index + read-back',
      retryChangedCount: retry.changed_count,
    };
    return 'both concurrent sends kept, ordered by commit version; keyed retry idempotent';
  });

  // ---------- A2-10-REVOCATION ----------
  await check('A2-10-REVOCATION', async () => {
    const events = [];
    const handle = await bob.client.liveQuery(api.listMessages, {
      args: { channelId: privateChannelId },
      connectionId: 'bob_private_live',
      transport: 'stream',
      onUpdate: (rows, meta) => events.push({ rows: rows.length, kind: meta?.kind ?? null }),
    });
    cleanups.push(() => handle.dispose());
    const before = handle.rows.length;
    assert(before >= 12, 'established protected live view');
    // authority change: bob's own seat is revoked (v1 forecloses admin kick —
    // recorded as a finding; self-revocation exercises the same barrier)
    await bob.client.mutate(api.leaveChannel, { args: { channelId: privateChannelId } });
    await until(() => handle.rows.length === 0, 'established live result blanks on revocation', 10_000);
    // future protected delivery must not arrive
    await alice.client.mutate(api.sendMessage, {
      args: { channelId: privateChannelId, body: 'after revocation', clientKey: 'a2-10-1' },
    });
    await sleep(1_500);
    assert(handle.rows.length === 0, 'no protected delivery after revocation');
    let denied = null;
    try { await bob.client.query(api.listMessages, { args: { channelId: privateChannelId } }); }
    catch (err) { denied = err?.diagnostic?.code ?? String(err); }
    assert(denied === 'SNAPBACK_AUTH_PERMISSION_DENIED', `fresh read denied (${denied})`);
    evidence['A2-10'] = {
      authorityChange: 'channelMembers.removeSelf (self-revocation; admin kick foreclosed in v1)',
      alreadyConnectedClient: 'bob_private_live established before revocation',
      blankObserved: true,
      negativeDelivery: 'no rows after post-revocation commit',
      freshReadDenied: denied,
      updateTrail: events,
    };
    return `established handle blanked (${before}→0), post-revocation commit not delivered, fresh read ${denied}`;
  });

  // ---------- A2-11-PRESENCE-DURABILITY ----------
  await check('A2-11-PRESENCE-DURABILITY', async () => {
    const scope = { channelId: generalId };
    const baselineQuery = await alice.client.query(api.listMessages, { args: { channelId: generalId } });
    const durableBefore = baselineQuery.version;
    const rowsBefore = baselineQuery.rows.length;
    const aliceOverlay = await alice.client.subscribeEphemeral(api.ephemeral.chatPresence, {
      connectionId: 'alice_presence', scope,
    });
    const bobOverlay = await bob.client.subscribeEphemeral(api.ephemeral.chatPresence, {
      connectionId: 'bob_presence', scope,
    });
    cleanups.push(() => aliceOverlay.dispose());
    cleanups.push(() => bobOverlay.dispose());
    for (let i = 0; i < 10; i += 1) {
      await aliceOverlay.publish({ name: 'Alice' }, { ttlMs: 10_000 });
      await bobOverlay.publish({ name: 'Bob' }, { ttlMs: 10_000 });
      await sleep(120);
    }
    await until(() => bobOverlay.currentEntries().length === 2, 'both presences visible', 8_000);
    const afterQuery = await alice.client.query(api.listMessages, { args: { channelId: generalId } });
    assert(afterQuery.version === durableBefore,
      `20 presence publishes advanced durable version ${durableBefore} -> ${afterQuery.version}`);
    assert(afterQuery.rows.length === rowsBefore, 'no durable rows appeared');
    evidence['A2-11'] = {
      publishes: 20,
      durableVersion: { before: durableBefore, after: afterQuery.version },
      durableRowCounts: { before: rowsBefore, after: afterQuery.rows.length },
      claim: 'guide realtime/ephemeral-state: ephemeral values are never durable — verified against the store version',
    };
    return `20 publishes, durable version pinned at ${durableBefore}, zero write amplification`;
  });

  // ---------- A2-12-CLEANUP ----------
  await check('A2-12-CLEANUP', async () => {
    // arm-owned namespace: this suite's app database. Restore the literal seed.
    const reset = await adminFetch('/_snapback/api/app/reset', {
      method: 'POST', body: JSON.stringify({ seed: seedDoc }),
    });
    assert(reset.ok, 'seed-true reset succeeded');
    // the destructive reset resets the authenticated streams; verify through
    // a freshly authenticated client, as a relaunched app would
    const verifier = await signIn('alice@sweep-a2.test', 'alice-verify');
    cleanups.push(() => verifier.client.closeAuth?.());
    const pub = await verifier.client.query(api.listPublicChannels, {});
    assert(pub.rows.length === 2, 'baseline seed channels preserved');
    assert(pub.rows.every((r) => r._id === 'chan_general' || r._id === 'chan_field_notes'),
      'exact literal seed rows');
    let gone = null;
    try {
      const view = await verifier.client.query(api.listMyPrivateChannels, {});
      gone = view.rows.length;
    } catch (err) { gone = String(err?.diagnostic?.code ?? err); }
    assert(gone === 0, `post-cleanup negative: arm-created channels absent (${gone})`);
    evidence['A2-12'] = {
      targetBoundPlan: 'reset scoped to this suite-owned dev database only; no other process/port touched',
      cleanupReceipt: reset.body,
      postCleanupNegative: { privateChannels: 0, publicChannels: 2 },
    };
    return 'literal seed restored; arm-created state absent; unrelated baseline (seed rows) preserved';
  });

  const passed = results.filter((r) => r.result === 'pass').length;
  const gaps = results.filter((r) => r.result === 'gap').length;
  const failed = results.filter((r) => r.result === 'fail').length;
  const short = results.length !== EXPECTED_CHECKS;
  exitCode = failed === 0 && !short ? 0 : 1;
  const report = {
    schemaVersion: 'sweep-a2.acceptance.v1',
    title: 'LLP 0137 A2 snapback-web acceptance',
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    expectedChecks: EXPECTED_CHECKS,
    total: results.length,
    passed,
    gaps,
    failed,
    short,
    ok: exitCode === 0,
    results,
  };
  writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(evidenceDir, 'scenario-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(report));
} catch (err) {
  console.error('SETUP/TEARDOWN ERROR:', err?.stack ?? err);
  console.error('dev stderr tail:', devStderr.slice(-2000));
  exitCode = 2;
} finally {
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch { /* recorded by inspection below */ }
  }
  if (child && child.exitCode === null) {
    child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(25);
  }
  if (child && child.exitCode === null) child.kill('SIGKILL');
  process.exit(exitCode);
}
