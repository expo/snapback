import {
  createBoundaryContractDataProvider,
  createContractMockQueryBoundary,
  type ContractDataManifest,
  type ContractDataProvider,
  type ContractQueryBoundary,
} from '@exact/contract/runtime';

import manifestJson from './generated/coterie-memory.manifest.json';
import type {
  Chat,
  FeedItem,
  InsightDay,
  Message,
  Profile,
  SearchResult,
  Session,
} from './generated/coterie-memory.types.ts';

export const coterieMemoryManifest = manifestJson as unknown as ContractDataManifest;

const VIEWER_ID = 'alice';
const FIXTURE_NOW = '2026-01-01T00:01:30.000Z';
const ACCENT_COLORS = new Set([
  '#4F46E5',
  '#0D9488',
  '#EF6351',
  '#D97706',
  '#7C3AED',
  '#059669',
  '#E11D48',
  '#475569',
]);
const DISAPPEARING_VALUES = new Set(['off', '24h', '7d']);

interface FollowEdge {
  id: string;
  followerId: string;
  followedId: string;
}

interface LikeEvent {
  actorId: string;
  createdAt: string;
  mutationId: string;
}

interface MemoryFeedItem extends FeedItem {
  authorFollowedByMe: boolean;
  likeEvents: LikeEvent[];
}

const initialSession: Session[] = [
  { id: 'session-alice', userId: VIEWER_ID, signedIn: true },
];

const initialFollowEdges: FollowEdge[] = [
  { id: 'mf-alice-bob', followerId: 'alice', followedId: 'bob' },
  { id: 'mf-alice-carol', followerId: 'alice', followedId: 'carol' },
  { id: 'mf-bob-alice', followerId: 'bob', followedId: 'alice' },
  { id: 'mf-bob-dave', followerId: 'bob', followedId: 'dave' },
  { id: 'mf-carol-alice', followerId: 'carol', followedId: 'alice' },
  { id: 'mf-dave-erin', followerId: 'dave', followedId: 'erin' },
  { id: 'mf-erin-alice', followerId: 'erin', followedId: 'alice' },
  { id: 'mf-erin-frank', followerId: 'erin', followedId: 'frank' },
  { id: 'mf-frank-grace', followerId: 'frank', followedId: 'grace' },
  { id: 'mf-grace-alice', followerId: 'grace', followedId: 'alice' },
  { id: 'mf-henry-bob', followerId: 'henry', followedId: 'bob' },
  { id: 'mf-henry-grace', followerId: 'henry', followedId: 'grace' },
];

const initialProfiles: Profile[] = [
  {
    id: 'alice',
    handle: 'alice',
    displayName: 'Alice Alvarez',
    bio: 'Coffee, cameras, and neighborhood walks.',
    avatarUrl: '/assets/fixtures/avatar-alice.png',
    followers: 4,
    following: 2,
    followedByMe: false,
    isMe: true,
  },
  {
    id: 'bob',
    handle: 'bob',
    displayName: 'Bob Bennett',
    bio: 'Bikes, bread, and tiny software tools.',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
    followers: 2,
    following: 2,
    followedByMe: true,
    isMe: false,
  },
  {
    id: 'carol',
    handle: 'carol',
    displayName: 'Carol Chen',
    bio: 'Ceramics student and relentless list maker.',
    avatarUrl: '/assets/fixtures/avatar-alice.png',
    followers: 1,
    following: 1,
    followedByMe: true,
    isMe: false,
  },
  {
    id: 'dave',
    handle: 'dave',
    displayName: 'Dave Diaz',
    bio: 'Live music, trail maps, and spicy noodles.',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
    followers: 1,
    following: 1,
    followedByMe: false,
    isMe: false,
  },
  {
    id: 'erin',
    handle: 'erin',
    displayName: 'Erin Evans',
    bio: 'Designing kinder interfaces and growing herbs.',
    avatarUrl: '/assets/fixtures/avatar-alice.png',
    followers: 1,
    following: 2,
    followedByMe: false,
    isMe: false,
  },
  {
    id: 'frank',
    handle: 'frank',
    displayName: 'Frank Flores',
    bio: 'Weekend cook and weekday data wrangler.',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
    followers: 1,
    following: 1,
    followedByMe: false,
    isMe: false,
  },
  {
    id: 'grace',
    handle: 'grace',
    displayName: 'Grace Green',
    bio: 'Gardens, graphic novels, and good questions.',
    avatarUrl: '/assets/fixtures/avatar-alice.png',
    followers: 2,
    following: 1,
    followedByMe: false,
    isMe: false,
  },
  {
    id: 'henry',
    handle: 'henry',
    displayName: 'Henry Hall',
    bio: 'History podcasts and pickup basketball.',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
    followers: 0,
    following: 2,
    followedByMe: false,
    isMe: false,
  },
];

