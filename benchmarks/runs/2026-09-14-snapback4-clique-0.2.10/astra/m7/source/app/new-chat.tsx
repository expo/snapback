import { randomUUID } from "expo-crypto";
import React, { useState } from "react";
import { TextInput, ScrollView, Text } from "react-native";
import { router } from "expo-router";
import { useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { useApp } from "../src/session";
import { Shell, Button } from "../src/common";
export default function NewChat() {
  const { client, setError, error } = useApp();
  const [q, setQ] = useState(""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const r = useQuery(api.people, { q });
  async function create() {
    const w = await client.mutate(api.chat.createGroup, {
      conversationId: randomUUID(),
      name,
      description,
      principals: selected,
    });
    if (w.state === "failed") setError(w.why.message);
    else router.replace("/conversation/id/" + w.result.id);
  }
  return (
    <Shell>
      <ScrollView>
        <TextInput
          testID="sm-search-input"
          placeholder="Find people"
          value={q}
          onChangeText={setQ}
        />
        {"data" in r &&
          r.data
            .filter((p) => p.principal !== client.viewer())
            .map((p) => (
              <React.Fragment key={p.id}>
                <Button
                  testID="sm-search-result"
                  onPress={() => router.push("/conversation/" + p.handle)}
                >
                  {p.displayName} — Message
                </Button>
                <Button
                  onPress={() =>
                    setSelected(
                      selected.includes(p.principal)
                        ? selected.filter((x) => x !== p.principal)
                        : [...selected, p.principal],
                    )
                  }
                >
                  {selected.includes(p.principal)
                    ? "Remove from group"
                    : "Add to group"}{" "}
                  {p.handle}
                </Button>
              </React.Fragment>
            ))}
        <TextInput
          placeholder="Group name"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          placeholder="Description"
          value={description}
          onChangeText={setDescription}
        />
        <Button onPress={create}>Create group ({selected.length + 1})</Button>
        {!!error && <Text>{error}</Text>}
      </ScrollView>
    </Shell>
  );
}
