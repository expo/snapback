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
import { createServer } from 'node:http';

import {
  PERSISTED_RESUME_FACT_MEMBERS,
  SnapbackAssetClient,
  createMemoryAssetTaskStore,
} from './assets.mjs';

const CHUNK = 8;

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

// A scripted local target speaking the asset route family.
function makeAssetServer() {
  const state = {
    assets: new Map(), // assetId -> {bytes, availability}
    attempts: new Map(), // attemptId -> {assetId, offset, chunks: [{checksum, length}]}
    nextAsset: 1,
    nextAttempt: 1,
    requests: [],
  };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, 'http://localhost');
    state.requests.push({
      method: request.method,
      path: url.pathname,
      headers: { ...request.headers },
    });
    const json = (value, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
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
    if (request.method === 'POST' && url.pathname === '/assets/attempts') {
      const parsed = JSON.parse(body.toString('utf8'));
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
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'tus-resumable': '1.0.0',
          'upload-offset': String(attempt.offset),
          'upload-length': String(attempt.declaredLength),
        });
        return response.end();
      }
      if (request.method === 'PATCH') {
        const offset = Number(request.headers['upload-offset']);
        if (offset !== attempt.offset) {
          return json({ diagnostics: [{ code: 'SNAPBACK_ASSET_OFFSET_CONFLICT' }] }, 409);
        }
        const checksum = request.headers['upload-checksum'] ?? null;
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
        response.writeHead(204, {
          'tus-resumable': '1.0.0',
          'upload-offset': String(attempt.offset),
        });
        return response.end();
      }
    }
    const finalize = url.pathname.match(/^\/assets\/attempts\/([^/]+)\/finalize$/);
    if (finalize && request.method === 'POST') {
      const parsed = JSON.parse(body.toString('utf8'));
      const attempt = state.attempts.get(finalize[1]);
      const digest = createHash('sha256').update(attempt.received).digest('hex');
      if (parsed.declaredDigest && parsed.declaredDigest !== digest) {
        return json({ diagnostics: [{ code: 'SNAPBACK_ASSET_DIGEST_MISMATCH' }] }, 400);
      }
      attempt.state = 'complete';
      const asset = state.assets.get(attempt.assetId);
      asset.availability = 'ready';
      asset.bytes = attempt.received;
      return json({ task: taskState(finalize[1]) });
    }
    const cancel = url.pathname.match(/^\/assets\/attempts\/([^/]+)\/cancel$/);
    if (cancel && request.method === 'POST') {
      const attempt = state.attempts.get(cancel[1]);
      attempt.state = 'cancelled';
      return json({ task: taskState(cancel[1]) });
    }
    const record = url.pathname.match(/^\/assets\/records\/([^/]+)$/);
    if (record && request.method === 'GET') {
      const asset = state.assets.get(record[1]);
      if (!asset) return json({ diagnostics: [{ code: 'SNAPBACK_ASSET_UNKNOWN' }] }, 404);
      return json({ assetId: record[1], availability: asset.availability });
    }
    json({ diagnostics: [{ code: 'SNAPBACK_ROUTE_UNKNOWN' }] }, 404);
  });
  return { server, state };
}

const { server, state } = makeAssetServer();
await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const client = { baseUrl, subscribeLive: () => {} };

