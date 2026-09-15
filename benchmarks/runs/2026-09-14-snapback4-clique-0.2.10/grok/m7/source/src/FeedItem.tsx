import { FeedCard } from "@snapback-bench/social-ui";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { mintId } from "snapback4/client";
import { useAsset, useClient, useMutation, useQuery, useViewer } from "snapback4/react";
import { api } from "./api.generated";
import { countOf, formatTime } from "./ops";

export interface FeedPost {
  id: string;
  authorId: string;
  body?: string | null;
  kind?: string;
  image1?: { id: string } | null;
  image2?: { id: string } | null;
  image3?: { id: string } | null;
  image4?: { id: string } | null;
  clip?: { id: string } | null;
  poster?: { id: string } | null;
  at?: number;
  pending?: boolean;
}

export interface FeedRow {
  postId?: string;
  post?: FeedPost | null;
  actor?: { displayName: string; handle: string; avatar?: { id: string } | null; principal?: string } | null;
  author?: { displayName: string; handle: string; avatar?: { id: string } | null; principal?: string } | null;
  kind?: string;
  likes?: number | { value?: number } | null;
  liked?: boolean;
  reposts?: number | { value?: number } | null;
  reposted?: boolean;
  replies?: number | { value?: number } | null;
  at?: number;
}

function uriOf(asset: { status: string; url?: string }): string | undefined {
  return asset.status === "ready" ? asset.url : undefined;
}

export function FeedItem({
  row,
  onReply,
}: {
  row: FeedRow;
  onReply: () => void;
}): React.JSX.Element | null {
  const router = useRouter();
  const client = useClient();
  const viewer = useViewer();
  const likeMut = useMutation(api.setLike);
  const repostMut = useMutation(api.setRepost);
  const post = row.post;
  const author = row.author ?? row.actor;
  const likesQ = useQuery(api.likesOf, { postId: post?.id ?? "none" });
  const repostsQ = useQuery(api.repostsOf, { postId: post?.id ?? "none" });
  const repliesQ = useQuery(api.repliesOf, { postId: post?.id ?? "none" });
  const [polledLikes, setPolledLikes] = useState<Array<{ principal: string }> | null>(null);
  useEffect(() => {
    const postId = post?.id;
    if (!postId) return;
    let on = true;
    const tick = async () => {
      try {
        const read = await client.query(api.likesOf, { postId });
        if (on && !("denied" in read) && !("loading" in read)) setPolledLikes(read.data ?? []);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 250);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [client, post?.id]);
  const likes =
    polledLikes ??
    (likesQ && !("loading" in likesQ) && !("denied" in likesQ) ? likesQ.data ?? [] : null);
  const reposts =
    repostsQ && !("loading" in repostsQ) && !("denied" in repostsQ) ? repostsQ.data ?? [] : null;
  const replies =
    repliesQ && !("loading" in repliesQ) && !("denied" in repliesQ) ? repliesQ.data ?? [] : null;
  const avatar = useAsset(author?.avatar?.id);
  const img1 = useAsset(post?.image1?.id);
  const img2 = useAsset(post?.image2?.id);
  const img3 = useAsset(post?.image3?.id);
  const img4 = useAsset(post?.image4?.id);
  const poster = useAsset(post?.poster?.id);
  if (!post) return null;
  const images = [uriOf(img1), uriOf(img2), uriOf(img3), uriOf(img4)].filter((u): u is string => !!u);
  const handle = author?.handle ?? "user";
  const isRepost = row.kind === "repost";
  const likeCount = likes ? likes.length : countOf(row.likes);
  const repostCount = reposts ? reposts.length : countOf(row.reposts);
  const replyCount = replies ? replies.length : countOf(row.replies);
  const liked = likes ? likes.some((rowLike) => rowLike.principal === viewer) : !!row.liked;
  const reposted = reposts ? reposts.some((rowRepost) => rowRepost.principal === viewer) : !!row.reposted;
  return (
    <FeedCard
      authorName={author?.displayName ?? handle}
      authorIdentity={handle}
      authorHandle={handle}
      authorAvatarUri={uriOf(avatar)}
      timestamp={formatTime(post.at ?? row.at)}
      text={post.body ?? undefined}
      imageUris={post.kind === "images" ? images : undefined}
      videoUri={post.kind === "video" ? post.clip?.id ?? "video" : undefined}
      videoPosterUri={uriOf(poster) ?? (post.kind === "video" ? "/poster.png" : undefined)}
      repostedByName={isRepost ? row.actor?.displayName : undefined}
      repostedByIdentity={isRepost ? row.actor?.handle : undefined}
      likeCount={likeCount}
      liked={liked}
      repostCount={repostCount}
      reposted={reposted}
      replyCount={replyCount}
      onPressLike={() => void likeMut.run({ postId: post.id, on: !liked, mutationId: mintId() })}
      onPressRepost={() => void repostMut.run({ postId: post.id, on: !reposted, mutationId: mintId() })}
      onPressReply={onReply}
      onPressAuthor={() => router.push(`/profile/${handle}`)}
    />
  );
}
