import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const app = initializeApp({
  apiKey: "demo-research-room",
  authDomain: "llp0102-research-firebase-w3.firebaseapp.com",
  projectId: "llp0102-research-firebase-w3",
  storageBucket: "llp0102-research-firebase-w3.appspot.com",
  appId: "1:000000000000:web:researchroom",
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");
export const storage = getStorage(app);

if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
  connectAuthEmulator(auth, "http://127.0.0.1:9342", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8342);
  connectFunctionsEmulator(functions, "127.0.0.1", 5342);
  connectStorageEmulator(storage, "127.0.0.1", 9442);
}
