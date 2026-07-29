import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { ConvexError, v } from 'convex/values';

// @ref LLP 0102#app-4-partiful-shaped-event-application — this provider arm
// uses native Convex transactions, reactive queries, storage, scheduled
// functions, and actions without a cross-provider gateway.
const MAIN_EVENT = 'event-summer-rooftop';
const roleValue = v.union(v.literal('host'), v.literal('cohost'), v.literal('guest'));
const rsvpValue = v.union(v.literal('yes'), v.literal('no'), v.literal('maybe'));

async function identity(ctx: QueryCtx | MutationCtx) {
  const result = await ctx.auth.getUserIdentity();
  if (!result) throw new ConvexError('PARTY_AUTH_REQUIRED');
  return result;
}

async function personaByIdentity(
  ctx: QueryCtx | MutationCtx,
  namespace: string,
  identityKey: string,
) {
  return ctx.db
    .query('personas')
    .withIndex('by_namespace_identity', (q) =>
      q.eq('namespace', namespace).eq('identity', identityKey))
    .unique();
}

async function personaByName(
  ctx: QueryCtx | MutationCtx,
  namespace: string,
  name: string,
) {
  return ctx.db
    .query('personas')
    .withIndex('by_namespace_name', (q) =>
      q.eq('namespace', namespace).eq('name', name))
    .unique();
}

async function eventByKey(
  ctx: QueryCtx | MutationCtx,
  namespace: string,
  eventKey: string,
) {
  return ctx.db
    .query('events')
    .withIndex('by_namespace_event', (q) =>
      q.eq('namespace', namespace).eq('eventKey', eventKey))
    .unique();
}

async function memberByIdentity(
  ctx: QueryCtx | MutationCtx,
  namespace: string,
  eventKey: string,
  identityKey: string,
) {
  return ctx.db
    .query('memberships')
    .withIndex('by_namespace_event_identity', (q) =>
      q.eq('namespace', namespace).eq('eventKey', eventKey).eq('identity', identityKey))
    .unique();
}

async function requireMember(
  ctx: QueryCtx | MutationCtx,
  namespace: string,
  eventKey: string,
) {
  const actor = await identity(ctx);
  const member = await memberByIdentity(ctx, namespace, eventKey, actor.tokenIdentifier);
  const event = await eventByKey(ctx, namespace, eventKey);
  if (!member?.active || !event || event.removed) throw new ConvexError('PARTY_MEMBER_REQUIRED');
  return { actor, member, event };
}

async function requireHostOrCohost(
  ctx: QueryCtx | MutationCtx,
  namespace: string,
  eventKey: string,
) {
  const result = await requireMember(ctx, namespace, eventKey);
  if (result.member.role !== 'host' && result.member.role !== 'cohost') {
    throw new ConvexError('PARTY_HOST_OR_COHOST_REQUIRED');
  }
  return result;
}

async function requireHost(
  ctx: QueryCtx | MutationCtx,
  namespace: string,
  eventKey: string,
) {
  const result = await requireMember(ctx, namespace, eventKey);
  if (result.member.role !== 'host') throw new ConvexError('PARTY_HOST_REQUIRED');
  return result;
}

export const publicPreview = query({
  args: { namespace: v.string() },
  handler: async (ctx, { namespace }) => {
    const event = await eventByKey(ctx, namespace, MAIN_EVENT);
    if (!event || event.removed) return null;
    return {
      eventKey: event.eventKey,
      slug: event.slug,
      title: event.title,
      publicDescription: event.publicDescription,
      startsAt: event.startsAt,
      venue: event.venue,
    };
  },
});

