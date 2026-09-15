import React from "react";
import { FlatList } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, usePage } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { Shell, Button } from "../../src/common";
import { PostCard, PostComposer } from "../../src/post";
export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useQuery(api.social.post, { postId: id });
  const { items, hasMore, loadMore } = usePage(api.social.thread, {
    postId: id,
  });
  return (
    <Shell>
      <FlatList
        data={items}
        keyExtractor={(p: any) => p.id}
        ListHeaderComponent={
          <>
            {"data" in r && <PostCard post={r.data} />}
            <PostComposer parentId={id} />
          </>
        }
        renderItem={({ item }) => <PostCard post={item} />}
        onEndReached={() => hasMore && loadMore()}
      />
    </Shell>
  );
}
