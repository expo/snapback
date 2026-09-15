import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PostComposer } from "./components/PostComposer";

export default function Compose() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 12 }}>
      <PostComposer onPosted={() => router.back()} />
    </View>
  );
}
