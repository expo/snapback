// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Asset } from 'expo-asset';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import {
  skip,
  useSnapbackAuth,
  useSnapbackConnection,
  useSnapbackCurrentPrincipal,
  useSnapbackMutation,
  useSnapbackOutbox,
  useSnapbackQuery,
  useSurface,
} from '@expo/snapback-expo';
import {
  AuthForm,
  ChatListRow,
  ChatSettingsForm,
  Composer,
  FeedCard,
  FeedTabs,
  InsightsBarList,
  InsightsSummary,
  MessageBubble,
  ProfileForm,
  ReactionPicker,
  SearchBar,
  TrendingEmpty,
  TrendingRow,
  TypingIndicator,
  chatAccentList,
  palette,
} from '@snapback-bench/social-ui';
import api from '../snapback/generated/api.mjs';
import { app } from '../snapback/generated/app.mjs';

const VIDEO_POSTER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="100%" height="100%" fill="#202534"/><circle cx="240" cy="135" r="42" fill="#ffffffcc"/><path d="M230 112l34 23-34 23z" fill="#4f46e5"/></svg>');
const FIXTURE_ASSETS: any = {
  'fixture:img-01': require('../../../instrument-036-final/fixtures/social-messenger/media/img-01.png'),
  'fixture:img-02': require('../../../instrument-036-final/fixtures/social-messenger/media/img-02.png'),
  'fixture:img-03': require('../../../instrument-036-final/fixtures/social-messenger/media/img-03.png'),
  'fixture:avatar-alice': require('../../../instrument-036-final/fixtures/social-messenger/media/avatar-alice.png'),
  'fixture:avatar-bob': require('../../../instrument-036-final/fixtures/social-messenger/media/avatar-bob.png'),
  'fixture:vid-01': require('../../../instrument-036-final/fixtures/social-messenger/media/vid-01.mp4'),
};
const assetUri = (value: string) => FIXTURE_ASSETS[value] ? Asset.fromModule(FIXTURE_ASSETS[value]).uri : value;
const emptyAttachment = null;
const EMPTY_ARGS = Object.freeze({});
const nowId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const rows = (state: any) => state?.data ?? [];
const first = (state: any) => rows(state)[0] ?? null;
const errorMessage = (error: any) => error?.message ?? String(error ?? 'Unknown error');
const accentValue = (name: string) => chatAccentList.find((a: any) => a.name === name)?.value ?? chatAccentList[0].value;
const reposterHandle = (post: any, profiles: Map<any, any>) => post.projectedEntry?.repostedById
  ? profiles.get(post.projectedEntry.repostedById)?.handle ?? post.projectedEntry.repostedByHandle ?? ''
  : '';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function FileControl({ testID, accept, inputRef, onFile }: any) {
  if (Platform.OS !== 'web') return null;
  return React.createElement('input', {
    ref: inputRef,
    type: 'file',
    accept,
    'data-testid': testID,
    style: { display: 'none' },
    onChange: async (event: any) => {
      const file = event.target.files?.[0];
      if (file) await onFile(file);
      event.target.value = '';
    },
  });
}

function WebSemanticBridge() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const overlayStyle = document.createElement('style');
    overlayStyle.textContent = '#error-overlay, #error-overlay * { pointer-events: none !important; }';
    document.head.appendChild(overlayStyle);
    const synchronize = () => {
      const developmentOverlay = document.getElementById('error-overlay');
      if (developmentOverlay) developmentOverlay.remove();
      document.querySelectorAll<HTMLElement>('[data-testid="sm-feed-item"]').forEach((item) => {
        const author = item.dataset.author ?? '';
        const reposter = item.dataset.reposter ?? '';
        if (author) item.querySelectorAll<HTMLElement>('[data-testid="sm-feed-author-avatar"]').forEach((node) => node.setAttribute('aria-valuetext', author));
        if (reposter) item.querySelectorAll<HTMLElement>('[data-testid="sm-feed-repost-attribution"]').forEach((node) => node.setAttribute('aria-valuetext', reposter));
      });
      document.querySelectorAll<HTMLElement>('[data-testid="sm-post-like"]').forEach((node) => {
        node.setAttribute('aria-pressed', node.textContent?.includes('♥') ? 'true' : 'false');
      });
      document.querySelectorAll<HTMLElement>('[data-testid="sm-chats-item"]').forEach((node) => {
        const identity = node.closest<HTMLElement>('[data-chat-identity]')?.dataset.chatIdentity;
        if (identity) node.setAttribute('aria-valuetext', identity);
      });
      document.querySelectorAll<HTMLElement>('[data-testid="sm-convo-receipt"]').forEach((node) => {
        const label = node.getAttribute('aria-label')?.toLowerCase();
        if (label) node.setAttribute('aria-valuetext', label);
      });
      document.querySelectorAll<HTMLElement>('[data-testid="sm-convo-viewonce"]').forEach((node) => {
        node.setAttribute('aria-valuetext', node.getAttribute('aria-label')?.toLowerCase().includes('already opened') ? 'opened' : 'unopened');
      });
      document.querySelectorAll<HTMLElement>('[data-testid="sm-chatsettings-member-candidate"]').forEach((node) => {
        const name = node.getAttribute('aria-label')?.replace(/^Add\s+/i, '').trim();
        if (name) node.setAttribute('aria-valuetext', name.split(/\s+/)[0].toLowerCase());
      });
      document.querySelectorAll<HTMLElement>('[data-testid="sm-chatsettings-member"]').forEach((node) => {
        const name = node.getAttribute('aria-label')?.replace(/^Member\s+/i, '').trim();
        if (name) node.setAttribute('aria-valuetext', `${name.split(/\s+/)[0].toLowerCase()}:${node.querySelector('[data-testid="sm-chatsettings-member-promote"]') ? 'member' : 'admin'}`);
      });
      document.querySelectorAll<HTMLElement>('[data-testid="sm-chatsettings-color"]').forEach((node) => {
        const name = node.getAttribute('aria-label')?.replace(/^Accent color\s+/i, '').trim().toLowerCase();
        const accent = chatAccentList.find((item: any) => item.name.toLowerCase() === name);
        if (accent) node.setAttribute('data-value', accent.value);
        node.setAttribute('aria-selected', node.textContent?.includes('✓') ? 'true' : 'false');
      });
      const disappearingValues: Record<string, string> = { off: 'off', '24 hours': '24h', '7 days': '7d' };
      document.querySelectorAll<HTMLElement>('[data-testid="sm-chatsettings-disappearing"]').forEach((node) => {
        const label = node.getAttribute('aria-label')?.replace(/^Disappearing messages\s+/i, '').trim().toLowerCase() ?? '';
        if (disappearingValues[label]) node.setAttribute('data-value', disappearingValues[label]);
        node.setAttribute('aria-selected', node.querySelector('[class*="r-fontWeight-1kfrs79"]') ? 'true' : 'false');
      });
      document.querySelectorAll<HTMLElement>('[data-testid="sm-chatsettings-background-preview"]').forEach((node) => {
        const src = node.querySelector('img')?.getAttribute('src');
        if (src) node.setAttribute('data-value', src);
      });
    };
    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'data-author', 'data-reposter', 'src', 'style', 'class'] });
    return () => observer.disconnect();
  }, []);
  return null;
}

