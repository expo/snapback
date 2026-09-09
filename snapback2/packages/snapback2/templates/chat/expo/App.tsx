import React, { lazy, Suspense } from "react";
import { SnapbackProvider } from "snapback2/react-native";
import { Text } from "react-native";
import Constants from "expo-constants";
import { Chat } from "./src/Chat";
const chatOffline = {};

const url = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? Constants.expoConfig?.extra?.snapbackUrl ?? "http://127.0.0.1:3210";
// Metro inlines this in app source, never at simctl launch or inside node_modules.
const witnessUrl = process.env.EXPO_PUBLIC_SNAPBACK_WITNESS;

const Witness = witnessUrl ? lazy(() => import("./src/Witness")) : undefined;

export function NormalApp() {
  return <SnapbackProvider url={url} persona="alice" offline={chatOffline}><Chat /></SnapbackProvider>;
}

export default function App() {
  return witnessUrl && Witness ? <Suspense fallback={<Text>Loading witness…</Text>}><Witness url={url} controlUrl={witnessUrl} /></Suspense> : <NormalApp />;
}
