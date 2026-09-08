import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, Button } from "react-native";
import { api } from "snapback2/client";
import { useConnection, useQuery } from "snapback2/react-native";
import { Inbox } from "./screens/Inbox";
import { Thread } from "./screens/Thread";
import { Search } from "./screens/Search";

// @ref LLP 1018.003#1-the-snapshot-record — a screen reads `data`, `status`, and `reason`.
export function Chat() {
  const connection = useConnection();
  const inbox = useQuery(api.deliveries.inbox, { c: null }, { drain: true });
  const rows = inbox.data ?? [];
  const [selected, select] = useState<string>();
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#f7f7fb" }}>
    <Text style={{ fontSize: 24, padding: 16 }}>Snapback Chat · {connection}</Text>
    {selected ? <><Button title="Inbox" onPress={() => select(undefined)} /><Thread conversationId={selected} /></>
      : <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Search rows={rows} onOpen={select} /><Inbox rows={rows} onSelect={select} />
        {inbox.status === "unavailable" ? <Text>{inbox.reason?.message}</Text> : null}
      </ScrollView>}
  </SafeAreaView>;
}
