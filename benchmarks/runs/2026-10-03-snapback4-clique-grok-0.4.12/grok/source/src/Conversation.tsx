import { existence, isReady } from "snapback4/contract";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Image, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { mintId } from "snapback4/client";
import { useAsset, useClient, useMutation, usePage, useQuery, useSeen, useViewer } from "snapback4/react";
import {
  Composer,
  MessageBubble,
  ReactionPicker,
  TypingIndicator,
  type ComposerAttachment,
  type ReceiptState,
} from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";
import { HiddenFileInput, VIDEO_POSTER, useUploader } from "./media";
import { useOnlineArm } from "./useOnlineArm";
import { useTyping } from "./useTyping";
import { useOnceMedia } from "./useOnceMedia";
import { url } from "./client";

function WebVideo({ testID, src }: { testID: string; src: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || !box.current) return;
    const el = document.createElement("video");
    el.src = src;
    el.controls = true;
    el.autoplay = true;
    el.muted = true;
    el.playsInline = true;
    el.style.width = "100%";
    box.current.appendChild(el);
    void el.play().catch(() => {});
    return () => { el.remove(); };
  }, [src]);
  return createElement("div", { ref: box, "data-testid": testID, testID });
}

export function ConversationScreen({
  conversation,
  visible = true,
  isGroup = false,
  groupTitle,
  peerHandle,
}: {
  conversation: string;
  visible?: boolean;
  isGroup?: boolean;
  groupTitle?: string;
  peerHandle?: string;
}) {
  const viewer = useViewer();
  const client = useClient();
  const online = useOnlineArm(url);
  const typing = useTyping(online, conversation);
  const room = useQuery(api.conversationScreen, { conversation });
  const member = useQuery(api.receiptMember, { conversation }, { keep: false });
  const history = usePage(api.history, { conversation });
  useEffect(() => {
    if (history.hasMore && history.items.length < 200) history.loadMore();
  }, [conversation, history.hasMore, history.items.length]);
  const decorations = usePage(api.messageReceipts, { conversation });
  const send = useMutation(api.send);
  const edit = useMutation(api.editMessage);
  const del = useMutation(api.deleteMessage);
  const react = useMutation(api.setReaction);
  const upload = useUploader();
  const once = useOnceMedia();
  const [draft, setDraft] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [uploaded, setUploaded] = useState<{ kind: "image" | "video"; id: string } | null>(null);
  const uploadedRef = useRef(uploaded);
  uploadedRef.current = uploaded;
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [viewerMedia, setViewerMedia] = useState<{ kind: "image" | "video"; url: string } | null>(null);
  const chat = isReady(room) ? room.data : null;
  const canSend = !(existence(member) === "denied" || (existence(member) === "absent" && isReady(member) && member.fresh && !member.revalidating));
  const visibleIds = useMemo(() => new Set(history.items.filter((m) => !m.pending).map((m) => m.id)), [history.items]);
  const through = Math.max(0, ...history.items.filter((m) => visibleIds.has(m.id) && !m.pending).map((m) => m.ordinal));
  useSeen(api.receiptFamilies.chat, { scope: conversation, through, active: visible });
  const receiptById = new Map(decorations.items.map((row) => [row.id, row.receipt]));
  const typingNames = isReady(typing.read) && Array.isArray(typing.read.data)
    ? typing.read.data.map((row) => row.principal)
    : [];

  async function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    const isVideo = file.type.startsWith("video") || file.name.endsWith(".mp4");
    const uri = URL.createObjectURL(file);
    setAttachments(isVideo
      ? [{ kind: "video", uri, posterUri: VIDEO_POSTER }]
      : [{ kind: "image", uri }]);
    const asset = await upload(file);
    setUploaded({ kind: isVideo ? "video" : "image", id: asset.id });
  }

  async function submit(text: string) {
    if (editing) {
      await edit.run({ message: editing, text });
      setEditing(null);
      setDraft("");
      return;
    }
    let media = uploadedRef.current;
    if (attachments.length && !media) {
      for (let i = 0; i < 50 && !media; i++) {
        await new Promise((r) => setTimeout(r, 100));
        media = uploadedRef.current;
      }
    }
    const id = mintId();
    await send.run({
      id,
      conversation,
      text,
      quote,
      photo: media && media.kind === "image" && !viewOnce ? { id: media.id } : null,
      clip: media && media.kind === "video" ? { id: media.id } : null,
      oncePhoto: media && media.kind === "image" && viewOnce ? { id: media.id } : null,
    }, { id, waitSeconds: 0 });
    setDraft("");
    setQuote(null);
    setAttachments([]);
    setUploaded(null);
    setViewOnce(false);
    typing.stop();
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, flexDirection: "row", justifyContent: "space-between" }}>
        <Text>{chat?.title ?? "Conversation"}</Text>
        {isGroup ? (
          <Pressable
            testID="sm-convo-settings"
            onPress={() => router.push({ pathname: "/conversation/group/[group]/settings", params: { group: groupTitle ?? chat?.title ?? conversation } })}
          >
            <Text>Settings</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="sm-convo-settings"
            onPress={() => router.push({ pathname: "/conversation/[handle]/settings", params: { handle: peerHandle ?? "bob" } })}
          >
            <Text>Settings</Text>
          </Pressable>
        )}
      </View>
      <HiddenFileInput testID="sm-convo-file" accept="image/*,video/mp4" onFiles={(files) => void onFiles(files)} />
      <Pressable
        testID="sm-convo-viewonce-toggle"
        onPress={() => setViewOnce(!viewOnce)}
        accessibilityState={{ selected: viewOnce }}
      >
        <Text>{viewOnce ? "View once on" : "View once"}</Text>
      </Pressable>
      <Composer
        variant="message"
        value={draft}
        onChangeText={(text) => { setDraft(text); typing.change(text); }}
        onSend={(text) => void submit(text)}
        maxLength={2000}
        sending={send.inFlight}
        attachments={attachments}
        onRemoveAttachment={() => { setAttachments([]); setUploaded(null); }}
        onPressAttach={() => {
          if (Platform.OS !== "web") return;
          const node = document.querySelector('[data-testid="sm-convo-file"]') as HTMLInputElement | null;
          node?.click();
        }}
      />
      <TypingIndicator visible={typingNames.length > 0} names={typingNames} />
      {pickerFor ? (
        <ReactionPicker
          onPick={(emoji) => {
            const current = null;
            void react.run({ message: pickerFor, emoji });
            setPickerFor(null);
          }}
          onDismiss={() => setPickerFor(null)}
        />
      ) : null}
      {once.view?.url ? (
        <View>
          <View testID="sm-media-viewer-image">
            <Image source={{ uri: once.view.url }} style={{ width: 240, height: 180 }} />
          </View>
          <Pressable testID="sm-media-viewer-close" onPress={once.close}><Text>Close</Text></Pressable>
        </View>
      ) : null}
      {viewerMedia ? (
        <View>
          {viewerMedia.kind === "video" && Platform.OS === "web"
            ? <WebVideo testID="sm-media-viewer-video" src={viewerMedia.url} />
            : (
            <Pressable testID="sm-media-viewer-image"><Text>image</Text></Pressable>
          )}
          <Pressable testID="sm-media-viewer-close" onPress={() => setViewerMedia(null)}><Text>Close</Text></Pressable>
        </View>
      ) : null}
      {once.view?.problem ? <Text testID="sm-convo-error">{once.view.problem}</Text> : null}
      <ScrollView style={{ flex: 1 }}>
        {[...history.items].slice().reverse().map((item) => (
          <Bubble
            key={item.id}
            message={item}
            isMine={item.sender === viewer}
            isGroup={isGroup}
            receipt={mapReceipt(receiptById.get(item.id), item.pending)}
            onQuote={() => setQuote(item.id)}
            onEdit={() => { setEditing(item.id); setDraft(item.text); }}
            onDelete={() => void del.run({ message: item.id })}
            onReact={() => setPickerFor(item.id)}
            onOpenOnce={() => item.oncePhoto && void once.open(item.oncePhoto.id)}
            onceOpened={once.view?.id === item.oncePhoto?.id && (!!once.view?.url || !!once.view?.problem)}
            onOpenMedia={(kind, assetId) => {
              void client.asset(assetId).then((result) => {
                if ("denied" in result) return;
                setViewerMedia({ kind, url: result.url });
              });
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function mapReceipt(value: string | null | undefined, pending?: boolean): { state?: ReceiptState; pending: boolean } {
  if (pending) return { pending: true };
  if (value === "delivered" || value === "read" || value === "sent") return { state: value, pending: false };
  return { pending: false, state: "sent" };
}

function Bubble({
  message,
  isMine,
  isGroup,
  receipt,
  onQuote,
  onEdit,
  onDelete,
  onReact,
  onOpenOnce,
  onceOpened,
  onOpenMedia,
}: {
  message: {
    id: string;
    text: string;
    sender: string;
    pending?: boolean;
    edited: boolean;
    tombstone: boolean;
    photo: { id: string } | null;
    clip: { id: string } | null;
    oncePhoto: { id: string } | null;
    quote: string | null;
  };
  isMine: boolean;
  isGroup: boolean;
  receipt: { state?: ReceiptState; pending: boolean };
  onQuote: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: () => void;
  onOpenOnce: () => void;
  onceOpened: boolean;
  onOpenMedia: (kind: "image" | "video", id: string) => void;
}) {
  const profile = useQuery(api.profileById, { principal: message.sender });
  const quoted = useQuery(api.quotedMessage, { message: message.id });
  const reactions = useQuery(api.messageReactions, { message: message.id });
  const sender = isReady(profile) ? profile.data : null;
  const avatar = useAsset(sender?.avatar?.id ?? null);
  const photo = useAsset(message.photo?.id ?? null);
  const chips = isReady(reactions) && Array.isArray(reactions.data)
    ? Object.values(reactions.data.reduce<Record<string, { emoji: string; count: number; mine: boolean }>>((acc, row) => {
      const cur = acc[row.emoji] ?? { emoji: row.emoji, count: 0, mine: false };
      cur.count += 1;
      return { ...acc, [row.emoji]: cur };
    }, {}))
    : [];
  const quoteRow = isReady(quoted) ? quoted.data : null;
  return (
    <View>
      <View testID="sm-convo-bubble" accessibilityLabel={message.text}>
      {message.text ? <Text>{message.text}</Text> : null}
      <MessageBubble
        testID="sm-convo-bubble-kit"
        isMine={isMine}
        text={message.tombstone ? undefined : message.text}
        mediaUri={message.clip ? VIDEO_POSTER : photo.status === "ready" ? photo.url : undefined}
        mediaKind={message.clip ? "video" : message.photo ? "image" : undefined}
        viewOnce={!!message.oncePhoto}
        viewOnceOpened={onceOpened}
        senderName={sender?.displayName}
        senderIdentity={sender?.handle}
        senderAvatarUri={avatar.status === "ready" ? avatar.url : undefined}
        showSender={isGroup && !isMine}
        edited={message.edited}
        deleted={message.tombstone}
        receipt={receipt.state}
        receiptPending={receipt.pending}
        quote={quoteRow ? { senderName: "Member", excerpt: quoteRow.text } : undefined}
        onPressQuote={() => {
          if (Platform.OS !== "web" || !quoteRow) return;
          const nodes = Array.from(document.querySelectorAll('[data-testid="sm-convo-bubble"]'));
          const target = nodes.find((node) => (node.textContent ?? "").includes(quoteRow.text));
          if (target && "scrollIntoView" in target) (target as HTMLElement).scrollIntoView({ block: "center" });
        }}
        reactions={chips}
        onPressReactionChip={(emoji) => void null}
        onPressMedia={() => {
          if (message.oncePhoto) onOpenOnce();
          else if (message.clip) onOpenMedia("video", message.clip.id);
          else if (message.photo) onOpenMedia("image", message.photo.id);
        }}
        onPressLink={(href) => void Linking.openURL(href)}
        onLongPress={onReact}
      />
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12 }}>
        <Pressable testID="sm-convo-quote" onPress={onQuote}><Text>Reply</Text></Pressable>
        <Pressable testID="sm-convo-react" onPress={onReact}><Text>React</Text></Pressable>
        {isMine ? <Pressable testID="sm-convo-edit" onPress={onEdit}><Text>Edit</Text></Pressable> : null}
        {isMine ? <Pressable testID="sm-convo-delete" onPress={onDelete}><Text>Delete</Text></Pressable> : null}
      </View>
      </View>
    </View>
  );
}
