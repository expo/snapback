import { schema, table, t } from 'spacetimedb/server';
import { ScheduleAt, type Identity } from 'spacetimedb';

// @ref LLP 0102#app-4-partiful-shaped-event-application — private source
// tables, identity-aware views, transactional reducers, scheduled procedures,
// and an effect ledger implement the frozen event facts without a portable
// provider gateway.
const persona = table(
  { name: 'persona' },
  {
    identity: t.identity().primaryKey(),
    name: t.string().unique(),
  },
);

const event = table(
  { name: 'event' },
  {
    id: t.string().primaryKey(),
    slug: t.string().unique(),
    title: t.string(),
    publicDescription: t.string(),
    privateNotes: t.string(),
    startsAt: t.string(),
    venue: t.string(),
    capacity: t.u32(),
    guestListVisible: t.bool(),
    removed: t.bool(),
    revision: t.u64(),
    updatedAt: t.timestamp(),
  },
);

const membership = table(
  { name: 'membership' },
  {
    id: t.string().primaryKey(),
    eventId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    displayName: t.string(),
    role: t.string(),
    active: t.bool(),
    invitedAt: t.timestamp(),
  },
);

const rsvp = table(
  { name: 'rsvp' },
  {
    id: t.string().primaryKey(),
    eventId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    displayName: t.string(),
    status: t.string(),
    plusOne: t.u32(),
    revision: t.u64(),
    updatedAt: t.timestamp(),
  },
);

const wallPost = table(
  { name: 'wall_post' },
  {
    id: t.string().primaryKey(),
    eventId: t.string().index('btree'),
    author: t.identity().index('btree'),
    authorName: t.string(),
    body: t.string(),
    createdAt: t.timestamp(),
  },
);

const eventAsset = table(
  { name: 'event_asset' },
  {
    id: t.string().primaryKey(),
    eventId: t.string().index('btree'),
    uploader: t.identity().index('btree'),
    mimeType: t.string(),
    contentHash: t.string(),
    bytes: t.array(t.u8()),
    createdAt: t.timestamp(),
  },
);

const reminderSchedule = table(
  { name: 'reminder_schedule' },
  {
    scheduleId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    eventId: t.string().index('btree'),
    attemptKey: t.string(),
    endpoint: t.string(),
  },
);

const reminderRun = table(
  { name: 'reminder_run' },
  {
    attemptKey: t.string().primaryKey(),
    eventId: t.string().index('btree'),
    state: t.string(),
    runCount: t.u32(),
    ranAt: t.timestamp(),
  },
);

const notificationAttempt = table(
  { name: 'notification_attempt' },
  {
    dedupeKey: t.string().primaryKey(),
    eventId: t.string().index('btree'),
    kind: t.string(),
    state: t.string(),
    attempts: t.u32(),
    providerStatus: t.string(),
    updatedAt: t.timestamp(),
  },
);

const spacetimedb = schema({
  persona,
  event,
  membership,
  rsvp,
  wallPost,
  eventAsset,
  reminderSchedule,
  reminderRun,
  notificationAttempt,
});

export default spacetimedb;

const EVENT_ID = 'event-summer-rooftop';
const ROLES = new Set(['host', 'cohost', 'guest']);
const RSVP_STATES = new Set(['yes', 'no', 'maybe']);

function identityKey(identity: Identity): string {
  return identity.toHexString();
}

function memberId(eventId: string, identity: Identity): string {
  return `${eventId}:${identityKey(identity)}`;
}

function isAcceptedEffectTarget(endpoint: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.trycloudflare\.com(?:\/|$)/.test(endpoint);
}

function requirePersona(ctx: any) {
  const actor = ctx.db.persona.identity.find(ctx.sender);
  if (!actor) throw new Error('PARTY_PERSONA_REQUIRED');
  return actor;
}

function activeMembership(ctx: any, identity: Identity, eventId = EVENT_ID) {
  const row = ctx.db.membership.id.find(memberId(eventId, identity));
  return row?.active ? row : undefined;
}