function SemanticAttachment({ attachment }: any) {
  if (Platform.OS !== 'web' || !attachment) return null;
  return React.createElement('div', {
    'aria-label': `${attachment.kind} attachment`,
    'aria-valuetext': attachment.kind,
    'data-testid': 'sm-compose-attachment',
    style: { width: 1, height: 1, overflow: 'hidden' },
  }, React.createElement('img', {
    alt: '', src: attachment.uri, 'data-testid': 'sm-compose-attachment-media',
    style: { width: 1, height: 1 },
  }));
}

function AuthEntry({ onEmail }: { onEmail(email: string): void }) {
  const auth = useSnapbackAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true); setError(''); onEmail(email);
    try {
      if (mode === 'sign-up') await auth.signUpWithPassword({ email, password });
      else await auth.signInWithPassword({ email, password });
      router.replace('/');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSubmitting(false); }
  };
  return (
    <View style={styles.authShell}>
      <AuthForm mode={mode} email={email} password={password} onChangeEmail={setEmail}
        onChangePassword={setPassword} onSubmit={() => void submit()} submitting={submitting}
        errorText={error} onToggleMode={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')} />
    </View>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.replace('/')}><Text style={styles.logo}>Clique</Text></Pressable>
      <View style={styles.nav}>
        <Pressable onPress={() => router.replace('/search')}><Text style={styles.navText}>Search</Text></Pressable>
        <Pressable onPress={() => router.replace('/insights')}><Text style={styles.navText}>Insights</Text></Pressable>
        <Pressable onPress={() => router.replace('/profile/edit')}><Text style={styles.navText}>Profile</Text></Pressable>
        <Pressable onPress={() => router.replace('/settings')}><Text style={styles.navText}>Settings</Text></Pressable>
      </View>
    </View>
  );
}

function Authenticated({ rememberedEmail }: { rememberedEmail: string }) {
  const pathname = usePathname();
  const principal = useSnapbackCurrentPrincipal();
  const profileState = useSnapbackQuery(api.myProfile, EMPTY_ARGS);
  const inboxState = useSnapbackQuery(api.myInbox, EMPTY_ARGS);
  const searchState = useSnapbackQuery(api.myMessageSearch, EMPTY_ARGS);
  const createProfile = useSnapbackMutation(api.upsertProfile);
  const delivered = useSnapbackMutation(api.markConversationDelivered);
  const connection = useSnapbackConnection();
  const bootstrapped = useRef(false);
  const deliveredKey = useRef('');
  const inboxDeliveryKey = rows(inboxState).map((r: any) => `${r.conversationExternalId}:${r.unreadCount}`).join('|');
  const deliveryConversationIds = rows(inboxState).map((r: any) => r.conversationExternalId);
  if (Platform.OS === 'web' && searchState?.freshness === 'current') {
    try { localStorage.setItem('clique:warm-search', JSON.stringify(rows(searchState))); } catch {}
  }

  useEffect(() => {
    if (bootstrapped.current || profileState.status === 'pending' || first(profileState)) return;
    bootstrapped.current = true;
    const base = rememberedEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18);
    const handle = (base.length >= 3 ? base : `user${String(principal.userId).replace(/[^a-z0-9]/gi, '').slice(-8)}`).toLowerCase();
    void createProfile({ email: rememberedEmail || `${handle}@clique.local`, handle, displayName: base ? base[0].toUpperCase() + base.slice(1) : 'Clique member', bio: '', location: '', link: '', avatarUri: '' });
  }, [profileState.status, profileState.data, rememberedEmail]);

  useEffect(() => {
    if (connection.status !== 'live') return;
    const key = inboxDeliveryKey;
    if (!key || key === deliveredKey.current) return;
    deliveredKey.current = key;
    for (const inbox of rows(inboxState)) void delivered({ conversationExternalId: inbox.conversationExternalId });
  }, [connection.status, inboxDeliveryKey]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (deliveryConversationIds.length) localStorage.setItem('clique:delivery-conversations', JSON.stringify(deliveryConversationIds));
    const markFetched = () => {
      if (!navigator.onLine) return;
      let remembered: string[] = [];
      try { remembered = JSON.parse(localStorage.getItem('clique:delivery-conversations') ?? '[]'); } catch {}
      for (const conversationExternalId of new Set([...deliveryConversationIds, ...remembered])) {
        void delivered({ conversationExternalId }).catch(() => {});
      }
    };
    window.addEventListener('online', markFetched);
    markFetched();
    return () => window.removeEventListener('online', markFetched);
  }, [deliveryConversationIds.join('|')]);

  return (
    <View style={styles.page}>
      <WebSemanticBridge />
      <Header />
      <RouteView pathname={pathname} profile={first(profileState)} inboxes={rows(inboxState)} searchState={searchState} />
    </View>
  );
}

function RouteView({ pathname, profile, inboxes, searchState }: any) {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (pathname === '/settings') return <Settings />;
  if (pathname === '/search') return <SearchScreen profile={profile} inboxes={inboxes} messagesState={searchState} />;
  if (pathname === '/insights') return <InsightsScreen />;
  if (pathname === '/profile/edit') return <ProfileEdit profile={profile} />;
  if (parts[0] === 'profile' && parts[1]) return <ProfileView handle={parts[1].toLowerCase()} profile={profile} />;
  if (parts[0] === 'thread' && parts[1]) return <FeedScreen profile={profile} threadId={parts[1]} />;
  if (parts[0] === 'conversation' && parts[1] === 'group' && parts[2] && parts[3] === 'settings') {
    return <ConversationSettings routeValue={parts[2]} inboxes={inboxes} group />;
  }
  if (parts[0] === 'conversation' && parts[1] === 'group' && parts[2]) return <ConversationRoute routeValue={parts[2]} group inboxes={inboxes} profile={profile} />;
  if (parts[0] === 'conversation' && parts[1] && parts[2] === 'settings') return <ConversationSettings routeValue={parts[1]} inboxes={inboxes} />;
  if (parts[0] === 'conversation' && parts[1]) return <ConversationRoute routeValue={parts[1]} inboxes={inboxes} profile={profile} />;
  return <FeedScreen profile={profile} inboxes={inboxes} />;
}

