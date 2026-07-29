import {
  defineAction,
  defineConfig,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  v,
} from '@snapback/codegen/define';

// @ref LLP 0102#app-4-partiful-shaped-event-application — provider-native
// declarations converge on the frozen event, authority, realtime, schedule,
// effect, and explicit-GAP facts without a cross-provider abstraction.

const eventResult = v.object({
  eventId: v.id('events'),
  slug: v.string(),
  title: v.string(),
  description: v.string(),
  location: v.optional(v.string()),
  startsAt: v.integer(),
  capacity: v.optional(v.integer()),
  attendanceCount: v.optional(v.integer()),
  guestListVisibility: v.optional(v.string()),
  role: v.optional(v.string()),
  revision: v.integer(),
});

export const appConfig = defineConfig({
  notificationToken: {
    description: 'Bearer token for the deterministic notification boundary',
    purpose: 'Authenticates provider-style notification actions without exposing the value to clients',
    required: false,
    pool: false,
    howToGet: 'Acceptance-only arm-local token.',
  },
});

export const publicEvents = defineJsLiveQuery({
  args: { namespace: v.string() },
  source: 'handlers.mjs',
  exportName: 'publicEvents',
  reads: ['events'],
  result: eventResult,
});

for (const [name, exportName, reads, result] of [
  ['privateControls', 'privateControls', ['events', 'invitations'], eventResult],
  ['guestList', 'guestList', ['events', 'invitations', 'rsvps'], v.object({
    userId: v.string(), guestName: v.string(), role: v.string(), response: v.string(), plusOneCount: v.integer(), seats: v.integer(),
  })],
  ['eventWall', 'eventWall', ['events', 'invitations', 'posts'], v.object({
    authorId: v.string(), authorName: v.string(), body: v.string(), ordinal: v.integer(),
  })],
  ['reminderLedger', 'reminderLedger', ['events', 'invitations', 'reminderAttempts'], v.object({
    deliveryKey: v.string(), trigger: v.string(), attemptCount: v.integer(), status: v.string(),
  })],
  ['effectLedger', 'effectLedger', ['events', 'invitations', 'notificationEffects'], v.object({
    idempotencyKey: v.string(), attemptCount: v.integer(), status: v.string(), certainty: v.string(), providerReceipt: v.optional(v.string()),
  })],
  ['fixtureAudit', 'fixtureAudit', ['events', 'invitations', 'rsvps', 'posts'], v.object({
    eventCount: v.integer(), contendedAttendance: v.integer(), contendedRsvps: v.integer(),
    activeInvitations: v.integer(), wallPosts: v.integer(),
  })],
]) {
  // The declarations stay explicit in the generated manifest even though the
  // compact source loop avoids five copies of the same trusted envelope.
  globalThis[name] = defineJsLiveQuery({
    args: { eventId: v.id('events') },
    source: 'handlers.mjs',
    exportName,
    reads,
    auth: 'authenticated',
    result,
  });
}
export const privateControls = globalThis.privateControls;
export const guestList = globalThis.guestList;
export const eventWall = globalThis.eventWall;
export const reminderLedger = globalThis.reminderLedger;
export const effectLedger = globalThis.effectLedger;
export const fixtureAudit = globalThis.fixtureAudit;

const mutation = (exportName, args, reads, writes, extra = {}) => defineJsMutation({
  args,
  source: 'handlers.mjs',
  exportName,
  reads,
  writes,
  auth: 'authenticated',
  ...extra,
});

export const setupFixture = mutation('setupFixture', {
  namespace: v.string(),
  bobId: v.string(),
  carolId: v.string(),
}, ['events'], ['events', 'invitations', 'rsvps']);
export const editEvent = mutation('editEvent', {
  eventId: v.id('events'), title: v.string(), privateLocation: v.string(),
}, ['events', 'invitations'], ['events']);
export const setGuestListVisibility = mutation('setGuestListVisibility', {
  eventId: v.id('events'), visibility: v.string(),
}, ['events', 'invitations'], ['events']);
export const setRole = mutation('setRole', {
  eventId: v.id('events'), userId: v.string(), role: v.string(),
}, ['events', 'invitations'], ['invitations']);
export const revokeGuest = mutation('revokeGuest', {
  eventId: v.id('events'), userId: v.string(),
}, ['events', 'invitations'], ['invitations']);
export const rsvp = mutation('rsvp', {
  eventId: v.id('events'), response: v.string(), plusOneCount: v.integer(),
}, ['events', 'invitations', 'rsvps'], ['events', 'rsvps']);
export const claimFinalSeat = mutation('claimFinalSeat', {
  eventId: v.id('events'),
}, ['events', 'invitations', 'rsvps'], ['events', 'rsvps']);
export const postToWall = mutation('postToWall', {
  eventId: v.id('events'), authorName: v.string(), body: v.string(), ordinal: v.integer(),
}, ['events', 'invitations'], ['posts']);
export const reserveNotification = mutation('reserveNotification', {
  eventId: v.id('events'), idempotencyKey: v.string(),
}, ['events', 'invitations', 'notificationEffects'], ['notificationEffects']);
export const settleNotification = mutation('settleNotification', {
  idempotencyKey: v.string(), status: v.string(), certainty: v.string(), providerReceipt: v.optional(v.string()),
}, ['notificationEffects'], ['notificationEffects']);
export const recordReminderAttempt = defineJsMutation({
  args: { namespace: v.string(), eventSlug: v.string(), deliveryKey: v.string(), trigger: v.string() },
  source: 'handlers.mjs',
  exportName: 'recordReminderAttempt',
  reads: ['events', 'reminderAttempts'],
  writes: ['reminderAttempts'],
});

export const sendNotification = defineAction({
  args: { eventId: v.id('events'), idempotencyKey: v.string(), providerUrl: v.string() },
  js: { source: 'effect-handlers.mjs', exportName: 'sendNotification' },
  uses: ['notificationToken'],
  writes: ['notificationEffects'],
  auth: 'authenticated',
});
export const scheduledReminder = defineAction({
  args: {},
  js: { source: 'cron-handlers.mjs', exportName: 'scheduledReminder' },
  writes: ['reminderAttempts'],
});
export const reminderCron = defineCron({
  eventReminders: {
    schedule: { everyMs: 3_600_000, jitter: false },
    action: 'scheduledReminder',
  },
});
