import { View } from "react-native";
import { router } from "expo-router";
import { useAsset, usePage, useQuery } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { ChatListRow } from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";

export default function Chats() {
  const page = usePage(api.inbox, {});
  return (
    <View>
      {page.items.map((row) => <InboxRow key={row.conversation} row={row} />)}
    </View>
  );
}

function InboxRow({ row }: { row: { conversation: string; seenOrdinal?: number; chat: { kind: string; title: string | null; accent: string | null; lastOrdinal?: number } | null } }) {
  const chat = row.chat;
  const peer = useQuery(api.directPeer, { conversation: row.conversation });
  const peerId = isReady(peer) ? peer.data?.peer : undefined;
  const profile = useQuery(api.profileById, { principal: peerId ?? "" });
  const handle = isReady(profile) ? profile.data?.handle : undefined;
  const avatar = useAsset(isReady(profile) ? profile.data?.avatar?.id ?? null : null);
  const name = chat?.kind === "group" ? (chat.title ?? "Group") : (profile.data?.displayName ?? handle ?? "Chat");
  const identity = chat?.kind === "group" ? `group:${chat.title ?? row.conversation}` : `dm:${handle ?? "unknown"}`;
  const unread = Math.max(0, (chat?.lastOrdinal ?? 0) - (row.seenOrdinal ?? 0));
  const href = chat?.kind === "group"
    ? { pathname: "/conversation/group/[group]" as const, params: { group: chat.title ?? row.conversation } }
    : { pathname: "/conversation/[handle]" as const, params: { handle: handle ?? row.conversation } };
  if (chat?.kind !== "group" && !handle) return null;
  return (
    <ChatListRow
      title={name}
      identity={identity}
      avatarUri={avatar.status === "ready" ? avatar.url : undefined}
      accentColor={chat?.accent ?? undefined}
      unreadCount={unread}
      onPress={() => router.push(href)}
    />
  );
}
