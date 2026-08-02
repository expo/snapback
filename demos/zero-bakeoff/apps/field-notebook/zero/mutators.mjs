import {defineMutator, defineMutators} from '@rocicorp/zero';
import {zql} from './schema.mjs';
import {jsonValue} from './validation.mjs';

const create = defineMutator(jsonValue, async ({tx, args, ctx}) => {
  await tx.mutate.fieldRecord.insert({id: args.id, assignmentID: args.assignmentID,
    assignedTo: ctx.userID, title: args.title, body: args.body, checklistDone: 0, revision: 1, conflict: null});
});
const update = defineMutator(jsonValue, async ({tx, args, ctx}) => {
  const prior = await tx.run(zql.fieldRecord.where('id', args.id).one());
  if (!prior || prior.assignedTo !== ctx.userID) throw new Error('ZERO_NOTEBOOK_WRITE_DENIED');
  await tx.mutate.fieldRecord.update({id: args.id, body: args.body, revision: args.revision});
});
export const mutators = defineMutators({notebook: {create, update}});