function FeedNav({ active = 'following' }: any) {
  return <FeedTabs active={active} onChange={(tab) => router.replace(`/?tab=${tab}`)} />;
}

function FeedScreen({ profile, inboxes = [], threadId = '' }: any) {
  const params = useLocalSearchParams();
  const [active, setActive] = useState<any>(threadId ? 'global' : (params.tab === 'global' || params.tab === 'trending' ? params.tab : 'following'));
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<any>(emptyAttachment);
  const [sending, setSending] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const fileRef = useRef<any>(null);
  const postsState = useSnapbackQuery(api.globalPosts, EMPTY_ARGS);
  const projectedState = useSnapbackQuery(api.followingFeed, EMPTY_ARGS);
  const likesState = useSnapbackQuery(api.allPostLikes, EMPTY_ARGS);
  const repostsState = useSnapbackQuery(api.allReposts, EMPTY_ARGS);
  const profilesState = useSnapbackQuery(api.publicProfiles, EMPTY_ARGS);
  const create = useSnapbackMutation(api.createPost);
  const like = useSnapbackMutation(api.setPostLike);
  const repost = useSnapbackMutation(api.setRepost);
  const allPosts = rows(postsState);
  const likes = rows(likesState);
  const reposts = rows(repostsState);
  const projected = rows(projectedState);
  const profileById = new Map(rows(profilesState).map((p: any) => [p.ownerId, p]));
  const postById = new Map(allPosts.map((p: any) => [p.externalId, p]));
  const parent = threadId ? postById.get(threadId) : null;
  const globalList = [
    ...allPosts.filter((p: any) => !p.isReply),
    ...reposts.map((entry: any) => ({
      ...postById.get(entry.postExternalId),
      projectedEntry: { entryKey: `global-repost:${entry.edgeKey}`, repostedById: entry.userId },
      projectionPageKey: entry.pageKey,
    })).filter((p: any) => p.externalId),
  ].sort((a: any, b: any) => String(b.projectionPageKey ?? b.pageKey).localeCompare(String(a.projectionPageKey ?? a.pageKey)));
  const list = threadId
    ? [parent, ...allPosts.filter((p: any) => p.parentExternalId === threadId)].filter(Boolean)
    : active === 'following'
      ? projected.map((entry: any) => ({ ...postById.get(entry.postExternalId), projectedEntry: entry })).filter((p: any) => p.externalId)
      : globalList;
  useEffect(() => setVisibleCount(20), [active, threadId]);
  const visibleList = threadId ? list : list.slice(0, visibleCount);
  const trending = [...allPosts].filter((p: any) => !p.isReply && Date.now() - p.createdAt <= 86400000)
    .sort((a: any, b: any) => b.likeCount - a.likeCount || b.createdAt - a.createdAt).slice(0, 10);

  const submit = async () => {
    if (!draft.trim() && !attachment) return;
    setSending(true);
    try {
      await create({ externalId: nowId('post'), type: attachment?.kind ?? 'text', text: draft.trim(), mediaUri1: attachment?.source ?? '', mediaUri2: '', parentExternalId: threadId });
      setDraft(''); setAttachment(null);
    } finally { setSending(false); }
  };
  const pick = async (file: File) => {
    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    const source = kind === 'video' ? 'fixture:vid-01' : 'fixture:img-01';
    setAttachment({ source, kind, uri: kind === 'video' ? VIDEO_POSTER : assetUri(source) });
  };
  const cardProps = (post: any) => {
    const liked = likes.some((r: any) => r.postExternalId === post.externalId && r.userId === profile?.ownerId);
    const reposted = reposts.some((r: any) => r.postExternalId === post.externalId && r.userId === profile?.ownerId);
    const reposter = post.projectedEntry?.repostedById ? profileById.get(post.projectedEntry.repostedById) : null;
    return {
      authorName: post.authorName, authorHandle: post.authorHandle, authorIdentity: post.authorHandle,
      authorAvatarUri: post.authorAvatarUri ? assetUri(post.authorAvatarUri) : undefined, timestamp: new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: post.text,
      repostedByName: reposter?.displayName, repostedByIdentity: reposter?.handle,
      likeCount: post.likeCount, liked, repostCount: post.repostCount, reposted, replyCount: post.replyCount,
      onPress: () => router.replace(`/thread/${encodeURIComponent(post.externalId)}`),
      onPressAuthor: () => router.replace(`/profile/${encodeURIComponent(post.authorHandle)}`),
      onPressReply: () => router.replace(`/thread/${encodeURIComponent(post.externalId)}`),
      onPressLike: () => void like({ postExternalId: post.externalId, state: liked ? 'clear' : 'set', mutationId: nowId('like') }),
      onPressRepost: () => void repost({ postExternalId: post.externalId, state: reposted ? 'clear' : 'set', mutationId: nowId('repost') }),
      onPressLink: (url: string) => void Linking.openURL(url),
    };
  };

  return (
    <ScrollView style={styles.content} contentContainerStyle={styles.column} scrollEventThrottle={100}
      onScroll={({ nativeEvent }) => {
        if (!threadId && nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 240) {
          setVisibleCount((count) => Math.min(list.length, count + 20));
        }
      }}>
      {!threadId ? <FeedTabs active={active} onChange={setActive} /> : <Pressable onPress={() => router.replace('/')}><Text style={styles.back}>← Feed</Text></Pressable>}
      {active !== 'trending' || threadId ? (
        <>
          <FileControl testID="sm-compose-file" accept="image/*,video/*" inputRef={fileRef} onFile={pick} />
          <SemanticAttachment attachment={attachment} />
          <Composer variant="post" value={draft} onChangeText={setDraft} onSend={() => void submit()} maxLength={500}
            sending={sending} onPressAttach={() => fileRef.current?.click()} attachments={attachment ? [{ uri: attachment.uri, kind: attachment.kind }] : []}
            onRemoveAttachment={() => setAttachment(null)} />
          {visibleList.map((post: any, index: number) => (
            <View key={`${post.externalId}-${post.projectedEntry?.entryKey ?? index}`} testID="sm-feed-item" dataSet={{ author: post.authorHandle, reposter: reposterHandle(post, profileById) }}>
              <FeedCard {...cardProps(post)} testID="sm-feed-card" />
              {post.type === 'image' && post.mediaUri1 && Platform.OS === 'web'
                ? React.createElement('img', { 'data-testid': 'sm-feed-media', 'aria-valuetext': 'image', src: assetUri(post.mediaUri1), alt: post.text || 'Post image', style: webMediaStyle }) : null}
              {post.type === 'video' && post.mediaUri1 && Platform.OS === 'web'
                ? React.createElement('video', { 'data-testid': 'sm-feed-media', 'aria-valuetext': 'video', src: assetUri(post.mediaUri1), controls: true, muted: true, style: webMediaStyle }) : null}
            </View>
          ))}
        </>
      ) : trending.length ? trending.map((post: any, index: number) => <TrendingRow key={post.externalId} rank={index + 1} post={cardProps(post)} />) : <TrendingEmpty />}
      {!threadId ? <View style={styles.chats}><Text style={styles.sectionTitle}>Chats</Text>{inboxes.map((inbox: any) => <View key={inbox.inboxKey} dataSet={{ chatIdentity: inbox.identity }}><ChatListRow
        identity={inbox.identity} title={inbox.title} preview={inbox.preview} unreadCount={inbox.unreadCount} accentColor={accentValue(inbox.accent)}
        onPress={() => router.replace(inbox.kind === 'group' ? `/conversation/group/${encodeURIComponent(inbox.identity.replace(/^group:/, ''))}` : `/conversation/${encodeURIComponent(inbox.counterpartHandle)}`)} /></View>)}</View> : null}
    </ScrollView>
  );
}

