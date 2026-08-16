// Headless asset-task tests (LLP 0044 §Client upload surface; L1-14):
// - create → per-chunk-checksummed TUS → finalize with the whole-upload
//   digest, against a scripted route server;
// - the closed snapshot transitions and stable asset id across retry;
// - persisted resume facts carry ONLY the closed member set (no upload
//   URL, staging key, or bearer/signing material) and partition by
//   app + authority identity;
// - resume-after-refresh continues from the server's acknowledged offset
//   while the declared whole-upload digest still covers every byte.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  PERSISTED_RESUME_FACT_MEMBERS,
  SnapbackAssetClient,
  createMemoryAssetTaskStore,
} from './assets.mjs';
import {
  SnapbackClient,
  createExternalSessionClient,
} from './index.mjs';

const CHUNK = 8;
const AVATAR_UPLOAD_REF = Object.freeze({
  artifactKind: 'assetUploadReference',
  name: 'avatarUpload',
  intentPolicyHash: 'sha256:test-policy',
  implementationHash: 'sha256:test-implementation',
});

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, message, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function diagnosticResponse(code, message, status) {
  return Response.json({ diagnostics: [{ code, message }] }, { status });
}

function makeFile(bytes, { name = 'pic.jpg', type = 'image/jpeg' } = {}) {
  const buffer = Buffer.from(bytes);
  return {
    size: buffer.length,
    name,
    type,
    slice(start, end) {
      const piece = buffer.subarray(start, end ?? buffer.length);
      return { arrayBuffer: async () => piece };
    },
  };
}

// A scripted local target speaking the asset route family through the same
// Fetch contract the client uses. Keeping it in-process makes this package
// test runnable in restricted agents that cannot bind a loopback port.
function makeAssetServer() {
  const state = {
    assets: new Map(), // assetId -> {bytes, availability}
    attempts: new Map(), // attemptId -> {assetId, offset, chunks: [{checksum, length}]}
    nextAsset: 1,
    nextAttempt: 1,
    failNextPatch: false,
    rejectNextFinalize: false,
    refuseNextRetry: false,
    requests: [],
  };
  const scriptedFetch = async (input, init = {}) => {
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
    const body = typeof init.body === 'string'
      ? Buffer.from(init.body)
      : init.body instanceof Uint8Array
        ? Buffer.from(init.body)
        : Buffer.alloc(0);
    const url = new URL(input, 'http://snapback.test');
    state.requests.push({
      method,
      path: url.pathname,
      headers,
      body: body.toString('utf8'),
      redirect: init.redirect ?? null,
    });
    const json = (value, status = 200) => {
      return Response.json(value, { status });
    };
    const taskState = (attemptId) => {
      const attempt = state.attempts.get(attemptId);
      const asset = state.assets.get(attempt.assetId);
      return {
        assetId: attempt.assetId,
        attemptId,
        attemptState: attempt.state,
        availability: asset.availability,
        acknowledgedOffset: attempt.offset,
        totalBytes: attempt.declaredLength,
        expiresAtMs: 4102444800000,
        integrityGrade: attempt.chunks.every((chunk) => chunk.checksum)
          ? 'end-to-end-verified'
          : 'received-bytes-canonical',
      };
    };
    if (method === 'POST' && url.pathname === '/assets/attempts') {
      const parsed = JSON.parse(body.toString('utf8'));
      if (parsed.retryOfAssetId && state.refuseNextRetry) {
        state.refuseNextRetry = false;
        return json({
          diagnostics: [{
            code: 'SNAPBACK_ASSET_RETRY_INELIGIBLE',
            message: 'the underlying asset is no longer pending-eligible',
          }],
        }, 409);
      }
      if (parsed.declaredLength == null) {
        return json(
          { diagnostics: [{ code: 'SNAPBACK_ASSET_DEFERRED_LENGTH_UNSUPPORTED' }] },
          400,
        );
      }
      const assetId = parsed.retryOfAssetId ?? `asset_${state.nextAsset++}`;
      if (!state.assets.has(assetId)) {
        state.assets.set(assetId, { bytes: Buffer.alloc(0), availability: 'pending' });
      }
      const attemptId = `attempt_${state.nextAttempt++}`;
      state.attempts.set(attemptId, {
        assetId,
        state: 'open',
        offset: 0,
        declaredLength: parsed.declaredLength,
        received: Buffer.alloc(0),
        chunks: [],
      });
      return json({
        task: taskState(attemptId),
        transfer: {
          uploadUrl: `/assets/tus/${attemptId}`,
          tusResumable: '1.0.0',
          uploadLength: parsed.declaredLength,
          expiresAtMs: 4102444800000,
          checksumAlgorithms: ['sha256'],
          maxChunkBytes: CHUNK,
        },
      });
    }
    const tus = url.pathname.match(/^\/assets\/tus\/([^/]+)$/);
    if (tus) {
      const attempt = state.attempts.get(tus[1]);
      if (!attempt) return json({ diagnostics: [{ code: 'SNAPBACK_ASSET_UNKNOWN' }] }, 404);
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {
            'tus-resumable': '1.0.0',
            'upload-offset': String(attempt.offset),
            'upload-length': String(attempt.declaredLength),
          },
        });
      }
      if (method === 'PATCH') {
        if (state.failNextPatch) {
          state.failNextPatch = false;
          return json({
            diagnostics: [{
              code: 'SNAPBACK_ASSET_TEST_TRANSIENT',
              message: 'scripted transient transfer failure',
            }],
          }, 503);
        }
        const offset = Number(headers['upload-offset']);
        if (offset !== attempt.offset) {
          return json({ diagnostics: [{ code: 'SNAPBACK_ASSET_OFFSET_CONFLICT' }] }, 409);
        }
        const checksum = headers['upload-checksum'] ?? null;
        if (checksum) {
          const [algorithm, expected] = checksum.split(' ');
          assert.equal(algorithm, 'sha256');
          const actual = createHash('sha256').update(body).digest('base64');
          if (actual !== expected) {
            return json({ diagnostics: [{ code: 'SNAPBACK_ASSET_CHUNK_CHECKSUM_MISMATCH' }] }, 460);
          }
        }
        attempt.received = Buffer.concat([attempt.received, body]);
        attempt.offset += body.length;
        attempt.chunks.push({ checksum, length: body.length });
        attempt.state = attempt.offset === attempt.declaredLength ? 'transferring' : 'transferring';
        return new Response(null, {
          status: 204,
          headers: {
            'tus-resumable': '1.0.0',
            'upload-offset': String(attempt.offset),
          },
        });
      }
    }
    const finalize = url.pathname.match(/^\/assets\/attempts\/([^/]+)\/finalize$/);
    if (finalize && method === 'POST') {
      const parsed = JSON.parse(body.toString('utf8'));
      const attempt = state.attempts.get(finalize[1]);
      const digest = createHash('sha256').update(attempt.received).digest('hex');
      if (parsed.declaredDigest && parsed.declaredDigest !== digest) {
        return json({ diagnostics: [{ code: 'SNAPBACK_ASSET_DIGEST_MISMATCH' }] }, 400);
      }
      attempt.state = 'complete';
      const asset = state.assets.get(attempt.assetId);
      if (state.rejectNextFinalize) {
        state.rejectNextFinalize = false;
        asset.availability = 'rejected';
        return json({
          task: {
            ...taskState(finalize[1]),
            diagnostic: {
              code: 'SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED',
              message: 'scripted finalization rejection',
            },
          },
        });
      }
      asset.availability = 'ready';
      asset.bytes = attempt.received;
      return json({ task: taskState(finalize[1]) });
    }
    const cancel = url.pathname.match(/^\/assets\/attempts\/([^/]+)\/cancel$/);
    if (cancel && method === 'POST') {
      const attempt = state.attempts.get(cancel[1]);
      attempt.state = 'cancelled';
      return json({ task: taskState(cancel[1]) });
    }
    const record = url.pathname.match(/^\/assets\/records\/([^/]+)$/);
    if (record && method === 'GET') {
      const asset = state.assets.get(record[1]);
      if (!asset) return json({ diagnostics: [{ code: 'SNAPBACK_ASSET_UNKNOWN' }] }, 404);
      return json({ assetId: record[1], availability: asset.availability });
    }
    return json({ diagnostics: [{ code: 'SNAPBACK_ROUTE_UNKNOWN' }] }, 404);
  };
  return {
    fetch: scriptedFetch,
    close: () => {},
    closeAllConnections: () => {},
    state,
  };
}

