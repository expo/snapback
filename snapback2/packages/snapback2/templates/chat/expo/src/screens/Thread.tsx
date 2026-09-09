import React, { useState } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { api } from "snapback2/client";
import { AssetImage, AssetVideo, useAuth, useOutbox, useQuery } from "snapback2/react-native";
import { Composer } from "../Composer";
import { conversationItems } from "../../shared/thread";

export function Thread({ conversationId }: { conversationId: string }) {
  const { session: auth } = useAuth();
  const account = auth.state === "anonymous" ? null : auth.viewer ?? auth.restoringViewer;
  const [opened, setOpened] = useState({ account, ids: [] as string[] });
  if (account !== undefined && account !== opened.account) setOpened({ account, ids: [] });
  const snapshot = useQuery(api.messages.conversationView, { conversationId }, { items: conversationItems });
  const composite = snapshot.data;
  const { dismiss } = useOutbox();
  const preview = composite?.preview[0]?.message?.body;
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    <Text testID="thread-summary">{composite
      ? `${composite.count} message${composite.count === 1 ? "" : "s"}${preview ? ` · Latest: ${preview}` : ""}`
      : "Message count unavailable"}</Text>
    {snapshot.status === "loading" ? <Text>Loading…</Text> : snapshot.reason ? <Text>{snapshot.reason.message}</Text> : null}
    {snapshot.partial || snapshot.reason?.code === "partial" ? <Text testID="thread-history-state">Downloaded history · Count and preview unavailable.</Text> : null}
    {snapshot.items.map((item) => {
      const message = item.data, messageId = item.key;
      const photoKey = account == null ? undefined : JSON.stringify([account, messageId]);
      const post = item.pending.find(action => action.kind === "create");
      return <View key={messageId} testID={`message-${messageId}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#e7edff", borderRadius: 12 }}>
        <Text>{message?.body ?? item.draft?.body}</Text>
        {message?.oncePhoto ? photoKey !== undefined && opened.ids.includes(photoKey)
          ? <AssetImage asset={message.oncePhoto} width={240} />
          : <Button title="View photo once" disabled={photoKey === undefined} onPress={() => photoKey !== undefined && setOpened((state) => ({ ...state, ids: [...state.ids, photoKey] }))} /> : null}
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
