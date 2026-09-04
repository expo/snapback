// @ref LLP 1012#9-asset-bytes-on-the-device — the byte cache is read before the
// network and filled after it; a viewed view-once row is refused before any byte moves.
import { AssetInputError } from "./assets.js";
import { SnapbackRefusal } from "./client-wire.js";
import { ASSET_ID, type ByteCache } from "./store/byte-cache.js";
import type { RefusalEnvelope } from "./types.js";

export interface AssetBlobTarget { url: string; assetId: string; width: number | null }

/** The tokenless asset URL this client issued, split into the cache key it names. */
export function assetBlobTarget(baseUrl: string, url: string): AssetBlobTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AssetInputError("E_ASSET_TYPE", "asset blob URL must be absolute");
  }
  const base = new URL(baseUrl);
  if (parsed.origin !== base.origin || !parsed.pathname.startsWith("/api/asset/") || parsed.searchParams.has("s")) {
    throw new AssetInputError("E_ASSET_TYPE", "asset blob fetch requires a tokenless URL issued by this client");
  }
  const assetId = decodeURIComponent(parsed.pathname.slice("/api/asset/".length));
  const raw = parsed.searchParams.get("w");
  let width: number | null = null;
  if (raw !== null) {
    width = Number(raw);
    if (!Number.isSafeInteger(width) || width <= 0) throw new AssetInputError("E_ASSET_TYPE", "asset width must be a positive integer");
  }
  return { url, assetId: ASSET_ID.test(assetId) ? assetId : "", width };
}

export function viewedRefusal(assetId: string): SnapbackRefusal {
  return new SnapbackRefusal({
    code: "E_ASSET_VIEWED",
    family: "offline",
    message: `asset ${assetId} belongs to a view-once row that was already viewed on this device`,
    site: "assetBlob",
    rewrite: "render a view-once row once; do not fetch its bytes again",
    guide: "offline",
  });
}

/**
 * Cache-first bytes for one asset rendition. Without a byte cache this is the
 * network fetch; with one, a viewed view-once row is refused, a held rendition is
 * answered without the network, and a fetched rendition is kept under its row's lease.
 */
export async function cachedAssetBlob(
  cache: ByteCache | undefined,
  target: AssetBlobTarget,
  network: () => Promise<Blob>,
  record: (refusal: RefusalEnvelope) => void,
): Promise<Blob> {
  if (!cache || target.assetId === "") return network();
  if (await cache.viewed(target.assetId)) {
    const refusal = viewedRefusal(target.assetId);
    record(refusal.envelope);
    throw refusal;
  }
  const held = await cache.get(target.assetId, target.width);
  if (held) return held;
  const blob = await network();
  await cache.put(target.assetId, target.width, blob);
  return blob;
}
