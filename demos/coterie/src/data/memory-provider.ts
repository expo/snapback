import {
  createBoundaryContractDataProvider,
  createContractMockQueryBoundary,
  type ContractDataManifest,
  type ContractDataProvider,
  type ContractQueryBoundary,
} from '@exact/contract/runtime';

import manifestJson from './generated/coterie.manifest.json';
import { coterieAvatarUrlForRef } from './avatar-refs.ts';
import {
  COTERIE_IMAGE_URLS,
  COTERIE_VIDEO_URLS,
} from './coterie-fixtures.ts';
import { queryAcrossTables, withMultiTableQueries } from './multi-table-query-boundary.ts';
import { allCoterieProviderClaims } from './provider-claims.ts';
import type {
  Chat,
  FeedItem,
  InsightDay,
  Message,
  Profile,
  ProfilePost,
  ProviderClaim,
  SearchResult,
  Session,
  ThreadPost,
  TypingParticipant,
} from './generated/coterie.types.ts';

export const coterieSurfaceManifest = manifestJson as unknown as ContractDataManifest;

const VIEWER_ID = 'alice';
const FIXTURE_NOW = '2026-01-01T00:01:30.000Z';
const SESSION_EXPIRES_AT = '2026-01-02T00:01:30.000Z';
const FEED_PAGE_SIZE = 20;
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
  postId: string;
  actorId: string;
  createdAt: string;
  mutationId: string;
}

interface RepostEvent {
  postId: string;
  actorId: string;
  createdAt: string;
  mutationId: string;
}

interface MemoryPost {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  parentId: string | null;
  mediaKind: 'images' | 'video' | null;
  mediaRefs: string[];
}

interface FeedEvent {
  id: string;
  post: MemoryPost;
  feedSortAt: string;
  repost: RepostEvent | null;
}

interface MemoryAccount {
  id: string;
  email: string;
  password: string;
  handle: string;
}

interface RevokedSession extends Session {
  revokedAt: string;
  reason: 'logout' | 'replaced';
}

interface MessageReactionEvent {
  actorId: string;
  emoji: string;
}

type ReceiptState = 'sent' | 'delivered' | 'read';

interface MemoryMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  quotedMessageId: string | null;
  reactionEvents: MessageReactionEvent[];
  edited: boolean;
  deleted: boolean;
  recipientIds: string[];
  droppedRecipientIds: string[];
}

interface MemoryChat {
  id: string;
  kind: 'dm' | 'group';
  name: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  accentColor: string;
  disappearing: string;
  dmPairKey: string | null;
}

interface ChatMembership {
  id: string;
  chatId: string;
  userId: string;
  isAdmin: boolean;
  active: boolean;
  joinedAt: string;
  historyThrough: string | null;
}

interface MessageReceipt {
  id: string;
  messageId: string;
  userId: string;
  state: ReceiptState;
}

interface MemoryTyping {
  id: string;
  chatId: string;
  userId: string;
  expiresAtMs: number;
}

const initialSession: Session[] = [
  {
    id: 'session-alice-0000',
    userId: VIEWER_ID,
    signedIn: true,
    token: 'coterie-memory-session-alice-0000',
    expiresAt: SESSION_EXPIRES_AT,
    revokedAt: null,
  },
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
    location: 'Oakland, CA',
    link: 'https://example.com/alice',
    avatarUrl: '/assets/fixtures/avatar-alice.png',
    avatarRef: 'media/avatar-alice.png',
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
    location: 'Berkeley, CA',
    link: 'https://example.com/bob',
    avatarUrl: '/assets/fixtures/avatar-bob.png',
    avatarRef: 'media/avatar-bob.png',
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
    location: 'San Francisco, CA',
    link: 'https://example.com/carol',
    avatarUrl: '/assets/fixtures/avatar-carol.png',
    avatarRef: 'media/avatar-carol.png',
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
    location: 'Portland, OR',
    link: 'https://example.com/dave',
    avatarUrl: '/assets/fixtures/avatar-dave.png',
    avatarRef: 'media/avatar-dave.png',
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
    location: 'Seattle, WA',
    link: 'https://example.com/erin',
    avatarUrl: '/assets/fixtures/avatar-erin.png',
    avatarRef: 'media/avatar-erin.png',
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
    location: 'Austin, TX',
    link: 'https://example.com/frank',
    avatarUrl: '/assets/fixtures/avatar-frank.png',
    avatarRef: 'media/avatar-frank.png',
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
    location: 'Chicago, IL',
    link: 'https://example.com/grace',
    avatarUrl: '/assets/fixtures/avatar-grace.png',
    avatarRef: 'media/avatar-grace.png',
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
    location: 'Brooklyn, NY',
    link: 'https://example.com/henry',
    avatarUrl: '/assets/fixtures/avatar-henry.png',
    avatarRef: 'media/avatar-henry.png',
    followers: 0,
    following: 2,
    followedByMe: false,
    isMe: false,
  },
];

const fixturePasswords: Readonly<Record<string, string>> = {
  alice: 'Alice!Clique2026',
  bob: 'Bob!Clique2026',
  carol: 'Carol!Clique2026',
  dave: 'Dave!Clique2026',
  erin: 'Erin!Clique2026',
  frank: 'Frank!Clique2026',
  grace: 'Grace!Clique2026',
  henry: 'Henry!Clique2026',
};

const initialAccounts: MemoryAccount[] = initialProfiles.map((profile) => ({
  id: profile.id,
  email: `${profile.handle}@example.com`,
  password: fixturePasswords[profile.id] ?? '',
  handle: profile.handle,
}));

const profileById = new Map(initialProfiles.map((profile) => [profile.id, profile]));

function fixturePost(
  id: string,
  authorId: string,
  body: string,
  second: number,
  options: {
    images?: string[];
    video?: string;
    parentId?: string;
  } = {},
): MemoryPost {
  if (!profileById.has(authorId)) throw new Error(`Missing fixture profile ${authorId}`);
  const mediaRefs = options.images ?? (options.video ? [options.video] : []);
  return {
    id,
    authorId,
    body,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
    parentId: options.parentId ?? null,
    mediaKind: options.images ? 'images' : options.video ? 'video' : null,
    mediaRefs,
  };
}

// Exact committed starter-m2.log content, including every image, video, and
// reply row. Feed projection filters replies and adds the four repost events.
const initialPosts: MemoryPost[] = [
  fixturePost('sp0001', 'alice', 'Coffee time at the corner table https://example.com/cafe', 28),
  fixturePost('sp0002', 'alice', "Two colors from this morning's walk.", 29, {
    images: ['media/img-02.png', 'media/img-03.png'],
  }),
  fixturePost('sp0003', 'alice', 'A five-second hello from the lake.', 30, {
    video: 'media/vid-01.mp4',
  }),
  fixturePost('sp0004', 'bob', 'Fresh bread, still warm.', 31),
  fixturePost('sp0005', 'bob', 'Bike route notes for Saturday.', 32),
  fixturePost('sp0006', 'bob', 'Small tools should have sharp edges.', 33),
  fixturePost('sp0007', 'carol', 'The blue glaze finally worked.', 34),
  fixturePost('sp0008', 'carol', 'Studio shelf before cleanup.', 35, {
    images: ['media/img-02.png', 'media/img-03.png'],
  }),
  fixturePost('sp0009', 'carol', 'A quiet clip from class.', 36, {
    video: 'media/vid-01.mp4',
  }),
  fixturePost('sp0010', 'dave', "Tonight's set starts at eight.", 37),
  fixturePost('sp0011', 'dave', 'Trail conditions: dry and windy.', 38),
  fixturePost('sp0012', 'dave', 'Noodles worth crossing town for.', 39),
  fixturePost('sp0013', 'erin', 'Basil has officially taken over.', 40),
  fixturePost('sp0014', 'erin', 'Sketching a calmer settings screen.', 41, {
    images: ['media/img-02.png', 'media/img-03.png'],
  }),
  fixturePost('sp0015', 'erin', 'Three interface details I keep noticing.', 42),
  fixturePost('sp0016', 'frank', 'Beans, tomatoes, and too much garlic.', 43),
  fixturePost('sp0017', 'frank', 'Data cleanup can be satisfying.', 44),
  fixturePost('sp0018', 'frank', 'Sunday lunch test number four.', 45),
  fixturePost('sp0019', 'grace', 'The tomatoes are showing off.', 46),
  fixturePost('sp0020', 'grace', 'A graphic novel with perfect pacing.', 47, {
    images: ['media/img-02.png', 'media/img-03.png'],
  }),
  fixturePost('sp0021', 'grace', 'Questions for the garden club.', 48),
  fixturePost('sp0022', 'henry', 'A history episode for the train ride.', 49),
  fixturePost('sp0023', 'henry', 'Pickup game moved to six.', 50),
  fixturePost('sp0024', 'henry', 'Brooklyn looked silver after rain.', 51),
  fixturePost('sr0001', 'bob', 'Save me a cup.', 52, { parentId: 'sp0001' }),
  fixturePost('sr0002', 'carol', 'That crust looks perfect.', 53, { parentId: 'sp0004' }),
  fixturePost('sr0003', 'alice', 'I need your basil secrets.', 54, { parentId: 'sp0013' }),
  fixturePost('sr0004', 'grace', 'Adding it to my queue.', 55, { parentId: 'sp0022' }),
];

