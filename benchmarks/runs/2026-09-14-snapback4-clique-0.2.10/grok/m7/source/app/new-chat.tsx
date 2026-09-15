import { SearchBar } from "@snapback-bench/social-ui";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { mintId } from "snapback4/client";
import { useClient, useQuery } from "snapback4/react";
import { api } from "../src/api.generated";
import { settle } from "../src/ops";

export default function NewChat(): React.JSX.Element {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const people = useQuery(api.searchPeople, { q: q || "a" });
  const client = useClient();
  const router = useRouter();
  const rows =
    people && !("loading" in people) && !("denied" in people)
      ? (people.data ?? []).map((p: any) => ({ id: p.handle, title: p.displayName, subtitle: `@${p.handle}` }))
      : [];

  async function create() {
    const list = people && !("loading" in people) && !("denied" in people) ? people.data ?? [] : [];
    const selected = list.filter((p: any) => picked.includes(p.handle));
    if (selected.length === 1 && !name) {
      router.replace(`/conversation/${selected[0].handle}`);
      return;
    }
    if (selected.length >= 1 && name) {
      const second = selected[0];
      const created = await settle(client, api.createGroup, {
        conversationId: mintId(),
        second: second.principal,
        name,
        description: "",
      });
      if (created.state === "sent") {
        for (const extra of selected.slice(1)) {
          await settle(client, api.addMember, {
            conversationId: created.result.id,
            member: extra.principal,
            mutationId: mintId(),
          });
        }
        router.replace(`/conversation/group/${encodeURIComponent(name)}`);
      }
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 12 }}>
      <TextInput placeholder="Group name (optional)" value={name} onChangeText={setName} style={{ padding: 12 }} />
      <SearchBar
        value={q}
        onChangeText={setQ}
        results={rows}
        onPressResult={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
      />
      <Text>Selected: {picked.join(", ")}</Text>
      <Pressable onPress={() => void create()}><Text>Create</Text></Pressable>
    </View>
  );
}
