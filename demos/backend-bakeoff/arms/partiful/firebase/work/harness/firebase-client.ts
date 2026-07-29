import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from "firebase/functions";
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";
import { EMULATORS, PROJECT_ID, REGION } from "./constants.ts";

export type ActorCredential = {
  uid: string;
  email: string;
  password: string;
};

export type Client = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
  credential?: ActorCredential;
};

let ordinal = 0;

export async function createClient(credential?: ActorCredential): Promise<Client> {
  ordinal += 1;
  const app = initializeApp({
    apiKey: "demo-api-key",
    appId: `demo:partiful:${ordinal}`,
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    storageBucket: `${PROJECT_ID}.appspot.com`,
  }, `partiful-${ordinal}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${EMULATORS.auth.host}:${EMULATORS.auth.port}`, {
    disableWarnings: true,
  });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, EMULATORS.firestore.host, EMULATORS.firestore.port);
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, EMULATORS.functions.host, EMULATORS.functions.port);
  const storage = getStorage(app);
  connectStorageEmulator(storage, EMULATORS.storage.host, EMULATORS.storage.port);
  if (credential) {
    const session = await signInWithEmailAndPassword(
      auth,
      credential.email,
      credential.password,
    );
    if (session.user.uid !== credential.uid) {
      throw new Error(`actor uid mismatch for ${credential.email}`);
    }
  }
  return { app, auth, db, functions, storage, credential };
}

export async function destroyClient(client: Client): Promise<void> {
  if (client.auth.currentUser) await signOut(client.auth);
  await deleteApp(client.app);
}
