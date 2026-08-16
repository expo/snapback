// GENERATED provider/binding contract-meta — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "coterie" 6 (inputsHash 2b035e0c69068f02).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.
import { defineContractModule, mutation, query, shape } from '@exact/contract/exports';

export default defineContractModule('./coterie.bindings.ts', {
  AuthResult: shape({ fields: { sessionToken: 'string', userId: 'string' } }),
  AvatarResult: shape({ fields: { avatarUrl: 'string' } }),
  Chat: shape({ fields: { accentColor: 'string', avatarUrl: 'string | null', disappearing: 'string', id: 'string', isGroup: 'boolean', preview: 'string', title: 'string', unreadCount: 'number', updatedAt: 'string' } }),
  CreatedPost: shape({ fields: { id: 'string' } }),
  FeedItem: shape({ fields: { authorHandle: 'string', authorId: 'string', authorName: 'string', avatarUrl: 'string | null', body: 'string', createdAt: 'string', feedSortAt: 'string', id: 'string', likeCount: 'number', likedByMe: 'boolean', mediaKind: 'string | null', mediaUrls: 'string[]', nextCursor: 'string | null', postId: 'string', replyCount: 'number', repostCount: 'number', repostedByHandle: 'string | null', repostedById: 'string | null', repostedByMe: 'boolean', repostedByName: 'string | null' } }),
  InsightDay: shape({ fields: { day: 'string', id: 'string', likesReceived: 'number', posts: 'number', totalFollowers: 'number', totalFollowing: 'number', totalLikesReceived: 'number', totalPosts: 'number', totalRepliesReceived: 'number', totalRepostsReceived: 'number' } }),
  LogoutMutationResult: shape({ fields: { revokedToken: 'string | null' } }),
  Message: shape({ fields: { body: 'string', chatId: 'string', createdAt: 'string', deleted: 'boolean', edited: 'boolean', id: 'string', mine: 'boolean', quoteText: 'string | null', senderId: 'string', senderName: 'string', status: 'string' } }),
  Profile: shape({ fields: { avatarUrl: 'string | null', bio: 'string', displayName: 'string', followedByMe: 'boolean', followers: 'number', following: 'number', handle: 'string', id: 'string', isMe: 'boolean', link: 'string', location: 'string' } }),
  ProfilePost: shape({ fields: { authorHandle: 'string', authorId: 'string', authorName: 'string', avatarUrl: 'string | null', body: 'string', createdAt: 'string', id: 'string', likeCount: 'number', likedByMe: 'boolean', mediaKind: 'string | null', mediaUrls: 'string[]', postId: 'string', replyCount: 'number', repostCount: 'number', repostedByMe: 'boolean' } }),
  SearchResult: shape({ fields: { avatarUrl: 'string | null', id: 'string', kind: 'string', subtitle: 'string', title: 'string' } }),
  Session: shape({ fields: { expiresAt: 'string', id: 'string', revokedAt: 'string | null', signedIn: 'boolean', token: 'string', userId: 'string' } }),
  ThreadPost: shape({ fields: { authorHandle: 'string', authorId: 'string', authorName: 'string', avatarUrl: 'string | null', body: 'string', createdAt: 'string', id: 'string', likeCount: 'number', likedByMe: 'boolean', mediaKind: 'string | null', mediaUrls: 'string[]', parentId: 'string | null', postId: 'string', replyCount: 'number', repostCount: 'number', repostedByMe: 'boolean', threadRole: 'string' } }),
  listChats: query({
    reads: ['chats'],
    result: 'Chat[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listFeed: query({
    reads: ['follows', 'likes', 'posts', 'profiles', 'reposts'],
    result: 'FeedItem[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listInsights: query({
    reads: ['follows', 'likes', 'posts', 'reposts'],
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
  listProfilePosts: query({
    reads: ['likes', 'posts', 'profiles', 'reposts'],
    result: 'ProfilePost[]',
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
  listThread: query({
    reads: ['likes', 'posts', 'profiles', 'reposts'],
    result: 'ThreadPost[]',
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
    params: { body: 'string', imageRefs: 'Array<string>', parentId: 'string | null', videoRefs: 'Array<string>' },
    effects: ['data:posts'],
    invalidates: ['posts'],
  }),
  editProfile: mutation({
    params: { bio: 'string', displayName: 'string', handle: 'string | null', link: 'string | null', location: 'string | null' },
    effects: ['data:accounts', 'data:messages', 'data:profiles', 'data:search'],
    invalidates: ['accounts', 'messages', 'profiles', 'search'],
  }),
  login: mutation({
    params: { email: 'string', password: 'string' },
    effects: ['data:messages', 'data:profiles', 'data:sessionRevocations', 'data:sessions'],
    invalidates: ['messages', 'profiles', 'sessionRevocations', 'sessions'],
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
    effects: ['data:chats', 'data:profiles', 'data:search'],
    invalidates: ['chats', 'profiles', 'search'],
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
    effects: ['data:follows', 'data:profiles'],
    invalidates: ['follows', 'profiles'],
  }),
  setLike: mutation({
    params: { liked: 'boolean', mutationId: 'string', postId: 'string' },
    effects: ['data:likes'],
    invalidates: ['likes'],
  }),
  setRepost: mutation({
    params: { mutationId: 'string', postId: 'string', reposted: 'boolean' },
    effects: ['data:reposts'],
    invalidates: ['reposts'],
  }),
  signup: mutation({
    params: { displayName: 'string', email: 'string', handle: 'string', password: 'string' },
    effects: ['data:accounts', 'data:messages', 'data:profiles', 'data:search', 'data:sessionRevocations', 'data:sessions'],
    invalidates: ['accounts', 'messages', 'profiles', 'search', 'sessionRevocations', 'sessions'],
  }),
});
