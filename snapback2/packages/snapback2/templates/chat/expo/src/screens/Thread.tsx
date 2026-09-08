import React, { useState } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { api, type Api } from "snapback2/client";
import { AssetImage, AssetVideo, useOutbox, useQuery } from "snapback2/react-native";
import type { RecoveryCustody, SendUncertainty } from "../../shared/recovery";
import { Composer } from "../Composer";
import { conversationItems, threadItems } from "../../shared/thread";

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
// @ref LLP 1018.003#8-declare-correspondence-once-keep-mechanics-in-the-sdk —
// the same item declaration supplies row attribution in both platform arms.
export function Thread({ conversationId, sendCustody }: {
  conversationId: string;
  sendCustody?: RecoveryCustody<SendUncertainty>;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  const snapshot = useQuery(api.deliveries.conversationView, { conversationId }, { items: conversationItems });
  const history = useQuery(api.deliveries.thread, { conversationId, c: null }, { items: threadItems });
  const composite = usable(snapshot);
  const usingHistory = !composite && snapshot.status === "ready";
  const { dismiss } = useOutbox();
  const readable = !!composite || usingHistory && history.status === "ready";
  const items = composite ? snapshot.items : usingHistory && history.status === "ready" ? history.items : snapshot.items.filter(item => item.draft !== undefined);
  const preview = composite?.preview[0]?.message?.body;
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    <Text testID="thread-summary">{composite
      ? `${composite.count} message${composite.count === 1 ? "" : "s"}${preview ? ` · Latest: ${preview}` : ""}`
      : "Message count unavailable"}</Text>
    {snapshot.status === "loading" ? <Text>Loading…</Text> : snapshot.reason ? <Text>{snapshot.reason.message}</Text> : null}
    {usingHistory ? <Text testID="thread-history-state">Downloaded history · Count and preview unavailable.</Text> : null}
    {items.map((item) => {
      const message = readable ? item.data : undefined, messageId = item.key;
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
  </ScrollView><Composer conversationId={conversationId} custody={sendCustody} /></View>;
}
