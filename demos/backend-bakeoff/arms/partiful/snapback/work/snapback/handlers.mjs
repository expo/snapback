const RSVP = new Set(['yes', 'no', 'maybe']);
const VISIBILITY = new Set(['hosts', 'guests']);
const ROLES = new Set(['cohost', 'guest']);

// @ref LLP 0053#negative-deltas-are-obligations-positive-deltas-are-best-effort
// — protected live handlers return an empty authorized projection after role
// loss so an established handle has a concrete negative transition to apply.

async function byIndex(ctx, table, index, field, value) {
  return await ctx.db.query(table).withIndex(index).eq(field, value).collect();
}
async function event(ctx, eventId) {
  const row = await ctx.db.get('events', eventId);
  if (!row || !row.publicActive) throw new Error('event unavailable');
  return row;
}
async function invitation(ctx, eventId, userId = ctx.auth.userId) {
  return (await byIndex(ctx, 'invitations', 'by_event_user', 'eventId', eventId))
    .find((row) => row.userId === userId) ?? null;
}
async function requireMember(ctx, eventId) {
  const row = await invitation(ctx, eventId);
  if (!row || row.status !== 'active') throw new Error('event membership required');
  return row;
}
async function requireHost(ctx, eventId, cohost = false) {
  const row = await requireMember(ctx, eventId);
  if (row.role !== 'host' && !(cohost && row.role === 'cohost')) throw new Error('host authority required');
  return row;
}
function publicProjection(row) {
  return {
    eventId: row._id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt,
    revision: row.revision,
  };
}
async function applyRsvp(ctx, args) {
  if (!RSVP.has(args.response)) throw new Error('response must be yes, no, or maybe');
  if (!Number.isInteger(args.plusOneCount) || args.plusOneCount < 0 || args.plusOneCount > 3) throw new Error('plus one must be 0..3');
  const row = await event(ctx, args.eventId);
  const member = await requireMember(ctx, args.eventId);
  const prior = (await byIndex(ctx, 'rsvps', 'by_event_user', 'eventId', args.eventId)).find((rsvp) => rsvp.userId === ctx.auth.userId);
  const nextSeats = args.response === 'yes' ? 1 + args.plusOneCount : 0;
  const nextCount = row.attendanceCount - (prior?.seats ?? 0) + nextSeats;
  if (nextCount > row.capacity) throw new Error('event capacity exceeded');
  if (prior) {
    await ctx.db.patch('rsvps', prior._id, { response: args.response, plusOneCount: args.plusOneCount, seats: nextSeats });
  } else {
    await ctx.db.insert('rsvps', {
      namespace: row.namespace, eventId: row._id, userId: ctx.auth.userId, guestName: member.guestName,
      response: args.response, plusOneCount: args.plusOneCount, seats: nextSeats, synthetic: false,
    });
  }
  await ctx.db.patch('events', row._id, { attendanceCount: nextCount, revision: row.revision + 1 });
  return { response: args.response, plusOneCount: args.plusOneCount, attendanceCount: nextCount };
}