function requireMember(ctx: any, eventId = EVENT_ID) {
  const actor = requirePersona(ctx);
  const member = activeMembership(ctx, ctx.sender, eventId);
  const target = ctx.db.event.id.find(eventId);
  if (!member || !target || target.removed) throw new Error('PARTY_MEMBER_REQUIRED');
  return { actor, member, target };
}

function requireHostOrCohost(ctx: any, eventId = EVENT_ID) {
  const result = requireMember(ctx, eventId);
  if (!['host', 'cohost'].includes(result.member.role)) {
    throw new Error('PARTY_HOST_OR_COHOST_REQUIRED');
  }
  return result;
}

function requireHost(ctx: any, eventId = EVENT_ID) {
  const result = requireMember(ctx, eventId);
  if (result.member.role !== 'host') throw new Error('PARTY_HOST_REQUIRED');
  return result;
}

function confirmedSeats(ctx: any, eventId: string, exceptIdentity?: Identity): number {
  let seats = 0;
  const except = exceptIdentity ? identityKey(exceptIdentity) : '';
  for (const row of ctx.db.rsvp.eventId.filter(eventId)) {
    if (except && identityKey(row.identity) === except) continue;
    if (row.status === 'yes') seats += 1 + row.plusOne;
  }
  return seats;
}

export const registerPersona = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    if (!['Alice', 'Bob', 'Mallory', 'Casey'].includes(name)) {
      throw new Error('PARTY_UNKNOWN_PERSONA');
    }
    const current = ctx.db.persona.identity.find(ctx.sender);
    if (current && current.name !== name) throw new Error('PARTY_IDENTITY_ALREADY_BOUND');
    const claimed = ctx.db.persona.name.find(name);
    if (claimed && identityKey(claimed.identity) !== identityKey(ctx.sender)) {
      throw new Error('PARTY_PERSONA_ALREADY_CLAIMED');
    }
    if (!current) ctx.db.persona.insert({ identity: ctx.sender, name });
  },
);

export const seedFixtures = spacetimedb.reducer((ctx) => {
  const actor = requirePersona(ctx);
  if (actor.name !== 'Alice') throw new Error('PARTY_ONLY_ALICE_SEEDS');
  if (ctx.db.event.id.find(EVENT_ID)) throw new Error('PARTY_FIXTURE_ALREADY_SEEDED');
  const alice = ctx.db.persona.name.find('Alice');
  const bob = ctx.db.persona.name.find('Bob');
  const mallory = ctx.db.persona.name.find('Mallory');
  const casey = ctx.db.persona.name.find('Casey');
  if (!alice || !bob || !mallory || !casey) throw new Error('PARTY_ALL_PERSONAS_REQUIRED');

  ctx.db.event.insert({
    id: EVENT_ID,
    slug: 'summer-rooftop',
    title: 'Summer Rooftop Supper',
    publicDescription: 'Dinner, music, and sunset above the city.',
    privateNotes: 'Host code 0427; vendor arrival at 17:30.',
    startsAt: '2026-08-15T19:00:00-07:00',
    venue: 'Mission Rooftop',
    capacity: 8,
    guestListVisible: false,
    removed: false,
    revision: 1n,
    updatedAt: ctx.timestamp,
  });
  for (const [person, role] of [
    [alice, 'host'],
    [bob, 'guest'],
    [casey, 'guest'],
  ] as const) {
    ctx.db.membership.insert({
      id: memberId(EVENT_ID, person.identity),
      eventId: EVENT_ID,
      identity: person.identity,
      displayName: person.name,
      role,
      active: true,
      invitedAt: ctx.timestamp,
    });
  }
  ctx.db.rsvp.insert({
    id: memberId(EVENT_ID, alice.identity),
    eventId: EVENT_ID,
    identity: alice.identity,
    displayName: alice.name,
    status: 'yes',
    plusOne: 0,
    revision: 1n,
    updatedAt: ctx.timestamp,
  });
  ctx.db.wallPost.insert({
    id: 'post-welcome',
    eventId: EVENT_ID,
    author: alice.identity,
    authorName: alice.name,
    body: 'Welcome! Sunset is at 8:04.',
    createdAt: ctx.timestamp,
  });
});

