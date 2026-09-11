import React, { useCallback } from "react";
import type { AssetRecord, Refusal } from "snapback2/client";
import { AssetImage, AssetVideo } from "snapback2/react-native";

export interface Media {
  asset: AssetRecord; nonce: number; once: boolean; hidden?: boolean;
  loaded: boolean; uri?: string; loadedUri?: string; resolve(value: unknown): void;
}
/** The witness observes the source actually passed to the native renderer. */
export function MediaView({ media }: { media: Media }) {
  const source = useCallback((uri: string | undefined, settled: boolean) => {
    media.uri = uri;
    if (media.hidden && settled) media.resolve({ loaded: media.loaded, uri });
  }, [media]);
  const loaded = useCallback((loadedUri?: string) => {
    media.loadedUri = loadedUri;
    const uri = media.uri;
    // Android may report a native load while React is replacing the empty source.
    if (!uri) return;
    const comparable = (value: string) => value.startsWith("file:")
      ? decodeURIComponent(value).replace(/^file:\/+/, "/") : value;
    if (loadedUri && comparable(loadedUri) !== comparable(uri)) return; // a late event from the prior memory source
    media.loaded = true;
    if (media.once ? uri.startsWith("data:") : uri.startsWith("file://"))
      media.resolve({ loaded: true, uri, ...( "duration" in media.asset ? { playing: true } : {}) });
  }, [media]);
  const refusal = useCallback((refusal: Refusal) => media.resolve({ loaded: false, refusal }), [media]);
  return "duration" in media.asset
    ? <AssetVideo asset={media.asset} width={64} autoPlay={!media.hidden} testID="witness-media"
        onSourceChange={source} onPlaybackStart={loaded} onRefusal={refusal} />
    : <AssetImage asset={media.asset} width={64} testID="witness-media"
        onSourceChange={source} onLoad={(event) => loaded(event?.nativeEvent?.source?.uri)}
        onError={(event) => media.resolve({ loaded: false, uri: media.uri,
          nativeError: event.nativeEvent.error })} onRefusal={refusal} />;
}
