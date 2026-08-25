import type {
  ContractDataProvider,
  DataCellV2,
  DataConnection,
  DataMutationCorrelation,
  DataMutationResult,
  DataObserver,
  DataSubscription,
  SerializedError,
} from '@exact/contract/runtime';

import { createAssetClient } from '../../../../packages/snapback-client/assets.mjs';
import { projectAppRefusal } from '../../../../packages/snapback-client/index.mjs';
import { SnapbackClient } from '../../../../packages/snapback-client/online.mjs';
import type {
  EphemeralEntry,
  EphemeralOverlay,
} from '../../../../packages/snapback-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
  type SnapbackAuthCustodyStorage,
} from '../../../../packages/snapback-contract/auth-coordinator.mjs';
import { createIndexedDbAuthCustodyStorage } from '../../../../packages/snapback-contract/auth-custody-indexeddb.mjs';

import {
  api,
  type GeneratedDataModel,
} from '../../snapback/generated/api.mjs';
import {
  coterieAvatarRefForSourceDigest,
  coterieAvatarUrlForRef,
} from './avatar-refs.ts';
import {
  COTERIE_IMAGE_URLS,
  COTERIE_VIDEO_URLS,
} from './coterie-fixtures.ts';
import { coterieSurfaceManifest } from './memory-provider.ts';
import { coterieProviderClaims } from './provider-claims.ts';

export const COTERIE_SNAPBACK_MILESTONE = 'M3' as const;

export const COTERIE_SNAPBACK_M1_OPERATIONS = Object.freeze({
  queries: Object.freeze(['listSession', 'listProfiles', 'listProviderClaims']),
  mutations: Object.freeze([
    'signup',
    'login',
    'logout',
    'editProfile',
    'setAvatar',
  ]),
});

export const COTERIE_SNAPBACK_M2_OPERATIONS = Object.freeze({
  queries: Object.freeze(['listFeed', 'listThread', 'listProfilePosts']),
  mutations: Object.freeze(['createPost', 'setFollow', 'setLike', 'setRepost']),
});

export const COTERIE_SNAPBACK_M3_OPERATIONS = Object.freeze({
  queries: Object.freeze(['listChats', 'listMessages', 'observeTyping']),
  mutations: Object.freeze([
    'openDm',
    'createGroup',
    'addMember',
    'removeMember',
    'promoteAdmin',
    'leaveChat',
    'sendMessage',
    'setTyping',
    'markReceipt',
  ]),
});

export const COTERIE_SNAPBACK_CLAIMED_OPERATIONS = Object.freeze({
  queries: Object.freeze([
    ...COTERIE_SNAPBACK_M1_OPERATIONS.queries,
    ...COTERIE_SNAPBACK_M2_OPERATIONS.queries,
    ...COTERIE_SNAPBACK_M3_OPERATIONS.queries,
  ]),
  mutations: Object.freeze([
    ...COTERIE_SNAPBACK_M1_OPERATIONS.mutations,
    ...COTERIE_SNAPBACK_M2_OPERATIONS.mutations,
    ...COTERIE_SNAPBACK_M3_OPERATIONS.mutations,
  ]),
});

const CLAIMED_QUERY_NAMES = new Set<string>(COTERIE_SNAPBACK_CLAIMED_OPERATIONS.queries);
const CLAIMED_MUTATION_NAMES = new Set<string>(COTERIE_SNAPBACK_CLAIMED_OPERATIONS.mutations);
const M2_QUERY_NAMES = new Set<string>(COTERIE_SNAPBACK_M2_OPERATIONS.queries);
const CLAIMED_M3_QUERY_NAMES = new Set<string>(COTERIE_SNAPBACK_M3_OPERATIONS.queries);
const M3_QUERY_NAMES = new Set(['listChats', 'listMessages', 'observeTyping']);
const M2_MUTATION_NAMES = new Set<string>(COTERIE_SNAPBACK_M2_OPERATIONS.mutations);
const CLAIMED_M3_MUTATION_NAMES = new Set<string>(COTERIE_SNAPBACK_M3_OPERATIONS.mutations);
const M3_MUTATION_NAMES = new Set([
  'openDm',
  'createGroup',
  'addMember',
  'removeMember',
  'promoteAdmin',
  'leaveChat',
  'sendMessage',
  'setTyping',
  'markReceipt',
]);
const M4_MUTATION_NAMES = new Set(['setMessageReaction']);
const M5_QUERY_NAMES = new Set(['searchSocial']);
const M5_MUTATION_NAMES = new Set(['setChatAccent', 'setDisappearing']);
const M8_QUERY_NAMES = new Set(['listInsights']);
const SNAPBACK_PROVIDER_CLAIMS = coterieProviderClaims(COTERIE_SNAPBACK_CLAIMED_OPERATIONS);

const PROFILE_STREAM_TIMEOUT_MS = 10_000;
const AVATAR_ASSET_CACHE_LIMIT = 32;
const POST_ASSET_CACHE_LIMIT = 64;
const FEED_PAGE_SIZE = 20;
export const COTERIE_SNAPBACK_MAX_CHAT_HISTORY = 1_000;
export const COTERIE_SNAPBACK_MAX_MESSAGE_HISTORY = 1_024;
const COTERIE_SNAPBACK_MAX_TYPING_PARTICIPANTS = 50;
const COTERIE_SNAPBACK_TYPING_TTL_MS = 5_000;
const AVATAR_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SESSION_REQUIRED_CODES = new Set([
  'SNAPBACK_AUTH_SESSION_EXPIRED',
  'SNAPBACK_AUTH_SESSION_REVOKED',
]);
const AVATAR_REFERENCE_ADMISSION_CODES = new Set([
  'SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED',
  'SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED',
]);
let providerSequence = 0;

type CoterieSnapbackCustody = 'auto' | 'memory' | 'indexeddb';

export interface CoterieSnapbackProviderOptions {
  baseUrl?: string;
  custody?: CoterieSnapbackCustody;
  clientStoreId?: string;
  storagePartition?: string;
  /** Narrow fault/delivery seams used only by the adapter's regression suite. */
  __testHooks?: {
    beforeAuthResult?(operation: 'login' | 'signup'): void | Promise<void>;
    beforeEnsureProfile?(operation: 'signup' | 'signup-recovery'): void | Promise<void>;
    beforeAvatarAttach?(facts: {
      assetId: string;
      reused: boolean;
      sourceDigest: string;
    }): void | Promise<void>;
    onAvatarAssetSelected?(facts: {
      assetId: string;
      reused: boolean;
      sourceDigest: string;
    }): void;
    profileDeliveryTimeoutMs?: number;
    suppressProfileUpdate?(rows: readonly BackendProfileRow[]): boolean;
  };
}

export interface CoterieSnapbackProvider extends ContractDataProvider {
  readonly milestone: typeof COTERIE_SNAPBACK_MILESTONE;
  readonly baseUrl: string;
  close(): Promise<void>;
  dispose(): void;
}

type BackendProfileRow = GeneratedDataModel['profiles'];

interface BackendSessionCredential {
  session: {
    id: string;
    userId: string;
    expiresAt: number;
  };
}

interface ProfileSubscription<T> {
  active: boolean;
  generation: number;
  observer: DataObserver<T>;
  handle: {
    readonly rows: readonly BackendProfileRow[] | null;
    readonly connection: unknown;
    dispose(): void | Promise<void>;
  } | null;
  start: Promise<void> | null;
  connection: DataConnection;
  lastValue?: T;
  backendRows: readonly BackendProfileRow[];
  stats: Map<string, BackendProfileStatsRow>;
  statsHandles: Map<string, LiveHandle>;
  statsConnections: Map<string, DataConnection>;
  statsGeneration: number;
  statsReady: boolean;
}

interface LiveHandle {
  readonly rows: readonly unknown[] | null;
  readonly connection: unknown;
  readonly terminalDiagnostic?: unknown;
  dispose(): void | Promise<void>;
}

interface M2Subscription<T> {
  active: boolean;
  generation: number;
  observer: DataObserver<T>;
  handle: LiveHandle | null;
  start: Promise<void> | null;
  connection: DataConnection;
  lastValue?: T;
  queryName: string;
  args: Record<string, unknown>;
}

interface M3Subscription<T> {
  active: boolean;
  generation: number;
  observer: DataObserver<T>;
  handle: LiveHandle | null;
  start: Promise<void> | null;
  connection: DataConnection;
  lastValue?: T;
  queryName: string;
  args: Record<string, unknown>;
}

interface BackendProfileStatsRow {
  profileId: string;
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
  isSelf: boolean;
}

interface BackendPostViewRow {
  _id: string;
  kind: string;
  body: string;
  parentId?: string;
  postPageKey: string;
  createdAt: number;
  authorProfileId: string;
  authorHandle: string;
  authorDisplayName: string;
  authorAvatar?: string;
  imageMedia: ReadonlyArray<{ position: number; asset: string }>;
  videoMedia?: { asset: string };
  likeCount: number;
  repostCount: number;
  replyCount: number;
  viewerLiked: boolean;
  viewerReposted: boolean;
}

interface BackendFeedRow extends BackendPostViewRow {
  itemId: string;
  eventKind: string;
  pageKey: string;
  eventCreatedAt: number;
  repostedByProfileId?: string;
  repostedByHandle?: string;
  repostedByDisplayName?: string;
}

interface BackendReceiptSummary {
  aggregateStatus: string;
  recipientCount: number;
  requiredCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
}

interface BackendChatMessageRow {
  _id: GeneratedDataModel['messages']['_id'];
  conversationId: GeneratedDataModel['conversations']['_id'];
  senderProfileId: GeneratedDataModel['profiles']['_id'];
  senderHandle: string;
  senderDisplayName: string;
  senderAvatar?: string;
  body: string;
  quotedMessageId?: GeneratedDataModel['messages']['_id'];
  quotedMessage?: {
    messageId: GeneratedDataModel['messages']['_id'];
    excerpt: string;
    senderProfileId: GeneratedDataModel['profiles']['_id'];
    senderDisplayName: string;
  };
  pageKey: string;
  createdAt: number;
  viewerReceiptStatus?: string;
  viewerReceiptRequired: boolean;
  receiptSummary: BackendReceiptSummary;
}

interface BackendChatRow {
  _id: GeneratedDataModel['conversations']['_id'];
  pageKey: string;
  kind: string;
  name: string;
  description: string;
  viewerRole: string;
  active: boolean;
  unreadCount: number;
  members: ReadonlyArray<{
    profileId: GeneratedDataModel['profiles']['_id'];
    handle: string;
    displayName: string;
    avatar?: string;
    role: string;
    active: boolean;
  }>;
  lastMessage?: BackendChatMessageRow;
  lastMessageAt: number;
}

interface BackendTypingValue {
  profileId: string;
  userId: string;
  displayName: string;
}

type BackendTypingEntry = EphemeralEntry<BackendTypingValue>;
type M3BackendRow = BackendChatRow | BackendChatMessageRow | BackendTypingEntry;

type TypingOverlay = EphemeralOverlay<
  { conversationId: string },
  BackendTypingValue
> & {
  msUntilEarliestExpiry(): number;
  pruneExpired(): void;
};

interface TypingPublisher {
  connectionId: string;
  conversationId: GeneratedDataModel['conversations']['_id'];
  overlay: EphemeralOverlay<{ conversationId: string }, BackendTypingValue>;
}

interface FeedCursorPayload {
  v: 1;
  mode: 'following' | 'global';
  sortAt: string;
  eventId: string;
}

interface AuthResultState {
  profileExists: boolean;
  value: {
    userId: string;
    sessionToken: string;
  };
}

class NamedProviderError extends Error {
  constructor(name: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = name;
  }
}

function assertM3LiveWindow(queryName: string, count: number): void {
  if (queryName === 'observeTyping') return;
  const maximum = queryName === 'listChats'
    ? COTERIE_SNAPBACK_MAX_CHAT_HISTORY
    : COTERIE_SNAPBACK_MAX_MESSAGE_HISTORY;
  const label = queryName === 'listChats' ? 'conversations' : 'messages';
  if (count > maximum) {
    throw new NamedProviderError(
      'SnapbackProviderError',
      `${queryName} exceeded the explicit ${maximum}-${label} Coterie live envelope.`,
    );
  }
}

function environmentValue(name: string): string | undefined {
  const metaEnvironment = (import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  }).env;
  const metaValue = metaEnvironment?.[name];
  if (typeof metaValue === 'string' && metaValue.length > 0) return metaValue;
  if (typeof process !== 'undefined') {
    const processValue = process.env[name];
    if (typeof processValue === 'string' && processValue.length > 0) return processValue;
  }
  return undefined;
}

async function unsubscribeTyping(
  client: SnapbackClient,
  connectionId: string,
  conversationId: GeneratedDataModel['conversations']['_id'],
): Promise<void> {
  await client.unsubscribeEphemeral(api.ephemeral.typing, {
    connectionId,
    scope: { conversationId },
  });
}

