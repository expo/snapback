import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { mintId } from "snapback4/client";
import { Composer } from "@snapback-bench/social-ui";
import { useClient, useQuery } from "snapback4/react";
import { api } from "../../src/api.generated";
import { FeedItem } from "../../src/FeedItem";
import { settle } from "../../src/ops";

export default function ThreadScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useClient();
  const thread = useQuery(api.thread, { postId: id ?? "none" });
  const [draft, setDraft] = useState("");
  if (!thread || "loading" in thread) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  if ("denied" in thread) return <View style={{ padding: 24 }}><Text>{thread.denied.message}</Text></View>;
  const parent = thread.data.parent;
  const replies = thread.data.replies ?? [];
  return (
    <FlatList
      ListHeaderComponent={
        parent ? (
          <FeedItem
            row={{
              post: parent,
              author: parent.author,
              likes: parent.likes,
              liked: parent.liked,
              reposts: parent.reposts,
              reposted: parent.reposted,
              replies: parent.replies,
            }}
            onReply={() => undefined}
          />
        ) : null
      }
      data={replies as any[]}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <FeedItem
          row={{
            post: item,
            author: item.author,
            likes: item.likes,
            liked: item.liked,
            reposts: item.reposts,
            reposted: item.reposted,
            replies: item.replies,
          }}
          onReply={() => undefined}
        />
      )}
      ListFooterComponent={
        <Composer
          variant="post"
          value={draft}
          onChangeText={setDraft}
          placeholder="Reply"
          onSend={async (text) => {
            if (!id || !text.trim()) return;
            await settle(client, api.replyPost, { replyId: mintId(), parentId: id, body: text.trim() });
            setDraft("");
          }}
        />
      }
    />
  );
}
