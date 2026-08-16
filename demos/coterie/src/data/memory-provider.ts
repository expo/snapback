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
  PollOption,
  Profile,
  SearchResult,
  Session,
  TrendingTopic,
} from './generated/coterie-memory.types.ts';

export const coterieMemoryManifest = manifestJson as unknown as ContractDataManifest;

const initialSession: Session[] = [{ id: 'session-demo', userId: 'user-alice', signedIn: true }];

const initialProfiles: Profile[] = [
  {
    id: 'user-alice',
    handle: 'alice',
    displayName: 'Alice Adebayo',
    bio: 'Designing smaller, kinder social spaces.',
    avatarUrl: '/assets/fixtures/avatar-alice.png',
    followers: 184,
    following: 96,
    followedByMe: false,
    isMe: true,
  },
  {
    id: 'user-bob',
    handle: 'bob',
    displayName: 'Bob Chen',
    bio: 'Trains, maps, and reliable systems.',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
    followers: 247,
    following: 132,
    followedByMe: true,
    isMe: false,
  },
  {
    id: 'user-maya',
    handle: 'maya',
    displayName: 'Maya Ortiz',
    bio: 'Community organizer and amateur baker.',
    avatarUrl: null,
    followers: 391,
    following: 211,
    followedByMe: true,
    isMe: false,
  },
];

const initialPosts: FeedItem[] = [
  {
    id: 'post-1',
    authorId: 'user-bob',
    authorName: 'Bob Chen',
    authorHandle: 'bob',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
    body: 'The fog finally lifted over the ridge. Worth the early train.',
    createdAt: '8m',
    likeCount: 24,
    repostCount: 4,
    replyCount: 7,
    likedByMe: false,
    mediaUrl: '/assets/fixtures/img-01.png',
    mediaKind: 'image',
    pollQuestion: null,
  },
  {
    id: 'post-2',
    authorId: 'user-maya',
    authorName: 'Maya Ortiz',
    authorHandle: 'maya',
    avatarUrl: null,
    body: 'What should our next neighborhood dinner theme be?',
    createdAt: '24m',
    likeCount: 18,
    repostCount: 2,
    replyCount: 11,
    likedByMe: true,
    mediaUrl: null,
    mediaKind: null,
    pollQuestion: 'Pick a dinner theme',
  },
  {
    id: 'post-3',
    authorId: 'user-alice',
    authorName: 'Alice Adebayo',
    authorHandle: 'alice',
    avatarUrl: '/assets/fixtures/avatar-alice.png',
    body: 'Working on Coterie: one Contract source tree, three native-feeling surfaces.',
    createdAt: '1h',
    likeCount: 42,
    repostCount: 9,
    replyCount: 13,
    likedByMe: true,
    mediaUrl: '/assets/fixtures/img-02.png',
    mediaKind: 'image',
    pollQuestion: null,
  },
];

const initialChats: Chat[] = [
  {
    id: 'chat-1',
    title: 'Bob Chen',
    preview: 'That sounds good — see you at six.',
    updatedAt: '2m',
    unreadCount: 2,
    isGroup: false,
    accentColor: '#4F46E5',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
  },
  {
    id: 'chat-2',
    title: 'Neighborhood table',
    preview: 'Maya: I can bring dessert.',
    updatedAt: '18m',
    unreadCount: 0,
    isGroup: true,
    accentColor: '#0D9488',
    avatarUrl: null,
  },
];

const initialMessages: Message[] = [
  {
    id: 'message-1',
    chatId: 'chat-1',
    senderId: 'user-bob',
    senderName: 'Bob Chen',
    body: 'Did you see the route change for tonight?',
    createdAt: '5:42 PM',
    mine: false,
    status: 'read',
    reaction: '👍',
    quoteText: null,
    edited: false,
    deleted: false,
    attachmentUrl: null,
    attachmentKind: null,
    viewOnce: false,
  },
  {
    id: 'message-2',
    chatId: 'chat-1',
    senderId: 'user-alice',
    senderName: 'Alice Adebayo',
    body: 'Yes — I can take the 5:50 and meet by the south entrance.',
    createdAt: '5:44 PM',
    mine: true,
    status: 'read',
    reaction: null,
    quoteText: 'Did you see the route change for tonight?',
    edited: false,
    deleted: false,
    attachmentUrl: null,
    attachmentKind: null,
    viewOnce: false,
  },
  {
    id: 'message-3',
    chatId: 'chat-1',
    senderId: 'user-bob',
    senderName: 'Bob Chen',
    body: 'That sounds good — see you at six.',
    createdAt: '5:45 PM',
    mine: false,
    status: 'delivered',
    reaction: null,
    quoteText: null,
    edited: true,
    deleted: false,
    attachmentUrl: '/assets/fixtures/img-03.png',
    attachmentKind: 'image',
    viewOnce: false,
  },
];

