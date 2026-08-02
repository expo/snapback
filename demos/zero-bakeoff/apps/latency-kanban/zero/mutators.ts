// @ref LLP 0138#a2--latency-kanban — shared Zero mutators predict locally and
// enforce lock/revision authority in PostgreSQL on their server execution.
import { defineMutator, defineMutators } from '@rocicorp/zero';
import { z } from 'zod';
import { zql } from './schema.ts';

const moveArgs = z.object({
  id: z.string(), columnID: z.string(), rank: z.number(), expectedRevision: z.number(),
});

export const mutators = defineMutators({
  card: {
    move: defineMutator(moveArgs, async ({ tx, args }) => {
      if (tx.location === 'client') {
        await tx.mutate.kanban_card.update({
          id: args.id, columnID: args.columnID, rank: args.rank,
          revision: args.expectedRevision + 1,
        });
        return;
      }
      const sql = tx.dbTransaction.wrappedTransaction as import('postgres').TransactionSql;
      const rows = await sql.unsafe(
        'update kanban_card set column_id = $1, rank = $2, revision = revision + 1 where id = $3 and revision = $4 and locked = 0 returning id, revision',
        [args.columnID, args.rank, args.id, args.expectedRevision],
      );
      if (rows.length !== 1) {
        const current = await tx.run(zql.kanban_card.where('id', args.id).one());
        if (current?.locked) throw new Error('CARD_LOCKED');
        throw new Error('CARD_REVISION_CONFLICT');
      }
      return;
    }),
  },
});
