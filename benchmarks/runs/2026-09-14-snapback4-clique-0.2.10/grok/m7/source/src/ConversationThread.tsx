import { Composer, MessageBubble, PollCompose, ReactionPicker, TypingIndicator } from "@snapback-bench/social-ui";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { mintId } from "snapback4/client";
import { useClient, useMutation, useQuery, useViewer } from "snapback4/react";
import { api } from "./api.generated";
import { useAssetUrl } from "./AssetMedia";
import { WebFileButton } from "./WebFile";
import { PollMessage } from "./PollMessage";
import { formatTime, settle } from "./ops";

export function Thread({
  conversationId,
  title,
  isGroup,
  settingsHref,
}: {
  conversationId: string;
  title: string;
  isGroup: boolean;
  settingsHref?: string;
}): React.JSX.Element {
  const router = useRouter();
  const client = useClient();
  const viewer = useViewer();
  const pageQ = useQuery(api.threadMessages, { conversationId });
  const liveTyping = useQuery(api.typingIn, { conversationId });
  const conv = useQuery(api.conversation, { conversationId });
  const markRead = useMutation(api.markRead);
  const markDelivered = useMutation(api.markDelivered);
  const react = useMutation(api.setReaction);
  const edit = useMutation(api.editMessage);
  const del = useMutation(api.deleteMessage);
  const setTyping = useMutation(api.setTyping);
  const [draft, setDraft] = useState("");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [files, setFiles] = useState<File[]>([]);
  const [polledTyping, setPolledTyping] = useState<any[]>([]);
  const [polledMsgs, setPolledMsgs] = useState<any[] | null>(null);
  const [, setNowTick] = useState(0);
  const [typingOn, setTypingOn] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const queryItems = pageQ && !("loading" in pageQ) && !("denied" in pageQ) ? pageQ.data ?? [] : [];
  const items = polledMsgs ?? queryItems;

  useEffect(() => {
    void markRead.run({ conversationId });
  }, [conversationId, items.length, markRead]);

  useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const read = await client.query(api.threadMessages, { conversationId });
        if (!on) return;
        if (!("denied" in read) && !("loading" in read)) {
          const incoming = read.data ?? [];
          setPolledMsgs((prev) => {
            if (incoming.length === 0 && (prev?.length ?? 0) > 0) return prev;
            const ids = new Set(incoming.map((m: { id: string }) => m.id));
            const bodies = new Set(incoming.map((m: { body?: string }) => m.body).filter(Boolean));
            const extra = (prev ?? []).filter(
              (m: { id: string; body?: string }) => !ids.has(m.id) && !bodies.has(m.body),
            );
            return [...extra, ...incoming];
          });
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 400);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [client, conversationId]);

  const deliveredRef = useRef(new Set<string>());
  useEffect(() => {
    for (const msg of (items as any[]).slice(0, 8)) {
      if (msg.authorId === viewer || deliveredRef.current.has(msg.id)) continue;
      deliveredRef.current.add(msg.id);
      void markDelivered.run({ messageId: msg.id });
    }
  }, [items, viewer, markDelivered]);

  useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const read = await client.query(api.typingIn, { conversationId });
        if (!on) return;
        if (!("denied" in read) && !("loading" in read)) setPolledTyping(read.data ?? []);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 300);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [client, conversationId]);

  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(t);
  }, [items.length]);

  const bg = useAssetUrl(
    conv && !("loading" in conv) && !("denied" in conv) ? conv.data?.background?.id : undefined,
  );
  const typingRows =
    polledTyping.length > 0
      ? polledTyping
      : liveTyping && !("loading" in liveTyping) && !("denied" in liveTyping)
        ? liveTyping.data ?? []
        : [];
  const remoteTyping = typingRows.filter((t: any) => t.principal !== viewer);
  const untilKey = remoteTyping.map((t: any) => `${t.principal}:${t.until}`).join("|");
  const hideTyping = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!untilKey) return;
    if (hideTyping.current) return;
    setTypingOn(true);
    hideTyping.current = setTimeout(() => {
      setTypingOn(false);
      hideTyping.current = null;
    }, 3000);
  }, [untilKey]);
  const typingNames = typingOn
    ? remoteTyping.length
      ? remoteTyping.map((t: any) => t.profile?.displayName ?? "…")
      : ["…"]
    : [];

  async function onSend(text: string) {
    try {
      if (editId && text.trim()) {
        await settle(client, api.editMessage, { messageId: editId, body: text.trim() });
        setPolledMsgs((prev) =>
          (prev ?? []).map((m: any) => (m.id === editId ? { ...m, body: text.trim(), editedAt: Date.now() } : m)),
        );
        setEditId(null);
        return;
      }
      const messageId = mintId();
      if (text.trim() && !files.length) {
        setPolledMsgs((prev) => [
          {
            id: messageId,
            conversationId,
            authorId: viewer,
            body: text.trim(),
            at: Date.now(),
            deleted: false,
            quoteId,
            quote: quoteId
              ? (items as any[]).find((m) => m.id === quoteId) ?? { body: "", deleted: false }
              : null,
          },
          ...(prev ?? (items as any[])),
        ]);
      }
      if (files.length) {
        const file = files[0];
        const uploaded = await client.upload(file);
        if (!uploaded.ok) return;
        const isVideo = file.type.startsWith("video/");
        await settle(client, api.sendMedia, {
          messageId: mintId(),
          conversationId,
          kind: isVideo ? "video" : "image",
          photo: isVideo ? null : { id: uploaded.asset.id },
          clip: isVideo ? { id: uploaded.asset.id } : null,
          poster: null,
          caption: text || "",
          viewOnce: viewOnce && !isVideo,
        });
        setFiles([]);
        setViewOnce(false);
      } else if (text.trim()) {
        const write = await settle(client, api.sendMessage, {
          messageId,
          conversationId,
          body: text.trim(),
          quoteId: quoteId || null,
        });
        console.log("sendMessage", write.state, write.why, text.trim());
      }
    } finally {
      setDraft("");
      setQuoteId(null);
      setEditId(null);
    }
  }

  async function onCreatePoll(question: string, options: string[]) {
    const filled = options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
    if (question.trim().length === 0 || filled.length < 2) return;
    const messageId = mintId();
    const ids = filled.map(() => mintId());
    setPolledMsgs((prev) => [
      {
        id: messageId,
        conversationId,
        authorId: viewer,
        body: question.trim(),
        pollQuestion: question.trim(),
        at: Date.now(),
        deleted: false,
      },
      ...(prev ?? (items as any[])),
    ]);
    const write = await settle(client, api.createPoll, {
      messageId,
      conversationId,
      question: question.trim(),
      option1Id: ids[0],
      option1: filled[0],
      option2Id: ids[1],
      option2: filled[1],
      option3Id: ids[2] ?? null,
      option3: filled[2] ?? null,
      option4Id: ids[3] ?? null,
      option4: filled[3] ?? null,
    });
    if (write.state === "failed") {
      console.log("createPoll", write.state, write.why);
    }
    setShowPoll(false);
    setPollQuestion("");
    setPollOptions(["", ""]);
  }

  const seenBodies = new Set<string>();
  const messages = [...(items as any[])]
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .filter((m) => {
      const k = m.body || m.id;
      if (seenBodies.has(k)) return false;
      seenBodies.add(k);
      return true;
    });

  return (
    <View style={{ flex: 1, backgroundColor: bg ? undefined : "#fff" }}>
      <View style={{ padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Pressable onPress={() => router.back()}><Text>Back</Text></Pressable>
        <Text style={{ fontWeight: "700" }}>{title}</Text>
        <Pressable
          testID="sm-convo-settings"
          onPress={() =>
            router.push(
              settingsHref ??
                (isGroup
                  ? `/conversation/group/${encodeURIComponent(title)}/settings`
                  : `/conversation/${encodeURIComponent(title)}/settings`),
            )
          }
        >
          <Text>Settings</Text>
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {messages.map((item) => (
          <Bubble
            key={item.id}
            msg={item}
            mine={item.authorId === viewer}
            isGroup={isGroup}
            pollReceipts={item.authorId === viewer && item.id === messages.find((m) => m.authorId === viewer)?.id}
            accentColor={undefined}
            onReact={() => setPickerFor(item.id)}
            onQuote={() => setQuoteId(item.id)}
            onJump={() => {
              if (Platform.OS === "web" && item.quoteId && typeof document !== "undefined") {
                document.querySelector(`[data-message-id="${item.quoteId}"]`)?.scrollIntoView({ block: "center" });
              }
            }}
            onEdit={() => {
              setEditId(item.id);
              setDraft(item.body ?? "");
              if (Platform.OS === "web" && typeof document !== "undefined") {
                const el = document.querySelector('[data-testid="sm-convo-input"]') as HTMLTextAreaElement | null;
                if (el) el.value = item.body ?? "";
              }
            }}
            onDelete={() => void del.run({ messageId: item.id })}
          />
        ))}
      </ScrollView>
      {isGroup && showPoll ? (
        <PollCompose
          question={pollQuestion}
          options={pollOptions}
          onChangeQuestion={setPollQuestion}
          onChangeOption={(index, text) =>
            setPollOptions((prev) => prev.map((o, i) => (i === index ? text : o)))
          }
          onAddOption={() => setPollOptions((prev) => (prev.length < 4 ? [...prev, ""] : prev))}
          onRemoveOption={(index) =>
            setPollOptions((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev))
          }
          onSubmit={(q, opts) => void onCreatePoll(q, opts)}
        />
      ) : null}
      {pickerFor ? (
        <ReactionPicker
          onPick={(emoji) => {
            void react.run({ messageId: pickerFor, emoji, mutationId: mintId() });
            setPickerFor(null);
          }}
          onDismiss={() => setPickerFor(null)}
        />
      ) : null}
      <TypingIndicator visible={typingNames.length > 0} names={typingNames} />
      <WebFileButton testID="sm-convo-file" accept="image/*,video/mp4" onFiles={setFiles} />
      <Pressable
        testID="sm-convo-viewonce-toggle"
        onPress={() => setViewOnce((v) => !v)}
        style={{ paddingHorizontal: 12 }}
      >
        <Text>{viewOnce ? "View once on" : "View once off"}</Text>
      </Pressable>
      {isGroup ? (
        <Pressable
          onPress={() => setShowPoll((v) => !v)}
          style={{ paddingHorizontal: 12, paddingBottom: 8 }}
        >
          <Text>{showPoll ? "Cancel poll" : "Poll"}</Text>
        </Pressable>
      ) : null}
      {Platform.OS === "web" && typeof document !== "undefined" ? (
        <WebMessageBar
          value={draft}
          files={files}
          onChange={(t) => {
            setDraft(t);
            void setTyping.run({ conversationId });
          }}
          onSend={(t) => void onSend(t)}
          onAttach={() => (document.getElementById("sm-convo-file") as HTMLInputElement | null)?.click()}
        />
      ) : (
        <Composer
          variant="message"
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            void setTyping.run({ conversationId });
          }}
          onSend={(t) => void onSend(t)}
          onPressAttach={() => (document.getElementById("sm-convo-file") as HTMLInputElement | null)?.click()}
          attachments={files.map((f) =>
            f.type.startsWith("video/")
              ? { kind: "video" as const, uri: URL.createObjectURL(f), posterUri: "/poster.png" }
              : { kind: "image" as const, uri: URL.createObjectURL(f) },
          )}
        />
      )}
    </View>
  );
}

