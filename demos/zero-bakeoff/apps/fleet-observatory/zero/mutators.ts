import {defineMutator, defineMutators} from '@rocicorp/zero';
import {zql, type AuthContext} from './schema.ts';

export type BurstArgs = {updates: ReadonlyArray<{eventID: string; message: string}>};

export const mutators = defineMutators({
  telemetry: {
    applyBurst: defineMutator(async ({tx, args, ctx}: {tx: any; args: BurstArgs; ctx: AuthContext}) => {
      if (args.updates.length > 1_000) throw new Error('burst exceeds 1,000 updates');
      for (const update of args.updates) {
        const event = await tx.run(zql.fo_event.where('id', update.eventID).one());
        if (!event) continue;
        const membership = await tx.run(zql.fo_membership.where('fleetID', event.fleetID).where('userID', ctx.userID).one());
        if (!membership) throw new Error('event not found');
        await tx.mutate.fo_event.update({id: event.id, message: update.message});
      }
    }),
  },
});