const server = makeAssetServer();
const { state } = server;
const baseUrl = 'http://snapback.test';
const client = { baseUrl, subscribeLive: () => {} };
const originalFetch = globalThis.fetch;
globalThis.fetch = server.fetch;

// --- upload end to end: chunked, checksummed, digested ---
{
  const store = createMemoryAssetTaskStore();
  const transportCalls = [];
  // No explicit chunkBytes: the client must narrow its default to the
  // create response's declared maxChunkBytes (limits preflight,
  // 20260801-0044-limits-preflight-ergonomics).
  const assets = new SnapbackAssetClient(client, {
    taskStore: store,
    fetch: (...args) => {
      transportCalls.push(args);
      return server.fetch(...args);
    },
  });
  const payload = 'twenty-six characters here!!';
  const file = makeFile(payload);
  const seen = [];
  const task = assets.start({
    upload: AVATAR_UPLOAD_REF,
    file,
    userId: 'user_a',
    declaredFilename: 'pic.jpg',
    declaredContentType: 'image/jpeg',
    previewUrl: 'blob:preview-1',
  });
  task.subscribe((snapshot) => seen.push(snapshot.status));
  const final = await task.done;
  assert.equal(final.status, 'ready');
  assert.equal(final.assetId, 'asset_1');
  assert.equal(final.bytesTransferred, file.size);
  assert.equal(final.previewUrl, 'blob:preview-1', 'the optimistic preview survives');
  assert.equal(final.integrityBasis, 'end-to-end-verified');
  assert.deepEqual(seen[0], 'creating');
  assert.ok(seen.includes('uploading') && seen.includes('finalizing'));
  const createRequest = state.requests.find(
    (request) => request.method === 'POST' && request.path === '/assets/attempts',
  );
  assert.equal(
    JSON.parse(createRequest.body).implementationHash,
    AVATAR_UPLOAD_REF.implementationHash,
    'attempt admission carries the generated implementation identity',
  );
  // Every PATCH carried a sha256 checksum (the conformance requirement).
  const patches = state.requests.filter((request) => request.method === 'PATCH');
  assert.ok(patches.length >= 3, `chunked into multiple PATCHes: ${patches.length}`);
  for (const patch of patches) {
    assert.match(patch.headers['upload-checksum'], /^sha256 [A-Za-z0-9+/]+=*$/);
    assert.equal(patch.headers['tus-resumable'], '1.0.0');
  }
  assert.equal(
    transportCalls.length,
    state.requests.length,
    'the registered host transport owns create, TUS PATCH, and finalize',
  );
  // The client narrowed its default chunk to the declared maxChunkBytes
  // instead of discovering the ceiling by 413.
  for (const [, attempt] of state.attempts) {
    for (const chunk of attempt.chunks) {
      assert.ok(chunk.length <= CHUNK, `chunk ${chunk.length} <= declared ${CHUNK}`);
    }
  }
  // The server holds exactly the payload (digest verified at finalize).
  assert.equal(state.assets.get('asset_1').bytes.toString('utf8'), payload);
  // The finished task's persisted fact is cleaned up.
  assert.equal(store.keys().length, 0);
}

// --- persisted-fact hygiene and authority partition ---
{
  const store = createMemoryAssetTaskStore();
  const assets = new SnapbackAssetClient(client, { taskStore: store, chunkBytes: CHUNK });
  // Pause after the first chunk so the fact persists mid-transfer.
  const file = makeFile('0123456789abcdef01234567');
  const task = assets.start({ upload: AVATAR_UPLOAD_REF, file, userId: 'user_b' });
  await new Promise((resolve) => {
    const unsubscribe = task.subscribe((snapshot) => {
      if (snapshot.bytesTransferred >= CHUNK) {
        task.pause();
        unsubscribe();
        resolve();
      }
    });
  });
  const keys = store.keys();
  assert.equal(keys.length, 1);
  assert.ok(
    keys[0].includes('::user_b::'),
    `facts partition by authority identity: ${keys[0]}`,
  );
  const fact = JSON.parse(store.get(keys[0]));
  assert.deepEqual(
    Object.keys(fact).sort(),
    [...PERSISTED_RESUME_FACT_MEMBERS].sort(),
    'the fact carries exactly the closed member set',
  );
  const serialized = store.get(keys[0]);
  for (const forbidden of ['uploadUrl', 'tus', 'bearer', 'token', 'staging', 'signature']) {
    assert.ok(
      !serialized.toLowerCase().includes(forbidden.toLowerCase()),
      `persisted facts must not carry ${forbidden}`,
    );
  }

  // Resume after "refresh": a fresh client instance over the same store
  // continues from the server's acknowledged offset and still finalizes
  // with the whole-file digest.
  const reopened = new SnapbackAssetClient(client, { taskStore: store, chunkBytes: CHUNK });
  const resumed = reopened.resumePersisted({
    assetId: fact.assetId,
    file,
    userId: 'user_b',
  });
  assert.ok(resumed, 'the persisted fact resumes');
  const final = await resumed.done;
  assert.equal(final.status, 'ready');
  assert.equal(final.assetId, fact.assetId, 'resume preserves the asset id');
}

// --- retry: eligible failures get a SAME-id successor; ready/rejected refuse ---
{
  const assets = new SnapbackAssetClient(client, { chunkBytes: CHUNK });
  const file = makeFile('retry-payload-bytes-here');
  state.failNextPatch = true;
  const task = assets.start({ upload: AVATAR_UPLOAD_REF, file, userId: 'user_c' });
  const first = await task.done;
  assert.equal(first.status, 'failed');
  const successor = await task.retry();
  const second = await successor.done;
  assert.equal(second.status, 'ready');
  assert.equal(
    second.assetId,
    first.assetId,
    'retry creates a successor attempt without re-identifying the asset',
  );
  assert.notEqual(second.attemptId, first.attemptId);
  assert.strictEqual(await task.done, first, 'the predecessor settlement stays frozen');
  await assert.rejects(
    successor.retry(),
    (error) => error.code === 'SNAPBACK_ASSET_RETRY_INELIGIBLE'
      && error.diagnostic.details.predecessorStatus === 'ready',
  );
  state.refuseNextRetry = true;
  await assert.rejects(
    task.retry(),
    (error) => error.code === 'SNAPBACK_ASSET_RETRY_INELIGIBLE'
      && error.diagnostic.code === 'SNAPBACK_ASSET_RETRY_INELIGIBLE',
    'a server-proven loss of pending eligibility returns no public successor',
  );

  state.rejectNextFinalize = true;
  const rejectedTask = assets.start({
    upload: AVATAR_UPLOAD_REF,
    file: makeFile('rejected-payload'),
    userId: 'user_c',
  });
  const rejected = await rejectedTask.done;
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.diagnostic.code, 'SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED');
  await assert.rejects(
    rejectedTask.retry(),
    (error) => error.code === 'SNAPBACK_ASSET_RETRY_INELIGIBLE'
      && error.diagnostic.details.predecessorStatus === 'rejected',
  );

  const cancelledTask = assets.start({
    upload: AVATAR_UPLOAD_REF,
    file: makeFile('cancelled-payload'),
    userId: 'user_c',
  });
  await new Promise((resolve) => {
    const release = cancelledTask.subscribe((snapshot) => {
      if (snapshot.status !== 'uploading') return;
      cancelledTask.pause();
      release();
      resolve();
    });
  });
  const cancelled = await cancelledTask.cancel();
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.diagnostic.code, 'SNAPBACK_ASSET_TRANSFER_FAILED');
  const cancelledSuccessor = await cancelledTask.retry();
  const cancelledRetryResult = await cancelledSuccessor.done;
  assert.equal(cancelledRetryResult.status, 'ready');
  assert.equal(cancelledRetryResult.assetId, cancelled.assetId);
}

