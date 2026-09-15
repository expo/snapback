import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Composer, ComposerAttachment } from "../../ui-kit/src/Composer";
import { MessageBubble } from "../../ui-kit/src/MessageBubble";
import { PollBlock } from "../components/PollBlock";
import { TypingIndicator } from "../../ui-kit/src/TypingIndicator";
import { ReactionPicker } from "../../ui-kit/src/ReactionPicker";
import { PollCompose } from "../../ui-kit/src/PollCompose";
import { useClient, useLink, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { captureVideoPoster, fmtClock, readData, uploadFile, useAssetUrl } from "../../lib/helpers";
import { usePrincipalMap } from "../components/FeedItem";
import { accentHex } from "../chats";

function useMediaOf(message: any) {
  const photoUrl = useAssetUrl(message.photo?.id);
  const clipUrl = useAssetUrl(message.clip?.id);
  const [poster, setPoster] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (message.kind === "video" && clipUrl) {
      captureVideoPoster(clipUrl).then((p) => {
        if (live) setPoster(p ?? undefined);
      });
    } else setPoster(undefined);
    return () => {
      live = false;
    };
  }, [clipUrl, message.kind]);
  if (message.kind === "photo" && photoUrl) return { mediaUri: photoUrl, mediaKind: "image" as const };
  if (message.kind === "video" && clipUrl) return { mediaUri: poster ?? clipUrl, mediaKind: "video" as const, videoUrl: clipUrl };
  return {};
}

