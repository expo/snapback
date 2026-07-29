// LLP 0102 Chat calibration: membership-gated durable channels and native
// TTL-bound transient activity.
//
// @ref LLP 0056#invalidation-the-llp-0053-mapping — channel membership is
// authorization backing, so leaves invalidate protected live queries.
// @ref LLP 0013#proposal — typing and presence are ephemeral room state, not
// durable message rows.

import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '../../../../../../_kit/define.mjs';

export const channelMembers = defineTable({
  channelId: v.id('channels'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'channelMembers',
  principal: 'userId',
  resource: 'channelId',
  role: 'role',
  roles: ['owner', 'member'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['member'] },
  ],
});

export default defineSchema({
  channels: defineTable({
    slug: v.string(),
    name: v.string(),
    visibility: v.string(),
    createdBy: v.principal(),
    createdAt: v.integer(),
    nextSequence: v.integer(),
  })
    .index('by_slug', ['slug'], { unique: true })
    .sync(),
  channelMembers,
  channelViews: defineTable({
    channelId: v.id('channels'),
    userId: v.principal(),
  })
    .index('by_user_channel', ['userId', 'channelId'], { unique: true })
    .sync(),
  profiles: defineTable({
    userId: v.principal(),
    displayName: v.string(),
  })
    .index('by_user', ['userId'], { unique: true })
    .sync(),
  messages: defineTable({
    channelId: v.id('channels'),
    sequence: v.integer(),
    authorId: v.principal(),
    authorName: v.string(),
    body: v.string(),
    sentAt: v.integer(),
  })
    .index('by_channel_sequence', ['channelId', 'sequence'], { unique: true })
    .sync(),
  readMarkers: defineTable({
    channelId: v.id('channels'),
    userId: v.principal(),
    lastReadSequence: v.integer(),
  })
    .index('by_user_channel', ['userId', 'channelId'], { unique: true })
    .sync(),
}, {
  auth: { mode: 'sessions' },
  ephemeral: defineEphemeral({
    typing: ephemeral.collection({
      scope: { channelId: v.string() },
      routing: ['channelId'],
      key: 'user',
      ttlMs: 1_500,
      maxTtlMs: 5_000,
      maxValueBytes: 256,
      publishRate: { sustainedHz: 4, burst: 8 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({
        name: v.string(),
        active: v.boolean(),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
    presence: ephemeral.collection({
      scope: { channelId: v.string() },
      routing: ['channelId'],
      key: 'connection',
      ttlMs: 2_000,
      maxTtlMs: 5_000,
      maxValueBytes: 256,
      publishRate: { sustainedHz: 4, burst: 8 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({
        name: v.string(),
        state: v.string(),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }),
});
