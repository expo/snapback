// Contention Calendar authors its shipping reservation write exactly once as
// generated HostPlan IR. Canonical ids and uniqueness remain server-owned.
// @ref LLP 0155#execution-contract — the generated Insert is both the local
// prediction carrier and the authoritative server operation.
// @ref LLP 0155#identity-model — intent stays distinct from the canonical
// reservation id until LLP 0133 settlement returns the id map.
import {
  arg,
  asc,
  concat,
  defineJsMutation,
  defineLiveQuery,
  defineMutation,
  eq,
  insert,
  returnBinding,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const resourceList = defineLiveQuery({
  table: 'resources',
  args: {},
  order: [asc('key')],
  index: 'by_key',
});

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

export const reserve = defineMutation({
  args: {
    idempotencyKey: v.string(),
    resourceKey: v.string(),
    slotKey: v.string(),
    ownerId: v.string(),
    title: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('reservations')),
  plan: insert('reservations', {
    idempotencyKey: arg('idempotencyKey'),
    resourceKey: arg('resourceKey'),
    slotKey: arg('slotKey'),
    resourceSlotKey: concat(arg('resourceKey'), '|', arg('slotKey')),
    ownerId: arg('ownerId'),
    title: arg('title'),
    createdAt: arg('now'),
  }, { bindIdAs: 'reservationId' }),
  returns: returnBinding('reservationId'),
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
