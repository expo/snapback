import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";

export const projectId = "llp0102-chat-firebase-w1";
const app = initializeApp({
  apiKey: "fake-api-key-for-local-emulator",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
  appId: "1:123456789:web:llp0102chatfirebase"
});

export const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9299", { disableWarnings: true });
void setPersistence(auth, browserLocalPersistence);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
connectFirestoreEmulator(db, "127.0.0.1", 8280);

export const functions = getFunctions(app, "us-west1");
connectFunctionsEmulator(functions, "127.0.0.1", 5287);

export const rtdb = getDatabase(app);
connectDatabaseEmulator(rtdb, "127.0.0.1", 9280);
