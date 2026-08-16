// GENERATED provider/binding contract-meta — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie-memory" 1 (inputsHash b99d16d677cfe8b0).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.
import { defineContractModule, mutation, query, shape } from '@exact/contract/exports';

export default defineContractModule('./coterie-memory.bindings.ts', {
  Chat: shape({ fields: { accentColor: 'string', avatarUrl: 'string | null', id: 'string', isGroup: 'boolean', preview: 'string', title: 'string', unreadCount: 'number', updatedAt: 'string' } }),
  FeedItem: shape({ fields: { authorHandle: 'string', authorId: 'string', authorName: 'string', avatarUrl: 'string | null', body: 'string', createdAt: 'string', id: 'string', likeCount: 'number', likedByMe: 'boolean', mediaKind: 'string | null', mediaUrl: 'string | null', pollQuestion: 'string | null', replyCount: 'number', repostCount: 'number' } }),
  InsightDay: shape({ fields: { day: 'string', engagements: 'number', id: 'string', views: 'number' } }),
  Message: shape({ fields: { attachmentKind: 'string | null', attachmentUrl: 'string | null', body: 'string', chatId: 'string', createdAt: 'string', deleted: 'boolean', edited: 'boolean', id: 'string', mine: 'boolean', quoteText: 'string | null', reaction: 'string | null', senderId: 'string', senderName: 'string', status: 'string', viewOnce: 'boolean' } }),
  PollOption: shape({ fields: { id: 'string', label: 'string', postId: 'string', selectedByMe: 'boolean', votes: 'number' } }),
  Profile: shape({ fields: { avatarUrl: 'string | null', bio: 'string', displayName: 'string', followedByMe: 'boolean', followers: 'number', following: 'number', handle: 'string', id: 'string', isMe: 'boolean' } }),
  SearchResult: shape({ fields: { avatarUrl: 'string | null', id: 'string', kind: 'string', subtitle: 'string', title: 'string' } }),
  Session: shape({ fields: { id: 'string', signedIn: 'boolean', userId: 'string' } }),
  TrendingTopic: shape({ fields: { id: 'string', label: 'string', postCount: 'number', rank: 'number' } }),
  listChats: query({
    reads: ['chats'],
    result: 'Chat[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listFeed: query({
    reads: ['posts'],
    result: 'FeedItem[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listInsights: query({
    reads: ['insights'],
    result: 'InsightDay[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listMessages: query({
    reads: ['messages'],
    result: 'Message[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listPollOptions: query({
    reads: ['pollOptions'],
    result: 'PollOption[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listProfiles: query({
    reads: ['profiles'],
    result: 'Profile[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listSession: query({
    reads: ['sessions'],
    result: 'Session[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listTrending: query({
    reads: ['trends'],
    result: 'TrendingTopic[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  searchSocial: query({
    reads: ['search'],
    result: 'SearchResult[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  createPost: mutation({
    params: { body: 'string' },
    effects: ['data:posts'],
    invalidates: ['posts'],
  }),
  editProfile: mutation({
    params: { bio: 'string', displayName: 'string' },
    effects: ['data:profiles'],
    invalidates: ['profiles'],
  }),
  login: mutation({
    params: { email: 'string', password: 'string' },
    effects: ['data:sessions'],
    invalidates: ['sessions'],
  }),
  logout: mutation({
    params: {  },
    effects: ['data:sessions'],
    invalidates: ['sessions'],
  }),
  sendMessage: mutation({
    params: { body: 'string', chatId: 'string' },
    effects: ['data:chats', 'data:messages'],
    invalidates: ['chats', 'messages'],
  }),
  toggleFollow: mutation({
    params: { userId: 'string' },
    effects: ['data:profiles'],
    invalidates: ['profiles'],
  }),
  toggleLike: mutation({
    params: { postId: 'string' },
    effects: ['data:posts'],
    invalidates: ['posts'],
  }),
  votePoll: mutation({
    params: { optionId: 'string', postId: 'string' },
    effects: ['data:pollOptions'],
    invalidates: ['pollOptions'],
  }),
});
