import { defineJsLiveQuery, results, v } from '@expo/snapback-codegen/define';

const listRecords = defineJsLiveQuery({
  args: {},
  result: results.records(v.object({ ownerId: v.principal(), value: v.string() })),
  auth: 'authenticated',
  reads: ['records'],
  handler: async () => [],
});

export { listRecords as "records.listRecords" };
