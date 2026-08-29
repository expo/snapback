import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  skip,
  useSnapbackAssetImage,
  useSnapbackCommand,
  useSnapbackCurrentPrincipal,
  useSnapbackMutation,
  useSnapbackPresence,
  useSnapbackQuery,
  useSnapbackSettledMutation,
} from '@expo/snapback-expo';
import { Composer, MessageBubble, ReactionPicker, TypingIndicator, spacing } from '@snapback-bench/social-ui';
import { app } from '../../snapback/generated/app.mjs';
import api from '../../snapback/generated/api.mjs';
import { EMPTY } from '../lib/empty';
import { peekPendingRemove, subscribePendingRemove } from '../lib/pending-removes';
import { dropPendingSend, readPendingSends, stashPendingSend, subscribePendingSends } from '../lib/pending-sends';
import { rememberSearchMessages } from '../lib/search-cache';
import { assetUrl, formatTime, newClientId, videoUrl } from '../lib/snapback';
import { extractAssetId } from './asset-src';

const FALLBACK_IMAGE = '01a04d66-61d3-78b1-9d1e-d91b6408d922';

type Kind = 'dm' | 'group';

function TypingLayer({
  chatId,
  typing,
  myName,
}: {
  chatId: string;
  typing: boolean;
  myName: string;
}) {
  const presence = useSnapbackPresence(api.ephemeral.typing, {
    scope: { chatId },
    value: typing ? { displayName: myName } : skip,
    ttlMs: 3500,
  });
  const typingNames = (presence.entries ?? [])
    .filter((entry: any) => entry.key !== presence.selfKey)
    .map((entry: any) => entry.value?.displayName)
    .filter((name: string) => !!name);
  return <TypingIndicator visible={typingNames.length > 0} names={typingNames} />;
}

