import {
  defineAuth,
  defineSchema,
  defineTable,
  v,
} from '../../_kit/define.mjs';

const authProgram = defineAuth({
  version: 1,
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

export default defineSchema(
  {
    profiles: defineTable({
      ownerId: v.principal(),
      fixtureId: v.optional(v.string()),
      handle: v.string(),
      displayName: v.string(),
      bio: v.string(),
      location: v.string(),
      link: v.string(),
      avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
      avatarSourceDigest: v.optional(v.string()),
    })
      .index('by_owner', ['ownerId'], { unique: true })
      .index('by_fixture_id', ['fixtureId'], { unique: true })
      .index('by_handle', ['handle'], { unique: true })
      .visibility({ kind: 'public-read' })
      .assetSharing({ kind: 'public-read' })
      .sync(),

    posts: defineTable({
      ownerId: v.principal(),
      authorProfileId: v.id('profiles'),
      fixtureId: v.optional(v.string()),
      fixtureDigest: v.optional(v.string()),
      kind: v.string(),
      body: v.string(),
      parentId: v.optional(v.id('posts')),
      parentKey: v.string(),
      isReply: v.boolean(),
      pageKey: v.string(),
      createdAt: v.integer(),
      likeCount: v.integer(),
      repostCount: v.integer(),
      replyCount: v.integer(),
    })
      .index('by_page_key', ['pageKey'], { unique: true })
      .index('by_author_reply_page', ['authorProfileId', 'isReply', 'pageKey'])
      .index('by_parent_page', ['parentKey', 'pageKey'])
      .index('by_fixture_id', ['fixtureId'], { unique: true })
      .visibility({ kind: 'public-read' })
      .sync(),

    postImages: defineTable({
      postId: v.id('posts'),
      position: v.integer(),
      asset: v.assetRef({ upload: 'postImageUpload' }),
      sourceDigest: v.optional(v.string()),
    })
      .index('by_post_position', ['postId', 'position'], { unique: true })
      .visibility({ kind: 'public-read' })
      .assetSharing({ kind: 'public-read' })
      .sync(),

    postVideos: defineTable({
      postId: v.id('posts'),
      asset: v.assetRef({ upload: 'postVideoUpload' }),
      sourceDigest: v.optional(v.string()),
    })
      .index('by_post', ['postId'], { unique: true })
      .visibility({ kind: 'public-read' })
      .assetSharing({ kind: 'public-read' })
      .sync(),

    feedEvents: defineTable({
      eventKind: v.string(),
      sourceKey: v.string(),
      postId: v.id('posts'),
      actorProfileId: v.id('profiles'),
      pageKey: v.string(),
      createdAt: v.integer(),
    })
      .index('by_page_key', ['pageKey'], { unique: true })
      .index('by_actor_page', ['actorProfileId', 'pageKey'])
      .index('by_source_key', ['sourceKey'], { unique: true })
      .visibility({ kind: 'public-read' })
      .sync(),

    follows: defineTable({
      followerId: v.principal(),
      followerProfileId: v.id('profiles'),
      followedProfileId: v.id('profiles'),
      createdAt: v.integer(),
      clientMutationId: v.optional(v.string()),
      fixtureMutationId: v.optional(v.string()),
      fixtureDigest: v.optional(v.string()),
    })
      .index('by_follower', ['followerProfileId'])
      .index('by_followed', ['followedProfileId'])
      .index('by_pair', ['followerProfileId', 'followedProfileId'], { unique: true })
      .visibility({ kind: 'public-read' })
      .sync(),

    likes: defineTable({
      ownerId: v.principal(),
      ownerProfileId: v.id('profiles'),
      postId: v.id('posts'),
      createdAt: v.integer(),
      clientMutationId: v.optional(v.string()),
      fixtureMutationId: v.optional(v.string()),
      fixtureDigest: v.optional(v.string()),
    })
      .index('by_post', ['postId'])
      .index('by_owner', ['ownerProfileId'])
      .index('by_owner_post', ['ownerProfileId', 'postId'], { unique: true })
      .visibility({ kind: 'public-read' })
      .sync(),

    reposts: defineTable({
      ownerId: v.principal(),
      ownerProfileId: v.id('profiles'),
      postId: v.id('posts'),
      pageKey: v.string(),
      createdAt: v.integer(),
      clientMutationId: v.optional(v.string()),
      fixtureMutationId: v.optional(v.string()),
      fixtureDigest: v.optional(v.string()),
    })
      .index('by_post', ['postId'])
      .index('by_owner', ['ownerProfileId'])
      .index('by_owner_post', ['ownerProfileId', 'postId'], { unique: true })
      .index('by_page_key', ['pageKey'], { unique: true })
      .visibility({ kind: 'public-read' })
      .sync(),

    conversations: defineTable({
      ownerId: v.principal(),
      kind: v.string(),
      dmPairKey: v.optional(v.string()),
      fixtureId: v.optional(v.string()),
      fixtureDigest: v.optional(v.string()),
      groupName: v.optional(v.string()),
      groupDescription: v.optional(v.string()),
      creatorProfileId: v.id('profiles'),
      nextEventSequence: v.integer(),
      lastMessageId: v.optional(v.id('messages')),
      lastMessageAt: v.integer(),
      createdAt: v.integer(),
    })
      .index('by_dm_pair', ['dmPairKey'], { unique: true })
      .index('by_fixture_id', ['fixtureId'], { unique: true })
      .index('by_last_message', ['lastMessageAt'])
      .visibility({ kind: 'public-read' }),

    conversationMembers: defineTable({
      ownerId: v.principal(),
      conversationId: v.id('conversations'),
      profileId: v.id('profiles'),
      role: v.string(),
      joinedAt: v.integer(),
      joinedSequence: v.integer(),
      isCurrent: v.boolean(),
      isLatest: v.boolean(),
      removedAt: v.optional(v.integer()),
      removedSequence: v.optional(v.integer()),
      activeKey: v.string(),
      fixtureMutationId: v.optional(v.string()),
      fixtureDigest: v.optional(v.string()),
    })
      .index('by_active_key', ['activeKey'], { unique: true })
      .index('by_current_conversation', ['conversationId', 'isCurrent'])
      .index('by_latest_profile', ['profileId', 'isLatest'])
      .index('by_conversation', ['conversationId'])
      .index('by_profile', ['profileId'])
      .index('by_profile_conversation', ['profileId', 'conversationId', 'joinedSequence'])
      .index('by_fixture_mutation', ['fixtureMutationId'], { unique: true })
      .visibility({ kind: 'public-read' }),

    messages: defineTable({
      ownerId: v.principal(),
      conversationId: v.id('conversations'),
      senderProfileId: v.id('profiles'),
      fixtureId: v.optional(v.string()),
      fixtureDigest: v.optional(v.string()),
      body: v.string(),
      quotedMessageId: v.optional(v.id('messages')),
      recipientCount: v.integer(),
      sequence: v.integer(),
      pageKey: v.string(),
      createdAt: v.integer(),
    })
      .index('by_conversation_page', ['conversationId', 'pageKey'], { unique: true })
      .index('by_fixture_id', ['fixtureId'], { unique: true })
      .index('by_sender_page', ['senderProfileId', 'pageKey'])
      .visibility({ kind: 'public-read' }),

    messageReceipts: defineTable({
      ownerId: v.principal(),
      conversationId: v.id('conversations'),
      messageId: v.id('messages'),
      recipientMemberId: v.id('conversationMembers'),
      recipientProfileId: v.id('profiles'),
      status: v.string(),
      statusRank: v.integer(),
      deliveredAt: v.optional(v.integer()),
      readAt: v.optional(v.integer()),
    })
      .index('by_message', ['messageId'])
      .index('by_message_recipient', ['messageId', 'recipientMemberId'], { unique: true })
      .index('by_recipient_message', ['recipientProfileId', 'messageId'])
      .index('by_conversation_recipient', ['conversationId', 'recipientProfileId'])
      .visibility({ kind: 'public-read' }),
  },
  {
    auth: { mode: 'sessions' },
    authProgram,
  },
);