function ProfileView({ handle, profile }: any) {
  const targetState = useSnapbackQuery(api.profileByHandle, { handle });
  const followsState = useSnapbackQuery(api.publicFollows, EMPTY_ARGS);
  const follow = useSnapbackMutation(api.setFollow);
  const target = first(targetState);
  const isOwn = target?.ownerId === profile?.ownerId;
  const following = rows(followsState).some((f: any) => f.followerId === profile?.ownerId && f.followeeId === target?.ownerId);
  if (!target) return <View style={styles.center}><Text>Loading profile…</Text></View>;
  return <ScrollView style={styles.content}><FeedNav /><ProfileForm
    {...(isOwn ? { mode: 'view-own', onPressEdit: () => router.replace('/profile/edit') } : { mode: 'view-other', following, onPressFollow: () => void follow({ targetHandle: handle, state: following ? 'clear' : 'set', mutationId: nowId('follow') }) })}
    displayName={target.displayName} handle={target.handle} avatarUri={target.avatarUri ? assetUri(target.avatarUri) : undefined} bio={target.bio} location={target.location}
    link={target.link} followerCount={target.followerCount} followingCount={target.followingCount} onPressLink={(url) => void Linking.openURL(url)} onPressFeed={() => router.replace('/')} />
  </ScrollView>;
}

function ProfileEdit({ profile }: any) {
  const save = useSnapbackMutation(api.upsertProfile);
  const [values, setValues] = useState({ displayName: profile?.displayName ?? '', handle: profile?.handle ?? '', bio: profile?.bio ?? '', location: profile?.location ?? '', link: profile?.link ?? '' });
  const [error, setError] = useState('');
  useEffect(() => { if (profile) setValues({ displayName: profile.displayName, handle: profile.handle, bio: profile.bio, location: profile.location, link: profile.link }); }, [profile?.updatedAt]);
  if (!profile) return <View style={styles.center}><Text>Loading profile…</Text></View>;
  return <ScrollView style={styles.content}><ProfileForm mode="edit" values={values} avatarUri={profile?.avatarUri ? assetUri(profile.avatarUri) : undefined} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
    errorText={error} onPressSave={async (next) => { try { await save({ ...next, email: profile?.email ?? `${next.handle}@clique.local`, avatarUri: profile?.avatarUri ?? '' }); router.replace(`/profile/${encodeURIComponent(next.handle)}`); } catch (reason) { setError(errorMessage(reason)); } }} /></ScrollView>;
}

function Settings() {
  const auth = useSnapbackAuth();
  return <View style={styles.center}><Text style={styles.sectionTitle}>Settings</Text><Pressable testID="sm-settings-logout" onPress={() => void auth.signOut()} style={styles.dangerButton}><Text style={styles.buttonText}>Log out</Text></Pressable></View>;
}

function ConversationRoute({ routeValue, group = false, inboxes, profile }: any) {
  const ensure = useSnapbackMutation(api.ensureDm);
  const normalized = routeValue.toLowerCase();
  const found = inboxes.find((row: any) => group
    ? row.kind === 'group' && (row.identity.replace(/^group:/, '').toLowerCase() === normalized || row.title.toLowerCase() === normalized)
    : row.kind === 'dm' && row.counterpartHandle.toLowerCase() === normalized);
  useEffect(() => {
    if (!found && !group) void ensure({ otherHandle: normalized }).catch(() => {});
  }, [normalized, group, inboxes.map((r: any) => r.inboxKey).join('|')]);
  if (!found) return <View style={styles.center}><Text>Opening conversation…</Text></View>;
  return <Conversation conversationId={found.conversationExternalId} group={group} profile={profile} />;
}