export const privateState = query({
  args: { namespace: v.string(), eventKey: v.string() },
  handler: async (ctx, { namespace, eventKey }) => {
    const actor = await ctx.auth.getUserIdentity();
    if (!actor) return null;
    const member = await memberByIdentity(ctx, namespace, eventKey, actor.tokenIdentifier);
    const event = await eventByKey(ctx, namespace, eventKey);
    if (!member?.active || !event || event.removed) return null;
    const allMemberships = await ctx.db
      .query('memberships')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', namespace).eq('eventKey', eventKey))
      .collect();
    const allRsvps = await ctx.db
      .query('rsvps')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', namespace).eq('eventKey', eventKey))
      .collect();
    const posts = await ctx.db
      .query('wallPosts')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', namespace).eq('eventKey', eventKey))
      .collect();
    const assetRows = await ctx.db
      .query('assets')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', namespace).eq('eventKey', eventKey))
      .collect();
    const assets = await Promise.all(assetRows.map(async (asset) => ({
      assetKey: asset.assetKey,
      mimeType: asset.mimeType,
      contentHash: asset.contentHash,
      byteLength: asset.byteLength,
      url: await ctx.storage.getUrl(asset.storageId),
    })));
    const guestListAllowed =
      event.guestListVisible || member.role === 'host' || member.role === 'cohost';
    const privileged = member.role === 'host' || member.role === 'cohost';
    return {
      event,
      self: {
        displayName: member.displayName,
        role: member.role,
        identity: member.identity,
      },
      guests: guestListAllowed
        ? allMemberships.filter((candidate) => candidate.active).map((candidate) => ({
            identity: candidate.identity,
            displayName: candidate.displayName,
            role: candidate.role,
            rsvp: allRsvps.find((response) => response.identity === candidate.identity) ?? null,
          }))
        : [],
      rsvps: privileged
        ? allRsvps
        : allRsvps.filter((response) => response.identity === actor.tokenIdentifier),
      totals: {
        yes: allRsvps.filter((response) => response.status === 'yes').length,
        maybe: allRsvps.filter((response) => response.status === 'maybe').length,
        no: allRsvps.filter((response) => response.status === 'no').length,
        seats: allRsvps.reduce(
          (sum, response) =>
            sum + (response.status === 'yes' ? 1 + response.plusOne : 0),
          0,
        ),
        wallPosts: posts.length,
      },
      posts,
      assets,
    };
  },
});

export const registerPersona = mutation({
  args: { namespace: v.string(), name: v.string() },
  handler: async (ctx, { namespace, name }) => {
    if (!['Alice', 'Bob', 'Mallory', 'Casey'].includes(name)) {
      throw new ConvexError('PARTY_UNKNOWN_PERSONA');
    }
    const actor = await identity(ctx);
    const current = await personaByIdentity(ctx, namespace, actor.tokenIdentifier);
    if (current && current.name !== name) throw new ConvexError('PARTY_IDENTITY_ALREADY_BOUND');
    const claimed = await personaByName(ctx, namespace, name);
    if (claimed && claimed.identity !== actor.tokenIdentifier) {
      throw new ConvexError('PARTY_PERSONA_ALREADY_CLAIMED');
    }
    if (!current) {
      await ctx.db.insert('personas', {
        namespace,
        identity: actor.tokenIdentifier,
        name,
      });
    }
    return { identity: actor.tokenIdentifier, name };
  },
});

