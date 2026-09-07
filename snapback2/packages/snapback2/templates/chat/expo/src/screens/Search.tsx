import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { api } from "snapback2/client";
import { useQuery } from "snapback2/react-native";

function Results({ term, onOpen }: { term: string; onOpen(id: string): void }) {
  const result = useQuery(api.messages.search, { term, c: null });
  const hits = "data" in result && Array.isArray(result.data) ? result.data : [];
  const next = "next" in result && result.next !== null;
  const status = result.state === "hydrating" ? "Searching…"
    : result.state === "held" ? "Downloaded indexed results"
    : result.state === "partial" ? `Partial indexed results · ${result.reason}`
    : result.state === "capped" ? (next ? "Indexed result limit reached · more available" : "Indexed result limit reached")
    : result.state === "denied" ? `Search denied · ${result.rule}`
    : result.state === "refused" ? (result.refusal.rewrite ?? result.refusal.message)
    : result.state === "stale" ? "Showing stale indexed results"
    : result.live ? "Live indexed results" : "Indexed results";
  return <><Text accessibilityLabel={`Search state ${result.state}`}>{status}</Text>
    {hits.map((row) => <Pressable key={row.id} onPress={() => onOpen(row.conversationId)}><Text>{row.body}</Text></Pressable>)}</>;
}

export function Search({ onOpen }: { onOpen(id: string): void }) {
  const [term, setTerm] = useState("");
  const normalized = term.trim();
  return <View><TextInput accessibilityLabel="Search messages" maxLength={128} placeholder="Search" value={term} onChangeText={setTerm} />
    {normalized ? <Results term={normalized} onOpen={onOpen} /> : null}
  </View>;
}