export const setRsvp = spacetimedb.reducer(
  {
    eventId: t.string(),
    status: t.string(),
    plusOne: t.u32(),
  },
  (ctx, { eventId, status, plusOne }) => {
    const { actor, target } = requireMember(ctx, eventId);
    if (!RSVP_STATES.has(status)) throw new Error('PARTY_INVALID_RSVP');
    if (plusOne > 2 || (status !== 'yes' && plusOne !== 0)) {
      throw new Error('PARTY_INVALID_PLUS_ONE');
    }
    const requested = status === 'yes' ? 1 + plusOne : 0;
    if (confirmedSeats(ctx, eventId, ctx.sender) + requested > target.capacity) {
      throw new Error('PARTY_CAPACITY_EXCEEDED');
    }
    const id = memberId(eventId, ctx.sender);
    const current = ctx.db.rsvp.id.find(id);
    const next = {
      id,
      eventId,
      identity: ctx.sender,
      displayName: actor.name,
      status,
      plusOne,
      revision: (current?.revision ?? 0n) + 1n,
      updatedAt: ctx.timestamp,
    };
    if (current) ctx.db.rsvp.id.update(next);
    else ctx.db.rsvp.insert(next);
  },
);

export const setMemberRole = spacetimedb.reducer(
  { eventId: t.string(), personName: t.string(), role: t.string() },
  (ctx, { eventId, personName, role }) => {
    requireHost(ctx, eventId);
    if (!ROLES.has(role) || role === 'host') throw new Error('PARTY_INVALID_ROLE_CHANGE');
    const person = ctx.db.persona.name.find(personName);
    if (!person) throw new Error('PARTY_PERSON_NOT_FOUND');
    const current = ctx.db.membership.id.find(memberId(eventId, person.identity));
    if (!current?.active) throw new Error('PARTY_MEMBER_NOT_FOUND');
    ctx.db.membership.id.update({ ...current, role });
  },
);

export const setGuestListVisibility = spacetimedb.reducer(
  { eventId: t.string(), visible: t.bool() },
  (ctx, { eventId, visible }) => {
    const { target } = requireHostOrCohost(ctx, eventId);
    ctx.db.event.id.update({
      ...target,
      guestListVisible: visible,
      revision: target.revision + 1n,
      updatedAt: ctx.timestamp,
    });
  },
);

export const createWallPost = spacetimedb.reducer(
  { id: t.string(), eventId: t.string(), body: t.string() },
  (ctx, { id, eventId, body }) => {
    const { actor } = requireMember(ctx, eventId);
    if (!body || body.length > 1000) throw new Error('PARTY_INVALID_POST');
    if (ctx.db.wallPost.id.find(id)) throw new Error('PARTY_DUPLICATE_POST');
    ctx.db.wallPost.insert({
      id,
      eventId,
      author: ctx.sender,
      authorName: actor.name,
      body,
      createdAt: ctx.timestamp,
    });
  },
);

export const uploadEventAsset = spacetimedb.reducer(
  {
    id: t.string(),
    eventId: t.string(),
    mimeType: t.string(),
    contentHash: t.string(),
    bytes: t.array(t.u8()),
  },
  (ctx, { id, eventId, mimeType, contentHash, bytes }) => {
    requireHostOrCohost(ctx, eventId);
    if (!mimeType.startsWith('image/') || !contentHash || bytes.length === 0 || bytes.length > 65536) {
      throw new Error('PARTY_INVALID_ASSET');
    }
    if (ctx.db.eventAsset.id.find(id)) throw new Error('PARTY_DUPLICATE_ASSET');
    ctx.db.eventAsset.insert({
      id,
      eventId,
      uploader: ctx.sender,
      mimeType,
      contentHash,
      bytes,
      createdAt: ctx.timestamp,
    });
  },
);

export const deleteEventAsset = spacetimedb.reducer(
  { id: t.string(), eventId: t.string() },
  (ctx, { id, eventId }) => {
    requireHostOrCohost(ctx, eventId);
    const current = ctx.db.eventAsset.id.find(id);
    if (!current || current.eventId !== eventId) throw new Error('PARTY_ASSET_NOT_FOUND');
    ctx.db.eventAsset.id.delete(id);
  },
);

