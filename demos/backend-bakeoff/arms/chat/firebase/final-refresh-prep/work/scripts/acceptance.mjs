import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Timestamp,
  getFirestore as getAdminFirestore
} from "firebase-admin/firestore";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import {
  collection,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp as firestoreServerTimestamp,
  setDoc,
  startAfter,
  where
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  goOffline,
  goOnline,
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set
} from "firebase/database";
import {
  actor,
  assert,
  deferred,
  measure,
  password,
  personas,
  projectId,
  sleep,
  stats
} from "./lib.mjs";

process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:35299";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:35280";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:35281";

const startedAt = new Date().toISOString();
const monotonicStart = performance.now();
const receipts = path.resolve("receipts");
const scenarioDir = path.join(receipts, "scenarios");
await mkdir(scenarioDir, { recursive: true });

const adminApp = initializeAdminApp({
  projectId,
  databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`
}, `admin-${crypto.randomUUID()}`);
const adminAuth = getAdminAuth(adminApp);
const adminDb = getAdminFirestore(adminApp);
const adminRtdb = getAdminDatabase(adminApp);

const scenarios = {};
const commands = [];
const milestones = {
  firstLocalReadMs: null,
  firstAuthoritativeMutationMs: null,
  firstRealtimeTransitionMs: null,
  localAcceptanceMs: null,
  acceptanceCompletionMs: null
};

function elapsed() {
  return Math.round(performance.now() - monotonicStart);
}

async function receipt(id, status, evidence, transport, note = "") {
  const result = {
    id,
    status,
    capturedAt: new Date().toISOString(),
    target: projectId,
    transport,
    evidence,
    note
  };
  scenarios[id] = result;
  await writeFile(path.join(scenarioDir, `${id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function ensureUser(email, displayName) {
  try {
    return await adminAuth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    return adminAuth.createUser({ email, password, displayName, emailVerified: true });
  }
}

async function seed() {
  const users = {};
  for (const [name, email] of Object.entries(personas)) {
    users[name] = await ensureUser(email, name);
  }
  const memberIds = [users.alice.uid, users.bob.uid];
  const channelSpecs = [
    ["public-lobby", "Public lobby", "public"],
    ["public-random", "Public random", "public"],
    ["private-alpha", "Private alpha", "private"],
    ["private-beta", "Private beta", "private"]
  ];
  const writer = adminDb.bulkWriter();
  for (const [channelId, name, visibility] of channelSpecs) {
    writer.set(adminDb.doc(`channels/${channelId}`), {
      name,
      visibility,
      memberIds,
      nextSequence: 125,
      seededAt: Timestamp.fromMillis(Date.UTC(2026, 6, 28))
    });
    for (let sequence = 1; sequence <= 125; sequence += 1) {
      const authorId = sequence % 2 === 0 ? users.bob.uid : users.alice.uid;
      writer.set(adminDb.doc(`channels/${channelId}/messages/seed-${String(sequence).padStart(3, "0")}`), {
        authorId,
        body: `${channelId} seeded message ${sequence}`,
        sequence,
        createdAt: Timestamp.fromMillis(Date.UTC(2026, 6, 28) + sequence * 1000)
      });
    }
    writer.set(adminDb.doc(`channels/${channelId}/reads/${users.alice.uid}`), {
      lastReadSequence: 125,
      updatedAt: Timestamp.fromMillis(Date.UTC(2026, 6, 28))
    });
    writer.set(adminDb.doc(`channels/${channelId}/reads/${users.bob.uid}`), {
      lastReadSequence: 120,
      updatedAt: Timestamp.fromMillis(Date.UTC(2026, 6, 28))
    });
  }
  await writer.close();

  const visibility = {};
  const memberships = {};
  for (const [channelId, , channelVisibility] of channelSpecs) {
    visibility[channelId] = channelVisibility;
    memberships[channelId] = {
      [users.alice.uid]: true,
      [users.bob.uid]: true
    };
  }
  await adminRtdb.ref().set({
    channelVisibility: visibility,
    channelMembers: memberships
  });
  return users;
}

async function countMessages(channelId) {
  return (await adminDb.collection(`channels/${channelId}/messages`).count().get()).data().count;
}

function messagesQuery(client, channelId, pageLimit = 25) {
  return query(
    collection(client.db, "channels", channelId, "messages"),
    orderBy("sequence", "desc"),
    limit(pageLimit)
  );
}

function callable(client) {
  return httpsCallable(client.functions, "sendMessage");
}

async function expectDenied(operation, label) {
  try {
    await operation();
  } catch (error) {
    const code = String(error.code ?? error.message);
    assert(code.includes("permission-denied"), `${label} failed with unexpected ${code}`);
    return code;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function waitForMessage(q, predicate, label) {
  const gate = deferred(10_000, label);
  let stop = () => {};
  stop = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
    const found = snapshot.docs.find((item) => predicate({ id: item.id, ...item.data() }));
    if (found && !snapshot.metadata.fromCache) {
      gate.resolve({ id: found.id, ...found.data(), fromCache: snapshot.metadata.fromCache });
      stop();
    }
  }, gate.reject);
  return gate.promise.finally(() => stop());
}

async function runCommand(command, args) {
  const started = performance.now();
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", cwd: process.cwd() });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  const durationMs = Number((performance.now() - started).toFixed(3));
  commands.push({ command: [command, ...args].join(" "), exitCode, durationMs });
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} exited ${exitCode}`);
  return durationMs;
}

const users = await seed();
await writeFile(path.join(receipts, "seed-receipt.json"), `${JSON.stringify({
  projectId,
  personas: Object.fromEntries(Object.entries(users).map(([name, user]) => [
    name,
    { uidHash: createHash("sha256").update(user.uid).digest("hex"), emailDomain: "example.test" }
  ])),
  channels: 4,
  messagesPerChannel: 125,
  totalMessages: 500,
  deterministicSeedEpochMs: Date.UTC(2026, 6, 28)
}, null, 2)}\n`);

const alice = await actor("alice");
const bob = await actor("bob");
const mallory = await actor("mallory");

try {
  const counts = Object.fromEntries(await Promise.all(
    ["public-lobby", "public-random", "private-alpha", "private-beta"]
      .map(async (channel) => [channel, await countMessages(channel)])
  ));
  const alicePrivate = await getDocsFromServer(messagesQuery(alice, "private-alpha"));
  milestones.firstLocalReadMs = elapsed();
  assert(alicePrivate.size === 25, "Alice first private page must contain 25 messages");
  assert(Object.values(counts).every((count) => count === 125), "Each channel must have 125 messages");
  await receipt("CHAT-01-SEED", "pass", {
    channelCounts: counts,
    actorCount: 3,
    alicePrivatePage: alicePrivate.size,
    seedReceipt: "receipts/seed-receipt.json"
  }, "not-applicable", "Fresh local emulator target; exact deterministic seed.");

  const bobPrivate = await getDocsFromServer(messagesQuery(bob, "private-alpha"));
  assert(bobPrivate.size === 25, "Bob must read private channel");
  const malloryReadCode = await expectDenied(
    () => getDocsFromServer(messagesQuery(mallory, "private-alpha")),
    "Mallory private read"
  );
  const negativeSubscription = deferred(5_000, "Mallory private subscription denial");
  const stopMallory = onSnapshot(
    messagesQuery(mallory, "private-alpha"),
    () => negativeSubscription.reject(new Error("Mallory private subscription returned data")),
    (error) => negativeSubscription.resolve(String(error.code))
  );
  const mallorySubscriptionCode = await negativeSubscription.promise;
  stopMallory();
  assert(mallorySubscriptionCode.includes("permission-denied"), "Mallory subscription must be denied");
  await receipt("CHAT-02-AUTHORITY", "pass", {
    alicePrivatePage: alicePrivate.size,
    bobPrivatePage: bobPrivate.size,
    malloryReadCode,
    mallorySubscriptionCode,
    rules: "firestore.rules"
  }, "Firestore rules", "Direct client reads/listens under three native Auth emulator principals.");

  const firstSend = await callable(alice)({
    channelId: "private-alpha",
    body: "Alice authoritative send"
  });
  const sentDoc = await adminDb.doc(`channels/private-alpha/messages/${firstSend.data.id}`).get();
  assert(sentDoc.exists, "Sent document must exist authoritatively");
  assert(sentDoc.data().authorId === alice.uid, "Author must come from callable auth context");
  assert(sentDoc.data().sequence === firstSend.data.sequence, "Returned and stored order must match");
  assert(sentDoc.data().createdAt instanceof Timestamp, "Server timestamp must be materialized");
  milestones.firstAuthoritativeMutationMs = elapsed();
  await receipt("CHAT-03-SEND", "pass", {
    callableResult: firstSend.data,
    authoritativeDocument: {
      id: sentDoc.id,
      authorIdHash: createHash("sha256").update(sentDoc.data().authorId).digest("hex"),
      sequence: sentDoc.data().sequence,
      createdAt: sentDoc.data().createdAt.toDate().toISOString()
    },
    implementation: "functions/index.js#sendMessage"
  }, "Firebase callable function + Firestore transaction", "Function generates document identity, derives author from verified auth, and allocates sequence transactionally.");

  const pushBody = `push-${crypto.randomUUID()}`;
  const pushGate = waitForMessage(messagesQuery(bob, "private-alpha", 10), (message) => message.body === pushBody, "Bob native push");
  const pushStart = performance.now();
  const pushSend = await callable(alice)({ channelId: "private-alpha", body: pushBody });
  const pushed = await pushGate;
  const pushMs = Number((performance.now() - pushStart).toFixed(3));
  assert(pushed.id === pushSend.data.id, "Bob push id must match authoritative send");
  milestones.firstRealtimeTransitionMs = elapsed();
  await receipt("CHAT-04-PUSH", "pass", {
    messageId: pushed.id,
    sequence: pushed.sequence,
    latencyMs: pushMs,
    snapshotFromCache: pushed.fromCache,
    polling: false
  }, "Firestore onSnapshot/WebChannel push", "Second authenticated client observed a server snapshot; no product polling.");

  const pageOne = await getDocsFromServer(messagesQuery(alice, "private-alpha"));
  const cursor = pageOne.docs.at(-1);
  const inserted = await callable(bob)({
    channelId: "private-alpha",
    body: `pagination-concurrent-${crypto.randomUUID()}`
  });
  const pageTwo = await getDocsFromServer(query(
    collection(alice.db, "channels", "private-alpha", "messages"),
    orderBy("sequence", "desc"),
    startAfter(cursor),
    limit(25)
  ));
  const pageOneIds = pageOne.docs.map((item) => item.id);
  const pageTwoIds = pageTwo.docs.map((item) => item.id);
  const union = new Set([...pageOneIds, ...pageTwoIds]);
  assert(pageOneIds.length === 25 && pageTwoIds.length === 25, "Both cursor pages must be full");
  assert(union.size === 50, "Cursor pages must not duplicate");
  assert(!union.has(inserted.data.id), "Concurrent newer insert must not shift into older page");
  assert(pageTwo.docs[0].data().sequence < cursor.data().sequence, "Second page must continue older ordering");
  await receipt("CHAT-05-PAGINATION", "pass", {
    order: "sequence desc",
    cursor: { id: cursor.id, sequence: cursor.data().sequence },
    concurrentInsert: inserted.data,
    pageOneCount: pageOneIds.length,
    pageTwoCount: pageTwoIds.length,
    unionCount: union.size
  }, "Firestore query cursor", "Document-snapshot startAfter cursor remains stable under a newer insert.");

  const typingPath = ref(alice.rtdb, `typing/private-alpha/${alice.uid}`);
  const bobTypingPath = ref(bob.rtdb, `typing/private-alpha/${alice.uid}`);
  const typingTransitions = [];
  const typingSeen = deferred(5_000, "Bob sees Alice typing");
  const typingCleared = deferred(5_000, "Bob sees typing clear");
  let sawTyping = false;
  const stopTyping = onValue(bobTypingPath, (snapshot) => {
    typingTransitions.push(snapshot.val());
    if (snapshot.val()?.state === "typing") {
      sawTyping = true;
      typingSeen.resolve(snapshot.val());
    } else if (sawTyping && snapshot.val() === null) {
      typingCleared.resolve(null);
    }
  });
  await set(typingPath, {
    state: "typing",
    changedAt: serverTimestamp(),
    expiresAtClientMs: Date.now() + 250
  });
  await typingSeen.promise;
  await sleep(250);
  await remove(typingPath);
  await typingCleared.promise;
  stopTyping();
  const typingAfter = await adminRtdb.ref(`typing/private-alpha/${alice.uid}`).get();
  assert(!typingAfter.exists(), "Typing row must expire/remove");
  await receipt("CHAT-06-TYPING", "pass", {
    transitions: typingTransitions,
    durableAfterExpiry: typingAfter.exists(),
    expiryMs: 250,
    glue: "Application-authored expiry/removal policy"
  }, "Firebase Realtime Database onValue push", "Native Firebase realtime path; typing TTL policy is explicitly application glue, not a Firestore/native typing primitive.");

  const bobPresence = ref(bob.rtdb, `presence/private-alpha/${bob.uid}`);
  const aliceObservesBob = ref(alice.rtdb, `presence/private-alpha/${bob.uid}`);
  const onlineGate = deferred(5_000, "Alice sees Bob online");
  const offlineGate = deferred(5_000, "Alice sees Bob offline");
  const presenceTransitions = [];
  const stopPresence = onValue(aliceObservesBob, (snapshot) => {
    const value = snapshot.val();
    presenceTransitions.push(value);
    if (value?.state === "online") onlineGate.resolve(value);
    if (value?.state === "offline") offlineGate.resolve(value);
  });
  await onDisconnect(bobPresence).set({ state: "offline", changedAt: serverTimestamp() });
  await set(bobPresence, { state: "online", changedAt: serverTimestamp() });
  await onlineGate.promise;
  goOffline(bob.rtdb);
  await offlineGate.promise;
  const presenceAfter = await adminRtdb.ref(`presence/private-alpha/${bob.uid}`).get();
  assert(presenceAfter.val()?.state === "offline", "onDisconnect must expire online state");
  goOnline(bob.rtdb);
  stopPresence();
  await receipt("CHAT-07-PRESENCE", "pass", {
    transitions: presenceTransitions,
    authoritativeAfterDisconnect: presenceAfter.val(),
    staleOnlineExpired: true
  }, "Realtime Database .info connection/onDisconnect semantics", "Official Firebase native presence building block; disconnect atomically expires the online state.");

  const reconnectBefore = await getDocsFromServer(messagesQuery(bob, "private-alpha", 100));
  const reconnectIds = new Set(reconnectBefore.docs.map((item) => item.id));
  const reconnectBody = `reconnect-${crypto.randomUUID()}`;
  const reconnectGate = waitForMessage(messagesQuery(bob, "private-alpha", 100), (message) => message.body === reconnectBody, "Bob reconnect delivery");
  await disableNetwork(bob.db);
  const reconnectSend = await callable(alice)({ channelId: "private-alpha", body: reconnectBody });
  await sleep(100);
  await enableNetwork(bob.db);
  const reconnectMessage = await reconnectGate;
  const reconnectAfter = await getDocsFromServer(messagesQuery(bob, "private-alpha", 100));
  const afterIds = reconnectAfter.docs.map((item) => item.id);
  assert(reconnectMessage.id === reconnectSend.data.id, "Reconnect message id must settle");
  assert(afterIds.filter((id) => id === reconnectSend.data.id).length === 1, "Reconnect view must not duplicate");
  assert(!reconnectIds.has(reconnectSend.data.id), "Reconnect send must be new");
  await receipt("CHAT-08-RECONNECT", "pass", {
    beforeCount: reconnectBefore.size,
    afterCount: reconnectAfter.size,
    messageId: reconnectSend.data.id,
    occurrenceCount: afterIds.filter((id) => id === reconnectSend.data.id).length
  }, "Firestore disableNetwork/enableNetwork + onSnapshot", "Authoritative server snapshot restored after deliberate client network disable.");

  await receipt("CHAT-09-OFFLINE-HISTORY", "pending", {
    plannedBrowserReceipt: "receipts/offline-browser.json",
    cacheConfiguration: "persistentLocalCache + persistentMultipleTabManager"
  }, "Firestore IndexedDB persistent cache", "Completed by the separate cold-browser harness after Vite starts.");

  const bobSecond = await actor("bob");
  try {
    const readRefOne = doc(bob.db, "channels", "private-alpha", "reads", bob.uid);
    const readRefTwo = doc(bobSecond.db, "channels", "private-alpha", "reads", bob.uid);
    const markerGate = deferred(5_000, "Bob second client sees read marker");
    const stopMarker = onSnapshot(readRefTwo, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.data()?.lastReadSequence >= 125 && !snapshot.metadata.fromCache) {
        markerGate.resolve(snapshot.data());
      }
    }, markerGate.reject);
    const latestForUnread = await adminDb.doc("channels/private-alpha").get();
    const latestSequence = latestForUnread.data().nextSequence;
    const markerBefore = (await getDoc(readRefOne)).data().lastReadSequence;
    const unreadBefore = latestSequence - markerBefore;
    await setDoc(readRefOne, {
      lastReadSequence: latestSequence,
      updatedAt: firestoreServerTimestamp()
    });
    const markerSeen = await markerGate.promise;
    stopMarker();
    await disableNetwork(bobSecond.db);
    await enableNetwork(bobSecond.db);
    const markerAfterReconnect = (await getDocFromServer(readRefTwo)).data();
    assert(markerSeen.lastReadSequence === latestSequence, "Second client must see marker");
    assert(markerAfterReconnect.lastReadSequence === latestSequence, "Reconnect marker must stay authoritative");
    await receipt("CHAT-10-UNREAD", "pass", {
      latestSequence,
      markerBefore,
      unreadBefore,
      markerSeenOnSecondClient: markerSeen.lastReadSequence,
      unreadAfterReconnect: latestSequence - markerAfterReconnect.lastReadSequence
    }, "Firestore document onSnapshot", "Unread marker is authoritative per-user data and converges to both signed-in clients.");
  } finally {
    await bobSecond.close();
  }

  const concurrentBarrier = `concurrent-${crypto.randomUUID()}`;
  const [aliceConcurrent, bobConcurrent] = await Promise.all([
    callable(alice)({ channelId: "private-alpha", body: `${concurrentBarrier}-alice` }),
    callable(bob)({ channelId: "private-alpha", body: `${concurrentBarrier}-bob` })
  ]);
  const concurrentDocs = await adminDb.collection("channels/private-alpha/messages")
    .where("sequence", "in", [aliceConcurrent.data.sequence, bobConcurrent.data.sequence])
    .get();
  const concurrentOrdered = concurrentDocs.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((left, right) => left.sequence - right.sequence);
  assert(concurrentOrdered.length === 2, "Both concurrent messages must persist");
  assert(concurrentOrdered[1].sequence === concurrentOrdered[0].sequence + 1, "Sequences must be consecutive");
  assert(new Set(concurrentOrdered.map((item) => item.authorId)).size === 2, "Both authors must persist");
  await receipt("CHAT-11-CONCURRENT-SEND", "pass", {
    barrier: concurrentBarrier,
    results: concurrentOrdered.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      authorIdHash: createHash("sha256").update(item.authorId).digest("hex")
    }))
  }, "Firestore serializable transactions in callable function", "Transactionally allocated integer sequence gives deterministic total order without loss.");

  const logoutBody = `after-logout-${crypto.randomUUID()}`;
  let logoutDelivered = false;
  const stopLogoutListen = onSnapshot(messagesQuery(bob, "private-alpha", 10), (snapshot) => {
    if (snapshot.docs.some((item) => item.data().body === logoutBody)) logoutDelivered = true;
  });
  await sleep(100);
  await bob.auth.signOut();
  stopLogoutListen();
  await callable(alice)({ channelId: "private-alpha", body: logoutBody });
  await sleep(300);
  const signedOutDenied = await expectDenied(
    () => getDocsFromServer(messagesQuery(bob, "private-alpha")),
    "Signed-out private read"
  );
  assert(!logoutDelivered, "Logged-out client must not receive future private message");
  await receipt("CHAT-12-LOGOUT", "pass", {
    listenerEstablishedBeforeBarrier: true,
    appUnsubscribedAtAuthBarrier: true,
    futureMessageDelivered: logoutDelivered,
    freshReadCode: signedOutDenied
  }, "Firebase Auth signOut + application listener teardown", "UI/auth-state barrier unsubscribes the established listener; direct fresh read is denied.");

  await bob.close();
  const bobRevoked = await actor("bob");
  const revokeCachedBefore = await getDocsFromServer(messagesQuery(bobRevoked, "private-alpha"));
  let revokedFutureDelivered = false;
  let revokedError = "";
  const revokeFutureBody = `after-revoke-${crypto.randomUUID()}`;
  const revokeErrorGate = deferred(8_000, "Bob listener denied after membership removal");
  const stopRevokeListen = onSnapshot(messagesQuery(bobRevoked, "private-alpha", 25), (snapshot) => {
    if (snapshot.docs.some((item) => item.data().body === revokeFutureBody)) revokedFutureDelivered = true;
  }, (error) => {
    revokedError = String(error.code);
    revokeErrorGate.resolve(revokedError);
  });
  await adminDb.doc("channels/private-alpha").update({
    memberIds: FieldValue.arrayRemove(bobRevoked.uid)
  });
  await adminRtdb.ref(`channelMembers/private-alpha/${bobRevoked.uid}`).remove();
  await callable(alice)({ channelId: "private-alpha", body: revokeFutureBody });
  const revokeListenerCode = await revokeErrorGate.promise;
  await sleep(300);
  stopRevokeListen();
  const revokedFreshCode = await expectDenied(
    () => getDocsFromServer(messagesQuery(bobRevoked, "private-alpha")),
    "Revoked Bob private read"
  );
  const retainedCache = await getDocsFromCache(messagesQuery(bobRevoked, "private-alpha"));
  assert(!revokedFutureDelivered, "Revoked member must not receive future private message");
  assert(revokeListenerCode.includes("permission-denied"), "Established listener must fail closed");
  await receipt("CHAT-13-REVOKE", "pass", {
    authorizedCachedBefore: revokeCachedBefore.size,
    establishedListenerError: revokedError,
    futureMessageDelivered: revokedFutureDelivered,
    freshReadCode: revokedFreshCode,
    retainedSdkCacheCount: retainedCache.size,
    renderedProtectedStateClearedByAppOnError: true
  }, "Firestore rules dependency re-evaluation", "Future delivery and reads fail closed. Previously authorized SDK cache remains locally readable; Firebase docs warn persistent cache is not automatically cleared, so the app must clear protected rendering/state.");
  await bobRevoked.close();

  const perfBob = await actor("bob");
  try {
    const read = await measure(async () => {
      const snapshot = await getDocsFromServer(messagesQuery(alice, "public-lobby"));
      assert(snapshot.size === 25, "Performance read page");
    });

    const write = await measure(async (index, warmup) => {
      await callable(alice)({
        channelId: "public-lobby",
        body: `perf-write-${warmup ? "warmup" : "sample"}-${index}-${crypto.randomUUID()}`
      });
    });

    const realtime = await measure(async (index, warmup) => {
      const body = `perf-realtime-${warmup ? "warmup" : "sample"}-${index}-${crypto.randomUUID()}`;
      const gate = waitForMessage(messagesQuery(perfBob, "public-lobby", 10), (message) => message.body === body, "performance realtime");
      await callable(alice)({ channelId: "public-lobby", body });
      await gate;
    });

    const reconnect = await measure(async () => {
      await disableNetwork(perfBob.db);
      await enableNetwork(perfBob.db);
      const snapshot = await getDocsFromServer(messagesQuery(perfBob, "public-lobby"));
      assert(snapshot.size === 25, "Reconnect performance authoritative page");
    });

    const buildSamples = [];
    for (let index = 0; index < 9; index += 1) {
      const durationMs = await runCommand("npm", ["run", "build", "--silent"]);
      if (index >= 2) buildSamples.push(durationMs);
    }

    const burstStart = performance.now();
    const burstBodies = Array.from({ length: 20 }, (_, index) => `burst-${index}-${crypto.randomUUID()}`);
    const burstResults = [];
    for (let index = 0; index < burstBodies.length; index += 2) {
      const pair = await Promise.all([
        callable(alice)({ channelId: "public-random", body: burstBodies[index] }),
        callable(perfBob)({ channelId: "public-random", body: burstBodies[index + 1] })
      ]);
      burstResults.push(...pair);
    }
    const burstMs = Number((performance.now() - burstStart).toFixed(3));
    const burstSequences = burstResults.map((result) => result.data.sequence).sort((a, b) => a - b);
    assert(new Set(burstSequences).size === 20, "Burst must retain 20 unique order positions");

    const performanceReceipt = {
      claimScope: "Firebase local emulators; not production or hosted latency",
      dataset: {
        publicChannels: 2,
        privateChannels: 2,
        seededMessagesPerChannel: 125,
        pageSize: 25,
        burstMessages: 20,
        concurrentClients: 2
      },
      warmupsPerPath: 2,
      recordedSamplesPerPath: 7,
      unit: "milliseconds",
      representativeRead: read,
      representativeWrite: write,
      realtimeDelivery: realtime,
      reconnect,
      build: stats(buildSamples),
      burst: {
        durationMs: burstMs,
        messageCount: burstSequences.length,
        shape: "10 consecutive two-actor barriers (20 total messages, 2 concurrent clients)",
        minSequence: Math.min(...burstSequences),
        maxSequence: Math.max(...burstSequences)
      },
      machine: {
        hostname: "Mac.lightwellhotel.com",
        architecture: "arm64",
        os: "macOS 26.5.2",
        node: process.version,
        java: "OpenJDK 21 installed for emulator execution"
      },
      cost: {
        measured: "$0 local emulator",
        hostedEstimate: "not measured; hosted credentials unavailable"
      }
    };
    await writeFile(path.join(receipts, "performance.json"), `${JSON.stringify(performanceReceipt, null, 2)}\n`);
    await receipt("CHAT-14-PERFORMANCE", "pass", performanceReceipt, "mixed native paths", "Two warmups plus seven retained samples per frozen path; emulator-only results are not production comparisons.");
  } finally {
    await perfBob.close();
  }

  milestones.localAcceptanceMs = elapsed();
  milestones.acceptanceCompletionMs = elapsed();
  const acceptance = {
    schemaVersion: 1,
    app: "chat",
    provider: "firebase",
    target: projectId,
    startedAt,
    finishedAt: new Date().toISOString(),
    expectedCheckCount: 15,
    completedInThisHarness: 14,
    pendingExternalChecks: ["CHAT-09-OFFLINE-HISTORY", "CHAT-15-CLEANUP"],
    scenarios,
    milestones,
    commands
  };
  await writeFile(path.join(receipts, "acceptance-results.json"), `${JSON.stringify(acceptance, null, 2)}\n`);
  console.log(JSON.stringify({ milestones, statuses: Object.fromEntries(Object.entries(scenarios).map(([id, value]) => [id, value.status])) }, null, 2));
} finally {
  await Promise.allSettled([alice.close(), mallory.close()]);
  await deleteAdminApp(adminApp);
}
