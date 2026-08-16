// GENERATED binding module — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie-memory" 1 (inputsHash b99d16d677cfe8b0).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.

import { createProviderLinks, type ContractDataProvider } from '@exact/contract/runtime';

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface Chat {
  accentColor: string;
  avatarUrl: string | null;
  id: string;
  isGroup: boolean;
  preview: string;
  title: string;
  unreadCount: number;
  updatedAt: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface FeedItem {
  authorHandle: string;
  authorId: string;
  authorName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  id: string;
  likeCount: number;
  likedByMe: boolean;
  mediaKind: string | null;
  mediaUrl: string | null;
  pollQuestion: string | null;
  replyCount: number;
  repostCount: number;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface InsightDay {
  day: string;
  engagements: number;
  id: string;
  views: number;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface Message {
  attachmentKind: string | null;
  attachmentUrl: string | null;
  body: string;
  chatId: string;
  createdAt: string;
  deleted: boolean;
  edited: boolean;
  id: string;
  mine: boolean;
  quoteText: string | null;
  reaction: string | null;
  senderId: string;
  senderName: string;
  status: string;
  viewOnce: boolean;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface PollOption {
  id: string;
  label: string;
  postId: string;
  selectedByMe: boolean;
  votes: number;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface Profile {
  avatarUrl: string | null;
  bio: string;
  displayName: string;
  followedByMe: boolean;
  followers: number;
  following: number;
  handle: string;
  id: string;
  isMe: boolean;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface SearchResult {
  avatarUrl: string | null;
  id: string;
  kind: string;
  subtitle: string;
  title: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface Session {
  id: string;
  signedIn: boolean;
  userId: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface TrendingTopic {
  id: string;
  label: string;
  postCount: number;
  rank: number;
}

export type ListChatsParams = Record<string, never>;
export type ListChatsResult = Array<Chat>;
export type ListChatsError = never;
export type ListChatsReceiptsPosture = 'none';

export interface ListFeedParams {
  mode: string;
}
export type ListFeedResult = Array<FeedItem>;
export type ListFeedError = never;
export type ListFeedReceiptsPosture = 'none';

export type ListInsightsParams = Record<string, never>;
export type ListInsightsResult = Array<InsightDay>;
export type ListInsightsError = never;
export type ListInsightsReceiptsPosture = 'none';

export interface ListMessagesParams {
  chatId: string;
}
export type ListMessagesResult = Array<Message>;
export type ListMessagesError = never;
export type ListMessagesReceiptsPosture = 'none';

export interface ListPollOptionsParams {
  postId: string;
}
export type ListPollOptionsResult = Array<PollOption>;
export type ListPollOptionsError = never;
export type ListPollOptionsReceiptsPosture = 'none';

export type ListProfilesParams = Record<string, never>;
export type ListProfilesResult = Array<Profile>;
export type ListProfilesError = never;
export type ListProfilesReceiptsPosture = 'none';

export type ListSessionParams = Record<string, never>;
export type ListSessionResult = Array<Session>;
export type ListSessionError = never;
export type ListSessionReceiptsPosture = 'none';

export type ListTrendingParams = Record<string, never>;
export type ListTrendingResult = Array<TrendingTopic>;
export type ListTrendingError = never;
export type ListTrendingReceiptsPosture = 'none';

export interface SearchSocialParams {
  query: string;
}
export type SearchSocialResult = Array<SearchResult>;
export type SearchSocialError = never;
export type SearchSocialReceiptsPosture = 'none';

export interface CreatePostParams {
  body: string;
}
export type CreatePostError = never;
export type CreatePostReceiptsPosture = 'none';

export interface EditProfileParams {
  displayName: string;
  bio: string;
}
export type EditProfileError = never;
export type EditProfileReceiptsPosture = 'none';

export interface LoginParams {
  email: string;
  password: string;
}
export type LoginError = never;
export type LoginReceiptsPosture = 'none';

export type LogoutParams = Record<string, never>;
export type LogoutError = never;
export type LogoutReceiptsPosture = 'none';

export interface SendMessageParams {
  chatId: string;
  body: string;
}
export type SendMessageError = never;
export type SendMessageReceiptsPosture = 'none';

export interface ToggleFollowParams {
  userId: string;
}
export type ToggleFollowError = never;
export type ToggleFollowReceiptsPosture = 'none';

export interface ToggleLikeParams {
  postId: string;
}
export type ToggleLikeError = never;
export type ToggleLikeReceiptsPosture = 'none';

export interface VotePollParams {
  postId: string;
  optionId: string;
}
export type VotePollError = never;
export type VotePollReceiptsPosture = 'none';

export interface GeneratedQueryBinding {
  readonly kind: 'query';
  readonly name: string;
  /** Stable descriptor identity at rest (LLP 0179 §8.1: the manifest query name). */
  readonly descriptorId: string;
  readonly compatibilityToken: string;
  readonly resultKind: 'list' | 'single' | 'scalar';
}

export interface GeneratedMutationBinding {
  readonly kind: 'mutation';
  readonly name: string;
  readonly writes: readonly string[];
  readonly optimistic: boolean;
}

export interface GeneratedProviderLinks {
  listChats(args: ListChatsParams): unknown;
  listFeed(args: ListFeedParams): unknown;
  listInsights(args: ListInsightsParams): unknown;
  listMessages(args: ListMessagesParams): unknown;
  listPollOptions(args: ListPollOptionsParams): unknown;
  listProfiles(args: ListProfilesParams): unknown;
  listSession(args: ListSessionParams): unknown;
  listTrending(args: ListTrendingParams): unknown;
  searchSocial(args: SearchSocialParams): unknown;
  createPost(args: CreatePostParams): unknown;
  editProfile(args: EditProfileParams): unknown;
  login(args: LoginParams): unknown;
  logout(args: LogoutParams): unknown;
  sendMessage(args: SendMessageParams): unknown;
  toggleFollow(args: ToggleFollowParams): unknown;
  toggleLike(args: ToggleLikeParams): unknown;
  votePoll(args: VotePollParams): unknown;
}

let generatedProviderLinks: GeneratedProviderLinks | null = null;

export function configureGeneratedProviderLinks(next: GeneratedProviderLinks): void {
  generatedProviderLinks = next;
}

export function resetGeneratedProviderLinks(): void {
  generatedProviderLinks = null;
}

function requireGeneratedProviderLinks(): GeneratedProviderLinks {
  if (generatedProviderLinks === null) {
    throw new Error('Generated provider links for coterie-memory are not configured');
  }
  return generatedProviderLinks;
}

export const listChats = (() => {
  const callable = (args: ListChatsParams): unknown => requireGeneratedProviderLinks().listChats(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listChats' },
    descriptorId: { value: 'listChats' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listFeed = (() => {
  const callable = (args: ListFeedParams): unknown => requireGeneratedProviderLinks().listFeed(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listFeed' },
    descriptorId: { value: 'listFeed' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listInsights = (() => {
  const callable = (args: ListInsightsParams): unknown => requireGeneratedProviderLinks().listInsights(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listInsights' },
    descriptorId: { value: 'listInsights' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listMessages = (() => {
  const callable = (args: ListMessagesParams): unknown => requireGeneratedProviderLinks().listMessages(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listMessages' },
    descriptorId: { value: 'listMessages' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listPollOptions = (() => {
  const callable = (args: ListPollOptionsParams): unknown => requireGeneratedProviderLinks().listPollOptions(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listPollOptions' },
    descriptorId: { value: 'listPollOptions' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listProfiles = (() => {
  const callable = (args: ListProfilesParams): unknown => requireGeneratedProviderLinks().listProfiles(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listProfiles' },
    descriptorId: { value: 'listProfiles' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listSession = (() => {
  const callable = (args: ListSessionParams): unknown => requireGeneratedProviderLinks().listSession(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listSession' },
    descriptorId: { value: 'listSession' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listTrending = (() => {
  const callable = (args: ListTrendingParams): unknown => requireGeneratedProviderLinks().listTrending(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listTrending' },
    descriptorId: { value: 'listTrending' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const searchSocial = (() => {
  const callable = (args: SearchSocialParams): unknown => requireGeneratedProviderLinks().searchSocial(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'searchSocial' },
    descriptorId: { value: 'searchSocial' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const createPost = (() => {
  const callable = (args: CreatePostParams): unknown => requireGeneratedProviderLinks().createPost(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'createPost' },
    writes: { value: ['posts'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const editProfile = (() => {
  const callable = (args: EditProfileParams): unknown => requireGeneratedProviderLinks().editProfile(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'editProfile' },
    writes: { value: ['profiles'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const login = (() => {
  const callable = (args: LoginParams): unknown => requireGeneratedProviderLinks().login(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'login' },
    writes: { value: ['sessions'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const logout = (() => {
  const callable = (args: LogoutParams): unknown => requireGeneratedProviderLinks().logout(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'logout' },
    writes: { value: ['sessions'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const sendMessage = (() => {
  const callable = (args: SendMessageParams): unknown => requireGeneratedProviderLinks().sendMessage(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'sendMessage' },
    writes: { value: ['chats', 'messages'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const toggleFollow = (() => {
  const callable = (args: ToggleFollowParams): unknown => requireGeneratedProviderLinks().toggleFollow(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'toggleFollow' },
    writes: { value: ['profiles'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const toggleLike = (() => {
  const callable = (args: ToggleLikeParams): unknown => requireGeneratedProviderLinks().toggleLike(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'toggleLike' },
    writes: { value: ['posts'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const votePoll = (() => {
  const callable = (args: VotePollParams): unknown => requireGeneratedProviderLinks().votePoll(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'votePoll' },
    writes: { value: ['pollOptions'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const bindings = {
  provider: 'coterie-memory',
  declarationVersion: '1',
  /** Declaration digest as a runtime value (LLP 0391 §4.2 — the fail-closed configure handshake input). */
  inputsHash: 'b99d16d677cfe8b0',
  queries: { listChats, listFeed, listInsights, listMessages, listPollOptions, listProfiles, listSession, listTrending, searchSocial },
  mutations: { createPost, editProfile, login, logout, sendMessage, toggleFollow, toggleLike, votePoll },
} as const;

/**
 * One-call typed provider wiring (LLP 0391 §4.2/§4.3): verifies the
 * provider's manifest digest against this generated surface (fail-closed
 * on EVERY call, including HMR reconfigure), builds the generic provider
 * glue, and installs it as this module's typed links.
 */
export function configureFromProvider(provider: ContractDataProvider): { dispose(): void } {
  const providerInputsHash = provider.manifest.inputsHash;
  if (providerInputsHash !== bindings.inputsHash) {
    throw new Error(
      `configureFromProvider(coterie-memory): declaration digest mismatch — generated bindings expect inputsHash "${bindings.inputsHash}" but provider.manifest carries "${String(providerInputsHash)}". Regenerate the generated bindings from the current declaration (fail-closed on every configure, including HMR reconfigure).`,
    );
  }
  const projection = createProviderLinks(provider);
  // The one sanctioned boundary cast (LLP 0391 §4.2): createProviderLinks
  // builds one link per manifest descriptor, and the digest check above
  // pinned provider.manifest to this generated surface.
  configureGeneratedProviderLinks(projection.links as unknown as GeneratedProviderLinks);
  return { dispose: () => projection.dispose() };
}
