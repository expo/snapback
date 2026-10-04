import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { usePathname } from "expo-router";
import { mintId } from "snapback4/client";
import { useMutation, usePage } from "snapback4/react";
import { Composer, TrendingEmpty } from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";
import { HiddenFileInput, VIDEO_POSTER, useUploader } from "./media";
import { PostCard } from "./PostCard";
import Chats from "./Chats";
import type { ComposerAttachment } from "@snapback-bench/social-ui";
import { getFeedTab, subscribeFeedTab } from "./feed-tab";

export default function Feed() {
  const tab = useSyncExternalStore(subscribeFeedTab, getFeedTab, getFeedTab);
  const pathname = usePathname();
  const focused = pathname === "/" || pathname === "/index";
  const home = usePage(api.home, {});
  const global = usePage(api.globalFeed, {});
  const trending = usePage(api.trending, {});
  const create = useMutation(api.createPost);
  const upload = useUploader();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [uploaded, setUploaded] = useState<{ kind: "image" | "video"; id: string }[]>([]);

  async function onFiles(files: File[]) {
    const next: ComposerAttachment[] = [];
    const placed: { kind: "image" | "video"; id: string }[] = [];
    for (const file of files) {
      const isVideo = file.type.startsWith("video");
      const asset = await upload(file);
      if (isVideo) {
        next.push({ kind: "video", uri: URL.createObjectURL(file), posterUri: VIDEO_POSTER });
        placed.push({ kind: "video", id: asset.id });
      } else {
        next.push({ kind: "image", uri: URL.createObjectURL(file) });
        placed.push({ kind: "image", id: asset.id });
      }
    }
    setAttachments(next);
    setUploaded(placed);
  }

  async function publish(text: string) {
    const images = uploaded.filter((item) => item.kind === "image").map((item) => ({ id: item.id }));
    const video = uploaded.find((item) => item.kind === "video");
    await create.run({
      id: mintId(),
      body: text,
      images: images.length ? images : null,
      video: video ? { id: video.id } : null,
    }, { waitSeconds: 0 });
    setDraft("");
    setAttachments([]);
    setUploaded([]);
  }

  const page = tab === "following" ? home : tab === "global" ? global : trending;
  useEffect(() => {
    if (page.hasMore && page.items.length < 80) page.loadMore();
  }, [tab, page.hasMore, page.items.length]);

  return (
    <View style={{ flex: 1 }}>
      <Chats />
      {focused ? <HiddenFileInput testID="sm-compose-file" accept="image/*,video/mp4" multiple onFiles={(files) => void onFiles(files)} /> : null}
      {focused ? <Composer
        variant="post"
        value={draft}
        onChangeText={setDraft}
        onSend={(text) => void publish(text)}
        maxLength={500}
        sending={create.inFlight}
        attachments={attachments}
        onRemoveAttachment={(index) => {
          setAttachments(attachments.filter((_, i) => i !== index));
          setUploaded(uploaded.filter((_, i) => i !== index));
        }}
        onPressAttach={() => {
          if (Platform.OS !== "web") return;
          const node = document.querySelector('[data-testid="sm-compose-file"]') as HTMLInputElement | null;
          node?.click();
        }}
      /> : null}
      {tab === "trending" && trending.items.length === 0 ? <TrendingEmpty /> : null}
      <ScrollView style={{ flex: 1 }} onScrollEndDrag={() => page.hasMore && page.loadMore()}>
        {page.items.map((item, index) => {
          if (tab === "trending") {
            const post = item as typeof trending.items[number];
            return (
              <View key={post.id} testID="sm-trending-row">
                <Text testID="sm-trending-rank">#{index + 1}</Text>
                <PostCard post={post} />
              </View>
            );
          }
          const event = item as typeof home.items[number];
          return (
            <PostCard
              key={`${event.repost}:${event.id}`}
              post={event.card}
              actor={event.actor}
              repostedBy={event.repost ? event.actor : undefined}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}
