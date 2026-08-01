// Faceplate / Firebase arm (LLP 0139 App A): hosted probe project (client
// config is semi-public by design; no secrets here). Web SDK path:
// email-password auth + Cloud Storage uploadBytes + getDownloadURL.
// Namespace ub-a-fb/ under the bucket; cleanup deletes the objects and
// proves absence; auth users remain (client SDK cannot delete other
// users; own-user delete attempted) — recorded per the 0102 amendment.
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, deleteUser } from 'firebase/auth';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const app = initializeApp({
  apiKey: 'AIzaSyCQTg1pK8bsBn8XnWZ97X4Ln7Y_tCkVMzs',
  authDomain: 'snapback-probe.firebaseapp.com',
  projectId: 'snapback-probe',
  storageBucket: 'snapback-probe.firebasestorage.app',
});
const evidence = {};
const suffix = Date.now().toString(36);
const mkUser = async (label) => {
  const auth = getAuth(app);
  const email = `ub-a-fb-${label}-${suffix}@faceplate.test`;
  const cred = await createUserWithEmailAndPassword(auth, email, 'pw-123456789').catch(() => signInWithEmailAndPassword(auth, email, 'pw-123456789'));
  return cred.user;
};

const t0 = Date.now();
const storage = getStorage(app);
const auth = getAuth(app);
const ada = await mkUser('ada');
evidence.check1_twoUsers = 'email-password via client SDK on the hosted probe project (auth switches user in one SDK instance; two identities exercised serially)';

const gps = gpsJpegBytes();
const path1 = `ub-a-fb/${ada.uid}/avatar-1.jpg`;
const r1 = ref(storage, path1);
let uploadOutcome;
try {
  await uploadBytes(r1, gps, { contentType: 'image/jpeg' });
  uploadOutcome = 'allowed';
} catch (e) {
  uploadOutcome = e.code ?? String(e);
}
evidence.storageRulesPosture = { authenticatedUpload: uploadOutcome };
if (uploadOutcome !== 'allowed') {
  console.log(JSON.stringify({ ok: false, evidence, note: 'storage rules deny; hosted arm limited to this posture record' }, null, 2));
  process.exit(0);
}
const url1 = await getDownloadURL(r1);
const own = await fetch(url1);
const ownBytes = Buffer.from(await own.arrayBuffer());
assert.equal(own.status, 200);
evidence.check2_ownAvatarServes = { bytes: ownBytes.length, ms: Date.now() - t0 };

// user B: sign in as a second identity, then fetch the URL (tokened)
const grace = await mkUser('grace');
evidence.check3_otherUserViews = { status: (await fetch(url1)).status, note: 'download URL carries a long-lived token — any holder fetches' };
evidence.check4_gpsServed = { uploadedHadGps: true, servedHasGps: hasGpsExif(ownBytes), mechanism: 'original bytes served; no processing without the paid Resize Images extension' };

await signInWithEmailAndPassword(auth, ada.email, 'pw-123456789');
const path2 = `ub-a-fb/${ada.uid}/avatar-2.jpg`;
const r2 = ref(storage, path2);
await uploadBytes(r2, gpsJpegBytes(), { contentType: 'image/jpeg' });
const url2 = await getDownloadURL(r2);
const newRes = await fetch(url2);
evidence.check5_replaceVisible = { newStatus: newRes.status, cache: newRes.headers.get('cache-control'), note: 'distinct-path strategy (recommended for cache safety); same-path re-upload keeps the URL but caches go stale' };
evidence.check6_oldAfterReplace = { oldUrlStatus: (await fetch(url1)).status, note: 'old object remains stored + tokened URL keeps serving until app code deletes it' };
evidence.check7_signedOutFetch = { status: (await fetch(url2)).status, default: 'download URLs are public-by-token; rules gate SDK reads, not token URLs' };
evidence.check8_ceremony = {
  concepts: ['bucket refs', 'security rules language', 'uploadBytes', 'getDownloadURL + token model', 'auth SDK', 'distinct-path cache convention'],
  steps: 'client config → auth → uploadBytes → getDownloadURL (rules authored in console/CLI, pre-existing here)',
};
console.log(JSON.stringify({ ok: true, evidence }, null, 2));

// namespace cleanup + absence proof
await deleteObject(r2);
await deleteObject(r1);
const gone1 = await fetch(url1);
const gone2 = await fetch(url2);
let usersDeleted = 0;
try { await deleteUser(getAuth(app).currentUser); usersDeleted += 1; } catch {}
try { await signInWithEmailAndPassword(auth, grace.email, 'pw-123456789'); await deleteUser(getAuth(app).currentUser); usersDeleted += 1; } catch {}
console.error(JSON.stringify({ cleanupProof: { oldUrlAfterDelete: gone1.status, newUrlAfterDelete: gone2.status, usersDeleted } }));
assert.ok(gone1.status >= 400 && gone2.status >= 400);
process.exit(0);
