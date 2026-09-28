import { useState } from "react";
import { Button, ScrollView, Text, TextInput } from "react-native";
import { router } from "expo-router";
import { useMutation, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { ReadState } from "./ui";

export default function Chats() {
  const inbox = usePage(api.inbox, {}), create = useMutation(api.createConversation);
  const [title, setTitle] = useState("");
  async function start() {
    const write = await create.run({ title });
    if (write.state === "sent" && write.result) router.push({ pathname: "/conversation/[id]", params: { id: write.result } });
  }
  return <ScrollView contentContainerStyle={{ padding: 16 }}>
    <TextInput accessibilityLabel="Chat title" value={title} onChangeText={setTitle} maxLength={50} />
    <Button title="Create chat" disabled={!title.trim() || create.inFlight} onPress={() => void start()} />
    {create.last?.state === "pending" && <Text>Chat creation pending; it appears here when confirmed.</Text>}
    {create.last?.state === "failed" && <Text>{create.last.why.message}</Text>}
    <ReadState read={inbox.read} />
    {inbox.items.map(row => <Button key={row.conversation} title={row.chat?.title ?? row.conversation}
      onPress={() => router.push({ pathname: "/conversation/[id]", params: { id: row.conversation } })} />)}
    <Button title="More chats" disabled={!inbox.hasMore} onPress={inbox.loadMore} />
  </ScrollView>;
}
