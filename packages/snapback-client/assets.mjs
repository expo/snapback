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
// resolves the caller. Declared anonymous-public custody carries the same
// auth-client protocol offer without a credential. A bare no-custody client
// retains the empty dev-lane fallback; asset request DTOs carry no dev auth
// member, so those HTTP requests resolve anonymous server-side today. The
// reserved record projection rides `SnapbackClient.subscribeLive`, whose
// custody the parent client owns; sessions-mode establishment of that
// projection is refused server-side until its LLP 0053 classification lands
// (W2e).

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
const ISSUED_URL_REFRESH_SKEW_MS = 30_000;
const ISSUED_URL_RETRY_BASE_MS = 1_000;
const ISSUED_URL_RETRY_MAX_MS = 30_000;

const TERMINAL = ['ready', 'rejected', 'cancelled', 'failed'];

const ISSUED_URL_CONSTRUCTION_SNAPSHOT = Object.freeze({
  url: null,
  status: 'issuing',
  diagnostic: null,
  expiresAt: null,
  rendition: null,
});

const MEDIA_KINDS = /* @__PURE__ */ new Set(['image', 'video', 'audio', 'file']);
const EMPTY_MEDIA_SNAPSHOT = /* @__PURE__ */ Object.freeze({
  status: 'empty',
  media: null,
});
const EMPTY_MEDIA_COLLECTION_SNAPSHOT = /* @__PURE__ */ Object.freeze([]);

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

function transferError(status) {
  const error = new Error(`asset transfer failed: ${status}`);
  error.diagnostic = { code: 'SNAPBACK_ASSET_TRANSFER_FAILED', status };
  return error;
}

function redirectRefusedError(status) {
  const message = 'redirects on credential-carrying requests are terminal';
  const error = new Error(`SNAPBACK_REDIRECT_REFUSED: ${message}`);
  error.code = 'SNAPBACK_REDIRECT_REFUSED';
  error.diagnostic = Object.freeze({
    code: error.code,
    message,
    details: Object.freeze({ status: typeof status === 'number' ? status : null }),
  });
  return error;
}

// 304 is a cache validator, not a redirect; every member below names another
// hop that must not receive the original request's bearer.
const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 305, 307, 308]);
const isRedirectResponse = (response) => (
  response?.type === 'opaqueredirect' || REDIRECT_STATUSES.has(response?.status)
);

function hasAuthorizationHeader(headers) {
  if (!headers) return false;
  if (typeof headers.get === 'function') return headers.get('authorization') != null;
  if (Array.isArray(headers)) {
    return headers.some(([name]) => String(name).toLowerCase() === 'authorization');
  }
  return Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
}

function assetFetchInit(init) {
  if (!hasAuthorizationHeader(init?.headers)) return init;
  return { ...init, redirect: 'manual' };
}

async function refuseCredentialRedirect(response, headers) {
  if (!hasAuthorizationHeader(headers) || !isRedirectResponse(response)) return;
  try { await response.body?.cancel?.(); } catch { /* the refusal owns cleanup */ }
  throw redirectRefusedError(response.status);
}

function immutableDiagnosticValue(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  for (const [key, member] of Object.entries(value)) {
    clone[key] = immutableDiagnosticValue(member, seen);
  }
  return Object.freeze(clone);
}

function freezeDiagnostic(value, fallbackMessage = 'asset operation failed') {
  const raw = value && typeof value === 'object' ? value : {};
  return immutableDiagnosticValue({
    ...raw,
    code: typeof raw.code === 'string' ? raw.code : 'SNAPBACK_ASSET_TRANSFER_FAILED',
    message: typeof raw.message === 'string' ? raw.message : fallbackMessage,
  });
}

function retryIneligibleError(snapshot, message) {
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: 'SNAPBACK_ASSET_RETRY_INELIGIBLE',
    severity: 'error',
    message,
    details: Object.freeze({
      assetId: snapshot.assetId,
      predecessorStatus: snapshot.status,
      retryable: false,
      effectCommitted: false,
    }),
  });
  const error = new Error(message);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  return error;
}

function terminalUploadError(snapshot) {
  const diagnostic = freezeDiagnostic(
    snapshot.diagnostic,
    `asset upload ended with terminal status ${snapshot.status}`,
  );
  const error = new Error(diagnostic.message);
  error.code = diagnostic.code;
  error.status = snapshot.status;
  error.terminalStatus = snapshot.status;
  error.diagnostic = diagnostic;
  return error;
}

function isStructuredAuthorizationRefusal(diagnostic) {
  if (!diagnostic || typeof diagnostic.code !== 'string') return false;
  const [namespace, subsystem, ...members] = diagnostic.code.split('_');
  return namespace === 'SNAPBACK' && (
    members.at(-1) === 'FORBIDDEN'
    || members.at(-1) === 'DENIED'
    || (subsystem === 'ASSET' && members.join('_') === 'OWNER_CUSTODY_UNSATISFIABLE')
  );
}

function issuanceOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('signed URL options must be an object');
  }
  return Object.freeze({
    ...(options.variant === undefined ? {} : { variant: options.variant }),
    ...(options.widthPx === undefined ? {} : { widthPx: options.widthPx }),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
  });
}

/**
 * One demand-owned issued URL entry. The containing asset client is the keyed
 * controller/registry; equal app + authority + asset + option identities get
 * this same object and therefore share one issuance loop.
 *
 * @ref LLP 0210#d1--client-arm-signed-issuance-and-ttl-refresh-projection —
 * issuance state, refresh, denied recovery, and retry belong to the neutral
 * controller rather than a framework projection.
 */
class AssetIssuedUrlStore {
  #assetId;
  #authority;
  #disposed = false;
  #expiresAt = 0;
  #generation = 0;
  #inFlight = null;
  #issue;
  #listeners = new Set();
  #lingerGeneration = 0;
  #onEvict;
  #options;
  #retryAttempt = 0;
  #snapshot = ISSUED_URL_CONSTRUCTION_SNAPSHOT;
  #timer = null;

  constructor({ assetId, options, authority, issue, onEvict }) {
    this.#assetId = assetId;
    this.#options = options;
    this.#authority = authority;
    this.#issue = issue;
    this.#onEvict = onEvict;
  }

  get authority() {
    return this.#authority;
  }

  getSnapshot() {
    return this.#snapshot;
  }

  getServerSnapshot() {
    return ISSUED_URL_CONSTRUCTION_SNAPSHOT;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('issued URL store listener must be a function');
    }
    if (this.#disposed) return () => {};
    const hadDemand = this.#listeners.size > 0;
    this.#listeners.add(listener);
    this.#lingerGeneration += 1;
    if (!hadDemand) {
      const valid = this.#snapshot.url !== null && this.#expiresAt > Date.now();
      if (valid) {
        this.#scheduleRefresh();
      } else {
        void this.#beginIssuance();
      }
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#releaseDemand();
    };
  }

