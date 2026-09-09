import React, { useState } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { api } from "snapback2/client";
import { AssetImage, AssetVideo, useOutbox, useQuery } from "snapback2/react-native";
import { Composer } from "../Composer";
import { conversationItems } from "../../shared/thread";

export function Thread({ conversationId }: { conversationId: string }) {
  const [opened, setOpened] = useState<string[]>([]);
  const snapshot = useQuery(api.messages.conversationView, { conversationId }, { items: conversationItems });
  const composite = snapshot.itemsFrom === "query" ? snapshot.data : undefined;
  const { dismiss } = useOutbox();
  const preview = composite?.preview[0]?.message?.body;
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    <Text testID="thread-summary">{composite
      ? `${composite.count} message${composite.count === 1 ? "" : "s"}${preview ? ` · Latest: ${preview}` : ""}`
      : "Message count unavailable"}</Text>
    {snapshot.status === "loading" ? <Text>Loading…</Text> : snapshot.reason ? <Text>{snapshot.reason.message}</Text> : null}
    {snapshot.history ? <Text testID="thread-history-state">Downloaded history · Count and preview unavailable.</Text> : null}
    {snapshot.items.map((item) => {
      const message = item.data, messageId = item.key;
      const post = item.pending.find(action => action.kind === "create");
      return <View key={messageId} testID={`message-${messageId}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#e7edff", borderRadius: 12 }}>
        <Text>{message?.body ?? item.draft?.body}</Text>
        {message?.oncePhoto ? opened.includes(messageId)
          ? <AssetImage asset={message.oncePhoto} width={240} />
          : <Button title="View photo once" onPress={() => setOpened((ids) => [...ids, messageId])} /> : null}
        {message?.photo ? <AssetImage asset={message.photo} width={240} /> : null}
        {message?.clip ? <AssetVideo asset={message.clip} width={240} /> : null}
        {message && !post && !item.predicted ? <Text>{new Date(message.at).toLocaleTimeString()}</Text> : null}
        {item.pending.map(action => <View key={action.intent}>
          <Text>{action.kind === "create" ? action.label : `${action.kind === "update" ? "Edit" : "Unsend"} ${action.label.toLowerCase()}`}</Text>
          {action.dismissible ? <Button title="Dismiss" onPress={() => { void dismiss(action.intent); }} /> : null}
        </View>)}
      </View>;
    })}
  </ScrollView><Composer conversationId={conversationId} /></View>;
}
