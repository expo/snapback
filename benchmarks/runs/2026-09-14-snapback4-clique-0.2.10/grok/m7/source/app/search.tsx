import { SearchBar } from "@snapback-bench/social-ui";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLink, useQuery } from "snapback4/react";
import { api } from "../src/api.generated";

export default function SearchScreen(): React.JSX.Element {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"people" | "messages">("people");
  const router = useRouter();
  const link = useLink();
  const people = useQuery(api.searchPeople, { q });
  const messages = useQuery(api.searchMessages, { q });
  const peopleRows =
    people && !("loading" in people) && !("denied" in people)
      ? (people.data ?? []).map((p: any) => ({
          id: p.handle,
          title: p.displayName,
          subtitle: `@${p.handle}`,
        }))
      : [];
  const messageRows =
    messages && !("loading" in messages) && !("denied" in messages)
      ? (messages.data ?? []).map((m: any) => ({
          id: m.id,
          title: m.body ?? "",
          subtitle: m.author?.handle ?? "",
          groupLabel: m.conversation?.title ?? (m.conversation?.kind === "dm" ? "Direct" : "Chat"),
        }))
      : [];
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {link === "offline" ? <Text testID="sm-search-offline">Offline</Text> : null}
      <View style={{ flexDirection: "row", gap: 12, padding: 12 }}>
        <Pressable onPress={() => setScope("people")}><Text>People</Text></Pressable>
        <Pressable onPress={() => setScope("messages")}><Text>All messages</Text></Pressable>
      </View>
      <SearchBar
        value={q}
        onChangeText={setQ}
        results={scope === "people" ? peopleRows : messageRows}
        onPressResult={(id) => {
          if (scope === "people") router.push(`/profile/${id}`);
        }}
        emptyText="No results"
      />
    </View>
  );
}
