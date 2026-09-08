import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, Button } from "react-native";
import { api } from "snapback2/client";
import { useConnection, useQuery, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react-native";
import { useAccountRecoveryCustody, type SendUncertainty } from "../shared/recovery";
import { Inbox, type LogRow } from "./screens/Inbox";
import { Thread } from "./screens/Thread";
import { Search } from "./screens/Search";

// @ref LLP 1018.003#1-the-snapshot-record — screens read data, status, and
// reason from one truthful snapshot record.
export function Chat() {
  const connection = useConnection();
  const client = useSnapbackClient();
  const authGeneration = useSnapbackSnapshot().authGeneration;
  const sendCustody = useAccountRecoveryCustody<SendUncertainty>(client, authGeneration);
  const inbox = useQuery(api.deliveries.inbox, { c: null }, { drain: true });
  const rows = (inbox.data ?? []) as LogRow[];
  const [selected, select] = useState<string>();
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#f7f7fb" }}>
    <Text style={{ fontSize: 24, padding: 16 }}>Snapback Chat · {connection}</Text>
    {selected ? <><Button title="Inbox" onPress={() => select(undefined)} /><Thread conversationId={selected}
      sendCustody={sendCustody} /></>
      : <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Search onOpen={select} /><Inbox rows={rows} onSelect={select} />
        {sendCustody.unknown ? <Text accessibilityRole="alert">
          {`Send confirmation is unknown in ${sendCustody.unknown.conversationId}. Open that conversation to check the same send.`}
        </Text> : null}
        {inbox.status === "unavailable" ? <Text>{inbox.reason?.message}</Text> : null}
      </ScrollView>}
  </SafeAreaView>;
}