const initialSearch: SearchResult[] = [
  { id: 'search-bob', kind: 'person', title: 'Bob Chen', subtitle: '@bob', avatarUrl: '/assets/fixtures/avatar-bob.png' },
  { id: 'search-maya', kind: 'person', title: 'Maya Ortiz', subtitle: '@maya', avatarUrl: null },
  { id: 'search-post-1', kind: 'post', title: 'Fog over the ridge', subtitle: 'Post by @bob', avatarUrl: '/assets/fixtures/avatar-bob.png' },
  { id: 'search-chat-2', kind: 'chat', title: 'Neighborhood table', subtitle: 'Group conversation', avatarUrl: null },
];

const initialPollOptions: PollOption[] = [
  { id: 'poll-1-a', postId: 'post-2', label: 'Recipes from home', votes: 12, selectedByMe: false },
  { id: 'poll-1-b', postId: 'post-2', label: 'Summer picnic', votes: 18, selectedByMe: true },
  { id: 'poll-1-c', postId: 'post-2', label: 'Night market', votes: 9, selectedByMe: false },
];

const initialInsights: InsightDay[] = [
  { id: 'insight-mon', day: 'Mon', views: 72, engagements: 24 },
  { id: 'insight-tue', day: 'Tue', views: 94, engagements: 38 },
  { id: 'insight-wed', day: 'Wed', views: 128, engagements: 51 },
  { id: 'insight-thu', day: 'Thu', views: 111, engagements: 44 },
  { id: 'insight-fri', day: 'Fri', views: 146, engagements: 63 },
];

const initialTrending: TrendingTopic[] = [
  { id: 'trend-1', rank: 1, label: 'Small social', postCount: 184 },
  { id: 'trend-2', rank: 2, label: 'Weekend trains', postCount: 127 },
  { id: 'trend-3', rank: 3, label: 'Community tables', postCount: 96 },
];

function cloneRows<T>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row }));
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
 * @ref LLP 0263#d4-backend-boundary — Coterie views consume only generated
 * provider bindings; backend-specific delivery remains behind this seam.
 */
