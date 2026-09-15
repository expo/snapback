import { useLocalSearchParams } from "expo-router";
import React, { useState, useEffect } from "react";
import { ScrollView, Text, RefreshControl } from "react-native";
import { usePage } from "snapback4/react";
import { FeedTabs, TrendingEmpty } from "../ui";
import { Shell, Button } from "../src/common";
import { api } from "../snapback/generated/api";
import { useApp } from "../src/session";
import { PostCard, PostComposer } from "../src/post";
function List({ tab }: { tab: "global" | "following" }) {
  const { items, hasMore, loadMore, read } = usePage(api.social[tab], {});
  return (
    <ScrollView
      onScroll={({ nativeEvent: e }) => {
        if (
          e.layoutMeasurement.height + e.contentOffset.y >=
            e.contentSize.height - 250 &&
          hasMore
        )
          loadMore();
      }}
      scrollEventThrottle={150}
    >
      <PostComposer />
      {items.map((item: any) => (
        <PostCard key={item.id} post={item.post} entry={item} />
      ))}
      {hasMore ? (
        <Button onPress={loadMore}>Load more</Button>
      ) : "denied" in read ? (
        <Text>{read.denied.message}</Text>
      ) : null}
    </ScrollView>
  );
}
function Trending() {
  const { client } = useApp();
  const [items, setItems] = useState<any[]>([]),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    const r = await client.query(api.analytics.trending, {});
    if ("data" in r) setItems(r.data);
    setBusy(false);
  }
  useEffect(() => {
    refresh();
  }, []);
  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} />}
    >
      <Button onPress={refresh}>Refresh trending</Button>
      {items.length ? (
        items.map((r, i) => <PostCard key={r.id} post={r.post} rank={i + 1} />)
      ) : (
        <TrendingEmpty />
      )}
    </ScrollView>
  );
}
export default function Feed() {
  const [tab, setTab] = useState<"following" | "global" | "trending">(
    "following",
  );
  const params = useLocalSearchParams<{ tab: string }>();
  useEffect(() => {
    if (
      params.tab === "global" ||
      params.tab === "following" ||
      params.tab === "trending"
    )
      setTab(params.tab);
  }, [params.tab]);
  return (
    <Shell>
      <FeedTabs active={tab} onChange={setTab} />
      {tab === "trending" ? <Trending /> : <List key={tab} tab={tab} />}
    </Shell>
  );
}
