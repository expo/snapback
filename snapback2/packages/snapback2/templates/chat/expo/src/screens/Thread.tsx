import React, { useState } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { api } from "snapback2/client";
import { AssetImage, AssetVideo, useQuery, useSnapbackClient } from "snapback2/react-native";
import { threadItems } from "../../shared/thread";
import { Composer } from "../Composer";

const prefix = { create: "", update: "Edit ", remove: "Unsend " };

// @ref LLP 1018.003#7-one-list-with-the-querys-truth-preserved — native and web
// render the same item shape; neither joins outbox rows nor retires intents.
export function Thread({ conversationId }: { conversationId: string }) {
  const [opened, setOpened] = useState<string[]>([]);
  const view = useQuery(api.deliveries.thread, { conversationId, c: null }, { items: threadItems });
  const { outbox } = useSnapbackClient();
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    {view.status === "loading" ? <Text>Loading…</Text> : view.reason ? <Text>{view.reason.message}</Text> : null}
    {view.items.map(item => {
      const message = item.data, post = item.pending.find(action => action.kind === "create");
      return <View key={item.key} testID={`message-${item.key}`} style={{ padding: 12, marginVertical: 4, backgroundColor: message ? "#e7edff" : "#fff3d6", borderRadius: 12 }}>
        <Text>{message?.body ?? item.draft?.body}</Text>
        {message?.oncePhoto ? opened.includes(item.key)
          ? <AssetImage asset={message.oncePhoto} width={240} />
          : <Button title="View photo once" onPress={() => setOpened(ids => [...ids, item.key])} /> : null}
        {message?.photo ? <AssetImage asset={message.photo} width={240} /> : null}
        {message?.clip ? <AssetVideo asset={message.clip} width={240} /> : null}
        {message && !post ? <Text>{new Date(message.at).toLocaleTimeString()}</Text> : null}
        {item.pending.map(action => <View key={action.intent}>
          <Text>{action.kind === "create" ? action.label : prefix[action.kind] + action.label.toLowerCase()}</Text>
          {action.dismissible ? <Button title="Dismiss" onPress={() => { void outbox.dismiss(action.intent); }} /> : null}
        </View>)}
      </View>;
    })}
  </ScrollView><Composer conversationId={conversationId} /></View>;
}
