import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { readData } from "../../lib/helpers";
import { FeedItem, ZeroCounts, useFeedCounts } from "../components/FeedItem";
import { Composer } from "../../ui-kit/src/Composer";
import { useClient } from "snapback4/react";
import { useFocusEffect } from "expo-router";

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client: any = useClient();
  const [focused, setFocused] = React.useState(true);
  useFocusEffect(
    React.useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  const read = useQuery(api.thread, { postId: id! });
  const data = readData<any>(read);
  const [reply, setReply] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const postIds = data ? [data.post?.id, ...(data.replies ?? []).map((r: any) => r.id)].filter(Boolean) : [];
  const counts = useFeedCounts(postIds);
  if (!data) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  const sendReply = async (body: string) => {
    if (sending || !body.trim()) return;
    setSending(true);
    try {
      await client.mutate(api.createReply, { parentId: id!, body });
      setReply("");
    } finally {
      setSending(false);
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <FeedItem entry={{ post: data.post, author: data.post?.author }} counts={counts[data.post?.id] ?? ZeroCounts} />
      {(data.replies ?? []).map((r: any) => (
        <FeedItem key={r.id} entry={{ post: r, author: r.author }} counts={counts[r.id] ?? ZeroCounts} />
      ))}
      {focused ? (
        <Composer variant="post" value={reply} onChangeText={setReply} onSend={sendReply} maxLength={500} sending={sending} placeholder="Write a reply…" />
      ) : null}
    </View>
  );
}
