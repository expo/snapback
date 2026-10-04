import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { usePage } from "snapback4/react";
import { SearchBar } from "@snapback-bench/social-ui";
import { api } from "../../snapback/generated/api";

export default function SearchChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [q, setQ] = useState("");
  const page = usePage(api.searchChat, { conversation: id, q });
  return (
    <View>
      <SearchBar
        value={q}
        onChangeText={setQ}
        results={page.items.map((row) => ({ id: row.id, title: row.text, subtitle: row.senderName ?? "" }))}
      />
    </View>
  );
}