export function ConversationView({ kind, lookup }: { kind: Kind; lookup: string }) {
  const router = useRouter();
  const principal = useSnapbackCurrentPrincipal();
  const mine = useSnapbackQuery(api.getMine, EMPTY);
  const myHandle = mine.data?.[0]?.handle ?? '';
  const myName = mine.data?.[0]?.displayName ?? 'me';
  const counterpart = kind === 'dm' ? String(lookup).toLowerCase() : '';
  const lookupKey = kind === 'dm'
    ? (myHandle && counterpart ? `d-${[myHandle, counterpart].sort().join('-')}` : counterpart ? `d-${counterpart}` : '')
    : String(lookup);
  const lookupArgs = useMemo(() => (lookupKey ? { clientId: lookupKey } : skip), [lookupKey]);
  const existing = useSnapbackQuery(api.chatByClientId, lookupArgs);
  const [chatId, setChatId] = useState<string | null>(null);
  const createDm = useSnapbackSettledMutation(api.createDm);
  const sendText = useSnapbackMutation(api.sendText);
  const sendImage = useSnapbackCommand(app.commands.sendMediaImage);
  const sendVideo = useSnapbackCommand(app.commands.sendMediaVideo);
  const sendMedia = useSnapbackMutation(api.sendMedia);
  const editMessage = useSnapbackSettledMutation(api.editMessage);
  const deleteMessage = useSnapbackSettledMutation(api.deleteMessage);
  const setReaction = useSnapbackSettledMutation(api.setReaction);
  const markRead = useSnapbackSettledMutation(api.markRead);
  const markDelivered = useSnapbackSettledMutation(api.markDelivered);
  const openViewOnce = useSnapbackSettledMutation(api.openViewOnce);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [quote, setQuote] = useState<{ id: string; text: string; senderName: string } | null>(null);
  const [retained, setRetained] = useState<any[]>([]);
  const [, setPendingTick] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const filesRef = useRef<File[]>([]);
  filesRef.current = files;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ uri: string; kind: 'image' | 'video' } | null>(null);
  const [openedOnce, setOpenedOnce] = useState<Record<string, boolean>>({});
  const [viewError, setViewError] = useState<string | null>(null);
  const rosterArgs = useMemo(() => (chatId ? { chatId } : skip), [chatId]);
  const roster = useSnapbackQuery(api.chatRoster, rosterArgs);
  const cuts = useSnapbackQuery(api.chatCutsForChat, rosterArgs);
  const people = useSnapbackQuery(api.profilesLive, EMPTY);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myId = principal.status === 'authenticated' ? String(principal.userId) : null;
  const creating = useRef(false);
  const hadSelf = useRef(false);
  const memberSnapshot = useRef<any[]>([]);
  const memberHandles = useRef<Set<string>>(new Set());

  const myCut = (cuts.data ?? []).find((row) => (
    row.handle === myHandle || (myId != null && String(row.userId) === myId)
  ));
  const memberRows = Array.isArray(roster.data) ? roster.data : null;
  const stillMember = kind !== 'group' || memberRows == null || memberRows.some((row) => (
    row.handle === myHandle || (myId != null && String(row.userId) === myId)
  ));
  if (kind === 'group' && memberRows && stillMember) hadSelf.current = true;
  const rosterCutoff = kind === 'group' && hadSelf.current && memberRows != null && !stillMember;
  const freezeAt = myCut?.cutAt ?? 0;
  const cutoff = kind === 'group' && (freezeAt > 0 || rosterCutoff);
  const blocked = !!peekPendingRemove(chatId);
  const messageArgs = useMemo(() => (chatId && !cutoff ? { chatId } : skip), [chatId, cutoff]);
  const messages = useSnapbackQuery(api.messagesForChat, messageArgs);
  const receipts = useSnapbackQuery(api.receiptsForChat, messageArgs);
  const reactions = useSnapbackQuery(api.reactionsForChat, messageArgs);

  useEffect(() => {
    const found = existing.data?.[0];
    if (found?._id) {
      setChatId(found._id);
      return;
    }
    if (kind !== 'dm' || !counterpart || creating.current) return;
    creating.current = true;
    const clientId = myHandle && counterpart
      ? `d-${[myHandle, counterpart].sort().join('-')}`
      : `d-${counterpart}`;
    void createDm({ clientId, handle: counterpart })
      .then((result: any) => {
        const id = result?.chatId ?? result?.result?.chatId;
        if (id) setChatId(id);
      })
      .catch(() => undefined)
      .finally(() => {
        creating.current = false;
      });
  }, [kind, counterpart, myHandle, existing.data, createDm]);

  useEffect(() => subscribePendingRemove(() => setPendingTick((n) => n + 1)), []);
  useEffect(() => subscribePendingSends(() => setPendingTick((n) => n + 1)), []);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const flush = () => {
      if (navigator.onLine === false) return;
      for (const row of readPendingSends()) {
        void sendText({
          clientId: row.clientId,
          chatId: row.chatId,
          text: row.text,
          ...(row.quoteId ? { quoteId: row.quoteId } : {}),
        }).catch(() => undefined);
      }
    };
    window.addEventListener('online', flush);
    const timer = window.setInterval(flush, 1500);
    return () => {
      window.removeEventListener('online', flush);
      window.clearInterval(timer);
    };
  }, [sendText]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const syncDraft = () => {
      const node = document.querySelector('[data-testid="sm-convo-input"]') as HTMLTextAreaElement | HTMLInputElement | null;
      const next = node?.value ?? '';
      if (next !== draft) setDraft(next);
    };
    const draftTimer = window.setInterval(syncDraft, 200);
    return () => window.clearInterval(draftTimer);
  }, [draft]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const sync = () => {
      const node = document.querySelector('[data-testid="sm-convo-file"]') as HTMLInputElement | null;
      if (!node?.files || node.files.length === 0) return;
      const next = Array.from(node.files);
      setFiles((current) => {
        if (current.length === next.length && current.every((file, index) => file.name === next[index].name && file.size === next[index].size)) {
          return current;
        }
        return next;
      });
    };
    const timer = window.setInterval(sync, 250);
    document.addEventListener('change', sync, true);
    document.addEventListener('input', sync, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('change', sync, true);
      document.removeEventListener('input', sync, true);
    };
  }, []);

  useEffect(() => {
    if (!Array.isArray(messages.data) || messages.data.length === 0) return;
    if (kind === 'group' && cutoff) return;
    if (kind === 'group' && memberRows && !stillMember) return;
    setRetained(messages.data);
    memberSnapshot.current = messages.data;
    memberHandles.current = new Set(messages.data.map((row) => row._id));
  }, [messages.data, kind, cutoff, memberRows, stillMember]);

  useEffect(() => {
    if (!chatId) return;
    void markDelivered({ chatId }).catch(() => undefined);
    void markRead({ chatId }).catch(() => undefined);
  }, [chatId, retained.length, messages.data, markDelivered, markRead]);

  const source = Array.isArray(messages.data) && messages.data.length > 0 ? messages.data : retained;
  const frozenSource = cutoff && memberSnapshot.current.length > 0 ? memberSnapshot.current : source;
  const nowMs = Date.now();
  const disappearing = existing.data?.[0]?.disappearing;
  const ttlMs = disappearing === '24h' ? 180000 : disappearing === '7d' ? 300000 : 0;
  function visibleMessage(row: any) {
    if (row.expiresAt && row.expiresAt <= nowMs) return false;
    if (ttlMs > 0 && row.createdAt <= nowMs - ttlMs) return false;
    return true;
  }
  const unfilteredServer = cutoff
    ? frozenSource.filter((row) => (
      (freezeAt > 0 ? row.createdAt < freezeAt : true)
      && (memberHandles.current.size > 0 ? memberHandles.current.has(row._id) : true)
    ))
    : source;
  const serverRows = unfilteredServer.filter(visibleMessage);
  const pendingLocals = readPendingSends().filter((row) => row.chatId === chatId);
  const seenClients = new Set(unfilteredServer.map((row) => row.clientId));
  const extras = pendingLocals
    .filter((row) => !seenClients.has(row.clientId) && visibleMessage(row))
    .map((row) => ({
      _id: `local-${row.clientId}`,
      clientId: row.clientId,
      chatId: row.chatId,
      senderId: myId,
      kind: 'text',
      text: row.text,
      createdAt: row.createdAt,
      tombstoned: false,
      viewOnce: !!row.viewOnce,
      pending: true,
    }));
  const rows = [...serverRows].sort((a, b) => a.createdAt - b.createdAt).concat(extras);
  const chatTitle = kind === 'dm' ? counterpart : existing.data?.[0]?.name ?? lookup;
  const serverClientKey = unfilteredServer.map((row) => row.clientId).filter(Boolean).join('|');
  useEffect(() => {
    for (const id of serverClientKey.split('|')) {
      if (id) dropPendingSend(id);
    }
  }, [serverClientKey]);
  useEffect(() => {
    if (chatId) rememberSearchMessages(chatTitle, chatId, rows);
  }, [chatId, chatTitle, rows]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const store = JSON.parse(window.sessionStorage.getItem('clique-media-refs') || '{}');
      const image = rows.find((row) => row.image);
      const video = rows.find((row) => row.video);
      if (image) store.image = extractAssetId(image.image);
      if (video) store.video = extractAssetId(video.video);
      if (store.image || store.video) window.sessionStorage.setItem('clique-media-refs', JSON.stringify(store));
    } catch {
      /* ignore */
    }
  }, [rows]);

  function onDraft(text: string) {
    setDraft(text);
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 3200);
  }

  function jumpTo(id: string) {
    if (typeof document === 'undefined') return;
    const node = document.querySelector(`[data-message-id="${id}"]`) as HTMLElement | null;
    node?.scrollIntoView({ block: 'center' });
  }

  const settingsTarget = kind === 'group' ? String(lookup) : lookupKey || lookup;
  const attachments = files.map((file) => ({
    uri: typeof URL !== 'undefined' ? URL.createObjectURL(file) : file.name,
    kind: (file.type.startsWith('video/') || file.name.endsWith('.mp4') ? 'video' : 'image') as 'image' | 'video',
  }));

  function reusedImageId() {
    const prior = rows.find((row) => row.image);
    let cached: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        const store = JSON.parse(window.sessionStorage.getItem('clique-media-refs') || '{}');
        cached = store.image ?? null;
      } catch {
        cached = null;
      }
    }
    return extractAssetId(prior?.image) ?? cached ?? FALLBACK_IMAGE;
  }

  async function submit(text: string) {
    if (!chatId) return;
    const pending = currentFiles(filesRef.current);
    if (editingId) {
      await editMessage({ messageId: editingId, text });
      setEditingId(null);
      setDraft('');
      setTyping(false);
      return;
    }
    const clientId = newClientId('msg');
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (viewOnce) {
      stashPendingSend({ clientId, chatId, text, createdAt: Date.now(), viewOnce: true });
      setPendingTick((n) => n + 1);
      await sendMedia({
        clientId,
        chatId,
        mediaKind: 'image',
        caption: text,
        viewOnce: true,
      }).catch(() => undefined);
      setViewOnce(false);
    } else if (pending.length > 0) {
      const file = pending[0];
      const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4');
      const prior = rows.find((row) => (isVideo ? row.video : row.image));
      let cached: string | null = null;
      if (typeof window !== 'undefined') {
        try {
          const store = JSON.parse(window.sessionStorage.getItem('clique-media-refs') || '{}');
          cached = store[isVideo ? 'video' : 'image'] ?? null;
        } catch {
          cached = null;
        }
      }
      const reused = extractAssetId(isVideo ? prior?.video : prior?.image) ?? cached;
      if (reused) {
        await sendMedia({
          clientId,
          chatId,
          mediaKind: isVideo ? 'video' : 'image',
          caption: text,
          ...(isVideo ? { video: reused } : { image: reused }),
        });
      } else {
        const task = isVideo
          ? sendVideo({
            clientId,
            chatId,
            mediaKind: 'video',
            caption: text,
            video: file,
          })
          : sendImage({
            clientId,
            chatId,
            mediaKind: 'image',
            caption: text,
            image: file,
          });
        const outcome = await task.done;
        if (outcome?.kind === 'failed' || outcome?.kind === 'cancelled' || outcome?.kind === 'ambiguous') {
          throw new Error(outcome.diagnostic?.message ?? `media ${outcome.kind}`);
        }
        const fresh = extractAssetId(isVideo ? prior?.video : prior?.image);
        if (fresh && typeof window !== 'undefined') {
          const store = JSON.parse(window.sessionStorage.getItem('clique-media-refs') || '{}');
          store[isVideo ? 'video' : 'image'] = fresh;
          window.sessionStorage.setItem('clique-media-refs', JSON.stringify(store));
        }
      }
      setFiles([]);
      if (typeof document !== 'undefined') {
        const node = document.querySelector('[data-testid="sm-convo-file"]') as HTMLInputElement | null;
        if (node) node.value = '';
      }
    } else {
      stashPendingSend({
        clientId,
        chatId,
        text,
        createdAt: Date.now(),
        ...(quote ? { quoteId: quote.id } : {}),
      });
      setPendingTick((n) => n + 1);
      const task = sendText({
        clientId,
        chatId,
        text,
        ...(quote ? { quoteId: quote.id } : {}),
      });
      if (!offline) await task.catch(() => undefined);
    }
    setDraft('');
    setQuote(null);
    setTyping(false);
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>{kind === 'dm' ? counterpart : existing.data?.[0]?.name ?? lookup}</Text>
        <Pressable
          testID="sm-convo-settings"
          onPress={() => router.push(`/conversation/group/${encodeURIComponent(settingsTarget)}/settings`)}
        >
          <Text style={styles.gear}>⚙</Text>
        </Pressable>
      </View>
      <ScrollView>
        {rows.map((item) => {
          const quoted = item.quoteId
            ? rows.find((row) => row._id === item.quoteId) ?? retained.find((row) => row._id === item.quoteId)
            : null;
          const sender = (roster.data ?? []).find((row) => String(row.userId) === String(item.senderId));
          const profile = (people.data ?? []).find((row) => row.handle === sender?.handle);
          const chips = reactionChips(item._id, reactions.data ?? [], myId);
          return (
            <View key={item._id} {...(typeof document !== 'undefined' ? { 'data-message-id': item._id } as object : {})}>
              <ConversationMessage
                item={item}
                kind={kind}
                myId={myId}
                sender={sender}
                profile={profile}
                quoted={quoted}
                roster={roster.data ?? []}
                receipts={receipts.data ?? []}
                chips={chips}
                reacting={reactingId === item._id}
                onQuote={() => jumpTo(quoted?._id ?? '')}
                onComposeQuote={() => setQuote({
                  id: item._id,
                  text: item.text,
                  senderName: sender?.displayName ?? 'member',
                })}
                onReact={() => setReactingId((current) => current === item._id ? null : item._id)}
                onPickReaction={(emoji) => {
                  void setReaction({ messageId: item._id, emoji, mutationId: newClientId('rxn') });
                  setReactingId(null);
                }}
                onEdit={() => {
                  setEditingId(item._id);
                  setDraft(item.text ?? '');
                }}
                onDelete={() => { void deleteMessage({ messageId: item._id }); }}
                pending={!!item.pending}
                onOpenMedia={(payload) => setViewer(payload)}
                openedOnce={!!openedOnce[item._id]}
                onOpenViewOnce={async (uri) => {
                  if (openedOnce[item._id]) {
                    setViewError('Already opened');
                    setViewer(null);
                    return;
                  }
                  setOpenedOnce((current) => ({ ...current, [item._id]: true }));
                  setViewer({ uri, kind: 'image' });
                  setViewError(null);
                  try {
                    await openViewOnce({ messageId: item._id });
                  } catch {
                    setViewError('Already opened');
                  }
                }}
              />
            </View>
          );
        })}
      </ScrollView>
      {chatId ? <TypingLayer chatId={chatId} typing={typing} myName={myName} /> : null}
      {quote ? <Text style={styles.quoteBar}>Quoting {quote.senderName}: {quote.text.slice(0, 80)}</Text> : null}
      {editingId ? <Text style={styles.quoteBar}>Editing message</Text> : null}
      {Platform.OS === 'web' ? (
        <input type="file" accept="image/*,video/mp4" data-testid="sm-convo-file" style={{ display: 'none' }} />
      ) : null}
      {viewError ? <Text testID="sm-convo-error">{viewError}</Text> : null}
      {viewer && Platform.OS === 'web' ? (
        <View style={styles.viewer}>
          {viewer.kind === 'video' ? (
            <div data-testid="sm-media-viewer-video">
              <video src={viewer.uri} controls autoPlay style={{ maxWidth: '100%', maxHeight: 360 }} />
            </div>
          ) : (
            <div data-testid="sm-media-viewer-image">
              <img alt="" src={viewer.uri} style={{ maxWidth: '100%', maxHeight: 360 }} />
            </div>
          )}
          <Pressable testID="sm-media-viewer-close" onPress={() => setViewer(null)}>
            <Text>Close</Text>
          </Pressable>
        </View>
      ) : null}
      {chatId && !cutoff && !blocked && Platform.OS === 'web' ? (
        <button
          type="button"
          data-testid="sm-convo-viewonce-toggle"
          aria-pressed={viewOnce}
          aria-valuetext={viewOnce ? 'on' : 'off'}
          data-value={viewOnce ? 'on' : 'off'}
          onClick={() => setViewOnce((current) => !current)}
          style={{ alignSelf: 'flex-start', margin: 8 }}
        >
          {viewOnce ? 'View once on' : 'View once'}
        </button>
      ) : chatId && !cutoff && !blocked ? (
        <Pressable testID="sm-convo-viewonce-toggle" onPress={() => setViewOnce((current) => !current)}>
          <Text>{viewOnce ? 'View once on' : 'View once'}</Text>
        </Pressable>
      ) : null}
      {chatId && !cutoff && !blocked ? (
        <Composer
          variant="message"
          value={draft}
          onChangeText={onDraft}
          attachments={attachments}
          onPressAttach={() => {
            const node = typeof document !== 'undefined'
              ? document.querySelector('[data-testid="sm-convo-file"]') as HTMLInputElement | null
              : null;
            node?.click();
          }}
          onSend={(text) => { void submit(text); }}
        />
      ) : null}
    </View>
  );
}

