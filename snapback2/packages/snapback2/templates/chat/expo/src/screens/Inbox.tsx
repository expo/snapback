import React from "react";
import { Pressable, Text, View } from "react-native";
import type { Api, ResultOf } from "snapback2/client";

/** One row of the drained delivery log; the inbox, search, and every thread read the same held rows. */
export type LogRow = ResultOf<Api["messages"]["inbox"]>[number];

function conversations(rows: readonly LogRow[]) {
  const byConversation = new Map<string, { conversationId: string; latestAt: number; latestBody?: string; messages: number }>();
  for (const row of rows) {
    const current = byConversation.get(row.conversationId) ?? { conversationId: row.conversationId, latestAt: row.at, messages: 0 };
    if (row.kind === "message") current.messages += 1;
    if (row.at >= current.latestAt) { current.latestAt = row.at; current.latestBody = row.message?.body ?? current.latestBody; }
    byConversation.set(row.conversationId, current);
  }
  return [...byConversation.values()].sort((a, b) => b.latestAt - a.latestAt);
}

export function Inbox({ rows, onSelect }: { rows: readonly LogRow[]; onSelect(id: string): void }) {
  return <View accessibilityLabel="Inbox">{conversations(rows).map((item) =>
    <Pressable key={item.conversationId} onPress={() => onSelect(item.conversationId)} style={{ paddingVertical: 16 }}>
      <Text style={{ fontWeight: "600" }}>{item.conversationId}</Text><Text>{item.latestBody ?? `${item.messages} messages`}</Text>
    </Pressable>)}{rows.length === 0 ? <Text>No downloaded messages yet.</Text> : null}</View>;
}
