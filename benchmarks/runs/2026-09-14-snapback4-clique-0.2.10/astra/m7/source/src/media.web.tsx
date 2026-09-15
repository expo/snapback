import React from "react";
export function Video({
  uri,
  testID = "sm-media-viewer-video",
}: {
  uri: string;
  testID?: string;
}) {
  return (
    <video
      data-testid={testID}
      src={uri}
      controls
      autoPlay
      playsInline
      style={{ width: "100%", maxHeight: 400 }}
    />
  );
}
export const poster = "/video-poster.png";
