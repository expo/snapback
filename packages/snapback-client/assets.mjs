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
// Transport posture: this v1 surface is the dev-lane client — it talks the
// asset route family directly and rides `SnapbackClient.subscribeLive` for
// the reserved record projection. Sessions-custody integration follows the
// server's own sessions-mode admission of the projection (both recorded in
// the live-projection follow-up ticket).

import { createHash } from 'node:crypto';

/** The reserved system live query projecting one asset record. */
export const ASSET_RECORD_LIVE_FUNCTION = '_snapback.assetRecord';

const TUS_VERSION = '1.0.0';
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

const TERMINAL = new Set(['ready', 'rejected', 'cancelled', 'failed']);

/** The exact member set a persisted resume fact may carry. */
export const PERSISTED_RESUME_FACT_MEMBERS = Object.freeze([
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
    return { intentId: upload, intentPolicyHash: null };
  }
  if (
    upload
    && upload.artifactKind === 'assetUploadReference'
    && typeof upload.name === 'string'
  ) {
    return { intentId: upload.name, intentPolicyHash: upload.intentPolicyHash ?? null };
  }
  throw new TypeError(
    'start requires a generated asset upload reference (or its intent name)',
  );
}

async function chunkBytesOf(blob) {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Base64(bytes) {
  return createHash('sha256').update(bytes).digest('base64');
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
    if (TERMINAL.has(this.#snapshot.status)) this.#resolveDone(this.#snapshot);
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
    if (TERMINAL.has(this.#snapshot.status) || this.#paused) return;
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
    if (TERMINAL.has(this.#snapshot.status)) return this.#snapshot;
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

  async #json(method, path, body, { userId = null } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (userId) headers['x-snapback-dev-user'] = userId;
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
          args: state.args,
          declaredFilename: state.declaredFilename,
          declaredLength: state.file.size,
          declaredContentType: state.declaredContentType,
          ...(state.retryOfAssetId ? { retryOfAssetId: state.retryOfAssetId } : {}),
        },
        { userId: state.userId },
      );
      state.transfer = created.transfer;
      state.lifecycleGeneration = created.task.availability === 'pending' ? 1 : 1;
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
      identity: { intentId: null, intentPolicyHash: null },
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
              ...(state.userId ? { 'x-snapback-dev-user': state.userId } : {}),
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
      while (state.offset < state.file.size) {
        if (task._paused || task._cancelled) return;
        const end = Math.min(state.offset + this.#chunkBytes, state.file.size);
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
              ...(state.userId ? { 'x-snapback-dev-user': state.userId } : {}),
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
