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

server.closeAllConnections?.(); server.close();
console.log('assets.test.mjs passed');
process.exit(0);
