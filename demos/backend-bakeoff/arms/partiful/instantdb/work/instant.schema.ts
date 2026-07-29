import { i } from '@instantdb/core';

const schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    profiles: i.entity({
      email: i.string().unique().indexed(),
      displayName: i.string(),
    }),
    events: i.entity({
      slug: i.string().unique().indexed(),
      title: i.string(),
      startsAt: i.date().indexed(),
      capacity: i.number(),
      guestListVisible: i.boolean(),
      public: i.boolean().indexed(),
      hostId: i.string().indexed(),
      cohostId: i.string().indexed().optional(),
      privateHostNote: i.string().optional(),
    }),
    invitations: i.entity({
      key: i.string().unique().indexed(),
      eventId: i.string().indexed(),
      inviteeId: i.string().indexed(),
      role: i.string().indexed(),
      response: i.string().indexed(),
      plusOne: i.number(),
      guestListVisible: i.boolean().indexed(),
      updatedAt: i.date(),
    }),
    seatClaims: i.entity({
      seatKey: i.string().unique().indexed(),
      eventId: i.string().indexed(),
      claimantId: i.string().indexed(),
      occupied: i.boolean().indexed(),
      claimedAt: i.date(),
    }),
    wallPosts: i.entity({
      nonce: i.string().unique().indexed(),
      eventId: i.string().indexed(),
      authorId: i.string().indexed(),
      body: i.string(),
      createdAt: i.date().indexed(),
    }),
    reminderJobs: i.entity({
      dedupeKey: i.string().unique().indexed(),
      eventId: i.string().indexed(),
      dueAt: i.date().indexed(),
      status: i.string().indexed(),
      attemptCount: i.number(),
    }),
    notificationAttempts: i.entity({
      attemptKey: i.string().unique().indexed(),
      eventId: i.string().indexed(),
      outcome: i.string().indexed(),
      providerIdempotencyKey: i.string().indexed(),
      attemptedAt: i.date(),
    }),
  },
  links: {
    profileUser: {
      forward: { on: 'profiles', has: 'one', label: 'user' },
      reverse: { on: '$users', has: 'one', label: 'profile' },
    },
    eventHost: {
      forward: { on: 'events', has: 'one', label: 'host' },
      reverse: { on: '$users', has: 'many', label: 'hostedEvents' },
    },
    eventCohost: {
      forward: { on: 'events', has: 'one', label: 'cohost' },
      reverse: { on: '$users', has: 'many', label: 'cohostedEvents' },
    },
    eventInvitations: {
      forward: { on: 'events', has: 'many', label: 'invitations' },
      reverse: { on: 'invitations', has: 'one', label: 'event' },
    },
    invitationUser: {
      forward: { on: 'invitations', has: 'one', label: 'invitee' },
      reverse: { on: '$users', has: 'many', label: 'invitations' },
    },
    eventSeatClaims: {
      forward: { on: 'events', has: 'many', label: 'seatClaims' },
      reverse: { on: 'seatClaims', has: 'one', label: 'event' },
    },
    seatClaimUser: {
      forward: { on: 'seatClaims', has: 'one', label: 'claimant' },
      reverse: { on: '$users', has: 'many', label: 'seatClaims' },
    },
    eventWallPosts: {
      forward: { on: 'events', has: 'many', label: 'wallPosts' },
      reverse: { on: 'wallPosts', has: 'one', label: 'event' },
    },
    wallPostAuthor: {
      forward: { on: 'wallPosts', has: 'one', label: 'author' },
      reverse: { on: '$users', has: 'many', label: 'wallPosts' },
    },
  },
});

export default schema;
