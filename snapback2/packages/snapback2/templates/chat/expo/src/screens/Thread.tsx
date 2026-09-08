import React, { useEffect, useState } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { api, intentLabel } from "snapback2/client";
import { AssetImage, AssetVideo, useOutbox, useQuery } from "snapback2/react-native";
import { Composer } from "../Composer";

type Args = { conversationId?: string; body?: string };

// @ref LLP 1018.003#5-the-certified-thread-projection — the same screen as the web thread: one filter, one reversal, no reducer.
// @ref LLP 1018.003#4-pending-rows-attribution-settlement-and-failure — predicted rows keep their pinned id; unplaced intents render from their arguments.
export function Thread({ conversationId }: { conversationId: string }) {
  const [opened, setOpened] = useState<string[]>([]);
  const view = useQuery(api.deliveries.thread, { conversationId, c: null });
  const { entries, dismiss } = useOutbox();
  const rows = (view.data ?? []).flatMap((row) => (row.message ? [{ ...row, message: row.message }] : [])).reverse();
  const postFor = (messageId: string) => entries.find((entry) => entry.op === "deliveries.post" && entry.ids[0] === messageId);
  const unsendFor = (messageId: string) => entries.find((entry) => entry.op === "deliveries.unsend" && (entry.args as Args & { messageId?: string }).messageId === messageId);
  const unplaced = entries.filter((entry) => entry.op === "deliveries.post"
    && (entry.args as Args).conversationId === conversationId && !rows.some((row) => row.messageId === entry.ids[0]));
  // One keyed list: a pending bubble and the server row it becomes share a key, so the element never remounts.
  const items = [...rows.map((row) => ({ key: row.messageId, row })), ...unplaced.map((entry) => ({ key: entry.ids[0] ?? entry.intent, entry }))];
  // A committed intent whose row is on screen has nothing left to say: the runtime marked its arrival, this screen retires it.
  useEffect(() => {
    for (const entry of entries) if (entry.state === "committed" && entry.arrived && rows.some((row) => row.messageId === entry.ids[0])) void dismiss(entry.intent);
  }, [entries, rows, dismiss]);
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    {view.status === "loading" ? <Text>Loading…</Text> : view.reason ? <Text>{view.reason.message}</Text> : null}
    {items.map((item) => {
      if (!("row" in item)) return <View key={item.key} testID={`message-${item.key}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#fff3d6", borderRadius: 12 }}>
        <Text>{(item.entry.args as Args).body ?? ""}</Text><Text>{intentLabel(item.entry)}</Text>
        {item.entry.state !== "queued" ? <Button title="Dismiss" onPress={() => { void dismiss(item.entry.intent); }} /> : null}
      </View>;
      const { messageId, message, at } = item.row;
      const post = postFor(messageId);
      return <View key={messageId} testID={`message-${messageId}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#e7edff", borderRadius: 12 }}>
        <Text>{message.body}</Text>
        {message.oncePhoto ? opened.includes(messageId)
          ? <AssetImage asset={message.oncePhoto} width={240} />
          : <Button title="View photo once" onPress={() => setOpened((ids) => [...ids, messageId])} /> : null}
        {message.photo ? <AssetImage asset={message.photo} width={240} /> : null}
        {message.clip ? <AssetVideo asset={message.clip} width={240} /> : null}
        {post ? <Text>{intentLabel(post)}</Text> : <Text>{new Date(at).toLocaleTimeString()}</Text>}
        {(() => { const unsend = unsendFor(messageId); return unsend ? <><Text>{`Unsend ${intentLabel(unsend).toLowerCase()}`}</Text>
          {unsend.state !== "queued" ? <Button title="Dismiss" onPress={() => { void dismiss(unsend.intent); }} /> : null}</> : null; })()}
      </View>;
    })}
  </ScrollView><Composer conversationId={conversationId} /></View>;
}