// --- deferred length refuses with the registered diagnostic ---
{
  const assets = new SnapbackAssetClient(client, { chunkBytes: CHUNK });
  const file = makeFile('x');
  Object.defineProperty(file, 'size', { value: undefined });
  let failed;
  try {
    assets.start({ upload: AVATAR_UPLOAD_REF, file, userId: 'user_d' });
    failed = false;
  } catch (error) {
    failed = error instanceof TypeError;
  }
  assert.ok(failed, 'a sizeless source refuses client-side (no v1 deferred length)');
}

// --- watch() establishes the reserved projection by exact name ---
{
  const calls = [];
  const watching = new SnapbackAssetClient({
    baseUrl,
    subscribeLive: (name, options) => {
      calls.push({ name, options });
      return { subscription_id: 'sub_1', snapshot: { rows: [] } };
    },
  });
  watching.watch('asset_9', { userId: 'user_a' });
  assert.equal(calls[0].name, '_snapback.assetRecord');
  assert.deepEqual(calls[0].options.args, { assetId: 'asset_9' });
}

// --- deliveryUrl shapes ---
{
  const delivering = new SnapbackAssetClient({ baseUrl, subscribeLive: () => {} });
  assert.equal(
    delivering.deliveryUrl('asset_9', { maxWidth: 256 }),
    `${baseUrl}/assets/records/asset_9/bytes/best?maxWidth=256`,
  );
  assert.equal(
    delivering.deliveryUrl('asset_9', { variant: 'thumb' }),
    `${baseUrl}/assets/records/asset_9/bytes/thumb`,
  );
  assert.equal(
    delivering.publicDeliveryUrl('asset public', { variant: 'chat' }),
    `${baseUrl}/assets/public/asset%20public/chat`,
  );
  assert.equal(
    delivering.publicDeliveryUrl('asset_9', { variant: 'primary', width: 320 }),
    `${baseUrl}/assets/public/asset_9/primary?width=320`,
  );
  let refused = false;
  try {
    delivering.deliveryUrl('asset_9');
  } catch (error) {
    refused = error instanceof TypeError;
  }
  assert.ok(refused, 'best selection without maxWidth refuses client-side');
  assert.throws(
    () => delivering.publicDeliveryUrl('asset_9', { variant: 'best' }),
    TypeError,
  );
}

// --- signedUrl: custody, DTO projection, relative resolution, and no cache ---
{
  const capture = Object.freeze({ authority: 'signed-url-a' });
  const calls = [];
  const expiresAt = Date.now() + 60_000;
  const assets = new SnapbackAssetClient({
    baseUrl: 'https://app.example.test/root',
    authProtocols: { authClient: 1 },
    authorityFence: {
      capture: () => capture,
      isCurrent: (candidate) => candidate === capture,
      credentialFor: () => ({ bearer: 'bearer_signed_url' }),
    },
    subscribeLive: () => {},
  }, {
    fetch: async (input, init) => {
      calls.push({ input, init });
      return Response.json({
        url: '/assets/signed/asset%201/primary?token=one',
        expiresAtMs: expiresAt,
        variant: 'primary',
      });
    },
  });
  const first = await assets.signedUrl('asset 1');
  const second = await assets.signedUrl('asset 1');
  assert.equal(calls.length, 2, 'bare signedUrl performs a network issuance every time');
  assert.equal(calls[0].input, 'https://app.example.test/root/assets/records/asset%201/signed-url');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer bearer_signed_url');
  assert.equal(calls[0].init.headers['x-snapback-auth-client-protocol'], '1');
  assert.equal(calls[0].init.body, '{}', 'absent options produce the valid empty body');
  assert.equal(first.url, 'https://app.example.test/assets/signed/asset%201/primary?token=one');
  assert.equal(first.expiresAt, expiresAt);
  assert.equal(first.variant, 'primary');
  assert.deepEqual(second, first);

  const externalCalls = [];
  const external = new SnapbackAssetClient({
    baseUrl: 'https://external.example.test',
    authProtocols: { authClient: 1 },
    bearerToken: 'bearer_external_signed_url',
    __authTransportGeneration: 4,
    __externalBearerTransition: null,
    subscribeLive: () => {},
  }, {
    fetch: async (_input, init) => {
      externalCalls.push(init);
      return Response.json({ url: '/signed', expiresAtMs: expiresAt, variant: 'chat' });
    },
  });
  await external.signedUrl('asset_2', { variant: 'chat', ttlMs: 5_000 });
  assert.equal(externalCalls[0].headers.authorization, 'Bearer bearer_external_signed_url');
  assert.equal(externalCalls[0].headers['x-snapback-auth-client-protocol'], '1');
  assert.deepEqual(JSON.parse(externalCalls[0].body), { variant: 'chat', ttlMs: 5_000 });
}

// --- issuedUrlStore: equal keys share one in-flight issuance ---
{
  const calls = [];
  let resolveIssuance;
  const assets = new SnapbackAssetClient({ baseUrl, subscribeLive: () => {} }, {
    fetch: (...args) => {
      calls.push(args);
      return new Promise((resolve) => { resolveIssuance = resolve; });
    },
  });
  const left = assets.issuedUrlStore('asset_shared', { variant: 'chat' });
  const right = assets.issuedUrlStore('asset_shared', { variant: 'chat' });
  assert.strictEqual(left, right, 'equal controller keys share one entry');
  const unsubscribeLeft = left.subscribe(() => {});
  const unsubscribeRight = right.subscribe(() => {});
  await nextTurn();
  assert.equal(calls.length, 1, 'two subscribers drive one issuance loop');
  resolveIssuance(Response.json({
    url: '/assets/signed/shared',
    expiresAtMs: Date.now() + 60_000,
    variant: 'chat',
  }));
  await waitFor(() => left.getSnapshot().status === 'ready', 'shared issuance becomes ready');
  unsubscribeLeft();
  unsubscribeRight();
  await nextTurn();
}

