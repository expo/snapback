import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, Button, View } from "react-native";
import { api } from "snapback2/client";
import { useConnection, useOutbox, useQuery } from "snapback2/react-native";
import { Inbox, type LogRow } from "./screens/Inbox";
import { Thread } from "./screens/Thread";
import { Search } from "./screens/Search";
import { NewConversation } from "./NewConversation";

export function Chat() {
  const connection = useConnection();
  const outbox = useOutbox();
  const [showChanges, setShowChanges] = useState(false);
  const [details, setDetails] = useState<string>();
  const inbox = useQuery(api.messages.inbox, {}, { drain: true });
  const groups = useQuery(api.groups.mine, {}, { drain: true });
  const rows = (inbox.data ?? []) as LogRow[];
  const [selected, select] = useState<string>();
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#f7f7fb" }}>
    <Text style={{ fontSize: 24, padding: 16 }}>Snapback Chat · {connection === "connected" ? "Connected" : connection === "offline" ? "Offline" : "Reconnecting…"}</Text>
    {outbox.work.length > 0 ? <Button title={`Changes on this device (${outbox.work.length})`} onPress={() => setShowChanges(!showChanges)} /> : null}
    {showChanges ? <ScrollView style={{ maxHeight: 200 }}>{outbox.work.map(({ entry, label, dismissible }) => <View key={entry.intent}>
      <Text>{label}</Text>
      <Button title={details === entry.intent ? "Hide details" : "Details"} onPress={() => setDetails(details === entry.intent ? undefined : entry.intent)} />
      {details === entry.intent ? <Text>{JSON.stringify({ operation: entry.op, refusal: entry.refusal, result: entry.response }, null, 2)}</Text> : null}
      {dismissible ? <Button title="Dismiss" onPress={() => { void outbox.dismiss(entry.intent); }} /> : null}
    </View>)}</ScrollView> : null}
    {selected ? <><Button title="Inbox" onPress={() => select(undefined)} /><Thread conversationId={selected} /></>
      : <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Search onOpen={select} /><NewConversation onOpen={select} /><Inbox groups={groups.data ?? []} rows={rows} onSelect={select} />
        {inbox.status === "unavailable" ? <Text>{inbox.reason?.message}</Text> : null}
      </ScrollView>}
  </SafeAreaView>;
}