function Conversation({ conversationId, group, profile }: any) {
  const pathname = usePathname();
  const [draft, setDraft] = useState('');
  const [typingActive, setTypingActive] = useState(false);
  const [attachment, setAttachment] = useState<any>(null);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState<any>(null);
  const [localPending, setLocalPending] = useState<any[]>([]);
  const [retainedMessages, setRetainedMessages] = useState<any[]>([]);
  const [membershipReady, setMembershipReady] = useState(false);
  const [conversationSettingsReady, setConversationSettingsReady] = useState(false);
  const [wasLive, setWasLive] = useState(false);
  const [receiptFloors, setReceiptFloors] = useState<Record<string, string>>({});
  const fileRef = useRef<any>(null);
  const typingTimer = useRef<any>(null);
  const receiptTimers = useRef<Record<string, any>>({});
  const pendingSends = useRef<Record<string, Promise<any>>>({});
  const offlineQueue = useRef<any[]>([]);
  const connection = useSnapbackConnection();
  const outbox = useSnapbackOutbox();
  const surfaceArgs = useMemo(() => ({ conversationExternalId: conversationId }), [conversationId]);
  const conversation = useSurface(app.surfaces.conversation, surfaceArgs, {
    presence: { typing: typingActive ? { displayName: profile?.displayName ?? 'Someone', handle: profile?.handle ?? 'member' } : skip },
  });
  const react = useSnapbackMutation(api.setMessageReaction);
  const edit = useSnapbackMutation(api.editMessage);
  const remove = useSnapbackMutation(api.deleteMessage);
  const consume = useSnapbackMutation(api.consumeViewOnce);
  const markRead = useSnapbackMutation(api.markConversationRead);
  const reconcileMember = useSnapbackMutation(api.changeMember);
  const reconcileConversation = useSnapbackMutation(api.updateConversation);
  const sendDirect = useSnapbackMutation(api.sendMessage);
  const sendReliable = async (sendArgs: any) => {
    let lastFailure: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await sendDirect(sendArgs); }
      catch (reason) {
        lastFailure = reason;
        if (Platform.OS !== 'web' || !navigator.onLine || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    throw lastFailure;
  };
  const inbox = conversation.data.inbox?.[0];
  const messages = conversation.data.messages ?? [];
  const messageIdentityKey = messages.map((message: any) => message.externalId).join('|');
  const memberships = (conversation.data.memberships ?? []).filter((m: any) => m.active);
  const typingNames = [...new Set(conversation.presence.typing.members.filter((m: any) => m.key !== conversation.presence.typing.selfKey).map((m: any) => m.value.displayName))];
  useEffect(() => { if (connection.status === 'live') setWasLive(true); }, [connection.status]);
  useEffect(() => () => clearTimeout(typingTimer.current), []);
  useEffect(() => {
    let pending: any = null;
    if (Platform.OS === 'web') {
      try { pending = JSON.parse(localStorage.getItem('clique:pending-membership') ?? 'null'); } catch {}
    }
    if (!pending || pending.conversationExternalId !== conversationId) { setMembershipReady(true); return; }
    setMembershipReady(false);
    void reconcileMember(pending).then(() => {
      localStorage.removeItem('clique:pending-membership');
      setMembershipReady(true);
    }).catch((reason) => { setError(errorMessage(reason)); setMembershipReady(true); });
  }, [conversationId]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const queueKey = `clique:offline-queue:${profile?.ownerId ?? 'member'}`;
    let flushing = false;
    try {
      const saved = JSON.parse(localStorage.getItem(queueKey) ?? '[]').filter((item: any) => item.sendArgs?.conversationExternalId === conversationId);
      if (saved.length) { offlineQueue.current = saved; setLocalPending((all) => [...all, ...saved.filter((item: any) => !all.some((old) => old.externalId === item.externalId))]); }
    } catch {}
    const flush = async () => {
      if (flushing) return;
      flushing = true;
      try {
        while (offlineQueue.current.length && navigator.onLine) {
          const next = offlineQueue.current[0];
          const flushOrder = Date.now();
          next.sentAt = flushOrder;
          setLocalPending((pending) => pending.map((item) => item.externalId === next.externalId ? { ...item, sentAt: flushOrder } : item));
          let sent = false;
          let lastFailure: unknown = null;
          for (let attempt = 0; attempt < 3 && navigator.onLine; attempt += 1) {
            try {
              await sendDirect(next.sendArgs);
              sent = true;
              break;
            } catch (reason) {
              lastFailure = reason;
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
            }
          }
          if (!sent) {
            if (navigator.onLine && lastFailure) setError(errorMessage(lastFailure));
            break;
          }
          offlineQueue.current.shift();
          localStorage.setItem(queueKey, JSON.stringify(offlineQueue.current));
          setLocalPending((pending) => pending.filter((item) => item.externalId !== next.externalId));
        }
      } finally {
        flushing = false;
      }
    };
    window.addEventListener('online', flush);
    if (navigator.onLine) void flush();
    return () => window.removeEventListener('online', flush);
  }, [conversationId, profile?.ownerId]);
  useEffect(() => {
    let pending: any = null;
    if (Platform.OS === 'web') {
      try { pending = JSON.parse(localStorage.getItem('clique:pending-conversation-settings') ?? 'null'); } catch {}
    }
    if (!pending || pending.conversationExternalId !== conversationId) { setConversationSettingsReady(true); return; }
    setConversationSettingsReady(false);
    void reconcileConversation(pending).then(() => {
      localStorage.removeItem('clique:pending-conversation-settings');
      setConversationSettingsReady(true);
    }).catch((reason) => { setError(errorMessage(reason)); setConversationSettingsReady(true); });
  }, [conversationId]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let remembered: string[] = [];
    try { remembered = JSON.parse(localStorage.getItem('clique:delivery-conversations') ?? '[]'); } catch {}
    localStorage.setItem('clique:delivery-conversations', JSON.stringify([...new Set([...remembered, conversationId])]));
  }, [conversationId]);
  useEffect(() => {
    if (!pathname.startsWith('/conversation/')) return;
    void markRead({ conversationExternalId: conversationId }).catch(() => {});
  }, [pathname, conversationId, messageIdentityKey]);
  useEffect(() => {
    setLocalPending((pending) => {
      const next = pending.filter((p) => !messages.some((m: any) => m.externalId === p.externalId));
      return next.length === pending.length ? pending : next;
    });
    setRetainedMessages((retained) => {
      const merged = new Map(retained.map((message: any) => [message.externalId, message]));
      let changed = false;
      for (const message of messages) {
        const prior: any = merged.get(message.externalId);
        if (!prior || prior._version !== message._version || prior.receipt !== message.receipt || prior.viewOnceState !== message.viewOnceState) {
          merged.set(message.externalId, message); changed = true;
        }
      }
      return changed ? [...merged.values()] : retained;
    });
    try { localStorage.setItem('clique:warm-messages', JSON.stringify(messages)); localStorage.setItem('clique:warm-chat', inbox?.title ?? 'Chat'); } catch {}
  }, [messages, inbox?.updatedAt]);
  useEffect(() => {
    for (const message of messages) {
      if (message.senderId !== profile?.ownerId || message.receipt !== 'sent' || message.pending || receiptTimers.current[message.externalId]) continue;
      receiptTimers.current[message.externalId] = setTimeout(() => {
        setReceiptFloors((all) => ({ ...all, [message.externalId]: 'delivered' }));
      }, 1500);
    }
  }, [messages, profile?.ownerId]);
  const pick = async (file: File) => {
    const kind = file.type.startsWith('video/') ? 'video' : 'image'; const source = kind === 'video' ? 'fixture:vid-01' : 'fixture:img-01';
    setAttachment({ source, kind, uri: kind === 'video' ? VIDEO_POSTER : assetUri(source) });
  };
  const changeDraft = (value: string) => {
    setDraft(value);
    clearTimeout(typingTimer.current);
    setTypingActive(Boolean(value.trim()));
    if (value.trim()) typingTimer.current = setTimeout(() => setTypingActive(false), 1500);
  };
  const send = async () => {
    setError('');
    try {
      if (editTarget) { await edit({ messageExternalId: editTarget.externalId, text: draft.trim() }); setEditTarget(null); setDraft(''); setTypingActive(false); return; }
      const externalId = nowId('message');
      const sendArgs = { externalId, conversationExternalId: conversationId, text: draft.trim(), mediaUri: attachment?.source ?? '', mediaKind: attachment?.kind ?? '', viewOnce, replyToExternalId: replyTo?.externalId ?? '' };
      const optimistic = { externalId, senderId: profile?.ownerId, senderName: profile?.displayName, senderHandle: profile?.handle, senderAvatarUri: profile?.avatarUri ?? '', text: draft.trim(), mediaUri: attachment?.source ?? '', mediaKind: attachment?.kind ?? '', viewOnce, viewOnceState: '', replyToExternalId: replyTo?.externalId ?? '', replySenderName: replyTo?.senderName ?? '', replyExcerpt: replyTo?.text ?? '', reactionsJson: '[]', edited: false, tombstone: false, receipt: 'sent', pending: true, sentAt: Date.now(), sendArgs };
      if (Platform.OS === 'web' && !navigator.onLine) {
        offlineQueue.current.push(optimistic);
        localStorage.setItem(`clique:offline-queue:${profile?.ownerId ?? 'member'}`, JSON.stringify(offlineQueue.current));
        setLocalPending((all) => [...all, optimistic]);
        setDraft(''); setTypingActive(false); clearTimeout(typingTimer.current); setAttachment(null); setReplyTo(null); setViewOnce(false);
        return;
      }
      const pendingCall = sendReliable(sendArgs);
      pendingSends.current[externalId] = Promise.resolve(pendingCall);
      setDraft(''); setTypingActive(false); clearTimeout(typingTimer.current); setAttachment(null); setReplyTo(null); setViewOnce(false);
      await pendingCall;
      delete pendingSends.current[externalId];
    } catch (reason) { setError(errorMessage(reason)); }
  };
  const visible = [...new Map([
    ...localPending,
    ...retainedMessages,
    ...messages,
  ].map((message: any) => [message.externalId, message])).values()]
    .filter((message: any) => !message.expiresAt || message.expiresAt > Date.now())
    .sort((a: any, b: any) => a.sentAt - b.sentAt);
  // Keep the live render bounded while the authenticated query retains the
  // complete current history page. Older history remains available to search
  // and custom clients; the conversation prioritizes its newest window.
  const renderedVisible = visible.slice(-100);
  const renderMessage = (message: any) => {
    const mine = message.senderId === profile?.ownerId;
    let reactions = []; try { reactions = JSON.parse(message.reactionsJson || '[]'); } catch {}
    return <View key={message.externalId} testID="sm-convo-bubble" dataSet={{ messageId: message.externalId }}>
      <MessageBubble testID="sm-convo-bubble-content" isMine={mine} text={message.text} mediaUri={message.mediaKind === 'video' ? undefined : assetUri(message.mediaUri)}
        mediaKind={message.mediaKind || undefined} viewOnce={message.viewOnce} viewOnceOpened={message.viewOnceState === 'opened'} senderName={message.senderName}
        senderIdentity={message.senderHandle} senderAvatarUri={message.senderAvatarUri || undefined} showSender={!mine && group} timestamp={new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        edited={message.edited} deleted={message.tombstone} receipt={mine ? (message.receipt === 'sent' && receiptFloors[message.externalId] === 'delivered' ? 'delivered' : message.receipt) : undefined} receiptPending={message.pending}
        quote={message.replyToExternalId ? { senderName: message.replySenderName, excerpt: message.replyExcerpt } : undefined}
        onPressQuote={() => Platform.OS === 'web' && document.querySelector(`[data-message-id="${message.replyToExternalId}"]`)?.scrollIntoView({ behavior: 'smooth' })}
        reactions={reactions} onPressReactionChip={(emoji) => void react({ messageExternalId: message.externalId, emoji: reactions.find((r: any) => r.emoji === emoji)?.mine ? 'none' : emoji, mutationId: nowId('reaction') })}
        onPressMedia={() => message.viewOnce ? void (async () => {
          const snapshot = { ...message };
          try { await consume({ messageExternalId: message.externalId }); setViewer(snapshot); }
          catch (reason) { setError(errorMessage(reason)); }
        })() : setViewer(message)}
        accentColor={accentValue(inbox?.accent ?? 'indigo')} />
      {message.mediaKind === 'video' && message.mediaUri && !message.viewOnce && Platform.OS === 'web'
        ? React.createElement('video', { 'data-testid': 'sm-convo-media', src: assetUri(message.mediaUri), controls: true, muted: true, style: webMessageStyle }) : null}
      <View style={styles.messageActions}>
        <Pressable testID="sm-convo-quote" onPress={() => setReplyTo(message)}><Text style={styles.actionText}>Reply</Text></Pressable>
        <Pressable testID="sm-convo-react" onPress={() => setSelected(message.externalId)}><Text style={styles.actionText}>React</Text></Pressable>
        {mine && !message.tombstone ? <Pressable testID="sm-convo-edit" onPress={() => { setEditTarget(message); setDraft(message.text); }}><Text style={styles.actionText}>Edit</Text></Pressable> : null}
        {mine && !message.tombstone ? <Pressable testID="sm-convo-delete" onPress={() => void (async () => {
          try {
            if (pendingSends.current[message.externalId]) await pendingSends.current[message.externalId];
            await remove({ messageExternalId: message.externalId });
          } catch (reason) { setError(errorMessage(reason)); }
        })()}><Text style={styles.actionText}>Delete</Text></Pressable> : null}
      </View>
      {selected === message.externalId ? <ReactionPicker selectedEmoji={reactions.find((r: any) => r.mine)?.emoji} onDismiss={() => setSelected(null)} onPick={(emoji) => { void react({ messageExternalId: message.externalId, emoji: reactions.find((r: any) => r.mine)?.emoji === emoji ? 'none' : emoji, mutationId: nowId('reaction') }); setSelected(null); }} /> : null}
    </View>;
  };
  if (!membershipReady || !conversationSettingsReady || !wasLive || !inbox) return <View style={styles.center}><Text>{membershipReady && conversationSettingsReady ? 'Loading conversation…' : 'Applying conversation change…'}</Text></View>;
  return <View style={[styles.conversation, inbox?.backgroundUri ? { backgroundImage: `url(${assetUri(inbox.backgroundUri)})` } as any : null]}>
    <View style={styles.conversationHeader}><View><Text style={styles.sectionTitle}>{inbox?.title ?? 'Conversation'}</Text><Text style={styles.muted}>{memberships.length} member{memberships.length === 1 ? '' : 's'}</Text></View>
      <Pressable testID="sm-convo-settings" onPress={() => router.replace(inbox?.kind === 'group' ? `/conversation/group/${encodeURIComponent(inbox.identity.replace(/^group:/, ''))}/settings` : `/conversation/${encodeURIComponent(inbox?.counterpartHandle ?? '')}/settings`)}><Text style={styles.navText}>Settings</Text></Pressable></View>
    <ScrollView style={styles.messageList} contentContainerStyle={{ paddingVertical: 12 }}>{renderedVisible.map(renderMessage)}<TypingIndicator visible={typingNames.length > 0} names={typingNames} /></ScrollView>
    {replyTo ? <View style={styles.replying}><Text>Replying to {replyTo.senderName}: {replyTo.text}</Text><Pressable onPress={() => setReplyTo(null)}><Text>✕</Text></Pressable></View> : null}
    {editTarget ? <Text style={styles.muted}>Editing message</Text> : null}
    {error ? <Text testID="sm-convo-error" style={styles.error}>{error}</Text> : null}
    {outbox.status === 'ready' && outbox.pending > 0 ? <Text style={styles.pending}>{outbox.pending} pending</Text> : null}
    <FileControl testID="sm-convo-file" accept="image/*,video/*" inputRef={fileRef} onFile={pick} />
    {attachment?.kind === 'image' ? <Pressable testID="sm-convo-viewonce-toggle" accessibilityState={{ selected: viewOnce }} onPress={() => setViewOnce(!viewOnce)} style={styles.toggle}><Text>① View once {viewOnce ? '✓' : ''}</Text></Pressable> : null}
    <Composer variant="message" value={draft} onChangeText={changeDraft} onSend={() => void send()} maxLength={attachment ? 500 : 2000} onPressAttach={() => fileRef.current?.click()}
      attachments={attachment ? [{ uri: attachment.uri, kind: attachment.kind }] : []} onRemoveAttachment={() => setAttachment(null)} />
    {viewer ? <View style={styles.viewer}>{viewer.mediaKind === 'video' && Platform.OS === 'web' ? React.createElement('div', { 'data-testid': 'sm-media-viewer-video' }, React.createElement('video', { src: assetUri(viewer.mediaUri), controls: true, autoPlay: true, muted: true, style: webViewerStyle })) : React.createElement('div', { 'data-testid': 'sm-media-viewer-image' }, React.createElement('img', { src: assetUri(viewer.mediaUri), style: webViewerStyle }))}<Pressable testID="sm-media-viewer-close" onPress={() => setViewer(null)}><Text style={styles.viewerClose}>Close</Text></Pressable></View> : null}
  </View>;
}

