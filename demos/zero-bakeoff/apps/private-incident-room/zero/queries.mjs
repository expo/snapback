import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql} from './schema.mjs';
import {jsonValue} from './validation.mjs';

export const queries = defineQueries({
  incidents: {
    room: defineQuery(jsonValue, ({args, ctx}) => zql.message
      .where('incidentID', args.incidentID)
      .where(({exists}) => exists('members', (q) => q.where('userID', ctx.userID)))
      .related('incident')
      .related('members', (q) => q.where('userID', ctx.userID))
      .orderBy('sequence', 'asc')),
  },
});
