import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, Button } from "react-native";
import { api } from "snapback2/client";
import { useConnection, useQuery } from "snapback2/react-native";
import type { LogRow } from "../shared/log.js";
import { Inbox } from "./screens/Inbox";
import { Thread } from "./screens/Thread";
import { Search } from "./screens/Search";

export function Chat() {
  const connection = useConnection();
  const inbox = useQuery(api.deliveries.inbox, { c: null }, { drain: true });
  const rows: LogRow[] = "data" in inbox && Array.isArray(inbox.data) ? inbox.data : [];
  const [selected, select] = useState<string>();
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#f7f7fb" }}>
    <Text style={{ fontSize: 24, padding: 16 }}>Snapback Chat · {connection}</Text>
    {selected ? <><Button title="Inbox" onPress={() => select(undefined)} /><Thread conversationId={selected} /></>
      : <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Search onOpen={select} /><Inbox rows={rows} onSelect={select} />
        {inbox.state === "refused" ? <Text>{inbox.refusal.rewrite ?? inbox.refusal.message}</Text> : null}
      </ScrollView>}
  </SafeAreaView>;
}
