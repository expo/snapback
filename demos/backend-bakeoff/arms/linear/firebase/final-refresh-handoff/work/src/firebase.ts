import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

export const projectId = "llp0102-final-linear-firebase-w3";
const app = initializeApp({
  apiKey: "fake-api-key-for-local-emulator",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  appId: "1:123456789:web:llp0102linearfirebase",
});

export const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:59121", { disableWarnings: true });
void setPersistence(auth, browserLocalPersistence);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
connectFirestoreEmulator(db, "127.0.0.1", 58121);