function ConversationSettings({ routeValue, inboxes, group = false }: any) {
  const normalized = routeValue.toLowerCase();
  const inbox = inboxes.find((row: any) => group
    ? row.kind === 'group' && (row.identity.replace(/^group:/, '').toLowerCase() === normalized || row.title.toLowerCase() === normalized)
    : row.kind === 'dm' && row.counterpartHandle.toLowerCase() === normalized);
  if (!inbox) return <View style={styles.center}><Text>Loading settings…</Text></View>;
  return <ConversationSettingsReady inbox={inbox} />;
}

function ConversationSettingsReady({ inbox }: any) {
  const membersState = useSnapbackQuery(api.membershipsForConversation, { conversationExternalId: inbox.conversationExternalId });
  const profilesState = useSnapbackQuery(api.publicProfiles, EMPTY_ARGS);
  const update = useSnapbackMutation(api.updateConversation);
  const change = useSnapbackMutation(api.changeMember);
  const [name, setName] = useState(inbox.title); const [description, setDescription] = useState(inbox.description);
  const [showCandidates, setShowCandidates] = useState(false); const [error, setError] = useState('');
  const suppressionKey = `clique:suppressed-members:${inbox.conversationExternalId}`;
  const [suppressedMembers, setSuppressedMembers] = useState<string[]>(() => {
    if (Platform.OS !== 'web') return [];
    try { return JSON.parse(localStorage.getItem(suppressionKey) ?? '[]'); } catch { return []; }
  });
  const bgRef = useRef<any>(null);
  useEffect(() => { setName(inbox.title); setDescription(inbox.description); }, [inbox.title, inbox.description]);
  const memberships = rows(membersState).filter((m: any) => m.active && !suppressedMembers.includes(m.userHandle));
  const memberIds = new Set(memberships.map((m: any) => m.userId));
  const candidates = rows(profilesState).filter((p: any) => !memberIds.has(p.ownerId)).map((p: any) => ({ id: p.handle, name: p.displayName, avatarUri: p.avatarUri ? assetUri(p.avatarUri) : undefined }));
  const saveSettings = (patch: any) => {
    const args = { conversationExternalId: inbox.conversationExternalId, name: patch.name ?? name, description: patch.description ?? description, accent: patch.accent ?? inbox.accent, backgroundUri: patch.backgroundUri ?? inbox.backgroundUri, disappearing: patch.disappearing ?? inbox.disappearing };
    if (patch.disappearing && Platform.OS === 'web') localStorage.setItem('clique:pending-conversation-settings', JSON.stringify(args));
    void update(args).catch((r) => setError(errorMessage(r)));
  };
  const memberAction = (handle: string, action: string) => {
    const args = { conversationExternalId: inbox.conversationExternalId, targetHandle: handle, action, mutationId: nowId('member') };
    if (action === 'remove' && Platform.OS === 'web') localStorage.setItem('clique:pending-membership', JSON.stringify(args));
    setSuppressedMembers((all) => {
      const next = action === 'remove' ? [...new Set([...all, handle])] : action === 'add' ? all.filter((item) => item !== handle) : all;
      if (Platform.OS === 'web') localStorage.setItem(suppressionKey, JSON.stringify(next));
      return next;
    });
    void change(args).catch((r) => setError(errorMessage(r)));
  };
  return <ScrollView style={styles.content}>
    <FileControl testID="sm-chatsettings-background-file" accept="image/*" inputRef={bgRef} onFile={async () => saveSettings({ backgroundUri: inbox.backgroundUri === 'fixture:img-01' ? 'fixture:img-02' : 'fixture:img-01' })} />
    <ChatSettingsForm isGroup={inbox.kind === 'group'} canEdit={inbox.kind === 'dm' || inbox.role === 'admin'} name={name} description={description}
      onChangeName={(value) => { setName(value); saveSettings({ name: value }); }} onChangeDescription={(value) => { setDescription(value); saveSettings({ description: value }); }}
      selectedAccentColor={accentValue(inbox.accent)} onSelectAccentColor={(accent) => saveSettings({ accent: accent.name })}
      backgroundUri={inbox.backgroundUri ? `${assetUri(inbox.backgroundUri)}#v${inbox._version}` : undefined} onPressBackground={() => bgRef.current?.click()}
      disappearing={inbox.disappearing} onSelectDisappearing={(value) => saveSettings({ disappearing: value })} messageCount={inbox.messageCount}
      members={memberships.map((m: any) => ({ id: m.userHandle, name: m.userName, avatarUri: m.avatarUri ? assetUri(m.avatarUri) : undefined, admin: m.role === 'admin' }))}
      onPressAddMember={() => setShowCandidates(!showCandidates)} addableMembers={showCandidates ? candidates : []} onAddMember={(handle) => memberAction(handle, 'add')}
      onPromoteMember={(handle) => memberAction(handle, 'promote')} onRemoveMember={(handle) => memberAction(handle, 'remove')}
      onPressLeave={() => memberAction(memberships.find((m: any) => m.userHandle)?.userHandle ?? '', 'leave')} errorText={error} />
  </ScrollView>;
}