// --- issuedUrlStore refreshes before expiry and preserves a still-valid URL
// --- through a transient refresh failure before becoming unavailable. ---
{
  let calls = 0;
  const assets = new SnapbackAssetClient({ baseUrl, subscribeLive: () => {} }, {
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({
          url: '/assets/signed/short-lived',
          expiresAtMs: Date.now() + 200,
          variant: 'primary',
        });
      }
      return diagnosticResponse(
        'SNAPBACK_ASSET_TEST_TRANSIENT',
        'temporary issuance outage',
        503,
      );
    },
  });
  const store = assets.issuedUrlStore('asset_refresh');
  const unsubscribe = store.subscribe(() => {});
  await waitFor(() => store.getSnapshot().status === 'ready', 'initial URL becomes ready');
  const heldUrl = store.getSnapshot().url;
  await waitFor(() => calls >= 2, 'controller refreshes before the held URL expires');
  assert.equal(store.getSnapshot().status, 'ready', 'failed refresh stays ready while URL is valid');
  assert.equal(store.getSnapshot().url, heldUrl);
  assert.equal(store.getSnapshot().diagnostic.code, 'SNAPBACK_ASSET_TEST_TRANSIENT');
  await waitFor(
    () => store.getSnapshot().status === 'unavailable',
    'transient failures become unavailable after the held URL expires',
  );
  assert.equal(store.getSnapshot().url, null);
  unsubscribe();
  await nextTurn();
}

// --- denied is reserved for structured authorization refusals; both manual
// --- refresh and a fresh subscription re-enter issuance. ---
{
  const outcomes = [
    () => diagnosticResponse('SNAPBACK_ASSET_FORBIDDEN', 'not authorized', 403),
    () => Response.json({
      url: '/assets/signed/restored-manual',
      expiresAtMs: Date.now() + 60_000,
      variant: 'primary',
    }),
    () => diagnosticResponse('SNAPBACK_ASSET_FORBIDDEN', 'revoked again', 403),
    () => Response.json({
      url: '/assets/signed/restored-subscription',
      expiresAtMs: Date.now() + 60_000,
      variant: 'primary',
    }),
  ];
  const assets = new SnapbackAssetClient({ baseUrl, subscribeLive: () => {} }, {
    fetch: async () => outcomes.shift()(),
  });
  const store = assets.issuedUrlStore('asset_denied');
  let unsubscribe = store.subscribe(() => {});
  await waitFor(() => store.getSnapshot().status === 'denied', 'authorization refusal becomes denied');
  assert.equal(store.getSnapshot().url, null);
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'ready', 'manual refresh exits denied');
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'denied', 'revocation blanks immediately');
  unsubscribe();
  unsubscribe = store.subscribe(() => {});
  await waitFor(
    () => store.getSnapshot().status === 'ready',
    'fresh subscription under the same authority exits denied',
  );
  unsubscribe();
  await nextTurn();

  const transient = new SnapbackAssetClient({ baseUrl, subscribeLive: () => {} }, {
    fetch: async () => diagnosticResponse('SNAPBACK_ASSET_TEST_TRANSIENT', 'offline', 403),
  }).issuedUrlStore('asset_not_denied');
  const releaseTransient = transient.subscribe(() => {});
  await waitFor(
    () => transient.getSnapshot().status === 'unavailable',
    'a non-authorization refusal never becomes denied',
  );
  releaseTransient();
  await nextTurn();
}

