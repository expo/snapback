const React = globalThis.__snapbackNative.React;

export function useVideoPlayer(source) {
  globalThis.__snapbackNative.videoSources.push(source);
  return { source };
}

export const VideoView = (props) => React.createElement("NativeVideo", props);
