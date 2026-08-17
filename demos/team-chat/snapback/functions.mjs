// @ref LLP 0063#next-application-pressure-tests — this executable local
// kernel covers only the green/partial rows in pressure-profile.v1.json; it
// cannot promote STEP6.CHAT.

import { roomMembersV2 } from './schema.mjs';
import schema from './schema.mjs';
import {
  asc,
  authUserId,
  defineJsMutation,
  defineLiveQuery,
  eq,
  lit,
  v,
} from '../../_kit/define.mjs';
import {
  defineOwnedKeysetPages,
} from '../../../packages/snapback-codegen/standard-patterns.mjs';

export const unreadDeliveries = defineLiveQuery({
  auth: 'authenticated',
  table: 'deliveriesV2',
  args: {},
  filter: [eq('recipientId', authUserId()), eq('unread', lit(true))],
  order: [asc('pageKey')],
  index: 'by_recipient_page_key',
});

export const {
  firstInboxPage,
  nextInboxPage,
} = defineOwnedKeysetPages({
  table: schema.tables.deliveriesV2,
  names: { first: 'firstInboxPage', next: 'nextInboxPage' },
  index: 'by_recipient_page_key',
  cursorField: 'pageKey',
  visibility: { kind: 'owner', field: 'recipientId' },
  limit: 10,
});

export const createRoom = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string(), displayName: v.optional(v.string()) },
  source: 'handlers.mjs',
  exportName: 'createRoom',
  writes: ['roomsV2', 'roomMembersV2'],
});

export const sendMessage = defineJsMutation({
  auth: 'authenticated',
  args: { roomId: v.id('roomsV2'), body: v.string() },
  source: 'handlers.mjs',
  exportName: 'sendMessage',
  reads: ['roomMembersV2', 'messagesV2'],
  writes: ['messagesV2', 'deliveriesV2'],
});

export const markRoomRead = defineJsMutation({
  auth: 'authenticated',
  args: { roomId: v.id('roomsV2') },
  source: 'handlers.mjs',
  exportName: 'markRoomRead',
  reads: ['roomMembersV2', 'deliveriesV2'],
  writes: ['deliveriesV2'],
});
