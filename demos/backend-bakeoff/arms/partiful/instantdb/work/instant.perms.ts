import type { InstantRules } from '@instantdb/core';

const rules = {
  $users: {
    allow: {
      view: 'auth.id == data.id',
      create: 'true',
      update: 'false',
      delete: 'false',
    },
    fields: {
      email: 'auth.id == data.id',
    },
  },
  profiles: {
    allow: {
      view: 'auth.id == data.id',
      create: 'auth.id == data.id',
      update: 'auth.id == data.id',
      delete: 'false',
    },
  },
  events: {
    allow: {
      view: 'data.public || canParticipate',
      create: 'auth.id != null && auth.id == data.hostId',
      update: "isHostOrCohost && request.modifiedFields.all(field, field in ['title', 'startsAt', 'guestListVisible', 'public', 'privateHostNote', 'wallPosts'])",
      delete: 'isHost',
    },
    bind: [
      'isHost',
      'auth.id != null && auth.id == data.hostId',
      'isHostOrCohost',
      'auth.id != null && (auth.id == data.hostId || auth.id == data.cohostId)',
      'canParticipate',
      "auth.id != null && (auth.id == data.hostId || auth.id == data.cohostId || auth.id in data.ref('invitations.inviteeId'))",
    ],
    fields: {
      privateHostNote: 'isHostOrCohost',
    },
  },
  invitations: {
    allow: {
      view: 'canSeeGuestList',
      create: 'isHostOrCohost',
      update: "(auth.id == data.inviteeId && auth.id == newData.inviteeId && request.modifiedFields.all(field, field in ['response', 'plusOne', 'updatedAt'])) || (isHostOrCohost && request.modifiedFields.all(field, field == 'guestListVisible'))",
      delete: 'isHostOrCohost',
    },
    bind: [
      'isHostOrCohost',
      "auth.id != null && (auth.id in data.ref('event.hostId') || auth.id in data.ref('event.cohostId'))",
      'canSeeGuestList',
      "auth.id != null && (auth.id in data.ref('event.hostId') || auth.id in data.ref('event.cohostId') || (data.guestListVisible && auth.id in data.ref('event.invitations.inviteeId')))",
    ],
  },
  seatClaims: {
    allow: {
      view: 'canParticipate',
      create: 'auth.id == data.claimantId && canParticipate',
      update: "auth.id == newData.claimantId && canParticipate && request.modifiedFields.all(field, field in ['claimantId', 'claimant', 'occupied', 'claimedAt'])",
      delete: 'auth.id == data.claimantId || isHostOrCohost',
    },
    bind: [
      'isHostOrCohost',
      "auth.id != null && (auth.id in data.ref('event.hostId') || auth.id in data.ref('event.cohostId'))",
      'canParticipate',
      "auth.id != null && (auth.id in data.ref('event.hostId') || auth.id in data.ref('event.cohostId') || auth.id in data.ref('event.invitations.inviteeId'))",
    ],
  },
  wallPosts: {
    allow: {
      view: 'canParticipate',
      create: 'auth.id == data.authorId && canParticipate',
      update: 'false',
      delete: 'auth.id == data.authorId || isHostOrCohost',
    },
    bind: [
      'isHostOrCohost',
      "auth.id != null && (auth.id in data.ref('event.hostId') || auth.id in data.ref('event.cohostId'))",
      'canParticipate',
      "auth.id != null && (auth.id in data.ref('event.hostId') || auth.id in data.ref('event.cohostId') || auth.id in data.ref('event.invitations.inviteeId'))",
    ],
  },
  reminderJobs: {
    allow: { '$default': 'false' },
  },
  notificationAttempts: {
    allow: { '$default': 'false' },
  },
  $files: {
    allow: {
      view: "data.path.startsWith('llp0102-partiful-instantdb-w3-a3/public/') || (auth.id != null && data.path.startsWith('llp0102-partiful-instantdb-w3-a3/protected/' + auth.id + '/'))",
      create: "auth.id != null && data.path.startsWith('llp0102-partiful-instantdb-w3-a3/protected/' + auth.id + '/')",
      delete: "auth.id != null && data.path.startsWith('llp0102-partiful-instantdb-w3-a3/protected/' + auth.id + '/')",
      update: 'false',
    },
  },
} satisfies InstantRules;

export default rules;
