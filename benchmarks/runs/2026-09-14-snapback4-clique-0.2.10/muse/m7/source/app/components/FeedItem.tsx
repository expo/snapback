import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { FeedCard } from "../../ui-kit/src/FeedCard";
import { useClient, useLink } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { fmtTime, useAssetUrl, captureVideoPoster } from "../../lib/helpers";

export interface Counts {
  likes: number;
  reposts: number;
  replies: number;
  likedByMe: boolean;
  repostedByMe: boolean;
}

export const ZeroCounts: Counts = { likes: 0, reposts: 0, replies: 0, likedByMe: false, repostedByMe: false };

export function usePostMedia(post: any): {
  imageUris?: string[];
  videoUri?: string;
  videoPosterUri?: string;
  imageAssetIds?: string[];
  videoAssetId?: string;
} {
  const u1 = useAssetUrl(post.img1?.id);
  const u2 = useAssetUrl(post.img2?.id);
  const u3 = useAssetUrl(post.img3?.id);
  const u4 = useAssetUrl(post.img4?.id);
  const clipUrl = useAssetUrl(post.clip?.id);
  const [poster, setPoster] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (post.kind === "video" && clipUrl) {
      captureVideoPoster(clipUrl).then((p) => {
        if (live) setPoster(p ?? undefined);
      });
    } else {
      setPoster(undefined);
    }
    return () => {
      live = false;
    };
  }, [clipUrl, post.kind]);
  if (post.kind === "video" && clipUrl) {
    return { videoUri: clipUrl, videoPosterUri: poster, videoAssetId: post.clip?.id };
  }
  const uris = [u1, u2, u3, u4].filter(Boolean) as string[];
  if (uris.length > 0) {
    const ids = [post.img1?.id, post.img2?.id, post.img3?.id, post.img4?.id].filter(Boolean) as string[];
    return { imageUris: uris, imageAssetIds: ids };
  }
  return {};
}