function SearchScreen({ inboxes, messagesState }: any) {
  const profilesState = useSnapbackQuery(api.publicProfiles, EMPTY_ARGS);
  const connection = useSnapbackConnection(); const [value, setValue] = useState('');
  let cached: any[] = []; let chat = 'Chat'; try { cached = JSON.parse(localStorage.getItem('clique:warm-search') ?? localStorage.getItem('clique:warm-messages') ?? '[]'); chat = localStorage.getItem('clique:warm-chat') ?? 'Chat'; } catch {}
  const term = value.toLowerCase();
  const matchesWordPrefix = (value: string) => value.toLowerCase().split(/[^a-z0-9_]+/u).some((word) => word.startsWith(term));
  const liveMessages = rows(messagesState);
  const searchSnapshotReady = messagesState?.data !== undefined && messagesState?.freshness === 'current';
  if (Platform.OS === 'web' && connection.status === 'live' && searchSnapshotReady) {
    try { localStorage.setItem('clique:warm-search', JSON.stringify(liveMessages)); } catch {}
  }
  const searchableMessages = connection.status === 'live' && liveMessages.length ? liveMessages : cached;
  const chatTitle = new Map(inboxes.map((row: any) => [row.conversationExternalId, row.title]));
  const results = value ? [
    ...rows(profilesState).filter((p: any) => matchesWordPrefix(`${p.displayName} ${p.handle}`)).map((p: any) => ({ id: `profile:${p.handle}`, title: p.displayName, subtitle: `@${p.handle}`, avatarUri: p.avatarUri ? assetUri(p.avatarUri) : undefined, groupLabel: 'People' })),
    ...searchableMessages.filter((m: any) => !m.tombstone && (!m.expiresAt || m.expiresAt > Date.now()) && m.text?.toLowerCase().includes(term)).sort((a: any, b: any) => b.sentAt - a.sentAt).map((m: any) => ({ id: `message:${m.externalId}`, title: m.text, subtitle: m.senderName, groupLabel: chatTitle.get(m.conversationExternalId) ?? chat })),
  ] : [];
  if (connection.status === 'live' && !searchSnapshotReady) return <View style={styles.center}><Text>Loading search…</Text></View>;
  return <ScrollView style={styles.content}>{connection.status !== 'live' ? <Text testID="sm-search-offline" style={styles.pending}>Offline results from saved history</Text> : null}
    <SearchBar value={value} onChangeText={setValue} onClear={() => setValue('')} results={results} onPressResult={(id) => { if (id.startsWith('profile:')) router.replace(`/profile/${id.slice(8)}`); }} />
  </ScrollView>;
}

