// Party Wall / Firebase arm (LLP 0139 App B). App A finding stands: Cloud
// Storage is unprovisioned on the hosted probe project (Blaze-plan cliff),
// so the photo-bytes half remains an ACCESS GAP. This driver measures the
// half that is reachable: Cloud Firestore listeners for feed liveness with
// photo *metadata* documents, plus the auth posture. Whole-app verdict:
// PARTIAL / ACCESS-GAPPED, per the 0102 amendment's evidence-confidence
// rule. Client config is semi-public by design; no secrets here.
import { initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, signOut, deleteUser } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, getFirestore, onSnapshot, query, setDoc, where } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyCQTg1pK8bsBn8XnWZ97X4Ln7Y_tCkVMzs',
  authDomain: 'snapback-probe.firebaseapp.com',
  projectId: 'snapback-probe',
  storageBucket: 'snapback-probe.firebasestorage.app',
});
const evidence = { posture: 'PARTIAL / ACCESS-GAPPED — storage half unprovisioned (App A finding); Firestore listener half measured below where reachable' };
const suffix = Date.now().toString(36);
const NS = `ub-b-fb-${suffix}`;
const auth = getAuth(app);
const db = getFirestore(app);
const waitFor = (predicate, label, timeoutMs = 15_000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => {
    const value = predicate();
    if (value) return resolve({ value, ms: Date.now() - start });
    if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${label}`));
    setTimeout(tick, 20);
  };
  tick();
});

let outcome = 'unknown';
const cleanupUsers = [];
try {
  const mkUser = async (label) => {
    const email = `${NS}-${label}@party.test`;
    const cred = await createUserWithEmailAndPassword(auth, email, 'pw-123456789')
      .catch(() => signInWithEmailAndPassword(auth, email, 'pw-123456789'));
    cleanupUsers.push(email);
    return cred.user;
  };

  const ada = await mkUser('ada');
  evidence.check1_identities = 'email-password client SDK on the hosted probe project (serial identities in one SDK instance)';

  // Firestore reachability probe: one namespaced doc write.
  let firestoreReachable = true;
  try {
    await setDoc(doc(db, NS, 'probe'), { at: Date.now() });
  } catch (e) {
    firestoreReachable = false;
    evidence.firestore = { reachable: false, code: e.code ?? String(e), note: 'Cloud Firestore not provisioned/ruled for client writes on this project — listener half also access-gapped' };
  }

  if (firestoreReachable) {
    // Check 2 (metadata half): listener subscribes FIRST; bursts arrive as
    // snapshot pushes over the SDK's listen channel; no client polls.
    const feedLog = [];
    const feed = query(collection(db, NS), where('kind', '==', 'photo'));
    const unsubscribe = onSnapshot(feed, (snap) => {
      feedLog.push({ at: Date.now(), captions: snap.docs.map((d) => d.data().caption).filter(Boolean) });
    });
    const posted = [];
    for (let i = 0; i < 5; i += 1) {
      const postedAt = Date.now();
      await setDoc(doc(db, NS, `photo-${i}`), { kind: 'photo', caption: `photo-${i}`, author: ada.uid, note: 'metadata only — bytes half is the access gap' });
      const seen = await waitFor(() => feedLog.find((f) => f.captions.includes(`photo-${i}`)), `snapshot for photo-${i}`);
      posted.push({ caption: `photo-${i}`, pushMsFromWrite: seen.value.at - postedAt });
    }
    evidence.check2_liveBurst_metadataHalf = {
      mechanism: 'Firestore onSnapshot listener (SDK listen channel); no client polls',
      perDocPushMs: posted.map((p) => p.pushMsFromWrite),
      note: 'photo BYTES unmeasurable (storage gap); this is document liveness only',
    };

    // Check 5 (metadata half): delete propagates.
    const deletedAt = Date.now();
    await deleteDoc(doc(db, NS, 'photo-0'));
    const drop = await waitFor(() => feedLog.find((f) => f.at > deletedAt && !f.captions.includes('photo-0')), 'post-delete snapshot');
    evidence.check5_delete_metadataHalf = { pushMsFromDelete: drop.value.at - deletedAt, bytesFate: 'gap (no storage)' };
    unsubscribe();

    // Authorization posture: what the project's rules actually admit for a
    // SECOND authenticated user and signed-out reads, recorded (rules are
    // console-owned; no membership model deployable from here).
    await signOut(auth);
    const grace = await mkUser('grace');
    let otherUserRead;
    try {
      const snap = await getDocs(query(collection(db, NS)));
      otherUserRead = `allowed (${snap.size} docs)`;
    } catch (e) { otherUserRead = e.code ?? String(e); }
    await signOut(auth);
    let signedOutRead;
    try {
      const snap = await getDocs(query(collection(db, NS)));
      signedOutRead = `allowed (${snap.size} docs)`;
    } catch (e) { signedOutRead = e.code ?? String(e); }
    evidence.check3_7_authorizationPosture = {
      otherAuthenticatedUserRead: otherUserRead,
      signedOutRead,
      note: 'security rules are project-console state; a membership model (checks 3/4/7 proper) needs rules deployment this credential set cannot perform — recorded as the rules-authoring gap',
    };
    evidence.check4_revocation = 'unmeasurable here: revocation semantics live in security rules + rule re-evaluation on listeners; recorded as claims-only (docs: listeners re-evaluate on auth token change; no retraction of delivered snapshots)';
    evidence.check6_gps = 'gap (no storage); docs claim originals serve as stored via public-by-token download URLs; EXIF strip requires the paid Resize Images extension';
    outcome = 'PARTIAL';

    // cleanup: namespace docs
    const all = await (async () => { await signInWithEmailAndPassword(auth, `${NS}-ada@party.test`, 'pw-123456789'); return getDocs(query(collection(db, NS))); })();
    for (const d of all.docs) await deleteDoc(d.ref);
    const after = await getDocs(query(collection(db, NS)));
    evidence.cleanup = { namespaceDocsRemaining: after.size };
  } else {
    outcome = 'ACCESS GAP (both halves)';
  }

  evidence.check8_ceremony = {
    concepts: ['firebase app config', 'auth SDK', 'firestore SDK + listeners', 'security rules (console-owned)', 'storage SDK (gapped)', 'billing plan gate'],
    note: 'two-product split (Firestore + Storage) is itself the ceremony finding: photo feed = two authorization models + a paid-plan gate',
  };

  // best-effort auth cleanup: delete the currently signed-in user(s)
  for (const email of cleanupUsers) {
    try {
      await signInWithEmailAndPassword(auth, email, 'pw-123456789');
      await deleteUser(auth.currentUser);
    } catch { /* recorded posture: client SDK deletes only its own signed-in user */ }
  }
  console.log(JSON.stringify({ ok: true, outcome, evidence }, null, 2));
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({ ok: false, outcome, error: e.code ?? String(e), evidence }, null, 2));
  process.exit(1);
}
