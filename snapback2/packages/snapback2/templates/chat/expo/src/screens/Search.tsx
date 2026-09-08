import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { LogRow } from "./Inbox";

// @ref LLP 1012#6-reads-offline — a search op has no held answer for a new term, so the recipe filters the downloaded log; it finds nothing evicted.
export function Search({ rows, onOpen }: { rows: readonly LogRow[]; onOpen(id: string): void }) {
  const [term, setTerm] = useState("");
  const needle = term.trim().toLowerCase();
  const seen = new Set<string>();
  const hits = needle ? rows.filter((row) => {
    const body = row.message?.body;
    if (row.kind !== "message" || !body || seen.has(row.messageId) || !body.toLowerCase().includes(needle)) return false;
    seen.add(row.messageId);
    return true;
  }) : [];
  return <View><TextInput accessibilityLabel="Search downloaded messages" placeholder="Search" value={term} onChangeText={setTerm} />
    {term ? <Text>in downloaded messages</Text> : null}
    {hits.map((row) => <Pressable key={row.messageId} onPress={() => onOpen(row.conversationId)}><Text>{row.message?.body}</Text></Pressable>)}
  </View>;
}
