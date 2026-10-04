import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useLink, usePage } from "snapback4/react";
import { SearchBar } from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";

export default function SearchScreen() {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"people" | "messages">("messages");
  const link = useLink();
  const people = usePage(api.people, { q });
  const messages = usePage(api.searchMessages, { q });
  const peopleResults = people.items.map((person) => ({
    id: `person:${person.handle}`,
    title: person.displayName,
    subtitle: `@${person.handle}`,
  }));
  const messageResults = messages.items.map((row) => ({
    id: `msg:${row.id}`,
    title: row.text,
    subtitle: row.senderName ?? "",
    groupLabel: row.chatTitle ?? "Chat",
  }));
  return (
    <View style={{ flex: 1 }}>
      {link !== "online" ? <Text testID="sm-search-offline">Offline</Text> : null}
      <View style={{ flexDirection: "row", gap: 8, padding: 8 }}>
        <Pressable onPress={() => setScope("people")}><Text>People</Text></Pressable>
        <Pressable onPress={() => setScope("messages")}><Text>All messages</Text></Pressable>
      </View>
      <SearchBar
        value={q}
        onChangeText={setQ}
        results={q ? (scope === "people" ? peopleResults : messageResults) : []}
        onPressResult={(id) => {
          if (id.startsWith("person:")) {
            router.push({ pathname: "/profile/[handle]", params: { handle: id.slice("person:".length) } });
          }
        }}
      />
    </View>
  );
}
