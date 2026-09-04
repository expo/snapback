import React from "react";
import { ScrollView, Text, View } from "react-native";
import { api } from "snapback2/client";
import { AssetImage, AssetVideo, useOutbox, useQuery } from "snapback2/react-native";
import { intentLabel, threadBubbles, type LogRow } from "../../shared/log.js";
import { Composer } from "../Composer";
export function Thread({ conversationId }: { conversationId: string }) {
  const result = useQuery(api.deliveries.thread, { conversationId, c: null });
  const { entries } = useOutbox();
  const rows: LogRow[] = "data" in result && Array.isArray(result.data) ? result.data : [];
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    {result.state === "partial" ? <Text>Some messages are not downloaded.</Text> : null}
    {result.state === "refused" ? <Text>{result.refusal.rewrite ?? result.refusal.message}</Text> : null}
    {threadBubbles(rows, entries, conversationId).map((bubble) => <View key={bubble.key} testID={`message-${bubble.key}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#e7edff", borderRadius: 12 }}>
      {bubble.kind === "pending" ? <><Text>{bubble.body}</Text><Text>{intentLabel(bubble.entry)}</Text></>
        : <><Text>{bubble.message.body}</Text>
          {bubble.message.photo ? <AssetImage asset={bubble.message.photo} width={240} /> : null}
          {bubble.message.clip ? <AssetVideo asset={bubble.message.clip} width={240} /> : null}
          <Text>{new Date(bubble.at).toLocaleTimeString()}</Text></>}
    </View>)}
  </ScrollView><Composer conversationId={conversationId} /></View>;
}
