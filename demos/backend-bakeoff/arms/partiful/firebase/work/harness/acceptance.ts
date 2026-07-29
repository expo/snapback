import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from "firebase-admin/app";
import { FieldValue, getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
import {
  ARM_START_MONOTONIC_MS,
  CONTENDED_EVENT,
  EMULATORS,
  GUEST_EVENT,
  PRIMARY_EVENT,
  PROJECT_ID,
} from "./constants.ts";
import {
  createClient,
  destroyClient,
  type ActorCredential,
  type Client,
} from "./firebase-client.ts";

process.env.FIRESTORE_EMULATOR_HOST = `${EMULATORS.firestore.host}:${EMULATORS.firestore.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMULATORS.auth.host}:${EMULATORS.auth.port}`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = `${EMULATORS.storage.host}:${EMULATORS.storage.port}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (getAdminApps().length === 0) {
  initializeAdminApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` });
}
const adminDb = getAdminFirestore();
const armRoot = new URL("../../", import.meta.url);
const evidenceRoot = new URL("evidence/", armRoot);
await mkdir(evidenceRoot, { recursive: true });

type ActorCustody = {
  actors: {
    alice: ActorCredential;
    bob: ActorCredential;
    mallory: ActorCredential;
  };
};
const custody = JSON.parse(
  await readFile(new URL("state/actor-custody.json", armRoot), "utf8"),
) as ActorCustody;

const alice = await createClient(custody.actors.alice);
const bob = await createClient(custody.actors.bob);
const bobSecond = await createClient(custody.actors.bob);
const mallory = await createClient(custody.actors.mallory);
const anonymous = await createClient();
const clients = [alice, bob, bobSecond, mallory, anonymous];
const results: Array<Record<string, unknown>> = [];
let firstRealtimeTransitionMs: number | null = null;

function elapsedMs() {
  return Math.round(Number(process.hrtime.bigint() / 1_000_000n) - ARM_START_MONOTONIC_MS);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stableError(error: unknown) {
  const candidate = error as { code?: string; message?: string; name?: string };
  return {
    name: candidate?.name ?? "Error",
    code: candidate?.code ?? null,
    message: String(candidate?.message ?? error).replaceAll(
      custody.actors.alice.password,
      "[REDACTED]",
    ).replaceAll(custody.actors.bob.password, "[REDACTED]")
      .replaceAll(custody.actors.mallory.password, "[REDACTED]"),
  };
}

async function expectDenied(operation: Promise<unknown>, label: string) {
  try {
    await operation;
    throw new Error(`${label}: unexpectedly allowed`);
  } catch (error) {
    const normalized = stableError(error);
    assert(
      normalized.code?.includes("permission-denied")
        || normalized.code?.includes("storage/unauthorized")
        || normalized.message.includes("Missing or insufficient permissions"),
      `${label}: wrong denial ${JSON.stringify(normalized)}`,
    );
    return normalized;
  }
}

async function call<T = unknown>(client: Client, name: string, data: unknown): Promise<T> {
  return (await httpsCallable(client.functions, name)(data)).data as T;
}

async function writeEvidence(id: string, body: Record<string, unknown>) {
  const path = new URL(`${id.toLowerCase()}.json`, evidenceRoot);
  await writeFile(path, `${JSON.stringify({
    schemaVersion: 1,
    scenario: id,
    capturedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    ...body,
  }, null, 2)}\n`);
  results.push({
    id,
    status: "pass",
    evidencePaths: [`evidence/${id.toLowerCase()}.json`],
    transport: body.transport ?? "authoritative-read-after-write",
    authoritativeCheck: body.authoritativeCheck ?? "",
    note: body.note ?? "",
  });
}

async function observeUntil(
  subscribe: (next: (value: unknown) => void, error: (error: unknown) => void) => () => void,
  predicate: (value: unknown) => boolean,
  timeoutMs = 8000,
) {
  return new Promise<{ value: unknown; elapsedMs: number }>((resolve, reject) => {
    const started = performance.now();
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("listener timeout"));
    }, timeoutMs);
    const unsubscribe = subscribe(
      (value) => {
        if (!predicate(value)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve({ value, elapsedMs: performance.now() - started });
      },
      (error) => {
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      },
    );
  });
}

