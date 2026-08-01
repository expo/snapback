import {
  defineAction,
  defineAssetUpload,
  defineConfig,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

// LLP 0137 A4 event and invitation application.
// Every protected operation gates through the eventMembers scoped-role
// declaration: hosts administer, cohosts moderate and invite, guests RSVP
// and post to the wall; the outsider gets the uniform
// SNAPBACK_AUTH_PERMISSION_DENIED on read, subscribe, and write.
// (Handlers keep their logic inline: inline handler v1 does not capture
// sibling helpers, so each handler is a self-contained expression.)

// ---- membership entry (seeded/host-created invites; the only mutation
// using the by:['none'] self-insert transition). Entry is attributed: the
// seat and the rsvp row both record the invite code and inviter. ----

export const redeemInvite = defineJsMutation({
  args: { code: v.string(), name: v.string(), enteredVia: v.string() },
  reads: ['invites'],
  writes: ['invites', 'rsvps', 'eventMembers'],
  authorityCreating: true,
  result: results.value(v.object({
    eventId: v.id('events'),
    role: v.string(),
    inviteCode: v.string(),
    invitedByName: v.string(),
    enteredVia: v.string(),
  })),
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query('invites')
      .withIndex('by_code')
      .eq('code', args.code)
      .collect();
    const invite = invites[0];
    if (!invite || invite.consumed) throw new Error('invite code is not redeemable');
    await ctx.membership.eventMembers.insert({
      eventId: invite.eventId,
      userId: ctx.auth.userId,
      role: invite.role === 'cohost' ? 'cohost' : invite.role === 'host' ? 'host' : 'guest',
    });
    await ctx.db.patch('invites', invite._id, { consumed: true });
    const entered = args.enteredVia === 'deep-link' ? 'deep-link' : 'code';
    await ctx.db.insert('rsvps', {
      eventId: invite.eventId,
      userId: ctx.auth.userId,
      name: args.name,
      status: 'invited',
      plusOnes: 0,
      inviteCode: invite.code,
      invitedByName: invite.invitedByName,
      enteredVia: entered,
      createdAt: ctx.runtime.now(),
      updatedAt: ctx.runtime.now(),
    });
    return {
      eventId: invite.eventId,
      role: invite.role,
      inviteCode: invite.code,
      invitedByName: invite.invitedByName,
      enteredVia: entered,
    };
  },
});

// ---- public preview (anonymous): projected fields only, never the
// address, host notes, invites, or guest identities ----

