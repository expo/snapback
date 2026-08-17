// GENERATED binding module — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie" 8 (inputsHash e0be7bf6f9f5bc27).
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
  listProfilePosts(args: ListProfilePostsParams): unknown;
  listProfiles(args: ListProfilesParams): unknown;
  listProviderClaims(args: ListProviderClaimsParams): unknown;
  listSession(args: ListSessionParams): unknown;
  listThread(args: ListThreadParams): unknown;
  observeTyping(args: ObserveTypingParams): unknown;
  searchSocial(args: SearchSocialParams): unknown;
  addMember(args: AddMemberParams): unknown;
  createGroup(args: CreateGroupParams): unknown;
  createPost(args: CreatePostParams): unknown;
  editProfile(args: EditProfileParams): unknown;
  leaveChat(args: LeaveChatParams): unknown;
  login(args: LoginParams): unknown;
  logout(args: LogoutParams): unknown;
  markReceipt(args: MarkReceiptParams): unknown;
  openDm(args: OpenDmParams): unknown;
  promoteAdmin(args: PromoteAdminParams): unknown;
  removeMember(args: RemoveMemberParams): unknown;
  sendMessage(args: SendMessageParams): unknown;
  setAvatar(args: SetAvatarParams): unknown;
  setChatAccent(args: SetChatAccentParams): unknown;
  setDisappearing(args: SetDisappearingParams): unknown;
  setFollow(args: SetFollowParams): unknown;
  setLike(args: SetLikeParams): unknown;
  setMessageReaction(args: SetMessageReactionParams): unknown;
  setRepost(args: SetRepostParams): unknown;
  setTyping(args: SetTypingParams): unknown;
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
    compatibilityToken: { value: '3' },
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
    compatibilityToken: { value: '3' },
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
    compatibilityToken: { value: '4' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listProfilePosts = (() => {
  const callable = (args: ListProfilePostsParams): unknown => requireGeneratedProviderLinks().listProfilePosts(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listProfilePosts' },
    descriptorId: { value: 'listProfilePosts' },
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
    compatibilityToken: { value: '3' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listProviderClaims = (() => {
  const callable = (args: ListProviderClaimsParams): unknown => requireGeneratedProviderLinks().listProviderClaims(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listProviderClaims' },
    descriptorId: { value: 'listProviderClaims' },
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
    compatibilityToken: { value: '2' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const listThread = (() => {
  const callable = (args: ListThreadParams): unknown => requireGeneratedProviderLinks().listThread(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'listThread' },
    descriptorId: { value: 'listThread' },
    compatibilityToken: { value: '1' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const observeTyping = (() => {
  const callable = (args: ObserveTypingParams): unknown => requireGeneratedProviderLinks().observeTyping(args);
  Object.defineProperties(callable, {
    kind: { value: 'query' },
    name: { value: 'observeTyping' },
    descriptorId: { value: 'observeTyping' },
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
    compatibilityToken: { value: '2' },
    resultKind: { value: 'list' },
  });
  return callable as typeof callable & GeneratedQueryBinding;
})();

export const addMember = (() => {
  const callable = (args: AddMemberParams): unknown => requireGeneratedProviderLinks().addMember(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'addMember' },
    writes: { value: ['chatMemberships', 'chats'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const createGroup = (() => {
  const callable = (args: CreateGroupParams): unknown => requireGeneratedProviderLinks().createGroup(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'createGroup' },
    writes: { value: ['chatMemberships', 'chats'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
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
    writes: { value: ['accounts', 'messages', 'profiles', 'search'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const leaveChat = (() => {
  const callable = (args: LeaveChatParams): unknown => requireGeneratedProviderLinks().leaveChat(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'leaveChat' },
    writes: { value: ['chatMemberships', 'chats', 'ephemeralTyping', 'messageReceipts', 'messages'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const login = (() => {
  const callable = (args: LoginParams): unknown => requireGeneratedProviderLinks().login(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'login' },
    writes: { value: ['messages', 'profiles', 'sessionRevocations', 'sessions'] },
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

export const markReceipt = (() => {
  const callable = (args: MarkReceiptParams): unknown => requireGeneratedProviderLinks().markReceipt(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'markReceipt' },
    writes: { value: ['chats', 'messageReceipts'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const openDm = (() => {
  const callable = (args: OpenDmParams): unknown => requireGeneratedProviderLinks().openDm(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'openDm' },
    writes: { value: ['chatMemberships', 'chats'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const promoteAdmin = (() => {
  const callable = (args: PromoteAdminParams): unknown => requireGeneratedProviderLinks().promoteAdmin(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'promoteAdmin' },
    writes: { value: ['chatMemberships', 'chats'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const removeMember = (() => {
  const callable = (args: RemoveMemberParams): unknown => requireGeneratedProviderLinks().removeMember(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'removeMember' },
    writes: { value: ['chatMemberships', 'chats', 'ephemeralTyping', 'messageReceipts', 'messages'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const sendMessage = (() => {
  const callable = (args: SendMessageParams): unknown => requireGeneratedProviderLinks().sendMessage(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'sendMessage' },
    writes: { value: ['chats', 'ephemeralTyping', 'messageReceipts', 'messages'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setAvatar = (() => {
  const callable = (args: SetAvatarParams): unknown => requireGeneratedProviderLinks().setAvatar(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setAvatar' },
    writes: { value: ['chats', 'profiles', 'search'] },
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
    writes: { value: ['follows', 'profiles'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setLike = (() => {
  const callable = (args: SetLikeParams): unknown => requireGeneratedProviderLinks().setLike(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setLike' },
    writes: { value: ['likes'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setMessageReaction = (() => {
  const callable = (args: SetMessageReactionParams): unknown => requireGeneratedProviderLinks().setMessageReaction(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setMessageReaction' },
    writes: { value: ['messages'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setRepost = (() => {
  const callable = (args: SetRepostParams): unknown => requireGeneratedProviderLinks().setRepost(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setRepost' },
    writes: { value: ['reposts'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const setTyping = (() => {
  const callable = (args: SetTypingParams): unknown => requireGeneratedProviderLinks().setTyping(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'setTyping' },
    writes: { value: ['ephemeralTyping'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const signup = (() => {
  const callable = (args: SignupParams): unknown => requireGeneratedProviderLinks().signup(args);
  Object.defineProperties(callable, {
    kind: { value: 'mutation' },
    name: { value: 'signup' },
    writes: { value: ['accounts', 'messages', 'profiles', 'search', 'sessionRevocations', 'sessions'] },
    optimistic: { value: false },
  });
  return callable as typeof callable & GeneratedMutationBinding;
})();

export const bindings = {
  provider: 'coterie',
  declarationVersion: '8',
  /** Declaration digest as a runtime value (LLP 0391 §4.2 — the fail-closed configure handshake input). */
  inputsHash: 'e0be7bf6f9f5bc27',
  queries: { listChats, listFeed, listInsights, listMessages, listProfilePosts, listProfiles, listProviderClaims, listSession, listThread, observeTyping, searchSocial },
  mutations: { addMember, createGroup, createPost, editProfile, leaveChat, login, logout, markReceipt, openDm, promoteAdmin, removeMember, sendMessage, setAvatar, setChatAccent, setDisappearing, setFollow, setLike, setMessageReaction, setRepost, setTyping, signup },
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
