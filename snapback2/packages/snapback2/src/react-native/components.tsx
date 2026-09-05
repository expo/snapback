import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, PixelRatio, Pressable, Text, View, type ImageProps, type LayoutChangeEvent } from "react-native";
import { VideoView, useVideoPlayer, type VideoViewProps } from "expo-video";
import { useSnapbackClient, useSnapbackSnapshot } from "../react-core.js";
import { SnapbackRefusal } from "../client.js";
import type { ImageAsset, VideoAsset } from "../types.js";
import { MemoryVideo, memoryVideoAvailable } from "./memory-video.js";
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

// @ref LLP 1013#2-decisions — admit on requested play, then feed native decoders from memory.
export function AssetVideo({ asset, width, height, style, onRefusal, onSourceChange, onPlaybackStart, autoPlay = false, ...props }: AssetVideoProps): React.ReactElement {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const identity = useMemo(() => ({ client, id: asset.id, auth: snapshot.authGeneration }), [client, asset.id, snapshot.authGeneration]);
  const [policy, setPolicy] = useState<{ identity: typeof identity; once: boolean; viewed: boolean }>();
  const callback = useRef(onRefusal);
  callback.current = onRefusal;
  useEffect(() => {
    let active = true;
    void (async () => {
      await client.ready;
      const viewed = Boolean(await client.assetCache?.viewed(asset.id));
      const once = viewed || Boolean(await client.assetCache?.viewOnce(asset.id));
      if (active) setPolicy({ identity, once, viewed });
    })().catch((error) => { if (active) callback.current?.(error); });
    return () => { active = false; };
  }, [identity]);
  const once = policy?.identity === identity ? policy.once : undefined;
  const [requested, setRequested] = useState<typeof identity>();
  const [finished, setFinished] = useState<typeof identity>();
  const available = once === true && memoryVideoAvailable();
  const refused = useMemo(() => once && !available ? new SnapbackRefusal({ code: "E_ASSET_TYPE", family: "input", site: "AssetVideo",
    message: "view-once video requires the Snapback native memory player",
    rewrite: "rebuild the Expo development client or app with the installed snapback2 native module", guide: "assets/client" }) : undefined, [once, available]);
  const enabled = once === false || (once === true && available && !policy?.viewed && finished !== identity && (autoPlay || requested === identity));
  const { uri, refusal, settled } = useNativeSource(enabled ? asset : null, { enabled });
  const sourceSettled = settled || (policy?.identity === identity && (policy.viewed || !enabled));
  React.useLayoutEffect(() => { onSourceChange?.(uri, sourceSettled); }, [uri, sourceSettled, onSourceChange]);
  useEffect(() => { if (refused ?? refusal) callback.current?.((refused ?? refusal)!); }, [refused, refusal]);
  const size = [{ width: width ?? asset.width, height: height ?? (width === undefined ? asset.height : undefined), aspectRatio: asset.width / asset.height }, style];
  if (uri && once) return <MemoryVideo key={`${asset.id}:${snapshot.authGeneration}`} source={uri} style={size} testID={props.testID}
    onPlaybackStart={onPlaybackStart ?? (() => {})} onFinished={() => setFinished(identity)}
    onError={({ nativeEvent }) => { setFinished(identity); callback.current?.(new SnapbackRefusal({ code: "E_ASSET_TYPE", family: "input", site: "AssetVideo",
      message: nativeEvent.message, rewrite: "use an MP4 supported by the device decoder", guide: "assets/client" })); }} />;
  if (once && available && !policy?.viewed && !enabled && finished !== identity) return <Pressable testID={props.testID} style={size}
    accessibilityRole="button" accessibilityLabel="Play view-once video" onPress={() => setRequested(identity)}><Text>Play video</Text></Pressable>;
  if (uri) return <Player {...props} asset={asset} uri={uri} onRefusal={onRefusal} play={autoPlay} onPlay={onPlaybackStart ?? (() => {})} style={size} />;
  return <View testID={props.testID} style={size} />;
}
