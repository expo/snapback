import React, { useState } from "react";
import { View, Text, TextInput, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { usePage, useLink } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { Shell, Button } from "../src/common";
function People({ q }: { q: string }) {
  const { items, hasMore, loadMore } = usePage(api.people, { q });
  return (
    <>
      {items.map((p) => (
        <Button
          key={p.id}
          testID="sm-search-result"
          onPress={() => router.push("/profile/" + p.handle)}
        >
          {p.displayName} @{p.handle}
        </Button>
      ))}
      {hasMore && <Button onPress={loadMore}>More people</Button>}
    </>
  );
}
function Messages({
  q,
  conversationId,
}: {
  q: string;
  conversationId?: string;
}) {
  const { items, hasMore, loadMore } = usePage(
    conversationId ? api.features.inChat : api.features.allMessages,
    { q, ...(conversationId ? { conversationId } : {}) } as any,
  );
  const groups = new Map<string, any[]>();
  for (const m of items) {
    if (!groups.has(m.conversationId)) groups.set(m.conversationId, []);
    groups.get(m.conversationId)!.push(m);
  }
  return (
    <>
      {[...groups].map(([id, ms]) => (
        <View key={id}>
          <Text style={{ fontWeight: "700", padding: 14 }}>
            {ms[0]?.conversation?.name ?? "Conversation"}
          </Text>
          {ms.map((m) => (
            <Button
              key={m.id}
              testID="sm-search-result"
              onPress={() =>
                router.push("/conversation/id/" + m.conversationId)
              }
            >
              {m.sender?.displayName}: {m.text}
            </Button>
          ))}
        </View>
      ))}
      {hasMore && <Button onPress={loadMore}>More messages</Button>}
    </>
  );
}
export default function Search() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const [q, setQ] = useState(""),
    [scope, setScope] = useState<"people" | "messages">("messages");
  const link = useLink();
  return (
    <Shell>
      <TextInput
        testID="sm-search-input"
        placeholder="Search people or messages"
        value={q}
        onChangeText={setQ}
        style={{ padding: 18, fontSize: 18 }}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button onPress={() => setScope("messages")}>
          {conversationId ? "This chat" : "All messages"}
        </Button>
        <Button onPress={() => setScope("people")}>People</Button>
      </View>
      {link === "offline" && (
        <Text testID="sm-search-offline">
          Offline · searching synced messages
        </Text>
      )}
      <ScrollView>
        {scope === "people" ? (
          <People key={q} q={q} />
        ) : (
          <Messages
            key={q + (conversationId ?? "")}
            q={q}
            conversationId={conversationId}
          />
        )}
      </ScrollView>
    </Shell>
  );
}
