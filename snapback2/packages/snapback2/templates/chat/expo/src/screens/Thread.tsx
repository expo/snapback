import React, { useState } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { api, type ImageAsset } from "snapback2/client";
import { AssetImage, AssetVideo, useAuth, useOutbox, usePage } from "snapback2/react-native";
import { Composer } from "../Composer";
import { conversationItems } from "../../shared/thread";

export function Thread({ conversationId }: { conversationId: string }) {
  const { session: auth } = useAuth();
  const account = auth.state === "anonymous" ? null : auth.viewer ?? auth.restoringViewer;
  // @ref LLP 1023.000#c--separate-live-once-publication-from-offline-redaction — only an explicit opening retains a descriptor, within its viewer and conversation.
  const [opened, setOpened] = useState({ account, conversationId, photos: {} as Record<string, { messageId: string; asset: ImageAsset }> });
  if (conversationId !== opened.conversationId || account !== undefined && account !== opened.account) setOpened({ account, conversationId, photos: {} });
  const snapshot = usePage(api.messages.conversationView, { conversationId }, { items: conversationItems });
  const composite = snapshot.head.data;
  const { dismiss } = useOutbox();
  const preview = composite?.preview[0]?.message?.body;
  const items = new Map<string, (typeof snapshot.items)[number] | undefined>(snapshot.items.map(item => [item.key, item] as const));
  if (account != null && account === opened.account) for (const { messageId } of Object.values(opened.photos)) {
    if (!items.has(messageId)) items.set(messageId, undefined);
  }
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    <Text testID="thread-summary">{composite
      ? `${composite.count} message${composite.count === 1 ? "" : "s"}${preview ? ` · Latest: ${preview}` : ""}`
      : "Message count unavailable"}</Text>
    {snapshot.status === "loading" ? <Text>Loading…</Text> : snapshot.reason ? <Text>{snapshot.reason.message}</Text> : null}
    {snapshot.head.partial || snapshot.head.reason?.code === "partial" ? <Text testID="thread-history-state">Downloaded history · Count and preview unavailable.</Text> : null}
    {snapshot.hasMore ? <Button title="Load older messages" disabled={snapshot.status === "loading"} onPress={snapshot.loadMore} /> : null}
    {[...items].map(([messageId, item]) => {
      const message = item?.data;
      const photoKey = account == null ? undefined : JSON.stringify([account, messageId]);
      const photo = message?.oncePhoto, openedPhoto = photoKey === undefined ? undefined : opened.photos[photoKey]?.asset;
      const post = item?.pending.find(action => action.kind === "create");
      return <View key={messageId} testID={`message-${messageId}`} style={{ padding: 12, marginVertical: 4, backgroundColor: "#e7edff", borderRadius: 12 }}>
        <Text>{message?.body ?? item?.draft?.body ?? (openedPhoto ? "Opened photo" : null)}</Text>
        {openedPhoto ? <AssetImage asset={openedPhoto} width={240} /> : photo
          ? <Button title="View photo once" disabled={photoKey === undefined} onPress={() => photoKey !== undefined && setOpened((state) => ({ ...state, photos: { ...state.photos, [photoKey]: { messageId, asset: photo } } }))} /> : null}
        {message?.photo ? <AssetImage asset={message.photo} width={240} /> : null}
        {message?.clip ? <AssetVideo asset={message.clip} width={240} /> : null}
        {message && !post && !item?.predicted ? <Text>{new Date(message.at).toLocaleTimeString()}</Text> : null}
        {item?.pending.map(action => <View key={action.intent}>
          <Text>{action.kind === "create" ? action.label : `${action.kind === "update" ? "Edit" : "Unsend"} ${action.label.toLowerCase()}`}</Text>
          {action.dismissible ? <Button title="Dismiss" onPress={() => { void dismiss(action.intent); }} /> : null}
        </View>)}
      </View>;
    })}
  </ScrollView><Composer conversationId={conversationId} /></View>;
}