  refresh() {
    if (this.#disposed || this.#listeners.size === 0) return Promise.resolve();
    return this.#beginIssuance();
  }

  #publish(next) {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze(next);
    for (const listener of [...this.#listeners]) {
      try { listener(this.#snapshot); } catch { /* observers cannot break the issuance loop */ }
    }
  }

  #clearTimer() {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #setTimer(delayMs, generation, callback) {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (
        this.#disposed
        || this.#listeners.size === 0
        || generation !== this.#generation
      ) return;
      callback();
    }, Math.max(0, delayMs));
    this.#timer.unref?.();
  }

  #scheduleRefresh() {
    if (this.#disposed || this.#listeners.size === 0) return;
    const lifetime = this.#expiresAt - Date.now();
    if (lifetime <= 0) {
      void this.#beginIssuance();
      return;
    }
    const skew = Math.min(
      ISSUED_URL_REFRESH_SKEW_MS,
      Math.max(1, Math.floor(lifetime / 5)),
    );
    const generation = this.#generation;
    this.#setTimer(lifetime - skew, generation, () => {
      void this.#beginIssuance();
    });
  }

  #scheduleRetry() {
    if (this.#disposed || this.#listeners.size === 0) return;
    const exponential = ISSUED_URL_RETRY_BASE_MS * (2 ** Math.min(this.#retryAttempt, 5));
    const bounded = Math.min(exponential, ISSUED_URL_RETRY_MAX_MS);
    this.#retryAttempt += 1;
    const validFor = this.#snapshot.url === null ? null : this.#expiresAt - Date.now();
    const delay = validFor === null ? bounded : Math.min(bounded, Math.max(0, validFor));
    const generation = this.#generation;
    this.#setTimer(delay, generation, () => {
      void this.#beginIssuance();
    });
  }

  #beginIssuance() {
    if (this.#disposed || this.#listeners.size === 0) return Promise.resolve();
    if (this.#inFlight) return this.#inFlight;
    this.#clearTimer();
    const valid = this.#snapshot.url !== null && this.#expiresAt > Date.now();
    if (!valid) this.#expiresAt = 0;
    this.#publish({
      url: valid ? this.#snapshot.url : null,
      status: valid ? 'refreshing' : 'issuing',
      diagnostic: this.#snapshot.diagnostic,
      expiresAt: valid ? this.#expiresAt : null,
      rendition: valid ? this.#snapshot.rendition : null,
    });
    const generation = this.#generation + 1;
    this.#generation = generation;
    const work = Promise.resolve()
      .then(() => this.#issue(this.#assetId, this.#options, this.#authority))
      .then((issued) => {
        if (
          this.#disposed
          || this.#listeners.size === 0
          || generation !== this.#generation
          || !this.#authority.isCurrent()
        ) return;
        if (
          !issued
          || typeof issued.url !== 'string'
          || !Number.isSafeInteger(issued.expiresAt)
          || issued.expiresAt <= Date.now()
        ) {
          const error = new Error('signed URL issuance returned an invalid or expired response');
          error.diagnostic = {
            code: 'SNAPBACK_ASSET_HTTP_ERROR',
            message: error.message,
          };
          throw error;
        }
        this.#expiresAt = issued.expiresAt;
        this.#retryAttempt = 0;
        this.#inFlight = null;
        this.#publish({
          url: issued.url,
          status: 'ready',
          diagnostic: null,
          expiresAt: issued.expiresAt,
          rendition: issued.variant,
        });
        this.#scheduleRefresh();
      })
      .catch((error) => {
        if (
          this.#disposed
          || this.#listeners.size === 0
          || generation !== this.#generation
          || !this.#authority.isCurrent()
        ) return;
        const diagnostic = freezeDiagnostic(error?.diagnostic, error?.message);
        this.#inFlight = null;
        if (isStructuredAuthorizationRefusal(diagnostic)) {
          this.#expiresAt = 0;
          this.#publish({
            url: null,
            status: 'denied',
            diagnostic,
            expiresAt: null,
            rendition: null,
          });
          return;
        }
        const stillValid = this.#snapshot.url !== null && this.#expiresAt > Date.now();
        this.#publish({
          url: stillValid ? this.#snapshot.url : null,
          status: stillValid ? 'ready' : 'unavailable',
          diagnostic,
          expiresAt: stillValid ? this.#expiresAt : null,
          rendition: stillValid ? this.#snapshot.rendition : null,
        });
        this.#scheduleRetry();
      })
      .finally(() => {
        if (generation === this.#generation) this.#inFlight = null;
      });
    this.#inFlight = work;
    return work;
  }

  #releaseDemand() {
    // @ref LLP 0114#external-store-composition-and-cleanup — the final
    // subscriber fences in-flight work synchronously, while eviction waits
    // one microtask so a Strict-Mode replay can reattach to valid held state.
    this.#generation += 1;
    this.#inFlight = null;
    this.#clearTimer();
    const lingerGeneration = this.#lingerGeneration + 1;
    this.#lingerGeneration = lingerGeneration;
    queueMicrotask(() => {
      if (
        this.#disposed
        || this.#listeners.size > 0
        || lingerGeneration !== this.#lingerGeneration
      ) return;
      this.#dispose(false);
      this.#onEvict();
    });
  }

  _disposeForAuthorityChange() {
    this.#dispose(true);
  }

  #dispose(publishBlank) {
    if (this.#disposed) return;
    this.#generation += 1;
    this.#inFlight = null;
    this.#clearTimer();
    this.#snapshot = ISSUED_URL_CONSTRUCTION_SNAPSHOT;
    if (publishBlank) {
      for (const listener of [...this.#listeners]) {
        try { listener(this.#snapshot); } catch { /* confidentiality blanking continues */ }
      }
    }
    this.#disposed = true;
  }
}

function assertMediaRef(mediaRefOrNull) {
  if (mediaRefOrNull === null || mediaRefOrNull === undefined) return null;
  if (mediaRefOrNull === '') {
    throw new TypeError(
      'mediaStore mediaRefOrNull must be null or undefined for no media; an empty string is not a media reference',
    );
  }
  if (
    !mediaRefOrNull
    || typeof mediaRefOrNull !== 'object'
    || Array.isArray(mediaRefOrNull)
    || typeof mediaRefOrNull.assetId !== 'string'
    || mediaRefOrNull.assetId.length === 0
    || !MEDIA_KINDS.has(mediaRefOrNull.kind)
  ) {
    throw new TypeError(
      'mediaStore mediaRefOrNull must be null, undefined, or { assetId: non-empty string, kind: image|video|audio|file }',
    );
  }
  return Object.freeze({ assetId: mediaRefOrNull.assetId, kind: mediaRefOrNull.kind });
}

function mediaIssuanceOptions(media, options = {}) {
  const normalized = issuanceOptions(options);
  if (media.kind !== 'image' && normalized.widthPx !== undefined) {
    throw new TypeError('mediaStore widthPx is supported only for image media');
  }
  return Object.freeze({
    ...normalized,
    variant: normalized.variant ?? 'primary',
  });
}

/**
 * The media projection is deliberately only a view over AssetIssuedUrlStore:
 * it owns no transport, authority, refresh timer, retry loop, or capability
 * probing. Null uses a separate inert singleton and therefore cannot begin
 * issuance.
 *
 * @ref LLP 0239#d5-one-media-projection-handles-empty-image-video-denial-and-refresh —
 * empty is synchronous and URL-bearing states inherit the neutral issued-URL
 * controller's authority and refresh fences.
 */
class MediaStore {
  #issued;
  #media;
  #serverSnapshot;
  #snapshot;
  #sourceSnapshot;

  constructor(issued, media) {
    this.#issued = issued;
    this.#media = media;
    this.#serverSnapshot = Object.freeze({ status: 'issuing', media });
    this.#sourceSnapshot = issued.getSnapshot();
    this.#snapshot = this.#project(this.#sourceSnapshot);
  }

  #project(source) {
    if (source.status === 'ready' || source.status === 'refreshing') {
      return Object.freeze({
        status: source.status,
        media: this.#media,
        url: source.url,
        expiresAt: source.expiresAt,
        rendition: source.rendition,
        ...(source.status === 'refreshing' && source.diagnostic !== null
          ? { diagnostic: source.diagnostic }
          : {}),
      });
    }
    if (source.status === 'unavailable' || source.status === 'denied') {
      return Object.freeze({
        status: source.status,
        media: this.#media,
        diagnostic: source.diagnostic,
      });
    }
    return Object.freeze({ status: 'issuing', media: this.#media });
  }

  #sync(source) {
    if (source !== this.#sourceSnapshot) {
      this.#sourceSnapshot = source;
      this.#snapshot = this.#project(source);
    }
    return this.#snapshot;
  }

  getSnapshot() {
    return this.#sync(this.#issued.getSnapshot());
  }

  getServerSnapshot() {
    return this.#serverSnapshot;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('media store listener must be a function');
    }
    return this.#issued.subscribe((source) => {
      this.#sync(source);
      listener(this.#snapshot);
    });
  }

  refresh() {
    return this.#issued.refresh();
  }
}

