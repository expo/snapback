// GENERATED types — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie" 8 (inputsHash e0be7bf6f9f5bc27).
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
  currentUserIsAdmin: boolean;
  currentUserIsMember: boolean;
  description: string | null;
  disappearing: string;
  id: string;
  isGroup: boolean;
  kind: string;
  latestReceiptStatus: string | null;
  memberIds: Array<string>;
  members: Array<{
    avatarUrl: string | null;
    displayName: string;
    id: string;
    isAdmin: boolean;
    isMe: boolean;
  }>;
  preview: string;
  title: string;
  typingHint: string | null;
  unreadCount: number;
  updatedAt: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface CreatedGroup {
  chatId: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface CreatedPost {
  id: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface FeedItem {
  authorHandle: string;
  authorId: string;
  authorName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  feedSortAt: string;
  id: string;
  likeCount: number;
  likedByMe: boolean;
  mediaKind: string | null;
  mediaUrls: Array<string>;
  nextCursor: string | null;
  postId: string;
  replyCount: number;
  repostCount: number;
  repostedByHandle: string | null;
  repostedById: string | null;
  repostedByMe: boolean;
  repostedByName: string | null;
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
  deliveredCount: number;
  edited: boolean;
  id: string;
  mine: boolean;
  quoteText: string | null;
  quotedBodySnippet: string | null;
  quotedMessageId: string | null;
  quotedSenderName: string | null;
  reactions: Array<{
    count: number;
    emoji: string;
    reactedByMe: boolean;
  }>;
  readCount: number;
  recipientCount: number;
  senderAvatarUrl: string | null;
  senderId: string;
  senderName: string;
  status: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface OpenedChat {
  chatId: string;
  reused: boolean;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface Profile {
  avatarRef: string | null;
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
export interface ProfilePost {
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
  mediaUrls: Array<string>;
  postId: string;
  replyCount: number;
  repostCount: number;
  repostedByMe: boolean;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface ProviderClaim {
  kind: string;
  name: string;
  token: string;
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

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface ThreadPost {
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
  mediaUrls: Array<string>;
  parentId: string | null;
  postId: string;
  replyCount: number;
  repostCount: number;
  repostedByMe: boolean;
  threadRole: string;
}

/** OQ8: excess provider result fields are structurally permitted at the wire and projected away by this row type. */
export interface TypingParticipant {
  chatId: string;
  displayName: string;
  expiresAt: string;
  id: string;
  userId: string;
}

export type ListChatsParams = Record<string, never>;
export type ListChatsResult = Array<Chat>;
export type ListChatsError = never;
export type ListChatsReceiptsPosture = 'none';

export interface ListFeedParams {
  mode: string;
  cursor: string | null;
}
export type ListFeedResult = Array<FeedItem>;
export interface ListFeedFeedCursorInvalidError {
  name: 'FeedCursorInvalidError';
  code: 'feed_cursor_invalid';
  message: string;
}
export interface ListFeedFeedModeInvalidError {
  name: 'FeedModeInvalidError';
  code: 'feed_mode_invalid';
  message: string;
}
export type ListFeedError = ListFeedFeedCursorInvalidError | ListFeedFeedModeInvalidError;
export type ListFeedReceiptsPosture = 'none';

export type ListInsightsParams = Record<string, never>;
export type ListInsightsResult = Array<InsightDay>;
export type ListInsightsError = never;
export type ListInsightsReceiptsPosture = 'none';

export interface ListMessagesParams {
  chatId: string;
}
export type ListMessagesResult = Array<Message>;
export interface ListMessagesChatMembershipRequiredError {
  name: 'ChatMembershipRequiredError';
  code: 'chat_membership_required';
  message: string;
}
export interface ListMessagesChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export type ListMessagesError = ListMessagesChatMembershipRequiredError | ListMessagesChatNotFoundError;
export type ListMessagesReceiptsPosture = 'none';

export interface ListProfilePostsParams {
  userId: string;
}
export type ListProfilePostsResult = Array<ProfilePost>;
export interface ListProfilePostsProfileNotFoundError {
  name: 'ProfileNotFoundError';
  code: 'profile_not_found';
  message: string;
}
export type ListProfilePostsError = ListProfilePostsProfileNotFoundError;
export type ListProfilePostsReceiptsPosture = 'none';

export type ListProfilesParams = Record<string, never>;
export type ListProfilesResult = Array<Profile>;
export type ListProfilesError = never;
export type ListProfilesReceiptsPosture = 'none';

export type ListProviderClaimsParams = Record<string, never>;
export type ListProviderClaimsResult = Array<ProviderClaim>;
export type ListProviderClaimsError = never;
export type ListProviderClaimsReceiptsPosture = 'none';

export type ListSessionParams = Record<string, never>;
export type ListSessionResult = Array<Session>;
export type ListSessionError = never;
export type ListSessionReceiptsPosture = 'none';

export interface ListThreadParams {
  parentId: string;
}
export type ListThreadResult = Array<ThreadPost>;
export interface ListThreadParentPostNotFoundError {
  name: 'ParentPostNotFoundError';
  code: 'parent_post_not_found';
  message: string;
}
export type ListThreadError = ListThreadParentPostNotFoundError;
export type ListThreadReceiptsPosture = 'none';

export interface ObserveTypingParams {
  chatId: string;
}
export type ObserveTypingResult = Array<TypingParticipant>;
export interface ObserveTypingChatMembershipRequiredError {
  name: 'ChatMembershipRequiredError';
  code: 'chat_membership_required';
  message: string;
}
export interface ObserveTypingChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export type ObserveTypingError = ObserveTypingChatMembershipRequiredError | ObserveTypingChatNotFoundError;
export type ObserveTypingReceiptsPosture = 'none';

export interface SearchSocialParams {
  query: string;
}
export type SearchSocialResult = Array<SearchResult>;
export type SearchSocialError = never;
export type SearchSocialReceiptsPosture = 'none';

export interface AddMemberParams {
  chatId: string;
  userId: string;
}
export interface AddMemberChatAdminRequiredError {
  name: 'ChatAdminRequiredError';
  code: 'chat_admin_required';
  message: string;
}
export interface AddMemberChatMemberAlreadyExistsError {
  name: 'ChatMemberAlreadyExistsError';
  code: 'chat_member_already_exists';
  message: string;
}
export interface AddMemberChatMemberLimitError {
  name: 'ChatMemberLimitError';
  code: 'chat_member_limit';
  message: string;
}
export interface AddMemberChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export interface AddMemberGroupRequiredError {
  name: 'GroupRequiredError';
  code: 'group_required';
  message: string;
}
export interface AddMemberProfileNotFoundError {
  name: 'ProfileNotFoundError';
  code: 'profile_not_found';
  message: string;
}
export interface AddMemberSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type AddMemberError = AddMemberChatAdminRequiredError | AddMemberChatMemberAlreadyExistsError | AddMemberChatMemberLimitError | AddMemberChatNotFoundError | AddMemberGroupRequiredError | AddMemberProfileNotFoundError | AddMemberSessionRequiredError;
export type AddMemberReceiptsPosture = 'none';

export interface CreateGroupParams {
  name: string;
  description: string | null;
  memberIds: Array<string>;
}
export type CreateGroupResult = CreatedGroup;
export interface CreateGroupGroupDescriptionInvalidError {
  name: 'GroupDescriptionInvalidError';
  code: 'group_description_invalid';
  message: string;
}
export interface CreateGroupGroupMembersInvalidError {
  name: 'GroupMembersInvalidError';
  code: 'group_members_invalid';
  message: string;
}
export interface CreateGroupGroupNameInvalidError {
  name: 'GroupNameInvalidError';
  code: 'group_name_invalid';
  message: string;
}
export interface CreateGroupProfileNotFoundError {
  name: 'ProfileNotFoundError';
  code: 'profile_not_found';
  message: string;
}
export interface CreateGroupSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type CreateGroupError = CreateGroupGroupDescriptionInvalidError | CreateGroupGroupMembersInvalidError | CreateGroupGroupNameInvalidError | CreateGroupProfileNotFoundError | CreateGroupSessionRequiredError;
export type CreateGroupReceiptsPosture = 'none';

export interface CreatePostParams {
  body: string;
  imageRefs: Array<string>;
  videoRefs: Array<string>;
  parentId: string | null;
}
export type CreatePostResult = CreatedPost;
export interface CreatePostImageCountInvalidError {
  name: 'ImageCountInvalidError';
  code: 'image_count_invalid';
  message: string;
}
export interface CreatePostMediaMixInvalidError {
  name: 'MediaMixInvalidError';
  code: 'media_mix_invalid';
  message: string;
}
export interface CreatePostMediaReferenceInvalidError {
  name: 'MediaReferenceInvalidError';
  code: 'media_reference_invalid';
  message: string;
}
export interface CreatePostParentPostNotFoundError {
  name: 'ParentPostNotFoundError';
  code: 'parent_post_not_found';
  message: string;
}
export interface CreatePostPostBodyInvalidError {
  name: 'PostBodyInvalidError';
  code: 'post_body_invalid';
  message: string;
}
export interface CreatePostSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export interface CreatePostVideoCountInvalidError {
  name: 'VideoCountInvalidError';
  code: 'video_count_invalid';
  message: string;
}
export type CreatePostError = CreatePostImageCountInvalidError | CreatePostMediaMixInvalidError | CreatePostMediaReferenceInvalidError | CreatePostParentPostNotFoundError | CreatePostPostBodyInvalidError | CreatePostSessionRequiredError | CreatePostVideoCountInvalidError;
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

export interface LeaveChatParams {
  chatId: string;
}
export interface LeaveChatChatMembershipRequiredError {
  name: 'ChatMembershipRequiredError';
  code: 'chat_membership_required';
  message: string;
}
export interface LeaveChatChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export interface LeaveChatGroupRequiredError {
  name: 'GroupRequiredError';
  code: 'group_required';
  message: string;
}
export interface LeaveChatSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type LeaveChatError = LeaveChatChatMembershipRequiredError | LeaveChatChatNotFoundError | LeaveChatGroupRequiredError | LeaveChatSessionRequiredError;
export type LeaveChatReceiptsPosture = 'none';

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

export interface MarkReceiptParams {
  chatId: string;
  state: string;
}
export interface MarkReceiptChatMembershipRequiredError {
  name: 'ChatMembershipRequiredError';
  code: 'chat_membership_required';
  message: string;
}
export interface MarkReceiptChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export interface MarkReceiptReceiptStateInvalidError {
  name: 'ReceiptStateInvalidError';
  code: 'receipt_state_invalid';
  message: string;
}
export interface MarkReceiptSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type MarkReceiptError = MarkReceiptChatMembershipRequiredError | MarkReceiptChatNotFoundError | MarkReceiptReceiptStateInvalidError | MarkReceiptSessionRequiredError;
export type MarkReceiptReceiptsPosture = 'none';

export interface OpenDmParams {
  userId: string;
}
export type OpenDmResult = OpenedChat;
export interface OpenDmDirectMessageSelfError {
  name: 'DirectMessageSelfError';
  code: 'direct_message_self';
  message: string;
}
export interface OpenDmProfileNotFoundError {
  name: 'ProfileNotFoundError';
  code: 'profile_not_found';
  message: string;
}
export interface OpenDmSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type OpenDmError = OpenDmDirectMessageSelfError | OpenDmProfileNotFoundError | OpenDmSessionRequiredError;
export type OpenDmReceiptsPosture = 'none';

export interface PromoteAdminParams {
  chatId: string;
  userId: string;
}
export interface PromoteAdminChatAdminRequiredError {
  name: 'ChatAdminRequiredError';
  code: 'chat_admin_required';
  message: string;
}
export interface PromoteAdminChatMemberNotFoundError {
  name: 'ChatMemberNotFoundError';
  code: 'chat_member_not_found';
  message: string;
}
export interface PromoteAdminChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export interface PromoteAdminGroupRequiredError {
  name: 'GroupRequiredError';
  code: 'group_required';
  message: string;
}
export interface PromoteAdminSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type PromoteAdminError = PromoteAdminChatAdminRequiredError | PromoteAdminChatMemberNotFoundError | PromoteAdminChatNotFoundError | PromoteAdminGroupRequiredError | PromoteAdminSessionRequiredError;
export type PromoteAdminReceiptsPosture = 'none';

export interface RemoveMemberParams {
  chatId: string;
  userId: string;
}
export interface RemoveMemberChatAdminRequiredError {
  name: 'ChatAdminRequiredError';
  code: 'chat_admin_required';
  message: string;
}
export interface RemoveMemberChatMemberNotFoundError {
  name: 'ChatMemberNotFoundError';
  code: 'chat_member_not_found';
  message: string;
}
export interface RemoveMemberChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export interface RemoveMemberGroupRequiredError {
  name: 'GroupRequiredError';
  code: 'group_required';
  message: string;
}
export interface RemoveMemberRemoveSelfInvalidError {
  name: 'RemoveSelfInvalidError';
  code: 'remove_self_invalid';
  message: string;
}
export interface RemoveMemberSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type RemoveMemberError = RemoveMemberChatAdminRequiredError | RemoveMemberChatMemberNotFoundError | RemoveMemberChatNotFoundError | RemoveMemberGroupRequiredError | RemoveMemberRemoveSelfInvalidError | RemoveMemberSessionRequiredError;
export type RemoveMemberReceiptsPosture = 'none';

export interface SendMessageParams {
  chatId: string;
  body: string;
  quotedMessageId: string | null;
}
export interface SendMessageChatMembershipRequiredError {
  name: 'ChatMembershipRequiredError';
  code: 'chat_membership_required';
  message: string;
}
export interface SendMessageChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export interface SendMessageMessageBodyInvalidError {
  name: 'MessageBodyInvalidError';
  code: 'message_body_invalid';
  message: string;
}
export interface SendMessageQuotedMessageInvalidError {
  name: 'QuotedMessageInvalidError';
  code: 'quoted_message_invalid';
  message: string;
}
export interface SendMessageSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SendMessageError = SendMessageChatMembershipRequiredError | SendMessageChatNotFoundError | SendMessageMessageBodyInvalidError | SendMessageQuotedMessageInvalidError | SendMessageSessionRequiredError;
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
export interface SetFollowProfileNotFoundError {
  name: 'ProfileNotFoundError';
  code: 'profile_not_found';
  message: string;
}
export interface SetFollowSelfFollowInvalidError {
  name: 'SelfFollowInvalidError';
  code: 'self_follow_invalid';
  message: string;
}
export interface SetFollowSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SetFollowError = SetFollowProfileNotFoundError | SetFollowSelfFollowInvalidError | SetFollowSessionRequiredError;
export type SetFollowReceiptsPosture = 'none';

export interface SetLikeParams {
  postId: string;
  liked: boolean;
  mutationId: string;
}
export interface SetLikePostNotFoundError {
  name: 'PostNotFoundError';
  code: 'post_not_found';
  message: string;
}
export interface SetLikeSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SetLikeError = SetLikePostNotFoundError | SetLikeSessionRequiredError;
export type SetLikeReceiptsPosture = 'none';

export interface SetMessageReactionParams {
  chatId: string;
  messageId: string;
  emoji: string;
  reacted: boolean;
  mutationId: string;
}
export interface SetMessageReactionChatMembershipRequiredError {
  name: 'ChatMembershipRequiredError';
  code: 'chat_membership_required';
  message: string;
}
export interface SetMessageReactionChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export interface SetMessageReactionEmojiInvalidError {
  name: 'EmojiInvalidError';
  code: 'emoji_invalid';
  message: string;
}
export interface SetMessageReactionMessageNotFoundError {
  name: 'MessageNotFoundError';
  code: 'message_not_found';
  message: string;
}
export interface SetMessageReactionSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SetMessageReactionError = SetMessageReactionChatMembershipRequiredError | SetMessageReactionChatNotFoundError | SetMessageReactionEmojiInvalidError | SetMessageReactionMessageNotFoundError | SetMessageReactionSessionRequiredError;
export type SetMessageReactionReceiptsPosture = 'none';

export interface SetRepostParams {
  postId: string;
  reposted: boolean;
  mutationId: string;
}
export interface SetRepostPostNotFoundError {
  name: 'PostNotFoundError';
  code: 'post_not_found';
  message: string;
}
export interface SetRepostReplyRepostForbiddenError {
  name: 'ReplyRepostForbiddenError';
  code: 'reply_repost_forbidden';
  message: string;
}
export interface SetRepostSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SetRepostError = SetRepostPostNotFoundError | SetRepostReplyRepostForbiddenError | SetRepostSessionRequiredError;
export type SetRepostReceiptsPosture = 'none';

export interface SetTypingParams {
  chatId: string;
  active: boolean;
}
export interface SetTypingChatMembershipRequiredError {
  name: 'ChatMembershipRequiredError';
  code: 'chat_membership_required';
  message: string;
}
export interface SetTypingChatNotFoundError {
  name: 'ChatNotFoundError';
  code: 'chat_not_found';
  message: string;
}
export interface SetTypingSessionRequiredError {
  name: 'SessionRequiredError';
  code: 'session_required';
  message: string;
}
export type SetTypingError = SetTypingChatMembershipRequiredError | SetTypingChatNotFoundError | SetTypingSessionRequiredError;
export type SetTypingReceiptsPosture = 'none';

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
export interface SignupPartialRegistrationError {
  name: 'PartialRegistrationError';
  code: 'partial_registration';
  message: string;
}
export interface SignupPasswordTooShortError {
  name: 'PasswordTooShortError';
  code: 'password_too_short';
  message: string;
}
export type SignupError = SignupDisplayNameInvalidError | SignupDuplicateEmailError | SignupDuplicateHandleError | SignupEmailInvalidError | SignupHandleInvalidError | SignupPartialRegistrationError | SignupPasswordTooShortError;
export type SignupReceiptsPosture = 'none';
