import { defineJsMutation, results, v } from '@expo/snapback-codegen/define';

// JS-tier mutation (no HostPlan) so no generated mutation IR is emitted:
// custody 'none' stays raw at-most-once instead of being IR-upgraded,
// matching the CI-scale replay test's fixture reference shape
// (packages/snapback-acceptance/replay.test.mjs `mutation`, no mutationIr).
export const apply = defineJsMutation({
  auth: 'authenticated',
  args: { seq: v.integer(), persona: v.string() },
  writes: ['rows'],
  result: results.value(v.id('rows')),
  handler: async (ctx, args) => ctx.db.insert('rows', { seq: args.seq, persona: args.persona }),
});
