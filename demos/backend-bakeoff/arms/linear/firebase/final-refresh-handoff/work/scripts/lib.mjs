import { createHash } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
} from "firebase/functions";

export const projectId = "llp0102-final-linear-firebase-w3";
export const password = "CorrectHorseBattery1!";
export const personas = {
  alice: "alice@example.test",
  bob: "bob@example.test",
  mallory: "mallory@example.test",
};
export const ports = [
  59121,
  58121,
  56121,
  60121,
  61121,
  62121,
  46124,
  46121,
  46122,
  46123,
];

export function firebaseConfig() {
  return {
    apiKey: "fake-api-key-for-local-emulator",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    appId: "1:123456789:web:llp0102linearfirebase",
  };
}

export async function actor(name) {
  const app = initializeApp(firebaseConfig(), `${name}-${crypto.randomUUID()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:59121", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 58121);
  const functions = getFunctions(app, "us-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 56121);
  await signInWithEmailAndPassword(auth, personas[name], password);
  return {
    name,
    app,
    auth,
    db,
    functions,
    uid: auth.currentUser.uid,
    async close() {
      if (auth.currentUser) await signOut(auth);
      await deleteApp(app);
    },
  };
}

export function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function deferred(timeoutMs, label) {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
  return { promise: promise.finally(() => clearTimeout(timer)), resolve, reject };
}

export function stats(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples,
    median: sorted[Math.floor(sorted.length / 2)],
    nearestRankP95: sorted[Math.ceil(0.95 * sorted.length) - 1],
  };
}

export async function measure(operation) {
  for (let index = 0; index < 2; index += 1) await operation(index, true);
  const samples = [];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    await operation(index, false);
    samples.push(Number((performance.now() - started).toFixed(3)));
  }
  return stats(samples);
}

export async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
