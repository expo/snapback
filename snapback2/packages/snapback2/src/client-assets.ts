// @ref LLP 1012#9-asset-bytes-on-the-device — the byte cache is read before the
// network and filled after it; a viewed view-once row is refused before any byte moves.
import { AssetInputError } from "./assets.js";
import { SnapbackRefusal } from "./client-wire.js";
import { ASSET_ID, type AssetCache, type AssetBytes, type ByteCache } from "./store/byte-cache.js";
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
 * The one viewed guard every byte path consults after the cache missed and before
 * a URL is minted or a byte moves: the ids whose view-once row was already viewed
 * on this partition. `assetBlob` refuses them; `useAssetUrl` mints no URL for them.
 */
export async function viewedAssetIds(cache: AssetCache | undefined, ids: readonly string[]): Promise<Set<string>> {
  const viewed = new Set<string>();
  if (!cache) return viewed;
  await Promise.all(ids.map(async (id) => {
    if (ASSET_ID.test(id) && await cache.viewed(id)) viewed.add(id);
  }));
  return viewed;
}

/**
 * Cache-first bytes for one asset rendition. Without a byte cache this is the
 * network fetch; with one, a held rendition (or what this instance showed for a
 * view-once row) is answered without the network, a viewed view-once row is refused
 * before any byte moves, and a fetched rendition is kept under its row's lease.
 */
export async function cachedAssetBlob(
  cache: ByteCache | undefined,
  target: AssetBlobTarget,
  network: () => Promise<Blob>,
  record: (refusal: RefusalEnvelope) => void, current: () => void, viewing?: object,
): Promise<Blob> {
  const value = await cachedAssetBytes(cache, target, async () => {
    const blob = await network();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
  }, record, current, viewing);
  return new Blob([value.bytes as BlobPart], { type: value.type });
}

/** Native byte ingress; the caller fences custody after each awaited read. */
export async function cachedAssetBytes(
  cache: ByteCache | undefined, target: AssetBlobTarget, network: () => Promise<AssetBytes>,
  record: (refusal: RefusalEnvelope) => void, current: () => void, viewing?: object,
): Promise<AssetBytes> {
  if (!cache || target.assetId === "") return network();
  const held = await cache.getBytes(target.assetId, target.width, viewing);
  current();
  if (held) return held;
  const viewed = await cache.viewed(target.assetId);
  current();
  if (viewed) {
    const refusal = viewedRefusal(target.assetId);
    record(refusal.envelope);
    throw refusal;
  }
  const initiallyOnce = await cache.viewOnce(target.assetId);
  if (initiallyOnce && !viewing) {
    const refusal = new SnapbackRefusal({ code: "E_ASSET_TYPE", family: "input", site: "assetBlob",
      message: "view-once bytes require a mounted viewing instance",
      rewrite: "pass the same viewing token for the lifetime of the mounted consumer", guide: "assets/client" });
    record(refusal.envelope);
    throw refusal;
  }
  // Revocation during the fetch must also suppress an initially view-once row.
  const leased = initiallyOnce || await cache.canServe(target.assetId);
  current();
  const value = await network();
  current();
  const admitted = await cache.putBytes(target.assetId, target.width, value, viewing);
  current();
  const once = await cache.viewOnce(target.assetId);
  const viewedNow = await cache.viewed(target.assetId);
  const allowed = await cache.canServe(target.assetId, viewing);
  current();
  if ((once && admitted !== "viewed" && admitted !== "cached") || ((leased || once || viewedNow || admitted === "viewed") && !allowed)) {
    if (viewedNow && !allowed) {
      const refusal = viewedRefusal(target.assetId);
      record(refusal.envelope);
      throw refusal;
    }
    const refusal = new SnapbackRefusal({ code: "E_OFFLINE_CARRIER", family: "offline",
      site: "assetBytes", message: "asset viewing allowance was not durably admitted or its row lease changed",
      rewrite: "restore the carrier and fetch a currently held, unviewed row", guide: "offline" });
    record(refusal.envelope);
    throw refusal;
  }
  return value;
}
