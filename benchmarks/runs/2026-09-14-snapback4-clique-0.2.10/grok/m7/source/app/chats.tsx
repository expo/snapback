import { ChatListRow, chatAccents } from "@snapback-bench/social-ui";
import { useRouter } from "expo-router";
import React from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "../src/api.generated";
import { useAssetUrl } from "../src/AssetMedia";
import { formatTime, groupSlug } from "../src/ops";

function Row({ item }: { item: any }): React.JSX.Element {
  const router = useRouter();
  const viewer = useViewer();
  const conv = item.conversation;
  const members = useQuery(api.membersOf, { conversationId: item.conversationId });
  const other =
    members && !("loading" in members) && !("denied" in members)
      ? (members.data ?? []).find((m: any) => m.principal !== viewer && m.profile?.handle)
      : null;
  const handle = other?.profile?.handle ?? "chat";
  const avatar = useAssetUrl(other?.profile?.avatar?.id);
  const title = conv?.kind === "group" ? conv.title ?? "Group" : other?.profile?.displayName ?? handle;
  const identity = conv?.kind === "group" ? `group:${groupSlug(conv.title ?? "group")}` : `dm:${handle}`;
  const accent = conv?.accent ? chatAccents[conv.accent as keyof typeof chatAccents] : undefined;
  return (
    <ChatListRow
      title={title}
      preview={item.tail?.preview}
      timestamp={formatTime(item.tail?.at)}
      unreadCount={item.unread ?? 0}
      identity={identity}
      avatarUri={avatar}
      accentColor={accent}
      onPress={() => {
        if (conv?.kind === "group") router.push(`/conversation/group/${encodeURIComponent(conv.title ?? "")}`);
        else router.push(`/conversation/${handle}`);
      }}
    />
  );
}

export default function ChatsScreen(): React.JSX.Element {
  const router = useRouter();
  const inbox = usePage(api.inbox, {});
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>Chats</Text>
        <Pressable onPress={() => router.push("/new-chat")}><Text>New</Text></Pressable>
      </View>
      <FlatList
        data={inbox.items as any[]}
        keyExtractor={(item, i) => item.conversationId ?? String(i)}
        renderItem={({ item }) => <Row item={item} />}
        onEndReached={inbox.loadMore}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-around", padding: 12, borderTopWidth: 1, borderColor: "#E2E4E8" }}>
        <Pressable onPress={() => router.push("/feed")}><Text>Feed</Text></Pressable>
        <Pressable onPress={() => router.push("/chats")}><Text>Chats</Text></Pressable>
        <Pressable onPress={() => router.push("/search")}><Text>Search</Text></Pressable>
        <Pressable onPress={() => router.push("/me")}><Text>Me</Text></Pressable>
      </View>
    </View>
  );
}
