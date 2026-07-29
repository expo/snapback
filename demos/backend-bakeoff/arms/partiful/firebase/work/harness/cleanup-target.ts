import { readFile, writeFile } from "node:fs/promises";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { EMULATORS, PROJECT_ID } from "./constants.ts";

const expectedRoot = "/private/tmp/llp0102-partiful-firebase-w1/demos/backend-bakeoff/arms/partiful/firebase/work";
if (process.cwd() !== expectedRoot) {
  throw new Error(`Refusing cleanup: cwd mismatch ${process.cwd()}`);
}
process.env.FIRESTORE_EMULATOR_HOST = `${EMULATORS.firestore.host}:${EMULATORS.firestore.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMULATORS.auth.host}:${EMULATORS.auth.port}`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = `${EMULATORS.storage.host}:${EMULATORS.storage.port}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;
if (process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error("Refusing cleanup: exact project mismatch");
}
if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` });
}
const db = getFirestore();
const auth = getAuth();
const armRoot = new URL("../../", import.meta.url);
const plan = JSON.parse(await readFile(new URL("evidence/scoped-cleanup-plan.json", armRoot), "utf8"));
if (plan.exactWorkRoot !== expectedRoot || plan.exactProjectId !== PROJECT_ID) {
  throw new Error("Refusing cleanup: plan binding mismatch");
}

async function storageObjects() {
  const response = await fetch(
    `http://${EMULATORS.storage.host}:${EMULATORS.storage.port}/v0/b/${PROJECT_ID}.appspot.com/o`,
    { headers: { authorization: "Bearer owner" } },
  );
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Storage list failed: ${response.status}`);
  const body = await response.json();
  return (body.items ?? []).map((item: { name: string }) => item.name);
}

async function firestoreCounts() {
  const collections = await db.listCollections();
  return Object.fromEntries(await Promise.all(collections.map(async (entry) => [
    entry.id,
    (await entry.get()).size,
  ])));
}

const authBefore = await auth.listUsers(1000);
const storageBefore = await storageObjects();
const firestoreBefore = await firestoreCounts();
const collections = await db.listCollections();
for (const entry of collections) await db.recursiveDelete(entry);
if (authBefore.users.length > 0) {
  const deletion = await auth.deleteUsers(authBefore.users.map((user) => user.uid));
  if (deletion.failureCount !== 0) throw new Error("Auth cleanup failure");
}
for (const name of storageBefore) {
  const response = await fetch(
    `http://${EMULATORS.storage.host}:${EMULATORS.storage.port}/v0/b/${PROJECT_ID}.appspot.com/o/${encodeURIComponent(name)}`,
    { method: "DELETE", headers: { authorization: "Bearer owner" } },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Storage delete failed for ${name}: ${response.status}`);
  }
}
const [firestoreAfter, authAfter, storageAfter] = await Promise.all([
  firestoreCounts(),
  auth.listUsers(1000),
  storageObjects(),
]);
const remainingFirestoreDocs = Object.values(firestoreAfter).reduce(
  (total, value) => total + Number(value),
  0,
);
if (remainingFirestoreDocs !== 0 || authAfter.users.length !== 0 || storageAfter.length !== 0) {
  throw new Error(`Cleanup incomplete: ${JSON.stringify({
    firestoreAfter,
    authUsers: authAfter.users.length,
    storageObjects: storageAfter.length,
  })}`);
}
const receipt = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  mode: "fresh-local",
  planPath: "evidence/scoped-cleanup-plan.json",
  before: {
    firestoreTopLevelCounts: firestoreBefore,
    authUsers: authBefore.users.length,
    storageObjects: storageBefore.length,
  },
  after: {
    firestoreTopLevelCounts: firestoreAfter,
    remainingFirestoreDocs,
    authUsers: authAfter.users.length,
    storageObjects: storageAfter.length,
  },
  unrelatedBaseline: "No shared or hosted target was used or mutated.",
  exactTargetNegativeProbe: "all exact-project data-plane counts are zero",
  status: "data-plane-complete",
};
await writeFile(
  new URL("evidence/cleanup-data-plane.json", armRoot),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ ok: true, receipt })}\n`);
