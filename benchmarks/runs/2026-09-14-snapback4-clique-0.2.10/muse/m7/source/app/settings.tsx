import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAppClient } from "../lib/client";
import { useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { readData } from "../lib/helpers";
import { BottomNav } from "./components/FeedItem";

export default function Settings() {
  const router = useRouter();
  const { signOut } = useAppClient();
  const profRead = useQuery(api.myProfile, {});
  const profile = readData<any>(profRead);
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 16 }}>
      <Text testID="sm-settings-account">Signed in as {profile?.handle ?? "…"}</Text>
      {profile?.handle ? (
        <Pressable onPress={() => router.push({ pathname: "/profile/[handle]", params: { handle: profile.handle } })} style={{ paddingVertical: 12 }}>
          <Text style={{ color: "#4F46E5" }}>My profile</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={async () => {
          await signOut();
          router.replace("/feed");
        }}
        style={{ paddingVertical: 12 }}
        testID="sm-settings-logout"
      >
        <Text style={{ color: "#DC2626", fontWeight: "600" }}>Log out</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
      <BottomNav />
    </View>
  );
}
