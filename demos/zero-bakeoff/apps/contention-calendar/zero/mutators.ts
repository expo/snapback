// @ref LLP 0138#a3--contention-calendar — the client predicts one row; the
// PostgreSQL unique(resource_id, slot_key) boundary chooses the sole winner.
import { defineMutator, defineMutators } from '@rocicorp/zero';
import { z } from 'zod';
import { zql } from './schema.ts';

export const reserveArgs = z.object({
  id: z.string(), idempotencyKey: z.string(), resourceID: z.string(),
  slotKey: z.string(), ownerID: z.string(), title: z.string(), createdAt: z.number(),
});

export const mutators = defineMutators({
  reservation: {
    reserve: defineMutator(reserveArgs, async ({ tx, args }) => {
      if (tx.location === 'client') {
        const prior = await tx.run(zql.calendar_reservation.where('idempotencyKey', args.idempotencyKey).one());
        if (prior) return;
        await tx.mutate.calendar_reservation.insert(args);
        return;
      }
      const sql = tx.dbTransaction.wrappedTransaction as import('postgres').TransactionSql;
      const prior = await sql.unsafe('select id from calendar_reservation where idempotency_key = $1', [args.idempotencyKey]);
      if (prior.length) return;
      await sql.unsafe(
        'insert into calendar_reservation (id,idempotency_key,resource_id,slot_key,owner_id,title,created_at) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [args.id, args.idempotencyKey, args.resourceID, args.slotKey, args.ownerID, args.title, args.createdAt],
      );
      return;
    }),
  },
});