const initialLikes: LikeEvent[] = [
  { postId: 'sp0001', actorId: 'bob', createdAt: '2026-01-01T00:00:56Z', mutationId: 'ml-bob-sp0001' },
  { postId: 'sp0001', actorId: 'carol', createdAt: '2026-01-01T00:00:57Z', mutationId: 'ml-carol-sp0001' },
  { postId: 'sp0004', actorId: 'dave', createdAt: '2026-01-01T00:00:58Z', mutationId: 'ml-dave-sp0004' },
  { postId: 'sp0007', actorId: 'erin', createdAt: '2026-01-01T00:00:59Z', mutationId: 'ml-erin-sp0007' },
  { postId: 'sp0013', actorId: 'frank', createdAt: '2026-01-01T00:01:00Z', mutationId: 'ml-frank-sp0013' },
  { postId: 'sp0016', actorId: 'grace', createdAt: '2026-01-01T00:01:01Z', mutationId: 'ml-grace-sp0016' },
  { postId: 'sp0019', actorId: 'henry', createdAt: '2026-01-01T00:01:02Z', mutationId: 'ml-henry-sp0019' },
  { postId: 'sp0022', actorId: 'alice', createdAt: '2026-01-01T00:01:03Z', mutationId: 'ml-alice-sp0022' },
];

const initialReposts: RepostEvent[] = [
  { postId: 'sp0001', actorId: 'carol', createdAt: '2026-01-01T00:01:04Z', mutationId: 'mr-carol-sp0001' },
  { postId: 'sp0004', actorId: 'alice', createdAt: '2026-01-01T00:01:05Z', mutationId: 'mr-alice-sp0004' },
  { postId: 'sp0013', actorId: 'henry', createdAt: '2026-01-01T00:01:06Z', mutationId: 'mr-henry-sp0013' },
  { postId: 'sp0019', actorId: 'bob', createdAt: '2026-01-01T00:01:07Z', mutationId: 'mr-bob-sp0019' },
];

const initialChats: MemoryChat[] = [
  {
    id: 'd-alice-bob',
    kind: 'dm',
    name: null,
    description: null,
    createdAt: '2026-01-01T00:01:08Z',
    updatedAt: '2026-01-01T00:01:17Z',
    accentColor: '#4F46E5',
    disappearing: 'off',
    dmPairKey: 'alice:bob',
  },
  {
    id: 'g-starter',
    kind: 'group',
    name: 'Weekend Plans',
    description: 'Coffee, a walk, and dinner.',
    createdAt: '2026-01-01T00:01:09Z',
    updatedAt: '2026-01-01T00:01:26Z',
    accentColor: '#0D9488',
    disappearing: 'off',
    dmPairKey: null,
  },
];

const initialChatMemberships: ChatMembership[] = [
  { id: 'mm-d-alice-bob-alice', chatId: 'd-alice-bob', userId: 'alice', isAdmin: false, active: true, joinedAt: '2026-01-01T00:01:08Z', historyThrough: null },
  { id: 'mm-d-alice-bob-bob', chatId: 'd-alice-bob', userId: 'bob', isAdmin: false, active: true, joinedAt: '2026-01-01T00:01:08Z', historyThrough: null },
  { id: 'mm-g-starter-alice', chatId: 'g-starter', userId: 'alice', isAdmin: true, active: true, joinedAt: '2026-01-01T00:01:09Z', historyThrough: null },
  { id: 'mm-g-starter-bob', chatId: 'g-starter', userId: 'bob', isAdmin: false, active: true, joinedAt: '2026-01-01T00:01:09Z', historyThrough: null },
  { id: 'mm-g-starter-carol', chatId: 'g-starter', userId: 'carol', isAdmin: false, active: true, joinedAt: '2026-01-01T00:01:10Z', historyThrough: null },
  { id: 'mm-g-starter-dave', chatId: 'g-starter', userId: 'dave', isAdmin: false, active: true, joinedAt: '2026-01-01T00:01:11Z', historyThrough: null },
];

const fixtureMessageRows = [
  ['sm0001', 'd-alice-bob', 'alice', 'Coffee after work?', '2026-01-01T00:01:12Z', null],
  ['sm0002', 'd-alice-bob', 'bob', 'Yes. Corner place?', '2026-01-01T00:01:13Z', 'sm0001'],
  ['sm0003', 'd-alice-bob', 'alice', 'Exactly. Six thirty.', '2026-01-01T00:01:14Z', 'sm0002'],
  ['sm0004', 'd-alice-bob', 'bob', 'I will bring the route map.', '2026-01-01T00:01:15Z', null],
  ['sm0005', 'd-alice-bob', 'alice', 'Perfect, see you there.', '2026-01-01T00:01:16Z', null],
  ['sm0006', 'd-alice-bob', 'bob', 'On my way.', '2026-01-01T00:01:17Z', 'sm0005'],
  ['sm0007', 'g-starter', 'alice', 'Saturday plan: coffee, lake, then noodles.', '2026-01-01T00:01:18Z', null],
  ['sm0008', 'g-starter', 'carol', 'Coffee is a definite yes.', '2026-01-01T00:01:19Z', 'sm0007'],
  ['sm0009', 'g-starter', 'dave', 'I can meet everyone at ten.', '2026-01-01T00:01:20Z', null],
  ['sm0010', 'g-starter', 'bob', 'The west trail is dry now.', '2026-01-01T00:01:21Z', null],
  ['sm0011', 'g-starter', 'alice', 'West trail it is.', '2026-01-01T00:01:22Z', 'sm0010'],
  ['sm0012', 'g-starter', 'carol', 'I will bring snacks.', '2026-01-01T00:01:23Z', null],
  ['sm0013', 'g-starter', 'dave', 'Should I book dinner?', '2026-01-01T00:01:24Z', null],
  ['sm0014', 'g-starter', 'bob', 'Please do, for four.', '2026-01-01T00:01:25Z', 'sm0013'],
  ['sm0015', 'g-starter', 'alice', 'Locked in. See you Saturday.', '2026-01-01T00:01:26Z', null],
] as const;

const initialMessages: MemoryMessage[] = fixtureMessageRows.map(
  ([id, chatId, senderId, body, createdAt, quotedMessageId]) => ({
    id,
    chatId,
    senderId,
    senderName: profileById.get(senderId)?.displayName ?? senderId,
    body,
    createdAt,
    quotedMessageId,
    reactionEvents: [],
    edited: false,
    deleted: false,
    recipientIds: chatId === 'd-alice-bob'
      ? [senderId === 'alice' ? 'bob' : 'alice']
      : ['alice', 'bob', 'carol', 'dave'].filter((userId) => userId !== senderId),
    droppedRecipientIds: [],
  }),
);

const initialMessageReceipts: MessageReceipt[] = initialMessages.flatMap((message) =>
  message.recipientIds.map((userId) => ({
    id: `mr-${message.id}-${userId}`,
    messageId: message.id,
    userId,
    state: 'read' as const,
  })),
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
    title: chat.kind === 'group' ? chat.name ?? 'Group' : 'Bob Bennett',
    subtitle: chat.kind === 'group' ? 'Group conversation' : 'Direct conversation',
    avatarUrl: chat.kind === 'group' ? null : '/assets/fixtures/avatar-bob.png',
  })),
];

function cloneRows<T>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

const DECLARED_ERROR_CODES = {
  AvatarReferenceInvalidError: 'avatar_reference_invalid',
  BioInvalidError: 'bio_invalid',
  DisplayNameInvalidError: 'display_name_invalid',
  DuplicateEmailError: 'duplicate_email',
  DuplicateHandleError: 'duplicate_handle',
  EmailInvalidError: 'email_invalid',
  FeedCursorInvalidError: 'feed_cursor_invalid',
  FeedModeInvalidError: 'feed_mode_invalid',
  HandleInvalidError: 'handle_invalid',
  ImageCountInvalidError: 'image_count_invalid',
  InvalidCredentialsError: 'invalid_credentials',
  LinkInvalidError: 'link_invalid',
  LocationInvalidError: 'location_invalid',
  ChatAdminRequiredError: 'chat_admin_required',
  ChatMemberAlreadyExistsError: 'chat_member_already_exists',
  ChatMemberLimitError: 'chat_member_limit',
  ChatMemberNotFoundError: 'chat_member_not_found',
  ChatMembershipRequiredError: 'chat_membership_required',
  ChatNotFoundError: 'chat_not_found',
  DirectMessageSelfError: 'direct_message_self',
  EmojiInvalidError: 'emoji_invalid',
  GroupDescriptionInvalidError: 'group_description_invalid',
  GroupMembersInvalidError: 'group_members_invalid',
  GroupNameInvalidError: 'group_name_invalid',
  GroupRequiredError: 'group_required',
  MediaMixInvalidError: 'media_mix_invalid',
  MediaReferenceInvalidError: 'media_reference_invalid',
  MessageBodyInvalidError: 'message_body_invalid',
  MessageNotFoundError: 'message_not_found',
  ParentPostNotFoundError: 'parent_post_not_found',
  PasswordTooShortError: 'password_too_short',
  PostBodyInvalidError: 'post_body_invalid',
  PostNotFoundError: 'post_not_found',
  ProfileNotFoundError: 'profile_not_found',
  QuotedMessageInvalidError: 'quoted_message_invalid',
  ReceiptStateInvalidError: 'receipt_state_invalid',
  RemoveSelfInvalidError: 'remove_self_invalid',
  ReplyRepostForbiddenError: 'reply_repost_forbidden',
  SelfFollowInvalidError: 'self_follow_invalid',
  SessionRequiredError: 'session_required',
  VideoCountInvalidError: 'video_count_invalid',
} as const;