export function resolveCoterieSnapbackUrl(explicit?: string): string {
  const configured = explicit ?? environmentValue('COTERIE_SNAPBACK_URL');
  if (!configured) {
    throw new Error(
      'COTERIE_PROVIDER=snapback requires COTERIE_SNAPBACK_URL; refusing to fall back to memory',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch (cause) {
    throw new Error('COTERIE_SNAPBACK_URL must be an absolute HTTP(S) server URL', { cause });
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new Error(
      'COTERIE_SNAPBACK_URL must be an HTTP(S) origin with no credentials, path, query, or fragment',
    );
  }
  return parsed.origin;
}

function resolvedCustody(explicit?: CoterieSnapbackCustody): CoterieSnapbackCustody {
  const configured = explicit ?? environmentValue('COTERIE_SNAPBACK_CUSTODY') ?? 'auto';
  if (configured === 'auto' || configured === 'memory' || configured === 'indexeddb') {
    return configured;
  }
  throw new Error(
    `Unknown COTERIE_SNAPBACK_CUSTODY "${configured}"; valid values: auto, indexeddb, memory`,
  );
}

function createCustodyStorage(custody: CoterieSnapbackCustody): SnapbackAuthCustodyStorage & {
  close?(): Promise<void>;
} {
  const indexedDbAvailable = typeof globalThis.indexedDB?.open === 'function';
  if (custody === 'indexeddb' || (custody === 'auto' && indexedDbAvailable)) {
    if (!indexedDbAvailable) {
      throw new Error(
        'COTERIE_SNAPBACK_CUSTODY=indexeddb requires a browser IndexedDB implementation',
      );
    }
    return createIndexedDbAuthCustodyStorage();
  }
  return createMemoryAuthCustodyStorage({ state: { custody: {} } });
}

function milestoneForOperation(name: string): 'M2' | 'M3' | 'M4' | 'M5' | 'M8' | null {
  if (M2_QUERY_NAMES.has(name) || M2_MUTATION_NAMES.has(name)) return 'M2';
  if (M3_QUERY_NAMES.has(name) || M3_MUTATION_NAMES.has(name)) return 'M3';
  if (M4_MUTATION_NAMES.has(name)) return 'M4';
  if (M5_QUERY_NAMES.has(name) || M5_MUTATION_NAMES.has(name)) return 'M5';
  if (M8_QUERY_NAMES.has(name)) return 'M8';
  return null;
}

function milestoneRefusal(name: string): NamedProviderError {
  const milestone = milestoneForOperation(name) ?? 'M2/M3/M4/M5/M8';
  return new NamedProviderError(
    'SnapbackMilestoneUnsupportedError',
    `snapback provider claims M1+M2+M3 plus provider discovery only; ${name} is outside that claim — LLP 0266 D7 (${milestone})`,
  );
}

function unclaimedOperationRefusal(name: string): NamedProviderError {
  return milestoneRefusal(name);
}

function serialized(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: 'SnapbackProviderError', message: String(error) };
}

function rejected<T>(error: unknown): DataMutationResult<T> {
  return { ok: false, error: serialized(error) };
}

function diagnosticCode(error: unknown): string | null {
  const candidate = error as {
    code?: unknown;
    diagnostic?: { code?: unknown };
  } | null;
  const value = candidate?.diagnostic?.code ?? candidate?.code;
  return typeof value === 'string' ? value : null;
}

function declaredError(operation: string, error: unknown): NamedProviderError {
  if (error instanceof NamedProviderError) return error;
  const code = diagnosticCode(error);
  const appCode = projectAppRefusal(error)?.appCode ?? null;
  const causeMessage = error instanceof Error ? error.message : String(error);

  const applicationMappings: Record<string, Record<string, readonly [string, string]>> = {
    signup: {
      DUPLICATE_HANDLE: ['DuplicateHandleError', 'An account already uses that handle.'],
    },
    editProfile: {
      DUPLICATE_HANDLE: ['DuplicateHandleError', 'An account already uses that handle.'],
    },
    createPost: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      POST_BODY_TOO_LONG: [
        'PostBodyInvalidError',
        'Post text must contain at most 500 characters, and text-only posts cannot be empty.',
      ],
      POST_IMAGE_COUNT_INVALID: [
        'ImageCountInvalidError',
        'Image posts require 1-4 fixture images.',
      ],
      POST_MEDIA_MIXED: ['MediaMixInvalidError', 'A post cannot mix images and video.'],
      POST_KIND_MEDIA_MISMATCH: [
        'MediaReferenceInvalidError',
        'Post media must reference a committed fixture image or video.',
      ],
      POST_KIND_INVALID: [
        'MediaReferenceInvalidError',
        'Post media must reference a committed fixture image or video.',
      ],
      POST_PARENT_NOT_FOUND: ['ParentPostNotFoundError', 'The parent post does not exist.'],
    },
    setFollow: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      PROFILE_NOT_FOUND: ['ProfileNotFoundError', 'The profile does not exist.'],
      SELF_FOLLOW_FORBIDDEN: [
        'SelfFollowInvalidError',
        'Self-follow is implicit for feeds and is not a follow edge.',
      ],
    },
    setLike: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      POST_NOT_FOUND: ['PostNotFoundError', 'The post does not exist.'],
    },
    setRepost: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      POST_NOT_FOUND: ['PostNotFoundError', 'The post does not exist.'],
      REPLY_REPOST_FORBIDDEN: ['ReplyRepostForbiddenError', 'Replies cannot be reposted.'],
    },
    openDm: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      PROFILE_NOT_FOUND: ['ProfileNotFoundError', 'The profile does not exist.'],
      SELF_DM_FORBIDDEN: [
        'DirectMessageSelfError',
        'A direct conversation requires another user.',
      ],
    },
    createGroup: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      PROFILE_NOT_FOUND: ['ProfileNotFoundError', 'The profile does not exist.'],
      GROUP_NAME_INVALID: [
        'GroupNameInvalidError',
        'Group name must contain 1-50 characters.',
      ],
      GROUP_DESCRIPTION_TOO_LONG: [
        'GroupDescriptionInvalidError',
        'Group description must contain at most 200 characters.',
      ],
      GROUP_SIZE_INVALID: [
        'GroupMembersInvalidError',
        'A group requires 2-50 unique members including its creator.',
      ],
    },
    addMember: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      PROFILE_NOT_FOUND: ['ProfileNotFoundError', 'The profile does not exist.'],
      CHAT_NOT_FOUND: ['ChatNotFoundError', 'Conversation was not found.'],
      CHAT_MEMBERSHIP_REQUIRED: ['ChatAdminRequiredError', 'A group admin is required.'],
      NOT_GROUP_ADMIN: ['ChatAdminRequiredError', 'A group admin is required.'],
      NOT_GROUP_CHAT: ['GroupRequiredError', 'This operation requires a group conversation.'],
      MEMBER_ALREADY_EXISTS: [
        'ChatMemberAlreadyExistsError',
        'That profile is already a group member.',
      ],
      GROUP_MEMBER_LIMIT_REACHED: [
        'ChatMemberLimitError',
        'A group may contain at most 50 members.',
      ],
    },
    removeMember: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      CHAT_NOT_FOUND: ['ChatNotFoundError', 'Conversation was not found.'],
      CHAT_MEMBERSHIP_REQUIRED: ['ChatAdminRequiredError', 'A group admin is required.'],
      NOT_GROUP_ADMIN: ['ChatAdminRequiredError', 'A group admin is required.'],
      NOT_GROUP_CHAT: ['GroupRequiredError', 'This operation requires a group conversation.'],
      MEMBER_NOT_FOUND: [
        'ChatMemberNotFoundError',
        'That profile is not a current group member.',
      ],
      REMOVE_SELF_WITH_LEAVE: ['RemoveSelfInvalidError', 'Use leave chat to remove yourself.'],
    },
    promoteAdmin: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      CHAT_NOT_FOUND: ['ChatNotFoundError', 'Conversation was not found.'],
      CHAT_MEMBERSHIP_REQUIRED: ['ChatAdminRequiredError', 'A group admin is required.'],
      NOT_GROUP_ADMIN: ['ChatAdminRequiredError', 'A group admin is required.'],
      NOT_GROUP_CHAT: ['GroupRequiredError', 'This operation requires a group conversation.'],
      MEMBER_NOT_FOUND: [
        'ChatMemberNotFoundError',
        'That profile is not a current group member.',
      ],
    },
    leaveChat: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      CHAT_NOT_FOUND: ['ChatNotFoundError', 'Conversation was not found.'],
      CHAT_MEMBERSHIP_REQUIRED: [
        'ChatMembershipRequiredError',
        'Conversation membership is required.',
      ],
      NOT_GROUP_CHAT: ['GroupRequiredError', 'This operation requires a group conversation.'],
    },
    sendMessage: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      CHAT_NOT_FOUND: ['ChatNotFoundError', 'Conversation was not found.'],
      CHAT_MEMBERSHIP_REQUIRED: [
        'ChatMembershipRequiredError',
        'Conversation membership is required.',
      ],
      MESSAGE_BODY_REQUIRED: [
        'MessageBodyInvalidError',
        'Message text must contain 1-2000 characters.',
      ],
      MESSAGE_BODY_TOO_LONG: [
        'MessageBodyInvalidError',
        'Message text must contain 1-2000 characters.',
      ],
      QUOTED_MESSAGE_NOT_FOUND: [
        'QuotedMessageInvalidError',
        'Quoted message must exist in this conversation.',
      ],
    },
    markReceipt: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      CHAT_NOT_FOUND: ['ChatNotFoundError', 'Conversation was not found.'],
      CHAT_MEMBERSHIP_REQUIRED: [
        'ChatMembershipRequiredError',
        'Conversation membership is required.',
      ],
      RECEIPT_STATE_INVALID: [
        'ReceiptStateInvalidError',
        'Receipt state must be delivered or read.',
      ],
    },
    setMessageReaction: {
      PROFILE_REQUIRED: ['SessionRequiredError', 'An active session is required.'],
      CHAT_MEMBERSHIP_REQUIRED: [
        'ChatMembershipRequiredError',
        'Conversation membership is required.',
      ],
      MESSAGE_NOT_FOUND: [
        'MessageNotFoundError',
        'Message was not found in this conversation.',
      ],
      EMOJI_INVALID: ['EmojiInvalidError', 'Reaction must be one emoji grapheme.'],
    },
    listMessages: {
      CHAT_NOT_FOUND: ['ChatNotFoundError', 'Conversation was not found.'],
      CHAT_MEMBERSHIP_REQUIRED: [
        'ChatMembershipRequiredError',
        'Conversation membership is required.',
      ],
    },
  };
  const applicationMapping = appCode
    ? applicationMappings[operation]?.[appCode]
    : undefined;
  if (applicationMapping) {
    return new NamedProviderError(applicationMapping[0], applicationMapping[1], { cause: error });
  }

  if (operation === 'login' && code === 'SNAPBACK_AUTH_CREDENTIAL_INVALID') {
    return new NamedProviderError(
      'InvalidCredentialsError',
      'Email or password is incorrect.',
      { cause: error },
    );
  }
  if (operation === 'signup' && code === 'SNAPBACK_AUTH_PASSWORD_EXISTS') {
    return new NamedProviderError(
      'DuplicateEmailError',
      'An account already uses that email.',
      { cause: error },
    );
  }
  if (operation === 'signup' && code === 'SNAPBACK_AUTH_PASSWORD_POLICY') {
    return new NamedProviderError(
      'PasswordTooShortError',
      'Password must satisfy the active Snapback password policy.',
      { cause: error },
    );
  }
  if (
    (
      operation === 'editProfile'
      || operation === 'setAvatar'
      || operation === 'observeTyping'
      || M2_MUTATION_NAMES.has(operation)
      || CLAIMED_M3_MUTATION_NAMES.has(operation)
    )
    && code !== null
    && SESSION_REQUIRED_CODES.has(code)
  ) {
    return new NamedProviderError(
      'SessionRequiredError',
      'An active session is required.',
      { cause: error },
    );
  }
  if (
    (operation === 'observeTyping' || operation === 'setTyping')
    && code === 'SNAPBACK_AUTH_PERMISSION_DENIED'
  ) {
    return new NamedProviderError(
      'ChatMembershipRequiredError',
      'Conversation membership is required.',
      { cause: error },
    );
  }
  if (
    (operation === 'setAvatar' || operation === 'createPost')
    && code !== null
    && AVATAR_REFERENCE_ADMISSION_CODES.has(code)
  ) {
    return new NamedProviderError(
      operation === 'setAvatar' ? 'AvatarReferenceInvalidError' : 'MediaReferenceInvalidError',
      operation === 'setAvatar'
        ? 'Avatar reference is invalid or unavailable.'
        : 'Post media must reference a committed fixture image or video.',
      { cause: error },
    );
  }

  return new NamedProviderError(
    'SnapbackProviderError',
    `${operation} failed through Snapback: ${causeMessage}`,
    { cause: error },
  );
}

function nonEmptyString(value: unknown, errorName: string, message: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new NamedProviderError(errorName, message);
  return normalized;
}

function validateEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new NamedProviderError('EmailInvalidError', 'Enter a valid email address.');
  }
  return email;
}

function validateLoginInput(args: Record<string, unknown>): { email: string; password: string } {
  const email = String(args.email ?? '').trim().toLowerCase();
  const password = String(args.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || password.length === 0) {
    throw new NamedProviderError(
      'InvalidCredentialsError',
      'Email or password is incorrect.',
    );
  }
  return { email, password };
}

function validatePassword(value: unknown): string {
  const password = String(value ?? '');
  if ([...password].length < 8) {
    throw new NamedProviderError(
      'PasswordTooShortError',
      'Password must contain at least 8 characters.',
    );
  }
  return password;
}

function validateHandle(value: unknown): string {
  const handle = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/u.test(handle)) {
    throw new NamedProviderError(
      'HandleInvalidError',
      'Handle must be 3-20 lowercase letters, numbers, or underscores.',
    );
  }
  return handle;
}

function validateDisplayName(value: unknown): string {
  const displayName = String(value ?? '').normalize('NFC').trim();
  if (displayName.length < 1 || displayName.length > 50) {
    throw new NamedProviderError(
      'DisplayNameInvalidError',
      'Display name must contain 1-50 characters.',
    );
  }
  return displayName;
}

function validateBio(value: unknown): string {
  const bio = String(value ?? '').normalize('NFC').trim();
  if (bio.length > 200) {
    throw new NamedProviderError('BioInvalidError', 'Bio must contain at most 200 characters.');
  }
  return bio;
}

function validateLocation(value: unknown): string {
  const location = String(value ?? '').normalize('NFC').trim();
  if (location.length > 50) {
    throw new NamedProviderError(
      'LocationInvalidError',
      'Location must contain at most 50 characters.',
    );
  }
  return location;
}

