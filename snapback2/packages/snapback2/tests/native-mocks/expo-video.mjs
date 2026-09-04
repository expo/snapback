const React = globalThis.__snapbackNative.React;
export function useVideoPlayer(source) {
  globalThis.__snapbackNative.videoSources.push(source);
  return React.useMemo(() => {
    const listeners = new Set();
    return { source, addListener(_name, callback) { listeners.add(callback); return { remove() { listeners.delete(callback); } }; },
      play() { for (const listener of listeners) listener({ isPlaying: true }); } };
  }, [source]);
}
export const VideoView = (props) => React.createElement("NativeVideo", props);
