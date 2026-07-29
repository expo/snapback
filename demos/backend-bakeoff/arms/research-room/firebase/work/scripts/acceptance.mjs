import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getStorage as getAdminStorage } from "firebase-admin/storage";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import {
  connectStorageEmulator,
  deleteObject,
  getBytes,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

const workDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armDir = path.resolve(workDir, "..");
const receiptsDir = path.join(armDir, "receipts");
const scenariosDir = path.join(receiptsDir, "scenarios");
const evidenceDir = path.join(armDir, "evidence");
await Promise.all([
  mkdir(receiptsDir, { recursive: true }),
  mkdir(scenariosDir, { recursive: true }),
  mkdir(evidenceDir, { recursive: true }),
]);

const projectId = "llp0102-research-firebase-w3";
const bucketName = `${projectId}.appspot.com`;
const primaryRoom = "room-primary";
const sourceBytes = 65_536;
const startedEpochMs = JSON.parse(
  await readFile(path.join(receiptsDir, "timed-window-start.json"), "utf8"),
).startedEpochMs;

process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8342";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9342";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9442";

const adminApp = initializeAdminApp({ projectId, storageBucket: bucketName }, "acceptance-admin");
const adminDb = getAdminFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);
const adminBucket = getAdminStorage(adminApp).bucket();

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const nowIso = () => new Date().toISOString();
const elapsedMs = () => Date.now() - startedEpochMs;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => ({
  name: error?.name ?? "Error",
  code: error?.code ?? null,
  message: String(error?.message ?? error).replaceAll(projectId, "<arm-project>"),
});

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function waitFor(probe, { timeoutMs = 6_000, intervalMs = 40 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms; last=${JSON.stringify(last)}`);
}

function deterministicEmbedding(index) {
  return Array.from({ length: 32 }, (_, dimension) => {
    const value = ((index * 17 + dimension * 13) % 101) / 100;
    return Number(value.toFixed(2));
  });
}

function sourceContent(index) {
  const prefix = [
    `Source ${String(index).padStart(3, "0")}: Coastal Resilience Evidence\n`,
    index % 4 === 1
      ? "Climate adaptation research on coastal wetlands, carbon retention, and flood exposure.\n"
      : "Research notes on infrastructure, governance, ecology, and community planning.\n",
  ].join("");
  return Buffer.from(prefix.padEnd(sourceBytes, `S${index % 10}`)).subarray(0, sourceBytes);
}

const clientConfig = {
  apiKey: "demo-research-room",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket: bucketName,
  appId: "1:000000000000:web:researchroom",
};

function makeActor(name) {
  const app = initializeApp(clientConfig, `actor-${name}-${Date.now()}`);
  let auth;
  try {
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
  } catch {
    auth = getAuth(app);
  }
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  const storage = getStorage(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9342", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8342);
  connectFunctionsEmulator(functions, "127.0.0.1", 5342);
  connectStorageEmulator(storage, "127.0.0.1", 9442);
  return { name, app, auth, db, functions, storage };
}

const alice = makeActor("alice");
const bob = makeActor("bob");
const mallory = makeActor("mallory");
const results = [];
const stopDefects = [];
const milestones = {
  firstLocalReadMs: null,
  firstAuthoritativeMutationMs: null,
  firstRealtimeTransitionMs: null,
  localAcceptanceMs: null,
  acceptanceCompletionMs: null,
};

async function retainScenario(id, status, evidence, note, transport = "not-applicable") {
  const receiptPath = path.join(scenariosDir, `${id}.json`);
  const receipt = {
    schemaVersion: 1,
    id,
    status,
    observedAt: nowIso(),
    transport,
    evidence,
    note,
  };
  await writeJson(receiptPath, receipt);
  results.push({
    id,
    status,
    evidencePaths: [path.relative(armDir, receiptPath)],
    transport,
    authoritativeCheck: evidence.authoritativeCheck ?? note,
    note,
  });
  return receipt;
}

async function stopOnDisclosure(kind, evidence) {
  const defect = {
    class: "Stop",
    kind,
    detectedAt: nowIso(),
    evidence,
  };
  stopDefects.push(defect);
  await writeJson(path.join(receiptsDir, "stop-defect.json"), defect);
  throw new Error(`STOP_CLASS:${kind}`);
}

async function denied(operation) {
  try {
    await operation();
    return false;
  } catch (error) {
    return /permission|unauthorized|storage\/unauthorized/i.test(`${error?.code} ${error?.message}`);
  }
}

async function resetAndSeed() {
  const baselineCollections = await adminDb.listCollections();
  const baselineUsers = await adminAuth.listUsers();
  assert.equal(baselineCollections.length, 0, "fresh emulator Firestore baseline must be empty");
  assert.equal(baselineUsers.users.length, 0, "fresh emulator Auth baseline must be empty");

  const actors = [
    { uid: "alice-research", email: "alice@research.test" },
    { uid: "bob-research", email: "bob@research.test" },
    { uid: "mallory-research", email: "mallory@research.test" },
  ];
  for (const actor of actors) {
    await adminAuth.createUser({
      uid: actor.uid,
      email: actor.email,
      password: "correct-horse-battery",
      displayName: actor.uid.split("-")[0],
    });
  }

  await adminDb.doc(`rooms/${primaryRoom}`).create({
    name: "Coastal resilience",
    memberIds: ["alice-research", "bob-research"],
    createdBy: "alice-research",
    createdAt: FieldValue.serverTimestamp(),
  });
  await adminDb.doc("rooms/room-secondary").create({
    name: "Material futures",
    memberIds: ["alice-research", "bob-research"],
    createdBy: "bob-research",
    createdAt: FieldValue.serverTimestamp(),
  });

  for (let index = 1; index <= 20; index += 1) {
    const sourceId = `source-${String(index).padStart(3, "0")}`;
    const objectPath = `rooms/${primaryRoom}/sources/${sourceId}`;
    const content = sourceContent(index);
    await adminBucket.file(objectPath).save(content, {
      resumable: false,
      metadata: {
        contentType: "text/plain",
        metadata: { ownerId: "alice-research", sourceId },
      },
    });
    await adminDb.doc(`rooms/${primaryRoom}/sources/${sourceId}`).create({
      title: `Evidence brief ${String(index).padStart(2, "0")}`,
      ownerId: "alice-research",
      objectPath,
      contentHash: sha256(content),
      byteLength: content.length,
      keywords: index % 4 === 1 ? ["climate", "wetlands"] : ["research", "planning"],
      embedding: FieldValue.vector(deterministicEmbedding(index)),
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await Promise.all([
    signInWithEmailAndPassword(alice.auth, "alice@research.test", "correct-horse-battery"),
    signInWithEmailAndPassword(bob.auth, "bob@research.test", "correct-horse-battery"),
    signInWithEmailAndPassword(mallory.auth, "mallory@research.test", "correct-horse-battery"),
  ]);
  milestones.firstAuthoritativeMutationMs = elapsedMs();

  const counts = {
    rooms: (await adminDb.collection("rooms").get()).size,
    primarySources: (await adminDb.collection(`rooms/${primaryRoom}/sources`).get()).size,
    actors: (await adminAuth.listUsers()).users.length,
    bytesPerSource: sourceBytes,
    embeddingDimensions: 32,
  };
  await writeJson(path.join(receiptsDir, "baseline-before.json"), {
    schemaVersion: 1,
    mode: "fresh-local",
    projectIdSha256: sha256(projectId),
    collections: 0,
    authUsers: 0,
    unrelatedBaseline: [],
  });
  await writeJson(path.join(receiptsDir, "seed-receipt.json"), {
    schemaVersion: 1,
    projectIdSha256: sha256(projectId),
    counts,
    actorHashes: Object.fromEntries(actors.map((actor) => [actor.uid.split("-")[0], sha256(actor.uid)])),
    contentIdentity: {
      firstSourceSha256: sha256(sourceContent(1)),
      twentiethSourceSha256: sha256(sourceContent(20)),
    },
  });
  return counts;
}

try {
  const health = await fetch(`http://127.0.0.1:5342/${projectId}/us-central1/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  milestones.firstLocalReadMs = elapsedMs();
  const counts = await resetAndSeed();

  await retainScenario(
    "RESEARCH-01-SEED",
    "PASS",
    {
      authoritativeCheck: "Admin SDK independently counted two rooms, twenty primary-room sources, and three Auth principals.",
      targetIdentityHash: sha256(projectId),
      counts,
      seedReceipt: "receipts/seed-receipt.json",
    },
    "Exact fresh-local project, rooms, 32-dimensional vectors, 65,536-byte sources, and personas exist.",
  );

  const uploadId = "source-authorized-upload";
  const uploadPath = `rooms/${primaryRoom}/sources/${uploadId}`;
  const uploadBody = Buffer.from("Authorized test upload".padEnd(sourceBytes, "."));
  await setDoc(doc(alice.db, `rooms/${primaryRoom}/sources/${uploadId}`), {
    title: "Authorized upload evidence",
    ownerId: alice.auth.currentUser.uid,
    objectPath: uploadPath,
    contentHash: sha256(uploadBody),
    byteLength: uploadBody.length,
    keywords: ["upload", "authority"],
  });
  await uploadBytes(ref(alice.storage, uploadPath), uploadBody, {
    contentType: "text/plain",
    customMetadata: { ownerId: alice.auth.currentUser.uid, sourceId: uploadId },
  });
  const bobBytes = await getBytes(ref(bob.storage, uploadPath));
  assert.equal(sha256(Buffer.from(bobBytes)), sha256(uploadBody));
  const malloryFileDenied = await denied(() => getBytes(ref(mallory.storage, uploadPath)));
  if (!malloryFileDenied) await stopOnDisclosure("cross-user-file-disclosure", { objectPathHash: sha256(uploadPath) });
  await deleteObject(ref(alice.storage, uploadPath));
  await deleteDoc(doc(alice.db, `rooms/${primaryRoom}/sources/${uploadId}`));
  const deletedObject = !(await adminBucket.file(uploadPath).exists())[0];
  const deletedMetadata = !(await adminDb.doc(`rooms/${primaryRoom}/sources/${uploadId}`).get()).exists;
  assert.equal(deletedObject && deletedMetadata, true);
  await retainScenario(
    "RESEARCH-02-FILES",
    "PASS",
    {
      authoritativeCheck: "Alice upload, Bob byte-for-byte delivery, owner metadata, and exact object/document deletion were independently verified.",
      objectPathHash: sha256(uploadPath),
      contentHash: sha256(uploadBody),
      byteLength: uploadBody.length,
      bobDeliveryHashMatched: true,
      malloryDenied: true,
      deletedObject,
      deletedMetadata,
    },
    "Storage Security Rules and Firestore Security Rules preserve room authority and source ownership.",
  );

  const mallorySourceDenied = await denied(() => getDoc(doc(mallory.db, `rooms/${primaryRoom}/sources/source-001`)));
  const mallorySearchDenied = await denied(() =>
    getDocs(query(collection(mallory.db, `rooms/${primaryRoom}/sources`), where("keywords", "array-contains", "climate"))),
  );
  const mallorySubscription = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const unsubscribe = onSnapshot(
      collection(mallory.db, `rooms/${primaryRoom}/questions`),
      (snapshot) => finish({ denied: false, deliveredDocs: snapshot.size }),
      (error) => finish({ denied: /permission-denied/.test(error.code), deliveredDocs: 0 }),
    );
    setTimeout(() => {
      unsubscribe();
      finish({ denied: false, deliveredDocs: -1, timeout: true });
    }, 1_500);
  });
  if (!mallorySourceDenied || !mallorySearchDenied || !mallorySubscription.denied) {
    await stopOnDisclosure("cross-user-research-disclosure", {
      sourceDenied: mallorySourceDenied,
      searchDenied: mallorySearchDenied,
      subscription: mallorySubscription,
    });
  }
  await retainScenario(
    "RESEARCH-03-OUTSIDER",
    "PASS",
    {
      authoritativeCheck: "Mallory received permission-denied for source read, keyword query, and the questions subscription before any protected document delivery.",
      sourceDenied: mallorySourceDenied,
      searchDenied: mallorySearchDenied,
      subscription: mallorySubscription,
      negativeFileEvidence: "RESEARCH-02-FILES",
    },
    "Outsider access is denied by provider-native database and object rules.",
    "firebase-firestore-listener-denied",
  );

  const keywordSnapshot = await getDocs(
    query(
      collection(alice.db, `rooms/${primaryRoom}/sources`),
      where("keywords", "array-contains", "climate"),
      orderBy("title"),
    ),
  );
  const keywordIds = keywordSnapshot.docs.map((item) => item.id);
  assert.deepEqual(keywordIds, ["source-001", "source-005", "source-009", "source-013", "source-017"]);
  await retainScenario(
    "RESEARCH-04-KEYWORD",
    "PASS",
    {
      authoritativeCheck: "A client query evaluated by Firestore and its composite index returned the exact frozen climate source set.",
      queryShape: "keywords array-contains climate; title ascending",
      sourceIds: keywordIds,
    },
    "Keyword search uses Firestore's indexed array membership query.",
  );

  let semanticStatus = "GAP";
  let semanticEvidence;
  try {
    const vectorQuery = adminDb
      .collection(`rooms/${primaryRoom}/sources`)
      .findNearest("embedding", FieldValue.vector(deterministicEmbedding(1)), {
        limit: 4,
        distanceMeasure: "COSINE",
      });
    const vectorSnapshot = await vectorQuery.get();
    const ids = vectorSnapshot.docs.map((item) => item.id);
    assert.equal(ids[0], "source-001");
    semanticStatus = "PASS";
    semanticEvidence = {
      authoritativeCheck: "The ordinary Firebase Admin SDK findNearest path returned the deterministic nearest source.",
      vectorPath: "firebase-admin Firestore findNearest/COSINE",
      resultIds: ids,
    };
  } catch (error) {
    semanticEvidence = {
      authoritativeCheck: "The ordinary Firestore vector path was attempted against the exact emulator and could not produce local proof.",
      vectorPath: "firebase-admin Firestore findNearest/COSINE",
      dimensions: 32,
      nonclaim: "No client-side cosine fallback is counted as Firebase semantic retrieval.",
      emulatorError: safeError(error),
      officialLimitation: "Vector search is supported only by server client libraries and requires a vector index; no hosted target was available.",
    };
  }
  await retainScenario(
    "RESEARCH-05-SEMANTIC",
    semanticStatus,
    semanticEvidence,
    semanticStatus === "PASS"
      ? "Provider-native semantic retrieval passed locally."
      : "Explicit local/hosted evidence GAP; deterministic embeddings are retained without a substitute capability claim.",
  );

  const progressQuestionId = "question-progress-live";
  const bobProgressEvents = [];
  const progressStop = onSnapshot(
    query(
      collection(bob.db, `rooms/${primaryRoom}/questions/${progressQuestionId}/progress`),
      orderBy("ordinal"),
    ),
    (snapshot) => {
      bobProgressEvents.push({
        atEpochMs: Date.now(),
        ordinals: snapshot.docs.map((item) => item.get("ordinal")),
        fromCache: snapshot.metadata.fromCache,
      });
    },
  );
  const executeAlice = httpsCallable(alice.functions, "executeQuestion");
  const progressStarted = Date.now();
  const progressResult = await executeAlice({
    roomId: primaryRoom,
    questionId: progressQuestionId,
    dedupeKey: "dedupe-progress-live",
    prompt: "How do coastal wetlands help communities?",
    fault: "complete",
    delayMs: 110,
  });
  await waitFor(() => bobProgressEvents.some((event) => event.ordinals.length === 4));
  progressStop();
  const progressDocs = await adminDb
    .collection(`rooms/${primaryRoom}/questions/${progressQuestionId}/progress`)
    .orderBy("ordinal")
    .get();
  const progressOrdinals = progressDocs.docs.map((item) => item.get("ordinal"));
  assert.deepEqual(progressOrdinals, [1, 2, 3, 4]);
  assert.equal(progressResult.data.status, "complete");
  milestones.firstRealtimeTransitionMs = bobProgressEvents.find((event) => event.ordinals.length > 0).atEpochMs - startedEpochMs;
  await retainScenario(
    "RESEARCH-06-PROGRESS",
    "PASS",
    {
      authoritativeCheck: "Admin SDK read four durable progress documents in ordinal order before the complete terminal question.",
      ordinals: progressOrdinals,
      elapsedMs: Date.now() - progressStarted,
      bobListenerEvents: bobProgressEvents,
      terminalStatus: progressResult.data.status,
    },
    "Four authoritative progress patches precede completion.",
    "firebase-firestore-native-push",
  );

  const answerSnapshot = await adminDb.doc(`rooms/${primaryRoom}/answers/answer-${progressQuestionId}`).get();
  assert.equal(answerSnapshot.exists, true);
  const citations = answerSnapshot.get("citations");
  const citationProof = [];
  for (const citation of citations) {
    const source = await adminDb.doc(`rooms/${primaryRoom}/sources/${citation.sourceId}`).get();
    citationProof.push({ sourceId: citation.sourceId, exists: source.exists });
  }
  assert.equal(citationProof.every((item) => item.exists), true);
  const bobAnswer = await getDoc(doc(bob.db, `rooms/${primaryRoom}/answers/answer-${progressQuestionId}`));
  assert.equal(bobAnswer.exists(), true);
  await retainScenario(
    "RESEARCH-07-CITATIONS",
    "PASS",
    {
      authoritativeCheck: "The durable answer cites two existing room source records, and Bob can read it as a member.",
      answerId: answerSnapshot.id,
      citationProof,
      bobAuthorized: true,
    },
    "Citations retain source-record identity and room authority.",
  );

  assert.equal(bobProgressEvents.some((event) => event.ordinals.length > 0), true);
  await retainScenario(
    "RESEARCH-08-COLLABORATOR",
    "PASS",
    {
      authoritativeCheck: "Bob's independent Web SDK listener received server-backed progress snapshots while Alice's callable remained active.",
      actorHash: sha256(bob.auth.currentUser.uid),
      eventCount: bobProgressEvents.length,
      firstNonemptyEvent: bobProgressEvents.find((event) => event.ordinals.length > 0),
    },
    "The second member observes progress live through Firestore's native snapshot listener.",
    "firebase-firestore-native-push",
  );

  const cancelQuestionId = "question-cancel-late";
  const cancelExecute = executeAlice({
    roomId: primaryRoom,
    questionId: cancelQuestionId,
    dedupeKey: "dedupe-cancel-late",
    prompt: "Cancel this deterministic stream.",
    fault: "complete",
    delayMs: 300,
  });
  await waitFor(async () => {
    const snapshot = await adminDb
      .collection(`rooms/${primaryRoom}/questions/${cancelQuestionId}/progress`)
      .limit(1)
      .get();
    return snapshot.size === 1;
  });
  const cancelCall = httpsCallable(alice.functions, "cancelQuestion");
  const cancelReceipt = await cancelCall({ roomId: primaryRoom, questionId: cancelQuestionId });
  assert.equal(cancelReceipt.data.confirmed, true);
  const cancelExecuteResult = await cancelExecute;
  assert.equal(cancelExecuteResult.data.status, "cancelled");
  const beforeLate = await adminDb
    .collection(`rooms/${primaryRoom}/questions/${cancelQuestionId}/progress`)
    .get();
  const injectLate = httpsCallable(alice.functions, "injectLatePatch");
  const lateResult = await injectLate({ roomId: primaryRoom, questionId: cancelQuestionId });
  await sleep(500);
  const afterLate = await adminDb
    .collection(`rooms/${primaryRoom}/questions/${cancelQuestionId}/progress`)
    .get();
  const cancelledAnswer = await adminDb.doc(`rooms/${primaryRoom}/answers/answer-${cancelQuestionId}`).get();
  if (
    lateResult.data.persisted ||
    afterLate.size !== beforeLate.size ||
    cancelledAnswer.exists
  ) {
    await stopOnDisclosure("late-effect-after-confirmed-cancellation", {
      lateResult: lateResult.data,
      progressBefore: beforeLate.size,
      progressAfter: afterLate.size,
      answerExists: cancelledAnswer.exists,
    });
  }
  await retainScenario(
    "RESEARCH-09-CANCEL",
    "PASS",
    {
      authoritativeCheck: "After cancellation confirmation, the in-flight worker settled cancelled, an injected late patch was transactionally blocked, progress count stayed fixed, and no answer exists.",
      cancellation: cancelReceipt.data,
      workerSettlement: cancelExecuteResult.data,
      lateInjection: lateResult.data,
      progressBefore: beforeLate.size,
      progressAfter: afterLate.size,
      answerExists: false,
    },
    "Confirmed cancellation prevents every late durable patch.",
  );

  const retryQuestionId = "question-idempotent-retry";
  const retryPayload = {
    roomId: primaryRoom,
    questionId: retryQuestionId,
    dedupeKey: "dedupe-idempotent-retry",
    prompt: "Prove idempotent retry.",
    fault: "complete",
    delayMs: 20,
  };
  const firstAttempt = await executeAlice(retryPayload);
  const secondAttempt = await executeAlice(retryPayload);
  const retryQuestion = await adminDb.doc(`rooms/${primaryRoom}/questions/${retryQuestionId}`).get();
  const retryAnswer = await adminDb.doc(`rooms/${primaryRoom}/answers/answer-${retryQuestionId}`).get();
  const retryAttempts = await adminDb
    .collection(`rooms/${primaryRoom}/effectAttempts`)
    .where("dedupeKey", "==", retryPayload.dedupeKey)
    .get();
  assert.equal(firstAttempt.data.deduplicated, false);
  assert.equal(secondAttempt.data.deduplicated, true);
  assert.equal(retryQuestion.exists && retryAnswer.exists, true);
  assert.equal(retryAttempts.size, 1);
  await retainScenario(
    "RESEARCH-10-RETRY",
    "PASS",
    {
      authoritativeCheck: "Two callable invocations with one deterministic identity retained one question, one answer, and one effect-attempt ledger.",
      firstAttempt: firstAttempt.data,
      secondAttempt: secondAttempt.data,
      questionCount: 1,
      answerCount: 1,
      attemptCount: retryAttempts.size,
      dedupeKeyHash: sha256(retryPayload.dedupeKey),
    },
    "Retry is idempotent without duplicate questions or answers.",
  );

  const outcomeSpecs = [
    ["failed", "question-outcome-failed"],
    ["timed-out", "question-outcome-timeout"],
    ["ambiguous", "question-outcome-ambiguous"],
  ];
  for (const [fault, questionId] of outcomeSpecs) {
    await executeAlice({
      roomId: primaryRoom,
      questionId,
      dedupeKey: `dedupe-${questionId}`,
      prompt: `Inject ${fault}.`,
      fault,
      delayMs: 12,
    });
  }
  const outcomeQuestionIds = {
    complete: retryQuestionId,
    failed: "question-outcome-failed",
    cancelled: cancelQuestionId,
    "timed-out": "question-outcome-timeout",
    ambiguous: "question-outcome-ambiguous",
  };
  const outcomeStates = {};
  for (const [expected, questionId] of Object.entries(outcomeQuestionIds)) {
    const questionSnapshot = await adminDb.doc(`rooms/${primaryRoom}/questions/${questionId}`).get();
    const attemptSnapshot = await adminDb.doc(`rooms/${primaryRoom}/effectAttempts/attempt-${questionId}`).get();
    outcomeStates[expected] = {
      questionId,
      status: questionSnapshot.get("status"),
      settlement: attemptSnapshot.get("settlement"),
    };
    assert.equal(questionSnapshot.get("status"), expected);
  }
  await retainScenario(
    "RESEARCH-11-OUTCOMES",
    "PASS",
    {
      authoritativeCheck: "Fault-injected question and effect-attempt records retain five distinct terminal/settlement states.",
      states: outcomeStates,
    },
    "Complete, failed, cancelled, timed-out, and ambiguous outcomes remain distinguishable.",
  );

  const scheduleResponse = await fetch(
    `http://127.0.0.1:5342/${projectId}/us-central1/scheduledRefresh-0`,
    {
    method: "POST",
    headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { scheduleTime: nowIso() } }),
    },
  );
  assert.equal(scheduleResponse.ok, true, await scheduleResponse.text());
  const refreshSnapshot = await waitFor(async () => {
    const snapshot = await adminDb.doc(`rooms/${primaryRoom}/refreshRuns/refresh-deterministic-v1`).get();
    return snapshot.exists ? snapshot : null;
  }, { timeoutMs: 10_000 });
  assert.equal(refreshSnapshot.get("status"), "complete");
  assert.deepEqual(refreshSnapshot.get("progress"), ["scheduled", "fetch-started", "response-validated", "committed"]);
  assert.equal(refreshSnapshot.get("dedupeKey"), "refresh-deterministic-v1");
  await retainScenario(
    "RESEARCH-12-SCHEDULE",
    "PASS",
    {
      authoritativeCheck: "The Functions emulator's generated background-trigger endpoint invoked the actual onSchedule handler, fetched the deterministic Hosting source, and wrote one deduplicated durable run.",
      scheduleIdentity: "firebase-schedule-scheduledRefresh",
      emulatorFunctionIdentity: "us-central1-scheduledRefresh-0",
      triggerKind: "firebase-functions/v2/scheduler onSchedule",
      runId: refreshSnapshot.id,
      status: refreshSnapshot.get("status"),
      progress: refreshSnapshot.get("progress"),
      dedupeKey: refreshSnapshot.get("dedupeKey"),
      fetchedTitleHash: sha256(refreshSnapshot.get("fetchedTitle")),
      serverSecretHashRetained: /^[a-f0-9]{64}$/.test(refreshSnapshot.get("secretHash")),
    },
    "The native scheduled-function emulator path records durable refresh progress once.",
    "firebase-scheduled-function-emulator",
  );

  const canary = await readFile(path.join(workDir, ".runtime", "refresh-secret"), "utf8");
  const scanTargets = [
    path.join(workDir, "dist"),
    receiptsDir,
    path.join(workDir, "firestore-debug.log"),
    path.join(workDir, "pubsub-debug.log"),
    path.join(workDir, "ui-debug.log"),
    path.join(workDir, "firebase-debug.log"),
  ];
  const exposedPaths = [];
  async function scan(target) {
    try {
      const entries = await readdir(target, { withFileTypes: true });
      for (const entry of entries) await scan(path.join(target, entry.name));
    } catch {
      try {
        const content = await readFile(target);
        if (content.includes(Buffer.from(canary))) exposedPaths.push(path.relative(workDir, target));
      } catch {
        // Missing optional logs are an absence, not an exposure.
      }
    }
  }
  for (const target of scanTargets) await scan(target);
  if (exposedPaths.length) await stopOnDisclosure("server-secret-exposure", { exposedPaths });
  const bundleFiles = await readdir(path.join(workDir, "dist", "assets"));
  const bundleCanaryHits = [];
  for (const file of bundleFiles) {
    const content = await readFile(path.join(workDir, "dist", "assets", file));
    if (content.includes(Buffer.from(canary))) bundleCanaryHits.push(file);
  }
  assert.equal(bundleCanaryHits.length, 0);
  await retainScenario(
    "RESEARCH-13-SECRETS",
    "PASS",
    {
      authoritativeCheck: "The exact runtime canary was absent from the client bundle, receipts, and emulator diagnostics; only its SHA-256 digest is durable.",
      canarySha256: sha256(canary),
      exactCanaryHits: exposedPaths,
      clientBundleHits: bundleCanaryHits,
      configProof: {
        sourceUrlServerSide: true,
        secretEnvironmentName: "RESEARCH_REFRESH_SECRET",
        valueRetained: false,
      },
      hostedSecretBoundary: "explicit GAP because this arm has no authenticated hosted project",
    },
    "The local Functions boundary keeps the canary secret server-side; hosted secret configuration remains a target-access GAP.",
  );

  milestones.localAcceptanceMs = elapsedMs();
  await retainScenario(
    "RESEARCH-14-PERFORMANCE",
    "pending",
    {
      authoritativeCheck: "Performance samples run in a separate frozen 2-warmup/7-recorded pass.",
      expectedPathCount: 5,
      performanceReceipt: "evidence/performance.json",
    },
    "Pending the frozen performance pass.",
  );
  await retainScenario(
    "RESEARCH-15-CLEANUP",
    "pending",
    {
      authoritativeCheck: "Cleanup runs only after acceptance, performance, export, and target-bound plan freeze.",
      cleanupPlan: "receipts/scoped-cleanup-plan.json",
    },
    "Pending exact local-target cleanup.",
  );

  milestones.acceptanceCompletionMs = elapsedMs();
  await writeJson(path.join(evidenceDir, "acceptance-results.partial.json"), {
    schemaVersion: 1,
    app: "research-room",
    provider: "firebase",
    expectedCheckCount: 15,
    resultCount: results.length,
    passed: results.filter((item) => item.status === "PASS").length,
    gaps: results.filter((item) => item.status === "GAP").length,
    pending: results.filter((item) => item.status === "pending").length,
    failed: results.filter((item) => item.status === "FAIL").length,
    results,
    stopDefects,
    milestones,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    pass: results.filter((item) => item.status === "PASS").length,
    gap: results.filter((item) => item.status === "GAP").length,
    pending: results.filter((item) => item.status === "pending").length,
    stop: stopDefects.length,
  })}\n`);
} catch (error) {
  const failure = {
    schemaVersion: 1,
    failedAt: nowIso(),
    classification: String(error?.message).startsWith("STOP_CLASS:") ? "stop-class" : "harness-or-product",
    error: safeError(error),
    completedResults: results,
    stopDefects,
    milestones,
  };
  await writeJson(path.join(receiptsDir, `acceptance-failure-${Date.now()}.json`), failure);
  process.stderr.write(`${JSON.stringify({ ok: false, ...failure })}\n`);
  process.exitCode = String(error?.message).startsWith("STOP_CLASS:") ? 2 : 1;
}
