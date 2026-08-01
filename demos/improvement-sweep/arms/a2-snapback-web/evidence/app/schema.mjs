import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '@expo/snapback-codegen/define';

// Membership-backed channel roster: private channels are bootstrapped with a
// host seat; invited members accept with a self transition. v1's private
// roster posture means no admin kick — see the A2 sweep findings.
export const channelMembers = defineTable({
  channelId: v.id('channels'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'channelMembers',
  principal: 'userId',
  resource: 'channelId',
  role: 'role',
  roles: ['host', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'host',
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['host', 'member'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['invited', 'member'] },
  ],
});

export default defineSchema({
  channels: defineTable({
    name: v.string(),
    visibility: v.string(), // 'public' | 'private'
  })
    .index('by_name', ['name'], { unique: true })
    .sync(),

  messages: defineTable({
    channelId: v.id('channels'),
    authorId: v.principal(),
    authorName: v.string(),
    body: v.string(),
    sentAt: v.integer(),
    clientKey: v.string(),
  })
    .index('by_channel', ['channelId'])
    .index('by_channel_client_key', ['channelId', 'clientKey'], { unique: true })
    .sync(),

  // UI listing mirror of membership seats (NOT authorization — the private
  // channelMembers roster stays the authority; this exists because the
  // declarative membership semi-join cannot bind the resource table's own
  // _id, so "channels I belong to" is otherwise inexpressible).
  channelSeats: defineTable({
    channelId: v.id('channels'),
    userId: v.principal(),
    status: v.string(), // 'host' | 'member' | 'invited'
  })
    .index('by_user', ['userId'])
    .index('by_channel_user', ['channelId', 'userId'], { unique: true })
    .sync(),

  channelReads: defineTable({
    channelId: v.id('channels'),
    userId: v.principal(),
    lastReadVersion: v.integer(),
  })
    .index('by_channel_user', ['channelId', 'userId'], { unique: true })
    .sync(),

  channelMembers,
}, {
  auth: { mode: 'sessions' },
  ephemeral: defineEphemeral({
    chatPresence: ephemeral.collection({
      scope: { channelId: v.string() },
      routing: ['channelId'],
      key: 'connection',
      ttlMs: 10_000,
      maxTtlMs: 30_000,
      maxValueBytes: 256,
      publishRate: { sustainedHz: 5, burst: 10 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({ name: v.string() }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
    chatTyping: ephemeral.collection({
      scope: { channelId: v.string() },
      routing: ['channelId'],
      key: 'connection',
      ttlMs: 3_000,
      maxTtlMs: 5_000,
      maxValueBytes: 256,
      publishRate: { sustainedHz: 5, burst: 10 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({ name: v.string() }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }),
});
