// Serialized Candidate-A witness for the frozen Contention Calendar common
// path. The server remains authoritative for ids and unique constraints.

export const CALENDAR_FROZEN_CHECKS = Object.freeze([
  'cc.provisional-render',
  'cc.exactly-one-winner',
  'cc.loser-correction',
  'cc.ambiguous-retry-idempotence',
  'cc.nonoverlap-success',
  'cc.observer-convergence',
  'cc.cleanup',
]);

export const CALENDAR_COMMON_PATH_STEP_KINDS = Object.freeze(['Insert']);

export const CALENDAR_SCHEMA = Object.freeze({
  tables: [{
    name: 'reservations',
    fields: [
      { name: 'idempotencyKey', field_type: 'String', optional: false },
      { name: 'resourceKey', field_type: 'String', optional: false },
      { name: 'slotKey', field_type: 'String', optional: false },
      { name: 'resourceSlotKey', field_type: 'String', optional: false },
      { name: 'ownerId', field_type: 'String', optional: false },
      { name: 'title', field_type: 'String', optional: false },
      { name: 'createdAt', field_type: 'Integer', optional: false },
    ],
    indexes: [],
    syncable: true,
  }],
});

export const CALENDAR_RESERVE_PLAN = Object.freeze({
  steps: [{
    Insert: {
      table: 'reservations',
      values: {
        idempotencyKey: { Arg: 'idempotencyKey' },
        resourceKey: { Arg: 'resourceKey' },
        slotKey: { Arg: 'slotKey' },
        resourceSlotKey: {
          Concat: [{ Arg: 'resourceKey' }, { Literal: '|' }, { Arg: 'slotKey' }],
        },
        ownerId: { Arg: 'ownerId' },
        title: { Arg: 'title' },
        createdAt: { Arg: 'now' },
      },
      bind_id_as: 'reservationId',
    },
  }],
  return_value: { Binding: 'reservationId' },
});

export const CALENDAR_RESERVE_ARGS = Object.freeze({
  idempotencyKey: 'intent:alice:room-00:slot-final',
  resourceKey: 'room-00',
  slotKey: 'slot-final',
  ownerId: 'alice',
  title: 'Planning',
  now: 1_787_000_000_000,
});