function MessageRow({
  message,
  conv,
  senders,
  aggregates,
  quotes,
  reactions,
  openedViews,
  replyTo,
  setReplyTo,
  editing,
  setEditing,
  pickerFor,
  setPickerFor,
  onError,
  scrollToId,
}: any) {
  const router = useRouter();
  const client: any = useClient();
  const viewer = useViewer();
  const isMine = message.authorId === viewer;
  const sender = senders[message.authorId];
  const media = useMediaOf(message);
  const agg = aggregates[message.id];
  const quote = message.quoteId ? quotes[message.quoteId] : null;
  const chips = reactions[message.id] ?? [];
  const isViewOnce = message.kind === "viewonce";
  const opened = !!openedViews[message.id];
  const [editText, setEditText] = useState(message.body ?? "");

  const openMedia = () => {
    if (isViewOnce && !opened && !isMine) {
      // Fetch-then-record: the viewer screen fetches the bytes first (still
      // allowed pre-view) and records the view once they land, because a
      // direct asset fetch after the view is refused server-side.
      router.push({ pathname: "/media", params: { asset: message.photoOnce?.id ?? "", once: "1", mid: message.id } });
      return;
    }
    if (isViewOnce && (opened || isMine)) {
      if (!isMine) {
        onError("View-once refused: ALREADY_VIEWED");
        return;
      }
    }
    const asset = message.photo?.id ?? message.clip?.id ?? (isViewOnce ? message.photoOnce?.id : null);
    if (!asset) return;
    router.push({ pathname: "/media", params: { asset, kind: message.kind === "video" ? "video" : "image" } });
  };

  const toggleReaction = async (emoji: string) => {
    const mine = chips.find((c: any) => c.mine);
    const next = mine?.emoji === emoji ? "none" : emoji;
    const w = await client.mutate(api.reactMessage, { messageId: message.id, emoji: next });
    if (w.state === "failed") onError(`Reaction failed: ${w.why?.code ?? "unknown"}`);
    setPickerFor(null);
  };

  const saveEdit = async () => {
    const w = await client.mutate(api.editMessage, { messageId: message.id, text: editText });
    if (w.state === "failed") onError(`Edit failed: ${w.why?.code ?? "unknown"}`);
    else setEditing(null);
  };

  const doDelete = async () => {
    const w = await client.mutate(api.deleteMessage, { messageId: message.id });
    if (w.state === "failed") onError(`Delete failed: ${w.why?.code ?? "unknown"}`);
  };

  const receiptState = message.pending ? "pending" : agg?.state ?? "sent";
  // M7 polls render the kit PollDisplay (question + votable options with
  // live tallies) instead of bubble text; tombstoned polls fall through to
  // the deleted bubble below so no stale option stays selectable.
  const isPoll = message.kind === "poll" && !message.tombstone;

  // The lane message actions must scope inside sm-convo-bubble, but the kit
  // bubble takes no children: the wrapper carries the contract ID and the
  // kit root keeps a lane-local ID. All kit-owned inner nodes are intact.
  return (
    <View testID="sm-convo-bubble">
      {isPoll ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
          {conv.kind === "group" && !isMine && sender ? (
            <Text style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>{sender.displayName}</Text>
          ) : null}
          <PollBlock
            pollId={message.id}
            fallbackQuestion={message.pollQuestion}
            accentColor={conv.color ? accentHex(conv.color) : undefined}
            onError={onError}
          />
        </View>
      ) : (
      <MessageBubble
        testID="sm-convo-bubble-card"
        isMine={isMine}
        text={message.tombstone ? undefined : message.body ?? undefined}
        timestamp={fmtClock(message.at)}
        senderName={sender?.displayName}
        senderIdentity={sender?.handle}
        showSender={conv.kind === "group" && !isMine}
        edited={!!message.editedAt}
        deleted={!!message.tombstone}
        receipt={isMine && !message.tombstone ? receiptState : undefined}
        receiptPending={!!message.pending}
        accentColor={conv.color ? accentHex(conv.color) : undefined}
        quote={
          quote
            ? {
                senderName: quote.author?.displayName ?? "?",
                excerpt: (quote.body ?? "").slice(0, 120),
              }
            : undefined
        }
        onPressQuote={quote ? () => scrollToId(message.quoteId) : undefined}
        reactions={chips.map((c: any) => ({ emoji: c.emoji, count: c.count, mine: c.mine }))}
        onPressReactionChip={toggleReaction}
        viewOnce={isViewOnce}
        viewOnceOpened={opened}
        onPressMedia={message.tombstone ? undefined : openMedia}
        onPressLink={(url) => Linking.openURL(url).catch(() => {})}
        {...media}
      />
      )}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 4 }}>
        <Pressable onPress={() => setPickerFor(pickerFor === message.id ? null : message.id)} testID="sm-convo-react">
          <Text>React</Text>
        </Pressable>
        <Pressable onPress={() => setReplyTo({ id: message.id, excerpt: (message.body ?? "").slice(0, 80), sender: sender?.displayName ?? "?" })} testID="sm-convo-quote">
          <Text>Reply</Text>
        </Pressable>
        {isMine && !message.tombstone ? (
          <>
            {!isPoll ? (
              <Pressable onPress={() => { setEditText(message.body ?? ""); setEditing(message.id); }} testID="sm-convo-edit">
                <Text>Edit</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={doDelete} testID="sm-convo-delete">
              <Text>Delete</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      {pickerFor === message.id ? (
        <ReactionPicker selectedEmoji={chips.find((c: any) => c.mine)?.emoji} onPick={toggleReaction} />
      ) : null}
      {editing === message.id ? (
        <View style={{ flexDirection: "row", paddingHorizontal: 12, gap: 8 }}>
          <TextInput value={editText} onChangeText={setEditText} style={{ flex: 1, borderWidth: 1, borderColor: "#ccc", padding: 6 }} testID="sm-convo-edit-input" />
          <Pressable onPress={saveEdit} testID="sm-convo-edit-save"><Text>Save</Text></Pressable>
        </View>
      ) : null}
      {replyTo?.id === message.id ? (
        <Pressable onPress={() => setReplyTo(null)} testID="sm-convo-quote-preview-active">
          <Text>Replying to: {replyTo.excerpt}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Owns the threadMessages page subscription and reports items up. Remounting
 * (via key) rebuilds the Pages binding, which recovers the live tail when a
 * watch snapshot stops refreshing after device syncs (one-shot reads stay
 * current while the subscribed page goes stale).
 */
/**
 * Identity-plus-content signature: ids alone drop in-place field updates
 * (edited bodies, delete-for-everyone tombstones), so the version covers
 * every mutable row field the thread renders.
 */
function threadSig(items: any[]): string {
  return items.map((m: any) => JSON.stringify([m.id, m.editedAt ?? 0, m.tombstone ? 1 : 0, m.body ?? null, m.pending ? 1 : 0])).join(",");
}

function ThreadSync({
  conversationId,
  onItems,
}: {
  conversationId: string;
  onItems: (items: any[], denied: boolean, hasMore: boolean, loadMore: () => void) => void;
}) {
  const page = usePage(api.threadMessages, { conversationId });
  const freshItems = useMemo(() => page.items ?? [], [page.items]);
  const denied = !!(page.read && (page.read as any).denied);
  // Retained history: once this conversation was readable, keep rendering
  // the last good items if access is later denied (a removed member keeps
  // local history while the server cuts off live updates). A conversation
  // that was never readable renders the fresh (empty/denied) state.
  const [frozen, setFrozen] = useState<any[]>([]);
  useEffect(() => {
    if (!denied && freshItems.length > 0) setFrozen(freshItems);
  }, [denied, freshItems]);
  const items = denied && frozen.length > 0 ? frozen : freshItems;
  const sig = threadSig(items);
  const hasMore = !!page.hasMore;
  const loadMore = page.loadMore;
  useEffect(() => {
    onItems(items, denied, hasMore, loadMore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, denied, hasMore, conversationId]);
  return null;
}

export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const client: any = useClient();
  const viewer = useViewer();
  const link = useLink();
  const [thread, setThread] = useState<{ items: any[]; denied: boolean; hasMore: boolean; loadMore: () => void }>({
    items: [],
    denied: false,
    hasMore: false,
    loadMore: () => {},
  });
  const [pageKey, setPageKey] = useState(0);
  const lastRemount = useRef(0);
  const staleStreak = useRef(0);
  const onItems = useCallback((items: any[], denied: boolean, hasMore: boolean, loadMore: () => void) => {
    setThread((prev) => {
      if (prev.denied === denied && prev.hasMore === hasMore && threadSig(prev.items) === threadSig(items)) return prev;
      return { items, denied, hasMore, loadMore };
    });
  }, []);
  const items = thread.items;
  // Offline outbox: device subscriptions serve the last remembered snapshot
  // while offline, so locally queued (pending) sends would be invisible
  // until reconnect. Echoes render the queued rows with pending receipts;
  // each echo retires as soon as the subscription carries the admitted row
  // (same author, same body, server timestamp at/after the echo).
  const [echoes, setEchoes] = useState<any[]>([]);
  useEffect(() => {
    setEchoes([]);
  }, [id]);
  const displayItems = useMemo(() => {
    const live = echoes.filter(
      (e: any) => !items.some((m: any) => m.authorId === e.authorId && (m.body ?? null) === (e.body ?? null) && (m.at ?? 0) >= e.at - 5000)
    );
    if (live.length !== echoes.length) setEchoes(live);
    return [...live, ...items];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [echoes, threadSig(items)]);
  const denied = thread.denied;
  const convRead = useQuery(api.inbox, {});
  const inbox = readData<any[]>(convRead) ?? [];
  const mine = inbox.find((m: any) => m.conversationId === id);
  const conv = mine?.conversation;
  const membersRead = useQuery(api.membersOf, { conversationId: id! });
  const members = readData<any[]>(membersRead) ?? [];
  const senders = usePrincipalMap(displayItems.map((m: any) => m.authorId));
  const bgUrl = useAssetUrl(conv?.background?.id);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
  // M7 poll composer: question + 2-4 options, sent as a poll message.
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollCreating, setPollCreating] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [files, setFiles] = useState<{ kind: "image" | "video"; file: File }[]>([]);
  const [aggregates, setAggregates] = useState<Record<string, any>>({});
  const inputRef = useRef<any>(null);
  const listRef = useRef<FlatList>(null);
  const idToIndex = useRef<Record<string, number>>({});

  const typingRead = useQuery(api.typingIn, { conversationId: id! });
  const typing = readData<any[]>(typingRead) ?? [];
  const typingNames = typing.map((t: any) => senders[t.principal]?.displayName ?? "Someone");
  const rxRead = useQuery(api.convoReactions, { conversationId: id! });
  const rxRows = readData<any[]>(rxRead) ?? [];
  const reactions = useMemo(() => {
    const byMsg: Record<string, any[]> = {};
    const counts: Record<string, Record<string, { count: number; mine: boolean }>> = {};
    for (const r of rxRows) {
      counts[r.messageId] = counts[r.messageId] ?? {};
      const e = counts[r.messageId][r.emoji] ?? { count: 0, mine: false };
      e.count += 1;
      if (r.principal === viewer) e.mine = true;
      counts[r.messageId][r.emoji] = e;
    }
    for (const [mid, em] of Object.entries(counts)) byMsg[mid] = Object.entries(em).map(([emoji, v]: any) => ({ emoji, ...v }));
    return byMsg;
  }, [rxRows, viewer]);
  const viewsRead = useQuery(api.myViews, { conversationId: id! });
  const views = readData<any[]>(viewsRead) ?? [];
  const openedViews = useMemo(() => Object.fromEntries(views.map((v: any) => [v.messageId, true])), [views]);
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const quoteIds = useMemo(() => [...new Set(displayItems.map((m: any) => m.quoteId).filter(Boolean))].slice(0, 50), [displayItems]);

  useEffect(() => {
    navigation.setOptions({
      title: conv ? (conv.kind === "dm" ? "Direct message" : conv.name ?? "Group") : "Conversation",
      headerRight: () => (
        <Pressable onPress={() => router.push({ pathname: "/chat/[id]/settings", params: { id: id! } })} testID="sm-convo-settings">
          <Text style={{ color: "#4F46E5", marginRight: 8 }}>Settings</Text>
        </Pressable>
      ),
    });
  }, [navigation, conv, id, router]);

  // Resolve quoted messages for excerpts.
  useEffect(() => {
    let live = true;
    if (quoteIds.length === 0) {
      setQuotes({});
      return;
    }
    (async () => {
      try {
        const r = await client.query(api.quotesFor, { msgIds: quoteIds });
        if (!live || (r as any).denied || !(r as any).data) return;
        setQuotes(Object.fromEntries(((r as any).data as any[]).map((q: any) => [q.id, q])));
      } catch {}
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, JSON.stringify(quoteIds)]);

  // Receipts: delivered when fetched, read while focused here.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  useEffect(() => {
    if (denied || link !== "online" || items.length === 0) return;
    client.mutate(api.markDelivered, { conversationId: id! }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, denied, link, id, items.length]);
  // Reading takes a beat: mark read a few seconds after new messages render
  // while focused, so the delivered state stays observable on senders' ticks.
  useEffect(() => {
    if (denied || link !== "online" || !focused || items.length === 0) return;
    const t = setTimeout(() => {
      client.mutate(api.markRead, { conversationId: id! }).catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, denied, link, id, focused, items.length]);

  // Live aggregates for my messages (server-run, polled while online so
  // recipient delivery/read advances the sender's ticks).
  const [aggTick, setAggTick] = useState(0);
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1") {
      // eslint-disable-next-line no-console
      console.log(`[thread-watchdog] state denied=${denied} link=${link} items=${items.length} aggTick=${aggTick}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [denied, link, items.length]);
  useEffect(() => {
    if (denied || link !== "online") return;
    const t = setInterval(() => setAggTick((x) => x + 1), 2000);
    return () => clearInterval(t);
  }, [denied, link]);
  useEffect(() => {
    let live = true;
    // NOTE: usePage(threadMessages) yields newest-first, so the newest mine
    // are at the head: slice(0, 20), not slice(-20) (which took the oldest).
    const mineIds = items.filter((m: any) => m.authorId === viewer && !m.pending).map((m: any) => m.id).slice(0, 20);
    if (denied || link !== "online" || mineIds.length === 0) return;
    (async () => {
      try {
        const r = await client.query(api.convoAggregates, { conversationId: id!, msgIds: mineIds });
        if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1") {
          // eslint-disable-next-line no-console
          console.log(`[agg-fetch] link=${link} ids=${mineIds.length} tail=${JSON.stringify(mineIds.slice(-3))} denied=${JSON.stringify((r as any)?.denied ?? null)} data=${JSON.stringify((r as any)?.data ?? null)}`);
        }
        if (!live || (r as any).denied || !(r as any).data) return;
        setAggregates((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const row of (r as any).data as any[]) {
            if (JSON.stringify(prev[row.messageId] ?? null) !== JSON.stringify(row)) changed = true;
            next[row.messageId] = row;
          }
          return changed ? next : prev;
        });
      } catch {}
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, link, id, viewer, aggTick, JSON.stringify(items.filter((m: any) => m.authorId === viewer).map((m: any) => m.id).slice(0, 20))]);

  // Stale-tail watchdog: one-shot threadMessages reads evaluate the device
  // on demand (always current), while the subscribed page can stop
  // refreshing after device syncs. Staleness is measured against what the
  // page actually holds (its row ids and max timestamp), never against a
  // one-shot watermark: a watermark learned during the mount grace absorbs
  // rows that arrive in that window, blinding the watchdog to exactly the
  // rows the frozen page then lacks. Only the initial-load grace (5s) skips
  // remediation. The list itself is not remounted, so there is no scroll jump.
  const mountedAt = useRef(Date.now());
  const mountSeq = useRef(0);
  useEffect(() => {
    mountedAt.current = Date.now();
    staleStreak.current = 0;
    mountSeq.current += 1;
    if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1") {
      // eslint-disable-next-line no-console
      console.log(`[thread-watchdog] mount #${mountSeq.current} id=${String(id)} pageKey=${pageKey}`);
    }
  }, [id, pageKey]);
  useEffect(() => {
    if (denied || link !== "online") return;
    let live = true;
    const debug = process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1";
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(`[thread-watchdog] tick aggTick=${aggTick} items=${items.length}`);
    }
    (async () => {
      try {
        const r = await client.query(api.threadMessages, { conversationId: id! });
        if (!live) return;
        if ((r as any).denied || !Array.isArray((r as any).data)) {
          // eslint-disable-next-line no-console
          if (debug) console.log(`[thread-watchdog] one-shot unusable denied=${JSON.stringify((r as any)?.denied ?? null)}`);
          return;
        }
        const rows = (r as any).data as any[];
        const pageIds = new Set(items.map((m: any) => m.id));
        const pageMax = items.reduce((m: number, x: any) => Math.max(m, x.at ?? 0), -1);
        let missing = 0;
        for (const x of rows) if (!pageIds.has(x.id) && (x.at ?? 0) >= pageMax) missing += 1;
        if (missing === 0) {
          staleStreak.current = 0;
          return;
        }
        if (Date.now() - mountedAt.current < 5000) {
          // eslint-disable-next-line no-console
          if (debug) console.log(`[thread-watchdog] ${missing} rows missing but within mount grace (age=${Date.now() - mountedAt.current}ms mount#${mountSeq.current})`);
          return;
        }
        staleStreak.current += 1;
        // eslint-disable-next-line no-console
        if (debug) console.log(`[thread-watchdog] stale proof ${staleStreak.current}/3, ${missing} rows missing (page=${pageIds.size} pageMax=${pageMax})`);
        if (staleStreak.current <= 2) return;
        if (Date.now() - lastRemount.current < 5000) return;
        lastRemount.current = Date.now();
        // eslint-disable-next-line no-console
        console.log(`[thread-watchdog] remount page, ${missing} new rows missing from subscribed tail`);
        setPageKey((k) => k + 1);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        if (debug) console.log(`[thread-watchdog] one-shot threw ${String(e?.message ?? e).slice(0, 100)}`);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, link, id, denied, aggTick]);

  const pingTyping = useCallback(() => {
    if (link !== "online") return;
    client.mutate(api.typingPing, { conversationId: id! }).catch(() => {});
  }, [client, link, id]);
  const lastPing = useRef(0);
  const onChangeText = (t: string) => {
    setText(t);
    const now = Date.now();
    if (now - lastPing.current > 2000) {
      lastPing.current = now;
      pingTyping();
    }
  };

  // Live-tail follow: a conversation opens at the newest messages and
  // sticks to the bottom while the viewer stays pinned there, so inbound
  // messages arrive in view. Scrolling up unpins (history reading is never
  // yanked); scrolling back to the bottom re-pins.
  const pinned = useRef(true);
  const firstLoad = useRef(true);
  useEffect(() => {
    pinned.current = true;
    firstLoad.current = true;
  }, [id]);
  // Pin = viewer intent, changed only by explicit user gestures. Geometry
  // during layout storms (pagination landing mid-scroll) must never unpin:
  // a stale measurement would strand the live tail outside the render
  // window with nothing left to correct it. Scroll events only re-pin.
  const unpin = useCallback(() => {
    pinned.current = false;
  }, []);
  const onListScroll = useCallback((e: any) => {
    try {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const dist = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (dist < 120) pinned.current = true;
    } catch {}
  }, []);
  // Geometry-settled follow: data updates and pagination change content size
  // asynchronously; scrolling only on data identity can land on a stale
  // measurement and strand the tail outside the render window with nothing
  // left to correct it (fatal while offline). Re-pin on every settled
  // layout while the viewer stays at the bottom.
  const onListContentSizeChange = useCallback(() => {
    if (pinned.current) {
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch {}
    }
  }, []);
  const newestId = displayItems.length > 0 ? (displayItems[0] as any).id : null;
  useEffect(() => {
    if (!newestId || displayItems.length === 0) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      pinned.current = true;
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch {}
      return;
    }
    if (pinned.current) {
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, displayItems.length]);

  const scrollToId = (mid: string) => {
    const idx = idToIndex.current[mid];
    if (idx != null) {
      try {
        listRef.current?.scrollToIndex({ index: displayItems.length - 1 - idx, animated: true });
      } catch {}
    }
  };

  const pick = () => inputRef.current?.click?.();
  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    const f = list[0];
    if (!f) return;
    const isVideo = f.type.startsWith("video/");
    const url = URL.createObjectURL(f);
    if (isVideo) {
      const poster = (await captureVideoPoster(url)) ?? url;
      setAttachments([{ kind: "video", uri: url, posterUri: poster }]);
    } else {
      setAttachments([{ kind: "image", uri: url }]);
    }
    setFiles([{ kind: isVideo ? "video" : "image", file: f }]);
  };

  const send = async (body: string) => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      let w;
      if (files.length > 0) {
        const f = files[0];
        const assetId = await uploadFile(client, f.file);
        w = await client.mutate(api.sendMedia, {
          conversationId: id!,
          mediaKind: f.kind,
          photo: f.kind === "image" ? { id: assetId } : null,
          clip: f.kind === "video" ? { id: assetId } : null,
          caption: body || null,
          viewOnce: viewOnce && f.kind === "image",
        });
      } else {
        const s = Date.now();
        w = await client.mutate(api.sendText, {
          conversationId: id!,
          body,
          quoteId: replyTo?.id ?? null,
        });
        if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1") {
          // eslint-disable-next-line no-console
          console.log(`[member-debug] sendText invoke@${s} resolved@${Date.now()} -> ${w.state}`);
        }
      }
      if (w.state === "failed") {
        setError(`Send failed: ${w.why?.code ?? "unknown"}`);
      } else {
        if (w.state === "pending" && files.length === 0) {
          setEchoes((prev) => [
            {
              id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              conversationId: id!,
              authorId: viewer,
              kind: "text",
              body,
              quoteId: replyTo?.id ?? null,
              tombstone: false,
              pending: true,
              at: Date.now(),
            },
            ...prev,
          ]);
        }
        setText("");
        setFiles([]);
        setAttachments([]);
        setReplyTo(null);
        setViewOnce(false);
      }
    } catch (err: any) {
      setError(`Send failed: ${err?.message ?? err}`);
    } finally {
      setSending(false);
    }
  };

  displayItems.forEach((m: any, i: number) => {
    idToIndex.current[m.id] = i;
  });

  const submitPoll = async (question: string, options: string[]) => {
    const labels = options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (pollCreating || question.trim().length === 0 || labels.length < 2) return;
    setPollCreating(true);
    setError(null);
    try {
      const stamp = Date.now().toString(36);
      const w = await client.mutate(api.createPoll, {
        conversationId: id!,
        question: question.trim().slice(0, 200),
        optionIds: labels.map((_, i) => `po-${stamp}-${i}`),
        labels: labels.map((l) => l.slice(0, 50)),
      });
      if (w.state === "failed") {
        setError(`Poll failed: ${w.why?.code ?? "unknown"}`);
      } else {
        setShowPoll(false);
        setPollQuestion("");
        setPollOptions(["", ""]);
      }
    } catch (err: any) {
      setError(`Poll failed: ${err?.message ?? err}`);
    } finally {
      setPollCreating(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {bgUrl ? (
        <Image source={{ uri: bgUrl }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.25 }} />
      ) : null}
      <TypingIndicator visible={typing.length > 0} names={typingNames} />
      {error ? <Text testID="sm-convo-error">{error}</Text> : null}
      <ThreadSync key={`${id}:${pageKey}`} conversationId={id!} onItems={onItems} />
      <FlatList
        ref={listRef}
        data={[...displayItems].reverse()}
        keyExtractor={(m: any) => m.id}
        initialNumToRender={30}
        maxToRenderPerBatch={30}
        windowSize={41}
        removeClippedSubviews={false}
        onScroll={onListScroll}
        onContentSizeChange={onListContentSizeChange}
        onTouchStart={unpin}
        {...( { onWheel: unpin } as any )}
        scrollEventThrottle={200}
        onEndReached={() => thread.hasMore && thread.loadMore()}
        onEndReachedThreshold={0.5}
        renderItem={({ item }: any) => (
          <MessageRow
            message={item}
            conv={conv ?? { kind: "dm" }}
            senders={senders}
            aggregates={aggregates}
            quotes={quotes}
            reactions={reactions}
            openedViews={openedViews}
            replyTo={replyTo}
            setReplyTo={setReplyTo}
            editing={editing}
            setEditing={setEditing}
            pickerFor={pickerFor}
            setPickerFor={setPickerFor}
            onError={setError}
            scrollToId={scrollToId}
          />
        )}
      />
      {replyTo ? (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable onPress={() => scrollToId(replyTo.id)} testID="sm-convo-quote-preview" style={{ flex: 1 }}>
            <Text>Replying to {replyTo.sender}: {replyTo.excerpt}</Text>
          </Pressable>
          <Pressable onPress={() => setReplyTo(null)} accessibilityLabel="Cancel reply">
            <Text>×</Text>
          </Pressable>
        </View>
      ) : null}
      {showPoll ? (
        <PollCompose
          question={pollQuestion}
          options={pollOptions}
          onChangeQuestion={setPollQuestion}
          onChangeOption={(i, t) => setPollOptions((prev) => prev.map((o, j) => (j === i ? t : o)))}
          onAddOption={pollOptions.length < 4 ? () => setPollOptions((prev) => [...prev, ""]) : undefined}
          onRemoveOption={pollOptions.length > 2 ? (i) => setPollOptions((prev) => prev.filter((_, j) => j !== i)) : undefined}
          onSubmit={submitPoll}
          submitting={pollCreating}
        />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable
          onPress={() => setViewOnce(!viewOnce)}
          testID="sm-convo-viewonce-toggle"
          accessibilityState={{ selected: viewOnce }}
        >
          <Text>1x{viewOnce ? " on" : ""}</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowPoll(!showPoll)}
          testID="sm-convo-poll-toggle"
          accessibilityState={{ selected: showPoll }}
        >
          <Text>Poll{showPoll ? " on" : ""}</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Composer
            variant="message"
            value={text}
            onChangeText={onChangeText}
            onSend={send}
            maxLength={2000}
            sending={sending}
            onPressAttach={pick}
            attachments={attachments}
            onRemoveAttachment={() => {
              setAttachments([]);
              setFiles([]);
            }}
          />
        </View>
      </View>
      {Platform.OS === "web"
        ? React.createElement("input", {
            ref: inputRef,
            type: "file",
            accept: "image/jpeg,image/png,image/webp,video/mp4",
            style: { display: "none" },
            testID: "sm-convo-file",
            onChange: (e: any) => {
              onFiles(e.target.files);
              e.target.value = "";
            },
          } as any)
        : null}
    </View>
  );
}
