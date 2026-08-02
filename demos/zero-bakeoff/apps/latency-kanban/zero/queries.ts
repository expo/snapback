import { defineQueries, defineQuery } from '@rocicorp/zero';
import { z } from 'zod';
import { zql } from './schema.ts';

export const queries = defineQueries({
  board: defineQuery(() => zql.kanban_card.orderBy('columnID', 'asc').orderBy('rank', 'asc')),
  column: defineQuery(z.object({ columnID: z.string() }), ({ args }) =>
    zql.kanban_card.where('columnID', args.columnID).orderBy('rank', 'asc')),
});