globalThis.__snapbackHandlers = {
  async publicEvents(ctx, args) {
    return (await byIndex(ctx, 'events', 'by_namespace_slug', 'namespace', args.namespace))
      .filter((row) => row.publicActive)
      .map(publicProjection);
  },
  async privateControls(ctx, args) {
    const row = await event(ctx, args.eventId);
    const member = await invitation(ctx, args.eventId);
    if (!member || member.status !== 'active' || !['host', 'cohost'].includes(member.role)) return [];
    return [{
      eventId: row._id, slug: row.slug, title: row.title, description: row.description,
      location: row.location, startsAt: row.startsAt, capacity: row.capacity,
      attendanceCount: row.attendanceCount, guestListVisibility: row.guestListVisibility,
      role: member.role, revision: row.revision,
    }];
  },
  async guestList(ctx, args) {
    const row = await event(ctx, args.eventId);
    const member = await invitation(ctx, args.eventId);
    if (!member || member.status !== 'active') return [];
    if (row.guestListVisibility === 'hosts' && !['host', 'cohost'].includes(member.role)) return [];
    const invites = await byIndex(ctx, 'invitations', 'by_event', 'eventId', args.eventId);
    const rsvps = await byIndex(ctx, 'rsvps', 'by_event', 'eventId', args.eventId);
    return invites.filter((invite) => invite.status === 'active').map((invite) => {
      const response = rsvps.find((rsvp) => rsvp.userId === invite.userId);
      return {
        userId: invite.userId, guestName: invite.guestName, role: invite.role,
        response: response?.response ?? 'invited', plusOneCount: response?.plusOneCount ?? 0,
        seats: response?.seats ?? 0,
      };
    });
  },
  async eventWall(ctx, args) {
    await event(ctx, args.eventId);
    const member = await invitation(ctx, args.eventId);
    if (!member || member.status !== 'active') return [];
    return (await byIndex(ctx, 'posts', 'by_event_ordinal', 'eventId', args.eventId))
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(({ authorId, authorName, body, ordinal }) => ({ authorId, authorName, body, ordinal }));
  },
  async reminderLedger(ctx, args) {
    await event(ctx, args.eventId);
    const member = await invitation(ctx, args.eventId);
    if (!member || member.status !== 'active' || !['host', 'cohost'].includes(member.role)) return [];
    return (await byIndex(ctx, 'reminderAttempts', 'by_event', 'eventId', args.eventId))
      .map(({ deliveryKey, trigger, attemptCount, status }) => ({ deliveryKey, trigger, attemptCount, status }));
  },
  async effectLedger(ctx, args) {
    await event(ctx, args.eventId);
    const member = await invitation(ctx, args.eventId);
    if (!member || member.status !== 'active' || !['host', 'cohost'].includes(member.role)) return [];
    return (await byIndex(ctx, 'notificationEffects', 'by_event', 'eventId', args.eventId))
      .map(({ idempotencyKey, attemptCount, status, certainty, providerReceipt }) => ({
        idempotencyKey, attemptCount, status, certainty, ...(providerReceipt ? { providerReceipt } : {}),
      }));
  },
  async fixtureAudit(ctx, args) {
    await requireHost(ctx, args.eventId, true);
    const primary = await event(ctx, args.eventId);
    const events = await byIndex(ctx, 'events', 'by_namespace_slug', 'namespace', primary.namespace);
    const contention = events.find((row) => row.slug === 'final-seat');
    const contendedRsvps = await byIndex(ctx, 'rsvps', 'by_event', 'eventId', contention._id);
    const invitations = await byIndex(ctx, 'invitations', 'by_event', 'eventId', primary._id);
    const posts = await byIndex(ctx, 'posts', 'by_event_ordinal', 'eventId', primary._id);
    return [{
      eventCount: events.length, contendedAttendance: contention.attendanceCount,
      contendedRsvps: contendedRsvps.length,
      activeInvitations: invitations.filter((row) => row.status === 'active').length,
      wallPosts: posts.length,
    }];
  },

  async setupFixture(ctx, args) {
    const existing = await byIndex(ctx, 'events', 'by_namespace_slug', 'namespace', args.namespace);
    if (existing.length) return { eventId: existing.find((row) => row.slug === 'launch-party')._id, reused: true };
    let primaryId = null;
    let contentionId = null;
    for (let index = 0; index < 20; index += 1) {
      const slug = index === 0 ? 'launch-party' : index === 1 ? 'final-seat' : `event-${String(index + 1).padStart(2, '0')}`;
      const eventId = await ctx.db.insert('events', {
        namespace: args.namespace, slug, hostId: ctx.auth.userId,
        title: index === 0 ? 'Snapback Summer Night' : index === 1 ? 'Final Seat' : `Community Event ${index + 1}`,
        description: index === 0 ? 'Music, food, and friends by the bay.' : 'Frozen bakeoff fixture',
        location: index === 0 ? 'Pier 70 · private gate B' : `Venue ${index + 1}`,
        startsAt: 1_800_000_000_000 + index * 86_400_000,
        capacity: index === 1 ? 50 : 100,
        attendanceCount: index === 1 ? 49 : 0,
        guestListVisibility: 'guests', publicActive: true, revision: 1,
      });
      if (index === 0) primaryId = eventId;
      if (index === 1) contentionId = eventId;
      for (const [userId, guestName, role] of [
        [ctx.auth.userId, 'Alice', 'host'], [args.bobId, 'Bob', 'guest'], [args.carolId, 'Carol', 'guest'],
      ]) {
        await ctx.db.insert('invitations', {
          namespace: args.namespace, eventId, userId, guestName, role, status: 'active',
        });
      }
    }
    for (let index = 0; index < 49; index += 1) {
      await ctx.db.insert('rsvps', {
        namespace: args.namespace, eventId: contentionId, userId: `fixture-guest-${index}`,
        guestName: `Fixture Guest ${index + 1}`, response: 'yes', plusOneCount: 0, seats: 1, synthetic: true,
      });
    }
    return { eventId: primaryId, contentionEventId: contentionId, eventCount: 20, contendedAttendance: 49 };
  },
  async editEvent(ctx, args) {
    const row = await event(ctx, args.eventId);
    await requireHost(ctx, args.eventId);
    await ctx.db.patch('events', row._id, { title: args.title, location: args.privateLocation, revision: row.revision + 1 });
    return { revision: row.revision + 1 };
  },
  async setGuestListVisibility(ctx, args) {
    if (!VISIBILITY.has(args.visibility)) throw new Error('visibility must be hosts or guests');
    const row = await event(ctx, args.eventId);
    await requireHost(ctx, args.eventId, true);
    await ctx.db.patch('events', row._id, { guestListVisibility: args.visibility, revision: row.revision + 1 });
    return { visibility: args.visibility };
  },
  async setRole(ctx, args) {
    if (!ROLES.has(args.role)) throw new Error('role must be cohost or guest');
    await event(ctx, args.eventId);
    await requireHost(ctx, args.eventId);
    const target = await invitation(ctx, args.eventId, args.userId);
    if (!target || target.status !== 'active') throw new Error('active invitation required');
    await ctx.db.patch('invitations', target._id, { role: args.role });
    return { role: args.role };
  },
  async revokeGuest(ctx, args) {
    await event(ctx, args.eventId);
    await requireHost(ctx, args.eventId, true);
    const target = await invitation(ctx, args.eventId, args.userId);
    if (!target || target.role === 'host') throw new Error('revocable guest required');
    await ctx.db.patch('invitations', target._id, { status: 'revoked' });
    return { revoked: true };
  },
  async rsvp(ctx, args) {
    return await applyRsvp(ctx, args);
  },
  async claimFinalSeat(ctx, args) {
    return await applyRsvp(ctx, { eventId: args.eventId, response: 'yes', plusOneCount: 0 });
  },
  async postToWall(ctx, args) {
    const row = await event(ctx, args.eventId);
    await requireMember(ctx, args.eventId);
    if (!String(args.body).trim()) throw new Error('post body required');
    await ctx.db.insert('posts', {
      namespace: row.namespace, eventId: row._id, authorId: ctx.auth.userId,
      authorName: args.authorName, body: String(args.body).trim(), ordinal: args.ordinal,
    });
    return { ordinal: args.ordinal };
  },
  async reserveNotification(ctx, args) {
    const row = await event(ctx, args.eventId);
    await requireHost(ctx, args.eventId, true);
    const prior = (await byIndex(ctx, 'notificationEffects', 'by_idempotency', 'idempotencyKey', args.idempotencyKey))[0];
    if (prior?.status === 'succeeded') return { terminal: true, status: prior.status, attemptCount: prior.attemptCount };
    if (prior) {
      await ctx.db.patch('notificationEffects', prior._id, { attemptCount: prior.attemptCount + 1, status: 'inflight' });
      return { terminal: false, attemptCount: prior.attemptCount + 1 };
    }
    await ctx.db.insert('notificationEffects', {
      namespace: row.namespace, eventId: row._id, requestedBy: ctx.auth.userId,
      idempotencyKey: args.idempotencyKey, attemptCount: 1, status: 'inflight', certainty: 'not-settled',
    });
    return { terminal: false, attemptCount: 1 };
  },
  async settleNotification(ctx, args) {
    const row = (await byIndex(ctx, 'notificationEffects', 'by_idempotency', 'idempotencyKey', args.idempotencyKey))[0];
    if (!row) throw new Error('notification reservation missing');
    await ctx.db.patch('notificationEffects', row._id, {
      status: args.status, certainty: args.certainty, ...(args.providerReceipt ? { providerReceipt: args.providerReceipt } : {}),
    });
    return { status: args.status, certainty: args.certainty, attemptCount: row.attemptCount };
  },
  async recordReminderAttempt(ctx, args) {
    const row = (await byIndex(ctx, 'events', 'by_namespace_slug', 'namespace', args.namespace))
      .find((candidate) => candidate.slug === args.eventSlug);
    if (!row) return { skipped: 'fixture-not-installed' };
    const prior = (await byIndex(ctx, 'reminderAttempts', 'by_delivery_key', 'deliveryKey', args.deliveryKey))[0];
    if (prior) return { deduplicated: true, attemptCount: prior.attemptCount };
    await ctx.db.insert('reminderAttempts', {
      namespace: args.namespace, eventId: row._id, deliveryKey: args.deliveryKey,
      trigger: args.trigger, attemptCount: 1, status: 'recorded',
    });
    return { deduplicated: false, attemptCount: 1 };
  },
};