export const scheduleReminder = spacetimedb.reducer(
  {
    eventId: t.string(),
    attemptKey: t.string(),
    endpoint: t.string(),
    delayMs: t.u32(),
  },
  (ctx, { eventId, attemptKey, endpoint, delayMs }) => {
    requireHostOrCohost(ctx, eventId);
    if (!attemptKey || !isAcceptedEffectTarget(endpoint)) {
      throw new Error('PARTY_INVALID_LOCAL_EFFECT_TARGET');
    }
    if (ctx.db.reminderRun.attemptKey.find(attemptKey)) {
      throw new Error('PARTY_REMINDER_ALREADY_RAN');
    }
    ctx.db.reminderSchedule.insert({
      scheduleId: 0n,
      scheduledAt: ScheduleAt.time(
        ctx.timestamp.microsSinceUnixEpoch + BigInt(delayMs) * 1000n,
      ),
      eventId,
      attemptKey,
      endpoint,
    });
  },
);

function performNotification(
  ctx: any,
  input: { eventId: string; dedupeKey: string; endpoint: string; kind: string },
) {
  const shouldSend = ctx.withTx((tx: any) => {
    const target = tx.db.event.id.find(input.eventId);
    if (!target || target.removed) return false;
    const current = tx.db.notificationAttempt.dedupeKey.find(input.dedupeKey);
    if (current?.state === 'succeeded') return false;
    const next = {
      dedupeKey: input.dedupeKey,
      eventId: input.eventId,
      kind: input.kind,
      state: 'pending',
      attempts: (current?.attempts ?? 0) + 1,
      providerStatus: 'request-started',
      updatedAt: tx.timestamp,
    };
    if (current) tx.db.notificationAttempt.dedupeKey.update(next);
    else tx.db.notificationAttempt.insert(next);
    return true;
  });
  if (!shouldSend) return;

  try {
    const response = ctx.http.fetch(input.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': input.dedupeKey,
      },
      body: JSON.stringify({
        eventId: input.eventId,
        dedupeKey: input.dedupeKey,
        kind: input.kind,
      }),
    });
    const status = response.status;
    ctx.withTx((tx: any) => {
      const current = tx.db.notificationAttempt.dedupeKey.find(input.dedupeKey);
      if (!current) throw new Error('PARTY_ATTEMPT_LEDGER_MISSING');
      tx.db.notificationAttempt.dedupeKey.update({
        ...current,
        state: response.ok ? 'succeeded' : status >= 500 ? 'ambiguous' : 'failed',
        providerStatus: `http-${status}`,
        updatedAt: tx.timestamp,
      });
    });
  } catch (error) {
    ctx.withTx((tx: any) => {
      const current = tx.db.notificationAttempt.dedupeKey.find(input.dedupeKey);
      if (!current) throw new Error('PARTY_ATTEMPT_LEDGER_MISSING');
      tx.db.notificationAttempt.dedupeKey.update({
        ...current,
        state: 'ambiguous',
        providerStatus: `transport-outcome-unknown:${String(error).slice(0, 160)}`,
        updatedAt: tx.timestamp,
      });
    });
  }
}

export const deliverReminder = spacetimedb.procedure(
  { onSchedule: reminderSchedule },
  { job: reminderSchedule.rowType },
  t.unit(),
  (ctx, { job }) => {
    const alreadyRan = ctx.withTx((tx: any) =>
      Boolean(tx.db.reminderRun.attemptKey.find(job.attemptKey)),
    );
    if (!alreadyRan) {
      performNotification(ctx, {
        eventId: job.eventId,
        dedupeKey: job.attemptKey,
        endpoint: job.endpoint,
        kind: 'scheduled-reminder',
      });
      ctx.withTx((tx: any) => {
        const current = tx.db.reminderRun.attemptKey.find(job.attemptKey);
        if (!current) {
          tx.db.reminderRun.insert({
            attemptKey: job.attemptKey,
            eventId: job.eventId,
            state: 'complete',
            runCount: 1,
            ranAt: tx.timestamp,
          });
        }
      });
    }
    return {};
  },
);

