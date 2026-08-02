import {
  arg,
  asc,
  defineJsMutation,
  defineLiveQuery,
  eq,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const schedule = defineLiveQuery({
  table: 'reservations',
  args: {},
  order: [asc('slotKey'), asc('resourceKey')],
  index: 'by_slot_owner',
});

export const reservationsForSlot = defineLiveQuery({
  table: 'reservations',
  args: { slotKey: v.string(), ownerId: v.string() },
  filter: [eq('slotKey', arg('slotKey')), eq('ownerId', arg('ownerId'))],
  order: [asc('resourceKey')],
  index: 'by_slot_owner',
});

export const reserve = defineJsMutation({
  args: {
    idempotencyKey: v.string(),
    resourceKey: v.string(),
    slotKey: v.string(),
    ownerId: v.string(),
    title: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('reservations')),
  reads: ['reservations'],
  writes: ['reservations'],
  handler: async (ctx, args) => {
    const prior = await ctx.db.query('reservations')
      .withIndex('by_idempotency').eq('idempotencyKey', args.idempotencyKey).first();
    if (prior) return prior._id;
    return await ctx.db.insert('reservations', {
      idempotencyKey: args.idempotencyKey,
      resourceKey: args.resourceKey,
      slotKey: args.slotKey,
      resourceSlotKey: `${args.resourceKey}|${args.slotKey}`,
      ownerId: args.ownerId,
      title: args.title,
      createdAt: args.now,
    });
  },
});

export const clearReservations = defineJsMutation({
  args: {},
  result: results.value(v.integer()),
  reads: ['reservations'],
  writes: ['reservations'],
  handler: async (ctx) => {
    const rows = await ctx.db.query('reservations').collect();
    for (const row of rows) await ctx.db.delete('reservations', row._id);
    return rows.length;
  },
});
