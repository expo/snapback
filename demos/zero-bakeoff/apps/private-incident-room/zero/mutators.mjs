import {defineMutator, defineMutators} from '@rocicorp/zero';
import {zql} from './schema.mjs';
import {jsonValue} from './validation.mjs';

async function roleFor(tx, incidentID, userID) {
  return await tx.run(zql.incidentMember.where('incidentID', incidentID).where('userID', userID).one());
}

const postMessage = defineMutator(jsonValue, async ({tx, args, ctx}) => {
  const membership = await roleFor(tx, args.incidentID, ctx.userID);
  if (!membership || !['commander', 'responder'].includes(membership.role)) throw new Error('ZERO_IR_WRITE_DENIED');
  await tx.mutate.message.insert({id: args.id, incidentID: args.incidentID,
    sequence: args.sequence, authorID: ctx.userID, body: args.body});
  await tx.mutate.incident.update({id: args.incidentID, nextSequence: args.sequence + 1});
});
const removeParticipant = defineMutator(jsonValue, async ({tx, args, ctx}) => {
  const actor = await roleFor(tx, args.incidentID, ctx.userID);
  if (actor?.role !== 'commander') throw new Error('ZERO_IR_COMMANDER_REQUIRED');
  const target = await roleFor(tx, args.incidentID, args.userID);
  if (target) await tx.mutate.incidentMember.delete({id: target.id});
});
export const mutators = defineMutators({incidents: {postMessage, removeParticipant}});