function WebMessageBar({
  value,
  files,
  onChange,
  onSend,
  onAttach,
}: {
  value: string;
  files: File[];
  onChange: (text: string) => void;
  onSend: (text: string) => void;
  onAttach: () => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 8,
        borderTop: "1px solid #E2E4E8",
        background: "#fff",
      }}
    >
      {files.length > 0 ? (
        <div style={{ display: "flex", gap: 8 }}>
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              data-testid="sm-compose-attachment"
              aria-valuetext={f.type.startsWith("video/") ? "video" : "image"}
            >
              {f.type.startsWith("video/") ? "video" : "image"} {f.name}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <button type="button" data-testid="sm-convo-attach" onClick={onAttach} aria-label="Attach media">
          ＋
        </button>
        <textarea
          data-testid="sm-convo-input"
          aria-label="Message text"
          defaultValue={value}
          onKeyDown={() => onChange((document.querySelector('[data-testid="sm-convo-input"]') as HTMLTextAreaElement | null)?.value ?? "")}
          onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          rows={2}
          style={{ flex: 1, minHeight: 36, fontSize: 16, padding: 8 }}
        />
        <button
          type="button"
          data-testid="sm-convo-send"
          aria-label="Send message"
          onClick={() => {
            const el = document.querySelector('[data-testid="sm-convo-input"]') as HTMLTextAreaElement | null;
            onSend(el?.value ?? value);
            if (el) el.value = "";
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

function Bubble({
  msg,
  mine,
  isGroup,
  pollReceipts,
  accentColor,
  onReact,
  onQuote,
  onJump,
  onEdit,
  onDelete,
}: {
  msg: any;
  mine: boolean;
  isGroup: boolean;
  pollReceipts?: boolean;
  accentColor?: string;
  onReact: () => void;
  onQuote: () => void;
  onJump: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const photo = useAssetUrl(msg.photo?.id);
  const poster = useAssetUrl(msg.poster?.id);
  const client = useClient();
  const reactionsQ = useQuery(api.messageReactions, { messageId: msg.id });
  const receiptsQ = useQuery(api.receiptsOf, { messageId: msg.id });
  const [polledReceipts, setPolledReceipts] = useState<any[] | null>(null);
  useEffect(() => {
    if (!pollReceipts) return;
    let on = true;
    const tick = async () => {
      try {
        const read = await client.query(api.receiptsOf, { messageId: msg.id });
        if (!on) return;
        if (!("denied" in read) && !("loading" in read)) setPolledReceipts(read.data ?? []);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 400);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [client, msg.id, pollReceipts]);
  const reactions =
    reactionsQ && !("loading" in reactionsQ) && !("denied" in reactionsQ)
      ? Object.values(
          (reactionsQ.data ?? []).reduce((acc: any, r: any) => {
            acc[r.emoji] = acc[r.emoji] || { emoji: r.emoji, count: 0, mine: false };
            acc[r.emoji].count += 1;
            return acc;
          }, {}),
        )
      : [];
  let receipt: "pending" | "sent" | "delivered" | "read" = msg.pending ? "pending" : "sent";
  const recs =
    polledReceipts ??
    (receiptsQ && !("loading" in receiptsQ) && !("denied" in receiptsQ) ? receiptsQ.data ?? [] : []);
  if (recs.length && recs.every((r: any) => r.readFlag)) receipt = "read";
  else if (recs.length && recs.every((r: any) => r.delivered)) receipt = "delivered";
  const inner = (
    <>
      <MessageBubble
        testID="sm-convo-error"
        isMine={mine}
        text={msg.deleted ? undefined : msg.body ?? undefined}
        deleted={!!msg.deleted}
        edited={!!msg.editedAt}
        mediaUri={photo ?? poster}
        mediaKind={msg.clip ? "video" : msg.photo || msg.photoOnce ? "image" : undefined}
        viewOnce={!!msg.photoOnce}
        viewOnceOpened={false}
        senderName={msg.author?.displayName}
        senderIdentity={msg.author?.handle}
        senderAvatarUri={useAssetUrl(msg.author?.avatar?.id)}
        showSender={isGroup && !mine}
        timestamp={formatTime(msg.at)}
        receipt={mine ? receipt : undefined}
        receiptPending={!!msg.pending}
        quote={
          msg.quote
            ? {
                senderName: msg.quote.author?.displayName ?? "Member",
                excerpt: msg.quote.deleted ? "Deleted" : msg.quote.body ?? "",
              }
            : undefined
        }
        onPressQuote={onJump}
        reactions={reactions as any}
        onPressReactionChip={onReact}
        onLongPress={onReact}
      />
      {msg.pollQuestion && !msg.deleted ? (
        <PollMessage messageId={msg.id} question={msg.pollQuestion} accentColor={accentColor} />
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12 }}>
        <Pressable testID="sm-convo-react" onPress={onReact}><Text>React</Text></Pressable>
        <Pressable testID="sm-convo-quote" onPress={onQuote}><Text>Reply</Text></Pressable>
        {mine ? <Pressable testID="sm-convo-edit" onPress={onEdit}><Text>Edit</Text></Pressable> : null}
        {mine ? <Pressable testID="sm-convo-delete" onPress={onDelete}><Text>Delete</Text></Pressable> : null}
      </View>
    </>
  );
  if (Platform.OS === "web" && typeof document !== "undefined") {
    return (
      <article data-testid="sm-convo-bubble" data-message-id={msg.id}>
        {msg.body ? <p>{msg.body}</p> : null}
        {inner}
      </article>
    );
  }
  return <View testID="sm-convo-bubble">{inner}</View>;
}
