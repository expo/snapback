import React from "react";
import { Pressable, Text, View } from "react-native";
import { conversations, type LogRow } from "../../shared/log.js";
export function Inbox({ rows, onSelect }: { rows: readonly LogRow[]; onSelect(id: string): void }) {
  return <View accessibilityLabel="Inbox">{conversations(rows).map((item) =>
    <Pressable key={item.conversationId} onPress={() => onSelect(item.conversationId)} style={{ paddingVertical: 16 }}>
      <Text style={{ fontWeight: "600" }}>{item.conversationId}</Text><Text>{item.latestBody ?? `${item.messages} messages`}</Text>
    </Pressable>)}{rows.length === 0 ? <Text>No downloaded messages yet.</Text> : null}</View>;
}
