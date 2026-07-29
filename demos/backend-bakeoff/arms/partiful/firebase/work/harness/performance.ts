import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
import {
  EMULATORS,
  PRIMARY_EVENT,
  PROJECT_ID,
} from "./constants.ts";
import { createClient, destroyClient, type ActorCredential } from "./firebase-client.ts";

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
const custody = JSON.parse(
  await readFile(new URL("state/actor-custody.json", armRoot), "utf8"),
) as { actors: Record<"alice" | "bob" | "mallory", ActorCredential> };
const alice = await createClient(custody.actors.alice);
const bob = await createClient(custody.actors.bob);
const mallory = await createClient(custody.actors.mallory);

type Samples = Record<string, number[]>;
const samples: Samples = {
  "representative-read": [],
  "representative-write": [],
  "realtime-delivery": [],
  "offline-reconnect": [],
  "capacity-contention": [],
  "wall-burst-20": [],
  "asset-256k-roundtrip": [],
};

async function measure<T>(operation: () => Promise<T>) {
  const started = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - started };
}

async function call(client: typeof alice, name: string, data: unknown) {
  return (await httpsCallable(client.functions, name)(data)).data;
}

try {
  for (let iteration = 1; iteration <= 9; iteration += 1) {
    const read = await measure(() => getDoc(doc(alice.db, "events", PRIMARY_EVENT)));
    if (!read.value.exists()) throw new Error("performance read absent");
    samples["representative-read"].push(read.ms);

    const writeId = `perf-write-${iteration}`;
    const write = await measure(() => setDoc(
      doc(alice.db, "events", PRIMARY_EVENT, "wallPosts", writeId),
      {
        eventId: PRIMARY_EVENT,
        authorUid: custody.actors.alice.uid,
        authorName: "Alice",
        body: `Performance write ${iteration}`,
        ordinal: 10_000 + iteration,
        createdAt: serverTimestamp(),
      },
    ));
    samples["representative-write"].push(write.ms);
    await deleteDoc(doc(alice.db, "events", PRIMARY_EVENT, "wallPosts", writeId));

    const realtimeId = `perf-realtime-${iteration}`;
    const realtime = await measure(() => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("performance realtime timeout"));
      }, 8000);
      const unsubscribe = onSnapshot(
        doc(alice.db, "events", PRIMARY_EVENT, "wallPosts", realtimeId),
        (snapshot) => {
          if (!snapshot.exists()) return;
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        },
        reject,
      );
      void setDoc(doc(alice.db, "events", PRIMARY_EVENT, "wallPosts", realtimeId), {
        eventId: PRIMARY_EVENT,
        authorUid: custody.actors.alice.uid,
        authorName: "Alice",
        body: `Realtime ${iteration}`,
        ordinal: 20_000 + iteration,
        createdAt: serverTimestamp(),
      }).catch(reject);
    }));
    samples["realtime-delivery"].push(realtime.ms);
    await deleteDoc(doc(alice.db, "events", PRIMARY_EVENT, "wallPosts", realtimeId));

    const reconnect = await measure(async () => {
      const reconnected = await createClient(custody.actors.alice);
      try {
        const snapshot = await getDoc(doc(reconnected.db, "events", PRIMARY_EVENT));
        if (!snapshot.exists()) throw new Error("reconnect read absent");
      } finally {
        await destroyClient(reconnected);
      }
    });
    samples["offline-reconnect"].push(reconnect.ms);

    const contentionEvent = `event-perf-capacity-${iteration}`;
    const contentionBatch = adminDb.batch();
    const now = Timestamp.now();
    contentionBatch.set(adminDb.doc(`events/${contentionEvent}`), {
      hostUid: custody.actors.alice.uid,
      cohostUids: [],
      guestListVisibility: "guests",
      capacity: 1,
      attendanceCount: 0,
      title: "Performance capacity",
      location: "Local",
      startsAt: now,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    for (const actor of [custody.actors.bob, custody.actors.mallory]) {
      contentionBatch.set(adminDb.doc(`events/${contentionEvent}/invitations/${actor.uid}`), {
        uid: actor.uid,
        displayName: actor.uid.startsWith("bob") ? "Bob" : "Mallory",
        role: "guest",
        status: "active",
        invitedBy: custody.actors.alice.uid,
        createdAt: now,
      });
    }
    await contentionBatch.commit();
    const contention = await measure(() => Promise.allSettled([
      call(bob, "rsvp", { eventId: contentionEvent, response: "yes", plusOneCount: 0 }),
      call(mallory, "rsvp", { eventId: contentionEvent, response: "yes", plusOneCount: 0 }),
    ]));
    if (contention.value.filter((entry) => entry.status === "fulfilled").length !== 1) {
      throw new Error("performance contention invariant");
    }
    samples["capacity-contention"].push(contention.ms);

    const burstPrefix = `perf-burst-${iteration}-`;
    const burst = await measure(async () => {
      const batch = writeBatch(alice.db);
      for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
        batch.set(doc(alice.db, "events", PRIMARY_EVENT, "wallPosts", `${burstPrefix}${ordinal}`), {
          eventId: PRIMARY_EVENT,
          authorUid: custody.actors.alice.uid,
          authorName: "Alice",
          body: `Performance burst ${iteration}/${ordinal}`,
          ordinal: 30_000 + iteration * 100 + ordinal,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
    });
    samples["wall-burst-20"].push(burst.ms);

    const asset = new Uint8Array(262_144);
    asset.fill(iteration);
    const assetRef = ref(alice.storage, `event-art/${PRIMARY_EVENT}/perf-${iteration}.bin`);
    const assetRoundtrip = await measure(async () => {
      await uploadBytes(assetRef, asset, {
        contentType: "image/png",
        customMetadata: {
          hostUid: custody.actors.alice.uid,
          eventId: PRIMARY_EVENT,
          public: "true",
        },
      });
      const downloaded = new Uint8Array(await getBytes(assetRef));
      if (
        createHash("sha256").update(downloaded).digest("hex")
        !== createHash("sha256").update(asset).digest("hex")
      ) throw new Error("performance asset hash");
      await deleteObject(assetRef);
    });
    samples["asset-256k-roundtrip"].push(assetRoundtrip.ms);
  }

  const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    const ordered = [...values].sort((a, b) => a - b);
    return [name, {
      samplesMs: values.map((value) => Number(value.toFixed(3))),
      medianMs: Number(ordered[4].toFixed(3)),
      p95ObservedMs: Number(ordered[8].toFixed(3)),
      sampleCount: values.length,
    }];
  }));
  await writeFile(new URL("party-14-performance-local.json", evidenceRoot), `${JSON.stringify({
    schemaVersion: 1,
    scenario: "PARTY-14-PERFORMANCE",
    capturedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    environment: "local Firebase Emulator Suite; debug-only and not comparable to hosted performance",
    warmup: "The functional acceptance run warmed SDK connections and emulator processes before sampling.",
    samplePolicy: "Nine sequential samples per path; raw samples, observed median, and observed max-as-p95 retained.",
    summary,
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, paths: Object.keys(summary).length })}\n`);
} finally {
  await Promise.allSettled([alice, bob, mallory].map(destroyClient));
}
