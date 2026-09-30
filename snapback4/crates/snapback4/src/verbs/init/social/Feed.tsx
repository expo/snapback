import { existence, isReady } from "snapback4/contract";
import { useState } from "react";
import { Button, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, usePage, usePendingWrites, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";

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
    <Text>{pending.length} pending posts</Text><Text>{existence(page.read) === "loading" ? "Loading…" : existence(page.read) === "partial" ? "Partial results" : "denied" in page.read ? page.read.denied.message : ""}</Text>
    {page.items.map(event => <View key={`${event.repost}:${event.id}`}>
      <Text>{event.card?.body ?? "Post unavailable"}</Text><Text>{event.actor}</Text>
      <Like post={event.post} />
    </View>)}
    <Button title="More posts" disabled={!page.hasMore} onPress={page.loadMore} />
  </ScrollView>;
}
function Like({ post }: { post: string }) {
  const state = useQuery(api.postState, { post }), like = useMutation(api.setLike);
  const liked = isReady(state) && state.existence === "present" ? state.data.liked : undefined;
  return <View><Button title={liked === true ? "Unlike" : "Like"}
    disabled={existence(state) === "denied" || like.inFlight} onPress={() => void like.run({ post, liked: liked !== true })} />
    <Text>{existence(state) === "loading" ? "Checking reaction…" : "denied" in state ? state.denied.message : ""}</Text>
    {like.last?.state === "failed" && <Text>{like.last.why.message}</Text>}</View>;
}
