import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { api, type OutboxEntry } from "snapback2/client";
import { AssetImage, AssetVideo, useOutbox, useQuery, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react-native";
import { intentLabel, threadBubbles, type LogRow } from "../../shared/log.js";
import { Composer } from "../Composer";
import { authorizedHistoryRows, usableConversationView, type SendUncertainty } from "../../shared/offline.js";
import type { RecoveryCustody } from "../../shared/recovery";

// @ref LLP 1018.000#4-one-observed-query-one-coherent-snapshot — summary and
// list are separate mounted consumers of one named composite query snapshot.
function ThreadSummary({ conversationId }: { conversationId: string }) {
  const result = useQuery(api.deliveries.conversationView, { conversationId });
  const view = usableConversationView(result);
  const count = view && typeof view.count === "number" ? view.count : undefined;
  const preview = view && Array.isArray(view.preview) ? view.preview[0] : undefined;
  const previewBody = preview?.message?.body;
  return <View testID="thread-summary">
    <Text>{count === undefined ? "Message count unavailable" : `${count} message${count === 1 ? "" : "s"}`}</Text>
    {previewBody ? <Text>{`Latest: ${previewBody}`}</Text> : null}
  </View>;
}

function BubbleList({ rows, entries, conversationId, opened, setOpened }: {
  rows: readonly LogRow[];
  entries: readonly OutboxEntry[];
  conversationId: string;
  opened: readonly string[];
  setOpened(update: (ids: string[]) => string[]): void;
}) {
  return <>{threadBubbles(rows, entries, conversationId).map((bubble) => <View key={bubble.key}
    testID={`message-${bubble.key}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#e7edff", borderRadius: 12 }}>
    {bubble.kind === "pending" ? <><Text>{bubble.body}</Text><Text>{intentLabel(bubble.entry)}</Text></>
      : <><Text>{bubble.message.body}</Text>
        {bubble.message.oncePhoto ? opened.includes(bubble.key)
          ? <AssetImage asset={bubble.message.oncePhoto} width={240} />
          : <Button title="View photo once" onPress={() => setOpened(ids => [...ids, bubble.key])} /> : null}
        {bubble.message.photo ? <AssetImage asset={bubble.message.photo} width={240} /> : null}
        {bubble.message.clip ? <AssetVideo asset={bubble.message.clip} width={240} /> : null}
        <Text>{new Date(bubble.at).toLocaleTimeString()}</Text></>}
  </View>)}</>;
}

function usePartialHistory(conversationId: string, active: boolean) {
  const client = useSnapbackClient();
  const generation = useSnapbackSnapshot().authGeneration;
  const observed = useMemo(() => client.observe(api.deliveries.thread, { conversationId, c: null }), [client, generation, conversationId]);
  const subscribe = useCallback((notify: () => void) => active ? observed.subscribe(notify) : () => undefined, [active, observed]);
  return useSyncExternalStore(subscribe, observed.getSnapshot, observed.getSnapshot);
}

function historyStatus(result: ReturnType<typeof usePartialHistory>): string {
  if (result.state === "refused") return `Downloaded history unavailable · ${result.refusal.rewrite ?? result.refusal.message}`;
  if (result.state === "denied") return `Downloaded history denied · ${result.rule}`;
  if (result.state === "hydrating") return "Loading downloaded history · Count and preview unavailable.";
  if (result.state === "partial") return `Partial downloaded history · ${result.reason} · Count and preview unavailable.`;
  if (result.state === "stale") return "Showing stale downloaded history · Count and preview unavailable.";
  return "Downloaded history · Count and preview unavailable.";
}

export function Thread({ conversationId, sendCustody }: {
  conversationId: string;
  sendCustody?: RecoveryCustody<SendUncertainty>;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  const result = useQuery(api.deliveries.conversationView, { conversationId });
  const { entries } = useOutbox();
  const view = usableConversationView(result);
  const usingHistory = result.state === "partial";
  const history = usePartialHistory(conversationId, usingHistory);
  const compositeRows = (view?.messages ?? []) as LogRow[];
  const historyRows = authorizedHistoryRows(history) as LogRow[];
  const rows = usingHistory ? historyRows : compositeRows;
  return <View style={{ flex: 1 }}><ThreadSummary conversationId={conversationId} /><ScrollView contentContainerStyle={{ padding: 16 }}>
    {result.state === "partial" ? <Text>Some messages are not downloaded.</Text> : null}
    {result.state === "refused" ? <Text>{result.refusal.rewrite ?? result.refusal.message}</Text> : null}
    {usingHistory ? <Text>{historyStatus(history)}</Text> : null}
    <BubbleList rows={rows} entries={entries} conversationId={conversationId} opened={opened} setOpened={setOpened} />
  </ScrollView><Composer conversationId={conversationId} custody={sendCustody} /></View>;
}
