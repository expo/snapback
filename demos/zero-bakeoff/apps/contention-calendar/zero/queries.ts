import { defineQueries, defineQuery } from '@rocicorp/zero';
import { z } from 'zod';
import { zql } from './schema.ts';

export const queries = defineQueries({
  schedule: defineQuery(() => zql.calendar_reservation.orderBy('slotKey', 'asc').orderBy('resourceID', 'asc')),
  slot: defineQuery(z.object({ slotKey: z.string() }), ({ args }) =>
    zql.calendar_reservation.where('slotKey', args.slotKey).orderBy('resourceID', 'asc')),
});
