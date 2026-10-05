import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { usePage, useQuery } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { Composer } from "@snapback-bench/social-ui";
import { useMutation } from "snapback4/react";
import { mintId } from "snapback4/client";
import { useState } from "react";
import { api } from "../../snapback/generated/api";
import { PostCard } from "../../src/PostCard";

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const parent = useQuery(api.postById, { post: id });
  const replies = usePage(api.thread, { post: id });
  const create = useMutation(api.createPost);
  const [draft, setDraft] = useState("");
  const post = isReady(parent) ? parent.data : null;
  return (
    <ScrollView>
      <PostCard post={post} />
      {replies.items.map((row) => <PostCard key={row.id} post={row} />)}
      <Composer
        variant="post"
        value={draft}
        onChangeText={setDraft}
        onSend={async (text) => {
          await create.run({ id: mintId(), body: text, parentId: id });
          setDraft("");
        }}
        maxLength={500}
      />
    </ScrollView>
  );
}
