// Conversation screen: messages, receipts, typing, reactions, media,
// edit/delete, view-once, offline queue. Shared by DM and group routes.
import React from 'react';
import { FlatList, Linking, Platform, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useClient, useLink, useMutation, usePage, useQuery } from 'snapback4/react';
import { Composer, ComposerAttachment } from '../../ui-kit/src/Composer';
import { MessageBubble } from '../../ui-kit/src/MessageBubble';
import { PollCompose } from '../../ui-kit/src/PollCompose';
import { PollDisplay } from '../../ui-kit/src/PollDisplay';
import { ReactionPicker } from '../../ui-kit/src/ReactionPicker';
import { TypingIndicator } from '../../ui-kit/src/TypingIndicator';
import { chatAccents } from '../../ui-kit/src/tokens';
import { api, newId } from '../sb';
import {
  clearPendingByMsg,
  clearPendingByMutation,
  getPendingMarks,
  hydrateNative,
  markPending,
} from '../pending';
import { AssetImage, AssetVideo, useAssetUri } from '../components/AssetImage';
import { formatTime } from '../components/PostCard';
import {
  fileToPicked,
  isImageMime,
  isVideoMime,
  pickWebFile,
  uploadBlob,
  uploadVideo,
  videoPosterUri,
} from '../media';

