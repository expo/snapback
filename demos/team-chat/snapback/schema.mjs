// Team Chat is LLP 0063's Slack/Discord-shaped pressure app. The current
// source is a local non-claiming kernel; pressure-profile.v1.json keeps every
// unimplemented production obligation red.
//
// @ref LLP 0056#declaring-a-membership-table — roomMembers is private
// authorization backing. roomParticipants is display/fan-out data, never a
// permission oracle.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export const roomMembers = defineTable({
  roomId: v.id('rooms'),
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
  id: 'roomMembers',
  principal: 'userId',
  resource: 'roomId',
  role: 'role',
  roles: ['owner', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  principalAddressedWrites: { remove: true },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['invited', 'member'] },
    { op: 'remove', by: ['owner'], target: 'other' },
  ],
});
export default defineSchema({
  rooms: defineTable({
    title: v.string(),
    createdBy: v.principal(),
    createdAt: v.integer(),
  })
    .visibility({
      kind: 'membership',
      declaration: roomMembers,
      resourceField: '_id',
      roles: ['owner', 'member'],
    })
    .sync(),
  roomMembers,
  roomParticipants: defineTable({
    roomId: v.id('rooms'),
    userId: v.principal(),
    displayName: v.string(),
    status: v.string(),
    changedAt: v.integer(),
  })
    .visibility({
      kind: 'any-of',
      arms: [
        { kind: 'owner', field: 'userId' },
        {
          kind: 'membership',
          declaration: roomMembers,
          resourceField: 'roomId',
          roles: ['owner', 'member'],
        },
      ],
    })
    .index('by_room', ['roomId'])
    .index('by_user', ['userId'])
    .index('by_room_user', ['roomId', 'userId'], { unique: true })
    .sync(),
  messages: defineTable({
    roomId: v.id('rooms'),
    authorId: v.principal(),
    authorName: v.string(),
    body: v.string(),
    pageKey: v.string(),
    createdAt: v.integer(),
  })
    .visibility({
      kind: 'membership',
      declaration: roomMembers,
      resourceField: 'roomId',
      roles: ['owner', 'member'],
    })
    .index('by_room_page_key', ['roomId', 'pageKey'], { unique: true })
    .sync(),
  deliveries: defineTable({
    recipientId: v.principal(),
    roomId: v.id('rooms'),
    messageId: v.id('messages'),
    authorId: v.principal(),
    authorName: v.string(),
    body: v.string(),
    pageKey: v.string(),
    createdAt: v.integer(),
    unread: v.boolean(),
  })
    .visibility({ kind: 'owner', field: 'recipientId' })
    .index('by_recipient_page_key', ['recipientId', 'pageKey'], { unique: true })
    .index('by_recipient_room', ['recipientId', 'roomId'])
    .index('by_message_recipient', ['messageId', 'recipientId'], { unique: true })
    .sync(),
});