const profileById = new Map(initialProfiles.map((profile) => [profile.id, profile]));

const likeEventsByPost: Readonly<Record<string, readonly LikeEvent[]>> = {
  sp0001: [
    { actorId: 'bob', createdAt: '2026-01-01T00:00:56Z', mutationId: 'ml-bob-sp0001' },
    { actorId: 'carol', createdAt: '2026-01-01T00:00:57Z', mutationId: 'ml-carol-sp0001' },
  ],
  sp0004: [
    { actorId: 'dave', createdAt: '2026-01-01T00:00:58Z', mutationId: 'ml-dave-sp0004' },
  ],
  sp0007: [
    { actorId: 'erin', createdAt: '2026-01-01T00:00:59Z', mutationId: 'ml-erin-sp0007' },
  ],
  sp0013: [
    { actorId: 'frank', createdAt: '2026-01-01T00:01:00Z', mutationId: 'ml-frank-sp0013' },
  ],
  sp0016: [
    { actorId: 'grace', createdAt: '2026-01-01T00:01:01Z', mutationId: 'ml-grace-sp0016' },
  ],
  sp0019: [
    { actorId: 'henry', createdAt: '2026-01-01T00:01:02Z', mutationId: 'ml-henry-sp0019' },
  ],
  sp0022: [
    { actorId: 'alice', createdAt: '2026-01-01T00:01:03Z', mutationId: 'ml-alice-sp0022' },
  ],
};

const replyCounts: Readonly<Record<string, number>> = {
  sp0001: 1,
  sp0004: 1,
  sp0013: 1,
  sp0022: 1,
};

const repostCounts: Readonly<Record<string, number>> = {
  sp0001: 1,
  sp0004: 1,
  sp0013: 1,
  sp0019: 1,
};

function fixturePost(
  id: string,
  authorId: string,
  body: string,
  second: number,
  mediaUrl: string | null = null,
): MemoryFeedItem {
  const profile = profileById.get(authorId);
  if (!profile) throw new Error(`Missing fixture profile ${authorId}`);
  const likeEvents = (likeEventsByPost[id] ?? []).map((event) => ({ ...event }));
  return {
    id,
    authorId,
    authorName: profile.displayName,
    authorHandle: profile.handle,
    avatarUrl: profile.avatarUrl,
    body,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
    likeCount: likeEvents.length,
    repostCount: repostCounts[id] ?? 0,
    replyCount: replyCounts[id] ?? 0,
    likedByMe: likeEvents.some((event) => event.actorId === VIEWER_ID),
    mediaUrl,
    mediaKind: mediaUrl ? 'image' : null,
    pollQuestion: null,
    authorFollowedByMe: initialFollowEdges.some(
      (edge) => edge.followerId === VIEWER_ID && edge.followedId === authorId,
    ),
    likeEvents,
  };
}

