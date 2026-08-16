// GENERATED types — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie-memory" 1 (inputsHash b99d16d677cfe8b0).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.

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
