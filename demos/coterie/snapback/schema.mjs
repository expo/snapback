import {
  allow,
  defineAuth,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
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
      chatPageKey: v.string(),
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
      chatPageKey: v.string(),
      unreadCount: v.integer(),
      receiptCount: v.integer(),
      deliveredThroughSequence: v.integer(),
      readThroughSequence: v.integer(),
      fixtureMutationId: v.optional(v.string()),
      fixtureDigest: v.optional(v.string()),
    })
      .index('by_active_key', ['activeKey'], { unique: true })
      .index('by_current_conversation', ['conversationId', 'isCurrent'])
      .index('by_latest_profile', ['profileId', 'isLatest'])
      .index('by_profile_latest_chat_page', ['profileId', 'isLatest', 'chatPageKey'])
      .index('by_conversation', ['conversationId'])
      .index('by_profile', ['profileId'])
      .index('by_profile_conversation', ['profileId', 'conversationId', 'joinedSequence'])
      .index('by_fixture_mutation', ['fixtureMutationId'], { unique: true })
      .visibility({ kind: 'public-read' }),

    // Current authorization and historical product facts deliberately live in
    // different tables. `conversationMembers` keeps every incarnation for
    // receipt obligations and removal cutoffs; one row here means the
    // principal is a member now. Its sole role encodes current access, while
    // group-admin product semantics remain on the incarnation row.
    // @ref LLP 0056#declaring-a-membership-table — protected-room authority is
    // one canonical current principal/resource/role row, never an isCurrent
    // flag on an incarnation-history row.
    conversationCurrentMembers: defineTable({
      ownerId: v.principal(),
      conversationId: v.id('conversations'),
      role: v.string(),
    })
      .index('by_conversation', ['conversationId'])
      .index('by_owner', ['ownerId'])
      .index('by_owner_conversation', ['ownerId', 'conversationId'], { unique: true })
      .visibility({ kind: 'owner', field: 'ownerId' })
      .membership({
        id: 'conversationCurrentMembers',
        principal: 'ownerId',
        resource: 'conversationId',
        role: 'role',
        roles: ['member'],
        bootstrapRole: 'member',
        provenance: 'full',
        principalAddressedWrites: { remove: true },
        transitions: [
          { op: 'insert', by: ['member'], target: 'other', to: ['member'] },
          // Total removal is required for the private principal-addressed
          // command. Product-level group-admin admission happens before it.
          { op: 'remove', by: ['member'], target: 'other' },
          { op: 'remove', by: ['self'], target: 'self', from: ['member'] },
        ],
      }),

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
    ephemeral: defineEphemeral({
      typing: ephemeral.collection({
        scope: { conversationId: v.id('conversations') },
        routing: ['conversationId'],
        key: 'connection',
        ttlMs: 5_000,
        maxTtlMs: 5_000,
        maxValueBytes: 256,
        publishRate: { sustainedHz: 5, burst: 10 },
        delivery: { mode: 'latest', dispatchMs: 100 },
        value: v.object({
          profileId: v.id('profiles'),
          userId: v.string(),
          displayName: v.string(),
        }),
        // @ref LLP 0013#lowering-and-one-validator-convergence — subscribe and
        // publish bind the same complete active-role set from the canonical
        // current-membership declaration.
        publish: allow.members('conversationCurrentMembers'),
        subscribe: allow.members('conversationCurrentMembers'),
      }),
    }),
  },
);