export const eventPreview = defineJsQuery({
  args: { slug: v.string() },
  auth: 'public',
  reads: ['events', 'rsvps'],
  result: results.records(v.object({
    slug: v.string(),
    title: v.string(),
    startsAt: v.integer(),
    city: v.string(),
    blurb: v.string(),
    capacity: v.integer(),
    goingSeats: v.integer(),
    spotsLeft: v.integer(),
    hasFlyer: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_slug')
      .eq('slug', args.slug)
      .collect();
    const event = events[0];
    if (!event) return [];
    const rsvps = await ctx.db
      .query('rsvps')
      .withIndex('by_event')
      .eq('eventId', event._id)
      .take(500)
      .collect();
    let goingSeats = 0;
    for (const row of rsvps) {
      if (row.status === 'going') goingSeats += 1 + row.plusOnes;
    }
    return [{
      slug: event.slug,
      title: event.title,
      startsAt: event.startsAt,
      city: event.city,
      blurb: event.blurb,
      capacity: event.capacity,
      goingSeats,
      spotsLeft: Math.max(0, event.capacity - goingSeats),
      hasFlyer: event.flyerAssetId !== '',
    }];
  },
});

// ---- member reads ----

export const guestEventView = defineJsLiveQuery({
  args: { eventId: v.id('events') },
  reads: ['events', 'rsvps', 'eventMembers'],
  result: results.records(v.object({
    slug: v.string(),
    title: v.string(),
    startsAt: v.integer(),
    city: v.string(),
    blurb: v.string(),
    privateAddress: v.string(),
    capacity: v.integer(),
    plusOneLimit: v.integer(),
    goingSeats: v.integer(),
    goingCount: v.integer(),
    maybeCount: v.integer(),
    flyerAssetId: v.string(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost', 'guest');
    const event = await ctx.db.get('events', args.eventId);
    if (!event) throw new Error('event not found');
    const rsvps = await ctx.db
      .query('rsvps')
      .withIndex('by_event')
      .eq('eventId', args.eventId)
      .take(500)
      .collect();
    let goingSeats = 0;
    let goingCount = 0;
    let maybeCount = 0;
    for (const row of rsvps) {
      if (row.status === 'going') { goingSeats += 1 + row.plusOnes; goingCount += 1; }
      else if (row.status === 'maybe') maybeCount += 1;
    }
    return [{
      slug: event.slug,
      title: event.title,
      startsAt: event.startsAt,
      city: event.city,
      blurb: event.blurb,
      privateAddress: event.privateAddress,
      capacity: event.capacity,
      plusOneLimit: event.plusOneLimit,
      goingSeats,
      goingCount,
      maybeCount,
      flyerAssetId: event.flyerAssetId,
    }];
  },
});

export const guestList = defineJsLiveQuery({
  args: { eventId: v.id('events') },
  reads: ['rsvps', 'eventMembers'],
  result: results.records(v.object({
    _id: v.id('rsvps'),
    name: v.string(),
    status: v.string(),
    plusOnes: v.integer(),
    invitedByName: v.string(),
    enteredVia: v.string(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost', 'guest');
    const rows = await ctx.db
      .query('rsvps')
      .withIndex('by_event')
      .eq('eventId', args.eventId)
      .take(500)
      .collect();
    rows.sort((a, b) => a.createdAt - b.createdAt || (a._id < b._id ? -1 : 1));
    return rows.map((row) => ({
      _id: row._id,
      name: row.name,
      status: row.status,
      plusOnes: row.plusOnes,
      invitedByName: row.invitedByName,
      enteredVia: row.enteredVia,
    }));
  },
});

export const wallFeed = defineJsLiveQuery({
  args: { eventId: v.id('events') },
  reads: ['wallPosts', 'eventMembers'],
  result: results.documents('wallPosts'),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost', 'guest');
    const rows = await ctx.db
      .query('wallPosts')
      .withIndex('by_event_seq')
      .eq('eventId', args.eventId)
      .take(200)
      .collect();
    rows.sort((a, b) => a.seq - b.seq);
    return rows;
  },
});

// ---- host-side reads: notes, invites, reminders, effect ledger ----

export const hostEventDetail = defineJsQuery({
  args: { eventId: v.id('events') },
  reads: ['events', 'invites', 'reminders', 'reminderDeliveries', 'eventMembers'],
  result: results.records(v.object({
    title: v.string(),
    hostNotes: v.string(),
    privateAddress: v.string(),
    invites: v.array(v.object({
      code: v.string(),
      role: v.string(),
      consumed: v.boolean(),
      invitedByName: v.string(),
    })),
    reminders: v.array(v.object({
      _id: v.id('reminders'),
      kind: v.string(),
      remindAt: v.integer(),
      note: v.string(),
    })),
    deliveries: v.array(v.object({
      dedupeKey: v.string(),
      kind: v.string(),
      recipients: v.integer(),
      deliveredAt: v.integer(),
    })),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost');
    const event = await ctx.db.get('events', args.eventId);
    if (!event) throw new Error('event not found');
    const invites = await ctx.db
      .query('invites')
      .withIndex('by_event')
      .eq('eventId', args.eventId)
      .take(200)
      .collect();
    const reminders = await ctx.db
      .query('reminders')
      .withIndex('by_event')
      .eq('eventId', args.eventId)
      .take(50)
      .collect();
    const deliveries = await ctx.db
      .query('reminderDeliveries')
      .withIndex('by_event')
      .eq('eventId', args.eventId)
      .take(50)
      .collect();
    return [{
      title: event.title,
      hostNotes: event.hostNotes,
      privateAddress: event.privateAddress,
      invites: invites.map((i) => ({
        code: i.code, role: i.role, consumed: i.consumed, invitedByName: i.invitedByName,
      })),
      reminders: reminders.map((r) => ({
        _id: r._id, kind: r.kind, remindAt: r.remindAt, note: r.note,
      })),
      deliveries: deliveries.map((d) => ({
        dedupeKey: d.dedupeKey, kind: d.kind, recipients: d.recipients, deliveredAt: d.deliveredAt,
      })),
    }];
  },
});

export const notifyLedger = defineJsQuery({
  args: { eventId: v.id('events') },
  reads: ['notifyIntents', 'notifyAttempts', 'eventMembers'],
  result: results.records(v.object({
    dedupeKey: v.string(),
    state: v.string(),
    receiptId: v.string(),
    attemptCount: v.integer(),
    settledAt: v.integer(),
    attempts: v.array(v.object({
      attemptSeq: v.integer(),
      outcome: v.string(),
      providerStatus: v.integer(),
      detail: v.string(),
    })),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost');
    const intents = await ctx.db
      .query('notifyIntents')
      .withIndex('by_event')
      .eq('eventId', args.eventId)
      .take(50)
      .collect();
    const out = [];
    for (const intent of intents) {
      const attempts = await ctx.db
        .query('notifyAttempts')
        .withIndex('by_intent_seq')
        .eq('intentId', intent._id)
        .take(50)
        .collect();
      attempts.sort((a, b) => a.attemptSeq - b.attemptSeq);
      out.push({
        dedupeKey: intent.dedupeKey,
        state: intent.state,
        receiptId: intent.receiptId,
        attemptCount: intent.attemptCount,
        settledAt: intent.settledAt,
        attempts: attempts.map((a) => ({
          attemptSeq: a.attemptSeq, outcome: a.outcome,
          providerStatus: a.providerStatus, detail: a.detail,
        })),
      });
    }
    return out;
  },
});

// ---- writes ----

export const updateRsvp = defineJsMutation({
  args: { eventId: v.id('events'), status: v.string(), plusOnes: v.integer() },
  reads: ['events', 'rsvps'],
  writes: ['rsvps'],
  result: results.value(v.object({
    status: v.string(),
    plusOnes: v.integer(),
    goingSeats: v.integer(),
    capacity: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost', 'guest');
    if (!['going', 'maybe', 'declined'].includes(args.status)) {
      throw new Error('status must be going, maybe, or declined');
    }
    const event = await ctx.db.get('events', args.eventId);
    if (!event) throw new Error('event not found');
    if (args.plusOnes < 0 || args.plusOnes > event.plusOneLimit) {
      throw new Error(`plus-ones must be between 0 and ${event.plusOneLimit}`);
    }
    const mine = await ctx.db
      .query('rsvps')
      .withIndex('by_event_user')
      .eq('eventId', args.eventId)
      .eq('userId', ctx.auth.userId)
      .collect();
    const row = mine[0];
    if (!row) throw new Error('no rsvp row for this guest');
    // Capacity enforcement: seats are recomputed inside the serialized
    // transaction, so two concurrent RSVPs cannot both observe the same
    // remaining capacity and overbook (commit order decides).
    const rsvps = await ctx.db
      .query('rsvps')
      .withIndex('by_event')
      .eq('eventId', args.eventId)
      .take(500)
      .collect();
    let otherSeats = 0;
    for (const r of rsvps) {
      if (r._id !== row._id && r.status === 'going') otherSeats += 1 + r.plusOnes;
    }
    const requested = args.status === 'going' ? 1 + args.plusOnes : 0;
    if (otherSeats + requested > event.capacity) {
      throw new Error(`capacity exceeded: ${otherSeats} seats taken of ${event.capacity}, requested ${requested}`);
    }
    await ctx.db.patch('rsvps', row._id, {
      status: args.status,
      plusOnes: args.status === 'going' ? args.plusOnes : 0,
      updatedAt: ctx.runtime.now(),
    });
    return {
      status: args.status,
      plusOnes: args.status === 'going' ? args.plusOnes : 0,
      goingSeats: otherSeats + requested,
      capacity: event.capacity,
    };
  },
});

export const postWall = defineJsMutation({
  args: { eventId: v.id('events'), body: v.string(), clientKey: v.string(), authorName: v.string() },
  reads: ['events', 'wallPosts'],
  writes: ['events', 'wallPosts'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost', 'guest');
    const existing = await ctx.db
      .query('wallPosts')
      .withIndex('by_event_client_key')
      .eq('eventId', args.eventId)
      .eq('clientKey', args.clientKey)
      .collect();
    if (existing.length > 0) return existing[0].seq; // idempotent retry
    const event = await ctx.db.get('events', args.eventId);
    if (!event) throw new Error('event not found');
    const seq = event.wallSeq + 1;
    await ctx.db.patch('events', args.eventId, { wallSeq: seq });
    await ctx.db.insert('wallPosts', {
      eventId: args.eventId,
      authorId: ctx.auth.userId,
      authorName: args.authorName,
      body: args.body,
      seq,
      clientKey: args.clientKey,
      createdAt: ctx.runtime.now(),
    });
    return seq;
  },
});

export const deleteWallPost = defineJsMutation({
  args: { eventId: v.id('events'), seq: v.integer() },
  reads: ['wallPosts'],
  writes: ['wallPosts'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost');
    const rows = await ctx.db
      .query('wallPosts')
      .withIndex('by_event_seq')
      .eq('eventId', args.eventId)
      .eq('seq', args.seq)
      .collect();
    if (rows.length === 0) throw new Error('wall post not found');
    await ctx.db.delete('wallPosts', rows[0]._id);
    return args.seq;
  },
});

export const updateEventDetails = defineJsMutation({
  args: { eventId: v.id('events'), blurb: v.string(), hostNotes: v.string() },
  reads: ['events'],
  writes: ['events'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host');
    await ctx.db.patch('events', args.eventId, {
      blurb: args.blurb,
      hostNotes: args.hostNotes,
    });
    return 1;
  },
});

export const createInvite = defineJsMutation({
  args: { eventId: v.id('events'), code: v.string(), role: v.string(), invitedByName: v.string() },
  reads: ['invites'],
  writes: ['invites'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost');
    if (!['cohost', 'guest'].includes(args.role)) throw new Error('role must be cohost or guest');
    await ctx.db.insert('invites', {
      eventId: args.eventId,
      code: args.code,
      role: args.role,
      invitedByName: args.invitedByName,
      consumed: false,
      createdAt: ctx.runtime.now(),
    });
    return args.code;
  },
});

// Self-retirement of a seat (the private-roster v1 posture has no admin
// kick — known 0137-a2-f4; cleanup retires authority by self-removal).
export const leaveEvent = defineJsMutation({
  args: { eventId: v.id('events') },
  writes: ['eventMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.eventMembers.removeSelf(args.eventId);
    return true;
  },
});

// ---- flyer reference ----

// The supported-on-0.1.7 shape: the queryable row carries the canonical
// asset id as a plain string (0137-a1-f1 workaround).
export const setFlyerRef = defineJsMutation({
  args: { eventId: v.id('events'), assetId: v.string() },
  reads: ['events'],
  writes: ['events'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost');
    await ctx.db.patch('events', args.eventId, { flyerAssetId: args.assetId });
    return 1;
  },
});

// The documented shape (guide backend/assets "Upload and attach"): a typed
// v.assetRef write through ctx.assets.attach. Known-broken on packaged
// 0.1.7 (finding 0137-a1-f2: SNAPBACK_ASSET_REF_UNVERIFIED at commit);
// kept as the re-verification probe.
export const attachFlyer = defineJsMutation({
  args: { eventId: v.id('events'), assetId: v.string() },
  reads: [],
  writes: ['eventFlyers'],
  result: results.value(v.id('eventFlyers')),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost');
    return await ctx.db.insert('eventFlyers', {
      eventId: args.eventId,
      image: await ctx.assets.attach(args.assetId, { upload: 'flyerUpload' }),
    });
  },
});

// ---- asset upload intents ----

// Event flyer: image pipeline (strip GPS, declared renditions), strict
// private delivery, read shared via references (unreachable on 0.1.7
// while a1-f2 blocks attachment — recorded honestly by the arm).
export const flyerUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png', 'image/jpeg'], maxBytes: 2_000_000 },
  image: {
    location: 'strip',
    variants: [
      { key: 'card', width: 480 },
      { key: 'thumb', width: 128 },
    ],
  },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// Gallery photo: the pasteable signed-URL lane — issuance is
// per-request-authorized to the owner; the URL itself is the authority
// a host can hand to guests.
export const galleryUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png', 'image/jpeg'], maxBytes: 2_000_000 },
  image: {
    location: 'strip',
    variants: [{ key: 'card', width: 480 }],
  },
  delivery: { kind: 'private-signed' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// ---- scheduled reminder ----

// The scheduler runs the action with system authority; the action owns no
// ctx.db, so this one mutation performs the whole due-scan-and-record
// transactionally. The dedupe unique index makes a second tick a no-op,
// and a user-invoked call still requires a host/cohost seat.
export const deliverDueReminders = defineJsMutation({
  args: { now: v.integer() },
  reads: ['reminders', 'reminderDeliveries', 'rsvps'],
  writes: ['reminderDeliveries'],
  result: results.value(v.object({
    delivered: v.array(v.string()),
    alreadyDelivered: v.integer(),
    notDue: v.integer(),
  })),
  handler: async (ctx, args) => {
    const reminders = await ctx.db.query('reminders').take(100).collect();
    const delivered = [];
    let alreadyDelivered = 0;
    let notDue = 0;
    for (const reminder of reminders) {
      if (ctx.auth && ctx.auth.userId) {
        await ctx.permissions.eventMembers.requireRole(reminder.eventId, 'host', 'cohost');
      }
      if (reminder.remindAt > args.now) { notDue += 1; continue; }
      const dedupeKey = `${reminder._id}:${reminder.kind}`;
      const existing = await ctx.db
        .query('reminderDeliveries')
        .withIndex('by_dedupe')
        .eq('dedupeKey', dedupeKey)
        .collect();
      if (existing.length > 0) { alreadyDelivered += 1; continue; }
      const rsvps = await ctx.db
        .query('rsvps')
        .withIndex('by_event')
        .eq('eventId', reminder.eventId)
        .take(500)
        .collect();
      const recipients = rsvps.filter((r) => r.status === 'going').length;
      await ctx.db.insert('reminderDeliveries', {
        eventId: reminder.eventId,
        reminderId: reminder._id,
        dedupeKey,
        kind: reminder.kind,
        recipients,
        deliveredAt: args.now,
      });
      delivered.push(dedupeKey);
    }
    return { delivered, alreadyDelivered, notDue };
  },
});

// NOTE (arm finding): the documented action shape js:{source, exportName}
// is unshippable on packaged 0.1.7 — the bundle validator refuses every
// export form (BUNDLE_UNSUPPORTED_EXPORT) while the runtime loader demands
// the named export (SNAPBACK_HANDLER_EXPORT_MISSING). The undocumented
// inline `handler:` form (packaged define.mjs) is the working path.
export const runReminder = defineAction({
  args: { trigger: v.optional(v.string()) },
  result: results.value(v.object({
    trigger: v.string(),
    delivered: v.array(v.string()),
    alreadyDelivered: v.integer(),
    notDue: v.integer(),
  })),
  writes: ['reminderDeliveries'],
  handler: async (ctx, args) => {
    const trigger = (args && args.trigger) || 'cron';
    const result = await ctx.runMutation('deliverDueReminders', { now: ctx.runtime.now() });
    return { trigger, ...result };
  },
});

// NOTE (arm finding): with an everyMs schedule the deterministic-tick
// catch-up run executes at the epoch-0 nominal slot and the handler's
// trusted ctx.runtime.now() is that nominal time (0), so time-gated
// scheduled logic (remindAt <= now) silently no-ops on that first run;
// only the SECOND tick runs at a real-time nominal and delivers. A
// five-field cron expression would anchor nominals to calendar minutes
// (the natural product shape) but a deterministic suite would then wait
// out a minute boundary. jitter:false because the 1s cadence is this
// acceptance rig's fixed scan interval (LLP 0028 §Jitter shape).
export const reminderCron = defineCron({
  reminderTick: {
    schedule: { everyMs: 1_000, jitter: false },
    action: 'runReminder',
  },
});

// Arm probe: what surface does an inline action ctx actually expose on the
// packaged runtime? (Evidence for the outbound-effect authoring findings.)
export const inspectActionCtx = defineAction({
  args: {},
  result: results.value(v.object({
    keys: v.array(v.string()),
    fetchType: v.string(),
    fetchStreamType: v.string(),
    secretsType: v.string(),
    runMutationType: v.string(),
  })),
  writes: [],
  handler: async (ctx) => ({
    keys: Object.keys(ctx).sort(),
    fetchType: typeof ctx.fetch,
    fetchStreamType: typeof ctx.fetchStream,
    secretsType: typeof ctx.secrets,
    runMutationType: typeof ctx.runMutation,
  }),
});

// ---- external notification effect ----

export const appConfig = defineConfig({
  notifyToken: {
    description: 'Bearer token for the event notification provider',
    purpose: 'Authorizes outbound RSVP-notification posts to the provider webhook',
    required: false,
  },
});

export const beginNotifyAttempt = defineJsMutation({
  args: { eventId: v.id('events'), dedupeKey: v.string(), body: v.string() },
  reads: ['notifyIntents'],
  writes: ['notifyIntents'],
  result: results.value(v.object({
    intentId: v.id('notifyIntents'),
    attemptSeq: v.integer(),
    state: v.string(),
    receiptId: v.string(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'cohost');
    const existing = await ctx.db
      .query('notifyIntents')
      .withIndex('by_event_dedupe')
      .eq('eventId', args.eventId)
      .eq('dedupeKey', args.dedupeKey)
      .collect();
    if (existing.length > 0) {
      const intent = existing[0];
      if (intent.state === 'sent') {
        // Terminal: an idempotent re-send returns the settled outcome
        // without a new attempt. 'failed' and 'ambiguous' stay retryable.
        return { intentId: intent._id, attemptSeq: 0, state: intent.state, receiptId: intent.receiptId };
      }
      const attemptSeq = intent.attemptCount + 1;
      await ctx.db.patch('notifyIntents', intent._id, { attemptCount: attemptSeq, state: 'pending' });
      return { intentId: intent._id, attemptSeq, state: 'pending', receiptId: '' };
    }
    const intentId = await ctx.db.insert('notifyIntents', {
      eventId: args.eventId,
      dedupeKey: args.dedupeKey,
      body: args.body,
      state: 'pending',
      receiptId: '',
      attemptCount: 1,
      createdAt: ctx.runtime.now(),
      settledAt: 0,
    });
    return { intentId, attemptSeq: 1, state: 'pending', receiptId: '' };
  },
});

export const settleNotifyAttempt = defineJsMutation({
  args: {
    intentId: v.id('notifyIntents'),
    attemptSeq: v.integer(),
    outcome: v.string(), // 'sent' | 'failed' | 'ambiguous'
    providerStatus: v.integer(),
    receiptId: v.string(),
    detail: v.string(),
  },
  reads: ['notifyIntents'],
  writes: ['notifyIntents', 'notifyAttempts'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get('notifyIntents', args.intentId);
    if (!intent) throw new Error('notify intent not found');
    await ctx.permissions.eventMembers.requireRole(intent.eventId, 'host', 'cohost');
    if (!['sent', 'failed', 'ambiguous'].includes(args.outcome)) {
      throw new Error('outcome must be sent, failed, or ambiguous');
    }
    await ctx.db.insert('notifyAttempts', {
      intentId: args.intentId,
      eventId: intent.eventId,
      attemptSeq: args.attemptSeq,
      outcome: args.outcome,
      providerStatus: args.providerStatus,
      detail: args.detail,
      at: ctx.runtime.now(),
    });
    // 'ambiguous' and 'failed' are NOT terminal: the intent stays open and
    // safely retryable under the same dedupe key. Only 'sent' settles it.
    const patch = { state: args.outcome };
    if (args.outcome === 'sent') {
      patch.receiptId = args.receiptId;
      patch.settledAt = ctx.runtime.now();
    }
    await ctx.db.patch('notifyIntents', args.intentId, patch);
    return patch.state;
  },
});

export const sendNotification = defineAction({
  args: {
    eventId: v.id('events'),
    dedupeKey: v.string(),
    body: v.string(),
    providerUrl: v.string(), // acceptance rig injects its provider endpoint
  },
  result: results.value(v.object({
    deduped: v.boolean(),
    state: v.string(),
    receiptId: v.string(),
    attemptSeq: v.integer(),
    providerStatus: v.integer(),
    detail: v.string(),
  })),
  uses: ['notifyToken'],
  writes: ['notifyIntents', 'notifyAttempts'],
  handler: async (ctx, args) => {
    const begin = await ctx.runMutation('beginNotifyAttempt', {
      eventId: args.eventId,
      dedupeKey: args.dedupeKey,
      body: args.body,
    });
    if (begin.attemptSeq === 0) {
      // Terminal 'sent': the idempotent re-send makes no provider call at all.
      return {
        deduped: true, state: begin.state, receiptId: begin.receiptId,
        attemptSeq: 0, providerStatus: 0, detail: 'deduped: intent already sent',
      };
    }
    const token = ctx.secrets.get('notifyToken');
    let outcome = 'ambiguous';
    let providerStatus = 0;
    let receiptId = '';
    let detail = '';
    try {
      const response = await ctx.fetch(args.providerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token.expose()}`,
          'x-idempotency-key': args.dedupeKey,
        },
        body: JSON.stringify({ body: args.body, attemptSeq: begin.attemptSeq }),
      });
      providerStatus = response.status;
      if (response.ok) {
        const parsed = await response.json();
        outcome = 'sent';
        receiptId = String(parsed.receiptId ?? '');
        detail = `provider accepted (deliveredCount=${parsed.deliveredCount ?? 'n/a'})`;
      } else {
        // A definite provider rejection: no delivery happened; retry is safe.
        outcome = 'failed';
        detail = `provider rejected with status ${response.status}`;
      }
    } catch (error) {
      // The request may or may not have been processed: outcome is AMBIGUOUS,
      // never silently failed and never claimed sent.
      outcome = 'ambiguous';
      detail = `no response: ${String(error && error.message ? error.message : error).slice(0, 120)}`;
    }
    const state = await ctx.runMutation('settleNotifyAttempt', {
      intentId: begin.intentId,
      attemptSeq: begin.attemptSeq,
      outcome,
      providerStatus,
      receiptId,
      detail,
    });
    return { deduped: false, state, receiptId, attemptSeq: begin.attemptSeq, providerStatus, detail };
  },
});