// --- final unsubscribe fences a late issuance, evicts the entry, and a later
// --- subscription receives a fresh generation with no residual timer work. ---
{
  const pending = [];
  let calls = 0;
  const assets = new SnapbackAssetClient({ baseUrl, subscribeLive: () => {} }, {
    fetch: () => {
      calls += 1;
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  const predecessor = assets.issuedUrlStore('asset_fenced');
  const unsubscribe = predecessor.subscribe(() => {});
  await nextTurn();
  assert.equal(calls, 1);
  unsubscribe();
  await nextTurn();
  pending.shift()(Response.json({
    url: '/assets/signed/late',
    expiresAtMs: Date.now() + 20,
    variant: 'primary',
  }));
  await nextTurn();
  assert.equal(predecessor.getSnapshot().url, null, 'late response never republishes');
  const successor = assets.issuedUrlStore('asset_fenced');
  assert.notStrictEqual(successor, predecessor, 'post-eviction demand gets a fresh entry');
  const releaseSuccessor = successor.subscribe(() => {});
  await nextTurn();
  assert.equal(calls, 2, 'fresh generation starts one new issuance');
  pending.shift()(Response.json({
    url: '/assets/signed/fresh',
    expiresAtMs: Date.now() + 60_000,
    variant: 'primary',
  }));
  await waitFor(() => successor.getSnapshot().status === 'ready', 'fresh generation publishes');
  releaseSuccessor();
  await nextTurn();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 2, 'fenced late work scheduled no residual refresh');
}

// --- authority replacement synchronously blanks and evicts old entries ---
{
  let currentCapture = Object.freeze({ id: 'authority-a' });
  let blankAuthority;
  let issue = 0;
  const parent = {
    baseUrl,
    authProtocols: { authClient: 1 },
    authorityFence: {
      capture: () => currentCapture,
      isCurrent: (capture) => capture === currentCapture,
      credentialFor: () => ({ bearer: `bearer-${currentCapture.id}` }),
    },
    registerAuthMaterialization: ({ blank }) => {
      blankAuthority = blank;
      return () => {};
    },
    subscribeLive: () => {},
  };
  const assets = new SnapbackAssetClient(parent, {
    fetch: async () => {
      issue += 1;
      return Response.json({
        url: `/assets/signed/authority-${issue}`,
        expiresAtMs: Date.now() + 60_000,
        variant: 'primary',
      });
    },
  });
  const oldStore = assets.issuedUrlStore('asset_authority');
  const releaseOld = oldStore.subscribe(() => {});
  await waitFor(() => oldStore.getSnapshot().status === 'ready', 'old authority becomes ready');
  currentCapture = Object.freeze({ id: 'authority-b' });
  blankAuthority({ reason: 'authority_replaced', disposition: 'delete' });
  assert.deepEqual(
    oldStore.getSnapshot(),
    {
      url: null,
      status: 'issuing',
      diagnostic: null,
      expiresAt: null,
      rendition: null,
    },
    'authority barrier blanks synchronously',
  );
  const newStore = assets.issuedUrlStore('asset_authority');
  assert.notStrictEqual(newStore, oldStore, 'successor authority gets a fresh entry');
  const releaseNew = newStore.subscribe(() => {});
  await waitFor(() => newStore.getSnapshot().status === 'ready', 'successor authority issues fresh');
  assert.equal(issue, 2);
  releaseOld();
  releaseNew();
  await nextTurn();

  const externalParent = createExternalSessionClient(baseUrl, {
    bearerToken: 'external-authority-a',
    rqsStore: null,
    offlineQueue: false,
  });
  let externalIssues = 0;
  const externalAssets = new SnapbackAssetClient(externalParent, {
    fetch: async () => {
      externalIssues += 1;
      return Response.json({
        url: `/assets/signed/external-${externalIssues}`,
        expiresAtMs: Date.now() + 60_000,
        variant: 'primary',
      });
    },
  });
  const externalOld = externalAssets.issuedUrlStore('asset_external_authority');
  const releaseExternalOld = externalOld.subscribe(() => {});
  await waitFor(() => externalOld.getSnapshot().status === 'ready', 'external bearer becomes ready');
  const replacing = externalParent.replaceBearerToken('external-authority-b');
  assert.equal(externalOld.getSnapshot().url, null, 'external replacement blanks synchronously');
  await replacing;
  const externalNew = externalAssets.issuedUrlStore('asset_external_authority');
  assert.notStrictEqual(externalNew, externalOld);
  const releaseExternalNew = externalNew.subscribe(() => {});
  await waitFor(() => externalNew.getSnapshot().status === 'ready', 'new external bearer issues fresh');
  assert.equal(externalIssues, 2);
  releaseExternalOld();
  releaseExternalNew();
  await externalParent.closeAuth();
}

// --- empty-safe media projection: zero work, transitions, authority blank --
{
  let currentCapture = Object.freeze({ id: 'media-authority-a' });
  let blankAuthority;
  const pending = [];
  const requests = [];
  const mediaAssets = new SnapbackAssetClient({
    baseUrl,
    authProtocols: { authClient: 1 },
    authorityFence: {
      capture: () => currentCapture,
      isCurrent: (capture) => capture === currentCapture,
      credentialFor: () => ({ bearer: `bearer-${currentCapture.id}` }),
    },
    registerAuthMaterialization: ({ blank }) => {
      blankAuthority = blank;
      return () => {};
    },
    subscribeLive: () => {},
  }, {
    fetch: async (_input, init) => {
      requests.push(JSON.parse(init.body));
      return new Promise((resolve) => pending.push(resolve));
    },
  });

  const empty = mediaAssets.mediaStore(null);
  assert.deepEqual(empty.getSnapshot(), { status: 'empty', media: null });
  const releaseEmpty = empty.subscribe(() => assert.fail('empty media never publishes'));
  await nextTurn();
  assert.equal(requests.length, 0, 'null media performs no issuance');
  assert.deepEqual(
    mediaAssets.mediaStore(undefined).getSnapshot(),
    { status: 'empty', media: null },
  );
  assert.throws(
    () => mediaAssets.mediaStore(''),
    /mediaRefOrNull must be null or undefined for no media; an empty string/,
  );
  assert.throws(
    () => mediaAssets.mediaStore({ assetId: 'asset-video', kind: 'video' }, { widthPx: 320 }),
    /widthPx is supported only for image media/,
  );
  releaseEmpty();

  const media = Object.freeze({ assetId: 'asset-media', kind: 'image' });
  const store = mediaAssets.mediaStore(media, { widthPx: 640 });
  const release = store.subscribe(() => {});
  await nextTurn();
  assert.deepEqual(store.getSnapshot(), { status: 'issuing', media });
  assert.deepEqual(requests[0], { variant: 'primary', widthPx: 640 });
  const expiresAt = Date.now() + 60_000;
  pending.shift()(Response.json({
    url: '/assets/signed/media-ready',
    expiresAtMs: expiresAt,
    variant: 'primary',
  }));
  await waitFor(() => store.getSnapshot().status === 'ready', 'media issuance becomes ready');
  assert.deepEqual(store.getSnapshot(), {
    status: 'ready',
    media,
    url: `${baseUrl}/assets/signed/media-ready`,
    expiresAt,
    rendition: 'primary',
  });

  const refreshing = store.refresh();
  await nextTurn();
  assert.equal(store.getSnapshot().status, 'refreshing');
  assert.equal(store.getSnapshot().url, `${baseUrl}/assets/signed/media-ready`);
  pending.shift()(diagnosticResponse(
    'SNAPBACK_ASSET_FORBIDDEN',
    'media access was revoked',
    403,
  ));
  await refreshing;
  assert.equal(store.getSnapshot().status, 'denied');
  assert.equal('url' in store.getSnapshot(), false, 'denial carries no predecessor URL');

  currentCapture = Object.freeze({ id: 'media-authority-b' });
  blankAuthority({ reason: 'authority_replaced', disposition: 'delete' });
  assert.deepEqual(
    store.getSnapshot(),
    { status: 'issuing', media },
    'authority replacement synchronously blanks the projected URL',
  );
  release();
  console.log('media empty, argument contract, ready/refresh/denied, authority blank: ok');
}

{
  const unavailableAssets = new SnapbackAssetClient({ baseUrl, subscribeLive: () => {} }, {
    fetch: async () => diagnosticResponse(
      'SNAPBACK_ASSET_STORE_UNAVAILABLE',
      'asset store unavailable',
      503,
    ),
  });
  const store = unavailableAssets.mediaStore({ assetId: 'asset-unavailable', kind: 'file' });
  const release = store.subscribe(() => {});
  await waitFor(
    () => store.getSnapshot().status === 'unavailable',
    'media transient refusal becomes unavailable',
  );
  assert.equal(store.getSnapshot().diagnostic.code, 'SNAPBACK_ASSET_STORE_UNAVAILABLE');
  release();
  console.log('media unavailable state: ok');
}

// --- bounded collection projection: empty, mixed media, sibling isolation,
// refresh, denial/unavailability, and synchronous authority blanking ---
{
  let currentCapture = Object.freeze({ id: 'collection-authority-a' });
  let blankAuthority;
  const pending = [];
  const collectionAssets = new SnapbackAssetClient({
    baseUrl,
    authProtocols: { authClient: 1 },
    authorityFence: {
      capture: () => currentCapture,
      isCurrent: (capture) => capture === currentCapture,
      credentialFor: () => ({ bearer: `bearer-${currentCapture.id}` }),
    },
    registerAuthMaterialization: ({ blank }) => {
      blankAuthority = blank;
      return () => {};
    },
    subscribeLive: () => {},
  }, {
    fetch: async (input) => {
      const match = /\/assets\/records\/([^/]+)\/signed-url$/u.exec(new URL(input).pathname);
      assert.ok(match, `unexpected collection issuance URL ${input}`);
      return new Promise((resolve) => pending.push({
        assetId: decodeURIComponent(match[1]),
        resolve,
      }));
    },
  });

  const empty = collectionAssets.mediaCollectionStore([], null);
  assert.strictEqual(empty.getSnapshot(), empty.getServerSnapshot());
  assert.deepEqual(empty.getSnapshot(), []);
  const releaseEmpty = empty.subscribe(() => assert.fail('empty collection never publishes'));
  await empty.refresh();
  assert.equal(pending.length, 0, 'empty collection creates zero issuance/network work');
  releaseEmpty();

  const items = Object.freeze([
    Object.freeze({ itemId: 'item-image', ordinal: 0, media: Object.freeze({ assetId: 'asset-image', kind: 'image' }) }),
    Object.freeze({ itemId: 'item-video', ordinal: 1, media: Object.freeze({ assetId: 'asset-video', kind: 'video' }) }),
    Object.freeze({ itemId: 'item-unavailable', ordinal: 2, media: Object.freeze({ assetId: 'asset-unavailable', kind: 'file' }) }),
    Object.freeze({ itemId: 'item-denied', ordinal: 3, media: Object.freeze({ assetId: 'asset-denied', kind: 'image' }) }),
  ]);
  const collection = collectionAssets.mediaCollectionStore(items);
  const construction = collection.getSnapshot();
  assert.strictEqual(collection.getSnapshot(), construction, 'unchanged collection snapshot is stable');
  assert.deepEqual(
    construction.map(({ itemId, ordinal, state }) => ({ itemId, ordinal, status: state.status })),
    [
      { itemId: 'item-image', ordinal: 0, status: 'issuing' },
      { itemId: 'item-video', ordinal: 1, status: 'issuing' },
      { itemId: 'item-unavailable', ordinal: 2, status: 'issuing' },
      { itemId: 'item-denied', ordinal: 3, status: 'issuing' },
    ],
  );
  const release = collection.subscribe(() => {});
  await waitFor(() => pending.length === 4, 'every collection child begins issuance independently');
  const resolveAsset = (assetId, response) => {
    const index = pending.findIndex((request) => request.assetId === assetId);
    assert.notEqual(index, -1, `missing pending request for ${assetId}`);
    pending.splice(index, 1)[0].resolve(response);
  };
  const readyExpiry = Date.now() + 60_000;
  resolveAsset('asset-image', Response.json({
    url: '/assets/signed/collection-image',
    expiresAtMs: readyExpiry,
    variant: 'primary',
  }));
  await waitFor(
    () => collection.getSnapshot()[0].state.status === 'ready',
    'valid image sibling becomes ready',
  );
  const stableImageItem = collection.getSnapshot()[0];
  resolveAsset('asset-video', Response.json({
    url: '/assets/signed/collection-video-original',
    expiresAtMs: readyExpiry,
    variant: 'primary',
  }));
  resolveAsset('asset-unavailable', diagnosticResponse(
    'SNAPBACK_ASSET_STORE_UNAVAILABLE',
    'collection asset store unavailable',
    503,
  ));
  resolveAsset('asset-denied', diagnosticResponse(
    'SNAPBACK_ASSET_FORBIDDEN',
    'collection media access denied',
    403,
  ));
  await waitFor(
    () => collection.getSnapshot().every(({ state }) => state.status !== 'issuing'),
    'collection children settle independently',
  );
  const settled = collection.getSnapshot();
  assert.strictEqual(settled[0], stableImageItem, 'unaffected item projection retains identity');
  assert.deepEqual(settled.map(({ itemId, state }) => [itemId, state.status]), [
    ['item-image', 'ready'],
    ['item-video', 'ready'],
    ['item-unavailable', 'unavailable'],
    ['item-denied', 'denied'],
  ]);
  assert.equal('url' in settled[2].state, false);
  assert.equal('url' in settled[3].state, false);
  assert.equal(
    settled[1].state.rendition,
    'primary',
    'video delivery is projected without a portable-playability claim',
  );

  const sharedMedia = Object.freeze({ assetId: 'asset-shared', kind: 'image' });
  const shared = collectionAssets.mediaCollectionStore([
    { itemId: 'item-shared-a', ordinal: 0, media: sharedMedia },
    { itemId: 'item-shared-b', ordinal: 1, media: sharedMedia },
  ]);
  const releaseShared = shared.subscribe(() => {});
  await waitFor(
    () => pending.filter(({ assetId }) => assetId === 'asset-shared').length === 1,
    'equal collection selections share exactly one issued-URL request',
  );
  resolveAsset('asset-shared', Response.json({
    url: '/assets/signed/collection-shared',
    expiresAtMs: readyExpiry,
    variant: 'primary',
  }));
  await waitFor(
    () => shared.getSnapshot().every(({ state }) => state.status === 'ready'),
    'both stable items project the shared issued-URL entry',
  );
  assert.equal(shared.getSnapshot()[0].state.url, shared.getSnapshot()[1].state.url);
  releaseShared();

  const refreshing = settled[0].refresh();
  await waitFor(() => pending.some(({ assetId }) => assetId === 'asset-image'), 'item refresh reuses its controller');
  assert.equal(collection.getSnapshot()[0].state.status, 'refreshing');
  resolveAsset('asset-image', Response.json({
    url: '/assets/signed/collection-image-refreshed',
    expiresAtMs: Date.now() + 60_000,
    variant: 'primary',
  }));
  await refreshing;
  assert.equal(collection.getSnapshot()[0].state.status, 'ready');
  assert.match(collection.getSnapshot()[0].state.url, /collection-image-refreshed$/u);
  assert.throws(() => collection.refresh('missing-item'), /unknown itemId/);

  currentCapture = Object.freeze({ id: 'collection-authority-b' });
  blankAuthority({ reason: 'authority_replaced', disposition: 'delete' });
  assert.deepEqual(
    collection.getSnapshot().map(({ state }) => state.status),
    ['issuing', 'issuing', 'issuing', 'issuing'],
    'authority replacement synchronously blanks every collection URL',
  );
  assert.ok(collection.getSnapshot().every(({ state }) => !('url' in state)));
  release();

  assert.throws(
    () => collectionAssets.mediaCollectionStore([
      items[0],
      { ...items[1], itemId: items[0].itemId },
    ]),
    /itemId .* is duplicated/,
  );
  console.log('media collection empty/mixed/sibling/refresh/revocation states: ok');
}

// --- upload(): frozen terminal table and picker-shaped normalization ---
{
  const assets = new SnapbackAssetClient(client, {
    fetch: async () => new Response(new Blob(['picker-bytes'], { type: 'image/png' })),
  });
  const baseSnapshot = {
    assetId: 'asset_upload_helper',
    assetRef: 'asset_upload_helper',
    attemptId: 'attempt_upload_helper',
    attemptExpiresAtMs: null,
    bytesTransferred: 1,
    totalBytes: 1,
    previewUrl: null,
    integrityBasis: 'end-to-end-verified',
  };
  for (const status of ['ready', 'rejected', 'cancelled', 'failed']) {
    const diagnostic = status === 'ready'
      ? null
      : {
          code: 'SNAPBACK_ASSET_TEST_TRANSIENT',
          message: `${status} diagnostic`,
          details: { row: status },
        };
    assets.start = () => ({
      done: Promise.resolve(Object.freeze({ ...baseSnapshot, status, diagnostic })),
    });
    if (status === 'ready') {
      assert.equal(
        await assets.upload(AVATAR_UPLOAD_REF, new Blob(['x'])),
        'asset_upload_helper',
      );
    } else {
      await assert.rejects(
        assets.upload(AVATAR_UPLOAD_REF, new Blob(['x'])),
        (error) => error instanceof Error
          && error.status === status
          && error.terminalStatus === status
          && error.diagnostic.code === 'SNAPBACK_ASSET_TEST_TRANSIENT'
          && error.diagnostic.details.row === status,
      );
    }
  }

  let started;
  assets.start = (options) => {
    started = options;
    return {
      done: Promise.resolve(Object.freeze({
        ...baseSnapshot,
        assetId: 'asset_picker',
        assetRef: 'asset_picker',
        status: 'ready',
        diagnostic: null,
      })),
    };
  };
  assert.equal(
    await assets.upload(
      AVATAR_UPLOAD_REF,
      { uri: 'file:///picker/photo.png', mimeType: 'image/png', fileName: 'photo.png' },
      { args: { conversationId: 'conversation_1' } },
    ),
    'asset_picker',
  );
  assert.equal(started.file.size, Buffer.byteLength('picker-bytes'));
  assert.equal(started.declaredFilename, 'photo.png');
  assert.equal(started.declaredContentType, 'image/png');
  assert.deepEqual(started.args, { conversationId: 'conversation_1' });
}

// --- watchStore: establishment snapshot, frames, blank, dispose ---
{
  const consumers = new Set();
  const unsubscribed = [];
  const framed = new SnapbackAssetClient({
    baseUrl,
    subscribeLive: async () => ({
      subscription_id: 'sub_w1',
      rows: [{ assetId: 'asset_9', availability: 'pending' }],
    }),
    registerDurableConsumer: (_connectionId, consumer) => {
      consumers.add(consumer);
      return () => consumers.delete(consumer);
    },
    unsubscribeLive: (_name, options) => {
      unsubscribed.push(options.subscriptionId);
      return { removed: true };
    },
  });
  const store = framed.watchStore('asset_9', { userId: 'user_a' });
  const seen = [];
  store.subscribe((snapshot) => seen.push(snapshot));
  assert.equal(store.getSnapshot().status, 'connecting');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().record.availability, 'pending');
  assert.equal(store.getSnapshot().mode, 'live');

  // A live_replace frame for the subscription updates; foreign frames don't.
  for (const consumer of [...consumers]) {
    consumer({ subscription_id: 'sub_other', rows: [{ availability: 'ready' }] });
  }
  assert.equal(store.getSnapshot().record.availability, 'pending');
  for (const consumer of [...consumers]) {
    consumer({
      subscription_id: 'sub_w1',
      rows: [{ assetId: 'asset_9', availability: 'ready' }],
    });
  }
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().record.availability, 'ready');

  // Denial/deletion blanks (empty row set).
  for (const consumer of [...consumers]) {
    consumer({ subscription_id: 'sub_w1', rows: [] });
  }
  assert.equal(store.getSnapshot().status, 'blank');
  assert.equal(store.getSnapshot().record, null);

  store.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(consumers.size, 0, 'dispose unregisters the frame consumer');
  assert.deepEqual(unsubscribed, ['sub_w1'], 'dispose retires the subscription');
}

