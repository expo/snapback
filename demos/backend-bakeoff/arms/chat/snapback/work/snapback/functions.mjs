// LLP 0102 Chat calibration functions. Protected message paths check the
// membership declaration inside every handler.

import {
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  v,
} from '../../../../../../_kit/define.mjs';

const channelShape = v.object({
  slug: v.string(),
  name: v.string(),
  visibility: v.string(),
  createdBy: v.string(),
  createdAt: v.integer(),
  nextSequence: v.integer(),
});

const messageShape = v.object({
  channelId: v.string(),
  sequence: v.integer(),
  authorId: v.string(),
  authorName: v.string(),
  body: v.string(),
  sentAt: v.integer(),
});

const markerShape = v.object({
  channelId: v.string(),
  userId: v.string(),
  lastReadSequence: v.integer(),
});

export const listChannels = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  source: 'handlers.mjs',
  exportName: 'listChannels',
  reads: ['channels', 'channelViews'],
  result: channelShape,
});

export const listMessages = defineJsLiveQuery({
  auth: 'authenticated',
  args: { channelId: v.id('channels') },
  source: 'handlers.mjs',
  exportName: 'listMessages',
  reads: ['channels', 'channelMembers', 'messages'],
  result: messageShape,
});

export const pageMessages = defineJsQuery({
  auth: 'authenticated',
  args: {
    channelId: v.id('channels'),
    beforeSequence: v.optional(v.integer()),
    limit: v.integer(),
  },
  source: 'handlers.mjs',
  exportName: 'pageMessages',
  reads: ['channels', 'channelMembers', 'messages'],
  result: messageShape,
});

export const listReadMarkers = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  source: 'handlers.mjs',
  exportName: 'listReadMarkers',
  reads: ['readMarkers'],
  result: markerShape,
});

export const bootstrapChannel = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    slug: v.string(),
    name: v.string(),
    visibility: v.string(),
    bobId: v.principal(),
  },
  source: 'handlers.mjs',
  exportName: 'bootstrapChannel',
  reads: ['profiles'],
  writes: ['channels', 'channelMembers', 'channelViews', 'profiles', 'messages', 'readMarkers'],
});

export const addMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    channelId: v.id('channels'),
    userId: v.principal(),
  },
  source: 'handlers.mjs',
  exportName: 'addMember',
  reads: ['channelMembers', 'channelViews'],
  writes: ['channelMembers', 'channelViews'],
});

export const leaveChannel = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { channelId: v.id('channels') },
  source: 'handlers.mjs',
  exportName: 'leaveChannel',
  reads: ['channelViews'],
  writes: ['channelMembers', 'channelViews'],
});

export const sendMessage = defineJsMutation({
  auth: 'authenticated',
  args: {
    channelId: v.id('channels'),
    body: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'sendMessage',
  reads: ['channels', 'channelMembers', 'profiles'],
  writes: ['channels', 'messages'],
});

export const markRead = defineJsMutation({
  auth: 'authenticated',
  args: {
    channelId: v.id('channels'),
    sequence: v.integer(),
  },
  source: 'handlers.mjs',
  exportName: 'markRead',
  reads: ['channels', 'channelMembers', 'readMarkers'],
  writes: ['readMarkers'],
});