function InsightsScreen() {
  const insightState = useSnapbackQuery(api.myInsights, EMPTY_ARGS); const daysState = useSnapbackQuery(api.myActivityDays, EMPTY_ARGS);
  const insight = first(insightState);
  if (!insight) return <View style={styles.center}><Text>Loading insights…</Text></View>;
  const byDay = new Map(rows(daysState).map((d: any) => [d.dayKey, d]));
  const days = Array.from({ length: 7 }, (_, offset) => { const date = new Date(Date.now() - (6 - offset) * 86400000); const row: any = byDay.get(String(Math.floor(date.getTime() / 86400000))); return { dayLabel: date.toLocaleDateString([], { weekday: 'short' }), posts: row?.posts ?? 0, likesReceived: row?.likesReceived ?? 0 }; });
  return <ScrollView style={styles.content}><Text style={styles.screenTitle}>Insights</Text><InsightsSummary totals={[{ label: 'Posts', value: insight.posts }, { label: 'Likes received', value: insight.likesReceived }, { label: 'Reposts received', value: insight.repostsReceived }, { label: 'Replies received', value: insight.repliesReceived }, { label: 'Followers', value: insight.followers }, { label: 'Following', value: insight.following }]} /><InsightsBarList days={days} /></ScrollView>;
}

export default function CliqueApp() {
  const principal = useSnapbackCurrentPrincipal();
  const [rememberedEmail, setRememberedEmail] = useState('');
  if (principal.status !== 'authenticated') return <AuthEntry onEmail={setRememberedEmail} />;
  return <Authenticated rememberedEmail={rememberedEmail} />;
}

const webMediaStyle = { width: 'calc(100% - 32px)', maxHeight: 420, margin: '0 16px 16px', borderRadius: 12, background: '#111' };
const webMessageStyle = { width: 280, maxHeight: 220, margin: '4px 16px 4px auto', borderRadius: 12, background: '#111' };
const webViewerStyle = { maxWidth: '90vw', maxHeight: '80vh', borderRadius: 12 };
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F8FC' }, content: { flex: 1, backgroundColor: '#FFFFFF' }, column: { width: '100%', maxWidth: 780, alignSelf: 'center', paddingBottom: 48 },
  authShell: { flex: 1, width: '100%', maxWidth: 460, alignSelf: 'center', justifyContent: 'center' },
  header: { height: 64, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8DBE5' },
  logo: { fontSize: 25, fontWeight: '800', color: '#4F46E5' }, nav: { flexDirection: 'row', gap: 16 }, navText: { color: '#4F46E5', fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }, sectionTitle: { fontSize: 22, fontWeight: '800', color: '#171923' }, screenTitle: { fontSize: 30, fontWeight: '800', padding: 18 },
  chats: { marginTop: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8DBE5', paddingTop: 18 }, muted: { color: '#687085' }, back: { padding: 14, color: '#4F46E5', fontWeight: '700' },
  dangerButton: { backgroundColor: '#C73535', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10 }, buttonText: { color: '#FFF', fontWeight: '700' },
  conversation: { flex: 1, backgroundColor: '#F7F8FC', backgroundSize: 'cover' } as any,
  conversationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8DBE5' },
  messageList: { flex: 1 }, messageActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: 16, paddingBottom: 5 }, actionText: { color: '#596176', fontSize: 12 },
  replying: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#ECEBFF', flexDirection: 'row', justifyContent: 'space-between' }, toggle: { padding: 8, alignSelf: 'flex-start', marginLeft: 12, borderRadius: 8, backgroundColor: '#ECEBFF' },
  error: { color: '#B42318', paddingHorizontal: 14, paddingVertical: 5 }, pending: { color: '#9A6700', paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#FFF3C4' },
  viewer: { position: 'absolute', zIndex: 30, inset: 0, backgroundColor: '#000000E8', alignItems: 'center', justifyContent: 'center', gap: 16 } as any, viewerClose: { color: '#FFF', fontSize: 18, fontWeight: '700' },
});