export const deliverNotification = spacetimedb.procedure(
  {
    eventId: t.string(),
    dedupeKey: t.string(),
    endpoint: t.string(),
    kind: t.string(),
  },
  t.unit(),
  (ctx, input) => {
    ctx.withTx((tx: any) => requireHostOrCohost(tx, input.eventId));
    if (!isAcceptedEffectTarget(input.endpoint)) {
      throw new Error('PARTY_INVALID_LOCAL_EFFECT_TARGET');
    }
    performNotification(ctx, input);
    return {};
  },
);

export const resetCapacityFixture = spacetimedb.reducer(
  { eventId: t.string() },
  (ctx, { eventId }) => {
    const { target } = requireHost(ctx, eventId);
    const alice = ctx.db.persona.name.find('Alice');
    const bob = ctx.db.persona.name.find('Bob');
    const casey = ctx.db.persona.name.find('Casey');
    if (!alice || !bob || !casey) throw new Error('PARTY_PERSON_NOT_FOUND');
    ctx.db.event.id.update({
      ...target,
      capacity: 3,
      revision: target.revision + 1n,
      updatedAt: ctx.timestamp,
    });
    for (const person of [bob, casey]) {
      ctx.db.rsvp.id.delete(memberId(eventId, person.identity));
    }
    const aliceId = memberId(eventId, alice.identity);
    const current = ctx.db.rsvp.id.find(aliceId);
    const row = {
      id: aliceId,
      eventId,
      identity: alice.identity,
      displayName: alice.name,
      status: 'yes',
      plusOne: 1,
      revision: (current?.revision ?? 0n) + 1n,
      updatedAt: ctx.timestamp,
    };
    if (current) ctx.db.rsvp.id.update(row);
    else ctx.db.rsvp.insert(row);
  },
);

export const revokeMember = spacetimedb.reducer(
  { eventId: t.string(), personName: t.string() },
  (ctx, { eventId, personName }) => {
    requireHost(ctx, eventId);
    const person = ctx.db.persona.name.find(personName);
    if (!person || person.name === 'Alice') throw new Error('PARTY_INVALID_REVOCATION');
    const current = ctx.db.membership.id.find(memberId(eventId, person.identity));
    if (!current?.active) throw new Error('PARTY_MEMBER_NOT_FOUND');
    ctx.db.membership.id.update({ ...current, active: false });
  },
);

export const restoreMember = spacetimedb.reducer(
  { eventId: t.string(), personName: t.string(), role: t.string() },
  (ctx, { eventId, personName, role }) => {
    requireHost(ctx, eventId);
    if (!ROLES.has(role) || role === 'host') throw new Error('PARTY_INVALID_ROLE_CHANGE');
    const person = ctx.db.persona.name.find(personName);
    if (!person) throw new Error('PARTY_PERSON_NOT_FOUND');
    const current = ctx.db.membership.id.find(memberId(eventId, person.identity));
    if (!current) throw new Error('PARTY_MEMBER_NOT_FOUND');
    ctx.db.membership.id.update({ ...current, active: true, role });
  },
);

const publicEvent = t.row('PublicEvent', {
  id: t.string().primaryKey(),
  slug: t.string(),
  title: t.string(),
  publicDescription: t.string(),
  startsAt: t.string(),
  venue: t.string(),
});

const guestListEntry = t.row('GuestListEntry', {
  id: t.string().primaryKey(),
  eventId: t.string(),
  displayName: t.string(),
  role: t.string(),
  rsvpStatus: t.string(),
  plusOne: t.u32(),
});

const eventTotals = t.row('EventTotals', {
  eventId: t.string().primaryKey(),
  yes: t.u32(),
  no: t.u32(),
  maybe: t.u32(),
  seats: t.u32(),
  wallPosts: t.u32(),
});

