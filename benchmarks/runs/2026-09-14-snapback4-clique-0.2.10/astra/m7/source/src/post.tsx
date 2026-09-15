import { randomUUID } from "expo-crypto";
import React, { useState } from "react";
import { View, Text, Linking, Modal, Image } from "react-native";
import { router } from "expo-router";
import * as Picker from "expo-image-picker";
import { useAsset } from "snapback4/react";
import { FeedCard, Composer, TrendingRow } from "../ui";
import { api } from "../snapback/generated/api";
import { useApp } from "./session";
import { Button } from "./common";
import { Video, poster } from "./media";
export function useURI(id?: string) {
  const a = useAsset(id);
  return a.status === "ready" ? a.url : undefined;
}
export function PostCard({
  post: p,
  entry,
  rank,
}: {
  post: any;
  entry?: any;
  rank?: number;
}) {
  const { client, setError } = useApp();
  const avatar = useURI(p?.author?.avatar?.id),
    a = useURI(p?.photo1?.id),
    b = useURI(p?.photo2?.id),
    c = useURI(p?.photo3?.id),
    d = useURI(p?.photo4?.id),
    v = useURI(p?.video?.id);
  const [show, setShow] = useState(false);
  if (!p) return null;
  async function intent(op: any, args: any) {
    const w = await client.mutate(op, args);
    if (w.state === "failed") setError(w.why.message);
  }
  const Card = (props: any) =>
    rank ? <TrendingRow rank={rank} post={props} /> : <FeedCard {...props} />;
  return (
    <View>
      <Card
        authorName={p.author?.displayName ?? "Account"}
        authorIdentity={p.author?.handle}
        authorHandle={p.author?.handle}
        authorAvatarUri={avatar}
        timestamp={new Date(p.at).toLocaleString()}
        text={p.text}
        imageUris={[a, b, c, d].filter(Boolean) as string[]}
        videoUri={v}
        videoPosterUri={v ? poster : undefined}
        likeCount={p.likeCount}
        liked={p.liked}
        repostCount={p.repostCount}
        reposted={p.reposted}
        replyCount={p.replyCount}
        repostedByName={entry?.repost ? entry.actor?.displayName : undefined}
        repostedByIdentity={entry?.repost ? entry.actor?.handle : undefined}
        onPressLike={() =>
          intent(api.social.like, { postId: p.id, set: !p.liked })
        }
        onPressRepost={() =>
          intent(api.social.repost, { postId: p.id, set: !p.reposted })
        }
        onPressReply={() => router.push("/post/" + p.id)}
        onPress={() => router.push("/post/" + p.id)}
        onPressAuthor={() => router.push("/profile/" + p.author?.handle)}
        onPressLink={Linking.openURL}
        onPressMedia={() => setShow(true)}
      />
      <Modal visible={show} transparent onRequestClose={() => setShow(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "#111e",
            justifyContent: "center",
            padding: 30,
          }}
        >
          <Button testID="sm-media-viewer-close" onPress={() => setShow(false)}>
            Close
          </Button>
          {v ? (
            <Video uri={v} />
          ) : (
            <Image
              testID="sm-media-viewer-image"
              source={{ uri: a }}
              style={{ height: 400, width: "100%" }}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </View>
  );
}
export function PostComposer({ parentId }: { parentId?: string }) {
  const { client, error, setError } = useApp();
  const [text, setText] = useState(""),
    [attachments, setAttachments] = useState<any[]>([]),
    [busy, setBusy] = useState(false);
  async function pick() {
    const r = await Picker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 4,
    });
    if (!r.canceled)
      setAttachments(
        r.assets.map((a) => ({
          kind: a.type === "video" ? "video" : "image",
          uri: a.uri,
          ...(a.type === "video" ? { posterUri: poster } : {}),
        })),
      );
  }
  async function send() {
    setBusy(true);
    setError("");
    try {
      const args: any = {
        postId: randomUUID(),
        text,
        kind:
          attachments[0]?.kind === "video"
            ? "video"
            : attachments.length
              ? "images"
              : "text",
        parentId: parentId ?? null,
      };
      if (
        attachments.some((a) => a.kind !== attachments[0].kind) ||
        (attachments[0]?.kind === "video" && attachments.length > 1)
      )
        throw Error("Choose images or one video");
      for (let i = 0; i < attachments.length; i++) {
        const u = await client.upload(
          await (await fetch(attachments[i].uri)).arrayBuffer(),
        );
        if (!u.ok) throw Error(u.why.message);
        args[attachments[i].kind === "video" ? "video" : "photo" + (i + 1)] = {
          id: u.asset.id,
        };
      }
      const w = await client.mutate(api.social.create, args);
      if (w.state === "failed") throw Error(w.why.message);
      setText("");
      setAttachments([]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <Composer
        variant="post"
        value={text}
        onChangeText={setText}
        onSend={send}
        onPressAttach={pick}
        attachments={attachments}
        onRemoveAttachment={(i) =>
          setAttachments(attachments.filter((_, j) => i !== j))
        }
        sending={busy}
      />
      {error ? <Text style={{ color: "red" }}>{error}</Text> : null}
    </View>
  );
}
