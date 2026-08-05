// Headless asset upload client (LLP 0044 §Client upload surface, L1-14).
//
// One task drives create → per-chunk-checksummed TUS 1.0.0 → finalize with
// the whole-upload digest, so a generated-client transfer always publishes
// end-to-end verified. The closed snapshot, pause/resume/cancel/retry, and
// the persisted resume facts follow 0044's client contract:
//
// - the asset id is stable across successor attempts (retry never changes
//   the identity an optimistic row already holds);
// - persisted resume facts are partitioned by app + authority identity and
//   contain no bearer URLs, staging keys, or signing material — only the
//   asset/attempt identity and a file fingerprint;
// - transfer progress is presentation state; readiness comes from the
//   server's durable answer (finalize response, `watch`, or `record`).
//
// Transport posture: custody follows the client protocol. When the parent
// client holds a sessions credential (an authority fence from its
// AuthCoordinator, or an external-session bearer), every asset request —
// create, TUS transfer, finalize, metadata, delivery-adjacent reads —
// carries `authorization: Bearer` exactly like the client's own request
// lane, and the asset route family's `OptionalSessionBearer` overlay
// resolves the caller. Without a credential the dev-lane header is sent;
// note the dev-mode HTTP body-authority gap recorded by the conformance
// suite (asset request DTOs carry no dev auth member, so dev-lane HTTP
// requests resolve anonymous server-side today). The reserved record
// projection rides `SnapbackClient.subscribeLive`, whose custody the parent
// client owns; sessions-mode establishment of that projection is refused
// server-side until its LLP 0053 classification lands (W2e).

// Digest custody: node:crypto streams when the runtime provides it; browser
// bundles (the first real Vite build of a demo surface caught this — diary
// 0041 finding 8) fall back to a small incremental FIPS 180-4 SHA-256 whose
// output is cross-checked against node:crypto by the package test.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

class IncrementalSha256 {
  constructor() {
    this.h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.block = new Uint8Array(64);
    this.blockLength = 0;
    this.byteLength = 0;
    this.w = new Uint32Array(64);
  }

  update(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.byteLength += input.length;
    let offset = 0;
    while (offset < input.length) {
      const take = Math.min(64 - this.blockLength, input.length - offset);
      this.block.set(input.subarray(offset, offset + take), this.blockLength);
      this.blockLength += take;
      offset += take;
      if (this.blockLength === 64) {
        this.#compress(this.block);
        this.blockLength = 0;
      }
    }
    return this;
  }

