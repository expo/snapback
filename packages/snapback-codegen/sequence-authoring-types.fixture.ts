import {
  allocateSequence,
  arg,
  defineJsMutation,
  defineSchema,
  defineSequence,
  defineTable,
  v,
} from './define.js';

const orgs = defineTable({ ownerId: v.principal(), name: v.string() }).sync();
const items = defineTable({ orgId: v.id('orgs'), sequence: v.integer() }).sync();

defineSchema({ orgs, items }, {
  sequences: {
    jobs: defineSequence({ scope: orgs }),
    publicJobs: defineSequence({ scope: orgs, scopeAccess: 'public.v1' }),
  },
  requiredCapabilities: ['sequence_allocation_v1'],
});

allocateSequence('jobs', arg('orgId'), 'sequence');

defineJsMutation({
  reads: ['orgs'],
  writes: ['items'],
  sequences: ['jobs'],
  authScopeField: 'ownerId',
  handler: async (ctx, args) => ctx.sequence.allocate('jobs', args.orgId),
});