export const seedFixtures = mutation({
  args: { namespace: v.string() },
  handler: async (ctx, { namespace }) => {
    const actor = await identity(ctx);
    const alice = await personaByName(ctx, namespace, 'Alice');
    const bob = await personaByName(ctx, namespace, 'Bob');
    const casey = await personaByName(ctx, namespace, 'Casey');
    if (!alice || !bob || !casey || actor.tokenIdentifier !== alice.identity) {
      throw new ConvexError('PARTY_ONLY_ALICE_SEEDS');
    }
    const existing = await eventByKey(ctx, namespace, MAIN_EVENT);
    if (existing) return { alreadySeeded: true };
    for (let index = 0; index < 20; index += 1) {
      const primary = index === 0;
      await ctx.db.insert('events', {
        namespace,
        eventKey: primary ? MAIN_EVENT : `event-supporting-${String(index).padStart(2, '0')}`,
        slug: primary ? 'summer-rooftop' : `supporting-event-${index}`,
        title: primary ? 'Summer Rooftop Supper' : `Supporting Event ${index}`,
        publicDescription: primary
          ? 'Dinner, music, and sunset above the city.'
          : `Deterministic supporting event ${index}.`,
        privateNotes: primary
          ? 'Host code 0427; vendor arrival at 17:30.'
          : `Private supporting note ${index}.`,
        startsAt: `2026-08-${String(15 + (index % 10)).padStart(2, '0')}T19:00:00-07:00`,
        venue: primary ? 'Mission Rooftop' : `Venue ${index}`,
        capacity: primary ? 50 : 20,
        guestListVisible: false,
        removed: false,
        revision: 1,
      });
    }
    await ctx.db.insert('memberships', {
      namespace,
      eventKey: MAIN_EVENT,
      identity: alice.identity,
      displayName: 'Alice',
      role: 'host',
      active: true,
    });
    await ctx.db.insert('memberships', {
      namespace,
      eventKey: MAIN_EVENT,
      identity: bob.identity,
      displayName: 'Bob',
      role: 'guest',
      active: true,
    });
    await ctx.db.insert('memberships', {
      namespace,
      eventKey: MAIN_EVENT,
      identity: casey.identity,
      displayName: 'Casey',
      role: 'guest',
      active: true,
    });
    for (let index = 3; index <= 49; index += 1) {
      await ctx.db.insert('memberships', {
        namespace,
        eventKey: MAIN_EVENT,
        identity: `seed-identity-${String(index).padStart(2, '0')}`,
        displayName: `Guest ${String(index).padStart(2, '0')}`,
        role: 'guest',
        active: true,
      });
    }
    await ctx.db.insert('rsvps', {
      namespace,
      eventKey: MAIN_EVENT,
      identity: alice.identity,
      displayName: 'Alice',
      status: 'yes',
      plusOne: 0,
      revision: 1,
    });
    await ctx.db.insert('wallPosts', {
      namespace,
      eventKey: MAIN_EVENT,
      postKey: 'post-welcome',
      authorIdentity: alice.identity,
      authorName: 'Alice',
      body: 'Welcome! Sunset is at 8:04.',
    });
    return { alreadySeeded: false, events: 20, guests: 49, capacity: 50 };
  },
});

export const setRsvp = mutation({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    status: rsvpValue,
    plusOne: v.number(),
  },
  handler: async (ctx, args) => {
    const { actor, member, event } = await requireMember(ctx, args.namespace, args.eventKey);
    if (!Number.isInteger(args.plusOne) || args.plusOne < 0 || args.plusOne > 1) {
      throw new ConvexError('PARTY_INVALID_PLUS_ONE');
    }
    const current = await ctx.db
      .query('rsvps')
      .withIndex('by_namespace_event_identity', (q) =>
        q.eq('namespace', args.namespace)
          .eq('eventKey', args.eventKey)
          .eq('identity', actor.tokenIdentifier))
      .unique();
    const responses = await ctx.db
      .query('rsvps')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', args.namespace).eq('eventKey', args.eventKey))
      .collect();
    const occupied = responses.reduce(
      (sum, response) =>
        sum + (
          response.identity !== actor.tokenIdentifier && response.status === 'yes'
            ? 1 + response.plusOne
            : 0
        ),
      0,
    );
    const requested = args.status === 'yes' ? 1 + args.plusOne : 0;
    if (occupied + requested > event.capacity) {
      throw new ConvexError('PARTY_CAPACITY_EXCEEDED');
    }
    const row = {
      namespace: args.namespace,
      eventKey: args.eventKey,
      identity: actor.tokenIdentifier,
      displayName: member.displayName,
      status: args.status,
      plusOne: args.plusOne,
      revision: (current?.revision ?? 0) + 1,
    };
    if (current) await ctx.db.replace(current._id, row);
    else await ctx.db.insert('rsvps', row);
    return row;
  },
});

export const setMemberRole = mutation({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    personName: v.string(),
    role: roleValue,
  },
  handler: async (ctx, args) => {
    await requireHost(ctx, args.namespace, args.eventKey);
    if (args.role === 'host' || args.personName === 'Alice') {
      throw new ConvexError('PARTY_INVALID_ROLE_CHANGE');
    }
    const member = await ctx.db
      .query('memberships')
      .withIndex('by_namespace_event_name', (q) =>
        q.eq('namespace', args.namespace)
          .eq('eventKey', args.eventKey)
          .eq('displayName', args.personName))
      .unique();
    if (!member) throw new ConvexError('PARTY_MEMBER_NOT_FOUND');
    await ctx.db.patch(member._id, { role: args.role });
    return { role: args.role };
  },
});

