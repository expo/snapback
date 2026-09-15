import { Redirect, useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "snapback4/react";
import { api } from "../src/api.generated";

export default function Me(): React.JSX.Element {
  const me = useQuery(api.me, {});
  const router = useRouter();
  const handle = me && !("loading" in me) && !("denied" in me) ? me.data?.handle : null;
  if (handle) return <Redirect href={`/profile/${handle}`} />;
  return (
    <View style={{ flex: 1, padding: 24 }}>
      <Text>Loading profile…</Text>
      <Pressable onPress={() => router.push("/feed")}><Text>Feed</Text></Pressable>
    </View>
  );
}
