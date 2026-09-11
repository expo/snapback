import React, { useState } from "react";
import { Button, Pressable, Text, TextInput, View } from "react-native";
import { api, reasonMessages } from "snapback2/client";
import { usePage } from "snapback2/react-native";

function Results({ term, onOpen }: { term: string; onOpen(conversationId: string): void }) {
  const result = usePage(api.messages.search, { term });
  const [details, setDetails] = useState(false);
  const hits = result.items, next = result.hasMore;
  const predicted = result.pages.some(page => page.local.predicted.some(item => item.table === "messages" && page.data?.some(row => row.id === item.id)));
  const primary = result.status === "loading" ? "Searching…"
    : result.reason?.code === "held" ? "Matching downloaded messages"
    : result.reason?.code === "partial" ? "Some matching messages are not downloaded"
    : result.status === "unavailable" ? "Search unavailable"
    : result.reason?.code === "stale" ? "Saved matches may be out of date"
    : result.reason?.code === "changed" ? "Saved matches need refreshing" : "Matching messages";
  const status = [primary, predicted ? reasonMessages.predicted : undefined,
    next ? "More results available" : result.status === "ready" && !hits.length ? "No matching messages" : undefined].filter(Boolean).join(" · ");
  return <View><Text testID="search-state">{status}</Text>{hits.map((row) =>
    <Pressable key={row.id} testID={`search-${row.id}`} onPress={() => onOpen(row.conversationId)}><Text>{row.body}</Text></Pressable>)}
    {next ? <Button title="Show more results" disabled={result.status === "loading"} onPress={result.loadMore} /> : null}
    {result.reason ? <><Button title={details ? "Hide search details" : "Search details"} onPress={() => setDetails(!details)} />
      {details ? <Text>{JSON.stringify(result.reason, null, 2)}</Text> : null}</> : null}</View>;
}

export function Search({ onOpen }: { onOpen(conversationId: string): void }) {
  const [term, setTerm] = useState("");
  const normalized = term.trim();
  return <View accessibilityLabel="Search"><TextInput accessibilityLabel="Search messages" placeholder="Search"
    maxLength={128} value={term} onChangeText={setTerm} />{normalized ? <Results term={normalized} onOpen={onOpen} /> : null}</View>;
}