export function ConversationView({ chatId }: { chatId: string }) {
  const client = useClient();
  const me = client?.viewer?.() ?? null;
  const detail = useQuery((api as any).chatDetail, { chatId });
  const chat: any = (detail as any)?.data?.chat;
  const members: any[] = React.useMemo(() => {
    const m = (detail as any)?.data?.members;
    if (Array.isArray(m)) return m;
    return m?.rows ?? [];
  }, [detail]);
  const msgs = usePage((api as any).threadMessages, { chatId });
  const pollsQ = useQuery((api as any).threadPolls, { chatId });
  const pollsByMsg = React.useMemo(() => {
    const d: any = (pollsQ as any)?.data;
    const rows: any[] = Array.isArray(d) ? d : d?.rows ?? [];
    const map = new Map<string, any>();
    for (const row of rows) map.set(row.messageId, row);
    return map;
  }, [pollsQ]);
  const reactionsQ = useQuery((api as any).threadReactions, { chatId });
  const receiptsQ = useQuery((api as any).threadReceipts, { chatId });
  const typingQ = useQuery((api as any).typingFor, { chatId });
  const cfgQ = useQuery((api as any).appconfig, {});
  const cfg: any[] = React.useMemo(() => {
    const d: any = (cfgQ as any)?.data;
    if (Array.isArray(d)) return d;
    return d?.rows ?? [];
  }, [cfgQ]);
  const cfgNum = (key: string, fallback: number) =>
    cfg.find((r) => r.key === key)?.num ?? fallback;

  const [items, setItems] = React.useState<any[]>([]);
  const [denied, setDenied] = React.useState(false);
  React.useEffect(() => {
    const r: any = (msgs as any).read;
    const rows: any[] = (msgs as any).items ?? [];
    if (rows.length > 0) {
      setItems(rows);
      setDenied(false);
    } else if (r?.denied) {
      setDenied(true);
    }
  }, [msgs]);

  const reactionsByMsg = React.useMemo(() => {
    const d: any = (reactionsQ as any)?.data;
    const rows: any[] = Array.isArray(d) ? d : d?.rows ?? [];
    const map = new Map<string, any[]>();
    for (const row of rows) {
      const list = map.get(row.messageId) ?? [];
      list.push(row);
      map.set(row.messageId, list);
    }
    return map;
  }, [reactionsQ]);

  const receiptsByMsg = React.useMemo(() => {
    const d: any = (receiptsQ as any)?.data;
    const rows: any[] = Array.isArray(d) ? d : d?.rows ?? [];
    const map = new Map<string, any[]>();
    for (const row of rows) {
      const list = map.get(row.messageId) ?? [];
      list.push(row);
      map.set(row.messageId, list);
    }
    return map;
  }, [receiptsQ]);

  const memberPrincipals = React.useMemo(() => members.map((m) => m.principal), [members]);

  // Durable outbox-pending marks: which of this chat's rows are queued but
  // unflushed (survives restart via the pending store).
  const link = useLink();
  const [pendingTick, setPendingTick] = React.useState(0);
  const pendingSet = React.useMemo(() => {
    void pendingTick;
    const marks = getPendingMarks();
    return new Set(Object.entries(marks).filter(([, m]) => m.chatId === chatId).map(([id]) => id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTick, chatId]);
  React.useEffect(() => {
    let live = true;
    void hydrateNative().then((changed) => {
      if (live && changed) setPendingTick((t) => t + 1);
    });
    const unsub = client?.onWrite?.((w: any) => {
      if (w && (w.state === 'sent' || w.state === 'failed') && w.id) {
        if (clearPendingByMutation(w.id)) setPendingTick((t) => t + 1);
        setVoteIntents((s) => {
          for (const [mid, it] of Object.entries(s)) {
            if ((it as any).opId === w.id) {
              const n = { ...s };
              delete n[mid];
              return n;
            }
          }
          return s;
        });
      }
    });
    return () => {
      live = false;
      try {
        (unsub as any)?.();
      } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, chatId]);
  // Backstop: continuously online with the row present means it flushed
  // somewhere (another device, or a missed ack) — drop the mark.
  React.useEffect(() => {
    if (link !== 'online') return;
    const t = setTimeout(() => {
      const ids = new Set(items.map((m: any) => m.id));
      let changed = false;
      for (const id of pendingSet) {
        if (ids.has(id)) {
          clearPendingByMsg(id);
          changed = true;
        }
      }
      if (changed) setPendingTick((x) => x + 1);
    }, 30000);
    return () => clearTimeout(t);
  }, [link, items, pendingSet]);

  // M7 poll votes: idempotent set-state intents through the same outbox.
  // An offline vote marks its option pending (kit aria-busy) until the
  // write settles or the server's vote state already shows the choice.
  const [voteIntents, setVoteIntents] = React.useState<
    Record<string, { optionId: string; opId: string; quiet: boolean }>
  >({});
  const voteIntentsRef = React.useRef(voteIntents);
  voteIntentsRef.current = voteIntents;
  async function vote(messageId: string, optionId: string) {
    if (!client) return;
    setError(null);
    // Mark pending synchronously: an offline cut races link detection, so
    // the flag must not wait for the write to come back. The intent clears
    // on settle (onWrite ack), on server-state match, or not at all until
    // the reconnect retry below delivers it. Re-sends are safe: setVote is
    // idempotent set-state, so a queued write plus a retry converge.
    const opId = newId('v');
    setVoteIntents((s) => ({ ...s, [messageId]: { optionId, opId, quiet: false } }));
    try {
      const w: any = await client.mutate((api as any).setVote, {
        messageId,
        optionId,
        mutId: newId('vm'),
      });
      if (w?.state === 'failed') throw (w as any).why ?? new Error('Vote failed');
      if (w?.id && w.id !== opId) {
        const nid = w.id;
        setVoteIntents((s) => (s[messageId] ? { ...s, [messageId]: { optionId, opId: nid, quiet: true } } : s));
      }
    } catch (e: any) {
      const w = e?.why ?? e;
      // Transport-level throw (offline cut before link flip): keep the
      // intent — the reconnect retry delivers it. Terminal refusals arrive
      // as failed writes and clear through onWrite, never here.
      if ((w as any)?.state === 'failed' || (e as any)?.state === 'failed') {
        setVoteIntents((s) => {
          if (!(messageId in s)) return s;
          const n = { ...s };
          delete n[messageId];
          return n;
        });
      }
      setError(w?.message || w?.code || 'Vote failed');
    }
  }
  // Open vote intents reconcile against the device's own confirmation
  // flag: a row this device wrote carries pending:true until the server
  // confirms it, so the device — not a local guess — owns the busy signal
  // while offline. An intent clears once the device holds the choice (the
  // device then renders busy itself while unconfirmed); a choice the
  // device never picks up is re-sent while online. Terminal refusals
  // clear with an error; transport throws keep the intent for the next
  // pass. Re-sends are safe: setVote is idempotent set-state, so a queued
  // write plus a retry converge.
  function clearVoteIntent(messageId: string) {
    setVoteIntents((s) => {
      if (!(messageId in s)) return s;
      const n = { ...s };
      delete n[messageId];
      return n;
    });
  }
  function deviceMine(messageId: string): any {
    return pollsByMsg.get(messageId)?.mine ?? null;
  }
  React.useEffect(() => {
    setVoteIntents((s) => {
      let next: Record<string, { optionId: string; opId: string; quiet: boolean }> | null = null;
      for (const [mid, it] of Object.entries(s)) {
        if (deviceMine(mid)?.optionId === it.optionId) {
          if (!next) next = { ...s };
          delete next[mid];
        }
      }
      return next ?? s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollsByMsg]);
  React.useEffect(() => {
    if (!client) return;
    const ids = Object.keys(voteIntentsRef.current);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const messageId of ids) {
        const it = voteIntentsRef.current[messageId];
        if (!it || cancelled) continue;
        // The device holds this choice (confirmed or not): nothing to do —
        // the match-clear above retires the intent and the row's own
        // pending flag drives the busy signal.
        if (deviceMine(messageId)?.optionId === it.optionId) continue;
        // The write reached the device (queued or sent): the outbox owns
        // delivery; do not duplicate it.
        if (it.quiet) continue;
        if (link !== 'online') continue;
        try {
          const w: any = await client.mutate((api as any).setVote, {
            messageId,
            optionId: it.optionId,
            mutId: newId('vm'),
          });
          if ((w as any)?.state === 'failed') throw (w as any).why ?? new Error('Vote failed');
          if ((w as any)?.id) {
            const nid = (w as any).id;
            setVoteIntents((s) => (s[messageId] ? { ...s, [messageId]: { optionId: it.optionId, opId: nid, quiet: true } } : s));
          }
        } catch (e: any) {
          const w = e?.why ?? e;
          if ((w as any)?.state === 'failed' || (e as any)?.state === 'failed') {
            clearVoteIntent(messageId);
            setError(w?.message || w?.code || 'Vote failed');
          }
          /* transport throw: keep the intent for the next pass */
        }
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, client, chatId, pollsByMsg]);

  // M7 poll compose (groups only): question + 2-4 options.
  const [showPollCompose, setShowPollCompose] = React.useState(false);
  const [pollQuestion, setPollQuestion] = React.useState('');
  const [pollOptions, setPollOptions] = React.useState<string[]>(['', '']);
  const [pollSending, setPollSending] = React.useState(false);
  async function submitPoll(question: string, options: string[]) {
    if (!client) return;
    const labels = options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (question.trim().length === 0 || labels.length < 2) return;
    setPollSending(true);
    setError(null);
    try {
      const ids = labels.map(() => newId('o'));
      const w: any = await client.mutate((api as any).createPoll, {
        chatId,
        msgId: newId('m'),
        question: question.trim().slice(0, 200),
        optIdA: ids[0],
        optA: labels[0].slice(0, 50),
        optIdB: ids[1],
        optB: labels[1].slice(0, 50),
        optIdC: labels[2] ? ids[2] : null,
        optC: labels[2] ? labels[2].slice(0, 50) : null,
        optIdD: labels[3] ? ids[3] : null,
        optD: labels[3] ? labels[3].slice(0, 50) : null,
      });
      if (w?.state === 'failed') throw (w as any).why ?? new Error('Poll failed');
      setShowPollCompose(false);
      setPollQuestion('');
      setPollOptions(['', '']);
    } catch (e: any) {
      const w = e?.why ?? e;
      setError(w?.message || w?.code || 'Poll failed');
    } finally {
      setPollSending(false);
    }
  }

  // Delivered/read reporting for others' messages.
  const report = useMutation((api as any).reportReceipt);
  const mark = useMutation((api as any).markRead);
  const reportedRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!client || !me) return;
    let maxAt = 0;
    for (const m of items) {
      if (m.tombstoned || m.pending || pendingSet.has(m.id)) continue;
      if (m.authorId === me) continue;
      if ((m.at ?? 0) > maxAt) maxAt = m.at;
      if (!reportedRef.current.has(m.id + ':1')) {
        reportedRef.current.add(m.id + ':1');
        report.run({ messageId: m.id, state: 1 }).catch(() => {
          reportedRef.current.delete(m.id + ':1');
        });
      }
      if (!reportedRef.current.has(m.id + ':2')) {
        reportedRef.current.add(m.id + ':2');
        report.run({ messageId: m.id, state: 2 }).catch(() => {
          reportedRef.current.delete(m.id + ':2');
        });
      }
    }
    if (maxAt > 0) mark.run({ chatId, at: maxAt }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, client, me, chatId]);

  const typingNames = React.useMemo(() => {
    const d: any = (typingQ as any)?.data;
    const rows: any[] = Array.isArray(d) ? d : d?.rows ?? [];
    return rows
      .filter((t) => t.principal !== me)
      .map((t) => t.profile?.displayName ?? 'Someone');
  }, [typingQ, me]);

  const [draft, setDraft] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<any | null>(null);
  const [editing, setEditing] = React.useState<any | null>(null);
  const [reactingTo, setReactingTo] = React.useState<any | null>(null);
  const [viewOnce, setViewOnce] = React.useState(false);
  const [pick, setPick] = React.useState<any | null>(null);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [viewer, setViewer] = React.useState<{ kind: string; url: string } | null>(null);
  const [openedOnce, setOpenedOnce] = React.useState<Set<string>>(new Set());
  const [jumpTo, setJumpTo] = React.useState<string | null>(null);
  const listRef = React.useRef<FlatList>(null);
  // In-flight attach (file pick + poster generation, up to 15 s for video).
  // send() awaits it: otherwise a fast tap after attach silently drops the
  // message (no text yet, pick not set, no error shown).
  const attachingRef = React.useRef<Promise<void> | null>(null);

  const typePing = useMutation((api as any).setTyping);
  const lastTypeRef = React.useRef(0);
  function onChangeText(t: string) {
    if (editing) setEditing({ ...editing, draft: t });
    else setDraft(t);
    const now = Date.now();
    if (now - lastTypeRef.current > 3000) {
      lastTypeRef.current = now;
      typePing.run({ chatId }).catch(() => {});
    }
  }

  async function attach() {
    setError(null);
    const run = (async () => {
    try {
      if (Platform.OS === 'web') {
        const input = document.querySelector(
          '[data-testid="sm-convo-file"]',
        ) as HTMLInputElement | null;
        let file: File | null = null;
        if (input?.files?.length) {
          file = input.files[0];
          input.value = '';
        } else {
          file = await pickWebFile('image/*,video/*');
        }
        if (!file) return;
        const p = await fileToPicked(file);
        if (isVideoMime(p.mime, p.name)) {
          let posterBlob: Blob | undefined;
          let posterUri: string | undefined;
          try {
            posterBlob = await videoPosterUri(p.blob);
            posterUri = URL.createObjectURL(posterBlob);
          } catch { /* optional */ }
          setPick({ file: p.blob, kind: 'video', localUri: p.uri, posterBlob, posterUri });
        } else if (isImageMime(p.mime, p.name)) {
          setPick({ file: p.blob, kind: 'image', localUri: p.uri });
        } else {
          setError('Pick a JPEG, PNG, WebP image or MP4 video');
        }
      } else {
        const ImagePicker = await import('expo-image-picker');
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'] as any,
          quality: 1,
        });
        if (!res.canceled && res.assets?.[0]) {
          const a = res.assets[0];
          const resp = await fetch(a.uri);
          const blob = await resp.blob();
          const isVid = a.type === 'video';
          let posterBlob: Blob | undefined;
          let posterUri: string | undefined;
          if (isVid) {
            try {
              const Thumbs = await import('expo-video-thumbnails');
              const t = await Thumbs.getThumbnailAsync(a.uri, { time: 100 });
              const tr = await fetch(t.uri);
              posterBlob = await tr.blob();
              posterUri = URL.createObjectURL(posterBlob);
            } catch { /* optional */ }
          }
          setPick({ file: blob, kind: isVid ? 'video' : 'image', localUri: a.uri, posterBlob, posterUri });
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Attach failed');
    }
    })();
    attachingRef.current = run;
    try {
      await run;
    } finally {
      if (attachingRef.current === run) attachingRef.current = null;
    }
  }

  async function send() {
    if (!client || sending) return;
    if (attachingRef.current) {
      try {
        await attachingRef.current;
      } catch { /* attach reports its own error */ }
    }
    const text = editing ? editing.draft.trim() : draft.trim();
    if (!text && !pick) return;
    setSending(true);
    setError(null);
    try {
      if (editing) {
        const w = await client.mutate((api as any).editMessage, {
          messageId: editing.id,
          body: editing.kind === 'text' ? text : editing.body,
          caption: editing.kind === 'text' ? editing.caption : text || null,
        });
        if ((w as any).state === 'failed') throw (w as any).why ?? new Error('Edit failed');
        setEditing(null);
        setDraft('');
        return;
      }
      const msgId = newId('m');
      const quoteId = replyTo ? replyTo.id : null;
      const track = (w: any) => {
        if (w?.state === 'pending' && w?.id) {
          markPending(msgId, { mutationId: w.id, chatId, at: Date.now() });
          setPendingTick((t) => t + 1);
        } else {
          clearPendingByMsg(msgId);
        }
      };
      if (pick?.kind === 'video') {
        const clip = await uploadVideo(client, pick.file);
        let posterId: string | null = null;
        if (pick.posterBlob) posterId = await uploadBlob(client, pick.posterBlob);
        const w = await client.mutate((api as any).sendVideo, {
          chatId,
          msgId,
          caption: text || null,
          clip: clip.duration != null ? { id: clip.id, duration: clip.duration } : { id: clip.id },
          poster: posterId ? { id: posterId } : null,
          quoteId,
        });
        if ((w as any).state === 'failed') throw (w as any).why ?? new Error('Send failed');
        track(w);
      } else if (pick) {
        const assetId = await uploadBlob(client, pick.file);
        const w = await client.mutate((api as any).sendImage, {
          chatId,
          msgId,
          caption: text || null,
          photo: viewOnce ? null : { id: assetId },
          photoOnce: viewOnce ? { id: assetId } : null,
          viewOnce,
          quoteId,
        });
        if ((w as any).state === 'failed') throw (w as any).why ?? new Error('Send failed');
        track(w);
      } else {
        const w = await client.mutate((api as any).sendText, { chatId, msgId, body: text, quoteId });
        if ((w as any).state === 'failed') throw (w as any).why ?? new Error('Send failed');
        track(w);
      }
      setDraft('');
      setPick(null);
      setReplyTo(null);
      setViewOnce(false);
    } catch (e: any) {
      const w = e?.why ?? e;
      setError(w?.message || w?.code || 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const attachments: ComposerAttachment[] = pick
    ? [
        pick.kind === 'video'
          ? { kind: 'video', uri: pick.localUri, posterUri: pick.posterUri ?? pick.localUri }
          : { kind: 'image', uri: pick.localUri },
      ]
    : [];

  const bgUri = useAssetUri(chat?.background?.id);
  const accent = chat?.color ? (chatAccents as any)[chat.color] : undefined;

  function aggregate(m: any): 'sent' | 'delivered' | 'read' {
    if (m.pending || pendingSet.has(m.id)) return 'sent';
    const rows = receiptsByMsg.get(m.id) ?? [];
    const byPrincipal = new Map(rows.map((r) => [r.principal, r.state]));
    const recipients = memberPrincipals.filter((p) => p !== m.authorId);
    if (recipients.length === 0) return 'read';
    const states = recipients.map((p) => byPrincipal.get(p) ?? 0);
    if (states.every((s) => s >= 2)) return 'read';
    if (states.every((s) => s >= 1)) return 'delivered';
    return 'sent';
  }

  return (
    <View style={{ flex: 1 }}>
      {bgUri ? (
        <View
          testID="sm-chatsettings-background-preview"
          accessibilityLabel="chat background"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, opacity: 0.25 }}
        >
          {React.createElement('img', {
            src: bgUri,
            'data-testid': 'sm-chatsettings-background-preview-img',
            style: { width: '100%', height: '100%', objectFit: 'cover' },
          })}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', padding: 8, gap: 8, alignItems: 'center' }}>
        <Text style={{ fontWeight: 'bold' }}>{chat?.name ?? 'Conversation'}</Text>
        {chat?.disappearing && chat.disappearing !== 'off' ? (
          <Text>disappearing: {chat.disappearing}</Text>
        ) : null}
        <Link href={`/chatsettings/${chatId}`} testID="sm-convo-settings">
          Settings
        </Link>
        {chat?.kind === 'group' ? (
          <Pressable
            testID="sm-poll-compose-toggle"
            accessibilityLabel="new poll"
            onPress={() => setShowPollCompose((v) => !v)}
          >
            <Text>Poll</Text>
          </Pressable>
        ) : null}
      </View>
      {showPollCompose && chat?.kind === 'group' ? (
        <PollCompose
          question={pollQuestion}
          options={pollOptions}
          onChangeQuestion={setPollQuestion}
          onChangeOption={(index, text) =>
            setPollOptions((opts) => opts.map((x, j) => (j === index ? text : x)))
          }
          onAddOption={
            pollOptions.length < 4 ? () => setPollOptions((opts) => [...opts, '']) : undefined
          }
          onRemoveOption={
            pollOptions.length > 2
              ? (index) => setPollOptions((opts) => opts.filter((_, j) => j !== index))
              : undefined
          }
          onSubmit={submitPoll}
          submitting={pollSending}
        />
      ) : null}
      <TypingIndicator visible={typingNames.length > 0} names={typingNames} />
      {denied && items.length === 0 ? <Text>You are no longer a member of this chat.</Text> : null}
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(m: any) => m.id}
        renderItem={({ item, index }: any) => (
          <MessageRow
            m={item}
            me={me}
            chatId={chatId}
            chatKind={chat?.kind}
            accent={accent}
            aggregate={aggregate(item)}
            reactions={reactionsByMsg.get(item.id) ?? []}
            highlight={jumpTo === item.id}
            editWindowMs={cfgNum('editWindow', 900) * 1000}
            onReply={() => setReplyTo(item)}
            onJump={(id) => {
              setJumpTo(id);
              const at = items.findIndex((x) => x.id === id);
              if (at >= 0) listRef.current?.scrollToIndex({ index: at, viewPosition: 0.5 });
              setTimeout(() => setJumpTo(null), 2500);
            }}
            onEdit={() => setEditing({ ...item, draft: (item.body ?? item.caption ?? '') as string })}
            onViewOnce={(url, kind) => setViewer({ kind, url })}
            onOpenedOnce={(id) => setOpenedOnce((prev) => new Set(prev).add(id))}
            openedOnce={openedOnce.has(item.id)}
            pendingOutbox={pendingSet.has(item.id)}
            onReact={(msg) => setReactingTo(msg)}
            poll={pollsByMsg.get(item.id) ?? null}
            votePendingOption={voteIntents[item.id]?.optionId ?? null}
            onVote={(optionId) => vote(item.id, optionId)}
          />
        )}
        onEndReached={() => (msgs as any).loadMore?.()}
        onEndReachedThreshold={0.5}
      />
      {reactingTo ? (
        <ReactionPickerRow
          messageId={reactingTo.id}
          chatId={chatId}
          mine={reactionsByMsg.get(reactingTo.id)?.find((r) => r.principal === me)?.emoji}
          onDone={() => setReactingTo(null)}
        />
      ) : null}
      {replyTo ? (
        <View style={{ padding: 8 }}>
          <Text>
            Replying to {replyTo.author?.displayName ?? ''}: {(replyTo.body ?? replyTo.caption ?? '').slice(0, 80)}
          </Text>
          <Pressable onPress={() => setReplyTo(null)}>
            <Text>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      {editing ? (
        <View style={{ padding: 8 }}>
          <Text>Editing message</Text>
          <Pressable
            onPress={() => {
              setEditing(null);
              setDraft('');
            }}
          >
            <Text>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      {Platform.OS === 'web'
        ? React.createElement('input', {
            type: 'file',
            'data-testid': 'sm-convo-file',
            accept: 'image/*,video/*',
            style: { position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' },
          })
        : null}
      <Pressable
        testID="sm-convo-viewonce-toggle"
        accessibilityLabel="view once"
        accessibilityValue={{ text: viewOnce ? 'on' : 'off' }}
        aria-valuetext={viewOnce ? 'on' : 'off'}
        aria-pressed={viewOnce}
        onPress={() => setViewOnce((v) => !v)}
        style={{ padding: 8, opacity: pick ? 1 : 0.4 }}
      >
        <Text>View once: {viewOnce ? 'on' : 'off'}</Text>
      </Pressable>
      <Composer
        variant="message"
        value={editing ? editing.draft : draft}
        onChangeText={onChangeText}
        onSend={send}
        maxLength={2000}
        sending={sending}
        onPressAttach={attach}
        attachments={attachments}
        onRemoveAttachment={() => setPick(null)}
      />
      {error ? (
        <Text testID="sm-convo-error">{error}</Text>
      ) : null}
      {viewer ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'black', padding: 24 }}>
          {viewer.kind === 'video' ? (
            React.createElement('video', {
              src: viewer.url,
              controls: true,
              autoPlay: true,
              'data-testid': 'sm-media-viewer-video',
              style: { width: '100%', height: '80%' },
            })
          ) : (
            <AssetImage assetId={null} style={{ display: 'none' }} />
          )}
          {viewer.kind !== 'video'
            ? React.createElement('img', {
                src: viewer.url,
                'data-testid': 'sm-media-viewer-image',
                style: { width: '100%', height: '80%', objectFit: 'contain' },
              })
            : null}
          <Pressable
            testID="sm-media-viewer-close"
            onPress={() => setViewer(null)}
            style={{ padding: 12 }}
          >
            <Text style={{ color: 'white' }}>Close</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ReactionPickerRow({
  messageId,
  chatId,
  mine,
  onDone,
}: {
  messageId: string;
  chatId: string;
  mine?: string;
  onDone: () => void;
}) {
  const react = useMutation((api as any).setReaction);
  const id = newId('rx');
  async function choose(emoji: string) {
    if (mine === emoji) {
      await react.run({ messageId, emoji, clear: true, mutId: id });
    } else {
      await react.run({ messageId, emoji, clear: false, mutId: id });
    }
    onDone();
  }
  return (
    <View>
      <ReactionPicker emojis={['👍', '❤️', '😂', '😮', '😢', '🙏']} selectedEmoji={mine} onPick={choose} />
      <Pressable onPress={onDone}>
        <Text>Close</Text>
      </Pressable>
    </View>
  );
}

function MessageRow({
  m,
  me,
  chatId,
  chatKind,
  accent,
  aggregate,
  reactions,
  highlight,
  editWindowMs,
  onReply,
  onJump,
  onEdit,
  onViewOnce,
  onOpenedOnce,
  openedOnce,
  pendingOutbox,
  onReact,
  poll,
  votePendingOption,
  onVote,
}: {
  m: any;
  me: string | null;
  chatId: string;
  chatKind?: string;
  accent?: string;
  aggregate: 'sent' | 'delivered' | 'read';
  reactions: any[];
  highlight: boolean;
  editWindowMs: number;
  onReply: () => void;
  onJump: (id: string) => void;
  onEdit: () => void;
  onViewOnce: (url: string, kind: string) => void;
  onOpenedOnce: (id: string) => void;
  openedOnce: boolean;
  pendingOutbox?: boolean;
  onReact: (msg: any) => void;
  poll?: any | null;
  votePendingOption?: string | null;
  onVote?: (optionId: string) => void;
}) {
  const client = useClient();
  const del = useMutation((api as any).deleteMessage);
  const react = useMutation((api as any).setReaction);
  const isMine = m.authorId === me;
  const photoId = m.photo?.id ?? null;
  const onceId = m.photoOnce?.id ?? null;
  const clipId = m.clip?.id ?? null;
  const posterId = m.poster?.id ?? null;
  const photoUri = useAssetUri(m.viewOnce ? null : photoId);
  const posterUri = useAssetUri(posterId);
  const avatarUri = useAssetUri(m.author?.avatar?.id);
  const quoted = useQuery((api as any).quotedMessage, m.quoteId ? { messageId: m.quoteId } : { messageId: 'x' });
  const quotedMsg: any = m.quoteId ? (quoted as any)?.data : null;
  const [error, setError] = React.useState<string | null>(null);

  const summaries = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    return [...counts.entries()].map(([emoji, count]) => ({
      emoji,
      count,
      mine: reactions.some((r) => r.emoji === emoji && r.principal === me),
    }));
  }, [reactions, me]);

  async function openMedia() {
    if (!client) return;
    setError(null);
    if (m.viewOnce && onceId) {
      if (openedOnce) {
        setError('Already viewed');
        return;
      }
      try {
        const a = await client.asset(onceId);
        if ((a as any).denied) {
          setError((a as any).denied?.message ?? 'View denied');
          onOpenedOnce(m.id);
          return;
        }
        onOpenedOnce(m.id);
        onViewOnce((a as any).url, 'image');
      } catch (e: any) {
        setError(e?.message ?? 'View denied');
        onOpenedOnce(m.id);
      }
      return;
    }
    if (photoId) {
      try {
        const a = await client.asset(photoId);
        if (!(a as any).denied) {
          onViewOnce((a as any).url, 'image');
          return;
        }
      } catch { /* fall through to cached uri */ }
      if (photoUri) onViewOnce(photoUri, 'image');
      return;
    }
    if (clipId) {
      try {
        const a = await client.asset(clipId);
        if (!(a as any).denied) {
          onViewOnce((a as any).url, 'video');
          return;
        }
      } catch { /* fall through */ }
    }
  }

  async function chipTap(emoji: string) {
    const id = newId('rx');
    const mineTap = summaries.find((s) => s.emoji === emoji)?.mine;
    if (mineTap) await react.run({ messageId: m.id, emoji, clear: true, mutId: id });
    else await react.run({ messageId: m.id, emoji, clear: false, mutId: id });
  }

  async function doDelete() {
    const w = await del.run({ messageId: m.id });
    if ((w as any).state === 'failed') setError((w as any)?.why?.message ?? 'Delete failed');
  }

  const canEdit =
    isMine && !m.tombstoned && m.kind === 'text' && !poll && Date.now() - (m.at ?? 0) < editWindowMs;
  const mediaUri = m.kind === 'video' ? posterUri : photoUri;
  const showPoll = !!poll && !m.tombstoned;
  const devicePendingOption =
    poll?.mine?.pending === true ? poll.mine?.optionId ?? null : null;
  const pollOptions = showPoll
    ? (poll.options ?? []).map((o: any) => ({
        id: o.optionId,
        label: o.label,
        count: o.tally ?? 0,
        mine: poll.mine?.optionId === o.optionId,
        pending:
          (votePendingOption != null && votePendingOption === o.optionId) ||
          devicePendingOption === o.optionId,
      }))
    : [];

  return (
    <View style={highlight ? { backgroundColor: '#fff7cc' } : undefined}>
      <MessageBubble
        isMine={isMine}
        text={m.tombstoned || showPoll ? undefined : m.body ?? m.caption}
        mediaUri={m.viewOnce ? undefined : mediaUri}
        mediaKind={m.kind === 'video' ? 'video' : m.kind === 'image' ? 'image' : undefined}
        viewOnce={!!m.viewOnce && !m.tombstoned}
        viewOnceOpened={openedOnce}
        senderName={m.author?.displayName}
        senderIdentity={m.author?.handle}
        senderAvatarUri={avatarUri}
        showSender
        timestamp={formatTime(m.at)}
        edited={!!m.editedAt}
        deleted={!!m.tombstoned}
        receipt={isMine ? aggregate : undefined}
        receiptPending={isMine && (!!m.pending || !!pendingOutbox)}
        quote={
          m.quoteId && quotedMsg
            ? {
                senderName: quotedMsg.author?.displayName ?? 'Someone',
                excerpt: (quotedMsg.body ?? quotedMsg.caption ?? '').slice(0, 80),
              }
            : undefined
        }
        onPressQuote={m.quoteId ? () => onJump(m.quoteId) : undefined}
        reactions={summaries}
        onPressReactionChip={chipTap}
        onPressMedia={m.kind === 'text' && !m.viewOnce ? undefined : openMedia}
        onPressLink={(url) => Linking.openURL(url)}
        accentColor={accent}
      />
      {showPoll ? (
        <View style={{ paddingHorizontal: 8, paddingTop: 4 }}>
          <PollDisplay
            question={poll.question}
            options={pollOptions}
            onVote={(index) => onVote?.(poll.options[index].optionId)}
            accentColor={accent}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, paddingLeft: 8 }}>
        <Pressable testID="sm-convo-react" accessibilityLabel="react" onPress={() => onReact(m)}>
          <Text>React</Text>
        </Pressable>
        <Pressable testID="sm-convo-quote" accessibilityLabel="reply" onPress={onReply}>
          <Text>Reply</Text>
        </Pressable>
        {isMine && !m.tombstoned ? (
          <Pressable testID="sm-convo-edit" accessibilityLabel="edit" onPress={onEdit}>
            <Text>Edit</Text>
          </Pressable>
        ) : null}
        {isMine && !m.tombstoned ? (
          <Pressable testID="sm-convo-delete" accessibilityLabel="delete" onPress={doDelete}>
            <Text>Delete</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text testID="sm-convo-error">{error}</Text> : null}
    </View>
  );
}