// --- watchStore without the frame lane stays honest (static mode) ---
{
  const staticClient = new SnapbackAssetClient({
    baseUrl,
    subscribeLive: async () => ({
      subscription_id: 'sub_s1',
      rows: [{ assetId: 'asset_9', availability: 'ready' }],
    }),
  });
  const store = staticClient.watchStore('asset_9');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().mode, 'static');
  store.dispose();
}

// --- parent-client custody is projected consistently across reservation,
// --- TUS transfer, finalize, metadata/delivery-adjacent reads, and resume.
// --- Anonymous-public offers auth/rr with no bearer; a bare dev client keeps
// --- the empty fallback instead of inventing identity. ---
{
  const protocolHeader = 'x-snapback-auth-client-protocol';
  const assertCustody = (label, requests, authorization) => {
    const expected = [
      ['reservation', (request) => request.method === 'POST' && request.path === '/assets/attempts'],
      ['TUS transfer', (request) => request.method === 'PATCH' && request.path.startsWith('/assets/tus/')],
      ['finalize', (request) => request.method === 'POST' && request.path.endsWith('/finalize')],
      ['metadata/delivery-adjacent read', (request) => request.method === 'GET' && request.path.startsWith('/assets/records/')],
    ];
    for (const [boundary, matches] of expected) {
      const request = requests.find(matches);
      assert.ok(request, `${label} reached ${boundary}`);
      assert.equal(request.headers[protocolHeader], '1', `${label} ${boundary} offers auth/rr`);
      assert.equal(
        request.headers.authorization ?? null,
        authorization,
        `${label} ${boundary} bearer projection`,
      );
      assert.equal(
        request.redirect,
        authorization === null ? null : 'manual',
        `${label} ${boundary} redirect posture`,
      );
    }
  };

  const runCustodyLifecycle = async ({ label, parent, authorization }) => {
    const requestStart = state.requests.length;
    const assets = new SnapbackAssetClient(parent, { chunkBytes: CHUNK });
    const task = assets.start({
      upload: AVATAR_UPLOAD_REF,
      file: makeFile(`${label}-asset-payload`),
    });
    const completed = await task.done;
    assert.equal(completed.status, 'ready', `${label} lifecycle completes in the scripted server`);
    await assets.record(completed.assetId);
    assertCustody(label, state.requests.slice(requestStart), authorization);
    const deliveryUrl = assets.deliveryUrl(completed.assetId, { variant: 'primary' });
    assert.ok(!deliveryUrl.includes('Bearer'), `${label} delivery URL carries no header authority`);
  };

  const externalParent = createExternalSessionClient(baseUrl, {
    bearerToken: 'bearer_external_1',
    rqsStore: null,
    offlineQueue: false,
  });
  const anonymousParent = new SnapbackClient(baseUrl, {
    custody: 'anonymous-public',
    adminToken: null,
    rqsStore: null,
    offlineQueue: false,
  });
  try {
    await runCustodyLifecycle({
      label: 'external-session',
      parent: externalParent,
      authorization: 'Bearer bearer_external_1',
    });
    const staleStart = state.requests.length;
    const staleTask = new SnapbackAssetClient(externalParent).start({
      upload: AVATAR_UPLOAD_REF,
      file: makeFile('stale-command-cohort'),
      externalTransportGeneration: externalParent.__authTransportGeneration + 1,
    });
    const stale = await staleTask.done;
    assert.equal(stale.status, 'failed');
    assert.equal(stale.diagnostic.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    assert.equal(state.requests.length, staleStart, 'a stale command cohort dispatches no asset request');
    await runCustodyLifecycle({
      label: 'anonymous-public',
      parent: anonymousParent,
      authorization: null,
    });
  } finally {
    await Promise.all([externalParent.closeAuth(), anonymousParent.closeAuth()]);
  }

  // Authority-fence credentials retain the same bearer + offer projection.
  const fencedStart = state.requests.length;
  const fenced = new SnapbackAssetClient({
    baseUrl,
    authProtocols: { authClient: 1 },
    authorityFence: {
      capture: () => ({ lineage: 'l1' }),
      credentialFor: () => ({ bearer: 'bearer_fence_1' }),
    },
    subscribeLive: () => {},
  });
  await fenced.record('asset_c1', { userId: 'user_ignored' }).catch(() => {});

  // The no-custody development fallback remains completely offerless.
  const devStart = state.requests.length;
  const devLane = new SnapbackAssetClient({
    baseUrl,
    subscribeLive: () => {},
  });
  await devLane.record('asset_c3', { userId: 'user_dev' }).catch(() => {});

  // TUS resume HEAD carries the same custody.
  const resumeStore = createMemoryAssetTaskStore();
  const fencedResume = new SnapbackAssetClient(
    {
      baseUrl,
      authProtocols: { authClient: 1 },
      authorityFence: {
        capture: () => ({ lineage: 'l1' }),
        credentialFor: () => ({ bearer: 'bearer_fence_1' }),
      },
      subscribeLive: () => {},
    },
    { taskStore: resumeStore },
  );
  resumeStore.set(
    fencedResume.taskStoreKey({ userId: null, assetId: 'asset_1' }),
    JSON.stringify({
      assetId: 'asset_1', attemptId: 'attempt_1', attemptExpiresAtMs: null,
      fileSize: state.attempts.get('attempt_1').declaredLength, fileName: null,
    }),
  );
  const resumeTask = fencedResume.resumePersisted({
    assetId: 'asset_1',
    file: makeFile(state.assets.get('asset_1').bytes),
  });
  await resumeTask.done;

  const fencedSeen = state.requests.slice(fencedStart).find(
    (request) => request.path === '/assets/records/asset_c1',
  );
  const devSeen = state.requests.slice(devStart).find(
    (request) => request.path === '/assets/records/asset_c3',
  );
  const headSeen = state.requests.findLast((request) => request.method === 'HEAD');
  assert.equal(fencedSeen.headers.authorization, 'Bearer bearer_fence_1');
  assert.equal(fencedSeen.headers[protocolHeader], '1');
  assert.equal(fencedSeen.headers['x-snapback-dev-user'] ?? null, null, 'a credential suppresses the dev header');
  assert.equal(devSeen.headers.authorization ?? null, null);
  assert.equal(devSeen.headers[protocolHeader] ?? null, null, 'bare dev sends no auth/rr offer');
  // No server route ever read a dev-identity header; the client no longer
  // sends one (dead-header removal, 20260801-0044-dev-user-header-dead-read).
  assert.equal(devSeen.headers['x-snapback-dev-user'] ?? null, null, 'the dev lane sends no dead identity header');
  assert.equal(headSeen.headers.authorization, 'Bearer bearer_fence_1', 'TUS custody matches');
  assert.equal(headSeen.headers[protocolHeader], '1', 'TUS resume repeats auth/rr');
  assert.equal(headSeen.redirect, 'manual', 'credentialed TUS HEAD refuses redirects');
}

// --- credentialed asset requests refuse 307 at create, TUS HEAD, and TUS
// --- PATCH without replaying the bearer to a second origin. Existing 2xx
// --- lifecycles above also pin that manual redirect mode changes no result. ---
{
  const parent = {
    baseUrl,
    bearerToken: 'bearer_redirect_1',
    authProtocols: { authClient: 1 },
    subscribeLive: () => {},
  };
  const redirected = () => new Response(null, {
    status: 307,
    headers: { location: 'https://redirect-target.invalid/replayed' },
  });
  const modelPlatformRedirect = (calls, url, init) => {
    calls.push({ url, init });
    if (init.redirect !== 'manual') {
      calls.push({ url: 'https://redirect-target.invalid/replayed', init });
      return Response.json({ replayed: true });
    }
    return redirected();
  };

  const createCalls = [];
  globalThis.fetch = async (url, init) => modelPlatformRedirect(createCalls, url, init);
  try {
    const task = new SnapbackAssetClient(parent).start({
      upload: AVATAR_UPLOAD_REF,
      file: makeFile('create-redirect'),
    });
    const snapshot = await task.done;
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.diagnostic.code, 'SNAPBACK_REDIRECT_REFUSED');
    assert.deepEqual(snapshot.diagnostic.details, { status: 307 });
    assert.equal(createCalls.length, 1, 'asset create sends the bearer to one origin only');
    assert.equal(createCalls[0].init.redirect, 'manual');
    assert.equal(
      createCalls.some(({ url }) => String(url).startsWith('https://redirect-target.invalid')),
      false,
      'asset create never replays the bearer to the redirect target',
    );
  } finally {
    globalThis.fetch = server.fetch;
  }

  const patchCalls = [];
  const patchAssets = new SnapbackAssetClient(parent, {
    fetch: async (url, init) => {
      if (init.method === 'POST' && String(url).endsWith('/assets/attempts')) {
        return Response.json({
          task: {
            assetId: 'asset_redirect_patch',
            attemptId: 'attempt_redirect_patch',
            attemptState: 'open',
            availability: 'pending',
            acknowledgedOffset: 0,
            totalBytes: 14,
            expiresAtMs: 4102444800000,
            integrityGrade: 'received-bytes-canonical',
          },
          transfer: {
            uploadUrl: '/assets/tus/attempt_redirect_patch',
            tusResumable: '1.0.0',
            uploadLength: 14,
            expiresAtMs: 4102444800000,
            checksumAlgorithms: ['sha256'],
            maxChunkBytes: CHUNK,
          },
        });
      }
      return modelPlatformRedirect(patchCalls, url, init);
    },
  });
  const patchSnapshot = await patchAssets.start({
    upload: AVATAR_UPLOAD_REF,
    file: makeFile('patch-redirect'),
  }).done;
  assert.equal(patchSnapshot.status, 'failed');
  assert.equal(patchSnapshot.diagnostic.code, 'SNAPBACK_REDIRECT_REFUSED');
  assert.equal(patchCalls.length, 1, 'TUS PATCH sends the bearer to one origin only');
  assert.equal(patchCalls[0].init.method, 'PATCH');
  assert.equal(patchCalls[0].init.redirect, 'manual');

  const headCalls = [];
  const resumeStore = createMemoryAssetTaskStore();
  const headAssets = new SnapbackAssetClient(parent, {
    taskStore: resumeStore,
    fetch: async (url, init) => modelPlatformRedirect(headCalls, url, init),
  });
  resumeStore.set(
    headAssets.taskStoreKey({ userId: null, assetId: 'asset_redirect_head' }),
    JSON.stringify({
      assetId: 'asset_redirect_head',
      attemptId: 'attempt_redirect_head',
      attemptExpiresAtMs: 4102444800000,
      fileSize: 13,
      fileName: null,
    }),
  );
  const headSnapshot = await headAssets.resumePersisted({
    assetId: 'asset_redirect_head',
    file: makeFile('head-redirect'),
  }).done;
  assert.equal(headSnapshot.status, 'failed');
  assert.equal(headSnapshot.diagnostic.code, 'SNAPBACK_REDIRECT_REFUSED');
  assert.equal(headCalls.length, 1, 'TUS HEAD sends the bearer to one origin only');
  assert.equal(headCalls[0].init.method, 'HEAD');
  assert.equal(headCalls[0].init.redirect, 'manual');
}

