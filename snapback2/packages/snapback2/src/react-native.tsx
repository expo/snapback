import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, PixelRatio, View, type ImageProps, type ImageStyle, type LayoutChangeEvent, type StyleProp } from "react-native";
import { VideoView, useVideoPlayer, type VideoViewProps } from "expo-video";
import { SnapbackRefusal, isSnapbackRefusal } from "./client.js";
import { useAssetUrl, useSnapbackClient, useSnapbackSnapshot } from "./react.js";
import type { ImageAsset, VideoAsset } from "./types.js";

export * from "./react.js";

export type AssetImageProps = Omit<ImageProps, "source"> & {
  asset: ImageAsset;
  width?: number;
  height?: number;
  onRefusal?: (refusal: SnapbackRefusal) => void;
};

// @ref LLP 1006#10-clients — React Native images send the persona/bearer in
// their native source headers; image URLs never carry the session carrier.
export function AssetImage({ asset, width, height, style, onLayout, onRefusal, ...props }: AssetImageProps): React.ReactElement {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const onRefusalRef = useRef(onRefusal);
  onRefusalRef.current = onRefusal;
  const [requestedWidth, setRequestedWidth] = useState<number>();
  const url = useAssetUrl(requestedWidth === undefined ? null : asset, { width: requestedWidth });
  const headerIdentity = useMemo(
    () => ({ client, authGeneration: snapshot.authGeneration }),
    [client, snapshot.authGeneration],
  );
  const [headers, setHeaders] = useState<
    | { identity: typeof headerIdentity; state: "loading" }
    | { identity: typeof headerIdentity; state: "ready"; value: Record<string, string> }
    | { identity: typeof headerIdentity; state: "refused"; refusal: SnapbackRefusal }
  >({ identity: headerIdentity, state: "loading" });
  const currentHeaders = headers.identity === headerIdentity ? headers : undefined;
  useEffect(() => {
    let active = true;
    setHeaders({ identity: headerIdentity, state: "loading" });
    void client.assetHeaders().then((next) => {
      if (active) setHeaders({ identity: headerIdentity, state: "ready", value: next });
    }).catch((error: unknown) => {
      if (!active) return;
      const refusal = isSnapbackRefusal(error) ? error : new SnapbackRefusal({
        code: "E_ASSET_HEADERS",
        family: "auth",
        message: error instanceof Error ? error.message : String(error),
        guide: "assets/client",
      });
      setHeaders({ identity: headerIdentity, state: "refused", refusal });
      onRefusalRef.current?.(refusal);
    });
    return () => { active = false; };
  }, [client, headerIdentity]);
  const layout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width || width || asset.width;
    setRequestedWidth(Math.max(1, Math.ceil(measured * PixelRatio.get())));
    onLayout?.(event);
  };
  const recordStyle: StyleProp<ImageStyle> = useMemo(() => ({
    width: width ?? asset.width,
    height: height ?? (width === undefined ? asset.height : undefined),
    aspectRatio: asset.width / asset.height,
  }), [asset.width, asset.height, width, height]);
  return <Image
    {...props}
    onLayout={layout}
    source={url && currentHeaders?.state === "ready" ? { uri: url, headers: currentHeaders.value } : undefined}
    style={[recordStyle, style]}
  />;
}

export type AssetVideoProps = Omit<VideoViewProps, "player"> & {
  asset: VideoAsset;
  width?: number;
  height?: number;
};

type ResolvedAssetVideoProps = Omit<AssetVideoProps, "asset" | "width" | "height"> & {
  url: string;
  style: unknown;
};

function ResolvedAssetVideo({ url, style, nativeControls, ...props }: ResolvedAssetVideoProps): React.ReactElement {
  const player = useVideoPlayer(url);
  return <VideoView
    {...props}
    nativeControls={nativeControls ?? true}
    player={player}
    style={style}
  />;
}

// @ref LLP 1006#2b-the-session-carrier-author-ruling-2026-09-03 — Expo's
// player receives one carrier URL at mount and never has its source rotated.
export function AssetVideo({ asset, width, height, style, nativeControls, ...props }: AssetVideoProps): React.ReactElement {
  const url = useAssetUrl(asset, { carrier: true });
  const recordStyle = useMemo(() => ({
    width: width ?? asset.width,
    height: height ?? (width === undefined ? asset.height : undefined),
    aspectRatio: asset.width / asset.height,
  }), [asset.width, asset.height, width, height]);
  const combinedStyle = [recordStyle, style];
  return url
    ? <ResolvedAssetVideo {...props} url={url} nativeControls={nativeControls} style={combinedStyle} />
    : <View testID={props.testID} style={combinedStyle} />;
}
