import React, { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { TrendingRow, TrendingEmpty } from "../ui-kit/src/TrendingRow";
import { usePage, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { useFeedTab, FeedTab } from "../lib/feedtab";
import { readData } from "../lib/helpers";
import { BottomNav, FeedItem, ZeroCounts, useFeedCounts, usePrincipalMap, useFeedCardProps } from "./components/FeedItem";
import { PostComposer } from "./components/PostComposer";

function useFocused() {
  const [focused, setFocused] = React.useState(true);
  useFocusEffect(
    React.useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  return focused;
}

function FollowingPane() {
  const focused = useFocused();
  const page = usePage(api.followingFeed, {});
  const items = useMemo(() => page.items ?? [], [page.items]);
  const counts = useFeedCounts(items.map((e: any) => e.post?.id).filter(Boolean));
  const reposters = usePrincipalMap(items.map((e: any) => e.repostBy).filter(Boolean));
  return (
    <FlatList
      data={items}
      keyExtractor={(e: any) => e.id}
      initialNumToRender={30}
      maxToRenderPerBatch={30}
      windowSize={41}
      removeClippedSubviews={false}
      onEndReached={() => page.hasMore && page.loadMore()}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={focused ? <PostComposer /> : null}
      renderItem={({ item }: any) => (
        <FeedItem
          entry={item}
          counts={item.post ? counts[item.post.id] ?? ZeroCounts : ZeroCounts}
          reposterName={item.repostBy ? reposters[item.repostBy]?.displayName : undefined}
          reposterHandle={item.repostBy ? reposters[item.repostBy]?.handle : undefined}
        />
      )}
    />
  );
}

function GlobalPane() {
  const focused = useFocused();
  const page = usePage(api.globalFeed, {});
  const items = useMemo(() => page.items ?? [], [page.items]);
  const counts = useFeedCounts(items.map((e: any) => e.post?.id).filter(Boolean));
  const reposters = usePrincipalMap(items.map((e: any) => e.repostBy).filter(Boolean));
  return (
    <FlatList
      data={items}
      keyExtractor={(e: any) => e.id}
      initialNumToRender={30}
      maxToRenderPerBatch={30}
      windowSize={41}
      removeClippedSubviews={false}
      onEndReached={() => page.hasMore && page.loadMore()}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={focused ? <PostComposer /> : null}
      renderItem={({ item }: any) => (
        <FeedItem
          entry={item}
          counts={item.post ? counts[item.post.id] ?? ZeroCounts : ZeroCounts}
          reposterName={item.repostBy ? reposters[item.repostBy]?.displayName : undefined}
          reposterHandle={item.repostBy ? reposters[item.repostBy]?.handle : undefined}
        />
      )}
    />
  );
}

function TrendingItem({ item, index }: any) {
  const props = useFeedCardProps({ ...item, repostBy: null }, { ...ZeroCounts, likes: item.likes ?? 0 });
  if (!props) return null;
  return <TrendingRow rank={index + 1} post={props} />;
}

function TrendingPane() {
  const read = useQuery(api.trending, {});
  const data = readData<any[]>(read);
  if (!data) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  if (data.length === 0) return <TrendingEmpty />;
  return (
    <FlatList
      data={data}
      keyExtractor={(t: any) => t.id}
      renderItem={({ item, index }: any) => <TrendingItem item={item} index={index} />}
    />
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const { tab } = useFeedTab();
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ flex: 1 }}>
        {tab === "following" && <FollowingPane />}
        {tab === "global" && <GlobalPane />}
        {tab === "trending" && <TrendingPane />}
      </View>
      <Pressable
        onPress={() => router.push("/compose")}
        style={{ position: "absolute", right: 16, bottom: 72, backgroundColor: "#4F46E5", borderRadius: 28, width: 56, height: 56, alignItems: "center", justifyContent: "center" }}
        testID="sm-compose-open"
      >
        <Text style={{ color: "#fff", fontSize: 28 }}>＋</Text>
      </Pressable>
      <BottomNav />
    </View>
  );
}


