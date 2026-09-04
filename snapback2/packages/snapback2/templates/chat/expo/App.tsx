import React, { lazy, Suspense, useEffect, useState } from "react";
import { createExpoClient, SnapbackProvider } from "snapback2/expo";
import type { SnapbackClient } from "snapback2/client";
import { Text } from "react-native";
import { Chat } from "./src/Chat";
import { chatOffline } from "./shared/offline.js";

const url = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:3210";
// Metro inlines this in app source, never at simctl launch or inside node_modules.
const witnessUrl = process.env.EXPO_PUBLIC_SNAPBACK_WITNESS;

const Witness = witnessUrl ? lazy(() => import("./src/Witness")) : undefined;

function NormalApp() {
  const [client, setClient] = useState<SnapbackClient>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const client = createExpoClient({ url, as: "alice", offline: chatOffline });
    setClient(client);
    void client.ready.catch((error) => setError(String(error)));
    return () => { void client.close(); };
  }, []);
  if (!client) return <Text accessibilityLiveRegion="polite">{error ?? "Connecting…"}</Text>;
  return <SnapbackProvider client={client}><Chat /></SnapbackProvider>;
}

export default function App() {
  return witnessUrl && Witness ? <Suspense fallback={<Text>Loading witness…</Text>}><Witness url={url} controlUrl={witnessUrl} /></Suspense> : <NormalApp />;
}
