// Team Chat is LLP 0063's Slack/Discord-shaped pressure app. The current
// source is a local non-claiming kernel; pressure-profile.v1.json keeps every
// unimplemented production obligation red.
//
// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — the v2
// relation owns current authority and the deliberately narrow generated
// roster. LLP 0264 requires the installed v1 declarations and their policies
// to remain immutable; no current function reads or writes either legacy
// relation.

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

export const roomMembersV2 = defineTable({
  roomId: v.id('roomsV2'),
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
  id: 'roomMembersV2',
  principal: 'userId',
  resource: 'roomId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['admin', 'member'] },
    { op: 'setRole', by: ['owner'], target: 'other', from: ['member'], to: ['admin'] },
    { op: 'setRole', by: ['owner'], target: 'other', from: ['admin'], to: ['member'] },
    { op: 'remove', by: ['owner'], target: 'other', from: ['admin', 'member', 'invited'] },
  ],
}).authorityProfile({
  name: 'roomMembersV2',
  hierarchy: { owner: ['admin', 'member'], admin: ['member'], member: [] },
  roster: { visible: ['userId', 'role'] },
});
// The canonical authority table declares explicit owner visibility for G2.
// Generated roster reads use the profile-gated host seam; ordinary authored
// ctx.db reads remain restricted to the caller's own membership row.
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
  roomsV2: defineTable({
    title: v.string(),
    createdBy: v.principal(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'createdBy' })
    .sync(),
  roomMembersV2,
  // @ref LLP 0264#d1-one-table-policy-is-the-read-and-write-locus — this installed
  // policy cannot be removed. No current function reads or writes this legacy
  // table; roomMembersV2 is the current product roster and authority relation.
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
  messagesV2: defineTable({
    roomId: v.id('roomsV2'),
    authorId: v.principal(),
    authorName: v.string(),
    body: v.string(),
    pageKey: v.string(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'authorId' })
    .index('by_room_page_key', ['roomId', 'pageKey'])
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
  deliveriesV2: defineTable({
    recipientId: v.principal(),
    roomId: v.id('roomsV2'),
    messageId: v.id('messagesV2'),
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
