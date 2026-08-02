import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql} from './schema.mjs';

export const queries = defineQueries({notebook: {
  assigned: defineQuery(({ctx}) => zql.fieldRecord.where('assignedTo', ctx.userID).orderBy('title', 'asc')),
}});
