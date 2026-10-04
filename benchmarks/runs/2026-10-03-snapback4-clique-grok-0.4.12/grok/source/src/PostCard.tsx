import { Linking } from "react-native";
import { router } from "expo-router";
import { useAsset, useMutation, useQuery } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { FeedCard } from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";
import { VIDEO_POSTER } from "./media";
import type { Rows } from "../snapback/generated/api";

function useReadyUrl(id: string | null | undefined) {
  const asset = useAsset(id ?? null);
  return asset.status === "ready" ? asset.url : undefined;
}

export function PostCard({
  post,
  repostedBy,
  actor,
}: {
  post: Rows["posts"] | null | undefined;
  repostedBy?: string;
  actor?: string;
}) {
  if (!post) return null;
  return <LoadedPost post={post} repostedBy={repostedBy} actor={actor} />;
}

function LoadedPost({
  post,
  repostedBy,
  actor,
}: {
  post: Rows["posts"];
  repostedBy?: string;
  actor?: string;
}) {
  const author = useQuery(api.profileById, { principal: post.authorId });
  const state = useQuery(api.postState, { postId: post.id });
  const like = useMutation(api.setLike);
  const repost = useMutation(api.setRepost);
  const profile = isReady(author) ? author.data : null;
  const avatarUrl = useReadyUrl(profile?.avatar?.id);
  const img0 = useReadyUrl(post.images?.[0]?.id);
  const img1 = useReadyUrl(post.images?.[1]?.id);
  const img2 = useReadyUrl(post.images?.[2]?.id);
  const img3 = useReadyUrl(post.images?.[3]?.id);
  const imageUris = [img0, img1, img2, img3].filter((uri): uri is string => !!uri);
  const liked = isReady(state) ? state.data?.liked === true : false;
  const reposted = isReady(state) ? state.data?.reposted === true : false;
  const replyCount = isReady(state) ? state.data?.replies ?? 0 : 0;
  const repostCount = isReady(state) ? state.data?.reposts ?? 0 : 0;
  const actorProfile = useQuery(api.profileById, { principal: actor ?? post.authorId });
  const actorData = isReady(actorProfile) ? actorProfile.data : null;
  return (
    <FeedCard
      authorName={profile?.displayName ?? "…"}
      authorIdentity={profile?.handle}
      authorHandle={profile?.handle}
      authorAvatarUri={avatarUrl}
      timestamp={new Date(post.at).toLocaleString()}
      text={post.body}
      imageUris={imageUris.length ? imageUris : undefined}
      videoUri={post.video?.id}
      videoPosterUri={post.video ? VIDEO_POSTER : undefined}
      repostedByName={repostedBy && actorData ? actorData.displayName : undefined}
      repostedByIdentity={repostedBy && actorData ? actorData.handle : undefined}
      likeCount={post.likeCount}
      liked={liked}
      repostCount={repostCount}
      reposted={reposted}
      replyCount={replyCount}
      onPress={() => router.push({ pathname: "/post/[id]", params: { id: post.id } })}
      onPressLike={() => void like.run({ postId: post.id, liked: !liked })}
      onPressRepost={() => void repost.run({ postId: post.id, reposted: !reposted })}
      onPressReply={() => router.push({ pathname: "/post/[id]", params: { id: post.id } })}
      onPressAuthor={() => {
        if (profile?.handle) router.push({ pathname: "/profile/[handle]", params: { handle: profile.handle } });
      }}
      onPressLink={(href) => void Linking.openURL(href)}
    />
  );
}