export const setGuestListVisibility = mutation({
  args: { namespace: v.string(), eventKey: v.string(), visible: v.boolean() },
  handler: async (ctx, args) => {
    const { event } = await requireHostOrCohost(ctx, args.namespace, args.eventKey);
    await ctx.db.patch(event._id, {
      guestListVisible: args.visible,
      revision: event.revision + 1,
    });
    return { visible: args.visible };
  },
});

export const resetCapacityFixture = mutation({
  args: { namespace: v.string(), eventKey: v.string() },
  handler: async (ctx, args) => {
    const { event } = await requireHost(ctx, args.namespace, args.eventKey);
    const responses = await ctx.db
      .query('rsvps')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', args.namespace).eq('eventKey', args.eventKey))
      .collect();
    for (const response of responses) await ctx.db.delete(response._id);
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', args.namespace).eq('eventKey', args.eventKey))
      .collect();
    const alice = memberships.find((member) => member.displayName === 'Alice');
    if (!alice) throw new ConvexError('PARTY_ALICE_NOT_FOUND');
    await ctx.db.insert('rsvps', {
      namespace: args.namespace,
      eventKey: args.eventKey,
      identity: alice.identity,
      displayName: 'Alice',
      status: 'yes',
      plusOne: 1,
      revision: 1,
    });
    for (const member of memberships.filter((candidate) =>
      candidate.displayName.startsWith('Guest '))) {
      await ctx.db.insert('rsvps', {
        namespace: args.namespace,
        eventKey: args.eventKey,
        identity: member.identity,
        displayName: member.displayName,
        status: 'yes',
        plusOne: 0,
        revision: 1,
      });
    }
    await ctx.db.patch(event._id, { capacity: 50, revision: event.revision + 1 });
    return { occupiedSeats: 49, capacity: 50 };
  },
});

export const createWallPost = mutation({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    postKey: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, member } = await requireMember(ctx, args.namespace, args.eventKey);
    const existing = await ctx.db
      .query('wallPosts')
      .withIndex('by_namespace_post', (q) =>
        q.eq('namespace', args.namespace).eq('postKey', args.postKey))
      .unique();
    if (existing) throw new ConvexError('PARTY_POST_EXISTS');
    const id = await ctx.db.insert('wallPosts', {
      namespace: args.namespace,
      eventKey: args.eventKey,
      postKey: args.postKey,
      authorIdentity: actor.tokenIdentifier,
      authorName: member.displayName,
      body: args.body,
    });
    return { id, postKey: args.postKey };
  },
});

export const generateEventUploadUrl = mutation({
  args: { namespace: v.string(), eventKey: v.string() },
  handler: async (ctx, args) => {
    await requireHostOrCohost(ctx, args.namespace, args.eventKey);
    return ctx.storage.generateUploadUrl();
  },
});

export const saveEventAsset = mutation({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    assetKey: v.string(),
    storageId: v.id('_storage'),
    mimeType: v.string(),
    contentHash: v.string(),
    byteLength: v.number(),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireHostOrCohost(ctx, args.namespace, args.eventKey);
    const existing = await ctx.db
      .query('assets')
      .withIndex('by_namespace_asset', (q) =>
        q.eq('namespace', args.namespace).eq('assetKey', args.assetKey))
      .unique();
    if (existing) throw new ConvexError('PARTY_ASSET_EXISTS');
    await ctx.db.insert('assets', {
      ...args,
      uploaderIdentity: actor.tokenIdentifier,
    });
    return { assetKey: args.assetKey, storageId: args.storageId };
  },
});

