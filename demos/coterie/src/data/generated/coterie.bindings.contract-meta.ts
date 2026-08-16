// GENERATED provider/binding contract-meta — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie" 4 (inputsHash e55f0d450e11b583).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.
import { defineContractModule, mutation, query, shape } from '@exact/contract/exports';

export default defineContractModule('./coterie.bindings.ts', {
  AuthResult: shape({ fields: { sessionToken: 'string', userId: 'string' } }),
  AvatarResult: shape({ fields: { avatarUrl: 'string' } }),
  Chat: shape({ fields: { accentColor: 'string', avatarUrl: 'string | null', disappearing: 'string', id: 'string', isGroup: 'boolean', preview: 'string', title: 'string', unreadCount: 'number', updatedAt: 'string' } }),
  FeedItem: shape({ fields: { authorHandle: 'string', authorId: 'string', authorName: 'string', avatarUrl: 'string | null', body: 'string', createdAt: 'string', id: 'string', likeCount: 'number', likedByMe: 'boolean', mediaKind: 'string | null', mediaUrl: 'string | null', pollQuestion: 'string | null', replyCount: 'number', repostCount: 'number' } }),
  InsightDay: shape({ fields: { day: 'string', id: 'string', likesReceived: 'number', posts: 'number', totalFollowers: 'number', totalFollowing: 'number', totalLikesReceived: 'number', totalPosts: 'number', totalRepliesReceived: 'number', totalRepostsReceived: 'number' } }),
  LogoutMutationResult: shape({ fields: { revokedToken: 'string | null' } }),
  Message: shape({ fields: { body: 'string', chatId: 'string', createdAt: 'string', deleted: 'boolean', edited: 'boolean', id: 'string', mine: 'boolean', quoteText: 'string | null', senderId: 'string', senderName: 'string', status: 'string' } }),
  Profile: shape({ fields: { avatarUrl: 'string | null', bio: 'string', displayName: 'string', followedByMe: 'boolean', followers: 'number', following: 'number', handle: 'string', id: 'string', isMe: 'boolean', link: 'string', location: 'string' } }),
  SearchResult: shape({ fields: { avatarUrl: 'string | null', id: 'string', kind: 'string', subtitle: 'string', title: 'string' } }),
  Session: shape({ fields: { expiresAt: 'string', id: 'string', revokedAt: 'string | null', signedIn: 'boolean', token: 'string', userId: 'string' } }),
  listChats: query({
    reads: ['chats'],
    result: 'Chat[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listFeed: query({
    reads: ['follows', 'posts'],
    result: 'FeedItem[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listInsights: query({
    reads: ['follows', 'posts'],
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
    params: { bio: 'string', displayName: 'string', handle: 'string | null', link: 'string | null', location: 'string | null' },
    effects: ['data:accounts', 'data:messages', 'data:posts', 'data:profiles', 'data:search'],
    invalidates: ['accounts', 'messages', 'posts', 'profiles', 'search'],
  }),
  login: mutation({
    params: { email: 'string', password: 'string' },
    effects: ['data:messages', 'data:posts', 'data:profiles', 'data:sessionRevocations', 'data:sessions'],
    invalidates: ['messages', 'posts', 'profiles', 'sessionRevocations', 'sessions'],
  }),
  logout: mutation({
    params: {  },
    effects: ['data:sessionRevocations', 'data:sessions'],
    invalidates: ['sessionRevocations', 'sessions'],
  }),
  sendMessage: mutation({
    params: { body: 'string', chatId: 'string' },
    effects: ['data:chats', 'data:messages'],
    invalidates: ['chats', 'messages'],
  }),
  setAvatar: mutation({
    params: { avatarRef: 'string' },
    effects: ['data:posts', 'data:profiles', 'data:search'],
    invalidates: ['posts', 'profiles', 'search'],
  }),
  setChatAccent: mutation({
    params: { chatId: 'string', color: 'string', mutationId: 'string' },
    effects: ['data:chats'],
    invalidates: ['chats'],
  }),
  setDisappearing: mutation({
    params: { chatId: 'string', mutationId: 'string', value: 'string' },
    effects: ['data:chats'],
    invalidates: ['chats'],
  }),
  setFollow: mutation({
    params: { following: 'boolean', mutationId: 'string', userId: 'string' },
    effects: ['data:follows', 'data:posts', 'data:profiles'],
    invalidates: ['follows', 'posts', 'profiles'],
  }),
  setLike: mutation({
    params: { liked: 'boolean', mutationId: 'string', postId: 'string' },
    effects: ['data:posts'],
    invalidates: ['posts'],
  }),
  signup: mutation({
    params: { displayName: 'string', email: 'string', handle: 'string', password: 'string' },
    effects: ['data:accounts', 'data:messages', 'data:posts', 'data:profiles', 'data:search', 'data:sessionRevocations', 'data:sessions'],
    invalidates: ['accounts', 'messages', 'posts', 'profiles', 'search', 'sessionRevocations', 'sessions'],
  }),
});
