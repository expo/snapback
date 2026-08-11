import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  skip,
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackOutbox,
  useSnapbackQuery,
} from '@expo/snapback-react';
import type { GeneratedApi, GeneratedDataModel } from '@warble/generated-api';

import { PostCard } from './post-card';
import { useWarbleTheme, type WarbleTheme } from './theme';

type Profile = GeneratedDataModel['profiles'];
type Like = GeneratedDataModel['likes'];
type Persona = Pick<Profile, 'handle' | 'displayName' | 'bio'>;

type WarbleScreenProps = Readonly<{
  api: GeneratedApi;
  /** client.rqsStoreInfo — the honest report of which persistence arm
   * resolved. Rendered beside a retention refusal because a degraded store is
   * one of the reasons retention can be refused. */
  storeInfo: unknown;
}>;

const fallbackProfiles: readonly Persona[] = Object.freeze([
  { handle: 'ada', displayName: 'Ada Lovelace', bio: 'Poetical science, one note at a time.' },
  { handle: 'grace', displayName: 'Grace Hopper', bio: 'Debugging the future.' },
  { handle: 'alan', displayName: 'Alan Turing', bio: 'Questions, machines, and possibility.' },
]);

const personaOrder = new Map([
  ['ada', 0],
  ['grace', 1],
  ['alan', 2],
]);

function textFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

function connectionPresentation(status: string, theme: WarbleTheme) {
  switch (status) {
    case 'live':
      return { label: 'Live', color: '#38A169' };
    case 'polling':
      return { label: 'Polling', color: '#D69E2E' };
    case 'connecting':
      return { label: 'Connecting', color: '#D69E2E' };
    case 'stale':
      return { label: 'Stale', color: '#D97706' };
    case 'disconnected':
      return { label: 'Offline', color: theme.danger };
    case 'closed':
      return { label: 'Closed', color: theme.danger };
    case 'error':
      return { label: 'Connection error', color: theme.danger };
    default:
      return { label: 'Idle', color: theme.muted };
  }
}

