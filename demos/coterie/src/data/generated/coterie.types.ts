// GENERATED types — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie" 4 (inputsHash e55f0d450e11b583).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.

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