function validateLink(value: unknown): string {
  const link = String(value ?? '').normalize('NFC').trim();
  if (!link) return '';
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch (cause) {
    throw new NamedProviderError(
      'LinkInvalidError',
      'Link must be empty or an HTTP(S) URL.',
      { cause },
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new NamedProviderError('LinkInvalidError', 'Link must be empty or an HTTP(S) URL.');
  }
  return parsed.href;
}

function toConnection(value: unknown): DataConnection {
  switch (value) {
    case 'live':
    case 'connecting':
    case 'polling':
    case 'stale':
    case 'disconnected':
      return value;
    case 'open':
      return 'live';
    case 'lost':
    case 'budget-missed':
      return 'stale';
    case 'closed':
      return 'disconnected';
    default:
      return 'connecting';
  }
}

function readyCell<T>(value: T, connection: DataConnection): DataCellV2<T> {
  const empty = Array.isArray(value) ? value.length === 0 : false;
  return { status: 'ready', value, empty, connection };
}

async function sha256Hex(
  bytes: ArrayBuffer,
  errorName = 'AvatarReferenceInvalidError',
  message = 'Avatar upload requires WebCrypto SHA-256 support.',
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new NamedProviderError(errorName, message);
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sniffAvatarMediaType(bytes: ArrayBuffer): 'image/jpeg' | 'image/png' | 'image/webp' {
  const view = new Uint8Array(bytes);
  if (
    view.length >= 8
    && view[0] === 0x89
    && view[1] === 0x50
    && view[2] === 0x4e
    && view[3] === 0x47
    && view[4] === 0x0d
    && view[5] === 0x0a
    && view[6] === 0x1a
    && view[7] === 0x0a
  ) return 'image/png';
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    view.length >= 12
    && view[0] === 0x52
    && view[1] === 0x49
    && view[2] === 0x46
    && view[3] === 0x46
    && view[8] === 0x57
    && view[9] === 0x45
    && view[10] === 0x42
    && view[11] === 0x50
  ) return 'image/webp';
  throw new NamedProviderError(
    'AvatarReferenceInvalidError',
    'Avatar reference must contain a PNG, JPEG, or WebP image.',
  );
}

function invalidFeedCursor(cause?: unknown): NamedProviderError {
  return new NamedProviderError(
    'FeedCursorInvalidError',
    'The feed cursor is invalid for this feed mode.',
    cause === undefined ? undefined : { cause },
  );
}

function argsFeedMode(value: unknown): FeedCursorPayload['mode'] {
  if (value === 'following' || value === 'global') return value;
  throw new NamedProviderError(
    'FeedModeInvalidError',
    'Feed mode must be following or global.',
  );
}

function encodeBase64Url(value: string): string {
  return globalThis.btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}

function paddedFeedMilliseconds(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const padded = String(value).padStart(16, '0');
  return /^\d{16}$/u.test(padded) ? padded : null;
}

function decodeFeedCursor(
  value: unknown,
  mode: FeedCursorPayload['mode'],
): { payload: FeedCursorPayload; pageKey: string } | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw invalidFeedCursor();
  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as Partial<FeedCursorPayload>;
    if (
      parsed.v !== 1
      || parsed.mode !== mode
      || typeof parsed.sortAt !== 'string'
      || typeof parsed.eventId !== 'string'
      || parsed.eventId.length === 0
      || parsed.eventId.includes(':')
    ) throw invalidFeedCursor();
    const sortAtMs = Date.parse(parsed.sortAt);
    const paddedSortAtMs = paddedFeedMilliseconds(sortAtMs);
    if (
      paddedSortAtMs === null
      || new Date(sortAtMs).toISOString() !== parsed.sortAt
    ) throw invalidFeedCursor();
    const pageKey = `${paddedSortAtMs}:${parsed.eventId}`;
    return { payload: parsed as FeedCursorPayload, pageKey };
  } catch (error) {
    if (error instanceof NamedProviderError && error.name === 'FeedCursorInvalidError') {
      throw error;
    }
    throw invalidFeedCursor(error);
  }
}

function encodeFeedCursor(mode: FeedCursorPayload['mode'], row: BackendFeedRow): string {
  const match = /^(\d{16}):([^:]+)$/u.exec(row.pageKey);
  const paddedEventCreatedAt = paddedFeedMilliseconds(row.eventCreatedAt);
  if (
    !match
    || paddedEventCreatedAt === null
    || match[1] !== paddedEventCreatedAt
    || !Number.isFinite(new Date(row.eventCreatedAt).getTime())
  ) {
    throw new NamedProviderError(
      'SnapbackProviderError',
      `Snapback returned a feed pageKey that cannot round-trip: ${row.pageKey}`,
    );
  }
  return encodeBase64Url(JSON.stringify({
    v: 1,
    mode,
    sortAt: new Date(row.eventCreatedAt).toISOString(),
    eventId: match[2],
  } satisfies FeedCursorPayload));
}

async function setRepostThroughBackend(
  client: SnapbackClient,
  postId: GeneratedDataModel['posts']['_id'],
  reposted: boolean,
  mutationId: string,
): Promise<void> {
  await client.mutate(api.setRepost, {
    args: { postId, reposted, mutationId },
  });
}

async function sendMessageThroughBackend(
  client: SnapbackClient,
  args: {
    conversationId: GeneratedDataModel['conversations']['_id'];
    body: string;
    quotedMessageId?: GeneratedDataModel['messages']['_id'];
  },
  withdrawTyping: () => Promise<void>,
): Promise<{ id: string }> {
  const outcome = await client.mutate(api.sendMessage, { args });
  if (outcome.status !== 'settled') {
    throw new NamedProviderError(
      'SnapbackProviderError',
      'sendMessage was queued even though the Coterie adapter disables offline mutation replay.',
    );
  }
  // The durable mutation is already committed. Ephemeral withdrawal is a
  // best-effort presentation tail and cannot turn that success into a retryable
  // failure (and therefore a duplicate durable message).
  void withdrawTyping().catch(() => {});
  return { id: outcome.result };
}

function normalizedCreatePostInput(args: Record<string, unknown>): {
  body: string;
  imageRefs: string[];
  videoRefs: string[];
  parentId?: string;
  kind: 'text' | 'images' | 'video';
} {
  const body = String(args.body ?? '').normalize('NFC').trim();
  const imageRefs = Array.isArray(args.imageRefs)
    ? args.imageRefs.map((value) => String(value))
    : [];
  const videoRefs = Array.isArray(args.videoRefs)
    ? args.videoRefs.map((value) => String(value))
    : [];
  const parentId = args.parentId === null || args.parentId === undefined
    ? undefined
    : String(args.parentId);
  if ([...body].length > 500 || (!body && imageRefs.length === 0 && videoRefs.length === 0)) {
    throw new NamedProviderError(
      'PostBodyInvalidError',
      'Post text must contain at most 500 characters, and text-only posts cannot be empty.',
    );
  }
  if (imageRefs.length > 0 && videoRefs.length > 0) {
    throw new NamedProviderError('MediaMixInvalidError', 'A post cannot mix images and video.');
  }
  if (imageRefs.length > 4) {
    throw new NamedProviderError(
      'ImageCountInvalidError',
      'Image posts require 1-4 fixture images.',
    );
  }
  if (videoRefs.length > 1) {
    throw new NamedProviderError(
      'VideoCountInvalidError',
      'Video posts require exactly one fixture video.',
    );
  }
  if (
    imageRefs.some((mediaRef) => !COTERIE_IMAGE_URLS.has(mediaRef))
    || videoRefs.some((mediaRef) => !COTERIE_VIDEO_URLS.has(mediaRef))
  ) {
    throw new NamedProviderError(
      'MediaReferenceInvalidError',
      'Post media must reference a committed fixture image or video.',
    );
  }
  if (parentId !== undefined && parentId.length === 0) {
    throw new NamedProviderError('ParentPostNotFoundError', 'The parent post does not exist.');
  }
  return {
    body,
    imageRefs,
    videoRefs,
    ...(parentId ? { parentId } : {}),
    kind: imageRefs.length > 0 ? 'images' : videoRefs.length > 0 ? 'video' : 'text',
  };
}

function sniffPostMediaType(
  bytes: ArrayBuffer,
  kind: 'image' | 'video',
): 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' {
  if (kind === 'image') {
    try {
      return sniffAvatarMediaType(bytes);
    } catch (cause) {
      throw new NamedProviderError(
        'MediaReferenceInvalidError',
        'Post media must reference a committed fixture image or video.',
        { cause },
      );
    }
  }
  const view = new Uint8Array(bytes);
  if (
    view.length >= 12
    && view[4] === 0x66
    && view[5] === 0x74
    && view[6] === 0x79
    && view[7] === 0x70
  ) return 'video/mp4';
  throw new NamedProviderError(
    'MediaReferenceInvalidError',
    'Post media must reference a committed fixture image or video.',
  );
}

async function clearCapturedAuthorityAndReconcile(
  coordinator: Pick<AuthCoordinator, 'compareAndClear' | 'synchronize'>,
  capture: ReturnType<AuthCoordinator['capture']>,
  reason: string,
  projections: {
    currentPrincipal(): { status: string };
    publishAnonymous(): void;
    refreshNonAnonymous(): void | Promise<void>;
  },
): Promise<{ cleared: boolean | null; clearError: unknown | null }> {
  let cleared: boolean | null = null;
  let clearError: unknown | null = null;
  try {
    ({ cleared } = await coordinator.compareAndClear(capture, reason));
  } catch (error) {
    clearError = error;
  }
  // compareAndClear is capture-scoped. If durable custody already advanced,
  // it returns false without adopting that successor into this context. A
  // mandatory durable reload closes that missed-wakeup gap before the
  // coordinator-derived principal decides the adapter's final projections.
  // @ref LLP 0059#cross-context-ownership — broadcasts are wakeups only; a
  // missed-wakeup predecessor converges through durable synchronization.
  try {
    await coordinator.synchronize();
  } catch (error) {
    projections.publishAnonymous();
    clearError = clearError === null
      ? error
      : new AggregateError(
          [clearError, error],
          'Snapback custody clear and durable reconciliation both failed.',
        );
    return { cleared, clearError };
  }
  if (projections.currentPrincipal().status === 'anonymous') {
    projections.publishAnonymous();
  } else {
    await projections.refreshNonAnonymous();
  }
  return { cleared, clearError };
}

export const coterieSnapbackTestInternals = Object.freeze({
  coterieAvatarUrlForRef,
  clearCapturedAuthorityAndReconcile,
  decodeFeedCursor,
  declaredError,
  encodeFeedCursor,
  assertM3LiveWindow,
  normalizedCreatePostInput,
  sendMessageThroughBackend,
  setRepostThroughBackend,
  sniffPostMediaType,
  sniffAvatarMediaType,
  validateLoginInput,
});

class SnapbackCoterieProvider implements CoterieSnapbackProvider {
  readonly manifest = coterieSurfaceManifest;
  readonly milestone = COTERIE_SNAPBACK_MILESTONE;
  readonly baseUrl: string;

