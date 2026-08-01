// A1 local-first floor probe — Firebase official modern web path.
// Firestore persistentLocalCache (IndexedDB) + Auth (anonymous), against the
// official Emulator Suite under a demo- project id (guarantees no live
// project contact). The driver (driver.mjs) calls window.probe.* and reads
// window.probeState; all observations come from the SDK's own snapshot
// metadata (fromCache, hasPendingWrites) — never from prose.
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocs,
  initializeFirestore,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentSingleTabManager,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const bootStartedAt = performance.now();
const state = {
  phase: 'booting',
  uid: null,
  rows: [],
  fromCache: null,
  hasPendingWrites: null,
  snapshots: [],
  errors: [],
  timings: { bootStartedAt: Date.now() },
};
window.probeState = state;

const app = initializeApp({
  apiKey: 'demo-key',
  authDomain: 'demo-snapback-probe.firebaseapp.com',
  projectId: 'demo-snapback-probe',
});
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
// forceOwnership: a relaunched process takes the persistence lease from a
// still-dying predecessor. Without it the SDK silently falls back to an
// EMPTY in-memory cache when the lease is briefly held (observed: cold boot
// rendered 0 rows fromCache:true) — recorded as a reference observation.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: true }) }),
});
connectFirestoreEmulator(db, '127.0.0.1', 8181);

const records = collection(db, 'probeRecords');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('records');

function render() {
  statusEl.textContent = `${state.phase} · uid=${state.uid ?? '—'} · fromCache=${state.fromCache} · pendingWrites=${state.hasPendingWrites} · rows=${state.rows.length}`;
  listEl.replaceChildren(...state.rows.map((row) => {
    const li = document.createElement('li');
    li.dataset.testid = `record-${row.key}`;
    li.textContent = `${row.title} · ${row.notes ?? ''} · pending=${row.pending}`;
    return li;
  }));
}

async function ensureAuth() {
  // Auth state persists in IndexedDB per profile: a relaunch restores the
  // same anonymous uid without network. Only sign in when nothing restored.
  const restored = await new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
  if (restored) return restored;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

window.probe = {
  async init() {
    try {
      const user = await ensureAuth();
      state.uid = user.uid;
      state.timings.authReadyMs = Math.round(performance.now() - bootStartedAt);
      const q = query(records, orderBy('position'));
      onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        state.rows = snapshot.docs.map((d) => ({
          id: d.id,
          key: d.data().key,
          title: d.data().title,
          notes: d.data().notes ?? '',
          position: d.data().position,
          revision: d.data().revision ?? 0,
          pending: d.metadata.hasPendingWrites,
        }));
        state.fromCache = snapshot.metadata.fromCache;
        state.hasPendingWrites = snapshot.metadata.hasPendingWrites;
        state.snapshots.push({
          atMs: Math.round(performance.now() - bootStartedAt),
          rows: snapshot.size,
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        });
        if (state.snapshots.length === 1) {
          state.timings.firstSnapshotMs = Math.round(performance.now() - bootStartedAt);
        }
        state.phase = 'subscribed';
        render();
      }, (error) => {
        state.errors.push({ at: 'onSnapshot', code: error.code ?? null, message: String(error.message ?? error) });
        state.phase = 'snapshot-error';
        render();
      });
    } catch (error) {
      state.errors.push({ at: 'init', code: error.code ?? null, message: String(error.message ?? error) });
      state.phase = 'init-error';
      render();
      throw error;
    }
  },

  // Deterministic doc id from the client key => idempotent create, and the
  // same identity across offline queue + replay (mirrors the A1 clientKey).
  async createRecord(key, title, position) {
    const write = setDoc(doc(records, key), {
      key, title, position,
      notes: '',
      revision: 1,
      createdAt: serverTimestamp(),
    });
    // Offline: the promise does not resolve until the server acks. Latency
    // compensation renders it immediately; don't await here.
    write.catch((error) => {
      state.errors.push({ at: `createRecord:${key}`, code: error.code ?? null, message: String(error.message ?? error) });
    });
    return 'dispatched';
  },

  async updateNotes(key, notes, revision) {
    const write = updateDoc(doc(records, key), { notes, revision, editedAt: serverTimestamp() });
    write.catch((error) => {
      state.errors.push({ at: `updateNotes:${key}`, code: error.code ?? null, message: String(error.message ?? error) });
    });
    return 'dispatched';
  },

  async addUnkeyed(title, position) {
    const write = addDoc(records, { key: `auto-${Date.now()}`, title, position, notes: '', revision: 1 });
    write.catch((error) => {
      state.errors.push({ at: 'addUnkeyed', code: error.code ?? null, message: String(error.message ?? error) });
    });
    return 'dispatched';
  },
};

// Deterministic probe-data cleanup: delete every probeRecords doc through
// the same authenticated SDK instance.
window.probeCleanup = async () => {
  const snapshot = await getDocs(records);
  await Promise.all(snapshot.docs.map((d) => deleteDoc(doc(records, d.id))));
  return snapshot.size;
};

state.phase = 'ready';
render();