const EMPTY_MEDIA_STORE = /* @__PURE__ */ Object.freeze({
  getSnapshot: () => EMPTY_MEDIA_SNAPSHOT,
  getServerSnapshot: () => EMPTY_MEDIA_SNAPSHOT,
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('media store listener must be a function');
    }
    return () => {};
  },
  refresh: () => Promise.resolve(),
});

function assertMediaCollectionItems(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('mediaCollectionStore items must be an array of generated collection items');
  }
  if (items.length === 0) return EMPTY_MEDIA_COLLECTION_SNAPSHOT;
  if (items.length > 32) {
    throw new TypeError('mediaCollectionStore items must contain at most 32 generated collection items');
  }
  const itemIds = new Set();
  return Object.freeze(items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`mediaCollectionStore items[${index}] must be a generated collection item`);
    }
    if (typeof item.itemId !== 'string' || item.itemId.length === 0) {
      throw new TypeError(`mediaCollectionStore items[${index}].itemId must be a non-empty string`);
    }
    if (itemIds.has(item.itemId)) {
      throw new TypeError(`mediaCollectionStore itemId ${JSON.stringify(item.itemId)} is duplicated`);
    }
    if (!Number.isSafeInteger(item.ordinal) || item.ordinal < 0) {
      throw new TypeError(`mediaCollectionStore items[${index}].ordinal must be a non-negative integer`);
    }
    itemIds.add(item.itemId);
    return Object.freeze({
      itemId: item.itemId,
      ordinal: item.ordinal,
      media: assertMediaRef(item.media),
    });
  }));
}

/**
 * Pure bounded aggregation of MediaStore children. Each child retains the one
 * issued-URL controller selected by asset, authority, and rendition options;
 * this aggregate owns no transport, timer, retry, or authorization state.
 *
 * @ref LLP 0239#d5-one-media-projection-handles-empty-image-video-denial-and-refresh —
 * item identity remains stable while denial/unavailability stays local to the
 * affected child and empty collections create no issuance demand.
 */
class MediaCollectionStore {
  #children;
  #listeners = new Set();
  #releases = null;
  #serverSnapshot;
  #snapshot;

  constructor(assetClient, items, options) {
    this.#children = items.map((item) => {
      const store = assetClient.mediaStore(item.media, options);
      const child = {
        item,
        store,
        refresh: () => store.refresh(),
        source: null,
        projection: null,
        serverSource: null,
        serverProjection: null,
      };
      return child;
    });
    this.#snapshot = this.#project(false);
    this.#serverSnapshot = this.#project(true);
  }

  #project(server) {
    let changed = false;
    const projections = this.#children.map((child) => {
      const source = server ? child.store.getServerSnapshot() : child.store.getSnapshot();
      const sourceKey = server ? 'serverSource' : 'source';
      const projectionKey = server ? 'serverProjection' : 'projection';
      if (child[sourceKey] !== source) {
        child[sourceKey] = source;
        child[projectionKey] = Object.freeze({
          itemId: child.item.itemId,
          ordinal: child.item.ordinal,
          state: source,
          refresh: child.refresh,
        });
        changed = true;
      }
      return child[projectionKey];
    });
    const current = server ? this.#serverSnapshot : this.#snapshot;
    return changed || current === undefined ? Object.freeze(projections) : current;
  }

  getSnapshot() {
    this.#snapshot = this.#project(false);
    return this.#snapshot;
  }

  getServerSnapshot() {
    return this.#serverSnapshot;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('media collection store listener must be a function');
    }
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      this.#releases = this.#children.map((child) => child.store.subscribe(() => {
        const previous = this.#snapshot;
        this.#snapshot = this.#project(false);
        if (this.#snapshot === previous) return;
        for (const observer of [...this.#listeners]) {
          try { observer(this.#snapshot); } catch { /* observational */ }
        }
      }));
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0 && this.#releases !== null) {
        const releases = this.#releases;
        this.#releases = null;
        for (const release of releases) release();
      }
    };
  }

  refresh(itemId) {
    if (itemId === undefined) {
      return Promise.all(this.#children.map((child) => child.store.refresh())).then(() => {});
    }
    const child = this.#children.find((candidate) => candidate.item.itemId === itemId);
    if (!child) {
      throw new TypeError(`mediaCollectionStore cannot refresh unknown itemId ${JSON.stringify(itemId)}`);
    }
    return child.store.refresh();
  }
}

