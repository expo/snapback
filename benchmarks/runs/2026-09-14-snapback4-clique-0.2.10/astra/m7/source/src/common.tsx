import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { router, usePathname } from "expo-router";
import { FeedTabs } from "../ui";
export function Button({
  children,
  onPress,
  testID,
}: {
  children: React.ReactNode;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{ padding: 12, borderRadius: 12, backgroundColor: "#eef0ff" }}
    >
      <Text style={{ color: "#4f46e5", fontWeight: "600" }}>{children}</Text>
    </Pressable>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View
        style={{ width: "100%", maxWidth: 780, alignSelf: "center", flex: 1 }}
      >
        <View
          style={{
            flexDirection: "row",
            padding: 12,
            gap: 10,
            borderBottomWidth: 1,
            borderColor: "#eee",
          }}
        >
          <Button onPress={() => router.push("/")}>Clique</Button>
          <Button onPress={() => router.push("/chats")}>Chats</Button>
          <Button onPress={() => router.push("/search")}>Search</Button>
          <Button onPress={() => router.push("/profile/me")}>Profile</Button>
          <Button onPress={() => router.push("/settings")}>Settings</Button>
        </View>
        {path !== "/" && (
          <FeedTabs
            active="following"
            onChange={(t) => router.push("/?tab=" + t)}
          />
        )}
        {children}
      </View>
    </View>
  );
}