export function WarbleScreen({ api, storeInfo }: WarbleScreenProps) {
  const theme = useWarbleTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [viewerHandle, setViewerHandle] = useState('ada');
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const timeline = useSnapbackQuery(api.timeline, {});
  const profiles = useSnapbackQuery(api.profiles, {});
  const profileRows = useSnapbackQuery(
    api.postsByAuthor,
    authorFilter === null ? skip : { handle: authorFilter },
  );

  const availableProfiles = useMemo<readonly Persona[]>(() => {
    const rows = profiles.data?.length ? profiles.data : fallbackProfiles;
    return [...rows].sort(
      (left, right) => (personaOrder.get(left.handle) ?? 99) - (personaOrder.get(right.handle) ?? 99),
    );
  }, [profiles.data]);
  const viewer = availableProfiles.find((profile) => profile.handle === viewerHandle)
    ?? availableProfiles[0]
    ?? fallbackProfiles[0];

  const likes = useSnapbackQuery(api.myLikes, { handle: viewer.handle });
  const createPost = useSnapbackMutation(api.createPost);
  const connection = useSnapbackConnection();
  const outbox = useSnapbackOutbox();
  const replayRef = useRef(outbox.replay);
  replayRef.current = outbox.replay;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      // Background execution is best-effort. A failed drain remains in the
      // durable outbox and is represented by the same queued badge on resume.
      void replayRef.current().catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  const activeQuery = authorFilter === null ? timeline : profileRows;
  const posts = activeQuery.data ?? [];
  const likeRows: readonly Like[] = likes.data ?? [];
  const likeSet = new Set(likeRows.map((like) => like.postId));
  const likeIdByPost = new Map<string, string>(likeRows.map((like) => [like.postId, like._id]));
  const likesReady = likes.status === 'ready' || likes.status === 'refreshing';
  const connectionFact = connectionPresentation(connection.status, theme);
  const characterCount = Array.from(draft).length;
  const postDisabled = posting || draft.trim().length === 0 || characterCount > 280;

  const cyclePersona = () => {
    const currentIndex = availableProfiles.findIndex((profile) => profile.handle === viewer.handle);
    const next = availableProfiles[(currentIndex + 1) % availableProfiles.length];
    if (next) setViewerHandle(next.handle);
  };

  const submitPost = async () => {
    if (postDisabled) return;
    setPosting(true);
    setComposerError(null);
    try {
      const outcome = await createPost({
        body: draft.trim(),
        authorHandle: viewer.handle,
        authorName: viewer.displayName,
      });
      // A queued response is a successful offline capture. The timeline stays
      // pre-intent and the outbox badge is the sole representation until replay.
      if (outcome.status === 'queued' || typeof outcome.result.postId === 'string') setDraft('');
    } catch (error) {
      setComposerError(textFromError(error));
    } finally {
      setPosting(false);
    }
  };

  const replayQueued = async () => {
    setReplayError(null);
    try {
      await outbox.replay();
    } catch (error) {
      setReplayError(textFromError(error));
    }
  };

  const listHeader = (
    <View style={styles.listHeader}>
      {/* freshness and connection are independent facts and must not be
          conflated. A retained frame on a live connection is a legitimate
          transient state — the rows came from disk and the authoritative
          answer has not landed yet — so calling that "Offline" while the
          header reads "Live" is a lie the user can see. */}
      {activeQuery.freshness === 'retained' ? (
        <View style={styles.offlineBanner}>
          <Text selectable style={styles.offlineBannerText}>
            {connection.status === 'live' || connection.status === 'polling'
              ? 'Showing saved posts — catching up…'
              : 'Offline — showing saved posts'}
          </Text>
        </View>
      ) : null}

      {outbox.status === 'ready' && outbox.pending > 0 ? (
        <View style={styles.outboxRow}>
          <View style={styles.queuedBadge}>
            <Text selectable style={styles.queuedBadgeText}>{outbox.pending} queued</Text>
          </View>
          <Text style={styles.outboxExplanation}>Waiting to send</Text>
          <Pressable
            accessibilityRole="button"
            disabled={outbox.replaying}
            onPress={() => void replayQueued()}
            style={({ pressed }) => [
              styles.replayButton,
              pressed && !outbox.replaying && styles.pressed,
              outbox.replaying && styles.disabled,
            ]}
          >
            <Text style={styles.replayButtonText}>{outbox.replaying ? 'Sending…' : 'Send now'}</Text>
          </Pressable>
        </View>
      ) : null}
      {outbox.status === 'ready' && outbox.failed > 0 ? (
        <Text selectable style={styles.debugError}>{outbox.failed} queued mutation failed</Text>
      ) : null}
      {replayError ? <Text selectable style={styles.debugError}>{replayError}</Text> : null}

      {authorFilter !== null ? (
        <View style={styles.filterRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAuthorFilter(null)}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
          <View style={styles.filterCopy}>
            <Text style={styles.filterEyebrow}>POSTS BY</Text>
            <Text selectable style={styles.filterTitle}>@{authorFilter}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.composer}>
        <View style={styles.composerTopRow}>
          <View style={[styles.composerAvatar, { backgroundColor: theme.accent }]}>
            <Text style={styles.composerAvatarText}>{viewer.displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.composerIdentity}>
            <Text selectable style={styles.composerName}>{viewer.displayName}</Text>
            <Text selectable style={styles.composerHandle}>@{viewer.handle}</Text>
          </View>
        </View>
        <TextInput
          accessibilityLabel="Write a post"
          multiline
          onChangeText={setDraft}
          placeholder="What’s worth sharing?"
          placeholderTextColor={theme.muted}
          selectionColor={theme.accent}
          style={styles.input}
          value={draft}
        />
        <View style={styles.composerFooter}>
          <Text
            selectable
            style={[styles.counter, characterCount > 280 && styles.counterOver]}
          >
            {characterCount}/280
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={postDisabled}
            onPress={() => void submitPost()}
            style={({ pressed }) => [
              styles.postButton,
              pressed && !postDisabled && styles.pressed,
              postDisabled && styles.postButtonDisabled,
            ]}
          >
            {posting ? (
              <ActivityIndicator color={theme.onAccent} size="small" />
            ) : (
              <Text style={styles.postButtonText}>Post</Text>
            )}
          </Pressable>
        </View>
        {composerError ? <Text selectable style={styles.composerError}>{composerError}</Text> : null}
      </View>

      <View style={styles.feedHeading}>
        <Text style={styles.feedTitle}>{authorFilter === null ? 'Latest' : 'Profile'}</Text>
        {activeQuery.status === 'refreshing' && activeQuery.freshness === 'current' ? (
          <Text style={styles.refreshingLabel}>Refreshing</Text>
        ) : null}
      </View>

      {/* When retention is refused, print every fact needed to diagnose it
          from a screenshot alone: the refusal code plus the freshness,
          connection, queue and store facts it depends on. A bare code is not
          actionable — this combination is. */}
      {timeline.retention?.retainable !== true ? (
        <Text selectable style={styles.retentionDebug}>
          {timeline.retention?.code ?? `retention=${timeline.retention === null ? 'null' : 'unclassified'}`}
          {'\n'}freshness={timeline.freshness ?? '—'} connection={connection.status}
          {' '}status={timeline.status}
          {'\n'}outbox={outbox.status === 'ready' ? `${outbox.pending}/${outbox.failed}` : outbox.status}
          {' '}store={String((storeInfo as { implementation?: string })?.implementation ?? '—')}
        </Text>
      ) : null}
      {likes.status === 'error' ? (
        <Text selectable style={styles.debugError}>Likes unavailable: {likes.error.message}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.headerShell}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>Warble</Text>
          <View style={styles.headerActions}>
            <View accessibilityLabel={`Connection: ${connectionFact.label}`} style={styles.connectionPill}>
              <View style={[styles.connectionDot, { backgroundColor: connectionFact.color }]} />
              <Text selectable style={styles.connectionLabel}>{connectionFact.label}</Text>
            </View>
            <Pressable
              accessibilityLabel={`Posting as ${viewer.displayName}. Tap to switch persona.`}
              accessibilityRole="button"
              onPress={cyclePersona}
              style={({ pressed }) => [styles.personaButton, pressed && styles.pressed]}
            >
              <View style={styles.personaAvatar}>
                <Text style={styles.personaAvatarText}>{viewer.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text numberOfLines={1} style={styles.personaHandle}>@{viewer.handle}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        data={posts}
        extraData={{ likes: likes.data, viewerHandle: viewer.handle }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(post) => post._id}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            {activeQuery.status === 'pending' ? (
              <>
                <ActivityIndicator color={theme.accent} />
                <Text style={styles.emptyTitle}>Loading posts…</Text>
              </>
            ) : activeQuery.status === 'error' ? (
              <>
                <Text selectable style={styles.emptyTitle}>Timeline unavailable</Text>
                <Text selectable style={styles.emptyCopy}>{activeQuery.error.message}</Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyTitle}>Quiet in here</Text>
                <Text style={styles.emptyCopy}>The next post will have the room to itself.</Text>
              </>
            )}
          </View>
        )}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <PostCard
            liked={likeSet.has(item._id)}
            likeId={likeIdByPost.get(item._id) ?? null}
            likesReady={likesReady}
            onSelectAuthor={setAuthorFilter}
            post={item}
            surface={
              authorFilter === null
                ? { query: api.timeline, args: {} }
                : { query: api.postsByAuthor, args: { handle: authorFilter } }
            }
            viewerHandle={viewer.handle}
          />
        )}
      />
    </View>
  );
}