export const publicPreview = spacetimedb.anonymousView(
  { name: 'public_preview', public: true },
  t.array(publicEvent),
  (ctx) => {
    const target = ctx.db.event.id.find(EVENT_ID);
    if (!target || target.removed) return [];
    return [{
      id: target.id,
      slug: target.slug,
      title: target.title,
      publicDescription: target.publicDescription,
      startsAt: target.startsAt,
      venue: target.venue,
    }];
  },
);

export const myEvents = spacetimedb.view(
  { name: 'my_events', public: true },
  t.array(event.rowType),
  (ctx) => {
    const member = activeMembership(ctx, ctx.sender);
    const target = ctx.db.event.id.find(EVENT_ID);
    return member && target && !target.removed ? [target] : [];
  },
);

export const visibleGuests = spacetimedb.view(
  { name: 'visible_guests', public: true },
  t.array(guestListEntry),
  (ctx) => {
    const viewer = activeMembership(ctx, ctx.sender);
    const target = ctx.db.event.id.find(EVENT_ID);
    if (!viewer || !target || target.removed) return [];
    if (!['host', 'cohost'].includes(viewer.role) && !target.guestListVisible) return [];
    const rows = [];
    for (const member of ctx.db.membership.eventId.filter(EVENT_ID)) {
      if (!member.active) continue;
      const response = ctx.db.rsvp.id.find(member.id);
      rows.push({
        id: member.id,
        eventId: EVENT_ID,
        displayName: member.displayName,
        role: member.role,
        rsvpStatus: response?.status ?? 'pending',
        plusOne: response?.plusOne ?? 0,
      });
    }
    return rows;
  },
);

export const myRsvps = spacetimedb.view(
  { name: 'my_rsvps', public: true },
  t.array(rsvp.rowType),
  (ctx) => activeMembership(ctx, ctx.sender)
    ? Array.from(ctx.db.rsvp.eventId.filter(EVENT_ID))
    : [],
);

export const myWallPosts = spacetimedb.view(
  { name: 'my_wall_posts', public: true },
  t.array(wallPost.rowType),
  (ctx) => activeMembership(ctx, ctx.sender)
    ? Array.from(ctx.db.wallPost.eventId.filter(EVENT_ID))
    : [],
);

export const myEventAssets = spacetimedb.view(
  { name: 'my_event_assets', public: true },
  t.array(eventAsset.rowType),
  (ctx) => activeMembership(ctx, ctx.sender)
    ? Array.from(ctx.db.eventAsset.eventId.filter(EVENT_ID))
    : [],
);

export const myReminderRuns = spacetimedb.view(
  { name: 'my_reminder_runs', public: true },
  t.array(reminderRun.rowType),
  (ctx) => {
    const member = activeMembership(ctx, ctx.sender);
    return member && ['host', 'cohost'].includes(member.role)
      ? Array.from(ctx.db.reminderRun.eventId.filter(EVENT_ID))
      : [];
  },
);

export const myNotificationAttempts = spacetimedb.view(
  { name: 'my_notification_attempts', public: true },
  t.array(notificationAttempt.rowType),
  (ctx) => {
    const member = activeMembership(ctx, ctx.sender);
    return member && ['host', 'cohost'].includes(member.role)
      ? Array.from(ctx.db.notificationAttempt.eventId.filter(EVENT_ID))
      : [];
  },
);

export const myEventTotals = spacetimedb.view(
  { name: 'my_event_totals', public: true },
  t.array(eventTotals),
  (ctx) => {
    if (!activeMembership(ctx, ctx.sender)) return [];
    let yes = 0;
    let no = 0;
    let maybe = 0;
    let seats = 0;
    for (const row of ctx.db.rsvp.eventId.filter(EVENT_ID)) {
      if (row.status === 'yes') {
        yes += 1;
        seats += 1 + row.plusOne;
      } else if (row.status === 'no') no += 1;
      else if (row.status === 'maybe') maybe += 1;
    }
    return [{
      eventId: EVENT_ID,
      yes,
      no,
      maybe,
      seats,
      wallPosts: Array.from(ctx.db.wallPost.eventId.filter(EVENT_ID)).length,
    }];
  },
);