// Exact starter-log content, newest first. Video rows are staged until the
// media component can render the pack's MP4 honestly on every Exact host.
const initialPosts: MemoryFeedItem[] = [
  fixturePost('sp0024', 'henry', 'Brooklyn looked silver after rain.', 51),
  fixturePost('sp0023', 'henry', 'Pickup game moved to six.', 50),
  fixturePost('sp0022', 'henry', 'A history episode for the train ride.', 49),
  fixturePost('sp0021', 'grace', 'Questions for the garden club.', 48),
  fixturePost('sp0020', 'grace', 'A graphic novel with perfect pacing.', 47, '/assets/fixtures/img-02.png'),
  fixturePost('sp0019', 'grace', 'The tomatoes are showing off.', 46),
  fixturePost('sp0018', 'frank', 'Sunday lunch test number four.', 45),
  fixturePost('sp0017', 'frank', 'Data cleanup can be satisfying.', 44),
  fixturePost('sp0016', 'frank', 'Beans, tomatoes, and too much garlic.', 43),
  fixturePost('sp0015', 'erin', 'Three interface details I keep noticing.', 42),
  fixturePost('sp0014', 'erin', 'Sketching a calmer settings screen.', 41, '/assets/fixtures/img-02.png'),
  fixturePost('sp0013', 'erin', 'Basil has officially taken over.', 40),
  fixturePost('sp0012', 'dave', 'Noodles worth crossing town for.', 39),
  fixturePost('sp0011', 'dave', 'Trail conditions: dry and windy.', 38),
  fixturePost('sp0010', 'dave', "Tonight's set starts at eight.", 37),
  fixturePost('sp0008', 'carol', 'Studio shelf before cleanup.', 35, '/assets/fixtures/img-02.png'),
  fixturePost('sp0007', 'carol', 'The blue glaze finally worked.', 34),
  fixturePost('sp0006', 'bob', 'Small tools should have sharp edges.', 33),
  fixturePost('sp0005', 'bob', 'Bike route notes for Saturday.', 32),
  fixturePost('sp0004', 'bob', 'Fresh bread, still warm.', 31),
  fixturePost('sp0002', 'alice', "Two colors from this morning's walk.", 29, '/assets/fixtures/img-02.png'),
  fixturePost('sp0001', 'alice', 'Coffee time at the corner table https://example.com/cafe', 28),
];

const initialChats: Chat[] = [
  {
    id: 'd-alice-bob',
    title: 'Bob Bennett',
    preview: 'On my way.',
    updatedAt: '2026-01-01T00:01:17Z',
    unreadCount: 0,
    isGroup: false,
    accentColor: '#4F46E5',
    disappearing: 'off',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
  },
  {
    id: 'g-starter',
    title: 'Weekend Plans',
    preview: 'Locked in. See you Saturday.',
    updatedAt: '2026-01-01T00:01:26Z',
    unreadCount: 0,
    isGroup: true,
    accentColor: '#0D9488',
    disappearing: 'off',
    avatarUrl: null,
  },
];

const fixtureMessageRows = [
  ['sm0001', 'd-alice-bob', 'alice', 'Coffee after work?', '2026-01-01T00:01:12Z', null],
  ['sm0002', 'd-alice-bob', 'bob', 'Yes. Corner place?', '2026-01-01T00:01:13Z', 'Coffee after work?'],
  ['sm0003', 'd-alice-bob', 'alice', 'Exactly. Six thirty.', '2026-01-01T00:01:14Z', 'Yes. Corner place?'],
  ['sm0004', 'd-alice-bob', 'bob', 'I will bring the route map.', '2026-01-01T00:01:15Z', null],
  ['sm0005', 'd-alice-bob', 'alice', 'Perfect, see you there.', '2026-01-01T00:01:16Z', null],
  ['sm0006', 'd-alice-bob', 'bob', 'On my way.', '2026-01-01T00:01:17Z', 'Perfect, see you there.'],
  ['sm0007', 'g-starter', 'alice', 'Saturday plan: coffee, lake, then noodles.', '2026-01-01T00:01:18Z', null],
  ['sm0008', 'g-starter', 'carol', 'Coffee is a definite yes.', '2026-01-01T00:01:19Z', 'Saturday plan: coffee, lake, then noodles.'],
  ['sm0009', 'g-starter', 'dave', 'I can meet everyone at ten.', '2026-01-01T00:01:20Z', null],
  ['sm0010', 'g-starter', 'bob', 'The west trail is dry now.', '2026-01-01T00:01:21Z', null],
  ['sm0011', 'g-starter', 'alice', 'West trail it is.', '2026-01-01T00:01:22Z', 'The west trail is dry now.'],
  ['sm0012', 'g-starter', 'carol', 'I will bring snacks.', '2026-01-01T00:01:23Z', null],
  ['sm0013', 'g-starter', 'dave', 'Should I book dinner?', '2026-01-01T00:01:24Z', null],
  ['sm0014', 'g-starter', 'bob', 'Please do, for four.', '2026-01-01T00:01:25Z', 'Should I book dinner?'],
  ['sm0015', 'g-starter', 'alice', 'Locked in. See you Saturday.', '2026-01-01T00:01:26Z', null],
] as const;

const initialMessages: Message[] = fixtureMessageRows.map(
  ([id, chatId, senderId, body, createdAt, quoteText]) => ({
    id,
    chatId,
    senderId,
    senderName: profileById.get(senderId)?.displayName ?? senderId,
    body,
    createdAt,
    mine: senderId === VIEWER_ID,
    status: 'sent',
    quoteText,
    edited: false,
    deleted: false,
  }),
);