// --- watchStore consumes the real establishment shape (snapshot.rows) and
// --- acquires live-stream demand when the client exposes the manager ---
{
  const demand = { acquired: 0, released: 0, managers: [] };
  const streamed = new SnapbackAssetClient({
    baseUrl,
    liveStreamManager: (connectionId) => {
      demand.managers.push(connectionId);
      return {
        acquireDemand: () => {
          demand.acquired += 1;
          return () => {
            demand.released += 1;
          };
        },
        waitUntilReady: async () => {},
      };
    },
    subscribeLive: async () => ({
      subscription_id: 'sub_e1',
      snapshot: { rows: [{ assetId: 'asset_9', availability: 'ready' }] },
    }),
    registerDurableConsumer: () => () => {},
    unsubscribeLive: () => ({ removed: true }),
  });
  const store = streamed.watchStore('asset_9', { userId: 'user_a' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().status, 'ready', 'snapshot.rows establishment is consumed');
  assert.equal(store.getSnapshot().mode, 'live');
  assert.equal(demand.acquired, 1);
  store.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(demand.released, 1, 'dispose releases stream demand');
}

// --- a stream that cannot come up degrades honestly to static ---
{
  const degraded = new SnapbackAssetClient({
    baseUrl,
    liveStreamManager: () => ({
      acquireDemand: () => () => {},
      waitUntilReady: async () => {
        throw new Error('socket refused');
      },
    }),
    subscribeLive: async () => ({
      subscription_id: 'sub_d1',
      snapshot: { rows: [{ assetId: 'asset_9', availability: 'ready' }] },
    }),
    registerDurableConsumer: () => () => {},
  });
  const store = degraded.watchStore('asset_9');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().mode, 'static', 'failed stream reports static, not fake-live');
  store.dispose();
}