export const deleteEventAsset = mutation({
  args: { namespace: v.string(), eventKey: v.string(), assetKey: v.string() },
  handler: async (ctx, args) => {
    await requireHostOrCohost(ctx, args.namespace, args.eventKey);
    const existing = await ctx.db
      .query('assets')
      .withIndex('by_namespace_asset', (q) =>
        q.eq('namespace', args.namespace).eq('assetKey', args.assetKey))
      .unique();
    if (!existing) throw new ConvexError('PARTY_ASSET_NOT_FOUND');
    await ctx.storage.delete(existing.storageId);
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});

function acceptedEffectTarget(endpoint: string) {
  return /^http:\/\/127\.0\.0\.1:\d+(?:\/|$)/.test(endpoint);
}

export const scheduleReminder = mutation({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    attemptKey: v.string(),
    endpoint: v.string(),
    delayMs: v.number(),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireHostOrCohost(ctx, args.namespace, args.eventKey);
    if (!acceptedEffectTarget(args.endpoint)) {
      throw new ConvexError('PARTY_INVALID_LOCAL_EFFECT_TARGET');
    }
    const existing = await ctx.db
      .query('reminders')
      .withIndex('by_namespace_attempt', (q) =>
        q.eq('namespace', args.namespace).eq('attemptKey', args.attemptKey))
      .unique();
    if (existing) throw new ConvexError('PARTY_REMINDER_EXISTS');
    const scheduleId: Id<'_scheduled_functions'> = await ctx.scheduler.runAfter(
      args.delayMs,
      internal.party.deliverScheduled,
      {
        namespace: args.namespace,
        eventKey: args.eventKey,
        attemptKey: args.attemptKey,
        endpoint: args.endpoint,
        actorIdentity: actor.tokenIdentifier,
      },
    );
    await ctx.db.insert('reminders', {
      namespace: args.namespace,
      eventKey: args.eventKey,
      attemptKey: args.attemptKey,
      scheduleId: String(scheduleId),
      state: 'scheduled',
      runCount: 0,
      actorIdentity: actor.tokenIdentifier,
      endpoint: args.endpoint,
    });
    return { scheduleId: String(scheduleId), attemptKey: args.attemptKey };
  },
});

export const inspectReminder = query({
  args: { namespace: v.string(), eventKey: v.string(), attemptKey: v.string() },
  handler: async (ctx, args) => {
    await requireHostOrCohost(ctx, args.namespace, args.eventKey);
    const reminder = await ctx.db
      .query('reminders')
      .withIndex('by_namespace_attempt', (q) =>
        q.eq('namespace', args.namespace).eq('attemptKey', args.attemptKey))
      .unique();
    const attempt = await ctx.db
      .query('notificationAttempts')
      .withIndex('by_namespace_dedupe', (q) =>
        q.eq('namespace', args.namespace).eq('dedupeKey', args.attemptKey))
      .unique();
    const scheduled = reminder
      ? await ctx.db.system.get(reminder.scheduleId as Id<'_scheduled_functions'>)
      : null;
    return { reminder, attempt, scheduled };
  },
});

export const authorizeEffect = internalQuery({
  args: { namespace: v.string(), eventKey: v.string(), actorIdentity: v.string() },
  handler: async (ctx, args) => {
    const member = await memberByIdentity(
      ctx,
      args.namespace,
      args.eventKey,
      args.actorIdentity,
    );
    return Boolean(member?.active && (member.role === 'host' || member.role === 'cohost'));
  },
});

export const beginNotification = internalMutation({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    dedupeKey: v.string(),
    kind: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('notificationAttempts')
      .withIndex('by_namespace_dedupe', (q) =>
        q.eq('namespace', args.namespace).eq('dedupeKey', args.dedupeKey))
      .unique();
    if (existing?.state === 'succeeded') {
      return { shouldSend: false, attempts: existing.attempts };
    }
    const next = {
      namespace: args.namespace,
      eventKey: args.eventKey,
      dedupeKey: args.dedupeKey,
      kind: args.kind,
      state: 'pending' as const,
      attempts: (existing?.attempts ?? 0) + 1,
      providerStatus: 'request-started',
    };
    if (existing) await ctx.db.replace(existing._id, next);
    else await ctx.db.insert('notificationAttempts', next);
    return { shouldSend: true, attempts: next.attempts };
  },
});

export const settleNotification = internalMutation({
  args: {
    namespace: v.string(),
    dedupeKey: v.string(),
    state: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('ambiguous')),
    providerStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('notificationAttempts')
      .withIndex('by_namespace_dedupe', (q) =>
        q.eq('namespace', args.namespace).eq('dedupeKey', args.dedupeKey))
      .unique();
    if (!existing) throw new ConvexError('PARTY_ATTEMPT_LEDGER_MISSING');
    await ctx.db.patch(existing._id, {
      state: args.state,
      providerStatus: args.providerStatus,
    });
  },
});

