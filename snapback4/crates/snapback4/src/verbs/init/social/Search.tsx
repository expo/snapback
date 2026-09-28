import { useState } from "react";
import { Button, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { usePage } from "snapback4/react";
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
  const page = usePage(api.search, { q });
  return <Hits page={page} label="All conversations" />;
}
function ChatResults({ q, conversation }: { q: string; conversation: string }) {
  const page = usePage(api.searchChat, { q, conversation });
  return <Hits page={page} label="This conversation" />;
}
function Hits({ page, label }: { page: ReturnType<typeof usePage<ArgsOf<typeof api.search>, ResultOf<typeof api.search>>>; label: string }) {
  return <ScrollView>
    <Text>{label}</Text>
    <ReadState read={page.read} />
    {page.items.map(row => <Button key={row.id} title={row.text || "Photo"}
      onPress={() => router.push({ pathname: "/conversation/[id]", params: { id: row.conversation } })} />)}
    <Button title="More matches" disabled={!page.hasMore} onPress={page.loadMore} />
  </ScrollView>;
}
