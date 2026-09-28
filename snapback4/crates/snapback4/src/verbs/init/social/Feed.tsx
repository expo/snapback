import { useState } from "react";
import { Button, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, usePage, usePendingWrites, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { ReadState } from "./ui";

export default function Feed() {
  const page = usePage(api.feed, {}), post = useMutation(api.post);
  const pending = usePendingWrites(api.post);
  const [body, setBody] = useState("");
  async function publish() {
    const text = body; setBody("");
    const write = await post.run({ body: text }, { waitSeconds: 0 });
    if (write.state === "failed") setBody(current => current || text);
  }
  return <ScrollView contentContainerStyle={{ padding: 16 }}>
    <Text accessibilityRole="header">Following</Text>
    <TextInput accessibilityLabel="New post" value={body} onChangeText={setBody} maxLength={500} />
    <Button title="Post" disabled={!body.trim() || post.inFlight} onPress={() => void publish()} />
    {post.last?.state === "failed" && <Text>{post.last.why.message}</Text>}
    <Text>{pending.length} pending posts</Text><ReadState read={page.read} />
    {page.items.map(event => <View key={`${event.repost}:${event.id}`}>
      <Text>{event.card?.body ?? "Post unavailable"}</Text><Text>{event.actor}</Text>
      <Like post={event.post} />
    </View>)}
    <Button title="More posts" disabled={!page.hasMore} onPress={page.loadMore} />
  </ScrollView>;
}
function Like({ post }: { post: string }) {
  const state = useQuery(api.postState, { post }), like = useMutation(api.setLike);
  if (!("data" in state)) return <ReadState read={state} />;
  return <View><Button title={state.data.liked ? "Unlike" : "Like"}
    disabled={!!state.revalidating || like.inFlight} onPress={() => void like.run({ post, liked: !state.data.liked })} />
    {like.last?.state === "failed" && <Text>{like.last.why.message}</Text>}</View>;
}
