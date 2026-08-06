import React from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import ChatApp from "./src/ChatApp";

const convexUrl =
  process.env.EXPO_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3212";

const convex = new ConvexReactClient(convexUrl, {
  // Local anonymous dev deployment runs over plain http.
  skipConvexDeploymentUrlCheck: true,
});

export default function App() {
  return (
    <ConvexProvider client={convex}>
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <ChatApp />
      </SafeAreaView>
    </ConvexProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#075E54" },
});
