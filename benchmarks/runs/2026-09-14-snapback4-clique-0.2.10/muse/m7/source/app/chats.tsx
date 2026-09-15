import React, { useMemo } from "react";
import { FlatList, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChatListRow } from "../ui-kit/src/ChatListRow";
import { TypingIndicator } from "../ui-kit/src/TypingIndicator";
import { useClient, useLink, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { readData } from "../lib/helpers";
import { BottomNav } from "./components/FeedItem";

function ChatRow({ membership }: { membership: any }) {
  const conv = membership.conversation;
  if (!conv) return null;
  return <ChatRowInner membership={membership} conv={conv} />;
}

const lastDeliveredMark: Record<string, number> = {};

function ChatRowInner({ membership, conv }: { membership: any; conv: any }) {
  const router = useRouter();
  const client: any = useClient();
  const link = useLink();
  const viewer = useViewer();
  const membersRead = useQuery(api.membersOf, { conversationId: conv.id });
  const members = readData<any[]>(membersRead) ?? [];
  const others = (members as any[]).filter((m: any) => m.principal !== viewer);
  const peerProfile = conv.kind === "dm" ? (others[0]?.profile ?? null) : null;
  const title = conv.kind === "dm" ? peerProfile?.displayName ?? "Direct message" : conv.name ?? "Group";
  const identity = conv.kind === "dm" ? `dm:${peerProfile?.handle ?? "unknown"}` : `group:${conv.name ?? conv.id}`;
  const lastRead = membership.lastReadAt ?? 0;
  const msgsRead = useQuery(api.threadMessages, { conversationId: conv.id });
  const msgs = readData<any[]>(msgsRead) ?? [];
  const unread = msgs.filter((m: any) => m.at > lastRead && !m.tombstone && others.some((o: any) => o.principal === m.authorId)).length;
  const typingRead = useQuery(api.typingIn, { conversationId: conv.id });
  const typing = readData<any[]>(typingRead) ?? [];
  const last = msgs[msgs.length - 1];
  // Fetching the row is delivery: mark from the list too, so recipients who
  // never opened the conversation still advance senders' ticks.
  React.useEffect(() => {
    if (link !== "online" || msgs.length === 0) return;
    const now = Date.now();
    if (now - (lastDeliveredMark[conv.id] ?? 0) < 5000) return;
    lastDeliveredMark[conv.id] = now;
    client.mutate(api.markDelivered, { conversationId: conv.id }).catch(() => {});
  }, [client, link, conv.id, msgs.length]);
  return (
    <ChatListRow
      title={title}
      identity={identity}
      preview={typing.length > 0 ? undefined : last ? (last.kind === "text" ? last.body ?? "" : last.kind === "video" ? "Video" : "Photo") : ""}
      timestamp={undefined}
      unreadCount={unread}
      typing={typing.length > 0}
      accentColor={conv.color ? accentHex(conv.color) : undefined}
      onPress={() => router.push({ pathname: "/chat/[id]", params: { id: conv.id } })}
    />
  );
}

export function accentHex(name: string): string {
  const map: Record<string, string> = {
    indigo: "#4F46E5",
    teal: "#0D9488",
    coral: "#EF6351",
    amber: "#D97706",
    violet: "#7C3AED",
    emerald: "#059669",
    rose: "#E11D48",
    slate: "#475569",
  };
  return map[name] ?? "#4F46E5";
}

export function useCurrentConvIds(): Set<string> | null {
  const client: any = useClient();
  const link = useLink();
  const [ids, setIds] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    let live = true;
    if (link !== "online") return;
    (async () => {
      try {
        const r = await client.query(api.myConvIds, {});
        if (!live || (r as any).denied || !(r as any).data) return;
        setIds(new Set(((r as any).data as any[]).map((x: any) => x.conversationId)));
      } catch {}
    })();
    return () => {
      live = false;
    };
  }, [client, link]);
  return ids;
}

export default function Chats() {
  const page = usePage(api.inbox, {});
  const current = useCurrentConvIds();
  const items = useMemo(() => {
    const all = page.items ?? [];
    if (!current) return all;
    return all.filter((m: any) => current.has(m.conversationId));
  }, [page.items, current]);
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <FlatList
        data={items}
        keyExtractor={(m: any) => m.conversationId}
        onEndReached={() => page.hasMore && page.loadMore()}
        onEndReachedThreshold={0.5}
        renderItem={({ item }: any) => <ChatRow membership={item} />}
        ListEmptyComponent={<Text style={{ padding: 24 }}>No chats yet.</Text>}
      />
      <BottomNav />
    </View>
  );
}
