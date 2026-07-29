import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  EMULATORS,
  GUEST_EVENT,
  PRIMARY_EVENT,
  PROJECT_ID,
} from "./constants.ts";
import { createClient, destroyClient, type ActorCredential } from "./firebase-client.ts";

if (!PROJECT_ID.endsWith("-party07-remediation")) {
  throw new Error(`Refusing remediation on non-remediation project: ${PROJECT_ID}`);
}
process.env.FIRESTORE_EMULATOR_HOST = `${EMULATORS.firestore.host}:${EMULATORS.firestore.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMULATORS.auth.host}:${EMULATORS.auth.port}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;
if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();
const armRoot = new URL("../../", import.meta.url);
const evidenceRoot = new URL("evidence/", armRoot);
const stateRoot = new URL("state/", armRoot);
await Promise.all([mkdir(evidenceRoot, { recursive: true }), mkdir(stateRoot, { recursive: true })]);

const baselineCollections = await db.listCollections();
const baselineUsers = await auth.listUsers(1000);
if (baselineCollections.length !== 0 || baselineUsers.users.length !== 0) {
  throw new Error("Remediation target is not fresh");
}
await writeFile(new URL("party-07-remediation-baseline.json", evidenceRoot), `${JSON.stringify({
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  targetMode: "fresh-local-remediation",
  firestoreCollections: 0,
  authUsers: 0,
}, null, 2)}\n`);

const aliceCredential: ActorCredential = {
  uid: "alice-party07-remediation",
  email: "alice-party07-remediation@example.test",
  password: `P-${randomBytes(18).toString("base64url")}!`,
};
const bobCredential: ActorCredential = {
  uid: "bob-party07-remediation",
  email: "bob-party07-remediation@example.test",
  password: `P-${randomBytes(18).toString("base64url")}!`,
};
await Promise.all([
  auth.createUser({ ...aliceCredential, displayName: "Alice" }),
  auth.createUser({ ...bobCredential, displayName: "Bob" }),
]);
const batch = db.batch();
for (const eventId of [PRIMARY_EVENT, GUEST_EVENT]) {
  batch.set(db.doc(`events/${eventId}`), {
    hostUid: aliceCredential.uid,
    cohostUids: [],
    guestListVisibility: "guests",
    capacity: 50,
    attendanceCount: 0,
    title: eventId === PRIMARY_EVENT ? "Rooftop Solstice" : "Studio Supper",
    location: "Local",
    revision: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
batch.set(db.doc(`events/${PRIMARY_EVENT}/invitations/${bobCredential.uid}`), {
  uid: bobCredential.uid,
  displayName: "Bob",
  role: "guest",
  status: "active",
  invitedBy: aliceCredential.uid,
  createdAt: FieldValue.serverTimestamp(),
});
batch.set(db.doc(`events/${GUEST_EVENT}/invitations/${bobCredential.uid}`), {
  uid: bobCredential.uid,
  displayName: "Bob",
  role: "guest",
  status: "active",
  invitedBy: aliceCredential.uid,
  createdAt: FieldValue.serverTimestamp(),
});
await batch.commit();

const alice = await createClient(aliceCredential);
const bob = await createClient(bobCredential);
const observed = { postIds: [] as string[], attendanceCounts: [] as number[] };
let wallReady = false;
let attendanceReady = false;
let resolveObserved!: () => void;
const observation = new Promise<void>((resolve) => { resolveObserved = resolve; });
const maybeResolve = () => {
  if (wallReady && attendanceReady) resolveObserved();
};
const unsubscribeWall = onSnapshot(
  collection(bob.db, "events", PRIMARY_EVENT, "wallPosts"),
  (snapshot) => {
    observed.postIds = snapshot.docs.map((entry) => entry.id).sort();
    wallReady = observed.postIds.length === 20;
    maybeResolve();
  },
);
const unsubscribeAttendance = onSnapshot(
  doc(bob.db, "events", GUEST_EVENT),
  (snapshot) => {
    if (snapshot.exists()) observed.attendanceCounts.push(Number(snapshot.data().attendanceCount));
    attendanceReady = observed.attendanceCounts.includes(2);
    maybeResolve();
  },
);
await new Promise((resolve) => setTimeout(resolve, 400));
const wallBatch = writeBatch(alice.db);
for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
  wallBatch.set(doc(alice.db, "events", PRIMARY_EVENT, "wallPosts", `remediation-burst-${ordinal}`), {
    eventId: PRIMARY_EVENT,
    authorUid: aliceCredential.uid,
    authorName: "Alice",
    body: `Remediation burst ${ordinal}`,
    ordinal,
    createdAt: serverTimestamp(),
  });
}
await Promise.all([
  wallBatch.commit(),
  httpsCallable(bob.functions, "rsvp")({
    eventId: GUEST_EVENT,
    response: "yes",
    plusOneCount: 1,
  }),
]);
await Promise.race([
  observation,
  new Promise((_, reject) => setTimeout(() => reject(new Error("remediation live timeout")), 8000)),
]);
unsubscribeWall();
unsubscribeAttendance();
const [authoritativePosts, authoritativeEvent] = await Promise.all([
  db.collection(`events/${PRIMARY_EVENT}/wallPosts`).get(),
  db.doc(`events/${GUEST_EVENT}`).get(),
]);
if (authoritativePosts.size !== 20 || authoritativeEvent.data()?.attendanceCount !== 2) {
  throw new Error("remediation authoritative invariant");
}
await Promise.all([destroyClient(alice), destroyClient(bob)]);

const beforeCleanup = {
  topLevelCollections: (await db.listCollections()).map((entry) => entry.id).sort(),
  authUsers: (await auth.listUsers(1000)).users.length,
};
for (const entry of await db.listCollections()) await db.recursiveDelete(entry);
await auth.deleteUsers((await auth.listUsers(1000)).users.map((user) => user.uid));
const afterCleanup = {
  topLevelCollections: (await db.listCollections()).map((entry) => entry.id).sort(),
  authUsers: (await auth.listUsers(1000)).users.length,
};
if (afterCleanup.topLevelCollections.length !== 0 || afterCleanup.authUsers !== 0) {
  throw new Error("remediation cleanup incomplete");
}
await writeFile(new URL("party-07-live-burst-remediation.json", evidenceRoot), `${JSON.stringify({
  schemaVersion: 1,
  scenario: "PARTY-07-LIVE-BURST",
  capturedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  targetMode: "fresh-local-remediation",
  originalPartialReceipt: "evidence/party-07-live-burst.json",
  transport: "native Firestore onSnapshot push on a second authenticated client",
  polling: false,
  observed,
  authoritative: {
    postCount: authoritativePosts.size,
    attendanceCount: authoritativeEvent.data()?.attendanceCount,
  },
  cleanup: { before: beforeCleanup, after: afterCleanup, status: "data-plane-complete" },
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, projectId: PROJECT_ID })}\n`);
