// Assets on the client: `upload` posts the bytes and returns the facts the
// server established; `asset` fetches the bytes under the viewer's own
// credentials and hands back a display URL, so a screen never puts a token in
// an <img src> and a one-view photo is never durably cached anywhere
// (LLP 1006 carried into Snapback 4).

import { downloadAsset, assetQueue } from "./asset-download.ts";
import type { Asset, AssetRead, Refusal, Uploaded } from "./contract.ts";

export type Bytes = Blob | ArrayBuffer | Uint8Array;

import { refusal, invalidResponse, transportRefusal as offline, retryAfter, jitter } from "./http-response.ts";

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
  // Caller-owned buffers may change during admission backoff. Every attempt
  // sends the same selected byte range, including inputs from another realm.
  // Native Blob rejects buffer parts; its fetch accepts an owned buffer view.
  // Blob inputs are already immutable and stay owned by the caller.
  const body = ArrayBuffer.isView(bytes)
    ? new Uint8Array(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    : Object.prototype.toString.call(bytes) === "[object ArrayBuffer]"
      ? new Uint8Array(new Uint8Array(bytes as ArrayBuffer)) : bytes as Blob;
  try {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const response = await doFetch(`${base}/assets`, { method: "POST", headers: { ...auth, "content-type": "application/octet-stream" }, body });
      let json: { asset?: Asset; denied?: Refusal } | null;
      try { json = await response.json(); }
      catch { return { ok: false, why: invalidResponse(response.status, "upload") }; }
      if (response.ok && json?.asset) return { ok: true, asset: json.asset };
      const why = refusal(json?.denied) ?? invalidResponse(response.status, "upload");
      // Only an explicit admission refusal proves these bytes were not stored.
      // A transport failure or another retryable code may follow acceptance.
      if (why.code !== "E_RATE_LIMIT" || why.retryable !== true || attempt === 3 || !canRetry()) return { ok: false, why };
      const delay = jitter(Math.max(250 * 2 ** attempt, retryAfter(response.headers.get("retry-after"))));
      // Never retry earlier than the server permits. A long Retry-After ends
      // this bounded call instead of parking an upload indefinitely.
      if (waited + delay > 10_000) return { ok: false, why };
      await new Promise(resolve => setTimeout(resolve, delay));
      waited += delay;
      if (!canRetry()) return { ok: false, why };
    }
  } catch (error) {
    return { ok: false, why: offline(error) };
  }
}

/** Where the bytes are and what to send to get them: for hosts whose image
 * and video views take a URI with headers (React Native). */
export function assetSource(base: string, headers: Record<string, string>, id: string): { uri: string; headers: Record<string, string> } {
  const { "content-type": _json, ...auth } = headers;
  return { uri: `${base}/assets/${encodeURIComponent(id)}`, headers: auth };
}

export async function fetchAsset(base: string, headers: Record<string, string>, doFetch: typeof fetch, id: string, viewed?: (blob: Blob, response: Response) => Promise<AssetRead | void>, signal?: AbortSignal, current?: () => boolean, queue?: ReturnType<typeof assetQueue>, consumed?: () => void): Promise<AssetRead> {
  let release: (() => void) | undefined;
  let retryable = false;
  try {
    const downloaded = await downloadAsset(assetSource(base, headers, id), doFetch, signal, current, queue);
    if ("denied" in downloaded) { if (downloaded.denied.code === "E_ASSET_VIEWED") consumed?.(); return downloaded; }
    retryable = downloaded.retryable;
    const { blob, response } = downloaded;
    if (response.headers.get("accept-ranges") === "none" || !downloaded.retryable) consumed?.();
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
  } catch (error) {
    return { denied: { code: "E_CLIENT", family: "client", message: `the downloaded asset could not be retained or displayed: ${error instanceof Error ? error.message : String(error)}`, retryable } };
  } finally {
    release?.();
  }
}