const initialSearch: SearchResult[] = [
  ...initialProfiles.map((profile) => ({
    id: profile.id,
    kind: 'person',
    title: profile.displayName,
    subtitle: `@${profile.handle}`,
    avatarUrl: profile.avatarUrl,
  })),
  ...initialChats.map((chat) => ({
    id: chat.id,
    kind: 'chat',
    title: chat.title,
    subtitle: chat.isGroup ? 'Group conversation' : 'Direct conversation',
    avatarUrl: chat.avatarUrl,
  })),
];

function cloneRows<T>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

function matchesWordPrefix(text: string, query: string): boolean {
  const needle = query.normalize('NFC').trim().toLocaleLowerCase('en-US');
  if (!needle) return true;
  return text
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
    .split(/[\s\p{P}\p{S}]+/u)
    .some((word) => word.startsWith(needle));
}

function insightRows(
  posts: readonly MemoryFeedItem[],
  follows: readonly FollowEdge[],
): InsightDay[] {
  const viewerPosts = posts.filter((post) => post.authorId === VIEWER_ID);
  const totals = {
    totalPosts: viewerPosts.length,
    totalLikesReceived: viewerPosts.reduce((sum, post) => sum + post.likeEvents.length, 0),
    totalRepostsReceived: viewerPosts.reduce((sum, post) => sum + post.repostCount, 0),
    totalRepliesReceived: viewerPosts.reduce((sum, post) => sum + post.replyCount, 0),
    totalFollowers: follows.filter((edge) => edge.followedId === VIEWER_ID).length,
    totalFollowing: follows.filter((edge) => edge.followerId === VIEWER_ID).length,
  };
  const dayMs = 24 * 60 * 60 * 1000;
  const end = Date.parse(FIXTURE_NOW.slice(0, 10) + 'T00:00:00.000Z');
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end - (6 - index) * dayMs).toISOString().slice(0, 10);
    return {
      id: `insight-${day}`,
      day,
      posts: viewerPosts.filter((post) => post.createdAt.slice(0, 10) === day).length,
      likesReceived: viewerPosts.reduce(
        (sum, post) => sum + post.likeEvents.filter((event) => event.createdAt.slice(0, 10) === day).length,
        0,
      ),
      ...totals,
    };
  });
}

export interface CoterieMemoryHarness {
  provider: ContractDataProvider;
  boundary: ContractQueryBoundary;
  appendFixturePost(): FeedItem;
}

/**
 * The backendless provider is a development baseline, not a durability claim.
 * Replace this factory at boot to run the same generated bindings over a real
 * backend adapter.
 *
 * @ref LLP 0266#d4-backend-boundary — Coterie views consume only generated
 * provider bindings; backend-specific delivery remains behind this seam.
 */
