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

const publicTable = (definition) => definition.visibility({ kind: 'public-read' });
// Fan-out projections are authored by one authenticated actor for multiple
// recipients. Public row visibility admits that server write shape; every
// exported projection query remains authenticated and filters ownerId against
// authUserId(), and every mutation independently checks membership.
const ownedTable = (definition) => definition.visibility({ kind: 'public-read' });

export default defineSchema({
  profiles: publicTable(defineTable({
    ownerId: v.string(),
    email: v.string(),
    handle: v.string(),
    displayName: v.string(),
    bio: v.string(),
    location: v.string(),
    link: v.string(),
    avatarUri: v.string(),
    followerCount: v.integer(),
    followingCount: v.integer(),
    createdAt: v.integer(),
    updatedAt: v.integer(),
  }))
    .index('by_owner', ['ownerId'], { unique: true })
    .index('by_email', ['email'], { unique: true })
    .index('by_handle', ['handle'], { unique: true })
    .index('by_display_name', ['displayName'])
    .sync(),

  follows: publicTable(defineTable({
    edgeKey: v.string(),
    followerId: v.string(),
    followeeId: v.string(),
    followerHandle: v.string(),
    followeeHandle: v.string(),
    createdAt: v.integer(),
  }))
    .index('by_edge', ['edgeKey'], { unique: true })
    .index('by_follower', ['followerId'])
    .index('by_followee', ['followeeId'])
    .sync(),

  posts: publicTable(defineTable({
    externalId: v.string(),
    authorId: v.string(),
    authorHandle: v.string(),
    authorName: v.string(),
    authorAvatarUri: v.string(),
    type: v.string(),
    text: v.string(),
    mediaUri1: v.string(),
    mediaUri2: v.string(),
    parentExternalId: v.string(),
    isReply: v.boolean(),
    likeCount: v.integer(),
    repostCount: v.integer(),
    replyCount: v.integer(),
    createdAt: v.integer(),
    pageKey: v.string(),
  }))
    .index('by_external_id', ['externalId'], { unique: true })
    .index('by_page_key', ['pageKey'])
    .index('by_author_page', ['authorId', 'pageKey'])
    .index('by_parent_page', ['parentExternalId', 'pageKey'])
    .sync(),

  postLikes: publicTable(defineTable({
    edgeKey: v.string(),
    postExternalId: v.string(),
    userId: v.string(),
    userHandle: v.string(),
    createdAt: v.integer(),
  }))
    .index('by_edge', ['edgeKey'], { unique: true })
    .index('by_post', ['postExternalId'])
    .index('by_user', ['userId'])
    .sync(),

  reposts: publicTable(defineTable({
    edgeKey: v.string(),
    postExternalId: v.string(),
    userId: v.string(),
    userHandle: v.string(),
    userName: v.string(),
    createdAt: v.integer(),
    pageKey: v.string(),
  }))
    .index('by_edge', ['edgeKey'], { unique: true })
    .index('by_post', ['postExternalId'])
    .index('by_user_page', ['userId', 'pageKey'])
    .sync(),

  feedEntries: ownedTable(defineTable({
    ownerId: v.string(),
    entryKey: v.string(),
    postExternalId: v.string(),
    projectedAuthorId: v.string(),
    repostedById: v.string(),
    repostedByHandle: v.string(),
    pageKey: v.string(),
  }))
    .index('by_entry', ['entryKey'], { unique: true })
    .index('by_owner_page', ['ownerId', 'pageKey'])
    .index('by_owner_author', ['ownerId', 'projectedAuthorId'])
    .index('by_reposter_post', ['repostedById', 'postExternalId'])
    .sync(),

  conversations: publicTable(defineTable({
    externalId: v.string(),
    dmKey: v.string(),
    kind: v.string(),
    name: v.string(),
    description: v.string(),
    createdBy: v.string(),
    accent: v.string(),
    backgroundUri: v.string(),
    disappearing: v.string(),
    updatedAt: v.integer(),
    createdAt: v.integer(),
  }))
    .index('by_external_id', ['externalId'], { unique: true })
    .index('by_dm_key', ['dmKey'], { unique: true })
    .sync(),

  memberships: publicTable(defineTable({
    edgeKey: v.string(),
    conversationExternalId: v.string(),
    userId: v.string(),
    userHandle: v.string(),
    userName: v.string(),
    avatarUri: v.string(),
    role: v.string(),
    active: v.boolean(),
    joinedAt: v.integer(),
  }))
    .index('by_edge', ['edgeKey'], { unique: true })
    .index('by_conversation', ['conversationExternalId'])
    .index('by_user', ['userId'])
    .sync(),

  inboxes: ownedTable(defineTable({
    ownerId: v.string(),
    inboxKey: v.string(),
    conversationExternalId: v.string(),
    identity: v.string(),
    kind: v.string(),
    title: v.string(),
    description: v.string(),
    counterpartHandle: v.string(),
    avatarUri: v.string(),
    accent: v.string(),
    backgroundUri: v.string(),
    disappearing: v.string(),
    role: v.string(),
    preview: v.string(),
    unreadCount: v.integer(),
    messageCount: v.integer(),
    updatedAt: v.integer(),
    pageKey: v.string(),
  }))
    .index('by_inbox_key', ['inboxKey'], { unique: true })
    .index('by_owner_page', ['ownerId', 'pageKey'])
    .index('by_owner_conversation', ['ownerId', 'conversationExternalId'], { unique: true })
    .index('by_conversation', ['conversationExternalId'])
    .sync(),

  messages: publicTable(defineTable({
    externalId: v.string(),
    conversationExternalId: v.string(),
    senderId: v.string(),
    senderHandle: v.string(),
    senderName: v.string(),
    senderAvatarUri: v.string(),
    type: v.string(),
    text: v.string(),
    mediaUri: v.string(),
    mediaKind: v.string(),
    viewOnce: v.boolean(),
    replyToExternalId: v.string(),
    edited: v.boolean(),
    tombstone: v.boolean(),
    expiresAt: v.integer(),
    sentAt: v.integer(),
    pageKey: v.string(),
  }))
    .index('by_external_id', ['externalId'], { unique: true })
    .index('by_conversation_page', ['conversationExternalId', 'pageKey'])
    .sync(),

  messageViews: ownedTable(defineTable({
    ownerId: v.string(),
    viewKey: v.string(),
    externalId: v.string(),
    conversationExternalId: v.string(),
    senderId: v.string(),
    senderHandle: v.string(),
    senderName: v.string(),
    senderAvatarUri: v.string(),
    type: v.string(),
    text: v.string(),
    mediaUri: v.string(),
    mediaKind: v.string(),
    viewOnce: v.boolean(),
    viewOnceState: v.string(),
    replyToExternalId: v.string(),
    replySenderName: v.string(),
    replyExcerpt: v.string(),
    reactionsJson: v.string(),
    edited: v.boolean(),
    tombstone: v.boolean(),
    receipt: v.string(),
    pending: v.boolean(),
    expiresAt: v.integer(),
    sentAt: v.integer(),
    pageKey: v.string(),
  }))
    .index('by_view_key', ['viewKey'], { unique: true })
    .index('by_owner_conversation_page', ['ownerId', 'conversationExternalId', 'pageKey'])
    .index('by_owner_external', ['ownerId', 'externalId'], { unique: true })
    .index('by_external', ['externalId'])
    .sync(),

  messageSearchViews: ownedTable(defineTable({
    ownerId: v.string(),
    rowKey: v.string(),
    externalId: v.string(),
    conversationExternalId: v.string(),
    senderName: v.string(),
    text: v.string(),
    tombstone: v.boolean(),
    expiresAt: v.integer(),
    sentAt: v.integer(),
  }))
    .index('by_row_key', ['rowKey'], { unique: true })
    .index('by_owner_sent', ['ownerId', 'sentAt'])
    .index('by_external', ['externalId'])
    .sync(),

  reactions: publicTable(defineTable({
    edgeKey: v.string(),
    messageExternalId: v.string(),
    conversationExternalId: v.string(),
    userId: v.string(),
    userHandle: v.string(),
    emoji: v.string(),
    createdAt: v.integer(),
  }))
    .index('by_edge', ['edgeKey'], { unique: true })
    .index('by_message', ['messageExternalId'])
    .sync(),

  notifications: ownedTable(defineTable({
    ownerId: v.string(),
    externalId: v.string(),
    kind: v.string(),
    chatId: v.string(),
    senderDisplayName: v.string(),
    preview: v.string(),
    payloadJson: v.string(),
    createdAt: v.integer(),
  }))
    .index('by_external_id', ['externalId'], { unique: true })
    .index('by_owner_created', ['ownerId', 'createdAt'])
    .sync(),

  insights: ownedTable(defineTable({
    ownerId: v.string(),
    posts: v.integer(),
    likesReceived: v.integer(),
    repostsReceived: v.integer(),
    repliesReceived: v.integer(),
    followers: v.integer(),
    following: v.integer(),
    updatedAt: v.integer(),
  }))
    .index('by_owner', ['ownerId'], { unique: true })
    .sync(),

  activityDays: ownedTable(defineTable({
    ownerId: v.string(),
    dayKey: v.string(),
    rowKey: v.string(),
    posts: v.integer(),
    likesReceived: v.integer(),
  }))
    .index('by_row_key', ['rowKey'], { unique: true })
    .index('by_owner_day', ['ownerId', 'dayKey'])
    .sync(),

  mutationIntents: ownedTable(defineTable({
    ownerId: v.string(),
    mutationId: v.string(),
    intentKey: v.string(),
    result: v.string(),
    createdAt: v.integer(),
  }))
    .index('by_intent_key', ['intentKey'], { unique: true })
    .index('by_owner', ['ownerId'])
    .sync(),
}, {
  auth: { mode: 'sessions' },
  authProgram,
  ephemeral: defineEphemeral({ typing }),
});
