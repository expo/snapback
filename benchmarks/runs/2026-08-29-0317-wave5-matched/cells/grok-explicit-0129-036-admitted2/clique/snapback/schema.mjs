import {
  defineAuth,
  defineEphemeral,
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';
import { typing } from './surface-model.mjs';

const authProgram = defineAuth({
  version: 1,
  custody: 'durable-required',
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
      minimumLength: 8,
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

const chatMembers = defineTable({
  chatId: v.id('chats'),
  userId: v.principal(),
  role: v.string(),
  joinedAt: v.optional(v.integer()),
})
  .membership({
    id: 'chatAccess',
    principal: 'userId',
    resource: 'chatId',
    role: 'role',
    roles: ['admin', 'member'],
    bootstrapRole: 'admin',
    lastHolder: { protect: 'admin' },
    provenance: 'full',
    principalAddressedWrites: { remove: true },
    transitions: [
      { op: 'insert', by: ['admin', 'member'], target: 'other', to: ['member'], fields: ['joinedAt'] },
      { op: 'insert', by: ['admin'], target: 'other', to: ['admin'], fields: ['joinedAt'] },
      { op: 'setRole', by: ['admin'], target: 'other', from: ['member'], to: ['admin'] },
      { op: 'remove', by: ['admin'], target: 'other' },
      { op: 'remove', by: ['self'], target: 'self', from: ['admin', 'member'] },
    ],
  })
  .visibility({ kind: 'owner', field: 'userId' })
  .index('by_user', ['userId'])
  .index('by_chat', ['chatId'])
  .sync();

export const profiles = defineTable({
  userId: v.principal(),
  handle: v.string(),
  displayName: v.string(),
  bio: v.string(),
  location: v.string(),
  link: v.string(),
  avatar: v.optional(v.assetRef({ upload: 'publicImageUpload' })),
  followerCount: v.integer(),
  followingCount: v.integer(),
  postCount: v.integer(),
  likesReceived: v.integer(),
  repostsReceived: v.integer(),
  repliesReceived: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_user', ['userId'], { unique: true })
  .index('by_handle', ['handle'], { unique: true })
  .searchIndex('search_people', {
    semanticVersion: 'clique-people.v1',
    textFields: {
      displayName: { weight: 8, classification: 'public' },
      handle: { weight: 8, classification: 'public' },
    },
    fieldClassifications: {
      userId: 'public',
      bio: 'public',
      location: 'public',
      link: 'public',
    },
    storedFields: ['userId', 'displayName', 'handle', 'bio', 'location', 'link'],
    highlightFields: ['displayName', 'handle'],
    visibility: { kind: 'public-read' },
  })
  .assetSharing({ kind: 'public-read' })
  .sync();

export const messages = defineTable({
  clientId: v.string(),
  chatId: v.id('chats'),
  senderId: v.principal(),
  kind: v.string(),
  text: v.string(),
  quoteId: v.optional(v.id('messages')),
  image: v.optional(v.assetRef({ upload: 'publicImageUpload' })),
  video: v.optional(v.assetRef({ upload: 'publicVideoUpload' })),
  viewOnceImage: v.optional(v.assetRef({ upload: 'viewOnceImageUpload' })),
  createdAt: v.integer(),
  editedAt: v.optional(v.integer()),
  tombstoned: v.boolean(),
  expiresAt: v.optional(v.integer()),
  viewOnce: v.boolean(),
})
  .visibility({
    kind: 'membership',
    declaration: chatMembers,
    resourceField: 'chatId',
    roles: ['admin', 'member'],
  })
  .index('by_client', ['clientId'], { unique: true })
  .index('by_chat_created', ['chatId', 'createdAt'])
  .searchIndex('search_messages', {
    semanticVersion: 'clique-messages.v1',
    textFields: {
      text: { weight: 8, classification: 'public' },
    },
    fieldClassifications: {
      chatId: 'public',
      senderId: 'public',
      createdAt: 'public',
      tombstoned: 'public',
    },
    equalityFilters: ['chatId', 'tombstoned'],
    storedFields: ['chatId', 'senderId', 'text', 'createdAt', 'tombstoned'],
    highlightFields: ['text'],
    visibility: {
      kind: 'membership',
      declaration: chatMembers,
      resourceField: 'chatId',
      roles: ['admin', 'member'],
    },
  })
  .assetSharing({ kind: 'membership', membership: 'chatAccess' })
  .sync();

export default defineSchema(
  {
    appSettings: defineTable({
      key: v.string(),
      editWindowMs: v.integer(),
      deleteWindowMs: v.integer(),
      disappear24hMs: v.integer(),
      disappear7dMs: v.integer(),
      digestPeriodMs: v.integer(),
      digestAnchorHourUtc: v.integer(),
      replayMode: v.boolean(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_key', ['key'], { unique: true })
      .sync(),

    profiles,

    follows: defineTable({
      followerId: v.principal(),
      followeeId: v.principal(),
      mutationId: v.string(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_pair', ['followerId', 'followeeId'], { unique: true })
      .index('by_follower', ['followerId'])
      .index('by_followee', ['followeeId'])
      .index('by_mutation', ['mutationId'], { unique: true })
      .sync(),

    posts: defineTable({
      clientId: v.string(),
      authorId: v.principal(),
      kind: v.string(),
      body: v.string(),
      parentId: v.optional(v.id('posts')),
      isReply: v.boolean(),
      likeCount: v.integer(),
      repostCount: v.integer(),
      replyCount: v.integer(),
      createdAt: v.integer(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_client', ['clientId'], { unique: true })
      .index('by_created', ['createdAt'])
      .index('by_author_created', ['authorId', 'createdAt'])
      .index('by_parent', ['parentId', 'createdAt'])
      .sync(),

    postMedia: defineTable({
      postId: v.id('posts'),
      kind: v.string(),
      ord: v.integer(),
      image: v.optional(v.assetRef({ upload: 'publicImageUpload' })),
      video: v.optional(v.assetRef({ upload: 'publicVideoUpload' })),
    })
      .visibility({ kind: 'public-read' })
      .index('by_post', ['postId', 'ord'])
      .assetSharing({ kind: 'public-read' })
      .sync(),

    likes: defineTable({
      postId: v.id('posts'),
      userId: v.principal(),
      mutationId: v.string(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_pair', ['postId', 'userId'], { unique: true })
      .index('by_post', ['postId'])
      .index('by_user', ['userId'])
      .index('by_mutation', ['mutationId'], { unique: true })
      .sync(),

    reposts: defineTable({
      postId: v.id('posts'),
      userId: v.principal(),
      mutationId: v.string(),
      createdAt: v.integer(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_pair', ['postId', 'userId'], { unique: true })
      .index('by_post', ['postId'])
      .index('by_user_created', ['userId', 'createdAt'])
      .index('by_mutation', ['mutationId'], { unique: true })
      .sync(),

    feedEvents: defineTable({
      kind: v.string(),
      postId: v.id('posts'),
      actorId: v.principal(),
      createdAt: v.integer(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_created', ['createdAt'])
      .index('by_actor_created', ['actorId', 'createdAt'])
      .index('by_post_actor', ['postId', 'actorId'])
      .sync(),

    chats: defineTable({
      clientId: v.string(),
      kind: v.string(),
      name: v.string(),
      description: v.string(),
      createdBy: v.principal(),
      accent: v.string(),
      background: v.optional(v.assetRef({ upload: 'publicImageUpload' })),
      disappearing: v.string(),
      lastPreview: v.string(),
      lastMessageAt: v.integer(),
      createdAt: v.integer(),
    })
      .visibility({
        kind: 'membership',
        declaration: chatMembers,
        resourceField: '_id',
        roles: ['admin', 'member'],
      })
      .index('by_client', ['clientId'], { unique: true })
      .index('by_name', ['name'])
      .index('by_updated', ['lastMessageAt'])
      .assetSharing({ kind: 'membership', membership: 'chatAccess' })
      .sync(),

    chatMembers,

    chatRosterRows: defineTable({
      chatId: v.id('chats'),
      userId: v.principal(),
      handle: v.string(),
      displayName: v.string(),
      role: v.string(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_chat', ['chatId'])
      .index('by_chat_handle', ['chatId', 'handle'], { unique: true })
      .sync(),

    chatCuts: defineTable({
      chatId: v.id('chats'),
      userId: v.principal(),
      handle: v.string(),
      cutAt: v.integer(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_chat', ['chatId'])
      .index('by_chat_handle', ['chatId', 'handle'], { unique: true })
      .sync(),

    dmPairs: defineTable({
      userLo: v.principal(),
      userHi: v.principal(),
      chatId: v.id('chats'),
    })
      .visibility({ kind: 'public-read' })
      .index('by_pair', ['userLo', 'userHi'], { unique: true })
      .index('by_chat', ['chatId'], { unique: true })
      .sync(),

    messages,

    receipts: defineTable({
      messageId: v.id('messages'),
      chatId: v.id('chats'),
      userId: v.principal(),
      state: v.string(),
      updatedAt: v.integer(),
    })
      .visibility({
        kind: 'membership',
        declaration: chatMembers,
        resourceField: 'chatId',
        roles: ['admin', 'member'],
      })
      .index('by_message_user', ['messageId', 'userId'], { unique: true })
      .index('by_chat', ['chatId'])
      .sync(),

    messageReactions: defineTable({
      messageId: v.id('messages'),
      chatId: v.id('chats'),
      userId: v.principal(),
      emoji: v.string(),
      mutationId: v.string(),
    })
      .visibility({
        kind: 'membership',
        declaration: chatMembers,
        resourceField: 'chatId',
        roles: ['admin', 'member'],
      })
      .index('by_message_user', ['messageId', 'userId'], { unique: true })
      .index('by_message', ['messageId'])
      .index('by_chat', ['chatId'])
      .index('by_mutation', ['mutationId'], { unique: true })
      .sync(),

    viewOnceViews: defineTable({
      messageId: v.id('messages'),
      userId: v.principal(),
    })
      .visibility({ kind: 'owner', field: 'userId' })
      .index('by_pair', ['messageId', 'userId'], { unique: true })
      .sync(),

    pushLogs: defineTable({
      targetUserId: v.principal(),
      chatId: v.optional(v.id('chats')),
      senderDisplayName: v.string(),
      preview: v.string(),
      kind: v.string(),
      periodStart: v.optional(v.integer()),
      periodEnd: v.optional(v.integer()),
      newFollowers: v.optional(v.integer()),
      newPostsInFollowing: v.optional(v.integer()),
      unreadMessages: v.optional(v.integer()),
      unreadChats: v.optional(v.integer()),
      createdAt: v.integer(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_target_created', ['targetUserId', 'createdAt'])
      .index('by_kind_created', ['kind', 'createdAt'])
      .sync(),

    digestEmissions: defineTable({
      userId: v.principal(),
      periodStart: v.integer(),
      periodEnd: v.integer(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_user_period', ['userId', 'periodStart'], { unique: true })
      .sync(),

    dailyStats: defineTable({
      userId: v.principal(),
      dayUtc: v.integer(),
      postsCreated: v.integer(),
      likesReceived: v.integer(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_user_day', ['userId', 'dayUtc'], { unique: true })
      .sync(),

    externalIds: defineTable({
      kind: v.string(),
      externalId: v.string(),
      internalId: v.string(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_external', ['kind', 'externalId'], { unique: true })
      .index('by_internal', ['kind', 'internalId'])
      .sync(),
  },
  {
    auth: { mode: 'sessions' },
    authProgram,
    ephemeral: defineEphemeral({ typing }),
  },
);
