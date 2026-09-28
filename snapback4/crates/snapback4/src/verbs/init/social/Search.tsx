import { useState } from "react";
import { Button, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useLink, usePage } from "snapback4/react";
import type { ArgsOf, ResultOf } from "snapback4/contract";
import { api } from "../snapback/generated/api";
import { ReadState } from "./ui";

export default function Search({ conversation }: { conversation?: string }) {
  const [q, setQ] = useState("");
  return <View style={{ flex: 1, padding: 16 }}>
    <TextInput accessibilityLabel="Search messages" value={q} onChangeText={setQ} maxLength={100} />
    {conversation ? <ChatResults q={q} conversation={conversation} /> : <Results q={q} />}
  </View>;
}
function Results({ q }: { q: string }) {
  const link = useLink();
  // Temporary documented all-chat split: online means current memberships;
  // offline means this device's holdings, including retained departed chats.
  // Replace with ordinary all-chat search when that capability ships.
  const op = link === "online" ? api.searchNewest : api.searchHeld;
  const page = usePage(op, { q });
  return <Hits page={page} label={link === "online" ? "Current chats" : "Searched on this device (partial history)"} />;
}
function ChatResults({ q, conversation }: { q: string; conversation: string }) {
  const page = usePage(api.searchChat, { q, conversation });
  return <Hits page={page} label="This conversation" />;
}
function Hits({ page, label }: { page: ReturnType<typeof usePage<ArgsOf<typeof api.searchHeld>, ResultOf<typeof api.searchHeld>>>; label: string }) {
  return <ScrollView>
    <Text>{label}</Text>
    <ReadState read={page.read} />
    {page.items.map(row => <Button key={row.id} title={row.text || "Photo"}
      onPress={() => router.push({ pathname: "/conversation/[id]", params: { id: row.conversation } })} />)}
    <Button title="More matches" disabled={!page.hasMore} onPress={page.loadMore} />
  </ScrollView>;
}