export const completeReminder = internalMutation({
  args: { namespace: v.string(), attemptKey: v.string() },
  handler: async (ctx, args) => {
    const reminder = await ctx.db
      .query('reminders')
      .withIndex('by_namespace_attempt', (q) =>
        q.eq('namespace', args.namespace).eq('attemptKey', args.attemptKey))
      .unique();
    if (!reminder) throw new ConvexError('PARTY_REMINDER_NOT_FOUND');
    await ctx.db.patch(reminder._id, {
      state: 'complete',
      runCount: reminder.runCount + 1,
      completedAt: Date.now(),
    });
  },
});

async function performNotification(
  ctx: {
    runMutation: Function;
  },
  args: {
    namespace: string;
    eventKey: string;
    dedupeKey: string;
    endpoint: string;
    kind: string;
  },
) {
  const begin = await ctx.runMutation(internal.party.beginNotification, {
    namespace: args.namespace,
    eventKey: args.eventKey,
    dedupeKey: args.dedupeKey,
    kind: args.kind,
  });
  if (!begin.shouldSend) return { suppressed: true, attempts: begin.attempts };
  let state: 'succeeded' | 'failed' | 'ambiguous' = 'ambiguous';
  let providerStatus = 'transport-outcome-unknown';
  try {
    const response = await fetch(args.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': args.dedupeKey,
      },
      body: JSON.stringify({
        namespace: args.namespace,
        eventKey: args.eventKey,
        dedupeKey: args.dedupeKey,
        kind: args.kind,
      }),
    });
    providerStatus = `http-${response.status}`;
    state = response.ok ? 'succeeded' : response.status >= 500 ? 'ambiguous' : 'failed';
  } catch (error) {
    providerStatus = `transport-outcome-unknown:${String(error).slice(0, 120)}`;
  }
  await ctx.runMutation(internal.party.settleNotification, {
    namespace: args.namespace,
    dedupeKey: args.dedupeKey,
    state,
    providerStatus,
  });
  return { suppressed: false, attempts: begin.attempts, state, providerStatus };
}

export const deliverScheduled = internalAction({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    attemptKey: v.string(),
    endpoint: v.string(),
    actorIdentity: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const allowed = await ctx.runQuery(internal.party.authorizeEffect, {
      namespace: args.namespace,
      eventKey: args.eventKey,
      actorIdentity: args.actorIdentity,
    });
    if (!allowed) throw new ConvexError('PARTY_SCHEDULE_AUTHORITY_REVOKED');
    await performNotification(ctx, {
      namespace: args.namespace,
      eventKey: args.eventKey,
      dedupeKey: args.attemptKey,
      endpoint: args.endpoint,
      kind: 'scheduled-reminder',
    });
    await ctx.runMutation(internal.party.completeReminder, {
      namespace: args.namespace,
      attemptKey: args.attemptKey,
    });
  },
});

export const deliverNotification = action({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    dedupeKey: v.string(),
    endpoint: v.string(),
    kind: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const actor = await ctx.auth.getUserIdentity();
    if (!actor) throw new ConvexError('PARTY_AUTH_REQUIRED');
    if (!acceptedEffectTarget(args.endpoint)) {
      throw new ConvexError('PARTY_INVALID_LOCAL_EFFECT_TARGET');
    }
    const allowed = await ctx.runQuery(internal.party.authorizeEffect, {
      namespace: args.namespace,
      eventKey: args.eventKey,
      actorIdentity: actor.tokenIdentifier,
    });
    if (!allowed) throw new ConvexError('PARTY_HOST_OR_COHOST_REQUIRED');
    return performNotification(ctx, args);
  },
});

export const revokeMember = mutation({
  args: { namespace: v.string(), eventKey: v.string(), personName: v.string() },
  handler: async (ctx, args) => {
    await requireHost(ctx, args.namespace, args.eventKey);
    if (args.personName === 'Alice') throw new ConvexError('PARTY_INVALID_REVOCATION');
    const member = await ctx.db
      .query('memberships')
      .withIndex('by_namespace_event_name', (q) =>
        q.eq('namespace', args.namespace)
          .eq('eventKey', args.eventKey)
          .eq('displayName', args.personName))
      .unique();
    if (!member?.active) throw new ConvexError('PARTY_MEMBER_NOT_FOUND');
    await ctx.db.patch(member._id, { active: false });
    return { revoked: true };
  },
});