export function createCoterieMemoryHarness(): CoterieMemoryHarness {
  let postSequence = 0;
  let messageSequence = 0;
  const boundary = createContractMockQueryBoundary({
    sessions: cloneRows(initialSession),
    profiles: cloneRows(initialProfiles),
    follows: cloneRows(initialFollowEdges),
    posts: cloneRows(initialPosts),
    chats: cloneRows(initialChats),
    messages: cloneRows(initialMessages),
    search: cloneRows(initialSearch),
  });

  const provider = createBoundaryContractDataProvider(coterieMemoryManifest, boundary, {
    queries: {
      listSession: (_args, queryBoundary) =>
        queryBoundary.query<Session>('sessions', (rows) => rows as Session[], { key: 'session' }),
      listFeed: (args, queryBoundary) =>
        queryBoundary.query<FeedItem>(
          'posts',
          (rows) => {
            const posts = rows as MemoryFeedItem[];
            if (args.mode !== 'following') return posts;
            const followed = new Set(
              (queryBoundary.snapshot('follows') as FollowEdge[])
                .filter((edge) => edge.followerId === VIEWER_ID)
                .map((edge) => edge.followedId),
            );
            return posts.filter(
              (post) => post.authorId === VIEWER_ID || followed.has(post.authorId),
            );
          },
          { key: `feed:${String(args.mode)}` },
        ),
      listProfiles: (_args, queryBoundary) =>
        queryBoundary.query<Profile>('profiles', (rows) => rows as Profile[], { key: 'profiles' }),
      listChats: (_args, queryBoundary) =>
        queryBoundary.query<Chat>('chats', (rows) => rows as Chat[], { key: 'chats' }),
      listMessages: (args, queryBoundary) =>
        queryBoundary.query<Message>(
          'messages',
          (rows) => (rows as Message[]).filter((message) => message.chatId === args.chatId),
          { key: `messages:${String(args.chatId)}` },
        ),
      searchSocial: (args, queryBoundary) =>
        queryBoundary.query<SearchResult>(
          'search',
          (rows) =>
            (rows as SearchResult[]).filter((result) =>
              matchesWordPrefix(`${result.title} ${result.subtitle}`, String(args.query ?? '')),
            ),
          { key: `search:${String(args.query)}` },
        ),
      listInsights: (_args, queryBoundary) =>
        queryBoundary.query<InsightDay>(
          'posts',
          (rows) =>
            insightRows(
              rows as MemoryFeedItem[],
              queryBoundary.snapshot('follows') as FollowEdge[],
            ),
          { key: 'insights' },
        ),
    },
    mutations: {
      login: (args, queryBoundary) => {
        if (
          String(args.email).toLocaleLowerCase('en-US') !== 'alice@example.com' ||
          String(args.password) !== 'Alice!Clique2026'
        ) {
          throw new Error('The backendless shell accepts the Alice fixture credentials only.');
        }
        queryBoundary.write<Session>('sessions', () => cloneRows(initialSession));
      },
      logout: (_args, queryBoundary) => {
        queryBoundary.write<Session>('sessions', () => []);
      },
      createPost: (args, queryBoundary) => {
        const body = String(args.body ?? '').trim();
        if (!body) throw new Error('Post text cannot be empty.');
        const profile = (queryBoundary.snapshot('profiles') as Profile[]).find(
          (row) => row.id === VIEWER_ID,
        );
        const item: MemoryFeedItem = {
          id: `coterie-local-post-${String(++postSequence).padStart(4, '0')}`,
          authorId: VIEWER_ID,
          authorName: profile?.displayName ?? 'Alice Alvarez',
          authorHandle: profile?.handle ?? 'alice',
          avatarUrl: profile?.avatarUrl ?? '/assets/fixtures/avatar-alice.png',
          body,
          createdAt: new Date(Date.parse(FIXTURE_NOW) + postSequence * 1000).toISOString(),
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          likedByMe: false,
          mediaUrl: null,
          mediaKind: null,
          pollQuestion: null,
          authorFollowedByMe: false,
          likeEvents: [],
        };
        queryBoundary.write<MemoryFeedItem>('posts', (rows) => [item, ...rows]);
        return { id: item.id };
      },
      setLike: (args, queryBoundary) => {
        const liked = Boolean(args.liked);
        queryBoundary.write<MemoryFeedItem>('posts', (rows) =>
          rows.map((post) => {
            if (post.id !== args.postId || post.likedByMe === liked) return post;
            const likeEvents = liked
              ? [
                  ...post.likeEvents,
                  {
                    actorId: VIEWER_ID,
                    createdAt: FIXTURE_NOW,
                    mutationId: String(args.mutationId),
                  },
                ]
              : post.likeEvents.filter((event) => event.actorId !== VIEWER_ID);
            return { ...post, likedByMe: liked, likeCount: likeEvents.length, likeEvents };
          }),
        );
      },
      setFollow: (args, queryBoundary) => {
        const userId = String(args.userId);
        const following = Boolean(args.following);
        if (userId === VIEWER_ID) throw new Error('Self-follow is implicit and cannot be changed.');
        const edges = queryBoundary.snapshot('follows') as FollowEdge[];
        const wasFollowing = edges.some(
          (edge) => edge.followerId === VIEWER_ID && edge.followedId === userId,
        );
        queryBoundary.write<FollowEdge>('follows', (rows) => {
          if (wasFollowing === following) return rows;
          if (following) {
            return [
              ...rows,
              { id: `mf-${VIEWER_ID}-${userId}`, followerId: VIEWER_ID, followedId: userId },
            ];
          }
          return rows.filter(
            (edge) => !(edge.followerId === VIEWER_ID && edge.followedId === userId),
          );
        });
        queryBoundary.write<Profile>('profiles', (rows) =>
          rows.map((profile) => {
            if (wasFollowing === following) return profile;
            if (profile.id === userId) {
              return {
                ...profile,
                followedByMe: following,
                followers: profile.followers + (following ? 1 : -1),
              };
            }
            if (profile.id === VIEWER_ID) {
              return {
                ...profile,
                following: profile.following + (following ? 1 : -1),
              };
            }
            return profile;
          }),
        );
        // The mock boundary is table-granular. This maintained projection is
        // also the posts-table invalidation bridge for listFeed's graph read.
        queryBoundary.write<MemoryFeedItem>('posts', (rows) =>
          rows.map((post) =>
            post.authorId === userId ? { ...post, authorFollowedByMe: following } : post,
          ),
        );
      },
      editProfile: (args, queryBoundary) => {
        const displayName = String(args.displayName).trim();
        const bio = String(args.bio).trim();
        if (!displayName) throw new Error('Display name cannot be empty.');
        queryBoundary.write<Profile>('profiles', (rows) =>
          rows.map((profile) =>
            profile.id === VIEWER_ID ? { ...profile, displayName, bio } : profile,
          ),
        );
        queryBoundary.write<MemoryFeedItem>('posts', (rows) =>
          rows.map((post) =>
            post.authorId === VIEWER_ID ? { ...post, authorName: displayName } : post,
          ),
        );
        queryBoundary.write<Message>('messages', (rows) =>
          rows.map((message) =>
            message.senderId === VIEWER_ID ? { ...message, senderName: displayName } : message,
          ),
        );
        queryBoundary.write<SearchResult>('search', (rows) =>
          rows.map((result) =>
            result.kind === 'person' && result.id === VIEWER_ID
              ? { ...result, title: displayName }
              : result,
          ),
        );
      },
      sendMessage: (args, queryBoundary) => {
        const body = String(args.body ?? '').trim();
        if (!body) throw new Error('Message text cannot be empty.');
        const chatId = String(args.chatId);
        const chatExists = (queryBoundary.snapshot('chats') as Chat[]).some(
          (chat) => chat.id === chatId,
        );
        if (!chatExists) throw new Error(`Unknown conversation ${chatId}`);
        const profile = (queryBoundary.snapshot('profiles') as Profile[]).find(
          (row) => row.id === VIEWER_ID,
        );
        const createdAt = new Date(
          Date.parse(FIXTURE_NOW) + 60_000 + ++messageSequence * 1000,
        ).toISOString();
        const message: Message = {
          id: `coterie-local-message-${String(messageSequence).padStart(4, '0')}`,
          chatId,
          senderId: VIEWER_ID,
          senderName: profile?.displayName ?? 'Alice Alvarez',
          body,
          createdAt,
          mine: true,
          status: 'sent',
          quoteText: null,
          edited: false,
          deleted: false,
        };
        queryBoundary.write<Message>('messages', (rows) => [...rows, message]);
        queryBoundary.write<Chat>('chats', (rows) =>
          rows.map((chat) =>
            chat.id === chatId ? { ...chat, preview: body, updatedAt: createdAt } : chat,
          ),
        );
        return { id: message.id };
      },
      setChatAccent: (args, queryBoundary) => {
        const color = String(args.color);
        if (!ACCENT_COLORS.has(color)) throw new Error(`Unsupported accent ${color}`);
        queryBoundary.write<Chat>('chats', (rows) =>
          rows.map((chat) =>
            chat.id === args.chatId ? { ...chat, accentColor: color } : chat,
          ),
        );
      },
      setDisappearing: (args, queryBoundary) => {
        const value = String(args.value);
        if (!DISAPPEARING_VALUES.has(value)) {
          throw new Error(`Unsupported disappearing setting ${value}`);
        }
        queryBoundary.write<Chat>('chats', (rows) =>
          rows.map((chat) =>
            chat.id === args.chatId ? { ...chat, disappearing: value } : chat,
          ),
        );
      },
    },
  });

  return {
    provider,
    boundary,
    appendFixturePost() {
      const item: MemoryFeedItem = {
        ...initialPosts.find((post) => post.id === 'sp0001')!,
        id: `coterie-conformance-sp0001-${String(++postSequence).padStart(4, '0')}`,
        likeEvents: [],
        likeCount: 0,
        likedByMe: false,
      };
      boundary.write<MemoryFeedItem>('posts', (rows) => [item, ...rows]);
      return item;
    },
  };
}

export function createCoterieMemoryProvider(): ContractDataProvider {
  return createCoterieMemoryHarness().provider;
}
