import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions
} from "firebase/functions";
import {
  connectDatabaseEmulator,
  getDatabase
} from "firebase/database";

export const projectId = "llp0102-final-chat-firebase-w2";
export const password = "CorrectHorseBattery1!";
export const personas = {
  alice: "alice@example.test",
  bob: "bob@example.test",
  mallory: "mallory@example.test"
};

export function config() {
  return {
    apiKey: "fake-api-key-for-local-emulator",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    appId: "1:123456789:web:llp0102finalchatfirebasew2"
  };
}

export async function actor(name) {
  const app = initializeApp(config(), `${name}-${crypto.randomUUID()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:35299", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 35280);
  const functions = getFunctions(app, "us-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 35287);
  const rtdb = getDatabase(app);
  connectDatabaseEmulator(rtdb, "127.0.0.1", 35281);
  await signInWithEmailAndPassword(auth, personas[name], password);
  return {
    name,
    app,
    auth,
    db,
    functions,
    rtdb,
    uid: auth.currentUser.uid,
    async close() {
      if (auth.currentUser) await signOut(auth);
      await deleteApp(app);
    }
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function deferred(timeoutMs, label) {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
  return {
    promise: promise.finally(() => clearTimeout(timer)),
    resolve,
    reject
  };
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples,
    median: sorted[Math.floor(sorted.length / 2)],
    nearestRankP95: sorted[Math.ceil(0.95 * sorted.length) - 1]
  };
}

export async function measure(operation, warmups = 2, samples = 7) {
  for (let index = 0; index < warmups; index += 1) await operation(index, true);
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await operation(index, false);
    values.push(Number((performance.now() - start).toFixed(3)));
  }
  return stats(values);
}
