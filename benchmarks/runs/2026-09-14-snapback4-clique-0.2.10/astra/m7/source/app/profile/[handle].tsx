import React from "react";
import { Text, ScrollView, Linking } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useAsset } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { ProfileForm } from "../../ui";
import { useApp } from "../../src/session";
import { PostCard } from "../../src/post";
import { Shell, Button } from "../../src/common";
export default function Profile() {
  const { client } = useApp();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const own = useQuery(api.me, {});
  const mine = "data" in own ? own.data : null;
  const r = useQuery(api.profile, {
    handle: handle === "me" ? (mine?.handle ?? "unknown") : handle,
  });
  const p = handle === "me" ? mine : "data" in r ? r.data : null;
  const counts = useQuery(api.social.counts, {
    principal: p?.principal ?? "unknown",
  });
  const countsData = "data" in counts ? counts.data : null;
  const posts = useQuery(api.social.author, {
    authorId: p?.principal ?? "unknown",
  });
  const avatar = useAsset(p?.avatar?.id);
  return (
    <Shell>
      <ScrollView>
        {p ? (
          <ProfileForm
            {...p}
            mode={p.principal === mine?.principal ? "view-own" : "view-other"}
            avatarUri={avatar.status === "ready" ? avatar.url : undefined}
            link={p.link ?? ""}
            followerCount={countsData?.followers ?? 0}
            followingCount={countsData?.following ?? 0}
            following={countsData?.followed ?? false}
            onPressFollow={() =>
              client.mutate(api.social.follow, {
                target: p.principal,
                set: !countsData?.followed,
              })
            }
            onPressEdit={() => router.push("/profile/edit")}
            onPressFeed={() => router.push("/")}
            onPressLink={Linking.openURL}
          />
        ) : (
          <Text>Profile not found</Text>
        )}
        {p?.principal === mine?.principal && (
          <Button
            testID="sm-profile-insights"
            onPress={() => router.push("/insights")}
          >
            Insights
          </Button>
        )}
        {"data" in posts &&
          posts.data.map((x) => <PostCard key={x.id} post={x} />)}
      </ScrollView>
    </Shell>
  );
}
