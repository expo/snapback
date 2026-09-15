import React, { useState } from "react";
import { FlatList, Linking, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ProfileForm } from "../../ui-kit/src/ProfileForm";
import { useClient, useQuery, useViewer, usePage } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { readData, useAssetUrl } from "../../lib/helpers";
import { BottomNav, FeedItem, ZeroCounts, useFeedCounts } from "../components/FeedItem";

export default function Profile() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const client: any = useClient();
  const viewer = useViewer();
  const profRead = useQuery(api.profileByHandle, { handle: handle! });
  const profile = readData<any>(profRead);
  const countsRead = useQuery(api.profileCounts, { handle: handle! });
  const counts = readData<any>(countsRead);
  const followRead = useQuery(api.followState, { handle: handle! });
  const following = readData<boolean>(followRead) ?? false;
  const posts = usePage(api.profilePosts, { handle: handle! });
  const items = posts.items ?? [];
  const postCounts = useFeedCounts(items.map((p: any) => p.id));
  const avatarUri = useAssetUrl(profile?.avatar?.id);
  const [error, setError] = useState<string | undefined>(undefined);
  if (profRead.denied) {
    return <View style={{ padding: 24 }}><Text testID="sm-profile-missing">No such user.</Text></View>;
  }
  if (!profile) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  const isMine = !!viewer && profile.principal === viewer;
  const toggleFollow = async () => {
    setError(undefined);
    const w = following
      ? await client.mutate(api.unfollowUser, { targetHandle: handle! })
      : await client.mutate(api.followUser, { targetHandle: handle! });
    if (w.state === "failed") setError(`Follow failed: ${w.why?.code ?? "unknown"}`);
  };
  const openFeed = () => router.push("/feed");
  const openLink = (url: string) => Linking.openURL(url).catch(() => {});
  const base = {
    displayName: profile.displayName,
    handle: profile.handle,
    avatarUri: avatarUri ?? undefined,
    bio: profile.bio ?? undefined,
    location: profile.location ?? undefined,
    link: profile.link ?? undefined,
    followerCount: counts?.followers ?? 0,
    followingCount: counts?.following ?? 0,
    onPressLink: openLink,
    onPressFeed: openFeed,
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <FlatList
        data={items}
        keyExtractor={(p: any) => p.id}
        onEndReached={() => posts.hasMore && posts.loadMore()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View>
            {isMine ? (
              <ProfileForm
                mode="view-own"
                {...base}
                onPressEdit={() => router.push("/profile/edit")}
              />
            ) : (
              <ProfileForm
                mode="view-other"
                {...base}
                following={following}
                onPressFollow={toggleFollow}
              />
            )}
            {isMine ? (
              <Pressable onPress={() => router.push("/insights")} style={{ padding: 12 }} testID="sm-profile-nav-insights">
                <Text style={{ color: "#4F46E5", fontWeight: "600" }}>View insights</Text>
              </Pressable>
            ) : null}
            {error ? <Text testID="sm-profile-error">{error}</Text> : null}
          </View>
        }
        renderItem={({ item }: any) => (
          <FeedItem entry={{ post: item, author: item.author }} counts={postCounts[item.id] ?? ZeroCounts} />
        )}
      />
      <BottomNav />
    </View>
  );
}
