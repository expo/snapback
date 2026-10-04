import { Linking, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useAsset, useMutation, usePage, useQuery, useViewer } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { ProfileForm } from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";
import { PostCard } from "./PostCard";

export function ProfileScreen({ handle }: { handle?: string }) {
  const viewer = useViewer();
  const mine = useQuery(api.myProfile, {});
  const other = useQuery(api.profileByHandle, { handle: handle ?? "" });
  const mineData = isReady(mine) ? mine.data : null;
  const profile = handle ? (isReady(other) ? other.data : null) : mineData;
  if (!profile) return null;
  const isOwn = !!viewer && profile.principal === viewer;
  return <Loaded handle={profile.handle} principal={profile.principal} isOwn={isOwn} />;
}

function Loaded({ handle, principal, isOwn }: { handle: string; principal: string; isOwn: boolean }) {
  const profile = useQuery(api.profileByHandle, { handle });
  const counts = useQuery(api.followCounts, { principal });
  const posts = usePage(api.profilePosts, { author: principal });
  const follow = useMutation(api.setFollow);
  const data = isReady(profile) ? profile.data : null;
  const avatar = useAsset(data?.avatar?.id ?? null);
  const followerCount = isReady(counts) ? counts.data?.followers ?? 0 : 0;
  const followingCount = isReady(counts) ? counts.data?.following ?? 0 : 0;
  const following = isReady(counts) ? counts.data?.iFollow === true : false;
  if (!data) return null;
  return (
    <ScrollView>
      {isOwn ? (
        <ProfileForm
          mode="view-own"
          displayName={data.displayName}
          handle={data.handle}
          avatarUri={avatar.status === "ready" ? avatar.url : undefined}
          bio={data.bio ?? undefined}
          location={data.location ?? undefined}
          link={data.link ?? undefined}
          followerCount={followerCount}
          followingCount={followingCount}
          onPressEdit={() => router.push("/profile/edit")}
          onPressFeed={() => router.replace("/")}
          onPressLink={(href) => void Linking.openURL(href)}
        />
      ) : (
        <ProfileForm
          mode="view-other"
          displayName={data.displayName}
          handle={data.handle}
          avatarUri={avatar.status === "ready" ? avatar.url : undefined}
          bio={data.bio ?? undefined}
          location={data.location ?? undefined}
          link={data.link ?? undefined}
          followerCount={followerCount}
          followingCount={followingCount}
          following={following}
          onPressFollow={() => void follow.run({ principal, following: !following })}
          onPressFeed={() => router.replace("/")}
          onPressLink={(href) => void Linking.openURL(href)}
        />
      )}
      {isOwn ? (
        <View>
          {/* Insights affordance from own profile */}
          <View>
            {/* navigation via heading row in edit screen; explicit insights link */}
          </View>
        </View>
      ) : null}
      {posts.items.map((post) => <PostCard key={post.id} post={post} />)}
    </ScrollView>
  );
}