server.closeAllConnections?.(); server.close();
globalThis.fetch = originalFetch;
// A bare intent-name string refuses client-side with the reference guidance
// (the server DTO requires the reference's intentPolicyHash; a form that can
// never succeed server-side must not get as far as the wire).
{
  const assets = new SnapbackAssetClient(client, { taskStore: null });
  assert.throws(
    () => assets.start({ upload: 'avatarUpload', file: makeFile('x'), userId: 'user_e' }),
    /generated upload reference \(api\.avatarUpload\)/,
  );
}

console.log('assets.test.mjs passed');

// Browser-digest fallback: the incremental FIPS 180-4 implementation must
// match node:crypto exactly across boundary lengths (diary 0041 finding 8).
test('incremental sha256 fallback matches node:crypto', async () => {
  const { createHash: nodeCreateHash, randomBytes } = await import('node:crypto');
  const { __testIncrementalSha256 } = await import('./assets.mjs');
  for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 1000, 65536]) {
    const bytes = length === 0 ? new Uint8Array(0) : new Uint8Array(randomBytes(length));
    const expected = nodeCreateHash('sha256').update(bytes).digest('hex');
    const fallback = new __testIncrementalSha256();
    // split the update across uneven chunks to exercise block boundaries
    fallback.update(bytes.subarray(0, Math.floor(length / 3)));
    fallback.update(bytes.subarray(Math.floor(length / 3)));
    assert.equal(fallback.digest('hex'), expected, `length ${length}`);
    assert.equal(
      new __testIncrementalSha256().update(bytes).digest('base64'),
      nodeCreateHash('sha256').update(bytes).digest('base64'),
      `base64 length ${length}`,
    );
  }
});
