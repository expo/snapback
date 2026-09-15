import { ProfileForm } from "@snapback-bench/social-ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { mintId } from "snapback4/client";
import { useMutation, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "../../src/api.generated";
import { useAssetUrl } from "../../src/AssetMedia";
import { FeedItem } from "../../src/FeedItem";

export default function ProfileScreen(): React.JSX.Element {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const viewer = useViewer();
  const me = useQuery(api.me, {});
  const profile = useQuery(api.profileByHandle, { handle: (handle ?? "").toLowerCase() });
  const follow = useMutation(api.setFollow);
  const data = profile && !("loading" in profile) && !("denied" in profile) ? profile.data : null;
  const posts = usePage(api.profilePosts, data?.principal ? { who: data.principal } : { who: "none" });
  const avatar = useAssetUrl(data?.avatar?.id);
  const myHandle = me && !("loading" in me) && !("denied" in me) ? me.data?.handle : null;
  const isOwn = !!data && (data.principal === viewer || data.handle === myHandle);

  if (!data) return <View />;

  const insightsLink = isOwn ? (
    <Pressable onPress={() => router.push("/insights")} style={{ padding: 16 }}>
      <Text>Insights</Text>
    </Pressable>
  ) : null;

  const form = isOwn ? (
    <ProfileForm
      mode="view-own"
      displayName={data.displayName}
      handle={data.handle}
      avatarUri={avatar}
      bio={data.bio ?? undefined}
      location={data.location ?? undefined}
      link={data.link ?? undefined}
      followerCount={data.followers ?? 0}
      followingCount={data.following ?? 0}
      onPressEdit={() => router.push("/profile/edit")}
      onPressFeed={() => router.push("/feed")}
    />
  ) : (
    <ProfileForm
      mode="view-other"
      displayName={data.displayName}
      handle={data.handle}
      avatarUri={avatar}
      bio={data.bio ?? undefined}
      location={data.location ?? undefined}
      link={data.link ?? undefined}
      followerCount={data.followers ?? 0}
      followingCount={data.following ?? 0}
      following={!!data.followedByMe}
      onPressFollow={() =>
        void follow.run({ target: data.principal, on: !data.followedByMe, mutationId: mintId() })
      }
      onPressFeed={() => router.push("/feed")}
    />
  );

  return (
    <ScrollView>
      {form}
      {insightsLink}
      {(posts.items as any[]).map((item, i) => (
        <FeedItem
          key={item.id ?? String(i)}
          row={{
            post: item,
            author: { displayName: data.displayName, handle: data.handle, avatar: data.avatar },
            likes: item.likes,
            liked: item.liked,
            reposts: item.reposts,
            reposted: item.reposted,
            replies: item.replies,
          }}
          onReply={() => router.push(`/post/${item.id}`)}
        />
      ))}
    </ScrollView>
  );
}
