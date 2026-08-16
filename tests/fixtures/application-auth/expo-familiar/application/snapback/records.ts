import { query, v } from './generated/server';

export const listRecords = query({
  args: {},
  returns: v.array(v.object({ ownerId: v.principal(), value: v.string() })),
  auth: 'authenticated',
  reads: ['records'],
  handler: async () => [],
});
