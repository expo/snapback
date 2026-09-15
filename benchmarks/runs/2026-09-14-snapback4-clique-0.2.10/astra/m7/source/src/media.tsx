import React from "react";
import { Image } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
export function Video({
  uri,
  testID = "sm-media-viewer-video",
}: {
  uri: string;
  testID?: string;
}) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return (
    <VideoView
      testID={testID}
      player={player}
      style={{ width: "100%", height: 300 }}
      nativeControls
    />
  );
}
export const poster = Image.resolveAssetSource(
  require("../public/video-poster.png"),
).uri;
