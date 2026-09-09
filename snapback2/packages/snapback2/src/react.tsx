import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAssetUrl, useSnapbackClient, useSnapbackSnapshot } from "./react-core.js";
import { toRefusal } from "./client-wire.js";
import { viewedRefusal } from "./client-assets.js";
import type { ImageAsset, VideoAsset, Refusal } from "./types.js";
export * from "./react-core.js";
export { indexedDbRangeStore } from "./store/indexeddb.js";

const noSubscription = () => () => {};
const noCustody = () => 0;

/** Each mounted byte consumer owns one allowance and every object URL it creates. */
function useAssetBlob(url: string | undefined) {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const cache = client.assetCache;
  const custody = useSyncExternalStore(cache?.subscribeCustody ?? noSubscription, cache?.getCustody ?? noCustody, noCustody);
  const viewing = useRef({}).current;
  const identity = useMemo(() => ({ client, url, auth: snapshot.authGeneration, custody }), [client, url, snapshot.authGeneration, custody]);
  const [result, setResult] = useState<{ identity: typeof identity; url?: string; refusal?: Refusal }>();
  useEffect(() => {
    if (!url || typeof URL.createObjectURL !== "function") return;
    let active = true;
    let created: string | undefined;
    const controller = new AbortController();
    if (url.startsWith("blob:")) { setResult({ identity, url }); return; }
    void client.assetBlob(url, { signal: controller.signal, viewing }).then((blob) => {
      if (!active || (cache?.getCustody?.() ?? 0) !== custody) return;
      created = URL.createObjectURL(blob);
      setResult({ identity, url: created });
    }).catch((error) => { if (active) setResult({ identity, refusal: toRefusal(error) }); });
    return () => {
      active = false;
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [identity]);
  return result?.identity === identity ? result : undefined;
}

export type AssetImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  asset: ImageAsset;
  width?: number | string;
  height?: number | string;
};

// @ref LLP 1006#8-sizes-ask-for-any-width — the web image measures its box,
// asks for device pixels, and keeps intrinsic record dimensions before bytes arrive.
export function AssetImage({ asset, width, height, style, ...props }: AssetImageProps): React.ReactElement {
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
  const blob = useAssetBlob(deliveryUrl);
  return <img
    {...props}
    ref={setElement}
    src={blob?.url}
    width={width ?? asset.width}
    height={height ?? asset.height}
    style={{ aspectRatio: `${asset.width} / ${asset.height}`, ...style }}
  />;
}

export type AssetVideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src" | "width" | "height"> & {
  asset: VideoAsset;
  onRefusal?: (refusal: Refusal) => void;
  width?: number | string;
  height?: number | string;
};

// @ref LLP 1012#9-asset-bytes-on-the-device — video uses ordinary cached bytes or a session carrier; schema once applies only to images.
export function AssetVideo({ asset, width, height, style, controls, onPlay, onRefusal, ...props }: AssetVideoProps): React.ReactElement {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const cache = client.assetCache;
  const custody = useSyncExternalStore(cache?.subscribeCustody ?? noSubscription, cache?.getCustody ?? noCustody, noCustody);
  const identity = useMemo(() => ({ client, id: asset.id, auth: snapshot.authGeneration, custody }), [client, asset.id, snapshot.authGeneration, custody]);
  const [policy, setPolicy] = useState<{ identity: typeof identity; once: boolean; viewed: boolean }>();
  const [started, setStarted] = useState<typeof identity>();
  const [request, setRequest] = useState<{ identity: typeof identity; url: string }>();
  const callback = useRef(onRefusal);
  callback.current = onRefusal;
  useEffect(() => {
    let active = true;
    void (async () => {
      await client.ready;
      const viewed = await cache?.viewed(asset.id) ?? false;
      const once = viewed || (await cache?.viewOnce(asset.id) ?? false);
      if (active) {
        setPolicy({ identity, once, viewed });
        if (viewed) callback.current?.(toRefusal(viewedRefusal(asset.id)));
      }
    })().catch((error) => { if (active) callback.current?.(toRefusal(error)); });
    return () => { active = false; };
  }, [identity, cache]);
  const current = policy?.identity === identity ? policy : undefined;
  const ordinary = current?.once === false;
  const admitted = current?.once === true && !current.viewed && started === identity;
  const carrier = useAssetUrl(ordinary ? asset : null, { carrier: true });
  // Resolve at the play gesture, so concurrent players cannot retain a carrier.
  useEffect(() => {
    if (!admitted) return;
    let active = true;
    void (async () => {
      if (await cache?.viewed(asset.id)) throw viewedRefusal(asset.id);
      const url = await client.assetUrl(asset);
      if (!url) throw viewedRefusal(asset.id);
      if (active) setRequest({ identity, url });
    })().catch((error) => { if (active) callback.current?.(toRefusal(error)); });
    return () => { active = false; };
  }, [identity, admitted]);
  const tokenless = request?.identity === identity ? request.url : undefined;
  const blob = useAssetBlob(tokenless);
  useEffect(() => { if (blob?.refusal) callback.current?.(blob.refusal); }, [blob?.refusal]);
  const cacheable = cache !== undefined && ordinary && carrier !== undefined && !carrier.startsWith("blob:");
  useEffect(() => {
    if (!cacheable || snapshot.connection === "offline") return;
    const controller = new AbortController();
    void client.assetUrl(asset)
      .then((url) => url === undefined ? undefined : client.assetBlob(url, { signal: controller.signal }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [client, asset.id, cacheable]);
  const video = <video {...props} onPlay={onPlay} controls={controls ?? true}
    autoPlay={admitted || props.autoPlay} src={ordinary ? carrier : admitted ? blob?.url : undefined}
    width={width ?? asset.width} height={height ?? asset.height}
    style={{ aspectRatio: `${asset.width} / ${asset.height}`, ...style }} />;
  return current?.once && !current.viewed && !admitted
    ? <><button type="button" onClick={() => setStarted(identity)}>Play once</button>{video}</>
    : video;
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
