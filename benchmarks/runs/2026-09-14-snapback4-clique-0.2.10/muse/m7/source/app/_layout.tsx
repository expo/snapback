import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { ClientGate } from "../lib/client";
import { FeedTabProvider, GlobalFeedTabs } from "../lib/feedtab";
import { DeliveryTracker } from "../lib/tracker";

export default function RootLayout() {
  return (
    <ClientGate>
      <FeedTabProvider>
        <DeliveryTracker />
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: "#fff" },
                headerTintColor: "#17191C",
              }}
            >
              <Stack.Screen name="index" options={{ title: "Chats" }} />
              <Stack.Screen name="feed" options={{ title: "Clique" }} />
              <Stack.Screen name="compose" options={{ title: "New post" }} />
              <Stack.Screen name="thread/[id]" options={{ title: "Thread" }} />
              <Stack.Screen name="profile/[handle]" options={{ title: "Profile" }} />
              <Stack.Screen name="profile/edit" options={{ title: "Edit profile" }} />
              <Stack.Screen name="chats" options={{ title: "Chats" }} />
              <Stack.Screen name="chat/[id]" options={{ title: "Conversation" }} />
              <Stack.Screen name="chat/[id]/settings" options={{ title: "Chat settings" }} />
              <Stack.Screen name="new-chat" options={{ title: "New chat" }} />
              <Stack.Screen name="search" options={{ title: "Search" }} />
              <Stack.Screen name="insights" options={{ title: "Insights" }} />
              <Stack.Screen name="settings" options={{ title: "Settings" }} />
              <Stack.Screen name="media" options={{ title: "Media" }} />
              <Stack.Screen name="conversation/[handle]" options={{ title: "Conversation" }} />
              <Stack.Screen name="conversation/group/[group]" options={{ title: "Group" }} />
              <Stack.Screen name="conversation/group/[group]/settings" options={{ title: "Chat settings" }} />
            </Stack>
          </View>
          <GlobalFeedTabs />
        </View>
      </FeedTabProvider>
    </ClientGate>
  );
}