// --- upload end to end: chunked, checksummed, digested ---
{
  const store = createMemoryAssetTaskStore();
  const assets = new SnapbackAssetClient(client, { taskStore: store, chunkBytes: CHUNK });
  const payload = 'twenty-six characters here!!';
  const file = makeFile(payload);
  const seen = [];
  const task = assets.start({
    upload: 'avatarUpload',
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
  // Every PATCH carried a sha256 checksum (the conformance requirement).
  const patches = state.requests.filter((request) => request.method === 'PATCH');
  assert.ok(patches.length >= 3, `chunked into multiple PATCHes: ${patches.length}`);
  for (const patch of patches) {
    assert.match(patch.headers['upload-checksum'], /^sha256 [A-Za-z0-9+/]+=*$/);
    assert.equal(patch.headers['tus-resumable'], '1.0.0');
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
  const task = assets.start({ upload: 'avatarUpload', file, userId: 'user_b' });
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

// --- retry: a successor attempt for the SAME asset id ---
{
  const assets = new SnapbackAssetClient(client, { chunkBytes: CHUNK });
  const file = makeFile('retry-payload-bytes-here');
  const task = assets.start({ upload: 'avatarUpload', file, userId: 'user_c' });
  const first = await task.done;
  assert.equal(first.status, 'ready');
  const successor = await task.retry();
  const second = await successor.done;
  assert.equal(second.status, 'ready');
  assert.equal(
    second.assetId,
    first.assetId,
    'retry creates a successor attempt without re-identifying the asset',
  );
  assert.notEqual(second.attemptId, first.attemptId);
}

// --- deferred length refuses with the registered diagnostic ---
{
  const assets = new SnapbackAssetClient(client, { chunkBytes: CHUNK });
  const file = makeFile('x');
  Object.defineProperty(file, 'size', { value: undefined });
  let failed;
  try {
    assets.start({ upload: 'avatarUpload', file, userId: 'user_d' });
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
  let refused = false;
  try {
    delivering.deliveryUrl('asset_9');
  } catch (error) {
    refused = error instanceof TypeError;
  }
  assert.ok(refused, 'best selection without maxWidth refuses client-side');
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

// --- sessions custody: a fence credential rides authorization on every
// --- asset request; the dev header is only the no-credential fallback ---
{
  const seenHeaders = [];
  const custodyServer = createServer((request, response) => {
    seenHeaders.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.authorization ?? null,
      devUser: request.headers['x-snapback-dev-user'] ?? null,
    });
    if (request.method === 'HEAD') {
      response.setHeader('tus-resumable', '1.0.0');
      response.setHeader('upload-offset', '0');
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ diagnostics: [{ code: 'SNAPBACK_ASSET_UNKNOWN' }] }));
  });
  await new Promise((resolve) => custodyServer.listen(0, '127.0.0.1', resolve));
  const custodyBase = `http://127.0.0.1:${custodyServer.address().port}`;
  const fenced = new SnapbackAssetClient({
    baseUrl: custodyBase,
    authorityFence: {
      capture: () => ({ lineage: 'l1' }),
      credentialFor: () => ({ bearer: 'bearer_fence_1' }),
    },
    subscribeLive: () => {},
  });
  await fenced.record('asset_c1', { userId: 'user_ignored' }).catch(() => {});
  const external = new SnapbackAssetClient({
    baseUrl: custodyBase,
    bearerToken: 'bearer_external_1',
    subscribeLive: () => {},
  });
  await external.record('asset_c2').catch(() => {});
  const devLane = new SnapbackAssetClient({
    baseUrl: custodyBase,
    subscribeLive: () => {},
  });
  await devLane.record('asset_c3', { userId: 'user_dev' }).catch(() => {});
  // TUS resume HEAD carries the same custody.
  const resumeStore = createMemoryAssetTaskStore();
  const fencedResume = new SnapbackAssetClient(
    {
      baseUrl: custodyBase,
      authorityFence: {
        capture: () => ({ lineage: 'l1' }),
        credentialFor: () => ({ bearer: 'bearer_fence_1' }),
      },
      subscribeLive: () => {},
    },
    { taskStore: resumeStore },
  );
  resumeStore.set(
    fencedResume.taskStoreKey({ userId: null, assetId: 'asset_c4' }),
    JSON.stringify({
      assetId: 'asset_c4', attemptId: 'attempt_c4', attemptExpiresAtMs: null,
      fileSize: 1, fileName: null,
    }),
  );
  const resumeTask = fencedResume.resumePersisted({ assetId: 'asset_c4', file: makeFile('z') });
  await resumeTask.done;
  await new Promise((resolve) => custodyServer.close(resolve));
  const [fencedSeen, externalSeen, devSeen, headSeen] = [
    seenHeaders.find((entry) => entry.url.includes('asset_c1')),
    seenHeaders.find((entry) => entry.url.includes('asset_c2')),
    seenHeaders.find((entry) => entry.url.includes('asset_c3')),
    seenHeaders.find((entry) => entry.method === 'HEAD'),
  ];
  assert.equal(fencedSeen.authorization, 'Bearer bearer_fence_1');
  assert.equal(fencedSeen.devUser, null, 'a credential suppresses the dev header');
  assert.equal(externalSeen.authorization, 'Bearer bearer_external_1');
  assert.equal(devSeen.authorization, null);
  assert.equal(devSeen.devUser, 'user_dev');
  assert.equal(headSeen.authorization, 'Bearer bearer_fence_1', 'TUS custody matches');
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
console.log('assets.test.mjs passed');
process.exit(0);

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
