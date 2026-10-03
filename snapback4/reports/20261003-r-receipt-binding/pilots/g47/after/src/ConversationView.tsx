import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { AppState, FlatList, Linking, Modal, Pressable, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { mintId } from "snapback4/client";
import { useAsset, useClient, useMutation, useQuery, useViewer } from "snapback4/react";
import {
  Composer,
  MessageBubble,
  ReactionPicker,
  TypingIndicator,
  type ComposerAttachment,
} from "../vendor/social-ui";
import { api } from "../snapback/generated/api";
import { formatTime } from "./format";
import { WebFileInput } from "./WebFile";
import { useReceipts } from "./useReceipts";
import { useAssetUrl } from "./AssetImage";

const VIDEO_POSTER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function ConversationView({
  conversationId,
  title,
  settingsHref,
}: {
  conversationId: string;
  title: string;
  settingsHref?: string;
}) {
  const router = useRouter();
  const client = useClient();
  const viewer = useViewer();
  const chat = useQuery(api.conversationScreen, { conversation: conversationId });
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => { const sub = AppState.addEventListener("change", state => setForeground(state === "active")); return () => sub.remove(); }, []);
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(() => new Set());
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { isViewable: boolean; item: { id: string } }[] }) => {
    setVisibleIds(new Set(viewableItems.filter(token => token.isViewable).map(token => token.item.id)));
  }, []);
  useEffect(() => { setVisibleIds(new Set()); }, [client, viewer, conversationId]);
  const page = useReceipts(conversationId, focused && foreground, visibleIds);
  const receipts = useQuery(api.messageReceipts, { conversation: conversationId });
  const typing = useQuery(api.typingIn, { conversation: conversationId }, { keep: true });
  const send = useMutation(api.send);
  const sendPhoto = useMutation(api.sendPhoto);
  const sendVideo = useMutation(api.sendVideo);
  const editMut = useMutation(api.editMessage);
  const setTyping = useMutation(api.setTyping);
  const stopTyping = useMutation(api.stopTyping);
  const background = useAssetUrl("data" in chat ? chat.data?.background?.id : null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<ComposerAttachment[]>([]);
  const [viewOnce, setViewOnce] = useState(false);
  const [quote, setQuote] = useState<{ id: string; senderName: string; excerpt: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const row = "data" in chat ? chat.data : null;
  const isGroup = row?.kind === "group";
  const receiptById = useMemo(() => {
    const map = new Map<string, string>();
    if ("data" in receipts) {
      for (const r of receipts.data ?? []) map.set(r.id, r.receipt);
    }
    return map;
  }, [receipts]);

  const submit = async (text: string) => {
    let body = text.trim();
    if (!body && typeof document !== "undefined") {
      const el = document.querySelector('[data-testid="sm-convo-input"]') as HTMLTextAreaElement | HTMLInputElement | null;
      if (el && typeof el.value === "string") body = el.value.trim();
    }
    try {
      if (editingId) {
        const write = await editMut.run({ messageId: editingId, text: body }, { id: mintId(), waitSeconds: 0 });
        if (write.state === "failed") setError(write.why.message);
        setEditingId(null);
        setDraft("");
        return;
      }
      const id = mintId();
      if (files.length === 1 && files[0].type.startsWith("video/")) {
        const uploaded = await client.upload(files[0]);
        if (!uploaded.ok) { setError(uploaded.why.message); return; }
        await sendVideo.run({
          conversation: conversationId,
          messageId: id,
          video: { id: uploaded.asset.id },
          caption: body || null,
        }, { id, waitSeconds: 0 });
      } else if (files.length > 0) {
        const uploaded = await client.upload(files[0]);
        if (!uploaded.ok) { setError(uploaded.why.message); return; }
        await sendPhoto.run({
          conversation: conversationId,
          messageId: id,
          photo: { id: uploaded.asset.id },
          caption: body || null,
          viewOnce,
        }, { id, waitSeconds: 0 });
      } else if (body) {
        const write = await send.run({
          conversation: conversationId,
          messageId: id,
          text: body,
          quote: quote?.id ?? null,
        }, { id, waitSeconds: 0 });
        if (write.state === "failed") setError(write.why.message);
      }
      setDraft("");
      setFiles([]);
      setPreviews([]);
      setQuote(null);
      setViewOnce(false);
      void stopTyping.run({ conversation: conversationId });
    } catch (err) {
      setError(String(err));
    }
  };

  const items = [...page.items].reverse();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onInput = (event: Event) => {
      const el = event.target as HTMLElement | null;
      if (!el || el.getAttribute?.("data-testid") !== "sm-convo-input") return;
      const value = "value" in el ? String((el as HTMLInputElement).value) : "";
      if (value) void setTyping.run({ conversation: conversationId });
      else void stopTyping.run({ conversation: conversationId });
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("keydown", onInput, true);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("keydown", onInput, true);
    };
  }, [conversationId, setTyping, stopTyping]);
  return (
    <View style={{ flex: 1, backgroundColor: background ? undefined : "#fff" }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 12, gap: 12 }}>
        <Pressable onPress={() => router.push("/")}><Text>Back</Text></Pressable>
        <Text style={{ fontWeight: "700", flex: 1 }}>{title}</Text>
        {settingsHref ? (
          <Pressable testID="sm-convo-settings" onPress={() => router.push(settingsHref)}>
            <Text>Settings</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        onViewableItemsChanged={onViewableItemsChanged}
        inverted
        style={{ flex: 1 }}
        data={items}
        initialNumToRender={200}
        maxToRenderPerBatch={200}
        windowSize={21}
        removeClippedSubviews={false}
        keyExtractor={(item) => item.id}
        onEndReached={page.hasMore ? page.loadMore : undefined}
        renderItem={({ item }) => (
          <Bubble
            message={item}
            mine={item.sender === viewer}
            receipt={receiptById.get(item.id)}
            showSender={!!isGroup}
            accent={row?.accent ?? undefined}
            onQuote={() => setQuote({
              id: item.id,
              senderName: item.sender,
              excerpt: (item.text ?? "").slice(0, 80),
            })}
            onJump={(id) => {
              if (typeof document === "undefined") return;
              document.querySelector(`[data-message-id="${id}"]`)?.scrollIntoView({ block: "center" });
            }}
            onPick={(id) => setPickerFor(id)}
            onEdit={() => {
              setEditingId(item.id);
              setDraft(item.text ?? "");
            }}
            onError={setError}
          />
        )}
      />
      <TypingIndicator
        visible={"data" in typing && (typing.data?.length ?? 0) > 0}
        names={"data" in typing ? (typing.data ?? []).map((t) => t.principal) : []}
      />
      {pickerFor ? (
        <ReactionStrip messageId={pickerFor} onDone={() => setPickerFor(null)} />
      ) : null}
      {quote ? (
        <Pressable onPress={() => setQuote(null)}>
          <Text style={{ paddingHorizontal: 12 }}>Replying to: {quote.excerpt}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        testID="sm-convo-viewonce-toggle"
        onPress={() => setViewOnce((v) => !v)}
        accessibilityState={{ selected: viewOnce }}
      >
        <Text style={{ paddingHorizontal: 12 }}>{viewOnce ? "View once on" : "View once off"}</Text>
      </Pressable>
      <WebFileInput
        testID="sm-convo-file"
        accept="image/*,video/mp4"
        onFiles={(picked) => {
          setFiles(picked);
          setPreviews(picked.map((file) => ({
            uri: file.type.startsWith("video/") ? VIDEO_POSTER : URL.createObjectURL(file),
            kind: file.type.startsWith("video/") ? "video" as const : "image" as const,
          })));
        }}
      />
      {error ? <Text testID="sm-convo-error">{error}</Text> : null}
      <Composer
        variant="message"
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          if (text) void setTyping.run({ conversation: conversationId });
          else void stopTyping.run({ conversation: conversationId });
        }}
        onSend={(text) => { void submit(text); }}
        maxLength={2000}
        attachments={previews}
        onPressAttach={() => {
          const el = typeof document !== "undefined"
            ? document.querySelector('[data-testid="sm-convo-file"]') as HTMLInputElement | null
            : null;
          el?.click();
        }}
      />
    </View>
  );
}

