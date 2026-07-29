import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {
  ARM_START_MONOTONIC_MS,
  CONTENDED_EVENT,
  EMULATORS,
  GUEST_EVENT,
  PRIMARY_EVENT,
  PROJECT_ID,
} from "./constants.ts";

process.env.FIRESTORE_EMULATOR_HOST = `${EMULATORS.firestore.host}:${EMULATORS.firestore.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMULATORS.auth.host}:${EMULATORS.auth.port}`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = `${EMULATORS.storage.host}:${EMULATORS.storage.port}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` });
}
const db = getFirestore();
const auth = getAuth();
const armRoot = new URL("../../", import.meta.url);
const evidence = new URL("evidence/", armRoot);
const state = new URL("state/", armRoot);

function elapsedMs() {
  return Math.round(Number(process.hrtime.bigint() / 1_000_000n) - ARM_START_MONOTONIC_MS);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

await Promise.all([mkdir(evidence, { recursive: true }), mkdir(state, { recursive: true })]);

const [collections, authResponse, storageResponse] = await Promise.all([
  db.listCollections(),
  fetch(`http://${EMULATORS.auth.host}:${EMULATORS.auth.port}/emulator/v1/projects/${PROJECT_ID}/accounts`),
  fetch(`http://${EMULATORS.storage.host}:${EMULATORS.storage.port}/v0/b/${PROJECT_ID}.appspot.com/o`),
]);
const firstLocalReadMs = elapsedMs();
const authBaseline = authResponse.ok ? await authResponse.json() : { users: [] };
const storageBaseline = storageResponse.ok ? await storageResponse.json() : { items: [] };
if (collections.length !== 0 || (authBaseline.users ?? []).length !== 0 || (storageBaseline.items ?? []).length !== 0) {
  throw new Error("PARTY_FRESH_TARGET_BASELINE_NOT_EMPTY");
}
await writeFile(new URL("baseline.json", evidence), `${JSON.stringify({
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  mode: "fresh-local-emulator",
  preWrite: {
    firestoreTopLevelCollections: collections.map((entry) => entry.id),
    authUsers: (authBaseline.users ?? []).length,
    storageObjects: (storageBaseline.items ?? []).length,
  },
  assignedPorts: Object.fromEntries(Object.entries(EMULATORS).map(([key, value]) => [key, value.port])),
  sharedTarget: false,
  secretValuesPresent: false,
}, null, 2)}\n`);

const actorDefinitions = {
  alice: {
    uid: "alice-partiful-firebase-w1",
    email: "alice-partiful-firebase-w1@example.test",
    displayName: "Alice",
  },
  bob: {
    uid: "bob-partiful-firebase-w1",
    email: "bob-partiful-firebase-w1@example.test",
    displayName: "Bob",
  },
  mallory: {
    uid: "mallory-partiful-firebase-w1",
    email: "mallory-partiful-firebase-w1@example.test",
    displayName: "Mallory",
  },
} as const;

const credentials: Record<string, { uid: string; email: string; password: string }> = {};
for (const [name, actor] of Object.entries(actorDefinitions)) {
  const password = `P-${randomBytes(18).toString("base64url")}!`;
  await auth.createUser({
    uid: actor.uid,
    email: actor.email,
    password,
    displayName: actor.displayName,
    emailVerified: true,
  });
  credentials[name] = { uid: actor.uid, email: actor.email, password };
}

const batch = db.batch();
const startsAt = Timestamp.fromDate(new Date("2026-08-15T02:00:00.000Z"));
const eventIds = [
  ...Array.from({ length: 19 }, (_, index) => `event-${String(index + 1).padStart(2, "0")}`),
  CONTENDED_EVENT,
];
for (const [index, eventId] of eventIds.entries()) {
  const isPrimary = eventId === PRIMARY_EVENT;
  const isGuestEvent = eventId === GUEST_EVENT;
  const isContended = eventId === CONTENDED_EVENT;
  const cohostUids = isPrimary ? [actorDefinitions.bob.uid] : [];
  const title = isPrimary
    ? "Rooftop Solstice"
    : isGuestEvent
      ? "Studio Supper"
      : isContended
        ? "Capacity Finale"
        : `Seed event ${String(index + 1).padStart(2, "0")}`;
  batch.set(db.doc(`events/${eventId}`), {
    hostUid: actorDefinitions.alice.uid,
    cohostUids,
    guestListVisibility: isGuestEvent ? "guests" : "hosts",
    capacity: isContended ? 50 : 120,
    attendanceCount: isContended ? 49 : 0,
    title,
    location: isPrimary ? "Mission Rooftop" : `Venue ${index + 1}`,
    startsAt,
    revision: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`publicEvents/${eventId}`), {
    title,
    location: isPrimary ? "Mission Rooftop" : `Venue ${index + 1}`,
    startsAt,
    published: true,
    artPath: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`eventControls/${eventId}`), {
    eventId,
    hostUid: actorDefinitions.alice.uid,
    cohostUids,
    doorCode: `DOOR-${String(index + 1).padStart(2, "0")}`,
    internalNote: `Private controls for ${eventId}`,
    revision: 1,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

batch.set(db.doc(`events/${PRIMARY_EVENT}/invitations/${actorDefinitions.bob.uid}`), {
  uid: actorDefinitions.bob.uid,
  displayName: "Bob",
  role: "cohost",
  status: "active",
  invitedBy: actorDefinitions.alice.uid,
  createdAt: FieldValue.serverTimestamp(),
});
batch.set(db.doc(`events/${GUEST_EVENT}/invitations/${actorDefinitions.bob.uid}`), {
  uid: actorDefinitions.bob.uid,
  displayName: "Bob",
  role: "guest",
  status: "active",
  invitedBy: actorDefinitions.alice.uid,
  createdAt: FieldValue.serverTimestamp(),
});
for (const actor of [actorDefinitions.bob, actorDefinitions.mallory]) {
  batch.set(db.doc(`events/${CONTENDED_EVENT}/invitations/${actor.uid}`), {
    uid: actor.uid,
    displayName: actor.displayName,
    role: "guest",
    status: "active",
    invitedBy: actorDefinitions.alice.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
}
for (let index = 1; index <= 49; index += 1) {
  const uid = `capacity-guest-${String(index).padStart(2, "0")}`;
  batch.set(db.doc(`events/${CONTENDED_EVENT}/invitations/${uid}`), {
    uid,
    displayName: `Capacity Guest ${index}`,
    role: "guest",
    status: "active",
    invitedBy: actorDefinitions.alice.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`events/${CONTENDED_EVENT}/rsvps/${uid}`), {
    eventId: CONTENDED_EVENT,
    uid,
    displayName: `Capacity Guest ${index}`,
    response: "yes",
    plusOneCount: 0,
    seats: 1,
    revision: 1,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
batch.set(db.doc("scheduleDefinitions/event-reminder-event-01"), {
  eventId: PRIMARY_EVENT,
  functionName: "scheduledReminder",
  schedule: "0 9 * * *",
  timeZone: "America/Los_Angeles",
  retryCount: 3,
  enabled: true,
});
await batch.commit();
const firstAuthoritativeMutationMs = elapsedMs();

const custodyPath = new URL("actor-custody.json", state);
await writeFile(custodyPath, `${JSON.stringify({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  actors: credentials,
}, null, 2)}\n`, { mode: 0o600 });
await chmod(custodyPath, 0o600);

const counts = {
  events: (await db.collection("events").get()).size,
  publicEvents: (await db.collection("publicEvents").get()).size,
  eventControls: (await db.collection("eventControls").get()).size,
  contendedInvitations: (await db.collection(`events/${CONTENDED_EVENT}/invitations`).get()).size,
  contendedRsvps: (await db.collection(`events/${CONTENDED_EVENT}/rsvps`).get()).size,
  contendedAttendance: (await db.doc(`events/${CONTENDED_EVENT}`).get()).data()?.attendanceCount,
  scheduleDefinitions: (await db.collection("scheduleDefinitions").get()).size,
  authUsers: 3,
};
await writeFile(new URL("seed-receipt.json", evidence), `${JSON.stringify({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  dataset: counts,
  actors: Object.fromEntries(Object.entries(actorDefinitions).map(([name, actor]) => [
    name,
    { principalIdHash: sha256(actor.uid), role: name === "alice" ? "host" : name === "bob" ? "cohost/guest" : "outsider/invitee-for-contention" },
  ])),
  rawCredentialsPersistedInEvidence: false,
}, null, 2)}\n`);
await writeFile(new URL("milestones.partial.json", evidence), `${JSON.stringify({
  firstLocalReadMs,
  firstAuthoritativeMutationMs,
  firstRealtimeTransitionMs: null,
}, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({ ok: true, counts })}\n`);