function createStyles(theme: WarbleTheme) {
  return StyleSheet.create({
    screen: {
      backgroundColor: theme.background,
      flex: 1,
    },
    headerShell: {
      backgroundColor: theme.surface,
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      paddingTop: Platform.select({ ios: 52, android: 24, default: 18 }),
    },
    header: {
      alignItems: 'center',
      alignSelf: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      maxWidth: 720,
      paddingBottom: 13,
      paddingHorizontal: 18,
      width: '100%',
    },
    wordmark: {
      color: theme.text,
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: -1,
    },
    headerActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 9,
    },
    connectionPill: {
      alignItems: 'center',
      backgroundColor: theme.surfaceMuted,
      borderRadius: 15,
      flexDirection: 'row',
      gap: 6,
      minHeight: 30,
      paddingHorizontal: 10,
    },
    connectionDot: {
      borderRadius: 4,
      height: 8,
      width: 8,
    },
    connectionLabel: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '700',
    },
    personaButton: {
      alignItems: 'center',
      borderColor: theme.border,
      borderRadius: 17,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 6,
      minHeight: 34,
      maxWidth: 100,
      paddingHorizontal: 5,
      paddingRight: 9,
    },
    personaAvatar: {
      alignItems: 'center',
      backgroundColor: theme.accent,
      borderRadius: 12,
      height: 24,
      justifyContent: 'center',
      width: 24,
    },
    personaAvatarText: {
      color: theme.onAccent,
      fontSize: 11,
      fontWeight: '800',
    },
    personaHandle: {
      color: theme.text,
      flexShrink: 1,
      fontSize: 12,
      fontWeight: '700',
    },
    listContent: {
      alignSelf: 'center',
      maxWidth: 720,
      paddingBottom: 48,
      paddingHorizontal: 16,
      width: '100%',
    },
    listHeader: {
      gap: 14,
      paddingBottom: 12,
      paddingTop: 16,
    },
    offlineBanner: {
      backgroundColor: theme.banner,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    offlineBannerText: {
      color: theme.bannerText,
      fontSize: 13,
      fontWeight: '700',
      textAlign: 'center',
    },
    outboxRow: {
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 9,
      padding: 10,
    },
    queuedBadge: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 12,
      paddingHorizontal: 9,
      paddingVertical: 6,
    },
    queuedBadgeText: {
      color: theme.text,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      fontWeight: '800',
    },
    outboxExplanation: {
      color: theme.muted,
      flex: 1,
      fontSize: 12,
    },
    replayButton: {
      backgroundColor: theme.accent,
      borderRadius: 13,
      paddingHorizontal: 11,
      paddingVertical: 7,
    },
    replayButtonText: {
      color: theme.onAccent,
      fontSize: 12,
      fontWeight: '800',
    },
    filterRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 14,
      paddingVertical: 2,
    },
    backButton: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 15,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    backButtonText: {
      color: theme.accent,
      fontSize: 14,
      fontWeight: '800',
    },
    filterCopy: {
      gap: 2,
    },
    filterEyebrow: {
      color: theme.muted,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.1,
    },
    filterTitle: {
      color: theme.text,
      fontSize: 20,
      fontWeight: '800',
    },
    composer: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderRadius: 22,
      borderWidth: 1,
      gap: 12,
      padding: 16,
    },
    composerTopRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
    },
    composerAvatar: {
      alignItems: 'center',
      borderRadius: 18,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    composerAvatarText: {
      color: theme.onAccent,
      fontSize: 14,
      fontWeight: '800',
    },
    composerIdentity: {
      gap: 1,
    },
    composerName: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '700',
    },
    composerHandle: {
      color: theme.muted,
      fontSize: 12,
    },
    input: {
      color: theme.text,
      fontSize: 17,
      lineHeight: 24,
      minHeight: 84,
      padding: 0,
    },
    composerFooter: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 12,
    },
    counter: {
      color: theme.muted,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
    },
    counterOver: {
      color: theme.danger,
    },
    postButton: {
      alignItems: 'center',
      backgroundColor: theme.accent,
      borderRadius: 17,
      justifyContent: 'center',
      minHeight: 34,
      minWidth: 72,
      paddingHorizontal: 17,
    },
    postButtonDisabled: {
      opacity: 0.42,
    },
    postButtonText: {
      color: theme.onAccent,
      fontSize: 14,
      fontWeight: '800',
    },
    composerError: {
      color: theme.danger,
      fontSize: 12,
      lineHeight: 17,
    },
    feedHeading: {
      alignItems: 'baseline',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 2,
      paddingTop: 4,
    },
    feedTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: -0.3,
    },
    refreshingLabel: {
      color: theme.muted,
      fontSize: 11,
      fontWeight: '700',
    },
    retentionDebug: {
      color: theme.muted,
      fontFamily: 'monospace',
      fontSize: 10,
      lineHeight: 14,
    },
    debugError: {
      color: theme.danger,
      fontSize: 11,
      lineHeight: 15,
    },
    separator: {
      height: 12,
    },
    emptyState: {
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 24,
      paddingVertical: 48,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '800',
      textAlign: 'center',
    },
    emptyCopy: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 19,
      maxWidth: 420,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.68,
    },
    disabled: {
      opacity: 0.48,
    },
  });
}
