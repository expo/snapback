import React from "react";
import { ScrollView } from "react-native";
import { router } from "expo-router";
import { usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { Shell, Button } from "../src/common";
import { ChatRow } from "../src/chat";
export default function Chats() {
  const { items, hasMore, loadMore } = usePage(api.chat.inbox, {});
  return (
    <Shell>
      <Button onPress={() => router.push("/new-chat")}>
        New chat or group
      </Button>
      <ScrollView>
        {items.map((x) => (
          <ChatRow key={x.id} item={x} />
        ))}
        {hasMore && <Button onPress={loadMore}>More conversations</Button>}
      </ScrollView>
    </Shell>
  );
}
