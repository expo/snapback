// GENERATED binding module — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie" 4 (inputsHash e55f0d450e11b583).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.

import { createProviderLinks, type ContractDataProvider } from '@exact/contract/runtime';

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface AuthResult {
  sessionToken: string;
  userId: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface AvatarResult {
  avatarUrl: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface Chat {
  accentColor: string;
  avatarUrl: string | null;
  disappearing: string;
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
  id: string;
  likesReceived: number;
  posts: number;
  totalFollowers: number;
  totalFollowing: number;
  totalLikesReceived: number;
  totalPosts: number;
  totalRepliesReceived: number;
  totalRepostsReceived: number;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface LogoutMutationResult {
  revokedToken: string | null;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface Message {
  body: string;
  chatId: string;
  createdAt: string;
  deleted: boolean;
  edited: boolean;
  id: string;
  mine: boolean;
  quoteText: string | null;
  senderId: string;
  senderName: string;
  status: string;
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
  link: string;
  location: string;
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
  expiresAt: string;
  id: string;
  revokedAt: string | null;
  signedIn: boolean;
  token: string;
  userId: string;
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

export type ListProfilesParams = Record<string, never>;
export type ListProfilesResult = Array<Profile>;
export type ListProfilesError = never;
export type ListProfilesReceiptsPosture = 'none';

export type ListSessionParams = Record<string, never>;
export type ListSessionResult = Array<Session>;
export type ListSessionError = never;
export type ListSessionReceiptsPosture = 'none';

export interface SearchSocialParams {
  query: string;
}
export type SearchSocialResult = Array<SearchResult>;
export type SearchSocialError = never;
export type SearchSocialReceiptsPosture = 'none';

export interface CreatePostParams {
  body: string;
}
export interface CreatePostSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type CreatePostError = CreatePostSessionRequiredError;
export type CreatePostReceiptsPosture = 'none';

export interface EditProfileParams {
  displayName: string;
  bio: string;
  handle: string | null;
  location: string | null;
  link: string | null;
}
export interface EditProfileBioInvalidError {
  name: 'BioInvalidError';
  code: 'bio_invalid';
  message: string;
}
export interface EditProfileDisplayNameInvalidError {
  name: 'DisplayNameInvalidError';
  code: 'display_name_invalid';
  message: string;
}
export interface EditProfileDuplicateHandleError {
  name: 'DuplicateHandleError';
  code: 'duplicate_handle';
  message: string;
}
export interface EditProfileHandleInvalidError {
  name: 'HandleInvalidError';
  code: 'handle_invalid';
  message: string;
}
export interface EditProfileLinkInvalidError {
  name: 'LinkInvalidError';
  code: 'link_invalid';
  message: string;
}
export interface EditProfileLocationInvalidError {
  name: 'LocationInvalidError';
  code: 'location_invalid';
  message: string;
}
export interface EditProfileSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type EditProfileError = EditProfileBioInvalidError | EditProfileDisplayNameInvalidError | EditProfileDuplicateHandleError | EditProfileHandleInvalidError | EditProfileLinkInvalidError | EditProfileLocationInvalidError | EditProfileSessionRequiredError;
export type EditProfileReceiptsPosture = 'none';

export interface LoginParams {
  email: string;
  password: string;
}
export type LoginResult = AuthResult;
export interface LoginInvalidCredentialsError {
  name: 'InvalidCredentialsError';
  code: 'invalid_credentials';
  message: string;
}
export type LoginError = LoginInvalidCredentialsError;
export type LoginReceiptsPosture = 'none';

export type LogoutParams = Record<string, never>;
export type LogoutResult = LogoutMutationResult;
export type LogoutError = never;
export type LogoutReceiptsPosture = 'none';

export interface SendMessageParams {
  chatId: string;
  body: string;
}
export interface SendMessageSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SendMessageError = SendMessageSessionRequiredError;
export type SendMessageReceiptsPosture = 'none';

export interface SetAvatarParams {
  avatarRef: string;
}
export type SetAvatarResult = AvatarResult;
export interface SetAvatarAvatarReferenceInvalidError {
  name: 'AvatarReferenceInvalidError';
  code: 'avatar_reference_invalid';
  message: string;
}
export interface SetAvatarSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SetAvatarError = SetAvatarAvatarReferenceInvalidError | SetAvatarSessionRequiredError;
export type SetAvatarReceiptsPosture = 'none';

export interface SetChatAccentParams {
  chatId: string;
  color: string;
  mutationId: string;
}
export type SetChatAccentError = never;
export type SetChatAccentReceiptsPosture = 'none';

export interface SetDisappearingParams {
  chatId: string;
  value: string;
  mutationId: string;
}
export type SetDisappearingError = never;
export type SetDisappearingReceiptsPosture = 'none';

export interface SetFollowParams {
  userId: string;
  following: boolean;
  mutationId: string;
}
export interface SetFollowSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SetFollowError = SetFollowSessionRequiredError;
export type SetFollowReceiptsPosture = 'none';

export interface SetLikeParams {
  postId: string;
  liked: boolean;
  mutationId: string;
}
export interface SetLikeSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SetLikeError = SetLikeSessionRequiredError;
export type SetLikeReceiptsPosture = 'none';

export interface SignupParams {
  email: string;
  password: string;
  handle: string;
  displayName: string;
}
export type SignupResult = AuthResult;
export interface SignupDisplayNameInvalidError {
  name: 'DisplayNameInvalidError';
  code: 'display_name_invalid';
  message: string;
}
export interface SignupDuplicateEmailError {
  name: 'DuplicateEmailError';
  code: 'duplicate_email';
  message: string;
}
export interface SignupDuplicateHandleError {
  name: 'DuplicateHandleError';
  code: 'duplicate_handle';
  message: string;
}
export interface SignupEmailInvalidError {
  name: 'EmailInvalidError';
  code: 'email_invalid';
  message: string;
}
export interface SignupHandleInvalidError {
  name: 'HandleInvalidError';
  code: 'handle_invalid';
  message: string;
}
export interface SignupPasswordTooShortError {
  name: 'PasswordTooShortError';
  code: 'password_too_short';
  message: string;
}
export type SignupError = SignupDisplayNameInvalidError | SignupDuplicateEmailError | SignupDuplicateHandleError | SignupEmailInvalidError | SignupHandleInvalidError | SignupPasswordTooShortError;
export type SignupReceiptsPosture = 'none';

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
  listProfiles(args: ListProfilesParams): unknown;
  listSession(args: ListSessionParams): unknown;
  searchSocial(args: SearchSocialParams): unknown;
  createPost(args: CreatePostParams): unknown;
  editProfile(args: EditProfileParams): unknown;
  login(args: LoginParams): unknown;
  logout(args: LogoutParams): unknown;
  sendMessage(args: SendMessageParams): unknown;
  setAvatar(args: SetAvatarParams): unknown;
  setChatAccent(args: SetChatAccentParams): unknown;
  setDisappearing(args: SetDisappearingParams): unknown;
  setFollow(args: SetFollowParams): unknown;
  setLike(args: SetLikeParams): unknown;
  signup(args: SignupParams): unknown;
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
    throw new Error('Generated provider links for coterie are not configured');
  }
  return generatedProviderLinks;
}

export const listChats = (() => {
  const callable = (args: ListChatsParams): unknown => requireGeneratedProviderLinks().listChats(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listChats' },
    descriptorId: { value: 'listChats' },
    compatibilityToken: { value: '2' },
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
    compatibilityToken: { value: '2' },
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
    compatibilityToken: { value: '2' },
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
    compatibilityToken: { value: '2' },
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
    compatibilityToken: { value: '2' },
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
    compatibilityToken: { value: '2' },
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
    compatibilityToken: { value: '2' },
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
    writes: { value: ['accounts', 'messages', 'posts', 'profiles', 'search'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const login = (() => {
  const callable = (args: LoginParams): unknown => requireGeneratedProviderLinks().login(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'login' },
    writes: { value: ['messages', 'posts', 'profiles', 'sessionRevocations', 'sessions'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const logout = (() => {
  const callable = (args: LogoutParams): unknown => requireGeneratedProviderLinks().logout(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'logout' },
    writes: { value: ['sessionRevocations', 'sessions'] },
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

export const setAvatar = (() => {
  const callable = (args: SetAvatarParams): unknown => requireGeneratedProviderLinks().setAvatar(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setAvatar' },
    writes: { value: ['posts', 'profiles', 'search'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setChatAccent = (() => {
  const callable = (args: SetChatAccentParams): unknown => requireGeneratedProviderLinks().setChatAccent(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setChatAccent' },
    writes: { value: ['chats'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setDisappearing = (() => {
  const callable = (args: SetDisappearingParams): unknown => requireGeneratedProviderLinks().setDisappearing(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setDisappearing' },
    writes: { value: ['chats'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setFollow = (() => {
  const callable = (args: SetFollowParams): unknown => requireGeneratedProviderLinks().setFollow(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setFollow' },
    writes: { value: ['follows', 'posts', 'profiles'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setLike = (() => {
  const callable = (args: SetLikeParams): unknown => requireGeneratedProviderLinks().setLike(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setLike' },
    writes: { value: ['posts'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const signup = (() => {
  const callable = (args: SignupParams): unknown => requireGeneratedProviderLinks().signup(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'signup' },
    writes: { value: ['accounts', 'messages', 'posts', 'profiles', 'search', 'sessionRevocations', 'sessions'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const bindings = {
  provider: 'coterie',
  declarationVersion: '4',
  /** Declaration digest as a runtime value (LLP 0391 §4.2 — the fail-closed configure handshake input). */
  inputsHash: 'e55f0d450e11b583',
  queries: { listChats, listFeed, listInsights, listMessages, listProfiles, listSession, searchSocial },
  mutations: { createPost, editProfile, login, logout, sendMessage, setAvatar, setChatAccent, setDisappearing, setFollow, setLike, signup },
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
      `configureFromProvider(coterie): declaration digest mismatch — generated bindings expect inputsHash "${bindings.inputsHash}" but provider.manifest carries "${String(providerInputsHash)}". Regenerate the generated bindings from the current declaration (fail-closed on every configure, including HMR reconfigure).`,
    );
  }
  const projection = createProviderLinks(provider);
  // The one sanctioned boundary cast (LLP 0391 §4.2): createProviderLinks
  // builds one link per manifest descriptor, and the digest check above
  // pinned provider.manifest to this generated surface.
  configureGeneratedProviderLinks(projection.links as unknown as GeneratedProviderLinks);
  return { dispose: () => projection.dispose() };
}
