import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { api } from "snapback2/client";
import { useQuery } from "snapback2/react-native";

function Results({ term, onOpen }: { term: string; onOpen(conversationId: string): void }) {
  const result = useQuery(api.messages.search, { term, c: null });
  const hits = result.data ?? [];
  const next = result.receipt?.next !== null && result.receipt?.next !== undefined;
  const status = result.status === "loading" ? "Searching…"
    : result.reason?.code === "held" ? "Downloaded indexed results"
    : result.reason?.code === "partial" ? `Partial indexed results · ${result.reason.detail ?? result.reason.message}`
    : result.receipt?.outcome === "capped" ? (next ? "Indexed result limit reached · more available" : "Indexed result limit reached")
    : result.status === "unavailable" ? (result.reason?.message ?? "Search unavailable")
    : result.reason?.code === "stale" ? "Showing stale indexed results"
    : result.reason?.code === "predicted" ? result.reason.message
    : result.freshness.live ? "Live indexed results" : "Indexed results";
  return <View><Text testID="search-state">{status}</Text>{hits.map((row) =>
    <Pressable key={row.id} testID={`search-${row.id}`} onPress={() => onOpen(row.conversationId)}><Text>{row.body}</Text></Pressable>)}</View>;
}

// @ref LLP 1012#6-reads-offline — the native screen uses the same named
// Unicode index and retains held/partial/capped provenance.
export function Search({ onOpen }: { onOpen(conversationId: string): void }) {
  const [term, setTerm] = useState("");
  const normalized = term.trim();
  return <View accessibilityLabel="Search"><TextInput accessibilityLabel="Search messages" placeholder="Search"
    maxLength={128} value={term} onChangeText={setTerm} />{normalized ? <Results term={normalized} onOpen={onOpen} /> : null}</View>;
}