const EMPTY_MEDIA_COLLECTION_STORE = /* @__PURE__ */ Object.freeze({
  getSnapshot: () => EMPTY_MEDIA_COLLECTION_SNAPSHOT,
  getServerSnapshot: () => EMPTY_MEDIA_COLLECTION_SNAPSHOT,
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('media collection store listener must be a function');
    }
    return () => {};
  },
  refresh: () => Promise.resolve(),
});

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
    if (TERMINAL.includes(this.#snapshot.status)) return;
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
  #fetch;
  #tasks = new WeakMap();
  #issuedUrlEntries = new Map();
  #issuedUrlPartition = 0;
  #issuedUrlAuthorityCapture = null;

  constructor(client, {
    taskStore = null,
    chunkBytes = DEFAULT_CHUNK_BYTES,
    fetch: fetchOverride = null,
  } = {}) {
    if (fetchOverride !== null && typeof fetchOverride !== 'function') {
      throw new TypeError('asset client fetch adapter must be a function');
    }
    this.#client = client;
    this.#taskStore = taskStore ?? createMemoryAssetTaskStore();
    this.#chunkBytes = chunkBytes;
    // @ref LLP 0062#4-auth-the-existing-model-projected--with-explicit-selection —
    // the default adapter is itself a last-line redirect fence for every
    // bearer-carrying asset request.
    this.#fetch = fetchOverride ?? ((input, init) => fetch(input, assetFetchInit(init)));
    if (typeof this.#client.registerAuthMaterialization === 'function') {
      this.#client.registerAuthMaterialization({
        capture: () => this.#issuedUrlAuthorityCapture,
        blank: () => this.#disposeIssuedUrlEntries(),
      });
    }
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
  #custodyHeaders(
    userId,
    authorityCapture = undefined,
    externalTransportGeneration = undefined,
  ) {
    // @ref LLP 0096#2-per-profile-contract — the parent client's auth/rr
    // offer repeats on every asset boundary; the offer is not a credential.
    const authClientProtocol = this.#client.authProtocols?.authClient ?? null;
    const protocolHeaders = authClientProtocol === null
      ? {}
      : { 'x-snapback-auth-client-protocol': String(authClientProtocol) };

    // A sessions request must offer the exact auth-client protocol beside
    // its credential (the server refuses a bare bearer). The v1 fallback
    // preserves the existing shallow-adapter behavior; SnapbackClient owns
    // and exposes the protocol projection used by normal parent clients.
    const bearerHeaders = (bearer) => ({
      authorization: `Bearer ${bearer}`,
      ...(authClientProtocol === null
        ? { 'x-snapback-auth-client-protocol': '1' }
        : protocolHeaders),
    });
    const fence = this.#client.authorityFence;
    if (fence) {
      try {
        const capture = authorityCapture === undefined ? fence.capture() : authorityCapture;
        const current = typeof fence.isCurrent === 'function'
          ? fence.isCurrent(capture) === true
          : authorityCapture === undefined;
        if (capture === null || !current) {
          const error = new Error('asset task authority was replaced');
          error.code = 'SNAPBACK_CLIENT_AUTHORITY_STALE';
          error.diagnostic = {
            code: error.code,
            message: error.message,
            details: { effectCommitted: false },
          };
          throw error;
        }
        const bearer = fence.credentialFor(capture).bearer;
        if (bearer) return bearerHeaders(bearer);
      } catch (error) {
        if (authorityCapture !== undefined) throw error;
        // No current credential — fall through to the dev-lane posture.
      }
    }
    const external = this.#client.bearerToken;
    if (
      externalTransportGeneration !== undefined
      && (
        this.#client.__externalBearerTransition !== null
        || this.#client.__authTransportGeneration !== externalTransportGeneration
      )
    ) {
      const error = new Error('asset task external authority was replaced');
      error.code = 'SNAPBACK_CLIENT_AUTHORITY_STALE';
      error.diagnostic = {
        code: error.code,
        message: error.message,
        details: { effectCommitted: false },
      };
      throw error;
    }
    if (typeof external === 'string' && external.length > 0) {
      return bearerHeaders(external);
    }
    // @ref LLP 0176#one-owner-many-projections — anonymous-public is the
    // parent's declared credential-free auth/rr projection, not an asset-only
    // identity. Bare clients below must remain the offerless dev fallback.
    if (this.#client.custody === 'anonymous-public') {
      return protocolHeaders;
    }
    // Dev-lane HTTP asset requests resolve anonymously today: no server
    // route reads a dev identity header, and TUS PATCH bodies are raw bytes
    // so the body-authority shape cannot ride them. Sending a dead header
    // implied custody that did not exist; per-user dev identity flows
    // through host-ops (`asset.put`) until the recorded dev-lane
    // body-authority gap gets its design.
    return {};
  }

  async #json(method, path, body, {
    userId = null,
    authorityCapture = undefined,
    externalTransportGeneration = undefined,
  } = {}) {
    const headers = {
      'content-type': 'application/json',
      ...this.#custodyHeaders(userId, authorityCapture, externalTransportGeneration),
    };
    const response = await this.#fetch(`${this.#client.baseUrl}${path}`, assetFetchInit({
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    await refuseCredentialRedirect(response, headers);
    const text = await response.text();
    const value = text.length > 0 ? JSON.parse(text) : null;
    if (!response.ok) {
      const diagnostic = value?.diagnostics?.[0] ?? value ?? {
        code: 'SNAPBACK_ASSET_HTTP_ERROR',
        message: `HTTP ${response.status}`,
      };
      const error = new Error(diagnostic.message ?? `HTTP ${response.status}`);
      if (typeof diagnostic.code === 'string') error.code = diagnostic.code;
      error.diagnostic = diagnostic;
      throw error;
    }
    return value;
  }

  #captureIssuedUrlAuthority() {
    let authorityCapture = null;
    const fence = this.#client.authorityFence;
    if (fence) {
      authorityCapture = fence.capture();
      if (authorityCapture === null || fence.isCurrent?.(authorityCapture) !== true) {
        const error = new Error('signed URL authority is not current');
        error.code = 'SNAPBACK_CLIENT_AUTHORITY_STALE';
        error.diagnostic = {
          code: error.code,
          message: error.message,
          details: { effectCommitted: false },
        };
        throw error;
      }
    }
    const externalTransportGeneration = this.#client.__authTransportGeneration;
    if (
      externalTransportGeneration !== undefined
      && this.#client.__externalBearerTransition != null
    ) {
      const error = new Error('signed URL admission is closed during authority replacement');
      error.code = 'SNAPBACK_CLIENT_AUTHORITY_STALE';
      error.diagnostic = {
        code: error.code,
        message: error.message,
        details: { effectCommitted: false },
      };
      throw error;
    }
    return Object.freeze({
      authorityCapture,
      externalTransportGeneration,
      isCurrent: () => {
        if (fence) return fence.isCurrent?.(authorityCapture) === true;
        if (externalTransportGeneration === undefined) return true;
        return (
          (
            this.#client.__externalBearerTransition === null
            || this.#client.__externalBearerTransition === undefined
          )
          && this.#client.__authTransportGeneration === externalTransportGeneration
        );
      },
    });
  }

  #sameIssuedUrlAuthority(left, right) {
    if (!left.isCurrent() || !right.isCurrent()) return false;
    if (left.authorityCapture !== null || right.authorityCapture !== null) {
      // An authority fence has exactly one current cohort. Captures need not
      // be referentially identical when the fence returns immutable copies.
      return left.authorityCapture !== null && right.authorityCapture !== null;
    }
    return left.externalTransportGeneration === right.externalTransportGeneration;
  }

  #disposeIssuedUrlEntries() {
    this.#issuedUrlPartition += 1;
    this.#issuedUrlAuthorityCapture = null;
    const entries = [...this.#issuedUrlEntries.values()];
    this.#issuedUrlEntries.clear();
    for (const entry of entries) entry._disposeForAuthorityChange();
  }

  async #issueSignedUrl(assetId, options, authority = null) {
    const issued = await this.#json(
      'POST',
      `/assets/records/${encodeURIComponent(assetId)}/signed-url`,
      options,
      authority === null
        ? {}
        : {
            authorityCapture: authority.authorityCapture,
            externalTransportGeneration: authority.externalTransportGeneration,
          },
    );
    const expiresAt = issued?.expiresAt ?? issued?.expiresAtMs;
    const base = this.#client.baseUrl.endsWith('/')
      ? this.#client.baseUrl
      : `${this.#client.baseUrl}/`;
    return Object.freeze({
      url: new URL(issued.url, base).href,
      expiresAt,
      variant: issued.variant,
    });
  }

  /** Pure authorized signed-URL issuance. No response is cached here. */
  signedUrl(assetId, options = {}) {
    if (typeof assetId !== 'string' || assetId.length === 0) {
      throw new TypeError('signedUrl requires a non-empty asset id');
    }
    return this.#issueSignedUrl(assetId, issuanceOptions(options));
  }

  /**
   * Return the shared issued-URL entry for this app/authority/options key.
   * The entry starts work only while subscribed; final unsubscribe fences it
   * synchronously and lets it linger for one microtask before eviction.
   */
  issuedUrlStore(assetId, options = {}) {
    if (typeof assetId !== 'string' || assetId.length === 0) {
      throw new TypeError('issuedUrlStore requires a non-empty asset id');
    }
    const normalized = issuanceOptions(options);
    const authority = this.#captureIssuedUrlAuthority();
    const currentEntry = this.#issuedUrlEntries.values().next().value;
    if (currentEntry && !this.#sameIssuedUrlAuthority(currentEntry.authority, authority)) {
      this.#disposeIssuedUrlEntries();
    }
    this.#issuedUrlAuthorityCapture = authority.authorityCapture;
    const optionIdentity = JSON.stringify([
      assetId,
      Object.hasOwn(normalized, 'variant') ? normalized.variant : null,
      Object.hasOwn(normalized, 'widthPx') ? normalized.widthPx : null,
      Object.hasOwn(normalized, 'ttlMs') ? normalized.ttlMs : null,
    ]);
    const key = this.taskStoreKey({
      userId: `issued-url-authority-${this.#issuedUrlPartition}`,
      assetId: optionIdentity,
    });
    const existing = this.#issuedUrlEntries.get(key);
    if (existing) return existing;
    let entry;
    entry = new AssetIssuedUrlStore({
      assetId,
      options: normalized,
      authority,
      issue: (id, requestOptions, capturedAuthority) => (
        this.#issueSignedUrl(id, requestOptions, capturedAuthority)
      ),
      onEvict: () => {
        if (this.#issuedUrlEntries.get(key) === entry) {
          this.#issuedUrlEntries.delete(key);
        }
      },
    });
    this.#issuedUrlEntries.set(key, entry);
    return entry;
  }

  /**
   * Empty-safe projection over the shared issued-URL controller. This method
   * performs no signed-route probe; work begins only when a non-empty store is
   * subscribed.
   */
  mediaStore(mediaRefOrNull, options = {}) {
    const media = assertMediaRef(mediaRefOrNull);
    if (media === null) return EMPTY_MEDIA_STORE;
    const normalized = mediaIssuanceOptions(media, options);
    return new MediaStore(this.issuedUrlStore(media.assetId, normalized), media);
  }

  /**
   * Project one generated bounded collection through the same neutral media
   * stores used by scalar media. Empty input is an inert frozen singleton.
   */
  mediaCollectionStore(items, options = {}) {
    const normalizedItems = assertMediaCollectionItems(items);
    if (normalizedItems.length === 0) return EMPTY_MEDIA_COLLECTION_STORE;
    return new MediaCollectionStore(this, normalizedItems, options);
  }

  start({
    upload,
    args = {},
    file,
    userId = null,
    declaredFilename = null,
    declaredContentType = null,
    previewUrl = null,
    authorityCapture = undefined,
    externalTransportGeneration = undefined,
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
      authorityCapture,
      externalTransportGeneration,
    });
    void this.#start(task);
    return task;
  }

  async #normalizeUploadSource(source) {
    if (
      source
      && typeof source === 'object'
      && !Array.isArray(source)
      && typeof source.uri === 'string'
    ) {
      const response = await this.#fetch(source.uri);
      if (!response.ok) throw transferError(response.status);
      const blob = await response.blob();
      const fileName = source.fileName ?? 'upload';
      const mimeType = source.mimeType ?? blob.type ?? '';
      const file = typeof globalThis.File === 'function'
        ? new globalThis.File([blob], fileName, { type: mimeType })
        : {
            size: blob.size,
            name: fileName,
            type: mimeType,
            slice: (start, end) => blob.slice(start, end),
          };
      return {
        file,
        declaredFilename: fileName,
        declaredContentType: mimeType || null,
      };
    }
    assertFileLike(source);
    return {
      file: source,
      declaredFilename: typeof source.name === 'string' ? source.name : null,
      declaredContentType: typeof source.type === 'string' && source.type.length > 0
        ? source.type
        : null,
    };
  }

  /**
   * Settle-or-reject convenience over the task-level upload surface.
   * @ref LLP 0210#d3--assetsupload-and-the-taskdone-contract — ready is the
   * only successful terminal row; the helper never retries.
   */
  async upload(upload, source, { args = {} } = {}) {
    const normalized = await this.#normalizeUploadSource(source);
    const task = this.start({
      upload,
      args,
      file: normalized.file,
      declaredFilename: normalized.declaredFilename,
      declaredContentType: normalized.declaredContentType,
    });
    const snapshot = await task.done;
    if (snapshot.status === 'ready' && typeof snapshot.assetId === 'string') {
      return snapshot.assetId;
    }
    throw terminalUploadError(snapshot);
  }

  async #start(task, { returnAfterAdmission = false } = {}) {
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
        {
          userId: state.userId,
          authorityCapture: state.authorityCapture,
          externalTransportGeneration: state.externalTransportGeneration,
        },
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
      if (returnAfterAdmission) {
        void this._drive(task);
        return;
      }
      await this._drive(task);
    } catch (error) {
      task._apply({
        status: 'failed',
        diagnostic: freezeDiagnostic(error.diagnostic, error.message),
      });
      if (returnAfterAdmission) throw error;
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
        const headers = {
          'tus-resumable': TUS_VERSION,
          ...this.#custodyHeaders(
            state.userId,
            state.authorityCapture,
            state.externalTransportGeneration,
          ),
        };
        const head = await this.#fetch(
          `${this.#client.baseUrl}${state.transfer.uploadUrl}`,
          assetFetchInit({
            method: 'HEAD',
            headers,
          }),
        );
        await refuseCredentialRedirect(head, headers);
        if (!head.ok) {
          throw transferError(head.status);
        }
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
        const headers = {
          'tus-resumable': TUS_VERSION,
          'content-type': 'application/offset+octet-stream',
          'upload-offset': String(state.offset),
          // The conformance requirement: every PATCH carries a checksum.
          'upload-checksum': `sha256 ${sha256Base64(bytes)}`,
          ...this.#custodyHeaders(
            state.userId,
            state.authorityCapture,
            state.externalTransportGeneration,
          ),
        };
        const response = await this.#fetch(
          `${this.#client.baseUrl}${state.transfer.uploadUrl}`,
          assetFetchInit({
            method: 'PATCH',
            signal: controller.signal,
            headers,
            body: bytes,
          }),
        );
        await refuseCredentialRedirect(response, headers);
        if (!response.ok) {
          throw transferError(response.status);
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
        {
          userId: state.userId,
          authorityCapture: state.authorityCapture,
          externalTransportGeneration: state.externalTransportGeneration,
        },
      );
      const availability = finalized.task.availability;
      task._apply({
        status: availability === 'ready' ? 'ready' : 'rejected',
        diagnostic: availability === 'ready'
          ? null
          : freezeDiagnostic(
              finalized.task.diagnostic ?? finalized.diagnostics?.[0],
              'asset finalization was rejected',
            ),
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
        diagnostic: freezeDiagnostic(error.diagnostic, error.message),
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
          {
            userId: this.#tasks.get(task)?.userId ?? null,
            authorityCapture: this.#tasks.get(task)?.authorityCapture,
            externalTransportGeneration: this.#tasks.get(task)?.externalTransportGeneration,
          },
        );
      }
    } finally {
      const state = this.#tasks.get(task);
      if (state && snapshot.assetId) {
        this.#taskStore.delete(
          this.taskStoreKey({ userId: state.userId, assetId: snapshot.assetId }),
        );
      }
      task._apply({
        status: 'cancelled',
        diagnostic: freezeDiagnostic(null, 'asset upload was cancelled'),
      });
    }
  }

  /** Successor attempt for the SAME asset id (0044: retry never re-identifies). */
  async _retry(task) {
    const state = this.#tasks.get(task);
    const snapshot = task.snapshot();
    if (!TERMINAL.includes(snapshot.status)) {
      throw retryIneligibleError(snapshot, 'retry requires a terminal asset task');
    }
    if (snapshot.status === 'ready') {
      throw retryIneligibleError(snapshot, 'a ready asset cannot be retried');
    }
    if (snapshot.status === 'rejected') {
      throw retryIneligibleError(snapshot, 'a durably rejected asset cannot be retried');
    }
    if (!state || !snapshot.assetId) {
      throw retryIneligibleError(snapshot, 'retry requires a task that reserved an asset id');
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
    // Admission owns pending eligibility. Do not expose a successor until the
    // server has accepted a same-asset attempt; a typed refusal rejects this
    // retry call and the predecessor remains the only public task.
    await this.#start(successor, { returnAfterAdmission: true });
    return successor;
  }

  /** One authorized metadata read. */
  record(assetId) {
    return this.#json('GET', `/assets/records/${encodeURIComponent(assetId)}`);
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

  /** A pasteable public-immutable rendition URL. The caller selects one
   * concrete ready variant from the authorized record projection first. */
  publicDeliveryUrl(assetId, { variant = 'primary', width = null } = {}) {
    if (typeof variant !== 'string' || variant.length === 0 || variant === 'best') {
      throw new TypeError('publicDeliveryUrl requires a concrete rendition variant');
    }
    const base = `${this.#client.baseUrl}/assets/public/${encodeURIComponent(assetId)}/${encodeURIComponent(variant)}`;
    if (width === null) return base;
    if (!Number.isSafeInteger(width) || width <= 0) {
      throw new TypeError('publicDeliveryUrl width must be a positive integer');
    }
    return `${base}?width=${width}`;
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
