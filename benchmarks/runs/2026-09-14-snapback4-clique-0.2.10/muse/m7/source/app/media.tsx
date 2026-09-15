import React, { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useClient } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { captureVideoPoster, useDirectAssetUrl } from "../lib/helpers";

/** Media viewer: fetches the asset under the viewer's credentials, so a
 * revoked/expired/viewed asset renders the denial (sm-convo-error). For a
 * view-once open (`once=1&mid=...`), the bytes are fetched first (still
 * allowed pre-view) and the view is recorded once they land; a refused
 * record (already viewed elsewhere) drops the image and shows the refusal.
 * A direct open of an already-viewed asset is refused at fetch time. */
export default function MediaViewer() {
  const { asset, kind, once, mid } = useLocalSearchParams<{ asset?: string; kind?: string; once?: string; mid?: string }>();
  const router = useRouter();
  const client: any = useClient();
  const state = useDirectAssetUrl(asset);
  const [poster, setPoster] = useState<string | undefined>(undefined);
  const [onceRefused, setOnceRefused] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (state.status === "ready" && kind === "video") {
      captureVideoPoster(state.url).then((p) => {
        if (live) setPoster(p ?? undefined);
      });
    }
    if (state.status === "ready" && once === "1" && mid && !onceRefused) {
      client.mutate(api.openViewOnce, { messageId: mid }).then((w: any) => {
        if (live && w.state === "failed") setOnceRefused(w.why?.code ?? "denied");
      }).catch((e: any) => {
        if (live) setOnceRefused(String(e?.message ?? e).slice(0, 80));
      });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, kind, once, mid]);
  const deniedWhy = onceRefused ?? (state.status === "denied" ? ((state.why as any)?.code ?? "denied") : null);
  const showMedia = state.status === "ready" && !onceRefused;
  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 16 }}>
      {showMedia && kind !== "video"
        ? React.createElement("img", {
            src: state.url,
            style: { maxWidth: "100%", maxHeight: "80vh" },
            "data-testid": "sm-media-viewer-image",
            testID: "sm-media-viewer-image",
          } as any)
        : null}
      {showMedia && kind === "video" && Platform.OS === "web"
        ? React.createElement("video", {
            src: state.url,
            poster,
            controls: true,
            autoPlay: true,
            style: { maxWidth: "100%", maxHeight: "80vh" },
            "data-testid": "sm-media-viewer-video",
            testID: "sm-media-viewer-video",
          } as any)
        : null}
      {deniedWhy ? (
        <Text testID="sm-convo-error" style={{ color: "#fff" }}>
          {onceRefused ? `View-once refused: ${onceRefused}` : `Media unavailable: ${deniedWhy}`}
        </Text>
      ) : null}
      {state.status === "loading" ? <Text style={{ color: "#fff" }}>Loading…</Text> : null}
      <Pressable onPress={() => router.back()} style={{ marginTop: 16, padding: 12 }} testID="sm-media-viewer-close">
        <Text style={{ color: "#fff", fontWeight: "600" }}>Close</Text>
      </Pressable>
    </View>
  );
}
