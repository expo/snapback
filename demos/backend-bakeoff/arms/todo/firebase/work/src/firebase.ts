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
} from "firebase/firestore";

const projectId = "demo-llp0102-todo-firebase";
const app = initializeApp({
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
});

export const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9102", { disableWarnings: true });
void setPersistence(auth, browserLocalPersistence);

export const firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({}),
});
connectFirestoreEmulator(firestore, "127.0.0.1", 8085);