  #compress(chunk) {
    const { w, h } = this;
    for (let i = 0; i < 16; i += 1) {
      w[i] = (chunk[i * 4] << 24) | (chunk[i * 4 + 1] << 16) | (chunk[i * 4 + 2] << 8) | chunk[i * 4 + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  digestBytes() {
    const bitLengthHi = Math.floor(this.byteLength / 0x20000000);
    const bitLengthLo = (this.byteLength << 3) >>> 0;
    this.update(new Uint8Array([0x80]));
    while (this.blockLength !== 56) this.update(new Uint8Array([0]));
    const lengthBlock = new Uint8Array(8);
    lengthBlock[0] = (bitLengthHi >>> 24) & 0xff;
    lengthBlock[1] = (bitLengthHi >>> 16) & 0xff;
    lengthBlock[2] = (bitLengthHi >>> 8) & 0xff;
    lengthBlock[3] = bitLengthHi & 0xff;
    lengthBlock[4] = (bitLengthLo >>> 24) & 0xff;
    lengthBlock[5] = (bitLengthLo >>> 16) & 0xff;
    lengthBlock[6] = (bitLengthLo >>> 8) & 0xff;
    lengthBlock[7] = bitLengthLo & 0xff;
    this.update(lengthBlock);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i += 1) {
      out[i * 4] = (this.h[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (this.h[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (this.h[i] >>> 8) & 0xff;
      out[i * 4 + 3] = this.h[i] & 0xff;
    }
    return out;
  }

  digest(encoding) {
    const bytes = this.digestBytes();
    if (encoding === 'hex') {
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (encoding === 'base64') {
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return (globalThis.btoa ?? ((v) => Buffer.from(v, 'binary').toString('base64')))(binary);
    }
    return bytes;
  }
}

function createHash() {
  const crypto = globalThis.process?.getBuiltinModule?.('node:crypto');
  return crypto ? crypto.createHash('sha256') : new IncrementalSha256();
}

/** The reserved system live query projecting one asset record. */
export const ASSET_RECORD_LIVE_FUNCTION = '_snapback.assetRecord';

/**
 * The reserved system live query projecting the caller's own membership
 * rows for one declared membership (LLP 0056 §Declaration-owned
 * self-projection). It rides the ordinary live-query surface — no wrapper
 * needed:
 *
 *   client.liveQuery(MY_MEMBERSHIPS_LIVE_FUNCTION, {
 *     args: { membership: 'channelSeats' },
 *     onUpdate: (rows) => render(rows), // [{ id, resource, role, sinceMs }]
 *   })
 *
 * Rows are the caller's own seats only; a grant wakes a blank
 * subscription and a revocation removes the seat live.
 */
export const MY_MEMBERSHIPS_LIVE_FUNCTION = '_snapback.myMemberships';

const TUS_VERSION = '1.0.0';
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

const TERMINAL = ['ready', 'rejected', 'cancelled', 'failed'];

/** The exact member set a persisted resume fact may carry. */
export const PERSISTED_RESUME_FACT_MEMBERS = /* @__PURE__ */ Object.freeze([
  'assetId',
  'attemptId',
  'attemptExpiresAtMs',
  'fileSize',
  'fileName',
]);

function assertFileLike(file) {
  if (
    !file
    || typeof file.size !== 'number'
    || typeof file.slice !== 'function'
  ) {
    throw new TypeError('start requires a File/Blob-like value with size and slice()');
  }
}

function intentIdentity(upload) {
  if (typeof upload === 'string') {
    // A bare intent name can never satisfy the server's admission DTO —
    // the generated reference carries the required policy and implementation
    // identities.
    throw new TypeError(
      `start requires the generated upload reference (api.${upload}), not its name string; it carries policy/implementation identity`,
    );
  }
  if (
    upload
    && upload.artifactKind === 'assetUploadReference'
    && typeof upload.name === 'string'
  ) {
    return {
      intentId: upload.name,
      intentPolicyHash: upload.intentPolicyHash ?? null,
      implementationHash: upload.implementationHash ?? null,
    };
  }
  throw new TypeError(
    'start requires a generated asset upload reference',
  );
}

async function chunkBytesOf(blob) {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function sha256Hex(bytes) {
  return createHash().update(bytes).digest('hex');
}

function sha256Base64(bytes) {
  return createHash().update(bytes).digest('base64');
}

/** In-memory default store for persisted resume facts. */
export function createMemoryAssetTaskStore() {
  const map = new Map();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

class AssetUploadTask {
  #assets;
  #listeners = new Set();
  #paused = false;
  #cancelled = false;
  #abort = null;
  #resolveDone;
  #snapshot;

  constructor(assets, seed) {
    this.#assets = assets;
    this.#snapshot = Object.freeze({
      assetId: null,
      assetRef: null,
      attemptId: null,
      attemptExpiresAtMs: null,
      status: 'creating',
      diagnostic: null,
      bytesTransferred: 0,
      totalBytes: seed.totalBytes,
      previewUrl: seed.previewUrl,
      integrityBasis: 'end-to-end-verified',
    });
    this.done = new Promise((resolve) => {
      this.#resolveDone = resolve;
    });
  }

  snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  #update(patch) {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch });
    for (const listener of this.#listeners) listener(this.#snapshot);
    if (TERMINAL.includes(this.#snapshot.status)) this.#resolveDone(this.#snapshot);
  }

  /** internal: the driving loop owns state transitions. */
  _apply(patch) {
    this.#update(patch);
  }

  _bindAbort(controller) {
    this.#abort = controller;
  }

  get _paused() {
    return this.#paused;
  }

  get _cancelled() {
    return this.#cancelled;
  }

  pause() {
    if (TERMINAL.includes(this.#snapshot.status) || this.#paused) return;
    this.#paused = true;
    this.#abort?.abort();
    this.#update({ status: 'paused' });
  }

  resume() {
    if (this.#snapshot.status !== 'paused') return;
    this.#paused = false;
    this.#update({ status: 'uploading' });
    this.#assets._drive(this);
  }

  async cancel({ discardAsset = false } = {}) {
    if (TERMINAL.includes(this.#snapshot.status)) return this.#snapshot;
    this.#cancelled = true;
    this.#abort?.abort();
    await this.#assets._cancel(this, { discardAsset });
    return this.#snapshot;
  }

  async retry() {
    return this.#assets._retry(this);
  }
}

export class SnapbackAssetClient {
  #client;
  #taskStore;
  #chunkBytes;
  #tasks = new WeakMap();

  constructor(client, { taskStore = null, chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
    this.#client = client;
    this.#taskStore = taskStore ?? createMemoryAssetTaskStore();
    this.#chunkBytes = chunkBytes;
  }

  /** Persisted-fact partition: app (base URL) + authority identity. */
  taskStoreKey({ userId = null, assetId }) {
    return `${this.#client.baseUrl}::${userId ?? 'anonymous'}::${assetId}`;
  }

  /**
   * Custody for direct asset-route requests. A sessions credential from the
   * parent client's authority fence (or an external-session bearer) always
   * wins; the dev-lane header is the no-credential fallback and never
   * overrides a real credential.
   */
  #custodyHeaders(userId) {
    // A sessions request must offer the exact auth-client protocol beside
    // its credential (the server refuses a bare bearer).
    const bearerHeaders = (bearer) => ({
      authorization: `Bearer ${bearer}`,
      'x-snapback-auth-client-protocol': '1',
    });
    const fence = this.#client.authorityFence;
    if (fence) {
      try {
        const bearer = fence.credentialFor(fence.capture()).bearer;
        if (bearer) return bearerHeaders(bearer);
      } catch {
        // No current credential — fall through to the dev-lane posture.
      }
    }
    const external = this.#client.bearerToken;
    if (typeof external === 'string' && external.length > 0) {
      return bearerHeaders(external);
    }
    // Dev-lane HTTP asset requests resolve anonymously today: no server
    // route reads a dev identity header, and TUS PATCH bodies are raw bytes
    // so the body-authority shape cannot ride them. Sending a dead header
    // implied custody that did not exist; per-user dev identity flows
    // through host-ops (`asset.put`) until the recorded dev-lane
    // body-authority gap gets its design.
    return {};
  }

  async #json(method, path, body, { userId = null } = {}) {
    const headers = {
      'content-type': 'application/json',
      ...this.#custodyHeaders(userId),
    };
    const response = await fetch(`${this.#client.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const value = text.length > 0 ? JSON.parse(text) : null;
    if (!response.ok) {
      const diagnostic = value?.diagnostics?.[0] ?? value ?? {
        code: 'SNAPBACK_ASSET_HTTP_ERROR',
        message: `HTTP ${response.status}`,
      };
      const error = new Error(diagnostic.message ?? `HTTP ${response.status}`);
      error.diagnostic = diagnostic;
      throw error;
    }
    return value;
  }

  start({
    upload,
    args = {},
    file,
    userId = null,
    declaredFilename = null,
    declaredContentType = null,
    previewUrl = null,
  }) {
    assertFileLike(file);
    const identity = intentIdentity(upload);
    const task = new AssetUploadTask(this, {
      totalBytes: file.size,
      previewUrl,
    });
    this.#tasks.set(task, {
      identity,
      args,
      file,
      userId,
      declaredFilename,
      declaredContentType,
      offset: 0,
      wholeHash: createHash('sha256'),
      transfer: null,
    });
    void this.#start(task);
    return task;
  }

  async #start(task) {
    const state = this.#tasks.get(task);
    try {
      const created = await this.#json(
        'POST',
        '/assets/attempts',
        {
          intentId: state.identity.intentId,
          intentPolicyHash: state.identity.intentPolicyHash,
          implementationHash: state.identity.implementationHash,
          args: state.args,
          declaredFilename: state.declaredFilename,
          declaredLength: state.file.size,
          declaredContentType: state.declaredContentType,
          ...(state.retryOfAssetId ? { retryOfAssetId: state.retryOfAssetId } : {}),
        },
        { userId: state.userId },
      );
      state.transfer = created.transfer;
      task._apply({
        assetId: created.task.assetId,
        assetRef: created.task.assetId,
        attemptId: created.task.attemptId,
        attemptExpiresAtMs: created.task.expiresAtMs,
        status: 'uploading',
      });
      this.#persist(task, state);
      await this._drive(task);
    } catch (error) {
      task._apply({ status: 'failed', diagnostic: error.diagnostic ?? { message: error.message } });
    }
  }

  #persist(task, state) {
    const snapshot = task.snapshot();
    if (!snapshot.assetId) return;
    // The exact closed member set — no upload URL, no staging key, no
    // bearer/signing material. The hygiene test pins this.
    const fact = {
      assetId: snapshot.assetId,
      attemptId: snapshot.attemptId,
      attemptExpiresAtMs: snapshot.attemptExpiresAtMs,
      fileSize: state.file.size,
      fileName: state.declaredFilename,
    };
    this.#taskStore.set(
      this.taskStoreKey({ userId: state.userId, assetId: snapshot.assetId }),
      JSON.stringify(fact),
    );
  }

  /** Resume a persisted fact after refresh: re-discover the offset, continue. */
  resumePersisted({ assetId, file, userId = null }) {
    assertFileLike(file);
    const raw = this.#taskStore.get(this.taskStoreKey({ userId, assetId }));
    if (!raw) return null;
    const fact = JSON.parse(raw);
    if (fact.fileSize !== file.size) {
      throw new TypeError('resume requires the original file (size mismatch)');
    }
    const task = new AssetUploadTask(this, { totalBytes: file.size, previewUrl: null });
    this.#tasks.set(task, {
      identity: { intentId: null, intentPolicyHash: null, implementationHash: null },
      args: {},
      file,
      userId,
      declaredFilename: fact.fileName ?? null,
      declaredContentType: null,
      offset: null, // discovered by HEAD
      wholeHash: null, // recomputed from 0 on resume
      transfer: { uploadUrl: `/assets/tus/${fact.attemptId}` },
    });
    task._apply({
      assetId: fact.assetId,
      assetRef: fact.assetId,
      attemptId: fact.attemptId,
      attemptExpiresAtMs: fact.attemptExpiresAtMs ?? null,
      status: 'uploading',
    });
    void this._drive(task);
    return task;
  }

  async _drive(task) {
    const state = this.#tasks.get(task);
    try {
      if (state.offset === null) {
        // Resume: the acknowledged offset is the server's fact.
        const head = await fetch(
          `${this.#client.baseUrl}${state.transfer.uploadUrl}`,
          {
            method: 'HEAD',
            headers: {
              'tus-resumable': TUS_VERSION,
              ...this.#custodyHeaders(state.userId),
            },
          },
        );
        if (!head.ok) throw new Error(`resume HEAD failed: ${head.status}`);
        state.offset = Number(head.headers.get('upload-offset') ?? '0');
        state.wholeHash = createHash('sha256');
        if (state.offset > 0) {
          // Whole-upload digest covers every byte: rehash the acknowledged
          // prefix locally so finalize still declares the full digest.
          state.wholeHash.update(
            await chunkBytesOf(state.file.slice(0, state.offset)),
          );
        }
        task._apply({ bytesTransferred: state.offset });
      }
      // Preflight against the declared fact instead of discovering the
      // ceiling by 413 (LLP 0139 bakeoff, limits-discoverability finding):
      // the server's create response advertises maxChunkBytes; an explicit
      // constructor override may only narrow it.
      const declaredChunk = Number.isSafeInteger(state.transfer?.maxChunkBytes)
        && state.transfer.maxChunkBytes > 0
        ? state.transfer.maxChunkBytes
        : null;
      const effectiveChunk = declaredChunk === null
        ? this.#chunkBytes
        : Math.min(this.#chunkBytes, declaredChunk);
      while (state.offset < state.file.size) {
        if (task._paused || task._cancelled) return;
        const end = Math.min(state.offset + effectiveChunk, state.file.size);
        const bytes = await chunkBytesOf(state.file.slice(state.offset, end));
        const controller = new AbortController();
        task._bindAbort(controller);
        const response = await fetch(
          `${this.#client.baseUrl}${state.transfer.uploadUrl}`,
          {
            method: 'PATCH',
            signal: controller.signal,
            headers: {
              'tus-resumable': TUS_VERSION,
              'content-type': 'application/offset+octet-stream',
              'upload-offset': String(state.offset),
              // The conformance requirement: every PATCH carries a checksum.
              'upload-checksum': `sha256 ${sha256Base64(bytes)}`,
              ...this.#custodyHeaders(state.userId),
            },
            body: bytes,
          },
        );
        if (!response.ok) {
          throw Object.assign(new Error(`TUS PATCH failed: ${response.status}`), {
            diagnostic: { code: 'SNAPBACK_ASSET_TRANSFER_FAILED', status: response.status },
          });
        }
        state.wholeHash.update(bytes);
        state.offset = Number(
          response.headers.get('upload-offset') ?? String(end),
        );
        task._apply({ bytesTransferred: state.offset });
      }
      task._apply({ status: 'finalizing' });
      const finalized = await this.#json(
        'POST',
        `/assets/attempts/${encodeURIComponent(task.snapshot().attemptId)}/finalize`,
        {
          attemptId: task.snapshot().attemptId,
          lifecycleGeneration: 1,
          declaredDigest: state.wholeHash.digest('hex'),
        },
        { userId: state.userId },
      );
      const availability = finalized.task.availability;
      task._apply({
        status: availability === 'ready' ? 'ready' : 'rejected',
        integrityBasis:
          finalized.task.integrityGrade ?? 'end-to-end-verified',
      });
      this.#taskStore.delete(
        this.taskStoreKey({ userId: state.userId, assetId: task.snapshot().assetId }),
      );
    } catch (error) {
      if (task._paused || task._cancelled) return;
      task._apply({
        status: 'failed',
        diagnostic: error.diagnostic ?? { message: error.message },
      });
    }
  }

  async _cancel(task, { discardAsset }) {
    const snapshot = task.snapshot();
    try {
      if (snapshot.attemptId) {
        await this.#json(
          'POST',
          `/assets/attempts/${encodeURIComponent(snapshot.attemptId)}/cancel`,
          {
            attemptId: snapshot.attemptId,
            lifecycleGeneration: 1,
            discardAsset,
          },
          { userId: this.#tasks.get(task)?.userId ?? null },
        );
      }
    } finally {
      const state = this.#tasks.get(task);
      if (state && snapshot.assetId) {
        this.#taskStore.delete(
          this.taskStoreKey({ userId: state.userId, assetId: snapshot.assetId }),
        );
      }
      task._apply({ status: 'cancelled' });
    }
  }

  /** Successor attempt for the SAME asset id (0044: retry never re-identifies). */
  async _retry(task) {
    const state = this.#tasks.get(task);
    const snapshot = task.snapshot();
    if (!state || !snapshot.assetId) {
      throw new TypeError('retry requires a task that reserved an asset id');
    }
    const successor = new AssetUploadTask(this, {
      totalBytes: state.file.size,
      previewUrl: snapshot.previewUrl,
    });
    this.#tasks.set(successor, {
      ...state,
      offset: 0,
      wholeHash: createHash('sha256'),
      transfer: null,
      retryOfAssetId: snapshot.assetId,
    });
    void this.#start(successor);
    return successor;
  }

  /** One authorized metadata read. */
  record(assetId, { userId = null } = {}) {
    return this.#json(
      'GET',
      `/assets/records/${encodeURIComponent(assetId)}`,
      undefined,
      { userId },
    );
  }

  /**
   * The strict-delivery URL for a rendition. `best` is the declarative
   * selector and requires `maxWidth` (the server 404s without it); a named
   * variant key addresses one declared rendition. Authorization stays
   * per-request at the server — the URL carries no bearer authority.
   */
  deliveryUrl(assetId, { variant = 'best', maxWidth = null, width = null } = {}) {
    const base = `${this.#client.baseUrl}/assets/records/${encodeURIComponent(assetId)}/bytes/${encodeURIComponent(variant)}`;
    // Bounded on-demand widths (LLP 0044 §Ceremony floor): `width`
    // ladder-normalizes server-side and materializes the rendition once;
    // mutually exclusive with the `best` declared-variant selector.
    if (width !== null) {
      if (!Number.isSafeInteger(width) || width <= 0) {
        throw new TypeError('deliveryUrl width must be a positive integer');
      }
      if (variant === 'best') {
        throw new TypeError('deliveryUrl width and the best selector are mutually exclusive');
      }
      return `${base}?width=${width}`;
    }
    if (variant === 'best') {
      if (!Number.isSafeInteger(maxWidth) || maxWidth <= 0) {
        throw new TypeError('deliveryUrl best selection requires a positive integer maxWidth');
      }
      return `${base}?maxWidth=${maxWidth}`;
    }
    return base;
  }

  /**
   * External store over the reserved record projection: one authorized
   * establishment, then the deep live-query delivery pipeline. Auth-scoped
   * replacements ride witnessed authorization envelopes and ACK only after
   * this store applies them; denial and deletion blank the snapshot. Shallow
   * clients without the deep handle retain the raw-frame compatibility path,
   * and clients without any durable-frame lane report `static` rather than
   * pretending to be live.
   */
  watchStore(assetId, { userId = null, connectionId = null } = {}) {
    const listeners = new Set();
    let snapshot = Object.freeze({ status: 'connecting', record: null, mode: 'live' });
    let disposed = false;
    let subscriptionId = null;
    let liveHandle = null;
    let unregister = () => {};
    const publish = (next) => {
      if (disposed) return;
      snapshot = Object.freeze(next);
      for (const listener of [...listeners]) listener(snapshot);
    };
    const applyRows = (rows) => {
      const record = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      publish({
        status: record === null ? 'blank' : 'ready',
        record,
        mode: snapshot.mode,
      });
    };
    const effectiveConnectionId = connectionId ?? `snapback_assets_watch_${assetId}`;
    let releaseStream = null;
    void (async () => {
      try {
        // The full client owns LLP 0053's query identity, publication fence,
        // duplicate/redelivery ledger, and post-commit acknowledgement. Keep
        // the raw subscribe/consumer path below only as the compatibility
        // seam for shallow adapters and tests that do not expose liveQuery.
        //
        // @ref LLP 0053#client-fences — an asset resolution is ACKed only
        // after this external-store boundary has synchronously applied it.
        if (typeof this.#client.liveQuery === 'function') {
          let publishedThroughHandle = false;
          const applyAuthorizationBoundary = (rows, detail) => {
            if (detail?.kind === 'authorization_retain') return;
            applyRows(rows);
            publishedThroughHandle = true;
          };
          const applyOrdinaryUpdate = (rows, detail) => {
            // Authorization updates already committed through the synchronous
            // boundary above. Skipping them here avoids a second publication
            // through liveQuery's isolated observation callback.
            if (detail?.kind?.startsWith?.('authorization_')) return;
            applyRows(rows);
            publishedThroughHandle = true;
          };
          const handle = await this.#client.liveQuery(
            ASSET_RECORD_LIVE_FUNCTION,
            {
              connectionId: effectiveConnectionId,
              userId,
              args: { assetId },
              transport: 'stream',
              onAuthorizationBoundary: applyAuthorizationBoundary,
              onUpdate: applyOrdinaryUpdate,
            },
          );
          if (disposed) {
            handle.dispose();
            return;
          }
          liveHandle = handle;
          subscriptionId = handle.subscriptionId ?? null;
          // Auth establishment commits through the synchronous boundary
          // before liveQuery resolves. Authority-independent establishment
          // sets only handle.rows, so it still needs this first publication.
          if (!publishedThroughHandle) applyRows(handle.rows ?? []);
          return;
        }
        // Frames only flow while a live stream holds the connection open.
        // Acquire stream demand when the client exposes the manager; a
        // stream that cannot come up degrades honestly to `static` (the
        // establishment snapshot still resolves) instead of reporting a
        // live mode with no delivery lane behind it.
        if (typeof this.#client.liveStreamManager === 'function') {
          try {
            const manager = this.#client.liveStreamManager(effectiveConnectionId);
            releaseStream = manager.acquireDemand();
            await manager.waitUntilReady();
          } catch {
            if (releaseStream) {
              releaseStream();
              releaseStream = null;
            }
            snapshot = Object.freeze({ ...snapshot, mode: 'static' });
          }
        }
        // Auth-scoped establishment (sessions mode) requires the LLP 0053
        // client namespace; allocate one when the client can mint it.
        const authorizationNamespace =
          typeof this.#client.allocateLiveQueryNamespace === 'function'
            ? this.#client.allocateLiveQueryNamespace(
              ASSET_RECORD_LIVE_FUNCTION,
              { assetId },
            )
            : null;
        const established = await this.#client.subscribeLive(
          ASSET_RECORD_LIVE_FUNCTION,
          {
            connectionId: effectiveConnectionId,
            userId,
            args: { assetId },
            ...(authorizationNamespace ? { authorizationNamespace } : {}),
          },
        );
        if (disposed) return;
        subscriptionId = established?.subscription_id
          ?? established?.subscriptionId
          ?? null;
        if (
          snapshot.mode === 'live'
          && typeof this.#client.registerDurableConsumer === 'function'
          && subscriptionId
        ) {
          unregister = this.#client.registerDurableConsumer(
            effectiveConnectionId,
            (frame) => {
              // Auth-scoped subscriptions (sessions mode) never receive a
              // plain live_replace: the witnessed authorization_invalidation
              // envelope carries the snapshot instead, with the subscription
              // id inside the snapshot block (camelCase per the wire struct).
              // Shallow compatibility clients have no LLP 0053 machinery;
              // production SnapbackClient instances took the liveQuery path
              // above and therefore never enter this raw consumer.
              if (frame?.kind === 'authorization_invalidation') {
                const witnessed = frame?.snapshot ?? null;
                const witnessedSubscription = witnessed?.subscriptionId
                  ?? witnessed?.subscription_id
                  ?? null;
                if (witnessed && witnessedSubscription === subscriptionId) {
                  applyRows(witnessed.rows ?? []);
                }
                return;
              }
              const frameSubscription = frame?.subscription_id ?? frame?.subscriptionId ?? null;
              if (frameSubscription !== subscriptionId) return;
              applyRows(frame?.rows ?? frame?.data?.rows ?? []);
            },
          );
        } else {
          snapshot = Object.freeze({ ...snapshot, mode: 'static' });
        }
        // The real subscribe response carries the establishment rows under
        // `snapshot.rows` (the live-wire establishment block); the bare
        // `rows` spelling is kept for older fakes.
        applyRows(established?.snapshot?.rows ?? established?.rows ?? []);
      } catch (error) {
        publish({
          status: 'error',
          record: null,
          mode: snapshot.mode,
          diagnostic: error?.diagnostic ?? { message: error?.message ?? String(error) },
        });
      }
    })();
    return Object.freeze({
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        listeners.clear();
        if (liveHandle) {
          liveHandle.dispose();
          liveHandle = null;
          return;
        }
        unregister();
        if (subscriptionId && typeof this.#client.unsubscribeLive === 'function') {
          void Promise.resolve(this.#client.unsubscribeLive(ASSET_RECORD_LIVE_FUNCTION, {
            subscriptionId,
            connectionId: effectiveConnectionId,
            ...(userId === null ? {} : { userId }),
          })).catch(() => {});
        }
        if (releaseStream) {
          releaseStream();
          releaseStream = null;
        }
      },
    });
  }

  /**
   * Establish the live view over the reserved record projection:
   * availability and rendition identity then arrive over the ordinary live
   * delivery lane with no polling; denial and deletion blank. Returns the
   * subscribe output (initial snapshot rows + subscription id); frame
   * consumption rides the client's existing live-store machinery.
   */
  watch(assetId, { userId = null, connectionId } = {}) {
    return this.#client.subscribeLive(ASSET_RECORD_LIVE_FUNCTION, {
      connectionId,
      userId,
      args: { assetId },
    });
  }
}

export function createAssetClient(client, options = {}) {
  return new SnapbackAssetClient(client, options);
}

/** Test-only export: the browser digest fallback, cross-checked against
 * node:crypto by the package test. Not part of the client surface. */
export { IncrementalSha256 as __testIncrementalSha256 };
