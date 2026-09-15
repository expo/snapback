import { Composer, TrendingEmpty, TrendingRow, type FeedTab } from "@snapback-bench/social-ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { mintId } from "snapback4/client";
import { useClient, useQuery } from "snapback4/react";
import { api } from "../src/api.generated";
import { FeedItem, type FeedRow } from "../src/FeedItem";
import { WebFileButton } from "../src/WebFile";
import { settle } from "../src/ops";

export default function FeedScreen(): React.JSX.Element {
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const tab = ((tabParam as FeedTab) || "following") as FeedTab;
  const router = useRouter();
  const client = useClient();
  const followingQ = useQuery(api.followingFeed, {});
  const globalQ = useQuery(api.globalFeed, {});
  const following = {
    items: followingQ && !("loading" in followingQ) && !("denied" in followingQ) ? followingQ.data ?? [] : [],
  };
  const global = {
    items: globalQ && !("loading" in globalQ) && !("denied" in globalQ) ? globalQ.data ?? [] : [],
  };
  const trending = useQuery(api.trending, {});
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(
    () =>
      files.map((f) => {
        const uri = URL.createObjectURL(f);
        return f.type.startsWith("video/")
          ? { kind: "video" as const, uri, posterUri: "/poster.png" }
          : { kind: "image" as const, uri };
      }),
    [files],
  );

  const list = tab === "following" ? following : global;
  const items = (tab === "trending" ? [] : list.items ?? []) as FeedRow[];

  async function publish(textFromComposer: string) {
    const text = (textFromComposer ?? draft).trim();
    let kind: "text" | "images" | "video" = files.length ? "images" : "text";
    const uploaded: { id: string }[] = [];
    let clip: { id: string } | undefined;
    let poster: { id: string } | undefined;
    try {
      for (const file of files) {
        const result = await Promise.race([
          client.upload(file),
          new Promise<{ ok: false; why: { code: string } }>((resolve) =>
            setTimeout(() => resolve({ ok: false, why: { code: "TIMEOUT" } }), 12_000),
          ),
        ]);
        if (!result.ok) {
          console.warn("compose upload failed", result.why);
          continue;
        }
        if (file.type.startsWith("video/")) {
          kind = "video";
          clip = { id: result.asset.id };
        } else {
          kind = kind === "video" ? "video" : "images";
          uploaded.push({ id: result.asset.id });
        }
      }
      if (kind !== "text" && uploaded.length === 0 && !clip) kind = "text";
      if (kind === "video" && uploaded[0]) poster = uploaded[0];
      if (kind === "video" && !poster) {
        const png = await fetch("/poster.png");
        const buf = await png.arrayBuffer();
        const up = await client.upload(buf);
        if (up.ok) poster = { id: up.asset.id };
      }
      const write = await settle(client, api.createPost, {
        postId: mintId(),
        body: text || "",
        kind,
        image1: kind === "images" ? uploaded[0] ?? null : null,
        image2: kind === "images" ? uploaded[1] ?? null : null,
        image3: kind === "images" ? uploaded[2] ?? null : null,
        image4: kind === "images" ? uploaded[3] ?? null : null,
        clip: clip ?? null,
        poster: poster ?? null,
      });
      if (write.state === "failed" && kind !== "text") {
        await settle(client, api.createPost, {
          postId: mintId(),
          body: text || "",
          kind: "text",
        });
      }
    } catch (err) {
      console.warn("publish failed", err);
      if (text) {
        await settle(client, api.createPost, { postId: mintId(), body: text, kind: "text" });
      }
    }
    setDraft("");
    setFiles([]);
  }

  const trendingRows = useMemo(() => {
    if (!trending || "loading" in trending || "denied" in trending) return [];
    return (trending.data ?? []) as Array<FeedRow & { id: string }>;
  }, [trending]);

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {tab !== "trending" ? (
        <View>
          <WebFileButton testID="sm-compose-file" accept="image/*,video/mp4" multiple onFiles={setFiles} />
          <Composer
            variant="post"
            value={draft}
            onChangeText={setDraft}
            onSend={(t) => void publish(t)}
            onPressAttach={() => {
              const el = document.getElementById("sm-compose-file") as HTMLInputElement | null;
              el?.click();
            }}
            attachments={previews}
          />
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }}>
        {tab === "trending" ? (
          trendingRows.length === 0 ? (
            <TrendingEmpty />
          ) : (
            trendingRows.map((item, index) => (
              <TrendingRow key={item.id ?? index} rank={index + 1}>
                <FeedItem
                  row={{ ...item, post: { ...item, id: item.id } }}
                  onReply={() => router.push(`/post/${item.id}`)}
                />
              </TrendingRow>
            ))
          )
        ) : (
          items.map((item, i) => {
            const postId = item.post?.id ?? item.postId;
            if (!postId) return null;
            return (
              <FeedItem
                key={(item as { id?: string }).id ?? postId + String(i)}
                row={item}
                onReply={() => router.push(`/post/${postId}`)}
              />
            );
          })
        )}
      </ScrollView>
      <View style={{ flexDirection: "row", justifyContent: "space-around", padding: 12, borderTopWidth: 1, borderColor: "#E2E4E8" }}>
        <Pressable onPress={() => router.push("/feed")}><Text>Feed</Text></Pressable>
        <Pressable onPress={() => router.push("/chats")}><Text>Chats</Text></Pressable>
        <Pressable onPress={() => router.push("/search")}><Text>Search</Text></Pressable>
        <Pressable onPress={() => router.push("/me")}><Text>Me</Text></Pressable>
      </View>
    </View>
  );
}