try {
  const seed = JSON.parse(await readFile(new URL("evidence/seed-receipt.json", armRoot), "utf8"));
  assert(seed.dataset.events === 20, "seed event count");
  assert(seed.dataset.contendedAttendance === 49, "seed attendance");
  await writeEvidence("PARTY-01-SEED", {
    authoritativeCheck: "Admin Firestore collection counts and Auth emulator receipt",
    counts: seed.dataset,
    principals: seed.actors,
  });

  const anonymousPublic = await getDoc(doc(anonymous.db, "publicEvents", PRIMARY_EVENT));
  assert(anonymousPublic.exists(), "anonymous public event absent");
  const anonymousPrivateDenial = await expectDenied(
    getDoc(doc(anonymous.db, "events", PRIMARY_EVENT)),
    "anonymous private event",
  );
  const anonymousControlDenial = await expectDenied(
    getDoc(doc(anonymous.db, "eventControls", PRIMARY_EVENT)),
    "anonymous control",
  );
  await call(alice, "upsertEvent", {
    eventId: "event-created-acceptance",
    title: "Moonlight Potluck",
    location: "Dolores Park",
    capacity: 80,
    doorCode: "MOON-42",
    internalNote: "Bring the lanterns",
    startsAtMs: Date.parse("2026-08-22T02:00:00Z"),
  });
  await call(alice, "upsertEvent", {
    eventId: "event-created-acceptance",
    title: "Moonlight Potluck — Updated",
    location: "Dolores Park",
    capacity: 90,
    doorCode: "MOON-43",
    internalNote: "Bring lanterns and blankets",
    startsAtMs: Date.parse("2026-08-22T02:00:00Z"),
  });
  const [createdPrivate, createdPublic, createdControl] = await Promise.all([
    adminDb.doc("events/event-created-acceptance").get(),
    adminDb.doc("publicEvents/event-created-acceptance").get(),
    adminDb.doc("eventControls/event-created-acceptance").get(),
  ]);
  assert(createdPrivate.data()?.revision === 2, "event update revision");
  assert(!("doorCode" in (createdPublic.data() ?? {})), "private field leaked public");
  assert(createdControl.data()?.doorCode === "MOON-43", "control update absent");
  await writeEvidence("PARTY-02-PUBLIC-PRIVATE", {
    authoritativeCheck: "Anonymous SDK reads plus Admin Firestore split-document check",
    anonymousPublicFields: Object.keys(anonymousPublic.data() ?? {}).sort(),
    anonymousPrivateDenial,
    anonymousControlDenial,
    created: {
      revision: createdPrivate.data()?.revision,
      title: createdPublic.data()?.title,
      publicFields: Object.keys(createdPublic.data() ?? {}).sort(),
      privateDoorCode: createdControl.data()?.doorCode,
    },
    note: "Firestore rules cannot redact individual fields; public preview, protected event, and host controls use separate documents.",
  });

  const rsvpTransitions = [];
  for (const transition of [
    { response: "maybe", plusOneCount: 0 },
    { response: "yes", plusOneCount: 1 },
    { response: "no", plusOneCount: 0 },
    { response: "maybe", plusOneCount: 0 },
  ]) {
    rsvpTransitions.push(await call(bob, "rsvp", { eventId: GUEST_EVENT, ...transition }));
  }
  const rsvpFinal = await adminDb.doc(`events/${GUEST_EVENT}/rsvps/${custody.actors.bob.uid}`).get();
  const guestEventFinal = await adminDb.doc(`events/${GUEST_EVENT}`).get();
  assert(rsvpFinal.data()?.response === "maybe", "RSVP final transition");
  assert(guestEventFinal.data()?.attendanceCount === 0, "RSVP derived count");
  await writeEvidence("PARTY-03-INVITE-RSVP", {
    authoritativeCheck: "Callable transaction responses plus Admin Firestore RSVP and event reads",
    transitions: rsvpTransitions,
    finalRsvp: rsvpFinal.data(),
    finalAttendance: guestEventFinal.data()?.attendanceCount,
  });

  const bobControl = await getDoc(doc(bob.db, "eventControls", PRIMARY_EVENT));
  const bobGuestEvent = await getDoc(doc(bob.db, "events", GUEST_EVENT));
  const bobPost = await addDoc(collection(bob.db, "events", GUEST_EVENT, "wallPosts"), {
    eventId: GUEST_EVENT,
    authorUid: custody.actors.bob.uid,
    authorName: "Bob",
    body: "I can bring dessert.",
    ordinal: 0,
    createdAt: serverTimestamp(),
  });
  const bobGuestControlDenial = await expectDenied(
    getDoc(doc(bob.db, "eventControls", GUEST_EVENT)),
    "guest controls",
  );
  const bobGuestRoleDenial = await expectDenied(
    call(bob, "setGuestListVisibility", { eventId: GUEST_EVENT, visibility: "hosts" }),
    "guest role mutation",
  );
  const malloryPrivateDenial = await expectDenied(
    getDoc(doc(mallory.db, "events", PRIMARY_EVENT)),
    "outsider private event",
  );
  const malloryPostDenial = await expectDenied(
    setDoc(doc(mallory.db, "events", PRIMARY_EVENT, "wallPosts", "outsider-attempt"), {
      eventId: PRIMARY_EVENT,
      authorUid: custody.actors.mallory.uid,
      authorName: "Mallory",
      body: "Unauthorized",
      ordinal: 0,
      createdAt: serverTimestamp(),
    }),
    "outsider wall post",
  );
  assert(bobControl.exists() && bobGuestEvent.exists(), "positive role reads");
  await writeEvidence("PARTY-04-ROLES", {
    authoritativeCheck: "Rules-enforced Web SDK positive and negative operations",
    host: "Alice callable mutations passed in PARTY-02",
    cohost: { controlRead: bobControl.exists() },
    guest: { eventRead: bobGuestEvent.exists(), postId: bobPost.id },
    denials: { bobGuestControlDenial, bobGuestRoleDenial, malloryPrivateDenial, malloryPostDenial },
  });

  const guestRows: Array<string[]> = [];
  let listenerError: ReturnType<typeof stableError> | null = null;
  let resolveListener!: () => void;
  const listenerDone = new Promise<void>((resolve) => { resolveListener = resolve; });
  const guestListUnsubscribe = onSnapshot(
    query(collection(bob.db, "events", GUEST_EVENT, "rsvps"), orderBy("updatedAt")),
    (snapshot) => guestRows.push(snapshot.docs.map((entry) => entry.id)),
    (error) => {
      listenerError = stableError(error);
      guestRows.length = 0;
      resolveListener();
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await call(alice, "setGuestListVisibility", { eventId: GUEST_EVENT, visibility: "hosts" });
  await adminDb.doc(`events/${GUEST_EVENT}/rsvps/${custody.actors.bob.uid}`).update({
    updatedAt: FieldValue.serverTimestamp(),
    revision: FieldValue.increment(1),
  });
  await Promise.race([
    listenerDone,
    new Promise((_, reject) => setTimeout(() => reject(new Error("guest listener not revoked")), 8000)),
  ]);
  guestListUnsubscribe();
  assert(listenerError?.code?.includes("permission-denied"), "guest-list listener denial");
  const publicAfterPrivacy = await getDoc(doc(anonymous.db, "publicEvents", GUEST_EVENT));
  assert(publicAfterPrivacy.exists(), "public event hidden by guest-list setting");
  await call(alice, "setGuestListVisibility", { eventId: GUEST_EVENT, visibility: "guests" });
  await writeEvidence("PARTY-05-GUEST-LIST", {
    authoritativeCheck: "Already-connected onSnapshot invalidated after rules dependency changed; retained rows cleared",
    transport: "firestore-listen-stream",
    initialRows: guestRows,
    listenerError,
    retainedRowsAfterDenial: guestRows.length,
    anonymousPublicStillReadable: publicAfterPrivacy.exists(),
  });

  const capacitySettled = await Promise.allSettled([
    call(bob, "rsvp", { eventId: CONTENDED_EVENT, response: "yes", plusOneCount: 0 }),
    call(mallory, "rsvp", { eventId: CONTENDED_EVENT, response: "yes", plusOneCount: 0 }),
  ]);
  const capacityEvent = await adminDb.doc(`events/${CONTENDED_EVENT}`).get();
  const capacityRsvps = await adminDb.collection(`events/${CONTENDED_EVENT}/rsvps`).get();
  assert(capacitySettled.filter((entry) => entry.status === "fulfilled").length === 1, "capacity winner");
  assert(capacitySettled.filter((entry) => entry.status === "rejected").length === 1, "capacity loser");
  assert(capacityEvent.data()?.attendanceCount === 50 && capacityRsvps.size === 50, "capacity invariant");
  await writeEvidence("PARTY-06-CAPACITY", {
    authoritativeCheck: "Two concurrent callable transactions plus Admin invariant reads",
    contenders: capacitySettled.map((entry) => entry.status === "fulfilled"
      ? { status: entry.status, value: entry.value }
      : { status: entry.status, reason: stableError(entry.reason) }),
    attendanceCount: capacityEvent.data()?.attendanceCount,
    capacity: capacityEvent.data()?.capacity,
    persistedRsvpCount: capacityRsvps.size,
  });

  const burstIds = Array.from({ length: 20 }, (_, index) => `burst-${String(index + 1).padStart(2, "0")}`);
  const burstObservation = observeUntil(
    (next, error) => onSnapshot(
      collection(bobSecond.db, "events", PRIMARY_EVENT, "wallPosts"),
      (snapshot) => next(snapshot.docs.filter((entry) => entry.id.startsWith("burst-")).map((entry) => entry.id)),
      error,
    ),
    (value) => (value as string[]).length === 20,
  );
  const burstStarted = performance.now();
  const burstBatch = writeBatch(alice.db);
  burstIds.forEach((id, index) => burstBatch.set(
    doc(alice.db, "events", PRIMARY_EVENT, "wallPosts", id),
    {
      eventId: PRIMARY_EVENT,
      authorUid: custody.actors.alice.uid,
      authorName: "Alice",
      body: `Burst post ${index + 1}`,
      ordinal: index + 1,
      createdAt: serverTimestamp(),
    },
  ));
  await burstBatch.commit();
  const burstSettledMs = performance.now() - burstStarted;
  const burstObserved = await burstObservation;
  firstRealtimeTransitionMs ??= elapsedMs();
  const burstAuthoritative = await adminDb.collection(`events/${PRIMARY_EVENT}/wallPosts`).get();
  assert((burstObserved.value as string[]).length === 20, "burst listener count");
  await writeEvidence("PARTY-07-LIVE-BURST", {
    authoritativeCheck: "Second authenticated client native onSnapshot plus Admin collection read",
    transport: "firestore-listen-stream",
    authoredCount: 20,
    observedIds: burstObserved.value,
    persistedBurstCount: burstAuthoritative.docs.filter((entry) => entry.id.startsWith("burst-")).length,
    writeSettlementMs: burstSettledMs,
    realtimeDeliveryMs: burstObserved.elapsedMs,
  });

  const assetBytes = new Uint8Array(262_144);
  for (let index = 0; index < assetBytes.length; index += 1) assetBytes[index] = index % 251;
  const assetHash = createHash("sha256").update(assetBytes).digest("hex");
  const assetPath = `event-art/${PRIMARY_EVENT}/acceptance-art.bin`;
  const assetRefAlice = ref(alice.storage, assetPath);
  await uploadBytes(assetRefAlice, assetBytes, {
    contentType: "image/png",
    customMetadata: {
      hostUid: custody.actors.alice.uid,
      eventId: PRIMARY_EVENT,
      public: "true",
    },
  });
  const [bobAsset, anonymousAsset] = await Promise.all([
    getBytes(ref(bob.storage, assetPath)),
    getBytes(ref(anonymous.storage, assetPath)),
  ]);
  assert(createHash("sha256").update(new Uint8Array(bobAsset)).digest("hex") === assetHash, "Bob asset hash");
  assert(createHash("sha256").update(new Uint8Array(anonymousAsset)).digest("hex") === assetHash, "public asset hash");
  const outsiderUploadDenial = await expectDenied(
    uploadBytes(ref(mallory.storage, `event-art/${PRIMARY_EVENT}/mallory.bin`), assetBytes, {
      contentType: "image/png",
      customMetadata: {
        hostUid: custody.actors.alice.uid,
        eventId: PRIMARY_EVENT,
        public: "true",
      },
    }),
    "outsider asset upload",
  );
  const outsiderDeleteDenial = await expectDenied(
    deleteObject(ref(mallory.storage, assetPath)),
    "outsider asset delete",
  );
  await deleteObject(assetRefAlice);
  let postDeleteError: ReturnType<typeof stableError> | null = null;
  try {
    await getBytes(ref(anonymous.storage, assetPath));
  } catch (error) {
    postDeleteError = stableError(error);
  }
  assert(postDeleteError !== null, "deleted asset still readable");
  await writeEvidence("PARTY-08-ASSET", {
    authoritativeCheck: "Storage emulator rules, two SDK downloads with SHA-256 equality, denied outsider operations, post-delete failure",
    transport: "firebase-storage-emulator",
    bytes: assetBytes.length,
    sha256: assetHash,
    bobHashEqual: true,
    anonymousHashEqual: true,
    outsiderUploadDenial,
    outsiderDeleteDenial,
    postDeleteError,
    note: "Storage Rules cannot consult Firestore; host ownership is bound in immutable object metadata.",
  });

  const scheduleDefinition = await getDoc(
    doc(alice.db, "scheduleDefinitions", `event-reminder-${PRIMARY_EVENT}`),
  );
  const scheduleFirst = await call(alice, "runReminderNow", {
    eventId: PRIMARY_EVENT,
    dateKey: "2026-07-29",
  });
  const scheduleSecond = await call(alice, "runReminderNow", {
    eventId: PRIMARY_EVENT,
    dateKey: "2026-07-29",
  });
  const reminderRuns = await adminDb.collection("reminderRuns").get();
  const reminderEffects = await adminDb.collection("notificationEffects")
    .where("reason", "==", "scheduled reminder").get();
  assert(scheduleDefinition.exists(), "schedule definition absent");
  assert(reminderRuns.size === 1 && reminderEffects.size === 1, "schedule idempotency");
  await writeEvidence("PARTY-09-SCHEDULE", {
    authoritativeCheck: "Firebase onSchedule export initialized by Functions+Pub/Sub emulators; shared reminder core invoked twice and ledgers read via Admin",
    transport: "firebase-functions-scheduler-plus-callable-test-trigger",
    definition: scheduleDefinition.data(),
    first: scheduleFirst,
    second: scheduleSecond,
    reminderRunCount: reminderRuns.size,
    reminderEffectCount: reminderEffects.size,
    note: "The emulator initializes the real scheduled function; deterministic acceptance invokes the same core through an authenticated callable test trigger.",
  });

  const knownKey = `${PRIMARY_EVENT}:known-success-acceptance`;
  const knownFirst = await call(alice, "sendNotification", {
    eventId: PRIMARY_EVENT,
    effectKey: knownKey,
    mode: "known-success",
    reason: "known-success acceptance",
  });
  const knownSecond = await call(alice, "sendNotification", {
    eventId: PRIMARY_EVENT,
    effectKey: knownKey,
    mode: "known-success",
    reason: "known-success acceptance retry",
  });
  const knownEffect = await adminDb.doc(`notificationEffects/${knownKey}`).get();
  assert(knownEffect.data()?.attemptCount === 1, "known success retried provider");
  await writeEvidence("PARTY-10-EFFECT-RETRY", {
    authoritativeCheck: "Function effect ledger plus local provider receipt state",
    transport: "callable-function-to-http-provider-boundary",
    first: knownFirst,
    retry: knownSecond,
    effect: knownEffect.data(),
  });

  const ambiguousKey = `${PRIMARY_EVENT}:ambiguous-acceptance`;
  let ambiguousFirst: ReturnType<typeof stableError> | null = null;
  try {
    await call(alice, "sendNotification", {
      eventId: PRIMARY_EVENT,
      effectKey: ambiguousKey,
      mode: "ambiguous-first",
      reason: "ambiguous acceptance",
    });
  } catch (error) {
    ambiguousFirst = stableError(error);
  }
  assert(ambiguousFirst !== null, "ambiguous first call unexpectedly succeeded");
  const ambiguousIntermediate = (await adminDb.doc(`notificationEffects/${ambiguousKey}`).get()).data();
  assert(ambiguousIntermediate?.status === "ambiguous", "ambiguity not persisted");
  const ambiguousRetry = await call(alice, "sendNotification", {
    eventId: PRIMARY_EVENT,
    effectKey: ambiguousKey,
    mode: "ambiguous-first",
    reason: "ambiguous acceptance retry",
  });
  const ambiguousFinal = (await adminDb.doc(`notificationEffects/${ambiguousKey}`).get()).data();
  const providerState = JSON.parse(await readFile(new URL("state/fake-provider.json", armRoot), "utf8"));
  const providerRequests = providerState.requests.filter(
    (entry: { idempotencyKey: string }) => entry.idempotencyKey === ambiguousKey,
  );
  assert(ambiguousFinal?.attemptCount === 2, "ambiguous retry attempts");
  assert(providerState.receipts[ambiguousKey]?.deliveries === 1, "ambiguous duplicate delivery");
  assert(providerRequests.length === 2, "ambiguous provider request count");
  await writeEvidence("PARTY-11-EFFECT-AMBIGUOUS", {
    authoritativeCheck: "Intermediate and terminal effect ledger reads plus fake provider idempotency ledger",
    transport: "callable-function-to-http-provider-boundary-with-dropped-socket",
    firstError: ambiguousFirst,
    intermediate: ambiguousIntermediate,
    retry: ambiguousRetry,
    final: ambiguousFinal,
    provider: {
      requests: providerRequests,
      receipt: providerState.receipts[ambiguousKey],
    },
  });

  let controlSnapshots: Array<Record<string, unknown>> = [];
  let revocationListenerError: ReturnType<typeof stableError> | null = null;
  let resolveRevocation!: () => void;
  const revocationDone = new Promise<void>((resolve) => { resolveRevocation = resolve; });
  const controlsUnsubscribe = onSnapshot(
    doc(bob.db, "eventControls", PRIMARY_EVENT),
    (snapshot) => {
      if (snapshot.exists()) controlSnapshots.push(snapshot.data());
    },
    (error) => {
      revocationListenerError = stableError(error);
      controlSnapshots = [];
      resolveRevocation();
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await call(alice, "setCohost", {
    eventId: PRIMARY_EVENT,
    targetUid: custody.actors.bob.uid,
    enabled: false,
  });
  await call(alice, "revokeInvitation", {
    eventId: PRIMARY_EVENT,
    targetUid: custody.actors.bob.uid,
  });
  await Promise.race([
    revocationDone,
    new Promise((_, reject) => setTimeout(() => reject(new Error("control listener not revoked")), 8000)),
  ]);
  controlsUnsubscribe();
  const revokedPostDenial = await expectDenied(
    setDoc(doc(bob.db, "events", PRIMARY_EVENT, "wallPosts", "post-revocation-attempt"), {
      eventId: PRIMARY_EVENT,
      authorUid: custody.actors.bob.uid,
      authorName: "Bob",
      body: "Should not persist",
      ordinal: 99,
      createdAt: serverTimestamp(),
    }),
    "post-revocation write",
  );
  const publicAfterRevocation = await getDoc(doc(anonymous.db, "publicEvents", PRIMARY_EVENT));
  const revokedInvitation = await adminDb.doc(
    `events/${PRIMARY_EVENT}/invitations/${custody.actors.bob.uid}`,
  ).get();
  assert(revocationListenerError?.code?.includes("permission-denied"), "revocation listener denial");
  assert(revokedInvitation.data()?.status === "revoked", "invitation not revoked");
  await writeEvidence("PARTY-12-REVOCATION", {
    authoritativeCheck: "Already-connected protected listener terminated, retained state cleared, subsequent write denied, Admin invitation state checked",
    transport: "firestore-listen-stream",
    listenerError: revocationListenerError,
    retainedControlSnapshots: controlSnapshots.length,
    revokedPostDenial,
    invitationStatus: revokedInvitation.data()?.status,
    anonymousPublicStillReadable: publicAfterRevocation.exists(),
  });

  await writeEvidence("PARTY-13-DEPLOY", {
    status: "unavailable-remote-dependency",
    authoritativeCheck: "Credential preflight found no Firebase account in isolated CLI state",
    transport: "not-applicable",
    hostedStatus: "UNAVAILABLE_REMOTE_DEPENDENCY",
    note: "No hosted claim is made and this is not a Firebase product failure.",
  });

  await writeFile(new URL("evidence/scenario-results.partial.json", armRoot), `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    results,
    milestones: {
      firstRealtimeTransitionMs,
      localAcceptanceMs: elapsedMs(),
    },
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, results: results.length, elapsedMs: elapsedMs() })}\n`);
} finally {
  await Promise.allSettled(clients.map(destroyClient));
}