export const restoreMember = mutation({
  args: {
    namespace: v.string(),
    eventKey: v.string(),
    personName: v.string(),
    role: roleValue,
  },
  handler: async (ctx, args) => {
    await requireHost(ctx, args.namespace, args.eventKey);
    const member = await ctx.db
      .query('memberships')
      .withIndex('by_namespace_event_name', (q) =>
        q.eq('namespace', args.namespace)
          .eq('eventKey', args.eventKey)
          .eq('displayName', args.personName))
      .unique();
    if (!member) throw new ConvexError('PARTY_MEMBER_NOT_FOUND');
    await ctx.db.patch(member._id, { active: true, role: args.role });
    return { restored: true };
  },
});

export const retainedCounts = query({
  args: { namespace: v.string(), eventKey: v.string(), personName: v.string() },
  handler: async (ctx, args) => {
    await requireHost(ctx, args.namespace, args.eventKey);
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_namespace_event_name', (q) =>
        q.eq('namespace', args.namespace)
          .eq('eventKey', args.eventKey)
          .eq('displayName', args.personName))
      .collect();
    const rsvps = await ctx.db
      .query('rsvps')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', args.namespace).eq('eventKey', args.eventKey))
      .collect();
    const posts = await ctx.db
      .query('wallPosts')
      .withIndex('by_namespace_event', (q) =>
        q.eq('namespace', args.namespace).eq('eventKey', args.eventKey))
      .collect();
    return {
      memberships: memberships.length,
      activeMemberships: memberships.filter((member) => member.active).length,
      rsvps: rsvps.filter((response) => response.displayName === args.personName).length,
      wallPosts: posts.length,
    };
  },
});

export const authoritativeCounts = query({
  args: { namespace: v.string() },
  handler: async (ctx, { namespace }) => {
    const actor = await identity(ctx);
    const alice = await personaByName(ctx, namespace, 'Alice');
    if (!alice || alice.identity !== actor.tokenIdentifier) {
      throw new ConvexError('PARTY_HOST_REQUIRED');
    }
    const tableNames = [
      'personas',
      'events',
      'memberships',
      'rsvps',
      'wallPosts',
      'assets',
      'reminders',
      'notificationAttempts',
    ] as const;
    const entries = await Promise.all(tableNames.map(async (tableName) => {
      const rows = await ctx.db
        .query(tableName)
        .withIndex('by_namespace', (q) => q.eq('namespace', namespace))
        .collect();
      return [tableName, rows.length] as const;
    }));
    return Object.fromEntries(entries);
  },
});

export const cleanupNamespace = mutation({
  args: { namespace: v.string() },
  handler: async (ctx, { namespace }) => {
    const actor = await identity(ctx);
    const alice = await personaByName(ctx, namespace, 'Alice');
    if (!alice || alice.identity !== actor.tokenIdentifier) {
      throw new ConvexError('PARTY_HOST_REQUIRED');
    }
    const assets = await ctx.db
      .query('assets')
      .withIndex('by_namespace', (q) => q.eq('namespace', namespace))
      .collect();
    for (const asset of assets) {
      await ctx.storage.delete(asset.storageId);
      await ctx.db.delete(asset._id);
    }
    const tableNames = [
      'notificationAttempts',
      'reminders',
      'wallPosts',
      'rsvps',
      'memberships',
      'events',
      'personas',
    ] as const;
    const removed: Record<string, number> = { assets: assets.length };
    for (const tableName of tableNames) {
      const rows = await ctx.db
        .query(tableName)
        .withIndex('by_namespace', (q) => q.eq('namespace', namespace))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
      removed[tableName] = rows.length;
    }
    return removed;
  },
});

export const namespaceProbe = query({
  args: { namespace: v.string() },
  handler: async (ctx, { namespace }) => {
    const tableNames = [
      'personas',
      'events',
      'memberships',
      'rsvps',
      'wallPosts',
      'assets',
      'reminders',
      'notificationAttempts',
    ] as const;
    const entries = await Promise.all(tableNames.map(async (tableName) => {
      const rows = await ctx.db
        .query(tableName)
        .withIndex('by_namespace', (q) => q.eq('namespace', namespace))
        .collect();
      return [tableName, rows.length] as const;
    }));
    return Object.fromEntries(entries);
  },
});
