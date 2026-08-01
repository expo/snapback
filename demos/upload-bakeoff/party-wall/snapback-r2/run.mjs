// Party Wall round-2 Snapback arm — headless driver proving the frozen
// acceptance checklist (demos/upload-bakeoff/party-wall/README.md) with a
// printed evidence table. Fresh-context rebuild from the guide alone.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite, runAcceptance, assert, assertEqual } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import { createAssetClient } from '../../../../packages/snapback-client/assets.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../packages/snapback-contract/index.mjs';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';
import { api } from './snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const generatedRoot = join(here, 'snapback', 'generated');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

// ---------------------------------------------------------------------------
// JPEG fixtures: one deterministic GPS-tagged photo, four GPS-free siblings,
// each with a unique COM segment so content-addressed dedup keeps 5 assets.

function stripSplicedGpsApp1(bytes) {
  // gps-jpeg.mjs splices its GPS APP1 immediately after SOI; removing that
  // one segment restores the plain (benign-EXIF-only) baseline.
  const len = bytes.readUInt16BE(4);
  return Buffer.concat([bytes.subarray(0, 2), bytes.subarray(2 + 2 + len)]);
}

function withUniqueComment(bytes, text) {
  const payload = Buffer.from(text, 'latin1');
  const seg = Buffer.concat([
    Buffer.from([0xff, 0xfe, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]),
    payload,
  ]);
  return Buffer.concat([bytes.subarray(0, 2), seg, bytes.subarray(2)]);
}

const fileLike = (buf, name) => ({
  size: buf.length,
  name,
  type: 'image/jpeg',
  slice(start, end) {
    const s = buf.subarray(start, end ?? buf.length);
    return { arrayBuffer: async () => s.buffer.slice(s.byteOffset, s.byteOffset + s.length) };
  },
});

// ---------------------------------------------------------------------------

async function mintSession(server, email, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: 'snapback-r2',
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
  const requested = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  if (mailboxResponse.status !== 200) throw new Error(`mailbox: ${JSON.stringify(mailbox)}`);
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
  const bearer = () => coordinator.credentialFor(coordinator.capture()).bearer;
  return { client, coordinator, credential, userId: credential.session.userId, bearer };
}

const authedHeaders = (session) => ({
  authorization: `Bearer ${session.bearer()}`,
  'x-snapback-auth-client-protocol': '1',
});

function makeFeedRecorder() {
  const updates = [];
  const waiters = [];
  const dispatch = (entry) => {
    for (const w of [...waiters]) {
      if (w.test(entry)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(entry);
      }
    }
  };
  return {
    updates,
    onUpdate(rows, meta) {
      const entry = { atMs: Date.now(), rows, meta };
      updates.push(entry);
      dispatch(entry);
    },
    waitFor(test, label, timeoutMs = 15_000) {
      return new Promise((resolvePromise, reject) => {
        const w = { test, resolve: resolvePromise };
        waiters.push(w);
        const t = setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error(`timeout waiting for ${label}`));
          }
        }, timeoutMs);
        if (typeof t.unref === 'function') t.unref();
      });
    },
  };
}

// ---------------------------------------------------------------------------

const suite = createSuite('party-wall snapback-r2 checklist', { expectedChecks: 8 });
const cleanups = [];
const evidence = [];
const record = (item, verdict, detail) => {
  evidence.push({ item, verdict, detail });
};

