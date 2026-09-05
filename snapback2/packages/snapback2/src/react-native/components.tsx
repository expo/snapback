import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, PixelRatio, Pressable, Text, View, type ImageProps, type LayoutChangeEvent } from "react-native";
import { VideoView, useVideoPlayer, type VideoViewProps } from "expo-video";
import { useSnapbackClient, useSnapbackSnapshot } from "../react-core.js";
import { SnapbackRefusal } from "../client.js";
import type { ImageAsset, VideoAsset } from "../types.js";
import { useNativeSource } from "./source.js";

export type AssetImageProps = Omit<ImageProps, "source"> & {
  asset: ImageAsset; width?: number; height?: number;
  onRefusal?: (refusal: SnapbackRefusal) => void;
  onSourceChange?: (uri: string | undefined, settled: boolean) => void;
};
export function AssetImage({ asset, width, height, style, onLayout, onRefusal, onSourceChange, ...props }: AssetImageProps): React.ReactElement {
  const [measured, setMeasured] = useState<number>();
  const requested = Math.max(1, Math.ceil((measured ?? width ?? asset.width) * PixelRatio.get()));
  const { uri, refusal, settled } = useNativeSource(asset, { width: requested });
  const callback = useRef(onRefusal);
  callback.current = onRefusal;
  React.useLayoutEffect(() => { onSourceChange?.(uri, settled); }, [uri, settled, onSourceChange]);
  useEffect(() => { if (refusal) callback.current?.(refusal); }, [refusal]);
  const layout = (event: LayoutChangeEvent) => {
    if (event.nativeEvent.layout.width > 0) setMeasured(event.nativeEvent.layout.width);
    onLayout?.(event);
  };
  return <Image {...props} onLayout={layout} source={uri ? { uri } : undefined}
    style={[{ width: width ?? asset.width, height: height ?? (width === undefined ? asset.height : undefined), aspectRatio: asset.width / asset.height }, style]} />;
}

export type AssetVideoProps = Omit<VideoViewProps, "player"> & {
  autoPlay?: boolean;
  onPlaybackStart?: () => void;
  asset: VideoAsset; width?: number; height?: number;
  onRefusal?: (refusal: SnapbackRefusal) => void;
  onSourceChange?: (uri: string | undefined, settled: boolean) => void;
};
function Player({ uri, asset: _asset, play, onPlay, onRefusal, onSourceChange: _onSourceChange, autoPlay: _autoPlay, onPlaybackStart: _onPlaybackStart, ...props }: AssetVideoProps & { uri: string; play: boolean; onPlay(): void }) {
  const player = useVideoPlayer(uri);
  useEffect(() => {
    const errors = player.addListener("statusChange", ({ status, error }) => {
      if (status === "error") onRefusal?.(new SnapbackRefusal({ code: "E_ASSET_TYPE", family: "input",
        site: "AssetVideo", message: error?.message ?? "native video decoder refused the source",
        rewrite: "use a video source supported by the native player", guide: "assets/client" }));
    });
    const subscription = player.addListener("playingChange", ({ isPlaying }) => {
      if (isPlaying) onPlay();
    });
    if (play) player.play();
    return () => { subscription.remove(); errors.remove(); };
  }, [player, onPlay, play]);
  return <VideoView {...props} player={player} nativeControls={props.nativeControls ?? true} />;
}

// @ref LLP 1013#2-decisions — view-once clips are fetched only at the user's
// play gesture; their viewing source stays in memory and ordinary clips use files.
export function AssetVideo({ asset, width, height, style, onRefusal, onSourceChange, onPlaybackStart, autoPlay = false, ...props }: AssetVideoProps): React.ReactElement {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const identity = useMemo(() => ({ client, id: asset.id, auth: snapshot.authGeneration }), [client, asset.id, snapshot.authGeneration]);
  const [policy, setPolicy] = useState<{ identity: typeof identity; once: boolean }>();
  const [started, setStarted] = useState<typeof identity>();
  const marked = useRef<typeof identity | undefined>(undefined);
  const onPlay = React.useCallback(() => {
    onPlaybackStart?.();
    if (marked.current === identity) return;
    marked.current = identity;
    void client.assetCache?.markViewed(asset.id).catch((error) => onRefusal?.(error));
  }, [identity, onRefusal, onPlaybackStart]);
  useEffect(() => {
    let active = true;
    void (async () => {
      await client.ready;
      const once = await client.assetCache?.viewOnce(asset.id) ?? false;
      if (active) setPolicy({ identity, once });
    })().catch((error) => { if (active) callback.current?.(error); });
    return () => { active = false; };
  }, [identity]);
  const once = policy?.identity === identity ? policy.once : undefined;
  const playing = autoPlay || started === identity;
  const { uri, refusal, settled } = useNativeSource(asset, { enabled: once !== undefined && (!once || playing) });
  const callback = useRef(onRefusal);
  callback.current = onRefusal;
  React.useLayoutEffect(() => { onSourceChange?.(uri, settled); }, [uri, settled, onSourceChange]);
  useEffect(() => { if (refusal) callback.current?.(refusal); }, [refusal]);
  const size = [{ width: width ?? asset.width, height: height ?? (width === undefined ? asset.height : undefined), aspectRatio: asset.width / asset.height }, style];
  if (uri) return <Player {...props} asset={asset} uri={uri} onRefusal={onRefusal} play={playing} onPlay={onPlay} style={size} />;
  if (once && !playing) return <Pressable testID={props.testID} accessibilityLabel="Play view-once video" onPress={() => setStarted(identity)} style={size}><Text>Play once</Text></Pressable>;
  return <View testID={props.testID} style={size} />;
}