export function createCoterieMemoryHarness(): CoterieMemoryHarness {
  let postSequence = initialPosts.length;
  let messageSequence = initialMessages.length;
  const boundary = createContractMockQueryBoundary({
    sessions: cloneRows(initialSession),
    profiles: cloneRows(initialProfiles),
    posts: cloneRows(initialPosts),
    chats: cloneRows(initialChats),
    messages: cloneRows(initialMessages),
    search: cloneRows(initialSearch),
    pollOptions: cloneRows(initialPollOptions),
    insights: cloneRows(initialInsights),
    trends: cloneRows(initialTrending),
  });

  const provider = createBoundaryContractDataProvider(coterieMemoryManifest, boundary, {
    queries: {
      listSession: (_args, queryBoundary) =>
        queryBoundary.query<Session>('sessions', (rows) => rows as Session[], { key: 'session' }),
      listFeed: (args, queryBoundary) =>
        queryBoundary.query<FeedItem>(
          'posts',
          (rows) => {
            const posts = rows as FeedItem[];
            // A user's own posts remain visible in their following feed.
            return args.mode === 'following'
              ? posts.filter((post) => post.authorId !== 'user-carol')
              : posts;
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
          (rows) => {
            const needle = String(args.query ?? '').trim().toLowerCase();
            if (!needle) return rows as SearchResult[];
            return (rows as SearchResult[]).filter((result) =>
              `${result.title} ${result.subtitle}`.toLowerCase().includes(needle),
            );
          },
          { key: `search:${String(args.query)}` },
        ),
      listPollOptions: (args, queryBoundary) =>
        queryBoundary.query<PollOption>(
          'pollOptions',
          (rows) => (rows as PollOption[]).filter((option) => option.postId === args.postId),
          { key: `poll:${String(args.postId)}` },
        ),
      listInsights: (_args, queryBoundary) =>
        queryBoundary.query<InsightDay>('insights', (rows) => rows as InsightDay[], { key: 'insights' }),
      listTrending: (_args, queryBoundary) =>
        queryBoundary.query<TrendingTopic>('trends', (rows) => rows as TrendingTopic[], { key: 'trending' }),
    },
    mutations: {
      login: (_args, queryBoundary) => {
        queryBoundary.write<Session>('sessions', () => cloneRows(initialSession));
      },
      logout: (_args, queryBoundary) => {
        queryBoundary.write<Session>('sessions', () => []);
      },
      createPost: (args, queryBoundary) => {
        const item: FeedItem = {
          id: `post-local-${++postSequence}`,
          authorId: 'user-alice',
          authorName: 'Alice Adebayo',
          authorHandle: 'alice',
          avatarUrl: '/assets/fixtures/avatar-alice.png',
          body: String(args.body ?? '').trim(),
          createdAt: 'now',
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          likedByMe: false,
          mediaUrl: null,
          mediaKind: null,
          pollQuestion: null,
        };
        queryBoundary.write<FeedItem>('posts', (rows) => [item, ...rows]);
        return { id: item.id };
      },
      toggleLike: (args, queryBoundary) => {
        queryBoundary.write<FeedItem>('posts', (rows) =>
          rows.map((post) =>
            post.id === args.postId
              ? {
                  ...post,
                  likedByMe: !post.likedByMe,
                  likeCount: post.likeCount + (post.likedByMe ? -1 : 1),
                }
              : post,
          ),
        );
      },
      toggleFollow: (args, queryBoundary) => {
        queryBoundary.write<Profile>('profiles', (rows) =>
          rows.map((profile) =>
            profile.id === args.userId
              ? {
                  ...profile,
                  followedByMe: !profile.followedByMe,
                  followers: profile.followers + (profile.followedByMe ? -1 : 1),
                }
              : profile,
          ),
        );
      },
      editProfile: (args, queryBoundary) => {
        queryBoundary.write<Profile>('profiles', (rows) =>
          rows.map((profile) =>
            profile.isMe
              ? { ...profile, displayName: String(args.displayName), bio: String(args.bio) }
              : profile,
          ),
        );
      },
      sendMessage: (args, queryBoundary) => {
        const body = String(args.body ?? '').trim();
        const message: Message = {
          id: `message-local-${++messageSequence}`,
          chatId: String(args.chatId),
          senderId: 'user-alice',
          senderName: 'Alice Adebayo',
          body,
          createdAt: 'now',
          mine: true,
          status: 'sent',
          reaction: null,
          quoteText: null,
          edited: false,
          deleted: false,
          attachmentUrl: null,
          attachmentKind: null,
          viewOnce: false,
        };
        queryBoundary.write<Message>('messages', (rows) => [...rows, message]);
        queryBoundary.write<Chat>('chats', (rows) =>
          rows.map((chat) =>
            chat.id === args.chatId ? { ...chat, preview: body, updatedAt: 'now' } : chat,
          ),
        );
        return { id: message.id };
      },
      votePoll: (args, queryBoundary) => {
        queryBoundary.write<PollOption>('pollOptions', (rows) =>
          rows.map((option) =>
            option.postId === args.postId
              ? {
                  ...option,
                  selectedByMe: option.id === args.optionId,
                  votes:
                    option.id === args.optionId && !option.selectedByMe
                      ? option.votes + 1
                      : option.id !== args.optionId && option.selectedByMe
                        ? option.votes - 1
                        : option.votes,
                }
              : option,
          ),
        );
      },
    },
  });

  return {
    provider,
    boundary,
    appendFixturePost() {
      const item: FeedItem = {
        ...initialPosts[0],
        id: `post-fixture-${++postSequence}`,
        body: 'Conformance subscription update',
        createdAt: 'now',
      };
      boundary.write<FeedItem>('posts', (rows) => [item, ...rows]);
      return item;
    },
  };
}

export function createCoterieMemoryProvider(): ContractDataProvider {
  return createCoterieMemoryHarness().provider;
}
