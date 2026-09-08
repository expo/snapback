import React, { useEffect, useState } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { api, intentLabel, type Api } from "snapback2/client";
import { AssetImage, AssetVideo, useOutbox, useQuery } from "snapback2/react-native";
import type { RecoveryCustody, SendUncertainty } from "../../shared/recovery";
import { Composer } from "../Composer";

type Args = { conversationId?: string; body?: string; messageId?: string };
type ResultOf<T> = T extends { readonly __result?: infer Result } ? NonNullable<Result> : never;
type ConversationView = ResultOf<Api["deliveries"]["conversationView"]>;
function usable(result: { data?: unknown; receipt?: { outcome: string } }): ConversationView | undefined {
  if (result.receipt?.outcome !== "complete" && result.receipt?.outcome !== "capped") return undefined;
  const data = result.data as Partial<ConversationView> | undefined;
  return data && Array.isArray(data.messages) && typeof data.count === "number" && Array.isArray(data.preview)
    ? data as ConversationView : undefined;
}

// @ref LLP 1018.000#4-one-observed-query-one-coherent-snapshot — list, count,
// and preview render from one named composite when its receipt is complete;
// the paginated query contributes history only when that composite is partial.
// @ref LLP 1018.003#5-the-certified-thread-projection — both reads contain
// message events only; null nested bodies are the only rows filtered here.
export function Thread({ conversationId, sendCustody }: {
  conversationId: string;
  sendCustody?: RecoveryCustody<SendUncertainty>;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  const snapshot = useQuery(api.deliveries.conversationView, { conversationId });
  const history = useQuery(api.deliveries.thread, { conversationId, c: null });
  const composite = usable(snapshot);
  const usingHistory = !composite && snapshot.status === "ready";
  const { entries, dismiss } = useOutbox();
  const sourceRows = composite?.messages ?? (usingHistory ? history.data ?? [] : []);
  const rows = sourceRows.flatMap((row) => row.message ? [{ ...row, message: row.message }] : []).reverse();
  const postFor = (messageId: string) => entries.find((entry) => entry.op === "deliveries.post" && entry.ids[0] === messageId);
  const unsendFor = (messageId: string) => entries.find((entry) => entry.op === "deliveries.unsend" && (entry.args as Args).messageId === messageId);
  const unplaced = entries.filter((entry) => entry.op === "deliveries.post"
    && (entry.args as Args).conversationId === conversationId && !rows.some((row) => row.messageId === entry.ids[0]));
  const items = [...rows.map((row) => ({ key: row.messageId, row })), ...unplaced.map((entry) => ({ key: entry.ids[0] ?? entry.intent, entry }))];
  useEffect(() => {
    for (const entry of entries) if (entry.state === "committed" && entry.arrived
      && rows.some((row) => row.messageId === entry.ids[0])) void dismiss(entry.intent);
  }, [entries, rows, dismiss]);
  const preview = composite?.preview[0]?.message?.body;
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    <Text testID="thread-summary">{composite
      ? `${composite.count} message${composite.count === 1 ? "" : "s"}${preview ? ` · Latest: ${preview}` : ""}`
      : "Message count unavailable"}</Text>
    {snapshot.status === "loading" ? <Text>Loading…</Text> : snapshot.reason ? <Text>{snapshot.reason.message}</Text> : null}
    {usingHistory ? <Text testID="thread-history-state">Downloaded history · Count and preview unavailable.</Text> : null}
    {items.map((item) => {
      if (!("row" in item)) return <View key={item.key} testID={`message-${item.key}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#fff3d6", borderRadius: 12 }}>
        <Text>{(item.entry.args as Args).body ?? ""}</Text><Text>{intentLabel(item.entry)}</Text>
        {item.entry.state !== "queued" ? <Button title="Dismiss" onPress={() => { void dismiss(item.entry.intent); }} /> : null}
      </View>;
      const { messageId, message, at } = item.row;
      const post = postFor(messageId), unsend = unsendFor(messageId);
      return <View key={messageId} testID={`message-${messageId}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#e7edff", borderRadius: 12 }}>
        <Text>{message.body}</Text>
        {message.oncePhoto ? opened.includes(messageId)
          ? <AssetImage asset={message.oncePhoto} width={240} />
          : <Button title="View photo once" onPress={() => setOpened((ids) => [...ids, messageId])} /> : null}
        {message.photo ? <AssetImage asset={message.photo} width={240} /> : null}
        {message.clip ? <AssetVideo asset={message.clip} width={240} /> : null}
        {post ? <Text>{intentLabel(post)}</Text> : <Text>{new Date(at).toLocaleTimeString()}</Text>}
        {unsend ? <><Text>{`Unsend ${intentLabel(unsend).toLowerCase()}`}</Text>
          {unsend.state !== "queued" ? <Button title="Dismiss" onPress={() => { void dismiss(unsend.intent); }} /> : null}</> : null}
      </View>;
    })}
  </ScrollView><Composer conversationId={conversationId} custody={sendCustody} /></View>;
}
