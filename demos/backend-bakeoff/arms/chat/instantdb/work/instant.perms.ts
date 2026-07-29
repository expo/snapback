import type { InstantRules } from '@instantdb/core';

const rules = {
  $users: {
    allow: {
      view:
        "auth.id != null && (auth.id == data.id || auth.id in data.ref('allowedChannels.ownerId'))",
      create: 'true',
      update:
        "auth.id != null && auth.id in data.ref('allowedChannels.ownerId') && request.modifiedFields.all(field, field == 'allowedChannels')",
      delete: 'false',
    },
    fields: {
      email: 'auth.id != null && auth.id == data.id',
    },
  },
  channels: {
    allow: {
      view: 'canView',
      create: 'auth.id != null && auth.id == data.ownerId',
      update:
        "auth.id != null && (auth.id == data.ownerId || (canView && request.modifiedFields.all(field, !(field in ['name', 'visibility', 'ownerId', 'allowedUsers']))))",
      delete: 'auth.id != null && auth.id == data.ownerId',
    },
    bind: [
      'canView',
      "auth.id != null && (data.visibility == 'public' || auth.id in data.ref('allowedUsers.id'))",
    ],
  },
  messages: {
    allow: {
      view: 'canViewChannel',
      create: 'auth.id != null && auth.id == data.authorId',
      update: 'false',
      delete: 'false',
    },
    bind: [
      'canViewChannel',
      "auth.id != null && ('public' in data.ref('channel.visibility') || auth.id in data.ref('channel.allowedUsers.id'))",
    ],
  },
  readMarkers: {
    allow: {
      view: 'auth.id != null && auth.id == data.userId',
      create: 'auth.id != null && auth.id == data.userId',
      update:
        'auth.id != null && auth.id == data.userId && auth.id == newData.userId',
      delete: 'auth.id != null && auth.id == data.userId',
    },
  },
} satisfies InstantRules;

export default rules;
