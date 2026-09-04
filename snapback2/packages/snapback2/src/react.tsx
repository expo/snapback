import React, { useCallback, useEffect, useState } from "react";
import { useAssetUrl, useSnapbackClient, useSnapbackSnapshot } from "./react-core.js";
import type { ImageAsset, VideoAsset } from "./types.js";
export * from "./react-core.js";
export { indexedDbRangeStore } from "./store/indexeddb.js";

export type AssetImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  asset: ImageAsset;
  width?: number | string;
  height?: number | string;
};

// @ref LLP 1006#8-sizes-ask-for-any-width — the web image measures its box,
// asks for device pixels, and keeps intrinsic record dimensions before bytes arrive.
export function AssetImage({ asset, width, height, style, ...props }: AssetImageProps): React.ReactElement {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const [element, setElement] = useState<HTMLImageElement | null>(null);
  const [requestedWidth, setRequestedWidth] = useState<number>();
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    if (!element) return;
    const update = (layoutWidth: number) => {
      const fallback = typeof width === "number" ? width : asset.width;
      const cssWidth = layoutWidth > 0 ? layoutWidth : fallback;
      const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      setRequestedWidth(Math.max(1, Math.ceil(cssWidth * ratio)));
      setMeasured(true);
    };
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => update(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, width, asset.id, asset.width]);
  const deliveryUrl = useAssetUrl(measured ? asset : null, { width: requestedWidth });
  const [blobUrl, setBlobUrl] = useState<string>();
  useEffect(() => {
    // No delivery URL (a viewed view-once row, or an identity change in flight) shows nothing:
    // never a src that useAssetUrl already revoked.
    if (!deliveryUrl || typeof URL.createObjectURL !== "function") {
      setBlobUrl(undefined);
      return;
    }
    // A blob: URL is a held rendition from the byte cache; useAssetUrl owns its lifetime.
    if (deliveryUrl.startsWith("blob:")) {
      setBlobUrl(deliveryUrl);
      return;
    }
    let active = true;
    let created: string | undefined;
    const controller = new AbortController();
    setBlobUrl(undefined);
    void client.assetBlob(deliveryUrl, { signal: controller.signal }).then((blob) => {
      created = URL.createObjectURL(blob);
      if (active) setBlobUrl(created);
      else URL.revokeObjectURL(created);
    }).catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [client, deliveryUrl, snapshot.authGeneration]);
  return <img
    {...props}
    ref={setElement}
    src={blobUrl}
    width={width ?? asset.width}
    height={height ?? asset.height}
    style={{ aspectRatio: `${asset.width} / ${asset.height}`, ...style }}
  />;
}

export type AssetVideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src" | "width" | "height"> & {
  asset: VideoAsset;
  width?: number | string;
  height?: number | string;
};

// @ref LLP 1006#10-clients — video streams directly with a carrier because a
// native player/video element cannot send the session header or wait for a blob.
export function AssetVideo({ asset, width, height, style, controls, onPlay, ...props }: AssetVideoProps): React.ReactElement {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const url = useAssetUrl(asset, { carrier: true });
  const cache = client.assetCache;
  // @ref LLP 1012#9-asset-bytes-on-the-device — a view-once clip is never prefetched
  // and counts as viewed when playback starts, never on mount; `once` is unknown
  // until the store answers, and unknown fails closed (no prefetch, play marks).
  const [once, setOnce] = useState<boolean>();
  useEffect(() => {
    if (!cache) {
      setOnce(false);
      return;
    }
    let active = true;
    setOnce(undefined);
    void client.ready
      .then(() => cache.viewOnce(asset.id))
      .then((value) => { if (active) setOnce(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [client, cache, asset.id]);
  const cacheable = cache !== undefined && once === false && url !== undefined && !url.startsWith("blob:");
  // The player streams from the carrier now; one tokenless fetch fills the byte
  // cache so the next mount plays offline.
  useEffect(() => {
    if (!cacheable || snapshot.connection === "offline") return;
    const controller = new AbortController();
    void client.assetUrl(asset)
      .then((tokenless) => tokenless === undefined ? undefined : client.assetBlob(tokenless, { signal: controller.signal }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [client, asset.id, cacheable]);
  const handlePlay = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    onPlay?.(event);
    if (cache && once !== false) void cache.markViewed(asset.id).catch(() => undefined);
  }, [onPlay, cache, once, asset.id]);
  return <video
    {...props}
    onPlay={handlePlay}
    controls={controls ?? true}
    src={url}
    width={width ?? asset.width}
    height={height ?? asset.height}
    style={{ aspectRatio: `${asset.width} / ${asset.height}`, ...style }}
  />;
}

export function DevOverlay(): React.ReactElement {
  const snapshot = useSnapbackSnapshot();
  const refusal = snapshot.lastRefusal;
  return (
    <aside aria-label="Snapback development status">
      <strong>Snapback</strong>
      <dl>
        <dt>Persona</dt><dd>{snapshot.persona ?? "token"}</dd>
        <dt>Connection</dt><dd>{snapshot.connection}</dd>
        <dt>Generation</dt><dd>{snapshot.generation ?? "—"}</dd>
        <dt>Last refusal</dt><dd>{refusal ? `${refusal.code}: ${refusal.message}` : "—"}</dd>
      </dl>
    </aside>
  );
}