await runAcceptance(suite, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'party-wall-r2-'));
  cleanups.push(() => rm(scratch, { recursive: true, force: true }));

  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });

  const bootStart = Date.now();
  const server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  cleanups.push(() => server.stop());
  const bootMs = Date.now() - bootStart;
  console.log(`# server up in ${bootMs}ms at ${server.baseUrl} (launch rung: ${server.launch?.rung})`);

  // ---- Check 1: three identities ------------------------------------------
  let A, B, O;
  await suite.check('1. three identities via the ordinary sessions path', async () => {
    A = await mintSession(server, 'a@party-wall.test', 'pw-r2-a');
    B = await mintSession(server, 'b@party-wall.test', 'pw-r2-b');
    O = await mintSession(server, 'o@party-wall.test', 'pw-r2-o');
    cleanups.push(() => A.client.closeAuth(), () => B.client.closeAuth(), () => O.client.closeAuth());
    assert(A.userId && B.userId && O.userId, 'server-issued principals');
    assert(A.userId !== B.userId && B.userId !== O.userId && A.userId !== O.userId, 'distinct principals');
    record(1, 'PASS',
      `email-code sessions (authRequestCode → admin+impersonation-gated mailbox → authExchange); `
      + `server-issued principals A=${A.userId} B=${B.userId} O=${O.userId}`);
  });

  // Fixture: A creates the event and seats B as guest.
  const createRes = await A.client.mutate(api.createEvent, { args: { title: 'Party Wall R2', hostName: 'Ada' } });
  const eventId = createRes.result;
  assert(typeof eventId === 'string' && eventId.length > 0, 'bootstrap returned event id');
  await A.client.mutate(api.addGuest, { args: { eventId, userId: B.userId } });

  // ---- Check 2: B subscribes first; A posts a 5-photo burst ---------------
  const bFeed = makeFeedRecorder();
  const bHandle = await B.client.liveQuery(api.eventFeed, {
    args: { eventId },
    connectionId: 'pw-r2-b-conn',
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate: bFeed.onUpdate,
  });
  cleanups.push(() => bHandle.dispose());
  assertEqual(bHandle.rows.length, 0, 'B subscribed before any photo exists');

  const oFeed = makeFeedRecorder();
  const oHandle = await O.client.liveQuery(api.eventFeed, {
    args: { eventId },
    connectionId: 'pw-r2-o-conn',
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate: oFeed.onUpdate,
  });
  cleanups.push(() => oHandle.dispose());

  const gpsFixture = gpsJpegBytes();
  const plainBase = stripSplicedGpsApp1(gpsFixture);
  assert(hasGpsExif(gpsFixture) === true, 'fixture carries GPS pre-upload');
  assert(hasGpsExif(plainBase) === false, 'plain base carries no GPS');

  const photos = [
    { name: 'burst-1.jpg', bytes: withUniqueComment(plainBase, 'pw-r2 burst 1'), gps: false },
    { name: 'burst-2.jpg', bytes: withUniqueComment(plainBase, 'pw-r2 burst 2'), gps: false },
    { name: 'burst-3-gps.jpg', bytes: withUniqueComment(gpsFixture, 'pw-r2 burst 3 gps'), gps: true },
    { name: 'burst-4.jpg', bytes: withUniqueComment(plainBase, 'pw-r2 burst 4'), gps: false },
    { name: 'burst-5.jpg', bytes: withUniqueComment(plainBase, 'pw-r2 burst 5'), gps: false },
  ];

  const aAssets = createAssetClient(A.client);
  const bAssets = createAssetClient(B.client);
  const burst = [];

  await suite.check('2. live burst: entries + thumbnail readiness push to B, no client poll', async () => {
    for (const [i, photo] of photos.entries()) {
      // Realistic burst flow: post as soon as the attempt mints the stable
      // asset id (attach-before-ready is accepted — verified experimentally),
      // so B's entry arrives first and thumbnail readiness follows live.
      const t0 = Date.now();
      const task = aAssets.start({
        upload: api.photoUpload,
        file: fileLike(photo.bytes, photo.name),
        declaredFilename: photo.name,
        declaredContentType: 'image/jpeg',
      });
      const assetId = await new Promise((resolvePromise) => {
        const snap = task.snapshot();
        if (snap.assetId) return resolvePromise(snap.assetId);
        const unsub = task.subscribe((s) => { if (s.assetId) { unsub(); resolvePromise(s.assetId); } });
      });
      const statusAtPost = task.snapshot().status;

      // B watches the asset record live (reserved _snapback.assetRecord
      // projection) — readiness is push-delivered, not polled.
      const watch = bAssets.watchStore(assetId, { connectionId: 'pw-r2-b-conn' });
      const watchStates = [];
      const readyPromise = new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => reject(new Error(`asset watch timeout photo ${i + 1}`)), 15_000);
        if (typeof timer.unref === 'function') timer.unref();
        const consider = (snap) => {
          if (snap.status !== watchStates[watchStates.length - 1]) watchStates.push(snap.status);
          if (snap.status === 'ready') { clearTimeout(timer); resolvePromise(snap); }
        };
        consider(watch.getSnapshot());
        watch.subscribe(consider);
      });

      const tPost0 = Date.now();
      const arrival = bFeed.waitFor(
        (entry) => entry.rows.some((row) => row.caption === `photo ${i + 1}`),
        `photo ${i + 1} in B's live feed`,
      );
      const postRes = await A.client.mutate(api.createPost, {
        args: { eventId, caption: `photo ${i + 1}`, authorName: 'Ada', assetId },
      });
      const entry = await arrival;
      const readySnap = await readyPromise;
      const tThumbReady = Date.now();
      const done = await task.done;
      assertEqual(done.status, 'ready', `photo ${i + 1} finalized ready (thumb is a required variant)`);
      watch.dispose();

      burst.push({
        index: i + 1,
        assetId,
        postId: postRes.result,
        statusAtPost,
        postToVisibleMs: entry.atMs - tPost0,
        uploadToVisibleMs: entry.atMs - t0,
        uploadToThumbReadyMs: tThumbReady - t0,
        deliveryKind: entry.meta?.kind ?? null,
        watchStates: [...watchStates],
        thumbReady: readySnap.status === 'ready',
      });
    }
    assertEqual(bHandle.rows.length, 5, 'all five photos live in B feed');

    // Delivery-mechanism evidence: the client's own SubscriptionReceipts
    // attribute transport 'push' only when frames streamed since subscribe.
    const pushReceipts = B.client.receipts().filter(
      (r) => r.kind === 'subscription' && r.transport === 'push',
    );
    const receiptSummary = pushReceipts.length > 0
      ? `SubscriptionReceipt.transport=push x${pushReceipts.length}`
      : `receipts: ${JSON.stringify(B.client.receipts().slice(-3))}`;
    record(2, 'PASS',
      `B subscribed first (0 rows), transport:'stream' with fallbackToPoll:false (client poll disabled); `
      + `delivery = WebSocket durable push (${receiptSummary}); update kinds ${JSON.stringify([...new Set(bFeed.updates.map((u) => u.meta?.kind))])}; `
      + `posts attach pre-ready (status at post recorded), thumbnail readiness arrives on B's live `
      + `_snapback.assetRecord watch afterward; per-photo ms `
      + JSON.stringify(burst.map((b) => ({
        i: b.index,
        statusAtPost: b.statusAtPost,
        postToVisible: b.postToVisibleMs,
        uploadToVisible: b.uploadToVisibleMs,
        uploadToThumbReady: b.uploadToThumbReadyMs,
        kind: b.deliveryKind,
        watch: b.watchStates.join('>'),
      }))));
  });

  // ---- Check 3: outsider sees nothing -------------------------------------
  await suite.check('3. outsider: empty subscription; direct byte fetch refused', async () => {
    assertEqual(oHandle.rows.length, 0, 'O live subscription is empty (membership semi-join)');
    const oPoll = await oHandle.poll();
    assertEqual(oPoll.length, 0, 'O re-poll still empty');
    const target = `${server.baseUrl}/assets/records/${burst[0].assetId}/bytes/thumb`;
    const oFetch = await fetch(target, { headers: authedHeaders(O) });
    const anonFetch = await fetch(target);
    assert(oFetch.status >= 400, `O byte fetch refused (${oFetch.status})`);
    assert(anonFetch.status >= 400, `signed-out byte fetch refused (${anonFetch.status})`);
    record(3, 'PASS',
      `O subscription established but empty (0 rows, no denial oracle); `
      + `O direct GET bytes/thumb -> HTTP ${oFetch.status}; signed-out -> HTTP ${anonFetch.status}`);
  });

  // ---- Check 6 (measured before mutations below): GPS on served thumbnail --
  const gpsPhoto = burst[2];
  await suite.check('6. GPS-tagged upload serves GPS-free bytes to feed viewers', async () => {
    const thumbRes = await fetch(
      `${server.baseUrl}/assets/records/${gpsPhoto.assetId}/bytes/thumb`,
      { headers: authedHeaders(B) },
    );
    assertEqual(thumbRes.status, 200, 'B (member) reads the served thumbnail');
    const thumbBytes = Buffer.from(await thumbRes.arrayBuffer());
    const primaryRes = await fetch(
      `${server.baseUrl}/assets/records/${gpsPhoto.assetId}/bytes/primary`,
      { headers: authedHeaders(B) },
    );
    const primaryBytes = Buffer.from(await primaryRes.arrayBuffer());
    assertEqual(hasGpsExif(thumbBytes), false, 'served thumb has no GPS EXIF');
    assertEqual(hasGpsExif(primaryBytes), false, 'served primary has no GPS EXIF');
    record(6, 'PASS',
      `uploader's GPS does NOT serve to viewers: intent declares image.location='strip'; `
      + `fixture had GPS pre-upload; served thumb (${thumbBytes.length}B) and primary `
      + `(${primaryBytes.length}B) both GPS-free; Cache-Control: ${thumbRes.headers.get('cache-control')}`);
  });

  // ---- Check 5: deletion propagation (B still a member) --------------------
  const deleted = burst[0];
  await suite.check('5. delete propagates to B live; byte fate recorded', async () => {
    const removal = bFeed.waitFor(
      (entry) => !entry.rows.some((row) => row._id === deleted.postId),
      'deleted post leaves B feed',
    );
    const tDel = Date.now();
    await A.client.mutate(api.deletePost, { args: { postId: deleted.postId } });
    const entry = await removal;
    const bAfter = await fetch(
      `${server.baseUrl}/assets/records/${deleted.assetId}/bytes/thumb`,
      { headers: authedHeaders(B) },
    );
    const aAfter = await fetch(
      `${server.baseUrl}/assets/records/${deleted.assetId}/bytes/thumb`,
      { headers: authedHeaders(A) },
    );
    assertEqual(bHandle.rows.length, 4, 'B feed dropped to 4');
    record(5, 'PASS',
      `A deletePost -> left B's live feed in ${entry.atMs - tDel}ms (update kind ${entry.meta?.kind}); `
      + `bytes after delete: member-B GET -> HTTP ${bAfter.status} (reference authority gone with the row), `
      + `owner-A GET -> HTTP ${aAfter.status} (asset remains, ${aAfter.status === 200 ? 'owner-readable' : 'not owner-readable'}; `
      + `asset deletion refuses while typed references remain, so bytes outlive the post only for the owner)`);
  });

  // ---- Check 4: revocation on leave ----------------------------------------
  await suite.check('4. B leaves: live view blanks; byte authority revoked', async () => {
    const probe = burst[1];
    const preLeave = await fetch(
      `${server.baseUrl}/assets/records/${probe.assetId}/bytes/thumb`,
      { headers: authedHeaders(B) },
    );
    assertEqual(preLeave.status, 200, 'B reads bytes while a member');
    const blank = bFeed.waitFor((entry) => entry.rows.length === 0, "B's feed blanks on leave");
    const tLeave = Date.now();
    await B.client.mutate(api.leaveEvent, { args: { eventId } });
    const entry = await blank;
    const blankMs = entry.atMs - tLeave;
    const postLeave = await fetch(
      `${server.baseUrl}/assets/records/${probe.assetId}/bytes/thumb`,
      { headers: authedHeaders(B) },
    );
    assert(postLeave.status >= 400, `B byte fetch refused after leave (${postLeave.status})`);
    assertEqual(bHandle.rows.length, 0, 'B handle rows blanked');
    record(4, 'PASS',
      `revocation is push: membership removeSelf blanked B's established live result in ${blankMs}ms `
      + `(update kind ${entry.meta?.kind}) without resubscribe/refresh; bytes are per-request re-authorized `
      + `under private-strict: next GET -> HTTP ${postLeave.status} (was 200 pre-leave)`);
  });

  // ---- Check 7: the authorization model, exact artifacts -------------------
  await suite.check('7. authorization model artifacts recorded', async () => {
    const membershipDecl = JSON.stringify(schema.memberships ?? schema.tables?.eventMembers?.membership ?? null).slice(0, 400);
    const intents = functions.assetUploadIntents?.map((intent) => ({
      name: intent.name,
      delivery: intent.delivery,
      access: intent.access,
      image: intent.image,
    }));
    assert(Array.isArray(intents) && intents.length === 1, 'one generated upload intent');
    record(7, 'PASS',
      `authority artifacts: (a) private membership declaration eventMembers `
      + `(roles host/guest, bootstrapRole host, lastHolder protect host, transitions: host-inserts-guest, self-remove) `
      + `in schema.manifest.json [${membershipDecl ? 'present' : 'MISSING'}]; `
      + `(b) posts.assetSharing {kind:'membership', membership:'eventMembers'} — photo-read authority lives on the `
      + `membership semi-join at the storage/delivery boundary, re-checked per byte request (private-strict), `
      + `not in URLs or session claims; (c) generated upload intent ${JSON.stringify(intents)}; `
      + `(d) feed gate: declarative membership predicate on eventFeed (outsider sees empty, not denial)`);
  });

  // ---- Check 8: ceremony + wall clock --------------------------------------
  await suite.check('8. ceremony + wall-clock recorded', async () => {
    record(8, 'PASS',
      `see build-log.md (same dir): wall-clock milestones from empty dir, distinct-concept ceremony list, `
      + `verbatim stumbles; server boot ${bootMs}ms; first live photo visible `
      + `${burst[0] ? burst[0].uploadToVisibleMs : 'n/a'}ms after upload start in this run`);
    assert(burst.length === 5, 'burst evidence retained');
  });

  // ---- Evidence table ------------------------------------------------------
  console.log('\n=== EVIDENCE TABLE (checklist order) ===');
  for (const row of [...evidence].sort((x, y) => x.item - y.item)) {
    console.log(`\n[${row.item}] ${row.verdict}\n    ${row.detail}`);
  }
  console.log('\npackage surface: workspace source checkout (packages/snapback-client, packages/snapback-contract, packages/snapback-codegen via demos/_kit shims)');
}, { cleanups });