type DeclaredErrorName = keyof typeof DECLARED_ERROR_CODES;

function fail(name: DeclaredErrorName, message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.name = name;
  error.code = DECLARED_ERROR_CODES[name];
  throw error;
}

function normalizedEmail(value: unknown): string {
  return String(value ?? '').normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function validatedEmail(value: unknown): string {
  const email = normalizedEmail(value);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
    fail('EmailInvalidError', 'Enter a valid email address.');
  }
  return email;
}

function validatedPassword(value: unknown): string {
  const password = String(value ?? '');
  if (password.length < 8) {
    fail('PasswordTooShortError', 'Password must contain at least 8 characters.');
  }
  return password;
}

function validatedHandle(value: unknown): string {
  const handle = String(value ?? '').normalize('NFC').trim();
  if (!/^[a-z0-9_]{3,20}$/u.test(handle)) {
    fail(
      'HandleInvalidError',
      'Handle must be 3-20 lowercase letters, numbers, or underscores.',
    );
  }
  return handle;
}

function validatedDisplayName(value: unknown): string {
  const displayName = String(value ?? '').normalize('NFC').trim();
  if (displayName.length < 1 || displayName.length > 50) {
    fail('DisplayNameInvalidError', 'Display name must contain 1-50 characters.');
  }
  return displayName;
}

function validatedBio(value: unknown): string {
  const bio = String(value ?? '').normalize('NFC').trim();
  if (bio.length > 200) {
    fail('BioInvalidError', 'Bio must contain at most 200 characters.');
  }
  return bio;
}

function validatedLocation(value: unknown): string {
  const location = String(value ?? '').normalize('NFC').trim();
  if (location.length > 50) {
    fail('LocationInvalidError', 'Location must contain at most 50 characters.');
  }
  return location;
}

