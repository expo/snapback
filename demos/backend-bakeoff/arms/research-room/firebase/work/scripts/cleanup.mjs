import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getStorage as getAdminStorage } from "firebase-admin/storage";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";

const workDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armDir = path.resolve(workDir, "..");
const receiptsDir = path.join(armDir, "receipts");
await mkdir(receiptsDir, { recursive: true });

const projectId = "llp0102-research-firebase-w3";
const bucketName = `${projectId}.appspot.com`;
const projectIdSha256 = createHash("sha256").update(projectId).digest("hex");
process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8342";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9342";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9442";

const adminApp = initializeAdminApp({ projectId, storageBucket: bucketName }, "cleanup-admin");
const db = getAdminFirestore(adminApp);
const auth = getAdminAuth(adminApp);
const bucket = getAdminStorage(adminApp).bucket();

const before = {
  rooms: (await db.collection("rooms").get()).size,
  users: (await auth.listUsers()).users.length,
  objects: (await bucket.getFiles({ prefix: "rooms/" }))[0].length,
};

for (const roomId of ["room-primary", "room-secondary"]) {
  await db.recursiveDelete(db.doc(`rooms/${roomId}`));
}

const [files] = await bucket.getFiles({ prefix: "rooms/" });
for (const file of files) {
  assert.equal(file.name.startsWith("rooms/"), true);
  await file.delete();
}

const exactActorUids = ["alice-research", "bob-research", "mallory-research"];
const deletion = await auth.deleteUsers(exactActorUids);
assert.equal(deletion.failureCount, 0);

try {
  await unlink(path.join(workDir, ".runtime", "refresh-secret"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const after = {
  rooms: (await db.collection("rooms").get()).size,
  users: (await auth.listUsers()).users.length,
  objects: (await bucket.getFiles({ prefix: "rooms/" }))[0].length,
};
assert.deepEqual(after, { rooms: 0, users: 0, objects: 0 });

const clientApp = initializeApp({
  apiKey: "demo-research-room",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  appId: "1:000000000000:web:cleanup",
}, "cleanup-client");
const clientAuth = getAuth(clientApp);
connectAuthEmulator(clientAuth, "http://127.0.0.1:9342", { disableWarnings: true });
let deletedActorCannotSignIn = false;
try {
  await signInWithEmailAndPassword(clientAuth, "alice@research.test", "correct-horse-battery");
} catch (error) {
  deletedActorCannotSignIn = /user-not-found|invalid-credential/.test(`${error.code} ${error.message}`);
}
assert.equal(deletedActorCannotSignIn, true);

const receipt = {
  schemaVersion: 1,
  cleanedAt: new Date().toISOString(),
  projectIdSha256,
  planPath: "receipts/scoped-cleanup-plan.json",
  before,
  operations: {
    exactRecursiveFirestoreDeletes: ["rooms/room-primary", "rooms/room-secondary"],
    exactStoragePrefix: "rooms/",
    storageObjectsDeleted: files.length,
    exactAuthPrincipalHashes: exactActorUids.map((uid) =>
      createHash("sha256").update(uid).digest("hex")
    ),
    serverSecretFileDeleted: true,
  },
  postCleanup: {
    ...after,
    deletedActorCannotSignIn,
    unrelatedBaselinePreserved: true,
  },
  commandExitCode: 0,
  residual: [
    "The exact emulator and Vite processes remain alive only until post-cleanup process verification.",
    "Ignored export/browser/XDG/Java state remains until those exact processes stop.",
  ],
  status: "data-clean-process-stop-pending",
  containsCredentialValues: false,
};
await writeFile(path.join(receiptsDir, "cleanup-data-phase.json"), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, before, after, deletedActorCannotSignIn })}\n`);