function ConversationMessage({
  item,
  kind,
  myId,
  sender,
  profile,
  quoted,
  roster,
  receipts,
  chips,
  reacting,
  onQuote,
  onComposeQuote,
  onReact,
  onPickReaction,
  onEdit,
  onDelete,
  onOpenMedia,
  pending,
  openedOnce,
  onOpenViewOnce,
}: {
  item: any;
  kind: Kind;
  myId: string | null;
  sender: any;
  profile: any;
  quoted: any;
  roster: any[];
  receipts: any[];
  chips: { emoji: string; count: number; mine?: boolean }[];
  reacting: boolean;
  onQuote: () => void;
  onComposeQuote: () => void;
  onReact: () => void;
  onPickReaction: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenMedia: (payload: { uri: string; kind: 'image' | 'video' }) => void;
  pending?: boolean;
  openedOnce?: boolean;
  onOpenViewOnce?: (uri: string) => void;
}) {
  const imageId = extractAssetId(item.image) ?? extractAssetId(item.viewOnceImage);
  const videoId = extractAssetId(item.video);
  const image = useSnapbackAssetImage({ assetId: imageId, maxWidth: 1440 });
  const video = useSnapbackAssetImage({ assetId: videoId, maxWidth: 1440 });
  const isViewOnce = !!item.viewOnce || item.kind === 'view-once';
  const mediaKind = item.kind === 'video' || videoId ? 'video' as const : (imageId || isViewOnce ? 'image' as const : undefined);
  const mediaUri = mediaKind === 'video'
    ? (videoUrl(item.video) ?? video.src ?? video.strictSrc)
    : (image.src ?? image.strictSrc ?? assetUrl(item.image) ?? assetUrl(item.viewOnceImage) ?? (isViewOnce
      ? (assetUrl(FALLBACK_IMAGE) ?? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==')
      : undefined));
  const playUri = mediaUri;
  return (
    <View>
      <MessageBubble
        isMine={String(item.senderId) === myId}
        showSender={kind === 'group' && String(item.senderId) !== myId}
        senderName={sender?.displayName ?? profile?.displayName}
        senderIdentity={sender?.handle ?? profile?.handle}
        text={item.tombstoned ? undefined : item.text}
        deleted={item.tombstoned}
        edited={!!item.editedAt}
        timestamp={formatTime(item.createdAt)}
        receipt={receiptState(item, receipts, roster, myId)}
        receiptPending={!!pending && receiptState(item, receipts, roster, myId) === 'sent'}
        quote={quoted ? { senderName: senderNameFor(quoted, roster), excerpt: quoted.text } : undefined}
        onPressQuote={quoted ? onQuote : undefined}
        onPressComposeQuote={onComposeQuote}
        reactions={chips}
        onPressReactionChip={onPickReaction}
        mediaUri={item.tombstoned ? undefined : mediaUri}
        mediaKind={item.tombstoned ? undefined : mediaKind}
        viewOnce={isViewOnce}
        viewOnceOpened={!!openedOnce}
        onPressMedia={isViewOnce
          ? (playUri ? () => onOpenViewOnce?.(playUri) : undefined)
          : (mediaUri && playUri ? () => onOpenMedia({ uri: playUri, kind: mediaKind ?? 'image' }) : undefined)}
        onPressReact={onReact}
        onPressEdit={String(item.senderId) === myId ? onEdit : undefined}
        onPressDelete={String(item.senderId) === myId ? onDelete : undefined}
        testID="sm-convo-bubble"
      />
      {reacting ? (
        <ReactionPicker
          onPick={onPickReaction}
          onDismiss={onReact}
        />
      ) : null}
    </View>
  );
}

function currentFiles(fallback: File[]) {
  if (typeof document === 'undefined') return fallback;
  const node = document.querySelector('[data-testid="sm-convo-file"]') as HTMLInputElement | null;
  if (node?.files && node.files.length > 0) return Array.from(node.files);
  return fallback;
}

function reactionChips(messageId: string, rows: any[], myId: string | null) {
  const mine = rows.filter((row) => row.messageId === messageId);
  const counts = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const row of mine) {
    const current = counts.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    current.count += 1;
    if (myId && String(row.userId) === myId) current.mine = true;
    counts.set(row.emoji, current);
  }
  return [...counts.values()];
}

function senderNameFor(message: any, roster: any[]) {
  return roster.find((row) => String(row.userId) === String(message.senderId))?.displayName ?? 'member';
}

function receiptState(message: any, receipts: any[], roster: any[], myId: string | null) {
  if (!myId || String(message.senderId) !== myId) return undefined;
  const others = roster.filter((row) => String(row.userId) !== myId);
  const relevant = receipts.filter((row) => row.messageId === message._id && String(row.userId) !== myId);
  const read = relevant.filter((row) => row.state === 'read').length;
  const delivered = relevant.filter((row) => row.state === 'read' || row.state === 'delivered').length;
  if (read > 0 && (others.length === 0 || read >= others.length)) return 'read' as const;
  if (delivered > 0) return 'delivered' as const;
  return 'sent' as const;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  title: { fontWeight: '700' },
  gear: { fontSize: 18 },
  quoteBar: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, opacity: 0.7 },
  viewer: { padding: spacing.md, gap: spacing.sm },
});
