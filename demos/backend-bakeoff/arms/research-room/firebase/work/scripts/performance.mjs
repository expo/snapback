import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

const workDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.resolve(workDir, "..", "evidence");
await mkdir(evidenceDir, { recursive: true });
const projectId = "llp0102-research-firebase-w3";
const config = {
  apiKey: "demo-research-room",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket: `${projectId}.appspot.com`,
  appId: "1:000000000000:web:performance",
};

function actor(name) {
  const app = initializeApp(config, `performance-${name}-${Date.now()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9342", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8342);
  return { auth, db };
}

const alice = actor("alice");
const bob = actor("bob");
await Promise.all([
  signInWithEmailAndPassword(alice.auth, "alice@research.test", "correct-horse-battery"),
  signInWithEmailAndPassword(bob.auth, "bob@research.test", "correct-horse-battery"),
]);

const warmups = 2;
const recordedSamples = 7;
const now = () => performance.now();
const round = (value) => Number(value.toFixed(3));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function runCommand(command, args) {
  const start = now();
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workDir, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
  return now() - start;
}

const paths = [
  {
    id: "representative-read",
    shape: "Alice Firestore indexed keyword query returning five authorized source records.",
    sample: async () => {
      const start = now();
      const snapshot = await getDocs(
        query(
          collection(alice.db, "rooms/room-primary/sources"),
          where("keywords", "array-contains", "climate"),
          orderBy("title"),
        ),
      );
      assert.equal(snapshot.size, 5);
      return now() - start;
    },
  },
  {
    id: "representative-write",
    shape: "Alice authorized source-metadata create followed by exact deletion.",
    sample: async (index) => {
      const id = `performance-write-${index}-${Date.now()}`;
      const reference = doc(alice.db, `rooms/room-primary/sources/${id}`);
      const start = now();
      await setDoc(reference, {
        title: "Performance source",
        ownerId: alice.auth.currentUser.uid,
        objectPath: `rooms/room-primary/sources/${id}`,
        contentHash: "performance",
        byteLength: 1,
        keywords: ["performance"],
        createdAt: serverTimestamp(),
      });
      const elapsed = now() - start;
      await deleteDoc(reference);
      return elapsed;
    },
  },
  {
    id: "realtime-delivery",
    shape: "Bob native Firestore listener receives Alice's committed progress-like document.",
    sample: async (index) => {
      const id = `performance-push-${index}-${Date.now()}`;
      const reference = doc(alice.db, `rooms/room-primary/sources/${id}`);
      let settle;
      const delivered = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("realtime sample timed out")), 5_000);
        const unsubscribe = onSnapshot(
          doc(bob.db, `rooms/room-primary/sources/${id}`),
          (snapshot) => {
            if (!snapshot.exists() || !settle) return;
            clearTimeout(timeout);
            unsubscribe();
            settle(now() - start);
          },
          reject,
        );
        settle = resolve;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const start = now();
      await setDoc(reference, {
        title: "Realtime performance source",
        ownerId: alice.auth.currentUser.uid,
        objectPath: `rooms/room-primary/sources/${id}`,
        contentHash: "performance",
        byteLength: 1,
        keywords: ["performance"],
      });
      const elapsed = await delivered;
      await deleteDoc(reference);
      return elapsed;
    },
  },
  {
    id: "reconnect",
    shape: "Bob disables then re-enables the Firestore network and obtains an authoritative source read.",
    sample: async () => {
      await disableNetwork(bob.db);
      const start = now();
      await enableNetwork(bob.db);
      const snapshot = await getDoc(doc(bob.db, "rooms/room-primary/sources/source-001"));
      assert.equal(snapshot.exists(), true);
      return now() - start;
    },
  },
  {
    id: "build-or-deploy",
    shape: "TypeScript validation and production Vite build for the local Firebase Hosting artifact.",
    sample: async () => runCommand("npm", ["run", "build"]),
  },
];

const output = {
  schemaVersion: 1,
  app: "research-room",
  provider: "firebase",
  target: {
    mode: "fresh-local",
    projectIdSha256: "06082d16839e467b0f30b3de823783f008c6c28458e306834e801f46b118b854",
    profile: "Firebase Local Emulator Suite",
  },
  claimScope: "small repeatable frozen product workload; not production scale",
  warmups,
  recordedSamples,
  paths: [],
  costWindow: {
    actualProviderUsage: "Local Emulator Suite; no provider billing meter or hosted usage.",
    listPriceEstimate: "Not measured; hosted target unavailable.",
    extrapolationCountedAsMeasured: false,
  },
};

for (const pathSpec of paths) {
  const warmupValues = [];
  const samples = [];
  for (let index = 0; index < warmups + recordedSamples; index += 1) {
    const value = round(await pathSpec.sample(index));
    if (index < warmups) warmupValues.push(value);
    else samples.push(value);
  }
  output.paths.push({
    id: pathSpec.id,
    shape: pathSpec.shape,
    unit: "ms",
    warmups: warmupValues,
    rawSamples: samples,
    successfulSamples: samples.length,
    failedSamples: 0,
    median: round(median(samples)),
    nearestRankP95: round(p95(samples)),
  });
}

await writeFile(
  path.join(evidenceDir, "performance.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  paths: Object.fromEntries(output.paths.map((item) => [
    item.id,
    { median: item.median, p95: item.nearestRankP95 },
  ])),
})}\n`);
