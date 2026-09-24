// Assets on the client: `upload` posts the bytes and returns the facts the
// server established; `asset` fetches the bytes under the viewer's own
// credentials and hands back a display URL, so a screen never puts a token in
// an <img src> and a one-view photo is never durably cached anywhere
// (LLP 1006 carried into Snapback 4).

import type { Asset, AssetRead, Refusal, Uploaded } from "./contract.ts";

export type Bytes = Blob | ArrayBuffer | Uint8Array;

const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });

// @ref LLP 3000.011.005.000#8 — React Native Blobs use the public FileReader fallback
export function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return readBlob(blob, "readAsArrayBuffer");
}

function readBlob(blob: Blob, method: "readAsArrayBuffer"): Promise<ArrayBuffer>;
function readBlob(blob: Blob, method: "readAsDataURL"): Promise<string>;
function readBlob(blob: Blob, method: "readAsArrayBuffer" | "readAsDataURL"): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const clear = () => { reader.onload = reader.onerror = reader.onabort = null; };
    reader.onload = () => {
      const result = reader.result;
      clear();
      if (method === "readAsArrayBuffer" && result instanceof ArrayBuffer) resolve(result);
      else if (method === "readAsDataURL" && typeof result === "string") resolve(result);
      else reject(new Error("the Blob reader returned an unexpected result"));
    };
    reader.onerror = () => { const error = reader.error; clear(); reject(error ?? new Error("the Blob read failed")); };
    reader.onabort = () => { clear(); reject(new Error("the Blob read was aborted")); };
    try { reader[method](blob); } catch (error) { clear(); reject(error); }
  });
}

async function blobDataURL(blob: Blob, type: string, bytes: number): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp", "video/mp4"].includes(type)) throw new Error("unsupported asset media type");
  const result = await readBlob(blob, "readAsDataURL"), prefix = `data:${type};base64,`;
  const encoded = result.slice(prefix.length), padding = (3 - bytes % 3) % 3;
  if (!result.startsWith(prefix) || encoded.length !== 4 * Math.ceil(bytes / 3)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    || (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0) !== padding) throw new Error("invalid asset data URI");
  return result;
}

// A response Blob belongs to the SDK. Keep it alive until its copy or handle
// is done; native URL revocation alone does not release the host's Blob bytes.
function ownBlob(blob: Blob): () => void {
  let owned: (Blob & { close?: () => void }) | undefined = blob;
  return () => {
    const closing = owned;
    owned = undefined;
    try { closing?.close?.(); } catch { /* Cleanup must not replace the read's result. */ }
  };
}

export async function uploadAsset(base: string, headers: Record<string, string>, doFetch: typeof fetch, bytes: Bytes, canRetry: () => boolean = () => true): Promise<Uploaded> {
  const { "content-type": _json, ...auth } = headers;
  const body = bytes instanceof Uint8Array ? new Blob([bytes as BlobPart]) : bytes;
  try {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const response = await doFetch(`${base}/assets`, { method: "POST", headers: { ...auth, "content-type": "application/octet-stream" }, body });
      const json = (await response.json()) as { asset?: Asset; denied?: Refusal };
      if (json.asset) return { ok: true, asset: json.asset };
      const why = json.denied ?? { code: "E_STORE", family: "store", message: "the server answered without an asset", retryable: true };
      // Only an explicit admission refusal proves these bytes were not stored.
      // A transport failure or another retryable code may follow acceptance.
      if (why.code !== "E_RATE_LIMIT" || why.retryable !== true || attempt === 3 || !canRetry()) return { ok: false, why };
      const delay = Math.max(250 * 2 ** attempt, retryAfter(response.headers.get("retry-after")));
      // Never retry earlier than the server permits. A long Retry-After ends
      // this bounded call instead of parking an upload indefinitely.
      if (waited + delay > 10_000) return { ok: false, why };
      await new Promise(resolve => setTimeout(resolve, delay));
      waited += delay;
      if (!canRetry()) return { ok: false, why };
    }
  } catch {
    return { ok: false, why: offline() };
  }
}

function retryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const delay = Number.isNaN(seconds) ? Date.parse(value) - Date.now() : seconds * 1000;
  return Number.isNaN(delay) ? 0 : Math.max(0, delay);
}

/** Where the bytes are and what to send to get them: for hosts whose image
 * and video views take a URI with headers (React Native). */
export function assetSource(base: string, headers: Record<string, string>, id: string): { uri: string; headers: Record<string, string> } {
  const { "content-type": _json, ...auth } = headers;
  return { uri: `${base}/assets/${encodeURIComponent(id)}`, headers: auth };
}

export async function fetchAsset(base: string, headers: Record<string, string>, doFetch: typeof fetch, id: string, viewed?: (blob: Blob, response: Response) => Promise<AssetRead | void>): Promise<AssetRead> {
  const source = assetSource(base, headers, id);
  let release: (() => void) | undefined;
  try {
    const response = await doFetch(source.uri, { headers: source.headers });
    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as { denied?: Refusal } | null;
      return { denied: json?.denied ?? { code: response.status === 410 ? "E_ASSET_VIEWED" : "E_ASSET_UNKNOWN", family: "asset", message: response.status === 410 ? "this photo was for one view, and it was viewed" : "no asset is served under that id to this viewer" } };
    }
    const blob = await response.blob();
    release = ownBlob(blob);
    const retained = await viewed?.(blob, response);
    if (retained) return retained;
    const type = response.headers.get("content-type") ?? blob.type, bytes = blob.size;
    let url: string;
    try { url = URL.createObjectURL(blob); } catch {
      // @ref LLP 3000.011.005.000#8 — a host without working object URLs uses a transient copy, never a file
      let dataURL = await blobDataURL(blob, type, bytes);
      return { get url() { return dataURL; }, type, bytes, revoke: () => { dataURL = ""; } };
    }
    const releaseHandle = release;
    release = undefined;
    let revoked = false;
    return { url, type, bytes, revoke: () => {
      if (revoked) return;
      revoked = true;
      try { URL.revokeObjectURL(url); } finally { releaseHandle(); }
    } };
  } catch {
    return { denied: offline() };
  } finally {
    release?.();
  }
}
