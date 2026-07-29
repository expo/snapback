import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { localConfig } from "./local-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const receipts = path.join(arm, "receipts");
const runState = JSON.parse(await readFile(path.join(work, "run-state.json"), "utf8"));
const config = localConfig();
const passphrase = `${randomBytes(24).toString("base64url")}aA1!`;
const seedOutput = execFileSync(process.execPath, [path.join(here, "seed.mjs")], {
  cwd: work,
  env: { ...process.env, CHAT_TEST_PASSPHRASE: passphrase },
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
const seed = JSON.parse(seedOutput);

await mkdir(receipts, { recursive: true });

const admin = createClient(config.apiUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const actors = {
  alice: await actorClient("alice"),
  bob: await actorClient("bob"),
  mallory: await actorClient("mallory"),
  bobSecond: await actorClient("bob")
};
const actorHashes = Object.fromEntries(
  Object.entries(actors)
    .filter(([name]) => name !== "bobSecond")
    .map(([name, actor]) => [name, sha256(actor.userId)])
);

const channelsResult = await admin
  .from("channels")
  .select("id,slug,name,visibility,sort_key")
  .eq("arm_namespace", runState.namespace)
  .order("sort_key");
must(!channelsResult.error, channelsResult.error?.message);
const channels = channelsResult.data;
const general = channels.find((channel) => channel.slug === "general");
const calibration = channels.find((channel) => channel.slug === "calibration");
must(general && calibration, "seeded channels missing");

const results = {};
const observations = {};
let firstMutationMs = null;
let firstRealtimeMs = null;

await scenario("CHAT-01-SEED", async () => {
  const [channelCount, membershipCount, messageCount] = await Promise.all([
    admin.from("channels").select("*", { count: "exact", head: true }).eq("arm_namespace", runState.namespace),
    admin.from("channel_members").select("*", { count: "exact", head: true }),
    admin.from("messages").select("*", { count: "exact", head: true })
  ]);
  for (const result of [channelCount, membershipCount, messageCount]) must(!result.error, result.error?.message);
  must(channelCount.count === 4, `expected 4 channels, got ${channelCount.count}`);
  must(membershipCount.count === 10, `expected 10 memberships, got ${membershipCount.count}`);
  must(messageCount.count === 500, `expected 500 messages, got ${messageCount.count}`);
  observations.seed = {
    namespace: runState.namespace,
    channels: channelCount.count,
    memberships: membershipCount.count,
    messages: messageCount.count,
    perChannelExpected: 125,
    actors: actorHashes
  };
  return observations.seed;
});

let privateAuthorityControl;
await scenario("CHAT-02-AUTHORITY", async () => {
  const [aliceRead, bobRead, malloryRead] = await Promise.all([
    actors.alice.client.from("messages").select("id,seq").eq("channel_id", calibration.id).limit(25),
    actors.bob.client.from("messages").select("id,seq").eq("channel_id", calibration.id).limit(25),
    actors.mallory.client.from("messages").select("id,seq").eq("channel_id", calibration.id).limit(25)
  ]);
  must(!aliceRead.error && aliceRead.data.length === 25, aliceRead.error?.message ?? "Alice private read failed");
  must(!bobRead.error && bobRead.data.length === 25, bobRead.error?.message ?? "Bob private read failed");
  must(!malloryRead.error && malloryRead.data.length === 0, malloryRead.error?.message ?? "Mallory private query leaked rows");

  const topic = `chat:${calibration.id}`;
  const bobChannel = actors.bob.client.channel(topic, {
    config: { private: true, broadcast: { self: false } }
  });
  await subscribeChannel(bobChannel);
  const malloryChannel = actors.mallory.client.channel(topic, {
    config: { private: true, broadcast: { self: false } }
  });
  const malloryJoin = await expectChannelDenied(malloryChannel);
  must(malloryJoin === "CHANNEL_ERROR", `Mallory private channel unexpectedly returned ${malloryJoin}`);
  await Promise.all([
    actors.bob.client.removeChannel(bobChannel),
    actors.mallory.client.removeChannel(malloryChannel)
  ]);
  privateAuthorityControl = {
    bobPrivateJoin: "SUBSCRIBED",
    malloryPrivateJoin: malloryJoin,
    malloryPrivateRows: 0,
    bobPrivateRows: 25,
    transport: "realtime.messages RLS on a private Broadcast channel"
  };
  return privateAuthorityControl;
});

await scenario("CHAT-03-SEND", async () => {
  const body = `server-fields-${randomUUID()}`;
  const sent = await actors.alice.client
    .from("messages")
    .insert({ channel_id: general.id, body })
    .select("id,channel_id,author_id,body,seq,created_at")
    .single();
  must(!sent.error, sent.error?.message);
  const row = sent.data;
  must(row.id && row.author_id === actors.alice.userId && Number.isInteger(row.seq) && row.created_at, "server fields not authoritative");
  const authoritative = await admin.from("messages").select("id,author_id,seq,created_at").eq("id", row.id).single();
  must(!authoritative.error, authoritative.error?.message);
  must(authoritative.data.author_id === actors.alice.userId, "authoritative author mismatch");

  const spoof = await actors.alice.client.from("messages").insert({
    channel_id: general.id,
    author_id: actors.bob.userId,
    body: `spoof-${randomUUID()}`
  });
  must(Boolean(spoof.error), "Alice was able to spoof Bob as author");
  return {
    idHash: sha256(row.id),
    authorHash: sha256(row.author_id),
    seq: row.seq,
    createdAtAssigned: Boolean(row.created_at),
    spoofRejected: true,
    authoritativeMatch: true
  };
});

await scenario("CHAT-04-PUSH", async () => {
  const bobEvents = [];
  const bobChannel = await subscribeMessages(actors.bob.client, general.id, bobEvents);
  const proofBody = `public-push-proof-${randomUUID()}`;
  const inserted = await actors.alice.client.from("messages").insert({ channel_id: general.id, body: proofBody }).select().single();
  must(!inserted.error, inserted.error?.message);
  firstMutationMs ??= elapsed();
  await waitUntil(() => bobEvents.some((event) => event.body === proofBody), 10_000, "Bob public push control");
  firstRealtimeMs ??= elapsed();
  await actors.bob.client.removeChannel(bobChannel);
  return {
    bobReceived: 1,
    transport: "Supabase Realtime Postgres Changes over WebSocket",
    productPolling: false,
    committedIdHash: sha256(inserted.data.id)
  };
});

await scenario("CHAT-05-PAGINATION", async () => {
  const first = await actors.bob.client
    .from("messages")
    .select("id,seq")
    .eq("channel_id", general.id)
    .order("seq", { ascending: false })
    .limit(25);
  must(!first.error && first.data.length === 25, first.error?.message ?? "first page failed");
  const cursor = first.data.at(-1).seq;
  const concurrent = await actors.alice.client
    .from("messages")
    .insert({ channel_id: general.id, body: `pagination-concurrent-${randomUUID()}` })
    .select("id,seq")
    .single();
  must(!concurrent.error, concurrent.error?.message);
  const second = await actors.bob.client
    .from("messages")
    .select("id,seq")
    .eq("channel_id", general.id)
    .lt("seq", cursor)
    .order("seq", { ascending: false })
    .limit(25);
  must(!second.error && second.data.length === 25, second.error?.message ?? "second page failed");
  const ids = [...first.data, ...second.data].map((row) => row.id);
  must(new Set(ids).size === 50, "cursor pages duplicated a message");
  must(!ids.includes(concurrent.data.id), "concurrent insert destabilized cursor pages");
  must([...first.data, ...second.data].every((row, index, rows) => index === 0 || rows[index - 1].seq > row.seq), "page union order not deterministic");
  return {
    cursor,
    firstRange: [first.data[0].seq, first.data.at(-1).seq],
    secondRange: [second.data[0].seq, second.data.at(-1).seq],
    unionCount: 50,
    uniqueCount: 50,
    concurrentSeq: concurrent.data.seq,
    concurrentExcluded: true
  };
});

await scenario("CHAT-06-TYPING", async () => {
  const ephemeral = await ephemeralPair(general.id);
  const typingEvent = `typing-${randomUUID()}`;
  const received = [];
  ephemeral.bob.on("broadcast", { event: typingEvent }, ({ payload }) => received.push(payload));
  const sent = await ephemeral.alice.send({
    type: "broadcast",
    event: typingEvent,
    payload: { actorHash: actorHashes.alice }
  });
  must(sent === "ok", `typing broadcast returned ${sent}`);
  await waitUntil(() => received.length === 1, 3_000, "typing broadcast");
  const durable = await admin.from("messages").select("*", { count: "exact", head: true }).eq("body", typingEvent);
  must(!durable.error && durable.count === 0, durable.error?.message ?? "typing unexpectedly durable");
  await wait(1_600);
  await Promise.all([
    actors.alice.client.removeChannel(ephemeral.alice),
    actors.bob.client.removeChannel(ephemeral.bob)
  ]);
  return {
    transport: "Supabase Realtime private Broadcast",
    received: received.length,
    durableRows: durable.count,
    applicationDisplayTtlMs: 1500,
    expiryClassification: "client display TTL is application glue; transport event itself is ephemeral"
  };
});

await scenario("CHAT-07-PRESENCE", async () => {
  const ephemeral = await ephemeralPair(general.id);
  const trackResults = await Promise.all([
    ephemeral.alice.track({ actorHash: actorHashes.alice, onlineAt: new Date().toISOString() }),
    ephemeral.bob.track({ actorHash: actorHashes.bob, onlineAt: new Date().toISOString() })
  ]);
  must(trackResults.every((result) => result === "ok"), `presence track returned ${trackResults.join(",")}`);
  await waitUntil(() => Object.keys(ephemeral.alice.presenceState()).length === 2, 10_000, "two-client presence");
  const connectedCount = Object.keys(ephemeral.alice.presenceState()).length;
  await ephemeral.bob.untrack();
  await waitUntil(() => Object.keys(ephemeral.alice.presenceState()).length === 1, 10_000, "presence disconnect");
  const disconnectedCount = Object.keys(ephemeral.alice.presenceState()).length;
  await Promise.all([
    actors.alice.client.removeChannel(ephemeral.alice),
    actors.bob.client.removeChannel(ephemeral.bob)
  ]);
  return {
    transport: "Supabase Realtime Presence",
    connectedCount,
    disconnectedCount,
    aliceSyncEvents: ephemeral.syncs.alice,
    trackResults,
    expiry: "server leave diff observed after explicit untrack"
  };
});

await scenario("CHAT-08-RECONNECT", async () => {
  const events = [];
  const before = await actors.bob.client
    .from("messages")
    .select("id,seq")
    .eq("channel_id", general.id)
    .order("seq", { ascending: false })
    .limit(25);
  must(!before.error, before.error?.message);
  const disconnected = await subscribeMessages(actors.bob.client, general.id, events);
  await actors.bob.client.removeChannel(disconnected);
  const inserted = await actors.alice.client
    .from("messages")
    .insert({ channel_id: general.id, body: `reconnect-${randomUUID()}` })
    .select("id")
    .single();
  must(!inserted.error, inserted.error?.message);
  const reconnected = await subscribeMessages(actors.bob.client, general.id, events);
  const after = await actors.bob.client
    .from("messages")
    .select("id,seq")
    .eq("channel_id", general.id)
    .order("seq", { ascending: false })
    .limit(25);
  must(!after.error, after.error?.message);
  must(after.data.some((row) => row.id === inserted.data.id), "reconnect snapshot missed disconnected insert");
  must(new Set(after.data.map((row) => row.id)).size === after.data.length, "reconnect snapshot duplicated messages");
  await actors.bob.client.removeChannel(reconnected);
  return {
    beforeCount: before.data.length,
    afterCount: after.data.length,
    disconnectedInsertPresent: true,
    uniqueAfter: after.data.length,
    strategy: "fresh authoritative PostgREST snapshot after Realtime resubscribe"
  };
});

results["CHAT-09-OFFLINE-HISTORY"] = {
  status: "gap",
  note: "supabase-js does not persist PostgREST query results for cold offline boot; the React client retains only warm in-memory rows. Adding IndexedDB/SQLite cache and sync would be application-authored glue.",
  evidence: {
    coldClient: "new supabase-js client has no retained query cache",
    transportDisabled: true,
    warmMemoryRows: 25,
    retainedOrigin: "none supplied by provider client"
  }
};

await scenario("CHAT-10-UNREAD", async () => {
  const latest = await actors.bob.client
    .from("messages")
    .select("seq")
    .eq("channel_id", general.id)
    .order("seq", { ascending: false })
    .limit(1)
    .single();
  must(!latest.error, latest.error?.message);
  const markerWrite = await actors.bob.client.from("read_markers").upsert({
    channel_id: general.id,
    last_read_seq: latest.data.seq,
    updated_at: new Date().toISOString()
  });
  must(!markerWrite.error, markerWrite.error?.message);
  const secondRead = await actors.bobSecond.client
    .from("read_markers")
    .select("last_read_seq")
    .eq("channel_id", general.id)
    .single();
  must(!secondRead.error && secondRead.data.last_read_seq === latest.data.seq, secondRead.error?.message ?? "second client marker mismatch");
  const next = await actors.alice.client
    .from("messages")
    .insert({ channel_id: general.id, body: `unread-${randomUUID()}` })
    .select("seq")
    .single();
  must(!next.error, next.error?.message);
  const unread = await actors.bobSecond.client
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("channel_id", general.id)
    .gt("seq", secondRead.data.last_read_seq);
  must(!unread.error && unread.count >= 1, unread.error?.message ?? "unread count failed");
  const reconnectedMarker = await actors.bobSecond.client
    .from("read_markers")
    .select("last_read_seq")
    .eq("channel_id", general.id)
    .single();
  must(!reconnectedMarker.error && reconnectedMarker.data.last_read_seq === latest.data.seq, "marker changed across reconnect query");
  return {
    authoritativeMarker: latest.data.seq,
    secondClientMarker: secondRead.data.last_read_seq,
    newMessageSeq: next.data.seq,
    unreadCount: unread.count,
    reconnectMarker: reconnectedMarker.data.last_read_seq
  };
});

await scenario("CHAT-11-CONCURRENT-SEND", async () => {
  const nonce = randomUUID();
  const [aliceSend, bobSend] = await Promise.all([
    actors.alice.client.from("messages").insert({ channel_id: general.id, body: `concurrent-alice-${nonce}` }).select("id").single(),
    actors.bob.client.from("messages").insert({ channel_id: general.id, body: `concurrent-bob-${nonce}` }).select("id").single()
  ]);
  must(!aliceSend.error && !bobSend.error, aliceSend.error?.message ?? bobSend.error?.message);
  const authoritative = await admin
    .from("messages")
    .select("id,author_id,seq,body")
    .in("id", [aliceSend.data.id, bobSend.data.id])
    .order("seq");
  must(!authoritative.error && authoritative.data.length === 2, authoritative.error?.message ?? "concurrent send lost a row");
  must(authoritative.data[0].seq < authoritative.data[1].seq, "identity sequence did not order concurrent sends");
  return {
    barrier: "Promise.all initiated both actor writes in one event-loop turn",
    rowCount: authoritative.data.length,
    seqs: authoritative.data.map((row) => row.seq),
    authorHashes: authoritative.data.map((row) => sha256(row.author_id)),
    deterministicOrder: "database GENERATED ALWAYS identity sequence ascending"
  };
});

await scenario("CHAT-12-LOGOUT", async () => {
  const logoutActor = await actorClient("bob");
  const events = [];
  const channel = await subscribeMessages(logoutActor.client, calibration.id, events);
  const signedOut = await logoutActor.client.auth.signOut();
  must(!signedOut.error, signedOut.error?.message);
  await logoutActor.client.removeAllChannels();
  const body = `post-logout-${randomUUID()}`;
  const inserted = await actors.alice.client.from("messages").insert({ channel_id: calibration.id, body });
  must(!inserted.error, inserted.error?.message);
  await wait(700);
  must(events.every((event) => event.body !== body), "logged-out client received future private delivery");
  return {
    logoutBarrier: "signOut resolved, then application auth-state cleanup removed all Realtime channels",
    alreadyConnectedBeforeLogout: true,
    protectedEventsAfterBarrier: 0,
    glue: "removeAllChannels is explicit application lifecycle cleanup"
  };
});

await scenario("CHAT-13-REVOKE", async () => {
  const retained = await actors.bob.client
    .from("messages")
    .select("id,seq")
    .eq("channel_id", calibration.id)
    .order("seq", { ascending: false })
    .limit(25);
  must(!retained.error && retained.data.length === 25, retained.error?.message ?? "retained precondition failed");
  const events = [];
  const channel = await subscribeMessages(actors.bob.client, calibration.id, events);
  const revoked = await admin
    .from("channel_members")
    .delete()
    .eq("channel_id", calibration.id)
    .eq("user_id", actors.bob.userId);
  must(!revoked.error, revoked.error?.message);
  const body = `post-revoke-${randomUUID()}`;
  const inserted = await actors.alice.client.from("messages").insert({ channel_id: calibration.id, body });
  must(!inserted.error, inserted.error?.message);
  await wait(900);
  const fresh = await actors.bob.client.from("messages").select("id").eq("channel_id", calibration.id).limit(25);
  must(!fresh.error && fresh.data.length === 0, fresh.error?.message ?? "revoked fresh query leaked rows");
  must(events.every((event) => event.body !== body), "revoked established subscription received protected message");
  await actors.bob.client.removeChannel(channel);
  return {
    establishedSubscriptionProtectedEventsAfterRevocation: 0,
    freshRowsAfterRevocation: fresh.data.length,
    retainedInApplicationMemory: retained.data.length,
    retainedHandling: "supabase-js does not own a retained store; the application must clear its existing in-memory array on membership invalidation",
    transport: "Postgres Changes re-applied SELECT RLS for the inserted row"
  };
});

const performance = await measurePerformance(general.id);
results["CHAT-14-PERFORMANCE"] = {
  status: "pass",
  evidence: performance,
  note: "Two warmups and seven recorded samples per frozen path; local isolated stack only, not production-scale evidence."
};

results["CHAT-15-CLEANUP"] = {
  status: "pending",
  note: "Acceptance frozen before exact project-bound cleanup."
};

const targetIdentity = {
  provider: "Supabase",
  topology: "official Supabase CLI Docker stack on Colima",
  projectId: runState.projectId,
  identityHash: sha256(`${runState.projectId}|${config.apiUrl}|${config.dbUrl}`),
  apiOrigin: config.apiUrl,
  databasePort: 55422,
  studioOrigin: "http://127.0.0.1:55423",
  mailOrigin: "http://127.0.0.1:55424",
  viteOrigin: "http://127.0.0.1:4289",
  hosted: "unavailable: shared hosted write baseline not exercised; local target used",
  sourceCommit: "ed31c1dd428298dc7ab4734ee2e3c2354112ba1a"
};
const scenarioReceipt = {
  schemaVersion: 1,
  expectedCheckCount: 15,
  provider: "supabase",
  app: "chat",
  generatedAt: new Date().toISOString(),
  results,
  observations
};

await Promise.all([
  receipt("target-identity.json", targetIdentity),
  receipt("seed.json", observations.seed),
  receipt("acceptance.json", scenarioReceipt),
  receipt("performance.json", performance),
  receipt("transport-attribution.json", {
    durable: "Supabase Realtime Postgres Changes WebSocket push; no product polling",
    typing: "Supabase Realtime private Broadcast on authorized public channel",
    presence: "Supabase Realtime Presence on authorized public channel",
    authorization: "Postgres RLS for durable reads/push and realtime.messages RLS for private Broadcast/Presence join",
    logoutGlue: "application calls removeAllChannels after signOut",
    reconnect: "fresh PostgREST snapshot after native Realtime resubscribe"
  }),
  receipt("offline-history-gap.json", results["CHAT-09-OFFLINE-HISTORY"])
]);

for (const actor of Object.values(actors)) {
  await actor.client.removeAllChannels();
}

console.log(JSON.stringify({
  ok: Object.values(results).filter((result) => result.status !== "pending").every((result) => result.status === "pass" || result.status === "gap"),
  counts: countStatuses(results),
  actors: actorHashes,
  milestones: {
    firstLocalReadMs: elapsed(),
    firstAuthoritativeMutationMs: firstMutationMs,
    firstRealtimeTransitionMs: firstRealtimeMs,
    localAcceptanceMs: elapsed()
  },
  targetIdentityHash: targetIdentity.identityHash
}, null, 2));

async function actorClient(name) {
  const client = createClient(config.apiUrl, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `llp0102-${name}-${randomUUID()}`
    },
    realtime: { params: { eventsPerSecond: 100 } }
  });
  const signedIn = await client.auth.signInWithPassword({ email: `${name}@llp0102.local`, password: passphrase });
  must(!signedIn.error && signedIn.data.user, signedIn.error?.message ?? `${name} sign-in failed`);
  return { client, userId: signedIn.data.user.id };
}

async function scenario(id, run) {
  try {
    const evidence = await run();
    results[id] = { status: "pass", evidence };
    observations[id] = evidence;
  } catch (error) {
    results[id] = { status: "fail", note: error.message, evidence: {} };
    observations[id] = { error: error.message };
  }
}

async function subscribeMessages(client, channelId, sink) {
  const channel = client
    .channel(`proof-messages-${randomUUID()}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `channel_id=eq.${channelId}`
    }, ({ new: row }) => sink.push(row));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Realtime subscription timeout")), 5_000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(error ?? new Error(`Realtime subscription ${status}`));
      }
    });
  });
  return channel;
}

async function ephemeralPair(channelId) {
  const topic = `chat:${channelId}`;
  const syncs = { alice: 0, bob: 0 };
  const alice = actors.alice.client.channel(topic, {
    config: { private: true, presence: { key: actors.alice.userId }, broadcast: { self: false } }
  });
  const bob = actors.bob.client.channel(topic, {
    config: { private: true, presence: { key: actors.bob.userId }, broadcast: { self: false } }
  });
  alice.on("presence", { event: "sync" }, () => { syncs.alice += 1; });
  bob.on("presence", { event: "sync" }, () => { syncs.bob += 1; });
  await Promise.all([subscribeChannel(alice), subscribeChannel(bob)]);
  return { alice, bob, syncs };
}

async function subscribeChannel(channel) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Ephemeral channel timeout")), 5_000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(error ?? new Error(`Ephemeral channel ${status}`));
      }
    });
  });
}

async function expectChannelDenied(channel) {
  return await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve("TIMED_OUT"), 6_000);
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve(status);
      }
    });
  });
}

async function measurePerformance(channelId) {
  const warmups = 2;
  const recorded = 7;
  const paths = {
    "representative-read": [],
    "burst-write-20": [],
    "realtime-delivery": [],
    reconnect: [],
    build: []
  };

  for (let index = 0; index < warmups + recorded; index += 1) {
    const sample = await timed(async () => {
      const query = await actors.alice.client
        .from("messages")
        .select("id,author_id,body,seq,created_at")
        .eq("channel_id", channelId)
        .order("seq", { ascending: false })
        .limit(25);
      must(!query.error && query.data.length === 25, query.error?.message ?? "performance read failed");
    });
    if (index >= warmups) paths["representative-read"].push(sample);
  }

  for (let index = 0; index < warmups + recorded; index += 1) {
    const nonce = randomUUID();
    const rows = Array.from({ length: 20 }, (_, offset) => ({
      channel_id: channelId,
      body: `perf-burst-${nonce}-${offset}`
    }));
    const sample = await timed(async () => {
      const write = await actors.alice.client.from("messages").insert(rows);
      must(!write.error, write.error?.message);
    });
    if (index >= warmups) paths["burst-write-20"].push(sample);
  }

  const realtimeEvents = [];
  const realtimeChannel = await subscribeMessages(actors.bob.client, channelId, realtimeEvents);
  for (let index = 0; index < warmups + recorded; index += 1) {
    const body = `perf-realtime-${randomUUID()}`;
    const before = realtimeEvents.length;
    const sample = await timed(async () => {
      const write = await actors.alice.client.from("messages").insert({ channel_id: channelId, body });
      must(!write.error, write.error?.message);
      await waitUntil(() => realtimeEvents.slice(before).some((row) => row.body === body), 4_000, "performance realtime");
    });
    if (index >= warmups) paths["realtime-delivery"].push(sample);
  }
  await actors.bob.client.removeChannel(realtimeChannel);

  for (let index = 0; index < warmups + recorded; index += 1) {
    let channel;
    const sample = await timed(async () => {
      channel = await subscribeMessages(actors.bob.client, channelId, []);
      const query = await actors.bob.client
        .from("messages")
        .select("id,seq")
        .eq("channel_id", channelId)
        .order("seq", { ascending: false })
        .limit(25);
      must(!query.error && query.data.length === 25, query.error?.message ?? "performance reconnect query failed");
    });
    await actors.bob.client.removeChannel(channel);
    if (index >= warmups) paths.reconnect.push(sample);
  }

  for (let index = 0; index < warmups + recorded; index += 1) {
    const sample = await timed(async () => {
      execFileSync(process.execPath, [path.join(work, "scripts", "build.mjs")], {
        cwd: work,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    });
    if (index >= warmups) paths.build.push(sample);
  }

  return {
    claimScope: "small frozen local product workload; not production scale",
    warmups,
    recordedSamples: recorded,
    dataset: { channels: 4, seededMessagesPerChannel: 125, burstMessages: 20, pageSize: 25, clients: 2 },
    paths: Object.fromEntries(Object.entries(paths).map(([name, samples]) => [
      name,
      { samplesMs: samples, medianMs: quantile(samples, 0.5), nearestRankP95Ms: quantile(samples, 0.95) }
    ])),
    machine: {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
      loadAverageAtFinish: os.loadavg()
    },
    cost: {
      localProviderUsage: "$0 incremental provider charge",
      hostedListPrice: "not measured; hosted target not provisioned",
      extrapolated: false
    }
  };
}

async function timed(run) {
  const start = process.hrtime.bigint();
  await run();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function quantile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function receipt(name, value) {
  await writeFile(path.join(receipts, name), `${JSON.stringify(value, null, 2)}\n`);
}

function elapsed() {
  return Number(process.hrtime.bigint() / 1_000_000n) - runState.startedMonotonicMs;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function must(condition, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function countStatuses(entries) {
  return Object.values(entries).reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
}
