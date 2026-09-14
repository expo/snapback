import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { isReady, type Write } from "snapback4/contract";
import { useAsset, useClient, useLink, useMutation, useQuery } from "snapback4/react";
import { Composer, type ComposerAttachment } from "../ui/src/Composer";
import { MessageBubble } from "../ui/src/MessageBubble";
import { PollCompose } from "../ui/src/PollCompose";
import { PollDisplay } from "../ui/src/PollDisplay";
import { ReactionPicker } from "../ui/src/ReactionPicker";
import { TypingIndicator } from "../ui/src/TypingIndicator";
import { palette, spacing, typeScale } from "../ui/src/tokens";
import { api } from "../snapback/generated/api";
import { newId } from "../lib/ids";
import { accentHex, formatTime } from "../lib/format";
import { keyForOptionId, pollOptionsFromMessage, type PollOptionKey } from "../lib/polls";
import { useAuth, useMe } from "../lib/client";
import { FileInput } from "./FileInput";
import { MediaViewer } from "./MediaViewer";
import { useAssetUrl, VIDEO_POSTER } from "./AssetImage";
import { WebConvoSurface } from "./WebConvoSurface";
import type { LocalClient } from "snapback4/local";

type Receipt = "sent" | "delivered" | "read";

export function ConversationView({
  conversationId,
  title,
  settingsHref,
}: {
  conversationId: string;
  title: string;
  settingsHref: string;
}): React.ReactElement {
  const router = useRouter();
  const client = useClient();
  const me = useMe();
  const { session } = useAuth();
  const link = useLink();
  const principal = session?.principal ?? me?.principal;
  const thread = useQuery(api.threadMessages, { conversationId });
  const members = useQuery(api.membersOf, { conversationId });
  const receipts = useQuery(api.convReceipts, { conversationId });
  const recipients = useQuery(api.convRecipients, { conversationId });
  const reactions = useQuery(api.convReactions, { conversationId });
  const pollVotes = useQuery(api.convPollVotes, { conversationId });
  const typing = useQuery(api.typingIn, { conversationId });
  const chat = useQuery(api.inbox, {});
  const convDirect = useQuery(api.conversationOf, { conversationId });
  const send = useMutation(api.send);
  const sendMedia = useMutation(api.sendMedia);
  const createPoll = useMutation(api.createPoll);
  const voteMut = useMutation(api.setPollVote);
  const editMut = useMutation(api.editMessage);
  const delMut = useMutation(api.deleteMessage);
  const reactMut = useMutation(api.setReaction);
  const typingMut = useMutation(api.pingTyping);
  const markRead = useMutation(api.markRead);
  const markDelivered = useMutation(api.markDelivered);
  const clearUnreads = useMutation(api.clearUnreads);
  const openOnce = useMutation(api.openViewOnce);
  const [draft, setDraft] = useState("");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [viewOnce, setViewOnce] = useState(false);
  const [picked, setPicked] = useState<{ blob: Blob; kind: "image" | "video"; uri: string } | null>(null);
  const [viewer, setViewer] = useState<{ uri: string; kind: "image" | "video" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptionTexts, setPollOptionTexts] = useState<string[]>(["", ""]);
  const [pendingVotes, setPendingVotes] = useState<{ messageId: string; optionKey: PollOptionKey; writeId: string }[]>([]);
  type ThreadMsg = {
    id: string;
    body: string | null;
    caption: string | null;
    authorId: string;
    at: number;
    tombstoned: boolean;
    editedAt: number | null;
    pending?: boolean;
    photo?: { id: string } | null;
    photoOnce?: { id: string } | null;
    clip?: { id: string } | null;
    quoteId?: string | null;
    quote?: { authorId: string; body: string | null; caption: string | null } | null;
    question?: string | null;
    optionA?: string | null;
    optionB?: string | null;
    optionC?: string | null;
    optionD?: string | null;
    myVote?: { optionKey: PollOptionKey; pending?: boolean } | null;
  };
  const [locals, setLocals] = useState<ThreadMsg[]>([]);
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 400);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const local = client as LocalClient;
    if (typeof local.onWrite !== "function") return;
    return local.onWrite((write) => {
      if (write.state !== "pending") {
        setPendingVotes((cur) => cur.filter((v) => v.writeId !== write.id));
      }
    });
  }, [client]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const node = document.querySelector('[data-testid="sm-convo-input"]');
    if (!(node instanceof HTMLTextAreaElement) && !(node instanceof HTMLInputElement)) return;
    const sync = () => {
      const next = node.value;
      setDraft((cur) => (cur === next ? cur : next));
    };
    node.addEventListener("input", sync);
    node.addEventListener("change", sync);
    return () => {
      node.removeEventListener("input", sync);
      node.removeEventListener("change", sync);
    };
  }, [conversationId]);
  const scroll = useRef<View>(null);
  const serverItems: ThreadMsg[] = isReady(thread) ? thread.data : [];
  const convRow =
    (isReady(convDirect) ? convDirect.data : null) ??
    (isReady(chat) ? chat.data.find((row) => row.conversationId === conversationId)?.conversation : null);
  const accent = accentHex(convRow?.color);
  const merged = [
    ...locals.filter((l) => !serverItems.some((s) => s.id === l.id)),
    ...serverItems,
  ].sort((a, b) => a.at - b.at);
  const recent = merged.slice(-40);
  const extraLocals = locals.filter((l) => !recent.some((r) => r.id === l.id));
  const items = [...recent, ...extraLocals];

  useEffect(() => {
    void clearUnreads.run({ conversationId });
  }, [conversationId]);

  useEffect(() => {
    if (!principal) return;
    const stamp = () => {
      for (const msg of serverItems) {
        if (msg.authorId === principal) continue;
        void markDelivered.run({ messageId: msg.id });
        void markRead.run({ messageId: msg.id });
      }
    };
    stamp();
    const t1 = setTimeout(stamp, 400);
    const t2 = setTimeout(stamp, 1200);
    const t3 = setTimeout(stamp, 3000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [conversationId, principal, serverItems.map((m) => m.id).join(","), isReady(recipients) ? recipients.data.length : 0]);

  const memberMap = useMemo(() => {
    const map = new Map<string, { handle: string; displayName: string; avatar?: { id: string } | null; principal: string }>();
    if (isReady(members)) {
      for (const m of members.data) {
        if (m.profile) {
          map.set(m.principal, {
            handle: m.profile.handle,
            displayName: m.profile.displayName,
            avatar: m.profile.avatar,
            principal: m.principal,
          });
        }
      }
    }
    return map;
  }, [isReady(members) ? members.data : null]);

  const receiptOf = (messageId: string, authorId: string): Receipt => {
    if (!isReady(recipients) || !isReady(receipts) || !isReady(members)) return "sent";
    const memberSet = new Set(members.data.map((m) => m.principal));
    const needed = recipients.data.filter((r) => r.messageId === messageId && memberSet.has(r.principal));
    if (needed.length === 0) return "sent";
    const byP = new Map(
      receipts.data.filter((r) => r.messageId === messageId).map((r) => [r.principal, r.state]),
    );
    let allRead = true;
    let allDel = true;
    for (const r of needed) {
      const state = byP.get(r.principal);
      if (state !== "read") allRead = false;
      if (state !== "read" && state !== "delivered") allDel = false;
    }
    if (allRead) return "read";
    if (allDel) return "delivered";
    return "sent";
  };

  const voteCounts = (messageId: string) => {
    const counts: Record<PollOptionKey, number> = { a: 0, b: 0, c: 0, d: 0 };
    if (isReady(pollVotes)) {
      for (const vote of pollVotes.data) {
        if (vote.messageId === messageId) counts[vote.optionKey] += 1;
      }
    }
    return counts;
  };

  const pollView = (msg: ThreadMsg) => {
    if (!msg.question || msg.tombstoned) return null;
    const pending = pendingVotes.find((v) => v.messageId === msg.id);
    const myKey = (pending?.optionKey ?? msg.myVote?.optionKey ?? null) as PollOptionKey | null;
    const counts = voteCounts(msg.id);
    const options = pollOptionsFromMessage(msg).map((opt) => ({
      id: opt.id,
      label: opt.label,
      count: counts[opt.key],
      mine: myKey === opt.key,
      pending: pending?.optionKey === opt.key,
    }));
    return {
      messageId: msg.id,
      question: msg.question,
      options,
      total: options.reduce((n, o) => n + o.count, 0),
    };
  };

  const onVote = async (messageId: string, optionId: string) => {
    const key = keyForOptionId(optionId);
    if (!key) return;
    const tempId = newId("vote");
    setPendingVotes((cur) => [...cur.filter((v) => v.messageId !== messageId), { messageId, optionKey: key, writeId: tempId }]);
    const write = await voteMut.run({ messageId, optionKey: key });
    if (write.state === "pending") {
      setPendingVotes((cur) => cur.map((v) => (v.writeId === tempId ? { ...v, writeId: write.id } : v)));
      return;
    }
    setPendingVotes((cur) => cur.filter((v) => v.writeId !== tempId && v.writeId !== write.id));
    fail(write);
  };

  const onCreatePoll = async (question: string, options: string[]) => {
    const filled = options.map((o) => o.trim()).filter(Boolean);
    if (filled.length < 2) return;
    fail(
      await createPoll.run({
        messageId: newId("sm"),
        conversationId,
        question: question.trim(),
        optionA: filled[0],
        optionB: filled[1],
        optionC: filled[2] ?? null,
        optionD: filled[3] ?? null,
      }),
    );
    setShowPoll(false);
    setPollQuestion("");
    setPollOptionTexts(["", ""]);
  };

  const reactionSummary = (messageId: string) => {
    if (!isReady(reactions)) return [];
    const mine = new Map<string, number>();
    const mineFlag = new Map<string, boolean>();
    for (const r of reactions.data.filter((x) => x.messageId === messageId)) {
      mine.set(r.emoji, (mine.get(r.emoji) ?? 0) + 1);
      if (r.principal === principal) mineFlag.set(r.emoji, true);
    }
    return [...mine.entries()].map(([emoji, count]) => ({
      emoji,
      count,
      mine: !!mineFlag.get(emoji),
    }));
  };

  const typingOthers = isReady(typing)
    ? typing.data
        .filter((t) => t.principal !== principal && t.expiresAt > nowTs)
        .map((t) => memberMap.get(t.principal)?.displayName ?? "Someone")
    : [];

  const onChangeText = (text: string) => {
    setDraft(text);
    if (text.trim().length > 0) void typingMut.run({ conversationId });
  };

  const fail = (write: Write) => {
    if (write.state === "failed") setError(write.why.message || write.why.code);
  };

  const onSend = async (text: string) => {
    setError(null);
    if (editingId) {
      fail(await editMut.run({ messageId: editingId, body: text }));
      setEditingId(null);
      setDraft("");
      return;
    }
    if (picked) {
      const uploaded = await client.upload(picked.blob);
      if (!uploaded.ok) {
        setError(uploaded.why.message || uploaded.why.code);
        return;
      }
      const asset = { id: uploaded.asset.id };
      fail(
        await sendMedia.run({
          messageId: newId("sm"),
          conversationId,
          caption: text || "",
          photo: picked.kind === "image" && !viewOnce ? asset : null,
          photoOnce: picked.kind === "image" && viewOnce ? asset : null,
          clip: picked.kind === "video" ? asset : null,
        }),
      );
      setPicked(null);
      setAttachments([]);
      setViewOnce(false);
      setDraft("");
      return;
    }
    const messageId = newId("sm");
    setLocals((cur) => [
      ...cur,
      {
        id: messageId,
        body: text,
        caption: null,
        authorId: principal ?? "",
        at: Date.now(),
        tombstoned: false,
        editedAt: null,
        pending: true,
        photo: null,
        photoOnce: null,
        clip: null,
        quoteId,
        quote: null,
      },
    ]);
    fail(
      await send.run({
        messageId,
        conversationId,
        body: text,
        quoteId,
      }),
    );
    setQuoteId(null);
    setDraft("");
  };

  const quoteMsg = quoteId ? items.find((m) => m.id === quoteId) : null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Chat settings"
          onPress={() => router.push(settingsHref)}
          testID="sm-convo-settings"
        >
          <Text style={styles.gear}>⚙</Text>
        </Pressable>
      </View>
      {convRow?.background ? <Background id={convRow.background.id} /> : null}
      {Platform.OS === "web" ? (
        <WebConvoSurface
          conversationId={conversationId}
          items={items.map((msg) => ({
            id: msg.id,
            body: msg.body,
            caption: msg.caption,
            authorId: msg.authorId,
            tombstoned: msg.tombstoned,
            quoteId: msg.quoteId,
            quote: msg.quote
              ? {
                  senderName: memberMap.get(msg.quote.authorId)?.displayName ?? "Someone",
                  excerpt: msg.quote.body || msg.quote.caption || "media",
                }
              : null,
            poll: pollView(msg),
          }))}
          principal={principal}
          typingNames={typingOthers}
          receiptOf={(id) => {
            const row = items.find((m) => m.id === id);
            if (row?.pending && link !== "online") return "pending";
            return receiptOf(id, row?.authorId ?? "");
          }}
          onSend={(text) => void onSend(text)}
          onTyping={onChangeText}
          onQuote={(id) => setQuoteId(id)}
          onVote={(messageId, optionId) => void onVote(messageId, optionId)}
          onTogglePoll={() => setShowPoll((v) => !v)}
          showPollCompose={showPoll}
          isGroup={convRow?.kind === "group"}
        />
      ) : null}
      {Platform.OS === "web" ? null : (
      <View style={styles.listContent}>
        {items.map((msg) => {
          const author = memberMap.get(msg.authorId);
          const isMine = msg.authorId === principal;
          const quote = msg.quote
            ? {
                senderName: memberMap.get(msg.quote.authorId)?.displayName ?? "Someone",
                excerpt: msg.quote.body || msg.quote.caption || "media",
              }
            : undefined;
          return (
            <MessageRow
              key={msg.id}
              msg={msg}
              isMine={isMine}
              author={author}
              showSender={!isMine && (convRow?.kind === "group")}
              quote={quote}
              receipt={isMine ? receiptOf(msg.id, msg.authorId) : undefined}
              receiptPending={!!msg.pending && link !== "online"}
              reactions={reactionSummary(msg.id)}
              accent={accent}
              pickerOpen={pickerFor === msg.id}
              poll={pollView(msg)}
              onVote={(optionId) => void onVote(msg.id, optionId)}
              onQuote={() => setQuoteId(msg.id)}
              onPressQuote={() => undefined}
              onEdit={() => {
                setEditingId(msg.id);
                setDraft(msg.body || msg.caption || "");
              }}
              onDelete={() => void delMut.run({ messageId: msg.id })}
              onReact={() => setPickerFor(pickerFor === msg.id ? null : msg.id)}
              onPickReaction={(emoji) => {
                const mine = isReady(reactions)
                  ? reactions.data.find((r) => r.messageId === msg.id && r.principal === principal)
                  : null;
                const on = !(mine && mine.emoji === emoji);
                void reactMut.run({ messageId: msg.id, emoji, on });
                setPickerFor(null);
              }}
              onOpenOnce={async () => {
                await openOnce.run({ messageId: msg.id });
                const id = msg.photoOnce?.id;
                if (!id) return;
                const read = await client.asset(id);
                if ("denied" in read) {
                  setError(read.denied.message || read.denied.code);
                  return;
                }
                setViewer({ uri: read.url, kind: "image" });
              }}
              onMedia={(uri, kind) => setViewer({ uri, kind })}
            />
          );
        })}
        <TypingIndicator visible={typingOthers.length > 0} names={typingOthers} />
      </View>
      )}
      {quoteMsg ? (
        <Text style={styles.quoteBar}>Replying to {quoteMsg.body || quoteMsg.caption}</Text>
      ) : null}
      {error ? (
        <Text testID="sm-convo-error" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {showPoll && convRow?.kind === "group" ? (
        <View style={styles.pollCompose}>
          <PollCompose
            question={pollQuestion}
            options={pollOptionTexts}
            onChangeQuestion={setPollQuestion}
            onChangeOption={(index, text) =>
              setPollOptionTexts((cur) => cur.map((opt, i) => (i === index ? text : opt)))
            }
            onAddOption={() => setPollOptionTexts((cur) => (cur.length < 4 ? [...cur, ""] : cur))}
            onRemoveOption={(index) =>
              setPollOptionTexts((cur) => (cur.length > 2 ? cur.filter((_, i) => i !== index) : cur))
            }
            onSubmit={(question, options) => void onCreatePoll(question, options)}
          />
        </View>
      ) : null}
      <View>
        <FileInput
          testID="sm-convo-file"
          accept="image/*,video/mp4"
          onFile={(file) => {
            const kind = file.type.startsWith("video") ? "video" : "image";
            setPicked(file.blob ? { blob: file.blob, kind, uri: file.uri } : null);
            setAttachments(
              kind === "video"
                ? [{ kind: "video", uri: file.uri, posterUri: VIDEO_POSTER }]
                : [{ kind: "image", uri: file.uri }],
            );
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View once"
          onPress={() => setViewOnce((v) => !v)}
          testID="sm-convo-viewonce-toggle"
          style={styles.viewOnceToggle}
        >
          <Text>{viewOnce ? "View once on" : "View once"}</Text>
        </Pressable>
        {Platform.OS === "web" ? null : (
        <Composer
          variant="message"
          value={draft}
          onChangeText={onChangeText}
          onSend={(text) => void onSend(text)}
          maxLength={2000}
          attachments={attachments}
          onRemoveAttachment={() => {
            setAttachments([]);
            setPicked(null);
          }}
          onPressAttach={() => {
            /* FileInput is the web chooser */
          }}
        />
          )}
      </View>
      <MediaViewer
        uri={viewer?.uri ?? null}
        kind={viewer?.kind ?? null}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

function Background({ id }: { id: string }) {
  const url = useAssetUrl(id);
  if (!url) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
      {React.createElement("img", {
        src: url,
        style: { width: "100%", height: "100%", objectFit: "cover", opacity: 0.2 },
      })}
    </View>
  );
}

function MessageRow({
  msg,
  isMine,
  author,
  showSender,
  quote,
  receipt,
  receiptPending,
  reactions,
  accent,
  pickerOpen,
  poll,
  onVote,
  onQuote,
  onPressQuote,
  onEdit,
  onDelete,
  onReact,
  onPickReaction,
  onOpenOnce,
  onMedia,
}: {
  msg: {
    id: string;
    body: string | null;
    caption: string | null;
    tombstoned: boolean;
    editedAt: number | null;
    at: number;
    pending?: boolean;
    photo?: { id: string } | null;
    photoOnce?: { id: string } | null;
    clip?: { id: string } | null;
    quoteId?: string | null;
  };
  isMine: boolean;
  author?: { handle: string; displayName: string; avatar?: { id: string } | null };
  showSender: boolean;
  quote?: { senderName: string; excerpt: string };
  receipt?: Receipt;
  receiptPending?: boolean;
  reactions: { emoji: string; count: number; mine?: boolean }[];
  accent: string;
  pickerOpen: boolean;
  poll: {
    question: string;
    options: { id: string; label: string; count: number; mine?: boolean; pending?: boolean }[];
  } | null;
  onVote: (optionId: string) => void;
  onQuote: () => void;
  onPressQuote: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: () => void;
  onPickReaction: (emoji: string) => void;
  onOpenOnce: () => void;
  onMedia: (uri: string, kind: "image" | "video") => void;
}): React.ReactElement {
  const photo = useAssetUrl(msg.photo?.id);
  const clip = useAsset(msg.clip?.id ?? null);
  const avatar = useAssetUrl(author?.avatar?.id);
  const opened = useQuery(api.viewOnceOpened, { messageId: msg.photoOnce ? msg.id : "0" });
  const viewOnceOpened = !!msg.photoOnce && isReady(opened) && !!opened.data;
  const mediaKind = msg.clip ? "video" : msg.photo || msg.photoOnce ? "image" : undefined;
  const mediaUri = msg.clip ? VIDEO_POSTER : photo;
  return (
    <View nativeID={msg.id}>
      <MessageBubble
        isMine={isMine}
        text={msg.body || msg.caption || undefined}
        mediaUri={mediaUri}
        mediaKind={mediaKind}
        viewOnce={!!msg.photoOnce}
        viewOnceOpened={viewOnceOpened}
        senderName={author?.displayName}
        senderIdentity={author?.handle}
        senderAvatarUri={avatar}
        showSender={showSender}
        timestamp={formatTime(msg.at)}
        edited={!!msg.editedAt}
        deleted={msg.tombstoned}
        receipt={receipt}
        receiptPending={!!receiptPending}
        quote={quote}
        onPressQuote={onPressQuote}
        reactions={reactions}
        onPressReactionChip={(emoji) => onPickReaction(emoji)}
        onPressMedia={() => {
          if (msg.photoOnce) void onOpenOnce();
          else if (clip.status === "ready") onMedia(clip.url, "video");
          else if (photo) onMedia(photo, "image");
        }}
        onLongPress={onReact}
        onPressLink={(url) => void Linking.openURL(url)}
        accentColor={accent}
      />
      {poll ? (
        <PollDisplay
          question={poll.question}
          options={poll.options}
          onVote={(index) => {
            const option = poll.options[index];
            if (option) onVote(option.id);
          }}
          accentColor={accent}
        />
      ) : null}
      <View style={styles.actions}>
        <Pressable onPress={onQuote} testID="sm-convo-quote" accessibilityRole="button">
          <Text style={styles.action}>Reply</Text>
        </Pressable>
        <Pressable onPress={onReact} testID="sm-convo-react" accessibilityRole="button">
          <Text style={styles.action}>React</Text>
        </Pressable>
        {isMine && !msg.tombstoned ? (
          <>
            <Pressable onPress={onEdit} testID="sm-convo-edit" accessibilityRole="button">
              <Text style={styles.action}>Edit</Text>
            </Pressable>
            <Pressable onPress={onDelete} testID="sm-convo-delete" accessibilityRole="button">
              <Text style={styles.action}>Delete</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {pickerOpen ? <ReactionPicker onPick={onPickReaction} onDismiss={() => undefined} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    gap: spacing.md,
  },
  back: { ...typeScale.title, color: palette.primary },
  title: { ...typeScale.headline, color: palette.text, flex: 1 },
  gear: { ...typeScale.title, color: palette.text },
  list: { flex: 1 },
  listContent: { padding: spacing.md, gap: spacing.sm },
  quoteBar: { ...typeScale.footnote, color: palette.textMuted, paddingHorizontal: spacing.md },
  error: { ...typeScale.footnote, color: palette.danger, padding: spacing.md },
  viewOnceToggle: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  pollCompose: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10001,
    backgroundColor: palette.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    maxHeight: "70%",
  },
  actions: { flexDirection: "row", gap: spacing.md, paddingLeft: spacing.md },
  action: { ...typeScale.caption, color: palette.primary },
});
