// @ref LLP 0063#next-application-pressure-tests — this executable local
// kernel covers only the green/partial rows in pressure-profile.v1.json; it
// cannot promote STEP6.CHAT.

import { roomMembers } from './schema.mjs';
import schema from './schema.mjs';
import {
  arg,
  asc,
  authUserId,
  defineJsMutation,
  defineLiveQuery,
  eq,
  lit,
  membershipResource,
  results,
  v,
} from '../../_kit/define.mjs';
import {
  defineMembershipKeysetPages,
  defineOwnedKeysetPages,
} from '../../../packages/snapback-codegen/standard-patterns.mjs';

export const listMyRooms = defineLiveQuery({
  auth: 'authenticated',
  table: 'roomParticipants',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('changedAt')],
  index: 'by_user',
});

export const roomDetails = defineLiveQuery({
  auth: 'authenticated',
  table: 'rooms',
  args: { roomId: v.id('rooms') },
  membership: [roomMembers.memberOf(membershipResource.arg('roomId'))],
  filter: [eq('_id', arg('roomId'))],
});

export const roomMessages = defineLiveQuery({
  auth: 'authenticated',
  table: 'messages',
  args: { roomId: v.id('rooms') },
  membership: [roomMembers.memberOf(membershipResource.arg('roomId'))],
  filter: [eq('roomId', arg('roomId'))],
  order: [asc('pageKey')],
  index: 'by_room_page_key',
});

export const unreadDeliveries = defineLiveQuery({
  auth: 'authenticated',
  table: 'deliveries',
  args: {},
  filter: [eq('recipientId', authUserId()), eq('unread', lit(true))],
  order: [asc('pageKey')],
  index: 'by_recipient_page_key',
});

export const {
  firstInboxPage,
  nextInboxPage,
} = defineOwnedKeysetPages({
  table: schema.tables.deliveries,
  names: { first: 'firstInboxPage', next: 'nextInboxPage' },
  index: 'by_recipient_page_key',
  cursorField: 'pageKey',
  visibility: { kind: 'owner', field: 'recipientId' },
  limit: 10,
});

// @ref LLP 0100#4-membership-scoped-keyset-pages — historical room pages
// are callable-only and re-check roomMembers on every page; roomMessages
// remains the separate current-room live view.
export const {
  firstRoomMessagePage,
  nextRoomMessagePage,
} = defineMembershipKeysetPages({
  table: schema.tables.messages,
  names: { first: 'firstRoomMessagePage', next: 'nextRoomMessagePage' },
  membership: {
    declaration: roomMembers,
    resourceArg: 'roomId',
    resourceField: 'roomId',
    roles: ['owner', 'member'],
  },
  index: 'by_room_page_key',
  cursorField: 'pageKey',
  limit: 10,
});

export const createRoom = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string(), displayName: v.string() },
  source: 'handlers.mjs',
  exportName: 'createRoom',
  writes: ['rooms', 'roomMembers', 'roomParticipants'],
});

export const inviteMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    roomId: v.id('rooms'),
    userId: v.principal(),
    displayName: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'inviteMember',
  reads: ['roomMembers', 'roomParticipants'],
  writes: ['roomMembers', 'roomParticipants'],
});

export const acceptInvite = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { roomId: v.id('rooms') },
  source: 'handlers.mjs',
  exportName: 'acceptInvite',
  reads: ['roomParticipants'],
  writes: ['roomMembers', 'roomParticipants'],
});

export const leaveRoom = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { roomId: v.id('rooms') },
  source: 'handlers.mjs',
  exportName: 'leaveRoom',
  reads: ['roomMembers', 'roomParticipants', 'deliveries'],
  writes: ['roomMembers', 'roomParticipants', 'deliveries'],
});

export const ownerRemoveMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { roomId: v.id('rooms'), targetPrincipal: v.principal() },
  source: 'handlers.mjs',
  exportName: 'ownerRemoveMember',
  result: results.value(v.null()),
  reads: ['roomMembers', 'roomParticipants', 'deliveries'],
  writes: ['roomMembers', 'roomParticipants', 'deliveries'],
});

export const sendMessage = defineJsMutation({
  auth: 'authenticated',
  args: { roomId: v.id('rooms'), body: v.string() },
  source: 'handlers.mjs',
  exportName: 'sendMessage',
  reads: ['roomMembers', 'roomParticipants', 'messages'],
  writes: ['messages', 'deliveries'],
});

export const markRoomRead = defineJsMutation({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  source: 'handlers.mjs',
  exportName: 'markRoomRead',
  reads: ['roomMembers', 'deliveries'],
  writes: ['deliveries'],
});