function ReactionStrip({ messageId, onDone }: { messageId: string; onDone: () => void }) {
  const react = useMutation(api.setReaction);
  const mine = useQuery(api.myReaction, { message: messageId });
  const selected = "data" in mine ? mine.data?.emoji : undefined;
  return (
    <View>
      <ReactionPicker
        selectedEmoji={selected}
        onPick={(emoji) => {
          const next = emoji === selected ? null : emoji;
          void react.run({ messageId, emoji: next }, { id: mintId(), waitSeconds: 0 });
          onDone();
        }}
        onDismiss={onDone}
      />
    </View>
  );
}

function Bubble({
  message,
  mine,
  receipt,
  showSender,
  accent,
  onQuote,
  onJump,
  onPick,
  onEdit,
  onError,
}: {
  message: {
    id: string;
    sender: string;
    text: string | null;
    photo: { id: string } | null;
    viewOncePhoto: { id: string } | null;
    video: { id: string } | null;
    quote: string | null;
    editedAt: number | null;
    tombstone: boolean;
    at: number;
    pending?: boolean;
  };
  mine: boolean;
  receipt?: string;
  showSender: boolean;
  accent?: string;
  onQuote: () => void;
  onJump: (id: string) => void;
  onPick: (id: string) => void;
  onEdit: () => void;
  onError: (text: string) => void;
}) {
  const sender = useQuery(api.profileByPrincipal, { owner: message.sender });
  const quoted = useQuery(api.quotedMessage, { message: message.id });
  const reactions = useQuery(api.messageReactions, { message: message.id });
  const photo = useAsset(message.viewOncePhoto ? null : message.photo?.id);
  const video = useAsset(message.video?.id);
  const avatar = useAsset("data" in sender ? sender.data?.avatar?.id : null);
  const [opened, setOpened] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerKind, setViewerKind] = useState<"image" | "video">("image");
  const client = useClient();
  const viewer = useViewer();
  const del = useMutation(api.deleteMessage);
  const react = useMutation(api.setReaction);
  const profile = "data" in sender ? sender.data : null;
  const quoteRow = "data" in quoted ? quoted.data : null;
  const quoteSender = useQuery(api.profileByPrincipal, { owner: quoteRow?.sender ?? message.sender });
  const quoteName = "data" in quoteSender ? quoteSender.data?.displayName : quoteRow?.sender;
  const chips = "data" in reactions
    ? Object.values((reactions.data ?? []).reduce<Record<string, { emoji: string; count: number; mine: boolean }>>((acc, row) => {
      const cur = acc[row.emoji] ?? { emoji: row.emoji, count: 0, mine: false };
      cur.count += 1;
      if (row.principal === viewer) cur.mine = true;
      acc[row.emoji] = cur;
      return acc;
    }, {}))
    : [];

  return (
    <View
      nativeID={message.id}
      {...({ "data-message-id": message.id } as object)}
    >
      <MessageBubble
        isMine={mine}
        text={message.tombstone ? undefined : message.text ?? undefined}
        mediaUri={photo.status === "ready" ? photo.url : video.status === "ready" ? video.url : undefined}
        mediaKind={message.video ? "video" : message.photo || message.viewOncePhoto ? "image" : undefined}
        viewOnce={!!message.viewOncePhoto}
        viewOnceOpened={opened}
        senderName={profile?.displayName}
        senderIdentity={profile?.handle}
        senderAvatarUri={avatar.status === "ready" ? avatar.url : undefined}
        showSender={showSender && !mine}
        timestamp={formatTime(message.at)}
        edited={!!message.editedAt}
        deleted={message.tombstone}
        receipt={receipt === "read" || receipt === "delivered" || receipt === "sent" ? receipt : (mine && !message.pending ? "sent" : undefined)}
        receiptPending={!!message.pending}
        accentColor={accent}
        quote={quoteRow ? {
          senderName: quoteName ?? "Member",
          excerpt: quoteRow.text ?? "",
        } : undefined}
        onPressQuote={quoteRow ? () => onJump(quoteRow.id) : undefined}
        reactions={chips}
        onPressReactionChip={() => {
          void react.run({ messageId: message.id, emoji: null }, { id: mintId(), waitSeconds: 0 });
        }}
        onPressMedia={async () => {
          if (message.viewOncePhoto) {
            if (opened) {
              onError("View-once photo already opened");
              return;
            }
            const result = await client.asset(message.viewOncePhoto.id);
            if ("denied" in result) {
              setOpened(true);
              onError(result.denied.message);
              return;
            }
            setOpened(true);
            setViewerKind("image");
            setViewerUrl(result.url);
            return;
          }
          if (photo.status === "ready") {
            setViewerKind("image");
            setViewerUrl(photo.url);
          }
          if (video.status === "ready") {
            setViewerKind("video");
            setViewerUrl(video.url);
          }
        }}
        onLongPress={() => onPick(message.id)}
        onPressLink={(href) => { void Linking.openURL(href); }}
      />
      <View style={{ flexDirection: "row", justifyContent: mine ? "flex-end" : "flex-start", gap: 8, paddingHorizontal: 12 }}>
        <Pressable testID="sm-convo-quote" onPress={onQuote}><Text>Reply</Text></Pressable>
        <Pressable testID="sm-convo-react" onPress={() => onPick(message.id)}><Text>React</Text></Pressable>
        {mine && !message.tombstone ? (
          <>
            <Pressable testID="sm-convo-edit" onPress={onEdit}><Text>Edit</Text></Pressable>
            <Pressable
              testID="sm-convo-delete"
              onPress={() => { void del.run({ messageId: message.id }, { id: mintId(), waitSeconds: 0 }); }}
            >
              <Text>Delete</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      <Modal visible={!!viewerUrl} onRequestClose={() => setViewerUrl(null)}>
        <Pressable testID="sm-media-viewer-close" onPress={() => setViewerUrl(null)} style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}>
          {viewerKind === "video"
            ? createElement("video", {
              src: viewerUrl ?? "",
              controls: true,
              autoPlay: true,
              playsInline: true,
              "data-testid": "sm-media-viewer-video",
              style: { maxWidth: "100%", maxHeight: "100%" },
            })
            : createElement("img", {
              src: viewerUrl ?? "",
              alt: "media",
              "data-testid": "sm-media-viewer-image",
              style: { maxWidth: "100%", maxHeight: "100%" },
            })}
        </Pressable>
      </Modal>
    </View>
  );
}
