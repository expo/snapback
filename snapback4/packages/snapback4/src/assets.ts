// Assets on the client: `upload` posts the bytes and returns the facts the
// server established; `asset` fetches the bytes under the viewer's own
// credentials and hands back a blob URL, so a screen never puts a token in
// an <img src> and a one-view photo is never durably cached anywhere
// (LLP 1006 carried into Snapback 4).

import type { Asset, AssetRead, Refusal, Uploaded } from "./contract.ts";

export type Bytes = Blob | ArrayBuffer | Uint8Array;

const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });

export async function uploadAsset(base: string, headers: Record<string, string>, doFetch: typeof fetch, bytes: Bytes): Promise<Uploaded> {
  const { "content-type": _json, ...auth } = headers;
  const body = bytes instanceof Uint8Array ? new Blob([bytes as BlobPart]) : bytes;
  try {
    const response = await doFetch(`${base}/assets`, { method: "POST", headers: { ...auth, "content-type": "application/octet-stream" }, body });
    const json = (await response.json()) as { asset?: Asset; denied?: Refusal };
    if (json.asset) return { ok: true, asset: json.asset };
    return { ok: false, why: json.denied ?? { code: "E_STORE", family: "store", message: "the server answered without an asset", retryable: true } };
  } catch {
    return { ok: false, why: offline() };
  }
}

/** Where the bytes are and what to send to get them: for hosts whose image
 * and video views take a URI with headers (React Native). */
export function assetSource(base: string, headers: Record<string, string>, id: string): { uri: string; headers: Record<string, string> } {
  const { "content-type": _json, ...auth } = headers;
  return { uri: `${base}/assets/${encodeURIComponent(id)}`, headers: auth };
}

export async function fetchAsset(base: string, headers: Record<string, string>, doFetch: typeof fetch, id: string): Promise<AssetRead> {
  const source = assetSource(base, headers, id);
  try {
    const response = await doFetch(source.uri, { headers: source.headers });
    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as { denied?: Refusal } | null;
      return { denied: json?.denied ?? { code: response.status === 410 ? "E_ASSET_VIEWED" : "E_ASSET_UNKNOWN", family: "asset", message: response.status === 410 ? "this photo was for one view, and it was viewed" : "no asset is served under that id to this viewer" } };
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    return { url, type: response.headers.get("content-type") ?? blob.type, bytes: blob.size, revoke: () => URL.revokeObjectURL(url) };
  } catch {
    return { denied: offline() };
  }
}