  readonly #client: SnapbackClient;
  readonly #coordinator: AuthCoordinator;
  readonly #storage: SnapbackAuthCustodyStorage & { close?(): Promise<void> };
  readonly #instanceId: string;
  readonly #testHooks: NonNullable<CoterieSnapbackProviderOptions['__testHooks']>;
  readonly #profileDeliveryTimeoutMs: number;
  readonly #sessionObservers = new Set<DataObserver<unknown>>();
  readonly #profileSubscriptions = new Set<ProfileSubscription<unknown>>();
  readonly #m2Subscriptions = new Set<M2Subscription<unknown>>();
  readonly #m2Cache = new Map<string, { value: unknown; connection: DataConnection }>();
  readonly #m3Subscriptions = new Set<M3Subscription<unknown>>();
  readonly #m3Cache = new Map<string, { value: unknown; connection: DataConnection }>();
  readonly #typingPublishers = new Map<string, TypingPublisher>();
  readonly #profileWaiters = new Set<() => void>();
  readonly #uploadedAvatarAssets = new Map<string, string>();
  readonly #uploadedPostAssets = new Map<string, string>();
  readonly #profileIdentityById = new Map<string, string>();
  readonly #profileDisplayNameById = new Map<string, string>();
  readonly #profileStatsRows = new Map<string, BackendProfileStatsRow>();
  readonly #unsubscribePrincipal: () => void;
  readonly #unsubscribeAuthTerminal: () => void;
  #initialization: Promise<void> | null = null;
  #disposed = false;
  #profileRevision = 0;
  #profileRows: readonly BackendProfileRow[] | null = null;
  #profileConnectionSequence = 0;
  #m2ConnectionSequence = 0;
  #m3ConnectionSequence = 0;
  #typingConnectionSequence = 0;
  #currentBackendProfileId: string | null = null;
  #principalRefreshGeneration = 0;
  #profileCompletion: { email: string; credential: BackendSessionCredential } | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(options: CoterieSnapbackProviderOptions = {}) {
    this.baseUrl = resolveCoterieSnapbackUrl(options.baseUrl);
    this.#instanceId = `coterie-snapback-${++providerSequence}`;
    this.#testHooks = options.__testHooks ?? {};
    this.#profileDeliveryTimeoutMs = this.#testHooks.profileDeliveryTimeoutMs
      ?? PROFILE_STREAM_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#profileDeliveryTimeoutMs)
      || this.#profileDeliveryTimeoutMs < 1
    ) {
      throw new TypeError('__testHooks.profileDeliveryTimeoutMs must be a positive safe integer');
    }
    this.#storage = createCustodyStorage(resolvedCustody(options.custody));
    this.#coordinator = new AuthCoordinator({
      appId: api.listProfiles.appId,
      storagePartition:
        options.storagePartition
        ?? environmentValue('COTERIE_SNAPBACK_CUSTODY_PARTITION')
        ?? 'coterie-default',
      storage: this.#storage,
      ...(typeof globalThis.window === 'undefined'
        ? { broadcastChannelFactory: null, hintStorage: null }
        : {}),
    });
    this.#client = new SnapbackClient(this.baseUrl, {
      authCoordinator: this.#coordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      clientStoreId: options.clientStoreId ?? this.#instanceId,
      rqsStore: null,
      offlineQueue: false,
    });
    this.#unsubscribePrincipal = this.#client.auth.subscribeCurrentPrincipal(() => {
      void this.#principalChanged();
    });
    this.#unsubscribeAuthTerminal = this.#client.auth.subscribeAuthTerminal(() => {
      if (this.#client.auth.authTerminalStatus().terminated) {
        this.#emitSessionReady([]);
        this.#stopProfileSubscriptions('disconnected');
        this.#stopM2Subscriptions('disconnected');
        this.#stopM3Subscriptions('disconnected');
        this.#stopTypingPublishers();
      }
    });
  }

  partitionId(): string {
    return this.#instanceId;
  }

  subscribe<T>(
    queryName: string,
    _args: Record<string, unknown>,
    observer: DataObserver<T>,
  ): DataSubscription {
    if (this.#disposed) {
      observer({
        status: 'error',
        error: serialized(new NamedProviderError('SnapbackProviderDisposedError', 'provider is disposed')),
        connection: 'disconnected',
      });
      return { dispose() {} };
    }
    if (!Object.hasOwn(this.manifest.queries, queryName)) {
      observer({
        status: 'error',
        error: serialized(new NamedProviderError('UnknownQueryError', `Unknown query ${queryName}`)),
      });
      return { dispose() {} };
    }
    if (!CLAIMED_QUERY_NAMES.has(queryName)) {
      observer({ status: 'error', error: serialized(unclaimedOperationRefusal(queryName)) });
      return { dispose() {} };
    }

    if (queryName === 'listProviderClaims') {
      observer({
        status: 'ready',
        value: SNAPBACK_PROVIDER_CLAIMS as unknown as T,
        empty: SNAPBACK_PROVIDER_CLAIMS.length === 0,
      });
      return { dispose() {} };
    }

    if (queryName === 'listSession') {
      const typedObserver = observer as DataObserver<unknown>;
      let active = true;
      this.#sessionObservers.add(typedObserver);
      observer({ status: 'pending', connection: 'connecting' });
      void this.#ensureInitialized().then(
        () => {
          if (!active || this.#disposed || !this.#sessionObservers.has(typedObserver)) return;
          return this.#refreshSessionProjection();
        },
        (error) => {
          if (!active || this.#disposed || !this.#sessionObservers.has(typedObserver)) return;
          observer({
            status: 'error',
            error: serialized(error),
            connection: 'disconnected',
          });
        },
      );
      return {
        dispose: () => {
          active = false;
          this.#sessionObservers.delete(typedObserver);
        },
      };
    }

    if (M2_QUERY_NAMES.has(queryName)) {
      try {
        if (queryName === 'listFeed') {
          const mode = argsFeedMode(_args.mode);
          decodeFeedCursor(_args.cursor, mode);
        }
      } catch (error) {
        observer({ status: 'error', error: serialized(error) });
        return { dispose() {} };
      }
      const subscription: M2Subscription<T> = {
        active: true,
        generation: 0,
        observer,
        handle: null,
        start: null,
        connection: 'connecting',
        queryName,
        args: _args,
      };
      const initializationGeneration = subscription.generation;
      this.#m2Subscriptions.add(subscription as M2Subscription<unknown>);
      const cached = this.#m2Cache.get(this.#m2CacheKey(queryName, _args));
      if (cached) {
        subscription.lastValue = cached.value as T;
        subscription.connection = cached.connection;
        observer(readyCell(cached.value as T, cached.connection));
      } else {
        observer({ status: 'pending', connection: 'connecting' });
      }
      void this.#ensureInitialized().then(
        () => {
          if (
            !subscription.active
            || subscription.generation !== initializationGeneration
            || this.#disposed
          ) return;
          return this.#startM2Subscription(subscription);
        },
        (error) => {
          if (
            !subscription.active
            || subscription.generation !== initializationGeneration
            || this.#disposed
          ) return;
          observer({
            status: 'error',
            error: serialized(declaredError(queryName, error)),
            connection: 'disconnected',
          });
        },
      );
      return {
        dispose: () => {
          subscription.active = false;
          subscription.generation += 1;
          this.#m2Subscriptions.delete(subscription as M2Subscription<unknown>);
          void subscription.handle?.dispose();
          subscription.handle = null;
        },
      };
    }

    if (CLAIMED_M3_QUERY_NAMES.has(queryName)) {
      try {
        if (queryName === 'listMessages' || queryName === 'observeTyping') {
          nonEmptyString(
            _args.chatId,
            'ChatNotFoundError',
            'Conversation was not found.',
          );
        }
      } catch (error) {
        observer({ status: 'error', error: serialized(error) });
        return { dispose() {} };
      }
      const subscription: M3Subscription<T> = {
        active: true,
        generation: 0,
        observer,
        handle: null,
        start: null,
        connection: 'connecting',
        queryName,
        args: _args,
      };
      const initializationGeneration = subscription.generation;
      this.#m3Subscriptions.add(subscription as M3Subscription<unknown>);
      const cached = this.#m3Cache.get(this.#m3CacheKey(queryName, _args));
      if (cached) {
        subscription.lastValue = cached.value as T;
        subscription.connection = cached.connection;
        observer(readyCell(cached.value as T, cached.connection));
      } else {
        observer({ status: 'pending', connection: 'connecting' });
      }
      void this.#ensureInitialized().then(
        () => {
          if (
            !subscription.active
            || subscription.generation !== initializationGeneration
            || this.#disposed
          ) return;
          return this.#startM3Subscription(subscription);
        },
        (error) => {
          if (
            !subscription.active
            || subscription.generation !== initializationGeneration
            || this.#disposed
          ) return;
          observer({
            status: 'error',
            error: serialized(declaredError(queryName, error)),
            connection: 'disconnected',
          });
        },
      );
      return {
        dispose: () => {
          subscription.active = false;
          subscription.generation += 1;
          this.#m3Subscriptions.delete(subscription as M3Subscription<unknown>);
          void subscription.handle?.dispose();
          subscription.handle = null;
        },
      };
    }

    const subscription: ProfileSubscription<T> = {
      active: true,
      generation: 0,
      observer,
      handle: null,
      start: null,
      connection: 'connecting',
      backendRows: [],
      stats: new Map(),
      statsHandles: new Map(),
      statsConnections: new Map(),
      statsGeneration: 0,
      statsReady: false,
    };
    const initializationGeneration = subscription.generation;
    this.#profileSubscriptions.add(subscription as ProfileSubscription<unknown>);
    if (this.#profileRows && this.#profileStatsRows.size === this.#profileRows.length) {
      subscription.backendRows = this.#profileRows;
      subscription.stats = new Map(this.#profileStatsRows);
      subscription.statsReady = true;
      const value = this.#projectProfiles<T>(this.#profileRows, this.#profileStatsRows);
      subscription.lastValue = value;
      observer(readyCell(value, subscription.connection));
    } else {
      observer({ status: 'pending', connection: 'connecting' });
    }
    void this.#ensureInitialized().then(
      () => {
        if (
          !subscription.active
          || subscription.generation !== initializationGeneration
          || this.#disposed
        ) return;
        return this.#startProfileSubscription(subscription);
      },
      (error) => {
        if (
          !subscription.active
          || subscription.generation !== initializationGeneration
          || this.#disposed
        ) return;
        observer({
          status: 'error',
          error: serialized(error),
          connection: 'disconnected',
        });
      },
    );
    return {
      dispose: () => {
        subscription.active = false;
        subscription.generation += 1;
        this.#profileSubscriptions.delete(subscription as ProfileSubscription<unknown>);
        void subscription.handle?.dispose();
        for (const handle of subscription.statsHandles.values()) void handle.dispose();
        subscription.statsHandles.clear();
        subscription.handle = null;
      },
    };
  }

  async mutate<T>(
    mutationName: string,
    args: Record<string, unknown>,
    _correlation?: DataMutationCorrelation,
  ): Promise<DataMutationResult<T>> {
    if (this.#disposed) {
      return rejected(new NamedProviderError('SnapbackProviderDisposedError', 'provider is disposed'));
    }
    if (!Object.hasOwn(this.manifest.mutations, mutationName)) {
      return rejected(new NamedProviderError('UnknownMutationError', `Unknown mutation ${mutationName}`));
    }
    if (!CLAIMED_MUTATION_NAMES.has(mutationName)) {
      return rejected(unclaimedOperationRefusal(mutationName));
    }

    try {
      await this.#ensureInitialized();
      const value = await this.#runClaimedMutation(mutationName, args);
      return { ok: true, ...(value === undefined ? {} : { value: value as T }) };
    } catch (error) {
      return rejected(declaredError(mutationName, error));
    }
  }

  dispose(): void {
    void this.close();
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#disposed = true;
    this.#unsubscribePrincipal();
    this.#unsubscribeAuthTerminal();
    this.#sessionObservers.clear();
    const handleClosures = [...this.#profileSubscriptions].map((subscription) => {
      subscription.active = false;
      subscription.generation += 1;
      const result = subscription.handle?.dispose();
      for (const handle of subscription.statsHandles.values()) void handle.dispose();
      subscription.statsHandles.clear();
      subscription.handle = null;
      return result;
    });
    this.#profileSubscriptions.clear();
    for (const subscription of this.#m2Subscriptions) {
      subscription.active = false;
      subscription.generation += 1;
      handleClosures.push(subscription.handle?.dispose());
      subscription.handle = null;
    }
    this.#m2Subscriptions.clear();
    for (const subscription of this.#m3Subscriptions) {
      subscription.active = false;
      subscription.generation += 1;
      handleClosures.push(subscription.handle?.dispose());
      subscription.handle = null;
    }
    this.#m3Subscriptions.clear();
    for (const publisher of [...this.#typingPublishers.values()]) {
      handleClosures.push(this.#retireTypingPublisher(publisher.conversationId));
    }
    this.#closePromise = (async () => {
      await Promise.allSettled(handleClosures.map((result) => Promise.resolve(result)));
      await this.#client.closeAuth();
      await this.#coordinator.close();
      await this.#storage.close?.();
    })();
    return this.#closePromise;
  }

  async #ensureInitialized(): Promise<void> {
    if (this.#initialization) return this.#initialization;
    this.#initialization = (async () => {
      await this.#client.auth.authSession();
      const principal = this.#client.auth.currentPrincipal();
      if (principal.status === 'authenticated' && principal.expiresAt === null) {
        await this.#client.auth.authRefresh();
      }
      await this.#principalChanged();
    })();
    return this.#initialization;
  }

  async #principalChanged(): Promise<void> {
    if (this.#disposed) return;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status === 'anonymous') {
      this.#profileCompletion = null;
      this.#currentBackendProfileId = null;
      this.#emitSessionReady([]);
      this.#stopProfileSubscriptions('disconnected');
      this.#stopM2Subscriptions('disconnected');
      this.#stopM3Subscriptions('disconnected');
      this.#stopTypingPublishers();
      return;
    }
    if (principal.status === 'blocked') {
      const error = new NamedProviderError(
        'SnapbackProviderError',
        principal.diagnostic.message,
      );
      this.#emitSessionError(error);
      this.#stopProfileSubscriptions('disconnected');
      this.#stopM2Subscriptions('disconnected');
      this.#stopM3Subscriptions('disconnected');
      this.#stopTypingPublishers();
      return;
    }
    if (principal.status === 'loading' || principal.status === 'refreshing') return;
    await Promise.all([
      this.#refreshSessionProjection(),
      this.#startAllProfileSubscriptions(),
      this.#startAllM2Subscriptions(),
      this.#startAllM3Subscriptions(),
    ]);
  }

  async #clearCapturedAuthorityAndReconcile(
    capture: ReturnType<AuthCoordinator['capture']>,
    reason: string,
  ): Promise<{ cleared: boolean | null; clearError: unknown | null }> {
    return clearCapturedAuthorityAndReconcile(
      this.#coordinator,
      capture,
      reason,
      {
        currentPrincipal: () => this.#client.auth.currentPrincipal(),
        publishAnonymous: () => {
          this.#profileCompletion = null;
          this.#emitSessionReady([]);
          this.#stopProfileSubscriptions('disconnected');
          this.#stopM2Subscriptions('disconnected');
          this.#stopM3Subscriptions('disconnected');
          this.#stopTypingPublishers();
        },
        refreshNonAnonymous: () => this.#principalChanged(),
      },
    );
  }

  async #refreshSessionProjection(): Promise<void> {
    const generation = ++this.#principalRefreshGeneration;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status === 'anonymous') {
      this.#emitSessionReady([]);
      return;
    }
    if (principal.status !== 'authenticated') return;

    try {
      const rows = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
      if (generation !== this.#principalRefreshGeneration || this.#disposed) return;
      const current = this.#client.auth.currentPrincipal();
      if (current.status !== 'authenticated' || current.sessionId !== principal.sessionId) return;
      this.#rememberProfileIdentities(rows);
      const capture = this.#coordinator.capture();
      const credential = this.#coordinator.credentialFor(capture);
      if (!credential.bearer) {
        throw new NamedProviderError('SessionRequiredError', 'An active session is required.');
      }
      const logicalUserId = rows[0]?.fixtureId ?? principal.userId;
      const expiry = principal.expiresAt
        ?? principal.absoluteExpiresAt
        ?? credential.refreshAfterMs
        ?? Date.now();
      this.#emitSessionReady([{
        id: principal.sessionId,
        userId: logicalUserId,
        signedIn: true,
        token: credential.bearer,
        expiresAt: new Date(expiry).toISOString(),
        revokedAt: null,
      }]);
    } catch (error) {
      if (generation === this.#principalRefreshGeneration && !this.#disposed) {
        this.#emitSessionError(declaredError('listSession', error));
      }
    }
  }

  #emitSessionReady(rows: unknown[]): void {
    for (const observer of this.#sessionObservers) {
      observer(readyCell(rows, 'live'));
    }
  }

  #emitSessionError(error: unknown): void {
    for (const observer of this.#sessionObservers) {
      observer({ status: 'error', error: serialized(error), connection: 'disconnected' });
    }
  }

  async #startAllProfileSubscriptions(): Promise<void> {
    await Promise.all(
      [...this.#profileSubscriptions].map((subscription) => (
        this.#startProfileSubscription(subscription)
      )),
    );
  }

  async #startProfileSubscription<T>(subscription: ProfileSubscription<T>): Promise<void> {
    if (!subscription.active || this.#disposed) return;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') return;
    if (subscription.handle) return;
    if (subscription.start) return subscription.start;

    const generation = ++subscription.generation;
    subscription.start = (async () => {
      try {
        let established = false;
        const handle = await this.#client.liveQuery(api.listProfiles, {
          args: {},
          connectionId: `${this.#instanceId}-profiles-${++this.#profileConnectionSequence}`,
          transport: 'stream',
          fallbackToPoll: false,
          onUpdate: (rows) => {
            if (!subscription.active || subscription.generation !== generation) return;
            const nextRows = (rows ?? []) as readonly BackendProfileRow[];
            if (this.#testHooks.suppressProfileUpdate?.(
              nextRows,
            )) return;
            this.#rememberProfileIdentities(nextRows);
            if (!established) return;
            const sameProfiles = nextRows.length === subscription.backendRows.length
              && nextRows.every((row) => subscription.statsHandles.has(row._id));
            if (sameProfiles) {
              subscription.backendRows = nextRows;
              if (subscription.statsReady) this.#publishProfiles(subscription, nextRows);
              return;
            }
            void this.#rebuildProfileStats(
              subscription,
              nextRows,
              generation,
            );
          },
          onConnectionChange: (connection) => {
            if (!subscription.active || subscription.generation !== generation) return;
            const next = this.#profileSubscriptionConnection(subscription, toConnection(connection));
            if (next === subscription.connection) return;
            subscription.connection = next;
            this.#publishProfileConnection(subscription);
          },
        });
        if (!subscription.active || subscription.generation !== generation || this.#disposed) {
          await handle.dispose();
          return;
        }
        subscription.handle = handle;
        established = true;
        const rows = (handle.rows ?? []) as readonly BackendProfileRow[];
        this.#rememberProfileIdentities(rows);
        subscription.connection = toConnection(handle.connection);
        await this.#rebuildProfileStats(subscription, rows, generation);
      } catch (error) {
        if (!subscription.active || subscription.generation !== generation) return;
        subscription.observer({
          status: 'error',
          error: serialized(declaredError('listProfiles', error)),
          connection: 'disconnected',
        });
      } finally {
        if (subscription.generation === generation) subscription.start = null;
      }
    })();
    return subscription.start;
  }

  #publishProfiles<T>(
    subscription: ProfileSubscription<T>,
    rows: readonly BackendProfileRow[],
  ): void {
    this.#profileRows = rows;
    this.#profileStatsRows.clear();
    for (const [profileId, stats] of subscription.stats) {
      this.#profileStatsRows.set(profileId, stats);
    }
    for (const target of this.#profileSubscriptions) {
      if (!target.active) continue;
      const value = this.#projectProfiles<unknown>(rows, this.#profileStatsRows);
      target.lastValue = value;
      target.observer(readyCell(value, target.connection));
    }
    this.#profileRevision += 1;
    for (const resolve of [...this.#profileWaiters]) resolve();
  }

  #projectProfiles<T>(
    rows: readonly BackendProfileRow[],
    stats: ReadonlyMap<string, BackendProfileStatsRow>,
  ): T {
    return rows.map((row) => ({
      id: row.fixtureId ?? row.ownerId,
      handle: row.handle,
      displayName: row.displayName,
      bio: row.bio,
      location: row.location,
      link: row.link,
      avatarUrl: row.avatar ? this.#assetUrl(row.avatar) : null,
      avatarRef: coterieAvatarRefForSourceDigest(row.avatarSourceDigest),
      followers: stats.get(row._id)?.followerCount ?? 0,
      following: stats.get(row._id)?.followingCount ?? 0,
      followedByMe: stats.get(row._id)?.viewerFollows ?? false,
      isMe: stats.get(row._id)?.isSelf ?? false,
    })) as T;
  }

  #rememberProfileIdentities(rows: readonly BackendProfileRow[]): void {
    const principal = this.#client.auth.currentPrincipal();
    for (const row of rows) {
      this.#profileIdentityById.set(row._id, row.fixtureId ?? row.ownerId);
      this.#profileDisplayNameById.set(row._id, row.displayName);
      if (principal.status === 'authenticated' && row.ownerId === principal.userId) {
        this.#currentBackendProfileId = row._id;
      }
    }
  }

  // @ref LLP 0013#first-delivery-latency-budget — the typing action reuses
  // login/profile-stream identity instead of spending its 2 s budget on a query.
  #currentTypingValue(): BackendTypingValue | null {
    const profileId = this.#currentBackendProfileId;
    if (!profileId) return null;
    const userId = this.#profileIdentityById.get(profileId);
    const displayName = this.#profileDisplayNameById.get(profileId);
    return userId === undefined || displayName === undefined
      ? null
      : { profileId, userId, displayName };
  }

  async #rebuildProfileStats<T>(
    subscription: ProfileSubscription<T>,
    rows: readonly BackendProfileRow[],
    profileGeneration: number,
  ): Promise<void> {
    const statsGeneration = ++subscription.statsGeneration;
    subscription.backendRows = rows;
    const profileIds = new Set<string>(rows.map((row) => row._id));
    const removedHandles: LiveHandle[] = [];
    for (const [profileId, handle] of subscription.statsHandles) {
      if (profileIds.has(profileId)) continue;
      removedHandles.push(handle);
      subscription.statsHandles.delete(profileId);
      subscription.statsConnections.delete(profileId);
      subscription.stats.delete(profileId);
    }
    await Promise.allSettled(removedHandles.map((handle) => Promise.resolve(handle.dispose())));
    if (
      !subscription.active
      || subscription.generation !== profileGeneration
      || subscription.statsGeneration !== statsGeneration
      || this.#disposed
    ) return;

    try {
      const newRows = rows.filter((row) => !subscription.statsHandles.has(row._id));
      subscription.statsReady = newRows.length === 0;
      await Promise.all(newRows.map(async (row) => {
        const handle = await this.#client.liveQuery(api.profileStats, {
          args: { profileId: row._id },
          connectionId:
            `${this.#instanceId}-profile-stats-${++this.#profileConnectionSequence}`,
          transport: 'stream',
          fallbackToPoll: false,
          onUpdate: (statsRows) => {
            if (
              !subscription.active
              || subscription.generation !== profileGeneration
              || !subscription.backendRows.some((candidate) => candidate._id === row._id)
            ) return;
            const stats = ((statsRows ?? []) as readonly BackendProfileStatsRow[])[0];
            if (stats) subscription.stats.set(row._id, stats);
            else subscription.stats.delete(row._id);
            if (subscription.statsReady) {
              this.#publishProfiles(subscription, subscription.backendRows);
            }
          },
          onConnectionChange: (connection) => {
            if (
              !subscription.active
              || subscription.generation !== profileGeneration
              || !subscription.backendRows.some((candidate) => candidate._id === row._id)
            ) return;
            subscription.statsConnections.set(row._id, toConnection(connection));
            const next = this.#profileSubscriptionConnection(subscription);
            if (next === subscription.connection) return;
            subscription.connection = next;
            this.#publishProfileConnection(subscription);
          },
        });
        if (
          !subscription.active
          || subscription.generation !== profileGeneration
          || subscription.statsGeneration !== statsGeneration
          || this.#disposed
        ) {
          await handle.dispose();
          return;
        }
        subscription.statsHandles.set(row._id, handle as LiveHandle);
        subscription.statsConnections.set(row._id, toConnection(handle.connection));
        const stats = ((handle.rows ?? []) as readonly BackendProfileStatsRow[])[0];
        if (stats) subscription.stats.set(row._id, stats);
      }));
      if (
        !subscription.active
        || subscription.generation !== profileGeneration
        || subscription.statsGeneration !== statsGeneration
      ) return;
      subscription.connection = this.#profileSubscriptionConnection(subscription);
      subscription.statsReady = true;
      this.#publishProfiles(subscription, rows);
    } catch (error) {
      if (
        !subscription.active
        || subscription.generation !== profileGeneration
        || subscription.statsGeneration !== statsGeneration
      ) return;
      subscription.observer({
        status: 'error',
        error: serialized(declaredError('listProfiles', error)),
        connection: 'disconnected',
      });
    }
  }

  #profileSubscriptionConnection<T>(
    subscription: ProfileSubscription<T>,
    profileConnection = toConnection(subscription.handle?.connection),
  ): DataConnection {
    const connections = [profileConnection, ...subscription.statsConnections.values()];
    for (const state of ['disconnected', 'stale', 'polling', 'connecting'] as const) {
      if (connections.includes(state)) return state;
    }
    return 'live';
  }

  #publishProfileConnection<T>(subscription: ProfileSubscription<T>): void {
    if (!subscription.active) return;
    if (subscription.lastValue === undefined) {
      subscription.observer({ status: 'pending', connection: subscription.connection });
      return;
    }
    // Connection truth is observable state, but it is not a data delivery and
    // therefore must not advance #profileRevision or release mutation waiters.
    subscription.observer(readyCell(subscription.lastValue, subscription.connection));
  }

  async #startAllM2Subscriptions(): Promise<void> {
    await Promise.all(
      [...this.#m2Subscriptions].map((subscription) => this.#startM2Subscription(subscription)),
    );
  }

  async #startM2Subscription<T>(subscription: M2Subscription<T>): Promise<void> {
    if (!subscription.active || this.#disposed) return;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') return;
    if (subscription.handle) return;
    if (subscription.start) return subscription.start;

    const generation = ++subscription.generation;
    subscription.start = (async () => {
      let pendingDelivery = Promise.resolve();
      const publishRows = (rows: readonly unknown[] | null): Promise<void> => {
        const deliveryRows = [...(rows ?? [])];
        pendingDelivery = pendingDelivery.then(async () => {
          if (!subscription.active || subscription.generation !== generation) return;
          try {
            await this.#hydrateM2ProfileIdentities(deliveryRows);
            if (!subscription.active || subscription.generation !== generation) return;
            const value = this.#projectM2Rows<T>(subscription, deliveryRows);
            const cacheKey = this.#m2CacheKey(subscription.queryName, subscription.args);
            this.#m2Cache.set(cacheKey, { value, connection: subscription.connection });
            for (const target of this.#m2Subscriptions) {
              if (!target.active || this.#m2CacheKey(target.queryName, target.args) !== cacheKey) {
                continue;
              }
              target.lastValue = value;
              target.observer(readyCell(value, target.connection));
            }
          } catch (error) {
            subscription.observer({
              status: 'error',
              error: serialized(declaredError(subscription.queryName, error)),
              connection: 'disconnected',
            });
          }
        });
        return pendingDelivery;
      };
      const onConnectionChange = (connection: unknown) => {
        if (!subscription.active || subscription.generation !== generation) return;
        const next = toConnection(connection);
        if (next === subscription.connection) return;
        subscription.connection = next;
        if (subscription.lastValue === undefined) {
          subscription.observer({ status: 'pending', connection: next });
        } else {
          subscription.observer(readyCell(subscription.lastValue, next));
        }
      };
      try {
        await this.#refreshProfileIdentityIndex();
        const connectionId =
          `${this.#instanceId}-${subscription.queryName}-${++this.#m2ConnectionSequence}`;
        let handle: LiveHandle;
        if (subscription.queryName === 'listFeed') {
          const mode = argsFeedMode(subscription.args.mode);
          const cursor = decodeFeedCursor(subscription.args.cursor, mode);
          const common = {
            args: cursor ? { before: cursor.pageKey } : {},
            connectionId,
            transport: 'stream' as const,
            fallbackToPoll: false,
            onUpdate: (rows: readonly BackendFeedRow[] | null) => { void publishRows(rows); },
            onConnectionChange,
          };
          handle = mode === 'global'
            ? await this.#client.liveQuery(api.globalFeed, common)
            : await this.#client.liveQuery(api.followingFeed, common);
        } else if (subscription.queryName === 'listThread') {
          const postId = nonEmptyString(
            subscription.args.parentId,
            'ParentPostNotFoundError',
            'The parent post does not exist.',
          ) as GeneratedDataModel['posts']['_id'];
          handle = await this.#client.liveQuery(api.thread, {
            args: { postId },
            connectionId,
            transport: 'stream',
            fallbackToPoll: false,
            onUpdate: (rows) => { void publishRows(rows); },
            onConnectionChange,
          });
        } else if (subscription.queryName === 'listProfilePosts') {
          const profileId = await this.#backendProfileId(subscription.args.userId);
          handle = await this.#client.liveQuery(api.profilePosts, {
            args: { profileId },
            connectionId,
            transport: 'stream',
            fallbackToPoll: false,
            onUpdate: (rows) => { void publishRows(rows); },
            onConnectionChange,
          });
        } else {
          throw milestoneRefusal(subscription.queryName);
        }
        if (!subscription.active || subscription.generation !== generation || this.#disposed) {
          await handle.dispose();
          return;
        }
        subscription.handle = handle;
        subscription.connection = toConnection(handle.connection);
        await publishRows(handle.rows);
      } catch (error) {
        if (!subscription.active || subscription.generation !== generation) return;
        subscription.observer({
          status: 'error',
          error: serialized(declaredError(subscription.queryName, error)),
          connection: 'disconnected',
        });
      } finally {
        if (subscription.generation === generation) subscription.start = null;
      }
    })();
    return subscription.start;
  }

  async #startAllM3Subscriptions(): Promise<void> {
    await Promise.all(
      [...this.#m3Subscriptions].map((subscription) => this.#startM3Subscription(subscription)),
    );
  }

  async #startM3Subscription<T>(subscription: M3Subscription<T>): Promise<void> {
    if (!subscription.active || this.#disposed) return;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') return;
    if (subscription.handle) return;
    if (subscription.start) return subscription.start;

    const generation = ++subscription.generation;
    subscription.start = (async () => {
      let pendingDelivery = Promise.resolve();
      const publishRows = (rows: readonly unknown[] | null): Promise<void> => {
        const deliveryRows = [...(rows ?? [])];
        pendingDelivery = pendingDelivery.then(async () => {
          if (!subscription.active || subscription.generation !== generation) return;
          try {
            const liveRows = deliveryRows as readonly M3BackendRow[];
            assertM3LiveWindow(subscription.queryName, liveRows.length);
            if (subscription.queryName !== 'observeTyping') {
              await this.#hydrateM3ProfileIdentities(liveRows);
            }
            if (!subscription.active || subscription.generation !== generation) return;
            const value = await this.#projectM3Rows<T>(subscription, liveRows);
            if (!subscription.active || subscription.generation !== generation) return;
            const cacheKey = this.#m3CacheKey(subscription.queryName, subscription.args);
            this.#m3Cache.set(cacheKey, { value, connection: subscription.connection });
            for (const target of this.#m3Subscriptions) {
              if (!target.active || this.#m3CacheKey(target.queryName, target.args) !== cacheKey) {
                continue;
              }
              target.lastValue = value;
              target.observer(readyCell(value, target.connection));
            }
          } catch (error) {
            subscription.observer({
              status: 'error',
              error: serialized(declaredError(subscription.queryName, error)),
              connection: 'disconnected',
            });
          }
        });
        return pendingDelivery;
      };
      const onConnectionChange = (connection: unknown) => {
        if (!subscription.active || subscription.generation !== generation) return;
        const next = toConnection(connection);
        if (next === subscription.connection) return;
        subscription.connection = next;
        if (subscription.lastValue === undefined) {
          subscription.observer({ status: 'pending', connection: next });
        } else {
          subscription.observer(readyCell(subscription.lastValue, next));
        }
      };
      const publishError = (error: unknown): void => {
        pendingDelivery = pendingDelivery.then(() => {
          if (!subscription.active || subscription.generation !== generation) return;
          const cacheKey = this.#m3CacheKey(subscription.queryName, subscription.args);
          this.#m3Cache.delete(cacheKey);
          subscription.lastValue = undefined;
          subscription.connection = 'disconnected';
          subscription.observer({
            status: 'error',
            error: serialized(declaredError(subscription.queryName, error)),
            connection: 'disconnected',
          });
        });
      };
      try {
        await this.#refreshProfileIdentityIndex();
        const connectionId =
          `${this.#instanceId}-${subscription.queryName}-${++this.#m3ConnectionSequence}`;
        let handle: LiveHandle;
        if (subscription.queryName === 'listChats') {
          handle = await this.#client.liveQuery(api.listChats, {
            args: {},
            connectionId,
            transport: 'stream',
            fallbackToPoll: false,
            onUpdate: (rows) => { void publishRows(rows); },
            onConnectionChange,
          });
        } else if (subscription.queryName === 'listMessages') {
          const conversationId = nonEmptyString(
            subscription.args.chatId,
            'ChatNotFoundError',
            'Conversation was not found.',
          ) as GeneratedDataModel['conversations']['_id'];
          handle = await this.#client.liveQuery(api.listMessages, {
            args: { conversationId },
            connectionId,
            transport: 'stream',
            fallbackToPoll: false,
            onUpdate: (rows) => { void publishRows(rows); },
            onConnectionChange,
          });
        } else if (subscription.queryName === 'observeTyping') {
          const conversationId = nonEmptyString(
            subscription.args.chatId,
            'ChatNotFoundError',
            'Conversation was not found.',
          ) as GeneratedDataModel['conversations']['_id'];
          handle = await this.#typingLiveHandle(
            conversationId,
            connectionId,
            publishRows,
            publishError,
          );
        } else {
          throw unclaimedOperationRefusal(subscription.queryName);
        }
        if (!subscription.active || subscription.generation !== generation || this.#disposed) {
          await handle.dispose();
          return;
        }
        subscription.handle = handle;
        subscription.connection = toConnection(handle.connection);
        if (handle.terminalDiagnostic == null) {
          await publishRows(handle.rows);
        } else {
          await pendingDelivery;
        }
      } catch (error) {
        if (!subscription.active || subscription.generation !== generation) return;
        subscription.observer({
          status: 'error',
          error: serialized(declaredError(subscription.queryName, error)),
          connection: 'disconnected',
        });
      } finally {
        if (subscription.generation === generation) subscription.start = null;
      }
    })();
    return subscription.start;
  }

  async #projectM3Rows<T>(
    subscription: M3Subscription<T>,
    rows: readonly unknown[],
  ): Promise<T> {
    if (subscription.queryName === 'listMessages') {
      return (rows as readonly BackendChatMessageRow[])
        .slice()
        .reverse()
        .map((row) => this.#projectMessage(row)) as T;
    }
    if (subscription.queryName === 'observeTyping') {
      const latestByUser = new Map<string, BackendTypingEntry>();
      for (const entry of rows as readonly BackendTypingEntry[]) {
        if (entry.value.profileId === this.#currentBackendProfileId) continue;
        const prior = latestByUser.get(entry.value.userId);
        if (
          !prior
          || entry.expiresAtMs > prior.expiresAtMs
          || (
            entry.expiresAtMs === prior.expiresAtMs
            && entry.entryVersion > prior.entryVersion
          )
        ) latestByUser.set(entry.value.userId, entry);
      }
      if (latestByUser.size > COTERIE_SNAPBACK_MAX_TYPING_PARTICIPANTS) {
        throw new NamedProviderError(
          'SnapbackProviderError',
          `observeTyping exceeded the explicit ${COTERIE_SNAPBACK_MAX_TYPING_PARTICIPANTS}-participant Coterie live envelope.`,
        );
      }
      return [...latestByUser.values()].map((entry) => ({
        id: entry.key,
        chatId: String(subscription.args.chatId ?? ''),
        userId: entry.value.userId,
        displayName: entry.value.displayName,
        expiresAt: new Date(entry.expiresAtMs).toISOString(),
      })) as T;
    }
    const projected = [];
    for (const row of rows as readonly BackendChatRow[]) {
      const members = row.members.map((member) => ({
        id: this.#externalProfileId(member.profileId),
        displayName: member.displayName,
        avatarUrl: member.avatar ? this.#assetUrl(member.avatar) : null,
        isAdmin: member.role === 'admin',
        isMe: member.profileId === this.#currentBackendProfileId,
      }));
      const counterpart = row.kind === 'dm'
        ? row.members.find((member) => member.profileId !== this.#currentBackendProfileId)
        : null;
      projected.push({
        id: row._id,
        title: row.name,
        description: row.description || null,
        preview: row.lastMessage?.body ?? '',
        updatedAt: new Date(row.lastMessageAt).toISOString(),
        unreadCount: row.active ? row.unreadCount : 0,
        isGroup: row.kind === 'group',
        kind: row.kind,
        memberIds: members.map((member) => member.id),
        members,
        currentUserIsAdmin: row.active && row.viewerRole === 'admin',
        currentUserIsMember: row.active,
        typingHint: null,
        latestReceiptStatus:
          row.lastMessage?.senderProfileId === this.#currentBackendProfileId
            ? row.lastMessage.receiptSummary.aggregateStatus
            : null,
        accentColor: '#4F46E5',
        disappearing: 'off',
        avatarUrl: counterpart?.avatar ? this.#assetUrl(counterpart.avatar) : null,
      });
    }
    return projected as T;
  }

  #projectMessage(row: BackendChatMessageRow): Record<string, unknown> {
    const quotedSnippet = row.quotedMessage?.excerpt ?? null;
    return {
      id: row._id,
      chatId: row.conversationId,
      senderId: this.#externalProfileId(row.senderProfileId),
      senderName: row.senderDisplayName,
      senderAvatarUrl: row.senderAvatar ? this.#assetUrl(row.senderAvatar) : null,
      body: row.body,
      createdAt: new Date(row.createdAt).toISOString(),
      mine: row.senderProfileId === this.#currentBackendProfileId,
      status: row.receiptSummary.aggregateStatus,
      recipientCount: row.receiptSummary.requiredCount,
      deliveredCount: row.receiptSummary.deliveredCount,
      readCount: row.receiptSummary.readCount,
      quotedMessageId: row.quotedMessageId ?? null,
      quotedSenderName: row.quotedMessage?.senderDisplayName ?? null,
      quotedBodySnippet: quotedSnippet,
      quoteText: quotedSnippet,
      reactions: [],
      edited: false,
      deleted: false,
    };
  }

  async #hydrateM3ProfileIdentities(rows: readonly unknown[]): Promise<void> {
    const profileIds = new Set<string>();
    for (const row of rows as readonly (BackendChatRow | BackendChatMessageRow)[]) {
      if ('members' in row) {
        for (const member of row.members) profileIds.add(member.profileId);
        if (row.lastMessage) {
          profileIds.add(row.lastMessage.senderProfileId);
          if (row.lastMessage.quotedMessage) {
            profileIds.add(row.lastMessage.quotedMessage.senderProfileId);
          }
        }
      } else {
        profileIds.add(row.senderProfileId);
        if (row.quotedMessage) profileIds.add(row.quotedMessage.senderProfileId);
      }
    }
    if (
      this.#currentBackendProfileId !== null
      && [...profileIds].every((profileId) => this.#profileIdentityById.has(profileId))
    ) return;
    await this.#refreshProfileIdentityIndex();
    if (
      this.#currentBackendProfileId === null
      || [...profileIds].some((profileId) => !this.#profileIdentityById.has(profileId))
    ) {
      throw new NamedProviderError(
        'SnapbackProviderError',
        'Snapback returned an M3 row whose external profile identity is unavailable.',
      );
    }
  }

  async #typingLiveHandle(
    conversationId: GeneratedDataModel['conversations']['_id'],
    connectionId: string,
    publishRows: (rows: readonly unknown[] | null) => Promise<void>,
    publishError: (error: unknown) => void,
  ): Promise<LiveHandle> {
    const scope = { conversationId };
    let overlay: TypingOverlay | null = null;
    let overlayOff: (() => void) | null = null;
    let active = true;
    let terminal = false;
    let terminalDiagnostic: unknown = null;
    let generation = 0;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    const clearExpiry = () => {
      if (expiryTimer !== null) clearTimeout(expiryTimer);
      expiryTimer = null;
    };
    const scheduleExpiry = (expectedGeneration = generation) => {
      clearExpiry();
      const currentOverlay = overlay;
      if (!currentOverlay || !active || terminal || expectedGeneration !== generation) return;
      // @ref LLP 0013#ttl-and-leases — server wall-clock deadlines are
      // translated by the overlay into a client-local monotonic delay.
      const delayMs = currentOverlay.msUntilEarliestExpiry();
      if (!Number.isFinite(delayMs)) return;
      expiryTimer = setTimeout(() => {
        expiryTimer = null;
        if (
          overlay !== currentOverlay
          || !active
          || terminal
          || expectedGeneration !== generation
        ) return;
        currentOverlay.pruneExpired();
        void publishRows(currentOverlay.currentEntries())
          .then(() => scheduleExpiry(expectedGeneration));
      }, Math.max(0, delayMs));
      expiryTimer.unref?.();
    };

    const startGeneration = async (publishSuccessor: boolean): Promise<void> => {
      if (!active || terminal) return;
      const expectedGeneration = ++generation;
      clearExpiry();
      overlayOff?.();
      overlayOff = null;
      overlay?.dispose();
      overlay = null;
      let next: TypingOverlay;
      try {
        next = await this.#client.subscribeEphemeral(api.ephemeral.typing, {
          connectionId,
          scope,
        }) as TypingOverlay;
      } catch (error) {
        if (!active || terminal || expectedGeneration !== generation) return;
        if (publishSuccessor) {
          publishError(error);
          return;
        }
        throw error;
      }
      if (!active || terminal || expectedGeneration !== generation) {
        next.dispose();
        return;
      }
      overlay = next;
      overlayOff = next.onChange((result) => {
        if (!active || terminal || expectedGeneration !== generation || overlay !== next) return;
        if (result === 'terminal_error') {
          terminal = true;
          terminalDiagnostic = next.terminalDiagnostic;
          clearExpiry();
          publishError(terminalDiagnostic);
          return;
        }
        if (
          result === 'needs_resync'
          || result === 'authority_changed'
          || result === 'authority_missing'
        ) {
          // @ref LLP 0107#resync-authority-and-lifecycle — continuity loss
          // retires this overlay generation and establishes a fresh snapshot
          // on one fenced successor before publishing ready rows again.
          void startGeneration(true);
          return;
        }
        void publishRows(next.currentEntries())
          .then(() => scheduleExpiry(expectedGeneration));
      });
      // onChange replays terminal/resync state synchronously for a poisoned
      // overlay. Do not project that retired generation as ready-empty.
      if (
        !active
        || terminal
        || expectedGeneration !== generation
        || overlay !== next
      ) return;
      if (publishSuccessor) await publishRows(next.currentEntries());
      scheduleExpiry(expectedGeneration);
    };

    await startGeneration(false);
    return {
      get rows() {
        return overlay?.currentEntries() ?? [];
      },
      get terminalDiagnostic() {
        return terminalDiagnostic;
      },
      connection: 'live',
      dispose: async () => {
        if (!active) return;
        active = false;
        generation += 1;
        clearExpiry();
        overlayOff?.();
        overlayOff = null;
        overlay?.dispose();
        overlay = null;
        await unsubscribeTyping(this.#client, connectionId, conversationId).catch(() => {});
      },
    };
  }

  #projectM2Rows<T>(subscription: M2Subscription<T>, rows: readonly unknown[]): T {
    if (subscription.queryName === 'listFeed') {
      const mode = argsFeedMode(subscription.args.mode);
      const backendRows = rows as readonly BackendFeedRow[];
      const nextCursor = backendRows.length === FEED_PAGE_SIZE
        ? encodeFeedCursor(mode, backendRows.at(-1)!)
        : null;
      return backendRows.map((row) => ({
        id: row.itemId,
        ...this.#projectPostView(row),
        feedSortAt: new Date(row.eventCreatedAt).toISOString(),
        repostedById: row.repostedByProfileId
          ? this.#externalProfileId(row.repostedByProfileId)
          : null,
        repostedByName: row.repostedByDisplayName ?? null,
        repostedByHandle: row.repostedByHandle ?? null,
        nextCursor,
      })) as T;
    }
    const backendRows = rows as readonly BackendPostViewRow[];
    if (subscription.queryName === 'listThread') {
      if (backendRows.length === 0) {
        throw new NamedProviderError('ParentPostNotFoundError', 'The parent post does not exist.');
      }
      return backendRows.map((row, index) => ({
        id: row._id,
        ...this.#projectPostView(row),
        parentId: row.parentId ?? null,
        threadRole: index === 0 ? 'parent' : 'direct-reply',
      })) as T;
    }
    return backendRows.map((row) => ({
      id: row._id,
      ...this.#projectPostView(row),
    })) as T;
  }

  #projectPostView(row: BackendPostViewRow): Record<string, unknown> {
    const mediaUrls = [
      ...row.imageMedia
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((media) => this.#assetUrl(media.asset, 'feed')),
      ...(row.videoMedia ? [this.#assetUrl(row.videoMedia.asset, 'primary')] : []),
    ];
    return {
      postId: row._id,
      authorId: this.#externalProfileId(row.authorProfileId),
      authorName: row.authorDisplayName,
      authorHandle: row.authorHandle,
      avatarUrl: row.authorAvatar ? this.#assetUrl(row.authorAvatar) : null,
      body: row.body,
      createdAt: new Date(row.createdAt).toISOString(),
      likeCount: row.likeCount,
      repostCount: row.repostCount,
      replyCount: row.replyCount,
      likedByMe: row.viewerLiked,
      repostedByMe: row.viewerReposted,
      mediaUrls,
      mediaKind: row.videoMedia ? 'video' : row.imageMedia.length > 0 ? 'images' : null,
    };
  }

  async #refreshProfileIdentityIndex(): Promise<readonly BackendProfileRow[]> {
    const rows = (await this.#client.query(api.listProfiles, { args: {} })).rows;
    this.#rememberProfileIdentities(rows);
    return rows;
  }

  async #hydrateM2ProfileIdentities(rows: readonly unknown[]): Promise<void> {
    const profileIds = new Set<string>();
    for (const row of rows as readonly BackendFeedRow[]) {
      profileIds.add(row.authorProfileId);
      if (row.repostedByProfileId) profileIds.add(row.repostedByProfileId);
    }
    if ([...profileIds].every((profileId) => this.#profileIdentityById.has(profileId))) return;
    await this.#refreshProfileIdentityIndex();
    if ([...profileIds].some((profileId) => !this.#profileIdentityById.has(profileId))) {
      throw new NamedProviderError(
        'SnapbackProviderError',
        'Snapback returned an M2 row whose external profile identity is unavailable.',
      );
    }
  }

  #externalProfileId(profileId: string): string {
    const externalId = this.#profileIdentityById.get(profileId);
    if (!externalId) {
      throw new NamedProviderError(
        'SnapbackProviderError',
        'Snapback returned an M2 row whose external profile identity is unavailable.',
      );
    }
    return externalId;
  }

  async #backendProfileId(
    value: unknown,
    missingErrorName = 'ProfileNotFoundError',
    missingMessage = 'The profile does not exist.',
  ): Promise<GeneratedDataModel['profiles']['_id']> {
    const externalId = nonEmptyString(
      value,
      missingErrorName,
      missingMessage,
    );
    const rows = await this.#refreshProfileIdentityIndex();
    const profile = rows.find((row) => (row.fixtureId ?? row.ownerId) === externalId);
    if (!profile) {
      throw new NamedProviderError(missingErrorName, missingMessage);
    }
    return profile._id;
  }

  #stopM2Subscriptions(connection: DataConnection): void {
    this.#m2Cache.clear();
    for (const subscription of this.#m2Subscriptions) {
      subscription.generation += 1;
      subscription.connection = connection;
      void subscription.handle?.dispose();
      subscription.handle = null;
      subscription.start = null;
      subscription.lastValue = undefined;
      if (subscription.active) subscription.observer({ status: 'pending', connection });
    }
  }

  #stopM3Subscriptions(connection: DataConnection): void {
    this.#m3Cache.clear();
    for (const subscription of this.#m3Subscriptions) {
      subscription.generation += 1;
      subscription.connection = connection;
      void subscription.handle?.dispose();
      subscription.handle = null;
      subscription.start = null;
      subscription.lastValue = undefined;
      if (subscription.active) subscription.observer({ status: 'pending', connection });
    }
  }

  #stopTypingPublishers(): void {
    for (const publisher of [...this.#typingPublishers.values()]) {
      void this.#retireTypingPublisher(publisher.conversationId);
    }
  }

  #m2CacheKey(queryName: string, args: Record<string, unknown>): string {
    if (queryName === 'listFeed') {
      return `${queryName}:${String(args.mode)}:${String(args.cursor ?? '')}`;
    }
    if (queryName === 'listThread') return `${queryName}:${String(args.parentId ?? '')}`;
    return `${queryName}:${String(args.userId ?? '')}`;
  }

  #m3CacheKey(queryName: string, args: Record<string, unknown>): string {
    return queryName === 'listMessages' || queryName === 'observeTyping'
      ? `${queryName}:${String(args.chatId ?? '')}`
      : queryName;
  }

  #stopProfileSubscriptions(connection: DataConnection): void {
    this.#profileRows = null;
    this.#profileStatsRows.clear();
    for (const subscription of this.#profileSubscriptions) {
      subscription.generation += 1;
      subscription.connection = connection;
      void subscription.handle?.dispose();
      for (const handle of subscription.statsHandles.values()) void handle.dispose();
      subscription.statsHandles.clear();
      subscription.statsConnections.clear();
      subscription.stats.clear();
      subscription.statsReady = false;
      subscription.backendRows = [];
      subscription.statsGeneration += 1;
      subscription.handle = null;
      subscription.start = null;
      subscription.lastValue = undefined;
      if (subscription.active) {
        subscription.observer({ status: 'pending', connection });
      }
    }
  }

  async #runClaimedMutation(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'signup':
        return this.#signup(args);
      case 'login':
        return this.#login(args);
      case 'logout':
        return this.#logout();
      case 'editProfile':
        return this.#editProfile(args);
      case 'setAvatar':
        return this.#setAvatar(args);
      case 'createPost':
        return this.#createPost(args);
      case 'setFollow':
        return this.#setFollow(args);
      case 'setLike':
        return this.#setLike(args);
      case 'setRepost':
        return this.#setRepost(args);
      case 'openDm':
        return this.#openDm(args);
      case 'createGroup':
        return this.#createGroup(args);
      case 'addMember':
        return this.#addMember(args);
      case 'removeMember':
        return this.#removeMember(args);
      case 'promoteAdmin':
        return this.#promoteAdmin(args);
      case 'leaveChat':
        return this.#leaveChat(args);
      case 'sendMessage':
        return this.#sendMessage(args);
      case 'setTyping':
        return this.#setTyping(args);
      case 'markReceipt':
        return this.#markReceipt(args);
      default:
        throw unclaimedOperationRefusal(name);
    }
  }

  async #createPost(args: Record<string, unknown>): Promise<{ id: string }> {
    const input = normalizedCreatePostInput(args);
    const imageAssetIds = [];
    for (const mediaRef of input.imageRefs) {
      imageAssetIds.push(await this.#postAsset(mediaRef, 'image'));
    }
    const videoAssetId = input.videoRefs[0]
      ? await this.#postAsset(input.videoRefs[0], 'video')
      : undefined;
    const outcome = await this.#client.mutate(api.createPost, {
      args: {
        kind: input.kind,
        body: input.body,
        imageAssetIds,
        ...(videoAssetId ? { videoAssetId } : {}),
        ...(input.parentId
          ? { parentId: input.parentId as GeneratedDataModel['posts']['_id'] }
          : {}),
      },
    });
    if (outcome.status !== 'settled') {
      throw new NamedProviderError(
        'SnapbackProviderError',
        'createPost was queued even though the Coterie adapter disables offline mutation replay.',
      );
    }
    return { id: outcome.result };
  }

  async #setFollow(args: Record<string, unknown>): Promise<void> {
    const profileId = await this.#backendProfileId(args.userId);
    await this.#client.mutate(api.setFollow, {
      args: {
        profileId,
        following: Boolean(args.following),
        mutationId: String(args.mutationId ?? ''),
      },
    });
  }

  async #setLike(args: Record<string, unknown>): Promise<void> {
    const postId = nonEmptyString(
      args.postId,
      'PostNotFoundError',
      'The post does not exist.',
    ) as GeneratedDataModel['posts']['_id'];
    await this.#client.mutate(api.setLike, {
      args: {
        postId,
        liked: Boolean(args.liked),
        mutationId: String(args.mutationId ?? ''),
      },
    });
  }

  async #setRepost(args: Record<string, unknown>): Promise<void> {
    const postId = nonEmptyString(
      args.postId,
      'PostNotFoundError',
      'The post does not exist.',
    ) as GeneratedDataModel['posts']['_id'];
    await setRepostThroughBackend(
      this.#client,
      postId,
      Boolean(args.reposted),
      String(args.mutationId ?? ''),
    );
  }

  async #openDm(args: Record<string, unknown>): Promise<{ chatId: string; reused: boolean }> {
    const otherProfileId = await this.#backendProfileId(args.userId);
    const outcome = await this.#client.mutate(api.openDm, {
      args: { otherProfileId },
    });
    if (outcome.status !== 'settled') {
      throw new NamedProviderError(
        'SnapbackProviderError',
        'openDm was queued even though the Coterie adapter disables offline mutation replay.',
      );
    }
    return {
      chatId: outcome.result.conversationId,
      reused: outcome.result.disposition === 'reused',
    };
  }

  async #createGroup(args: Record<string, unknown>): Promise<{ chatId: string }> {
    const memberValues = Array.isArray(args.memberIds)
      ? args.memberIds.map((value) => String(value))
      : [];
    const uniqueMemberValues = [...new Set(memberValues)];
    const profileRows = await this.#refreshProfileIdentityIndex();
    const creator = profileRows.find((profile) => profile._id === this.#currentBackendProfileId);
    if (!creator) {
      throw new NamedProviderError(
        'SnapbackProviderError',
        'The authenticated Snapback profile is unavailable while validating group membership.',
      );
    }
    const creatorExternalId = creator.fixtureId ?? creator.ownerId;
    if (
      memberValues.length !== uniqueMemberValues.length
      || uniqueMemberValues.length < 2
      || uniqueMemberValues.length > 50
      || !uniqueMemberValues.includes(creatorExternalId)
    ) {
      throw new NamedProviderError(
        'GroupMembersInvalidError',
        'A group requires 2-50 unique members including its creator.',
      );
    }
    const memberProfileIds: GeneratedDataModel['profiles']['_id'][] = [];
    for (const externalId of uniqueMemberValues) {
      if (externalId === creatorExternalId) continue;
      const row = profileRows.find((profile) => (profile.fixtureId ?? profile.ownerId) === externalId);
      if (!row) throw new NamedProviderError('ProfileNotFoundError', 'The profile does not exist.');
      memberProfileIds.push(row._id);
    }
    const outcome = await this.#client.mutate(api.createGroup, {
      args: {
        name: String(args.name ?? ''),
        description: String(args.description ?? ''),
        memberProfileIds,
      },
    });
    if (outcome.status !== 'settled') {
      throw new NamedProviderError(
        'SnapbackProviderError',
        'createGroup was queued even though the Coterie adapter disables offline mutation replay.',
      );
    }
    return { chatId: outcome.result };
  }

  async #addMember(args: Record<string, unknown>): Promise<void> {
    const conversationId = this.#conversationId(args.chatId);
    const profileId = await this.#backendProfileId(args.userId);
    await this.#client.mutate(api.addMember, { args: { conversationId, profileId } });
  }

  async #removeMember(args: Record<string, unknown>): Promise<void> {
    const conversationId = this.#conversationId(args.chatId);
    const profileId = await this.#backendProfileId(
      args.userId,
      'ChatMemberNotFoundError',
      'That profile is not a current group member.',
    );
    await this.#client.mutate(api.removeMember, { args: { conversationId, profileId } });
  }

  async #promoteAdmin(args: Record<string, unknown>): Promise<void> {
    const conversationId = this.#conversationId(args.chatId);
    const profileId = await this.#backendProfileId(
      args.userId,
      'ChatMemberNotFoundError',
      'That profile is not a current group member.',
    );
    await this.#client.mutate(api.promoteAdmin, { args: { conversationId, profileId } });
  }

  async #leaveChat(args: Record<string, unknown>): Promise<void> {
    const conversationId = this.#conversationId(args.chatId);
    await this.#client.mutate(api.leaveChat, {
      args: { conversationId },
    });
    await this.#retireTypingPublisher(conversationId);
  }

  async #sendMessage(args: Record<string, unknown>): Promise<{ id: string }> {
    const conversationId = this.#conversationId(args.chatId);
    const quotedMessageId = args.quotedMessageId === null || args.quotedMessageId === undefined
      ? null
      : nonEmptyString(
          args.quotedMessageId,
          'QuotedMessageInvalidError',
          'Quoted message must exist in this conversation.',
        ) as GeneratedDataModel['messages']['_id'];
    return sendMessageThroughBackend(
      this.#client,
      {
        conversationId,
        body: String(args.body ?? ''),
        ...(quotedMessageId ? { quotedMessageId } : {}),
      },
      () => this.#clearTyping(conversationId),
    );
  }

  async #setTyping(args: Record<string, unknown>): Promise<void> {
    const conversationId = this.#conversationId(args.chatId);
    const publisher = await this.#typingPublisher(conversationId);
    if (!Boolean(args.active)) {
      await publisher.overlay.delete();
      return;
    }
    let value = this.#currentTypingValue();
    if (!value) {
      await this.#refreshProfileIdentityIndex();
      value = this.#currentTypingValue();
    }
    if (!value) {
      throw new NamedProviderError('SessionRequiredError', 'An active session is required.');
    }
    await publisher.overlay.publish(value, { ttlMs: COTERIE_SNAPBACK_TYPING_TTL_MS });
  }

  async #typingPublisher(
    conversationId: GeneratedDataModel['conversations']['_id'],
  ): Promise<TypingPublisher> {
    const key = String(conversationId);
    const existing = this.#typingPublishers.get(key);
    if (existing) return existing;
    const connectionId = `${this.#instanceId}-typing-publish-${++this.#typingConnectionSequence}`;
    const overlay = await this.#client.subscribeEphemeral(api.ephemeral.typing, {
      connectionId,
      scope: { conversationId },
    });
    const raced = this.#typingPublishers.get(key);
    if (raced) {
      overlay.dispose();
      await unsubscribeTyping(this.#client, connectionId, conversationId).catch(() => {});
      return raced;
    }
    const publisher: TypingPublisher = { connectionId, conversationId, overlay };
    this.#typingPublishers.set(key, publisher);
    return publisher;
  }

  async #clearTyping(conversationId: GeneratedDataModel['conversations']['_id']): Promise<void> {
    const publisher = this.#typingPublishers.get(String(conversationId));
    if (publisher) await publisher.overlay.delete();
  }

  async #retireTypingPublisher(
    conversationId: GeneratedDataModel['conversations']['_id'],
  ): Promise<void> {
    const key = String(conversationId);
    const publisher = this.#typingPublishers.get(key);
    if (!publisher) return;
    this.#typingPublishers.delete(key);
    publisher.overlay.dispose();
    await unsubscribeTyping(
      this.#client,
      publisher.connectionId,
      publisher.conversationId,
    ).catch(() => {});
  }

  async #markReceipt(args: Record<string, unknown>): Promise<void> {
    const state = String(args.state ?? '');
    if (state !== 'delivered' && state !== 'read') {
      throw new NamedProviderError(
        'ReceiptStateInvalidError',
        'Receipt state must be delivered or read.',
      );
    }
    const conversationId = this.#conversationId(args.chatId);
    const outcome = await this.#client.mutate(api.markReceiptsThrough, {
      args: { conversationId, state },
    });
    if (outcome.status !== 'settled') {
      throw new NamedProviderError(
        'SnapbackProviderError',
        'markReceipt was queued even though the Coterie adapter disables offline mutation replay.',
      );
    }
  }

  #conversationId(value: unknown): GeneratedDataModel['conversations']['_id'] {
    return nonEmptyString(
      value,
      'ChatNotFoundError',
      'Conversation was not found.',
    ) as GeneratedDataModel['conversations']['_id'];
  }

  async #postAsset(mediaRef: string, kind: 'image' | 'video'): Promise<string> {
    const servedUrl = kind === 'image'
      ? COTERIE_IMAGE_URLS.get(mediaRef)
      : COTERIE_VIDEO_URLS.get(mediaRef);
    if (!servedUrl) {
      throw new NamedProviderError(
        'MediaReferenceInvalidError',
        'Post media must reference a committed fixture image or video.',
      );
    }
    let bytes: ArrayBuffer;
    try {
      const sourceUrl = new URL(
        servedUrl,
        typeof globalThis.location?.href === 'string' ? globalThis.location.href : this.baseUrl,
      );
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`fixture media response ${response.status}`);
      bytes = await response.arrayBuffer();
    } catch (cause) {
      throw new NamedProviderError(
        'MediaReferenceInvalidError',
        'Post media must reference a committed fixture image or video.',
        { cause },
      );
    }
    const mediaType = sniffPostMediaType(bytes, kind);
    const sourceDigest = await sha256Hex(
      bytes,
      'MediaReferenceInvalidError',
      'Post media upload requires WebCrypto SHA-256 support.',
    );
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') {
      throw new NamedProviderError('SessionRequiredError', 'An active session is required.');
    }
    const cacheKey = `${principal.userId}:${kind}:${sourceDigest}`;
    const cached = this.#uploadedPostAssets.get(cacheKey);
    if (cached) return cached;
    const assetClient = createAssetClient(
      this.#client as unknown as Parameters<typeof createAssetClient>[0],
    );
    const assetId = await assetClient.upload(
      kind === 'image' ? api.postImageUpload : api.postVideoUpload,
      new Blob([bytes], { type: mediaType }),
    );
    this.#rememberPostAsset(cacheKey, assetId);
    return assetId;
  }

  #rememberPostAsset(key: string, assetId: string): void {
    this.#uploadedPostAssets.delete(key);
    this.#uploadedPostAssets.set(key, assetId);
    while (this.#uploadedPostAssets.size > POST_ASSET_CACHE_LIMIT) {
      const oldest = this.#uploadedPostAssets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#uploadedPostAssets.delete(oldest);
    }
  }

  async #signup(args: Record<string, unknown>): Promise<unknown> {
    const email = validateEmail(args.email);
    const password = validatePassword(args.password);
    const handle = validateHandle(args.handle);
    const displayName = validateDisplayName(args.displayName);
    const recovered = await this.#completePartialRegistration({
      email,
      handle,
      displayName,
    });
    if (recovered !== null) return recovered;
    const claimedHandle = await this.#client.query(api.getProfileByHandle, {
      args: { handle },
    });
    if (claimedHandle.rows.length > 0) {
      throw new NamedProviderError(
        'DuplicateHandleError',
        'An account already uses that handle.',
      );
    }
    const credential = await this.#client.auth.authPasswordSignup({ email, password });
    const adoptedCapture = this.#coordinator.capture();
    try {
      await this.#testHooks.beforeEnsureProfile?.('signup');
      await this.#client.mutate(api.ensureMyProfile, {
        args: { handle, displayName, bio: '', location: '', link: '' },
      });
      await this.#testHooks.beforeAuthResult?.('signup');
      const result = await this.#authResult(credential);
      await Promise.all([
        this.#refreshSessionProjection(),
        this.#startAllProfileSubscriptions(),
        this.#startAllM2Subscriptions(),
        this.#startAllM3Subscriptions(),
      ]);
      return result.value;
    } catch (originalError) {
      const error = projectAppRefusal(originalError)?.appCode === 'DUPLICATE_HANDLE'
        ? new NamedProviderError(
            'PartialRegistrationError',
            `The email ${email} is registered, but its profile is incomplete because the handle was claimed concurrently. Sign in with this email, then complete signup with a new handle.`,
            { cause: originalError },
          )
        : originalError;
      await this.#rollbackAdoptedAuthority(adoptedCapture, 'coterie_signup_processing_failed', error);
      throw error;
    }
  }

  async #login(args: Record<string, unknown>): Promise<unknown> {
    const { email, password } = validateLoginInput(args);
    if (this.#client.auth.currentPrincipal().status === 'authenticated') {
      // Password issuance is anonymous-authority only. The frozen provider
      // contract permits login to replace the active persona, so settle the
      // predecessor before asking Snapback to issue the successor.
      // @ref LLP 0059#cross-context-ownership — account replacement is two
      // explicit authority transitions; no response may silently adopt a
      // different principal over the current bearer.
      await this.#logout();
    }
    const credential = await this.#client.auth.authPasswordSignIn({ email, password });
    const adoptedCapture = this.#coordinator.capture();
    try {
      await this.#testHooks.beforeAuthResult?.('login');
      const result = await this.#authResult(credential);
      this.#profileCompletion = result.profileExists ? null : { email, credential };
      await Promise.all([
        this.#refreshSessionProjection(),
        this.#startAllProfileSubscriptions(),
        this.#startAllM2Subscriptions(),
        this.#startAllM3Subscriptions(),
      ]);
      return result.value;
    } catch (error) {
      await this.#rollbackAdoptedAuthority(adoptedCapture, 'coterie_login_processing_failed', error);
      throw error;
    }
  }

  async #authResult(credential: BackendSessionCredential): Promise<AuthResultState> {
    const rows = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
    const capture = this.#coordinator.capture();
    const bearer = this.#coordinator.credentialFor(capture).bearer;
    if (!bearer) {
      throw new NamedProviderError('SnapbackProviderError', 'Snapback adopted no session bearer.');
    }
    this.#rememberProfileIdentities(rows);
    return {
      profileExists: rows.length > 0,
      value: {
        userId: rows[0]?.fixtureId ?? rows[0]?.ownerId ?? credential.session.userId,
        sessionToken: bearer,
      },
    };
  }

  async #completePartialRegistration(input: {
    email: string;
    handle: string;
    displayName: string;
  }): Promise<AuthResultState['value'] | null> {
    const recovery = this.#profileCompletion;
    if (!recovery || recovery.email !== input.email) return null;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') return null;
    const current = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
    if (current.length > 0) {
      this.#profileCompletion = null;
      return null;
    }
    const claimedHandle = await this.#client.query(api.getProfileByHandle, {
      args: { handle: input.handle },
    });
    if (claimedHandle.rows.length > 0) {
      throw new NamedProviderError(
        'DuplicateHandleError',
        'An account already uses that handle.',
      );
    }
    await this.#testHooks.beforeEnsureProfile?.('signup-recovery');
    await this.#client.mutate(api.ensureMyProfile, {
      args: {
        handle: input.handle,
        displayName: input.displayName,
        bio: '',
        location: '',
        link: '',
      },
    });
    const result = await this.#authResult(recovery.credential);
    this.#profileCompletion = null;
    await Promise.all([
      this.#refreshSessionProjection(),
      this.#startAllProfileSubscriptions(),
      this.#startAllM2Subscriptions(),
      this.#startAllM3Subscriptions(),
    ]);
    return result.value;
  }

  async #rollbackAdoptedAuthority(
    capture: ReturnType<AuthCoordinator['capture']>,
    reason: string,
    originalError: unknown,
  ): Promise<void> {
    const { clearError: rollbackError } = await this.#clearCapturedAuthorityAndReconcile(
      capture,
      reason,
    );
    if (rollbackError !== null) {
      throw new AggregateError(
        [originalError, rollbackError],
        'Snapback auth adoption failed and local authority rollback also failed.',
      );
    }
  }

  async #logout(): Promise<unknown> {
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') {
      this.#emitSessionReady([]);
      this.#stopProfileSubscriptions('disconnected');
      this.#stopM2Subscriptions('disconnected');
      this.#stopM3Subscriptions('disconnected');
      this.#stopTypingPublishers();
      return { revokedToken: null };
    }
    const capture = this.#coordinator.capture();
    const revokedToken = this.#coordinator.credentialFor(capture).bearer;
    let remoteError: unknown = null;
    let clearError: unknown = null;
    try {
      await this.#client.auth.authLogout();
    } catch (error) {
      remoteError = error;
    }
    try {
      ({ clearError } = await this.#clearCapturedAuthorityAndReconcile(
        capture,
        'coterie_logout_terminal',
      ));
    } catch (error) {
      clearError = error;
    }
    if (remoteError !== null && clearError !== null) {
      throw new AggregateError(
        [remoteError, clearError],
        'Snapback logout lost the remote outcome and local custody clear also failed.',
      );
    }
    if (remoteError !== null) throw remoteError;
    if (clearError !== null) throw clearError;
    return { revokedToken };
  }

  async #editProfile(args: Record<string, unknown>): Promise<void> {
    const rows = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
    const current = rows[0];
    if (!current) {
      throw new NamedProviderError('SessionRequiredError', 'An active session is required.');
    }
    this.#rememberProfileIdentities(rows);
    const displayName = validateDisplayName(args.displayName);
    const before = this.#profileRevision;
    await this.#client.mutate(api.editProfile, {
      args: {
        profileId: current._id,
        displayName,
        bio: validateBio(args.bio),
        handle: args.handle === null ? current.handle : validateHandle(args.handle),
        location: args.location === null ? current.location : validateLocation(args.location),
        link: args.link === null ? current.link : validateLink(args.link),
      },
    });
    this.#profileDisplayNameById.set(current._id, displayName);
    await this.#waitForProfileDelivery(before);
  }

  async #setAvatar(args: Record<string, unknown>): Promise<unknown> {
    const avatarRef = nonEmptyString(
      args.avatarRef,
      'AvatarReferenceInvalidError',
      'Avatar reference is invalid or unavailable.',
    );
    const rows = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
    const current = rows[0];
    if (!current) {
      throw new NamedProviderError('SessionRequiredError', 'An active session is required.');
    }
    const servedAvatarUrl = coterieAvatarUrlForRef(avatarRef);
    if (!servedAvatarUrl) {
      throw new NamedProviderError(
        'AvatarReferenceInvalidError',
        'Avatar reference is invalid or unavailable.',
      );
    }
    let bytes: ArrayBuffer;
    try {
      const sourceUrl = new URL(
        servedAvatarUrl,
        typeof globalThis.location?.href === 'string' ? globalThis.location.href : this.baseUrl,
      );
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        throw new NamedProviderError(
          'AvatarReferenceInvalidError',
          `Avatar reference could not be read (${response.status}).`,
        );
      }
      const blob = await response.blob();
      bytes = await blob.arrayBuffer();
    } catch (cause) {
      if (cause instanceof NamedProviderError) throw cause;
      throw new NamedProviderError(
        'AvatarReferenceInvalidError',
        'Avatar reference is invalid or unavailable.',
        { cause },
      );
    }
    const mediaType = sniffAvatarMediaType(bytes);
    if (!AVATAR_MEDIA_TYPES.has(mediaType)) {
      throw new NamedProviderError(
        'AvatarReferenceInvalidError',
        'Avatar reference must contain a PNG, JPEG, or WebP image.',
      );
    }
    const sourceDigest = await sha256Hex(bytes);
    const assetCacheKey = `${current.ownerId}:${sourceDigest}`;
    let assetId = this.#uploadedAvatarAssets.get(assetCacheKey);
    const reused = assetId !== undefined;
    if (!assetId) {
      const assetClient = createAssetClient(
        this.#client as unknown as Parameters<typeof createAssetClient>[0],
      );
      assetId = await assetClient.upload(
        api.avatarUpload,
        new Blob([bytes], { type: mediaType }),
      );
      this.#rememberAvatarAsset(assetCacheKey, assetId);
    }
    const assetFacts = { assetId, reused, sourceDigest };
    this.#testHooks.onAvatarAssetSelected?.(assetFacts);
    const before = this.#profileRevision;
    try {
      await this.#testHooks.beforeAvatarAttach?.(assetFacts);
      await this.#client.mutate(api.attachMyAvatar, {
        args: { profileId: current._id, assetId, sourceDigest },
      });
    } catch (error) {
      const mapped = declaredError('setAvatar', error);
      if (mapped.name !== 'SnapbackProviderError') throw mapped;
      throw new NamedProviderError(
        'SnapbackProviderError',
        `setAvatar attach failed after asset ${assetId} was finalized; the adapter retained its digest mapping for retry, but this backend has no app-opted reference GC for eventual unreferenced cleanup. ${mapped.message}`,
        { cause: error },
      );
    }
    await this.#waitForProfileDelivery(before);
    return { avatarUrl: this.#assetUrl(assetId) };
  }

  #rememberAvatarAsset(key: string, assetId: string): void {
    this.#uploadedAvatarAssets.delete(key);
    this.#uploadedAvatarAssets.set(key, assetId);
    while (this.#uploadedAvatarAssets.size > AVATAR_ASSET_CACHE_LIMIT) {
      const oldest = this.#uploadedAvatarAssets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#uploadedAvatarAssets.delete(oldest);
    }
  }

  #assetUrl(assetId: string, rendition: 'feed' | 'primary' | 'thumb' = 'thumb'): string {
    return `${this.baseUrl}/assets/public/${encodeURIComponent(assetId)}/${rendition}`;
  }

  async #waitForProfileDelivery(before: number): Promise<void> {
    if (this.#profileSubscriptions.size === 0 || this.#profileRevision > before) return;
    await new Promise<void>((resolve, rejectTimeout) => {
      let settled = false;
      const finish = () => {
        if (settled || this.#profileRevision <= before) return;
        settled = true;
        clearTimeout(timeout);
        this.#profileWaiters.delete(finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.#profileWaiters.delete(finish);
        rejectTimeout(new NamedProviderError(
          'SnapbackProviderError',
          `Snapback profile stream did not deliver the committed mutation within ${this.#profileDeliveryTimeoutMs}ms.`,
        ));
      }, this.#profileDeliveryTimeoutMs);
      this.#profileWaiters.add(finish);
      finish();
    });
  }
}

/**
 * The provider reuses Coterie's shared declaration manifest verbatim. Its
 * milestone claim is qualification evidence, not a provider-specific digest.
 *
 * @ref LLP 0266#d4-backend-boundary — backend transport and live delivery stay
 * behind Exact's public ContractDataProvider seam.
 * @ref LLP 0266#d7-milestone-frozen-provider-surfaces-resolves-oq1 — this
 * adapter implements the frozen M1+M2+M3 set; Snapback's ensureFixture* and
 * getMyFixture* operations are seed machinery only and are never mapped onto
 * this declaration.
 * @ref LLP 0013#lowering-and-one-validator-convergence — typing observation
 * and publication share the generated canonical-membership permission.
 * @ref LLP 0266#d8-provider-selection-at-boot — the adapter never generates a
 * provider-specific Coterie declaration or manifest.
 * @ref LLP 0266#d9-snapback-backend-placement — application-owned auth,
 * profiles, and assets stay behind this app-owned Exact adapter.
 */
export function createCoterieSnapbackProvider(
  options: CoterieSnapbackProviderOptions = {},
): CoterieSnapbackProvider {
  return new SnapbackCoterieProvider(options);
}