/** Resolve display profiles for a set of principals (reposters, senders). */
export function usePrincipalMap(principals: string[]): Record<string, any> {
  const client: any = useClient();
  const [map, setMap] = useState<Record<string, any>>({});
  useEffect(() => {
    let live = true;
    const uniq = [...new Set(principals.filter(Boolean))].slice(0, 20);
    if (uniq.length === 0) {
      setMap({});
      return;
    }
    (async () => {
      try {
        const r = await client.query(api.principalProfiles, { who: uniq });
        if (!live || (r as any).denied || !(r as any).data) return;
        const next: Record<string, any> = {};
        for (const row of (r as any).data as any[]) next[row.principal] = row;
        setMap(next);
      } catch {}
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, JSON.stringify([...new Set(principals.filter(Boolean))].slice(0, 20))]);
  return map;
}

export function useFeedCardProps(entry: any, counts: Counts, reposter?: any) {
  const router = useRouter();
  const client: any = useClient();
  const post = entry.post;
  // Feed entries join the post (which itself joins the author); thread and
  // profile screens pass the author alongside instead.
  const author = entry.author ?? post?.author;
  const media = usePostMedia(post ?? {});
  const avatarUri = useAssetUrl(author?.avatar?.id);
  const [busy, setBusy] = useState(false);
  // Optimistic toggle state: the counts poll refreshes every 2s, so a fast
  // second tap must act on the intended state, not the last polled one.
  const [optLike, setOptLike] = useState<boolean | null>(null);
  const [optRepost, setOptRepost] = useState<boolean | null>(null);
  const effLiked = optLike ?? counts.likedByMe;
  const effReposted = optRepost ?? counts.repostedByMe;
  useEffect(() => {
    if (optLike !== null && counts.likedByMe === optLike) setOptLike(null);
  }, [counts.likedByMe, optLike]);
  useEffect(() => {
    if (optRepost !== null && counts.repostedByMe === optRepost) setOptRepost(null);
  }, [counts.repostedByMe, optRepost]);
  const runToggle = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  if (!post) return null;
  const toggleLike = () => {
    const next = !effLiked;
    setOptLike(next);
    runToggle(async () => {
      const w = await client.mutate(api.likeSet, { postId: post.id, liked: next });
      if (w.state === "failed") setOptLike(null);
    });
  };
  const toggleRepost = () => {
    const next = !effReposted;
    setOptRepost(next);
    runToggle(async () => {
      const w = await client.mutate(api.repostSet, { postId: post.id, reposted: next });
      if (w.state === "failed") setOptRepost(null);
    });
  };
  const openThread = () => router.push({ pathname: "/thread/[id]", params: { id: post.id } });
  const openAuthor = () => {
    if (author?.handle) router.push({ pathname: "/profile/[handle]", params: { handle: author.handle } });
  };
  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };
  const openMedia = () => {
    if (media.imageAssetIds?.length) {
      router.push({ pathname: "/media", params: { asset: media.imageAssetIds[0], kind: "image" } });
    } else if (media.videoAssetId) {
      router.push({ pathname: "/media", params: { asset: media.videoAssetId, kind: "video" } });
    }
  };
  return {
    authorName: author?.displayName ?? "?",
    authorHandle: author?.handle,
    authorIdentity: author?.handle,
    authorAvatarUri: avatarUri ?? undefined,
    timestamp: fmtTime(post.at),
    text: post.body,
    likeCount: counts.likes + (effLiked && !counts.likedByMe ? 1 : !effLiked && counts.likedByMe ? -1 : 0),
    liked: effLiked,
    repostCount: counts.reposts + (effReposted && !counts.repostedByMe ? 1 : !effReposted && counts.repostedByMe ? -1 : 0),
    reposted: effReposted,
    replyCount: counts.replies,
    repostedByName: entry.repostBy ? reposter?.displayName ?? "Someone" : undefined,
    repostedByIdentity: entry.repostBy ? reposter?.handle : undefined,
    onPress: openThread,
    onPressLike: toggleLike,
    onPressRepost: toggleRepost,
    onPressReply: openThread,
    onPressAuthor: openAuthor,
    onPressLink: openLink,
    onPressMedia: openMedia,
    ...media,
  };
}

export function FeedItem({
  entry,
  counts,
  reposterName,
  reposterHandle,
}: {
  entry: any;
  counts: Counts;
  reposterName?: string;
  reposterHandle?: string;
}) {
  // Hide orphaned repost entries whose repost row is gone (unreposted).
  if (!entry.post) return null;
  if (entry.repostBy && !entry.rp) return null;
  return <FeedItemInner entry={entry} counts={counts} reposterName={reposterName} reposterHandle={reposterHandle} />;
}

function FeedItemInner({ entry, counts, reposterName, reposterHandle }: { entry: any; counts: Counts; reposterName?: string; reposterHandle?: string }) {
  const props = useFeedCardProps(entry, counts, reposterName ? { displayName: reposterName, handle: reposterHandle } : undefined);
  if (!props) return null;
  return <FeedCard {...props} />;
}

/** Batch counts for a list of post ids; polled live while online so remote
 * likes/reposts/replies update without the id set changing. */
export function useFeedCounts(postIds: string[]): Record<string, Counts> {
  const client: any = useClient();
  const link = useLink();
  const [map, setMap] = useState<Record<string, Counts>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (link !== "online") return;
    const t = setInterval(() => setTick((x) => x + 1), 2000);
    return () => clearInterval(t);
  }, [link]);
  useEffect(() => {
    let live = true;
    if (link !== "online" || postIds.length === 0) return;
    (async () => {
      try {
        const r = await client.query(api.feedCounts, { postIds: postIds.slice(0, 20) });
        if (!live || (r as any).denied || !(r as any).data) return;
        const next: Record<string, Counts> = {};
        for (const row of (r as any).data as any[]) {
          next[row.postId] = {
            likes: row.likes,
            reposts: row.reposts,
            replies: row.replies,
            likedByMe: row.likedByMe,
            repostedByMe: row.repostedByMe,
          };
        }
        setMap(next);
      } catch {}
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, link, tick, JSON.stringify(postIds.slice(0, 20))]);
  return map;
}

export function BottomNav() {
  const router = useRouter();
  const tabs = [
    { label: "Feed", path: "/feed" },
    { label: "Chats", path: "/" },
    { label: "Search", path: "/search" },
    { label: "Settings", path: "/settings" },
  ];
  return (
    <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: "#E2E4E8", backgroundColor: "#fff" }}>
      {tabs.map((t) => (
        <Pressable key={t.path} onPress={() => router.replace(t.path as any)} style={{ flex: 1, padding: 12, alignItems: "center" }}>
          <Text style={{ color: "#4F46E5", fontWeight: "600" }}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