function validatedLink(value: unknown): string {
  const link = String(value ?? '').normalize('NFC').trim();
  if (!link) return '';
  try {
    const parsed = new URL(link);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {
    // Fall through to the one declared rejection below.
  }
  return fail('LinkInvalidError', 'Link must be empty or an HTTP(S) URL.');
}

function validatedEmoji(value: unknown): string {
  const emoji = String(value ?? '').normalize('NFC').trim();
  const graphemes = [
    ...new Intl.Segmenter('en-US', { granularity: 'grapheme' }).segment(emoji),
  ];
  if (
    graphemes.length !== 1
    || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u.test(emoji)
  ) {
    fail('EmojiInvalidError', 'Reaction must be one emoji grapheme.');
  }
  return emoji;
}

function quotedBodySnippet(message: MemoryMessage): string {
  if (message.deleted) return 'This message was deleted';
  const body = message.body.trim();
  return body.length > 96 ? `${body.slice(0, 95)}…` : body;
}

const RECEIPT_RANK: Record<ReceiptState, number> = {
  sent: 0,
  delivered: 1,
  read: 2,
};

function aggregateReceiptState(
  message: MemoryMessage,
  receipts: readonly MessageReceipt[],
): { status: ReceiptState; recipientCount: number; deliveredCount: number; readCount: number } {
  const dropped = new Set(message.droppedRecipientIds);
  const required = message.recipientIds.filter((userId) => !dropped.has(userId));
  const states = new Map(
    receipts
      .filter((receipt) => receipt.messageId === message.id)
      .map((receipt) => [receipt.userId, receipt.state]),
  );
  const deliveredCount = required.filter(
    (userId) => RECEIPT_RANK[states.get(userId) ?? 'sent'] >= RECEIPT_RANK.delivered,
  ).length;
  const readCount = required.filter(
    (userId) => RECEIPT_RANK[states.get(userId) ?? 'sent'] >= RECEIPT_RANK.read,
  ).length;
  const status: ReceiptState = required.length === 0
    ? 'read'
    : readCount === required.length
    ? 'read'
    : deliveredCount === required.length
      ? 'delivered'
      : 'sent';
  return { status, recipientCount: required.length, deliveredCount, readCount };
}

function visibleMessagesFor(
  messages: readonly MemoryMessage[],
  membership: ChatMembership,
): MemoryMessage[] {
  return messages.filter(
    (message) => message.chatId === membership.chatId
      && (membership.active
        || (membership.historyThrough !== null && message.createdAt <= membership.historyThrough)),
  );
}

function projectMessages(
  messages: readonly MemoryMessage[],
  receipts: readonly MessageReceipt[],
  profiles: readonly Profile[],
  viewerId: string | null,
): Message[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return messages.map((message) => {
    const quoted = message.quotedMessageId
      ? byId.get(message.quotedMessageId) ?? null
      : null;
    const aggregate = new Map<string, { count: number; reactedByMe: boolean }>();
    for (const reaction of message.reactionEvents) {
      const current = aggregate.get(reaction.emoji) ?? { count: 0, reactedByMe: false };
      aggregate.set(reaction.emoji, {
        count: current.count + 1,
        reactedByMe: current.reactedByMe || reaction.actorId === viewerId,
      });
    }
    const snippet = quoted ? quotedBodySnippet(quoted) : null;
    const receipt = aggregateReceiptState(message, receipts);
    return {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      senderName: message.senderName,
      senderAvatarUrl: profiles.find((profile) => profile.id === message.senderId)?.avatarUrl ?? null,
      body: message.body,
      createdAt: message.createdAt,
      mine: viewerId !== null && message.senderId === viewerId,
      ...receipt,
      quotedMessageId: message.quotedMessageId,
      quotedSenderName: quoted?.senderName ?? null,
      quotedBodySnippet: snippet,
      // Kept for the additive v2 row shape; new UI reads the sender/body pair.
      quoteText: snippet,
      reactions: [...aggregate.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
        .map(([emoji, facts]) => ({ emoji, ...facts })),
      edited: message.edited,
      deleted: message.deleted,
    };
  });
}

function projectChats(
  chats: readonly MemoryChat[],
  memberships: readonly ChatMembership[],
  messages: readonly MemoryMessage[],
  receipts: readonly MessageReceipt[],
  typing: readonly MemoryTyping[],
  profiles: readonly Profile[],
  viewerId: string,
  nowMs: number,
): Chat[] {
  return chats.flatMap((chat) => {
    const viewerMembership = memberships.find(
      (membership) => membership.chatId === chat.id && membership.userId === viewerId,
    );
    if (!viewerMembership) return [];
    const activeMemberships = memberships.filter(
      (membership) => membership.chatId === chat.id && membership.active,
    );
    const visibleMessages = visibleMessagesFor(messages, viewerMembership);
    const latest = visibleMessages.at(-1) ?? null;
    const counterpartMembership = chat.kind === 'dm'
      ? activeMemberships.find((membership) => membership.userId !== viewerId) ?? null
      : null;
    const counterpart = counterpartMembership
      ? profiles.find((profile) => profile.id === counterpartMembership.userId) ?? null
      : null;
    const activeTyping = typing.filter(
      (entry) => entry.chatId === chat.id
        && entry.userId !== viewerId
        && entry.expiresAtMs > nowMs
        && activeMemberships.some((membership) => membership.userId === entry.userId),
    );
    const typingNames = activeTyping.map(
      (entry) => profiles.find((profile) => profile.id === entry.userId)?.displayName ?? entry.userId,
    );
    const unreadCount = visibleMessages.filter((message) => {
      if (
        message.senderId === viewerId
        || !message.recipientIds.includes(viewerId)
        || message.droppedRecipientIds.includes(viewerId)
      ) return false;
      const state = receipts.find(
        (receipt) => receipt.messageId === message.id && receipt.userId === viewerId,
      )?.state ?? 'sent';
      return RECEIPT_RANK[state] < RECEIPT_RANK.read;
    }).length;
    return [{
      id: chat.id,
      title: chat.kind === 'group' ? chat.name ?? 'Group' : counterpart?.displayName ?? 'Direct message',
      description: chat.description,
      preview: latest?.body ?? '',
      updatedAt: latest?.createdAt ?? chat.updatedAt,
      unreadCount,
      isGroup: chat.kind === 'group',
      kind: chat.kind,
      memberIds: activeMemberships.map((membership) => membership.userId),
      members: activeMemberships.map((membership) => {
        const profile = profiles.find((candidate) => candidate.id === membership.userId);
        return {
          id: membership.userId,
          displayName: profile?.displayName ?? membership.userId,
          avatarUrl: profile?.avatarUrl ?? null,
          isAdmin: membership.isAdmin,
          isMe: membership.userId === viewerId,
        };
      }),
      currentUserIsAdmin: viewerMembership.active && viewerMembership.isAdmin,
      currentUserIsMember: viewerMembership.active,
      typingHint: typingNames.length > 0 ? `${typingNames.join(', ')} typing...` : null,
      latestReceiptStatus: latest?.senderId === viewerId
        ? aggregateReceiptState(latest, receipts).status
        : null,
      accentColor: chat.accentColor,
      disappearing: chat.disappearing,
      avatarUrl: counterpart?.avatarUrl ?? null,
    }];
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function validatedGroupName(value: unknown): string {
  const name = String(value ?? '').normalize('NFC').trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 50) {
    fail('GroupNameInvalidError', 'Group name must contain 1-50 characters.');
  }
  return name;
}

function validatedGroupDescription(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const description = String(value).normalize('NFC').trim();
  if (Array.from(description).length > 200) {
    fail('GroupDescriptionInvalidError', 'Group description must contain at most 200 characters.');
  }
  return description || null;
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

function mediaUrlsFor(post: MemoryPost): string[] {
  return post.mediaRefs.map((mediaRef) => {
    const url = COTERIE_IMAGE_URLS.get(mediaRef) ?? COTERIE_VIDEO_URLS.get(mediaRef);
    if (!url) {
      fail('MediaReferenceInvalidError', 'Post media must reference a committed fixture image or video.');
    }
    return url;
  });
}

function commonPostProjection(
  post: MemoryPost,
  viewerId: string,
  profiles: readonly Profile[],
  posts: readonly MemoryPost[],
  likes: readonly LikeEvent[],
  reposts: readonly RepostEvent[],
) {
  const profile = profiles.find((candidate) => candidate.id === post.authorId);
  if (!profile) throw new Error(`Missing profile projection for ${post.authorId}`);
  const postLikes = likes.filter((event) => event.postId === post.id);
  const postReposts = reposts.filter((event) => event.postId === post.id);
  return {
    postId: post.id,
    authorId: post.authorId,
    authorName: profile.displayName,
    authorHandle: profile.handle,
    avatarUrl: profile.avatarUrl,
    body: post.body,
    createdAt: post.createdAt,
    likeCount: postLikes.length,
    repostCount: postReposts.length,
    replyCount: posts.filter((candidate) => candidate.parentId === post.id).length,
    likedByMe: postLikes.some((event) => event.actorId === viewerId),
    repostedByMe: postReposts.some((event) => event.actorId === viewerId),
    mediaUrls: mediaUrlsFor(post),
    mediaKind: post.mediaKind,
  };
}

function compareFeedEvents(left: FeedEvent, right: FeedEvent): number {
  const byTime = right.feedSortAt.localeCompare(left.feedSortAt);
  return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
}

interface FeedCursorPayload {
  v: 1;
  mode: 'following' | 'global';
  sortAt: string;
  eventId: string;
}

function encodeFeedCursor(mode: FeedCursorPayload['mode'], event: FeedEvent): string {
  const json = JSON.stringify({ v: 1, mode, sortAt: event.feedSortAt, eventId: event.id });
  return globalThis.btoa(json).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeFeedCursor(value: unknown, mode: FeedCursorPayload['mode']): FeedCursorPayload | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    fail('FeedCursorInvalidError', 'The feed cursor is invalid for this feed mode.');
  }
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const parsed = JSON.parse(globalThis.atob(padded)) as Partial<FeedCursorPayload>;
    if (
      parsed.v !== 1 ||
      parsed.mode !== mode ||
      typeof parsed.sortAt !== 'string' ||
      typeof parsed.eventId !== 'string'
    ) {
      fail('FeedCursorInvalidError', 'The feed cursor is invalid for this feed mode.');
    }
    return parsed as FeedCursorPayload;
  } catch (error) {
    if (error instanceof Error && error.name === 'FeedCursorInvalidError') throw error;
    return fail('FeedCursorInvalidError', 'The feed cursor is invalid for this feed mode.');
  }
}

function feedRows(
  modeValue: unknown,
  cursorValue: unknown,
  viewerId: string,
  posts: readonly MemoryPost[],
  profiles: readonly Profile[],
  follows: readonly FollowEdge[],
  likes: readonly LikeEvent[],
  reposts: readonly RepostEvent[],
): FeedItem[] {
  if (modeValue !== 'following' && modeValue !== 'global') {
    fail('FeedModeInvalidError', 'Feed mode must be following or global.');
  }
  const mode = modeValue;
  const cursor = decodeFeedCursor(cursorValue, mode);
  const followed = new Set(
    follows
      .filter((edge) => edge.followerId === viewerId)
      .map((edge) => edge.followedId),
  );
  const visibleActor = (actorId: string): boolean =>
    mode === 'global' || actorId === viewerId || followed.has(actorId);
  const topLevelPosts = posts.filter((post) => post.parentId === null);
  const postById = new Map(topLevelPosts.map((post) => [post.id, post]));
  const events: FeedEvent[] = [
    ...topLevelPosts
      .filter((post) => visibleActor(post.authorId))
      .map((post) => ({ id: post.id, post, feedSortAt: post.createdAt, repost: null })),
    ...reposts
      .filter((event) => visibleActor(event.actorId))
      .flatMap((event) => {
        const post = postById.get(event.postId);
        return post
          ? [{ id: `repost:${event.actorId}:${event.postId}`, post, feedSortAt: event.createdAt, repost: event }]
          : [];
      }),
  ].sort(compareFeedEvents);
  const afterCursor = cursor
    ? events.filter(
        (event) =>
          event.feedSortAt < cursor.sortAt ||
          (event.feedSortAt === cursor.sortAt && event.id < cursor.eventId),
      )
    : events;
  const pageEvents = afterCursor.slice(0, FEED_PAGE_SIZE);
  const nextCursor = afterCursor.length > FEED_PAGE_SIZE && pageEvents.length > 0
    ? encodeFeedCursor(mode, pageEvents.at(-1)!)
    : null;
  return pageEvents.map((event) => {
    const reposter = event.repost
      ? profiles.find((profile) => profile.id === event.repost?.actorId)
      : null;
    return {
      id: event.id,
      ...commonPostProjection(event.post, viewerId, profiles, posts, likes, reposts),
      feedSortAt: event.feedSortAt,
      repostedById: reposter?.id ?? null,
      repostedByName: reposter?.displayName ?? null,
      repostedByHandle: reposter?.handle ?? null,
      nextCursor,
    };
  });
}

function profilePostRows(
  userId: string,
  viewerId: string,
  profiles: readonly Profile[],
  posts: readonly MemoryPost[],
  likes: readonly LikeEvent[],
  reposts: readonly RepostEvent[],
): ProfilePost[] {
  if (!profiles.some((profile) => profile.id === userId)) {
    fail('ProfileNotFoundError', 'The profile does not exist.');
  }
  return posts
    .filter((post) => post.authorId === userId && post.parentId === null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .map((post) => ({ id: post.id, ...commonPostProjection(post, viewerId, profiles, posts, likes, reposts) }));
}

function threadRows(
  parentId: string,
  viewerId: string,
  profiles: readonly Profile[],
  posts: readonly MemoryPost[],
  likes: readonly LikeEvent[],
  reposts: readonly RepostEvent[],
): ThreadPost[] {
  const parent = posts.find((post) => post.id === parentId);
  if (!parent) fail('ParentPostNotFoundError', 'The parent post does not exist.');
  const replies = posts
    .filter((post) => post.parentId === parentId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return [parent, ...replies].map((post, index) => ({
    id: post.id,
    ...commonPostProjection(post, viewerId, profiles, posts, likes, reposts),
    parentId: post.parentId,
    threadRole: index === 0 ? 'parent' : 'direct-reply',
  }));
}

function insightRows(
  posts: readonly MemoryPost[],
  follows: readonly FollowEdge[],
  likes: readonly LikeEvent[],
  reposts: readonly RepostEvent[],
  viewerId: string,
): InsightDay[] {
  const viewerPosts = posts.filter((post) => post.authorId === viewerId && post.parentId === null);
  const viewerPostIds = new Set(viewerPosts.map((post) => post.id));
  const totals = {
    totalPosts: viewerPosts.length,
    totalLikesReceived: likes.filter((event) => viewerPostIds.has(event.postId)).length,
    totalRepostsReceived: reposts.filter((event) => viewerPostIds.has(event.postId)).length,
    totalRepliesReceived: posts.filter((post) => post.parentId !== null && viewerPostIds.has(post.parentId)).length,
    totalFollowers: follows.filter((edge) => edge.followedId === viewerId).length,
    totalFollowing: follows.filter((edge) => edge.followerId === viewerId).length,
  };
  const dayMs = 24 * 60 * 60 * 1000;
  const end = Date.parse(FIXTURE_NOW.slice(0, 10) + 'T00:00:00.000Z');
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end - (6 - index) * dayMs).toISOString().slice(0, 10);
    return {
      id: `insight-${day}`,
      day,
      posts: viewerPosts.filter((post) => post.createdAt.slice(0, 10) === day).length,
      likesReceived: likes.filter(
        (event) => viewerPostIds.has(event.postId) && event.createdAt.slice(0, 10) === day,
      ).length,
      ...totals,
    };
  });
}

export interface CoterieMemoryHarness {
  provider: ContractDataProvider;
  boundary: ContractQueryBoundary;
  appendFixturePost(): FeedItem;
  advanceClock(ms: number): void;
}

interface ScheduledClockWork {
  deadlineMs: number;
  callback: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  canceled: boolean;
}

function createTypingClock(startMs: number) {
  let logicalNowMs = startMs;
  const scheduled = new Set<ScheduledClockWork>();
  const run = (work: ScheduledClockWork): void => {
    if (work.canceled) return;
    work.canceled = true;
    if (work.timer !== null) clearTimeout(work.timer);
    scheduled.delete(work);
    logicalNowMs = Math.max(logicalNowMs, work.deadlineMs);
    work.callback();
  };
  return {
    now: () => logicalNowMs,
    schedule(delayMs: number, callback: () => void): (() => void) {
      const work: ScheduledClockWork = {
        deadlineMs: logicalNowMs + delayMs,
        callback,
        timer: null,
        canceled: false,
      };
      work.timer = setTimeout(() => run(work), delayMs);
      const timerWithUnref = work.timer as ReturnType<typeof setTimeout> & { unref?: () => void };
      timerWithUnref.unref?.();
      scheduled.add(work);
      return () => {
        if (work.canceled) return;
        work.canceled = true;
        if (work.timer !== null) clearTimeout(work.timer);
        scheduled.delete(work);
      };
    },
    advance(ms: number): void {
      if (!Number.isFinite(ms) || ms < 0) throw new Error('Clock advance must be nonnegative.');
      logicalNowMs += ms;
      for (const work of [...scheduled].sort((left, right) => left.deadlineMs - right.deadlineMs)) {
        if (work.deadlineMs <= logicalNowMs) run(work);
      }
    },
  };
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
  let activitySequence = 0;
  let messageSequence = 0;
  let chatSequence = 0;
  let chatEventSequence = 0;
  let sessionSequence = 0;
  let revocationSequence = 0;
  const processedReactionMutationIds = new Set<string>();
  const typingClock = createTypingClock(Date.parse(FIXTURE_NOW));
  const typingExpiryCancels = new Map<string, () => void>();
  let activeViewerId: string | null = VIEWER_ID;
  const boundary = withMultiTableQueries(createContractMockQueryBoundary({
    accounts: cloneRows(initialAccounts),
    sessions: cloneRows(initialSession),
    sessionRevocations: [],
    profiles: cloneRows(initialProfiles),
    follows: cloneRows(initialFollowEdges),
    posts: cloneRows(initialPosts),
    likes: cloneRows(initialLikes),
    reposts: cloneRows(initialReposts),
    chats: cloneRows(initialChats),
    chatMemberships: cloneRows(initialChatMemberships),
    messages: cloneRows(initialMessages),
    messageReceipts: cloneRows(initialMessageReceipts),
    ephemeralTyping: [],
    search: cloneRows(initialSearch),
  }));

  const nextChatEventAt = (): string => new Date(
    Date.parse(FIXTURE_NOW) + 60_000 + ++chatEventSequence * 1000,
  ).toISOString();

  const requireActiveViewer = (): string => {
    const active = boundary.snapshot('sessions') as Session[];
    if (!activeViewerId || !active.some((session) => session.userId === activeViewerId)) {
      fail('SessionRequiredError', 'An active session is required.');
    }
    return activeViewerId;
  };

  const requireChat = (chatId: string): MemoryChat => {
    const chat = (boundary.snapshot('chats') as MemoryChat[]).find(
      (candidate) => candidate.id === chatId,
    );
    if (!chat) fail('ChatNotFoundError', 'Conversation was not found.');
    return chat;
  };

  const requireCurrentMembership = (chatId: string, userId: string): ChatMembership => {
    const membership = (boundary.snapshot('chatMemberships') as ChatMembership[]).find(
      (candidate) => candidate.chatId === chatId
        && candidate.userId === userId
        && candidate.active,
    );
    if (!membership) {
      fail('ChatMembershipRequiredError', 'Conversation membership is required.');
    }
    return membership;
  };

  const requireGroupAdmin = (chatId: string, userId: string): MemoryChat => {
    const chat = requireChat(chatId);
    if (chat.kind !== 'group') {
      fail('GroupRequiredError', 'This operation requires a group conversation.');
    }
    const membership = requireCurrentMembership(chatId, userId);
    if (!membership.isAdmin) fail('ChatAdminRequiredError', 'A group admin is required.');
    return chat;
  };

  const clearTypingFor = (chatId: string, userId: string): void => {
    const key = `${chatId}:${userId}`;
    typingExpiryCancels.get(key)?.();
    typingExpiryCancels.delete(key);
    const existing = boundary.snapshot('ephemeralTyping') as MemoryTyping[];
    if (!existing.some((entry) => entry.chatId === chatId && entry.userId === userId)) return;
    boundary.write<MemoryTyping>('ephemeralTyping', (rows) => rows.filter(
      (entry) => entry.chatId !== chatId || entry.userId !== userId,
    ));
  };

  const dropRecipientRequirement = (chatId: string, userId: string): void => {
    boundary.write<MemoryMessage>('messages', (rows) => rows.map((message) =>
      message.chatId === chatId
        && message.recipientIds.includes(userId)
        && !message.droppedRecipientIds.includes(userId)
        ? { ...message, droppedRecipientIds: [...message.droppedRecipientIds, userId] }
        : message,
    ));
  };

  const writeViewerProjections = (viewerId: string): void => {
    const follows = boundary.snapshot('follows') as FollowEdge[];
    boundary.write<Profile>('profiles', (rows) =>
      rows.map((profile) => ({
        ...profile,
        isMe: profile.id === viewerId,
        followedByMe:
          profile.id !== viewerId &&
          follows.some(
            (edge) => edge.followerId === viewerId && edge.followedId === profile.id,
          ),
      })),
    );
  };

  const revokeActiveSessions = (reason: RevokedSession['reason']): string | null => {
    const active = boundary.snapshot('sessions') as Session[];
    if (active.length === 0) return null;
    const revokedAt = new Date(
      Date.parse(FIXTURE_NOW) + ++revocationSequence * 1000,
    ).toISOString();
    boundary.write<RevokedSession>('sessionRevocations', (rows) => [
      ...rows,
      ...active.map((session) => ({
        ...session,
        signedIn: false,
        revokedAt,
        reason,
      })),
    ]);
    boundary.write<Session>('sessions', () => []);
    return active[0]?.token ?? null;
  };

  const startSession = (userId: string): Session => {
    revokeActiveSessions('replaced');
    activeViewerId = userId;
    const sequence = String(++sessionSequence).padStart(4, '0');
    const session: Session = {
      id: `session-${userId}-${sequence}`,
      userId,
      signedIn: true,
      token: `coterie-memory-session-${userId}-${sequence}`,
      expiresAt: SESSION_EXPIRES_AT,
      revokedAt: null,
    };
    boundary.write<Session>('sessions', () => [session]);
    writeViewerProjections(userId);
    return session;
  };

  const provider = createBoundaryContractDataProvider(coterieSurfaceManifest, boundary, {
    queries: {
      listSession: (_args, queryBoundary) =>
        queryBoundary.query<Session>(
          'sessions',
          (rows) => cloneRows(rows as Session[]),
          { key: 'session' },
        ),
      listFeed: (args, queryBoundary) =>
        queryAcrossTables<FeedItem>(
          queryBoundary,
          ['posts', 'profiles', 'follows', 'likes', 'reposts'],
          () => feedRows(
            args.mode,
            args.cursor,
            activeViewerId ?? VIEWER_ID,
            queryBoundary.snapshot('posts') as MemoryPost[],
            queryBoundary.snapshot('profiles') as Profile[],
            queryBoundary.snapshot('follows') as FollowEdge[],
            queryBoundary.snapshot('likes') as LikeEvent[],
            queryBoundary.snapshot('reposts') as RepostEvent[],
          ),
          { key: `feed:${String(args.mode)}:${String(args.cursor ?? '')}` },
        ),
      listThread: (args, queryBoundary) =>
        queryAcrossTables<ThreadPost>(
          queryBoundary,
          ['posts', 'profiles', 'likes', 'reposts'],
          () => threadRows(
            String(args.parentId),
            activeViewerId ?? VIEWER_ID,
            queryBoundary.snapshot('profiles') as Profile[],
            queryBoundary.snapshot('posts') as MemoryPost[],
            queryBoundary.snapshot('likes') as LikeEvent[],
            queryBoundary.snapshot('reposts') as RepostEvent[],
          ),
          { key: `thread:${String(args.parentId)}` },
        ),
      listProfilePosts: (args, queryBoundary) =>
        queryAcrossTables<ProfilePost>(
          queryBoundary,
          ['posts', 'profiles', 'likes', 'reposts'],
          () => profilePostRows(
            String(args.userId),
            activeViewerId ?? VIEWER_ID,
            queryBoundary.snapshot('profiles') as Profile[],
            queryBoundary.snapshot('posts') as MemoryPost[],
            queryBoundary.snapshot('likes') as LikeEvent[],
            queryBoundary.snapshot('reposts') as RepostEvent[],
          ),
          { key: `profile-posts:${String(args.userId)}` },
        ),
      listProfiles: (_args, queryBoundary) =>
        queryBoundary.query<Profile>(
          'profiles',
          (rows) => cloneRows(rows as Profile[]),
          { key: 'profiles' },
        ),
      listChats: (_args, queryBoundary) =>
        queryAcrossTables<Chat>(
          queryBoundary,
          ['chats', 'chatMemberships', 'messages', 'messageReceipts', 'ephemeralTyping', 'profiles', 'sessions'],
          () => {
            const viewerId = (queryBoundary.snapshot('sessions') as Session[])[0]?.userId;
            return viewerId === undefined ? [] : projectChats(
              queryBoundary.snapshot('chats') as MemoryChat[],
              queryBoundary.snapshot('chatMemberships') as ChatMembership[],
              queryBoundary.snapshot('messages') as MemoryMessage[],
              queryBoundary.snapshot('messageReceipts') as MessageReceipt[],
              queryBoundary.snapshot('ephemeralTyping') as MemoryTyping[],
              queryBoundary.snapshot('profiles') as Profile[],
              viewerId,
              typingClock.now(),
            );
          },
          { key: 'chats' },
        ),
      listMessages: (args, queryBoundary) =>
        queryAcrossTables<Message>(
          queryBoundary,
          ['chats', 'messages', 'messageReceipts', 'chatMemberships', 'profiles', 'sessions'],
          () => {
            const chatId = String(args.chatId);
            const viewerId = (queryBoundary.snapshot('sessions') as Session[])[0]?.userId;
            if (viewerId === undefined) return [];
            const chats = queryBoundary.snapshot('chats') as MemoryChat[];
            if (!chats.some((chat) => chat.id === chatId)) {
              fail('ChatNotFoundError', 'Conversation was not found.');
            }
            const membership = (queryBoundary.snapshot('chatMemberships') as ChatMembership[]).find(
              (candidate) => candidate.chatId === chatId && candidate.userId === viewerId,
            );
            if (!membership) {
              fail('ChatMembershipRequiredError', 'Conversation membership is required.');
            }
            return projectMessages(
              visibleMessagesFor(queryBoundary.snapshot('messages') as MemoryMessage[], membership),
              queryBoundary.snapshot('messageReceipts') as MessageReceipt[],
              queryBoundary.snapshot('profiles') as Profile[],
              viewerId,
            );
          },
          { key: `messages:${String(args.chatId)}` },
        ),
      observeTyping: (args, queryBoundary) =>
        queryAcrossTables<TypingParticipant>(
          queryBoundary,
          ['ephemeralTyping', 'chatMemberships', 'profiles', 'sessions'],
          () => {
            const chatId = String(args.chatId);
            const viewerId = (queryBoundary.snapshot('sessions') as Session[])[0]?.userId;
            if (viewerId === undefined) return [];
            requireChat(chatId);
            const memberships = queryBoundary.snapshot('chatMemberships') as ChatMembership[];
            const viewerMembership = memberships.find(
              (membership) => membership.chatId === chatId && membership.userId === viewerId,
            );
            if (!viewerMembership) {
              fail('ChatMembershipRequiredError', 'Conversation membership is required.');
            }
            if (!viewerMembership.active) return [];
            const profiles = queryBoundary.snapshot('profiles') as Profile[];
            return (queryBoundary.snapshot('ephemeralTyping') as MemoryTyping[])
              .filter((entry) => entry.chatId === chatId
                && entry.userId !== viewerId
                && entry.expiresAtMs > typingClock.now()
                && memberships.some((membership) => membership.chatId === chatId
                  && membership.userId === entry.userId
                  && membership.active))
              .map((entry) => ({
                id: entry.id,
                chatId,
                userId: entry.userId,
                displayName: profiles.find((profile) => profile.id === entry.userId)?.displayName
                  ?? entry.userId,
                expiresAt: new Date(entry.expiresAtMs).toISOString(),
              }));
          },
          { key: `typing:${String(args.chatId)}` },
        ),
      listProviderClaims: (_args, _queryBoundary): ProviderClaim[] =>
        allCoterieProviderClaims(),
      searchSocial: (args, queryBoundary) =>
        queryBoundary.query<SearchResult>(
          'search',
          (rows) =>
            cloneRows((rows as SearchResult[]).filter((result) =>
              matchesWordPrefix(`${result.title} ${result.subtitle}`, String(args.query ?? '')),
            )),
          { key: `search:${String(args.query)}` },
        ),
      listInsights: (_args, queryBoundary) =>
        queryAcrossTables<InsightDay>(
          queryBoundary,
          ['posts', 'follows', 'likes', 'reposts'],
          () =>
            insightRows(
              queryBoundary.snapshot('posts') as MemoryPost[],
              queryBoundary.snapshot('follows') as FollowEdge[],
              queryBoundary.snapshot('likes') as LikeEvent[],
              queryBoundary.snapshot('reposts') as RepostEvent[],
              activeViewerId ?? VIEWER_ID,
            ),
          { key: 'insights' },
        ),
    },
    mutations: {
      signup: (args, queryBoundary) => {
        const email = validatedEmail(args.email);
        const password = validatedPassword(args.password);
        const handle = validatedHandle(args.handle);
        const displayName = validatedDisplayName(args.displayName);
        const accounts = queryBoundary.snapshot('accounts') as MemoryAccount[];
        if (accounts.some((account) => account.email === email)) {
          fail('DuplicateEmailError', 'An account already uses that email.');
        }
        if (accounts.some((account) => account.handle === handle)) {
          fail('DuplicateHandleError', 'An account already uses that handle.');
        }

        const userId = `local-${handle}`;
        const account: MemoryAccount = { id: userId, email, password, handle };
        const profile: Profile = {
          id: userId,
          handle,
          displayName,
          bio: '',
          location: '',
          link: '',
          avatarUrl: null,
          avatarRef: null,
          followers: 0,
          following: 0,
          followedByMe: false,
          isMe: true,
        };
        queryBoundary.write<MemoryAccount>('accounts', (rows) => [...rows, account]);
        queryBoundary.write<Profile>('profiles', (rows) => [...rows, profile]);
        queryBoundary.write<SearchResult>('search', (rows) => [
          ...rows,
          {
            id: userId,
            kind: 'person',
            title: displayName,
            subtitle: `@${handle}`,
            avatarUrl: null,
          },
        ]);
        const session = startSession(userId);
        return { userId, sessionToken: session.token };
      },
      login: (args, queryBoundary) => {
        const email = normalizedEmail(args.email);
        const password = String(args.password ?? '');
        const account = (queryBoundary.snapshot('accounts') as MemoryAccount[]).find(
          (candidate) => candidate.email === email && candidate.password === password,
        );
        if (!account) {
          fail('InvalidCredentialsError', 'Email or password is incorrect.');
        }
        const session = startSession(account.id);
        return { userId: account.id, sessionToken: session.token };
      },
      logout: () => {
        const revokedToken = revokeActiveSessions('logout');
        activeViewerId = null;
        return { revokedToken };
      },
      createPost: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const body = String(args.body ?? '').normalize('NFC').trim();
        const imageRefs = Array.isArray(args.imageRefs)
          ? args.imageRefs.map((value) => String(value))
          : [];
        const videoRefs = Array.isArray(args.videoRefs)
          ? args.videoRefs.map((value) => String(value))
          : [];
        const parentId = args.parentId === null || args.parentId === undefined
          ? null
          : String(args.parentId);
        if (Array.from(body).length > 500 || (!body && imageRefs.length === 0 && videoRefs.length === 0)) {
          fail(
            'PostBodyInvalidError',
            'Post text must contain at most 500 characters, and text-only posts cannot be empty.',
          );
        }
        if (imageRefs.length > 0 && videoRefs.length > 0) {
          fail('MediaMixInvalidError', 'A post cannot mix images and video.');
        }
        if (imageRefs.length > 4) {
          fail('ImageCountInvalidError', 'Image posts require 1-4 fixture images.');
        }
        if (videoRefs.length > 1) {
          fail('VideoCountInvalidError', 'Video posts require exactly one fixture video.');
        }
        if (imageRefs.some((mediaRef) => !COTERIE_IMAGE_URLS.has(mediaRef))) {
          fail(
            'MediaReferenceInvalidError',
            'Post media must reference a committed fixture image or video.',
          );
        }
        if (videoRefs.some((mediaRef) => !COTERIE_VIDEO_URLS.has(mediaRef))) {
          fail(
            'MediaReferenceInvalidError',
            'Post media must reference a committed fixture image or video.',
          );
        }
        if (
          parentId !== null &&
          !(queryBoundary.snapshot('posts') as MemoryPost[]).some((post) => post.id === parentId)
        ) {
          fail('ParentPostNotFoundError', 'The parent post does not exist.');
        }
        const item: MemoryPost = {
          id: `coterie-local-post-${String(++postSequence).padStart(4, '0')}`,
          authorId: viewerId,
          body,
          createdAt: new Date(Date.parse(FIXTURE_NOW) + postSequence * 1000).toISOString(),
          parentId,
          mediaKind: imageRefs.length > 0 ? 'images' : videoRefs.length > 0 ? 'video' : null,
          mediaRefs: imageRefs.length > 0 ? imageRefs : videoRefs,
        };
        queryBoundary.write<MemoryPost>('posts', (rows) => [...rows, item]);
        return { id: item.id };
      },
      setLike: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const postId = String(args.postId);
        const liked = Boolean(args.liked);
        if (!(queryBoundary.snapshot('posts') as MemoryPost[]).some((post) => post.id === postId)) {
          fail('PostNotFoundError', 'The post does not exist.');
        }
        const existing = (queryBoundary.snapshot('likes') as LikeEvent[]).some(
          (event) => event.postId === postId && event.actorId === viewerId,
        );
        queryBoundary.write<LikeEvent>('likes', (rows) => {
          if (existing === liked) return rows;
          if (!liked) {
            return rows.filter((event) => !(event.postId === postId && event.actorId === viewerId));
          }
          return [
            ...rows,
            {
              postId,
              actorId: viewerId,
              createdAt: new Date(
                Date.parse(FIXTURE_NOW) + ++activitySequence * 1000,
              ).toISOString(),
              mutationId: String(args.mutationId),
            },
          ];
        });
      },
      setFollow: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const userId = String(args.userId);
        const following = Boolean(args.following);
        if (userId === viewerId) {
          fail('SelfFollowInvalidError', 'Self-follow is implicit for feeds and is not a follow edge.');
        }
        if (!(queryBoundary.snapshot('profiles') as Profile[]).some((profile) => profile.id === userId)) {
          fail('ProfileNotFoundError', 'The profile does not exist.');
        }
        const edges = queryBoundary.snapshot('follows') as FollowEdge[];
        const wasFollowing = edges.some(
          (edge) => edge.followerId === viewerId && edge.followedId === userId,
        );
        queryBoundary.write<FollowEdge>('follows', (rows) => {
          if (wasFollowing === following) return rows;
          if (following) {
            return [
              ...rows,
              { id: `mf-${viewerId}-${userId}`, followerId: viewerId, followedId: userId },
            ];
          }
          return rows.filter(
            (edge) => !(edge.followerId === viewerId && edge.followedId === userId),
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
            if (profile.id === viewerId) {
              return {
                ...profile,
                following: profile.following + (following ? 1 : -1),
              };
            }
            return profile;
          }),
        );
      },
      setRepost: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const postId = String(args.postId);
        const reposted = Boolean(args.reposted);
        const post = (queryBoundary.snapshot('posts') as MemoryPost[]).find(
          (candidate) => candidate.id === postId,
        );
        if (!post) {
          fail('PostNotFoundError', 'The post does not exist.');
        }
        if (post.parentId !== null) {
          fail('ReplyRepostForbiddenError', 'Replies cannot be reposted.');
        }
        const existing = (queryBoundary.snapshot('reposts') as RepostEvent[]).some(
          (event) => event.postId === postId && event.actorId === viewerId,
        );
        queryBoundary.write<RepostEvent>('reposts', (rows) => {
          if (existing === reposted) return rows;
          if (!reposted) {
            return rows.filter((event) => !(event.postId === postId && event.actorId === viewerId));
          }
          return [
            ...rows,
            {
              postId,
              actorId: viewerId,
              createdAt: new Date(
                Date.parse(FIXTURE_NOW) + 60_000 + ++activitySequence * 1000,
              ).toISOString(),
              mutationId: String(args.mutationId),
            },
          ];
        });
      },
      editProfile: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const current = (queryBoundary.snapshot('profiles') as Profile[]).find(
          (profile) => profile.id === viewerId,
        );
        if (!current) {
          fail('SessionRequiredError', 'An active session is required.');
        }
        const displayName = validatedDisplayName(args.displayName);
        const bio = validatedBio(args.bio);
        const handle = args.handle === null ? current.handle : validatedHandle(args.handle);
        const location = args.location === null
          ? current.location
          : validatedLocation(args.location);
        const link = args.link === null ? current.link : validatedLink(args.link);
        const duplicate = (queryBoundary.snapshot('accounts') as MemoryAccount[]).some(
          (account) => account.id !== viewerId && account.handle === handle,
        );
        if (duplicate) {
          fail('DuplicateHandleError', 'An account already uses that handle.');
        }
        queryBoundary.write<MemoryAccount>('accounts', (rows) =>
          rows.map((account) => (account.id === viewerId ? { ...account, handle } : account)),
        );
        queryBoundary.write<Profile>('profiles', (rows) =>
          rows.map((profile) =>
            profile.id === viewerId
              ? { ...profile, displayName, handle, bio, location, link }
              : profile,
          ),
        );
        queryBoundary.write<MemoryMessage>('messages', (rows) =>
          rows.map((message) =>
            message.senderId === viewerId ? { ...message, senderName: displayName } : message,
          ),
        );
        queryBoundary.write<SearchResult>('search', (rows) =>
          rows.map((result) =>
            result.kind === 'person' && result.id === viewerId
              ? { ...result, title: displayName, subtitle: `@${handle}` }
              : result,
          ),
        );
      },
      setAvatar: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const avatarRef = String(args.avatarRef ?? '');
        const avatarUrl = coterieAvatarUrlForRef(avatarRef);
        if (!avatarUrl) {
          fail(
            'AvatarReferenceInvalidError',
            'Avatar reference is invalid or unavailable.',
          );
        }
        queryBoundary.write<Profile>('profiles', (rows) =>
          rows.map((profile) =>
            profile.id === viewerId ? { ...profile, avatarUrl, avatarRef } : profile,
          ),
        );
        queryBoundary.write<SearchResult>('search', (rows) =>
          rows.map((result) =>
            result.kind === 'person' && result.id === viewerId
              ? { ...result, avatarUrl }
              : result,
          ),
        );
        return { avatarUrl };
      },
      openDm: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const userId = String(args.userId);
        if (userId === viewerId) {
          fail('DirectMessageSelfError', 'A direct conversation requires another user.');
        }
        if (!(queryBoundary.snapshot('profiles') as Profile[]).some((profile) => profile.id === userId)) {
          fail('ProfileNotFoundError', 'The profile does not exist.');
        }
        const pair = [viewerId, userId].sort();
        const pairKey = pair.join(':');
        const existing = (queryBoundary.snapshot('chats') as MemoryChat[]).find(
          (chat) => chat.kind === 'dm' && chat.dmPairKey === pairKey,
        );
        if (existing) return { chatId: existing.id, reused: true };
        const createdAt = nextChatEventAt();
        const id = `d-${pair.join('-')}`;
        queryBoundary.write<MemoryChat>('chats', (rows) => [...rows, {
          id,
          kind: 'dm',
          name: null,
          description: null,
          createdAt,
          updatedAt: createdAt,
          accentColor: '#4F46E5',
          disappearing: 'off',
          dmPairKey: pairKey,
        }]);
        queryBoundary.write<ChatMembership>('chatMemberships', (rows) => [
          ...rows,
          ...pair.map((memberId) => ({
            id: `mm-${id}-${memberId}`,
            chatId: id,
            userId: memberId,
            isAdmin: false,
            active: true,
            joinedAt: createdAt,
            historyThrough: null,
          })),
        ]);
        return { chatId: id, reused: false };
      },
      createGroup: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const name = validatedGroupName(args.name);
        const description = validatedGroupDescription(args.description);
        const memberIds = Array.isArray(args.memberIds)
          ? args.memberIds.map((value) => String(value))
          : [];
        const uniqueMemberIds = [...new Set(memberIds)];
        if (
          memberIds.length !== uniqueMemberIds.length
          || uniqueMemberIds.length < 2
          || uniqueMemberIds.length > 50
          || !uniqueMemberIds.includes(viewerId)
        ) {
          fail(
            'GroupMembersInvalidError',
            'A group requires 2-50 unique members including its creator.',
          );
        }
        const profileIds = new Set(
          (queryBoundary.snapshot('profiles') as Profile[]).map((profile) => profile.id),
        );
        if (uniqueMemberIds.some((userId) => !profileIds.has(userId))) {
          fail('ProfileNotFoundError', 'The profile does not exist.');
        }
        const createdAt = nextChatEventAt();
        const id = `g-coterie-${String(++chatSequence).padStart(4, '0')}`;
        queryBoundary.write<MemoryChat>('chats', (rows) => [...rows, {
          id,
          kind: 'group',
          name,
          description,
          createdAt,
          updatedAt: createdAt,
          accentColor: '#0D9488',
          disappearing: 'off',
          dmPairKey: null,
        }]);
        queryBoundary.write<ChatMembership>('chatMemberships', (rows) => [
          ...rows,
          ...uniqueMemberIds.map((userId) => ({
            id: `mm-${id}-${userId}`,
            chatId: id,
            userId,
            isAdmin: userId === viewerId,
            active: true,
            joinedAt: createdAt,
            historyThrough: null,
          })),
        ]);
        return { chatId: id };
      },
      addMember: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const chatId = String(args.chatId);
        const userId = String(args.userId);
        requireGroupAdmin(chatId, viewerId);
        if (!(queryBoundary.snapshot('profiles') as Profile[]).some((profile) => profile.id === userId)) {
          fail('ProfileNotFoundError', 'The profile does not exist.');
        }
        const memberships = queryBoundary.snapshot('chatMemberships') as ChatMembership[];
        const current = memberships.find(
          (membership) => membership.chatId === chatId && membership.userId === userId,
        );
        if (current?.active) {
          fail('ChatMemberAlreadyExistsError', 'That profile is already a group member.');
        }
        if (memberships.filter((membership) => membership.chatId === chatId && membership.active).length >= 50) {
          fail('ChatMemberLimitError', 'A group may contain at most 50 members.');
        }
        const joinedAt = nextChatEventAt();
        queryBoundary.write<ChatMembership>('chatMemberships', (rows) => current
          ? rows.map((membership) => membership.id === current.id
            ? { ...membership, active: true, isAdmin: false, joinedAt, historyThrough: null }
            : membership)
          : [...rows, {
              id: `mm-${chatId}-${userId}`,
              chatId,
              userId,
              isAdmin: false,
              active: true,
              joinedAt,
              historyThrough: null,
            }]);
      },
      removeMember: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const chatId = String(args.chatId);
        const userId = String(args.userId);
        requireGroupAdmin(chatId, viewerId);
        if (userId === viewerId) {
          fail('RemoveSelfInvalidError', 'Use leave chat to remove yourself.');
        }
        const target = (queryBoundary.snapshot('chatMemberships') as ChatMembership[]).find(
          (membership) => membership.chatId === chatId
            && membership.userId === userId
            && membership.active,
        );
        if (!target) {
          fail('ChatMemberNotFoundError', 'That profile is not a current group member.');
        }
        const historyThrough = nextChatEventAt();
        queryBoundary.write<ChatMembership>('chatMemberships', (rows) => rows.map(
          (membership) => membership.id === target.id
            ? { ...membership, active: false, isAdmin: false, historyThrough }
            : membership,
        ));
        dropRecipientRequirement(chatId, userId);
        clearTypingFor(chatId, userId);
      },
      promoteAdmin: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const chatId = String(args.chatId);
        const userId = String(args.userId);
        requireGroupAdmin(chatId, viewerId);
        const target = (queryBoundary.snapshot('chatMemberships') as ChatMembership[]).find(
          (membership) => membership.chatId === chatId
            && membership.userId === userId
            && membership.active,
        );
        if (!target) {
          fail('ChatMemberNotFoundError', 'That profile is not a current group member.');
        }
        if (target.isAdmin) return;
        queryBoundary.write<ChatMembership>('chatMemberships', (rows) => rows.map(
          (membership) => membership.id === target.id
            ? { ...membership, isAdmin: true }
            : membership,
        ));
      },
      leaveChat: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const chatId = String(args.chatId);
        const chat = requireChat(chatId);
        if (chat.kind !== 'group') {
          fail('GroupRequiredError', 'This operation requires a group conversation.');
        }
        const membership = requireCurrentMembership(chatId, viewerId);
        const historyThrough = nextChatEventAt();
        queryBoundary.write<ChatMembership>('chatMemberships', (rows) => rows.map(
          (candidate) => candidate.id === membership.id
            ? { ...candidate, active: false, isAdmin: false, historyThrough }
            : candidate,
        ));
        dropRecipientRequirement(chatId, viewerId);
        clearTypingFor(chatId, viewerId);
      },
      sendMessage: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const body = String(args.body ?? '').trim();
        if (Array.from(body).length < 1 || Array.from(body).length > 2000) {
          fail('MessageBodyInvalidError', 'Message text must contain 1-2000 characters.');
        }
        const chatId = String(args.chatId);
        requireChat(chatId);
        requireCurrentMembership(chatId, viewerId);
        const quotedMessageId = args.quotedMessageId === null || args.quotedMessageId === undefined
          ? null
          : String(args.quotedMessageId);
        const quotedMessage = quotedMessageId === null
          ? null
          : (queryBoundary.snapshot('messages') as MemoryMessage[]).find(
              (candidate) => candidate.id === quotedMessageId,
            ) ?? null;
        if (quotedMessageId !== null && quotedMessage?.chatId !== chatId) {
          fail(
            'QuotedMessageInvalidError',
            'Quoted message must exist in this conversation.',
          );
        }
        const profile = (queryBoundary.snapshot('profiles') as Profile[]).find(
          (row) => row.id === viewerId,
        );
        const createdAt = nextChatEventAt();
        const recipientIds = (queryBoundary.snapshot('chatMemberships') as ChatMembership[])
          .filter((membership) => membership.chatId === chatId
            && membership.active
            && membership.userId !== viewerId)
          .map((membership) => membership.userId);
        const message: MemoryMessage = {
          id: `coterie-local-message-${String(++messageSequence).padStart(4, '0')}`,
          chatId,
          senderId: viewerId,
          senderName: profile?.displayName ?? viewerId,
          body,
          createdAt,
          quotedMessageId,
          reactionEvents: [],
          edited: false,
          deleted: false,
          recipientIds,
          droppedRecipientIds: [],
        };
        queryBoundary.write<MemoryMessage>('messages', (rows) => [...rows, message]);
        queryBoundary.write<MessageReceipt>('messageReceipts', (rows) => [
          ...rows,
          ...recipientIds.map((userId) => ({
            id: `mr-${message.id}-${userId}`,
            messageId: message.id,
            userId,
            state: 'sent' as const,
          })),
        ]);
        queryBoundary.write<MemoryChat>('chats', (rows) =>
          rows.map((chat) =>
            chat.id === chatId ? { ...chat, updatedAt: createdAt } : chat,
          ),
        );
        clearTypingFor(chatId, viewerId);
        return { id: message.id };
      },
      setTyping: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const chatId = String(args.chatId);
        requireChat(chatId);
        requireCurrentMembership(chatId, viewerId);
        if (!Boolean(args.active)) {
          clearTypingFor(chatId, viewerId);
          return;
        }
        const key = `${chatId}:${viewerId}`;
        typingExpiryCancels.get(key)?.();
        const expiresAtMs = typingClock.now() + 5000;
        queryBoundary.write<MemoryTyping>('ephemeralTyping', (rows) => [
          ...rows.filter((entry) => entry.id !== key),
          { id: key, chatId, userId: viewerId, expiresAtMs },
        ]);
        typingExpiryCancels.set(key, typingClock.schedule(5000, () => {
          typingExpiryCancels.delete(key);
          boundary.write<MemoryTyping>('ephemeralTyping', (rows) => rows.filter(
            (entry) => entry.id !== key || entry.expiresAtMs !== expiresAtMs,
          ));
        }));
      },
      markReceipt: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const chatId = String(args.chatId);
        requireChat(chatId);
        requireCurrentMembership(chatId, viewerId);
        const state = String(args.state) as ReceiptState;
        if (state !== 'delivered' && state !== 'read') {
          fail('ReceiptStateInvalidError', 'Receipt state must be delivered or read.');
        }
        const messageIds = new Set(
          (queryBoundary.snapshot('messages') as MemoryMessage[])
            .filter((message) => message.chatId === chatId
              && message.senderId !== viewerId
              && message.recipientIds.includes(viewerId)
              && !message.droppedRecipientIds.includes(viewerId))
            .map((message) => message.id),
        );
        const currentReceipts = queryBoundary.snapshot('messageReceipts') as MessageReceipt[];
        const changes = currentReceipts.some((receipt) => messageIds.has(receipt.messageId)
          && receipt.userId === viewerId
          && RECEIPT_RANK[receipt.state] < RECEIPT_RANK[state]);
        if (!changes) return;
        queryBoundary.write<MessageReceipt>('messageReceipts', (rows) => rows.map((receipt) =>
          messageIds.has(receipt.messageId)
            && receipt.userId === viewerId
            && RECEIPT_RANK[receipt.state] < RECEIPT_RANK[state]
            ? { ...receipt, state }
            : receipt,
        ));
      },
      setMessageReaction: (args, queryBoundary) => {
        const viewerId = requireActiveViewer();
        const chatId = String(args.chatId);
        requireChat(chatId);
        requireCurrentMembership(chatId, viewerId);
        const messageId = String(args.messageId);
        const message = (queryBoundary.snapshot('messages') as MemoryMessage[]).find(
          (candidate) => candidate.id === messageId && candidate.chatId === chatId,
        );
        if (!message) {
          fail('MessageNotFoundError', 'Message was not found in this conversation.');
        }
        const emoji = validatedEmoji(args.emoji);
        const reacted = Boolean(args.reacted);
        const mutationKey = `${viewerId}:${String(args.mutationId)}`;
        if (processedReactionMutationIds.has(mutationKey)) return;
        queryBoundary.write<MemoryMessage>('messages', (rows) =>
          rows.map((candidate) => {
            if (candidate.id !== messageId) return candidate;
            const current = candidate.reactionEvents.find(
              (reaction) => reaction.actorId === viewerId,
            );
            if (reacted && current?.emoji === emoji) return candidate;
            if (!reacted && current?.emoji !== emoji) return candidate;
            const withoutViewer = candidate.reactionEvents.filter(
              (reaction) => reaction.actorId !== viewerId,
            );
            return {
              ...candidate,
              reactionEvents: reacted
                ? [...withoutViewer, { actorId: viewerId, emoji }]
                : withoutViewer,
            };
          }),
        );
        processedReactionMutationIds.add(mutationKey);
      },
      setChatAccent: (args, queryBoundary) => {
        const color = String(args.color);
        if (!ACCENT_COLORS.has(color)) throw new Error(`Unsupported accent ${color}`);
        queryBoundary.write<MemoryChat>('chats', (rows) =>
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
        queryBoundary.write<MemoryChat>('chats', (rows) =>
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
    advanceClock(ms) {
      typingClock.advance(ms);
    },
    appendFixturePost() {
      const item: MemoryPost = {
        ...initialPosts.find((post) => post.id === 'sp0001')!,
        id: `coterie-conformance-sp0001-${String(++postSequence).padStart(4, '0')}`,
        createdAt: new Date(Date.parse(FIXTURE_NOW) + postSequence * 1000).toISOString(),
        mediaRefs: [],
      };
      boundary.write<MemoryPost>('posts', (rows) => [...rows, item]);
      return feedRows(
        'global',
        null,
        activeViewerId ?? VIEWER_ID,
        boundary.snapshot('posts') as MemoryPost[],
        boundary.snapshot('profiles') as Profile[],
        boundary.snapshot('follows') as FollowEdge[],
        boundary.snapshot('likes') as LikeEvent[],
        boundary.snapshot('reposts') as RepostEvent[],
      ).find((row) => row.postId === item.id)!;
    },
  };
}

export function createCoterieMemoryProvider(): ContractDataProvider {
  return createCoterieMemoryHarness().provider;
}
