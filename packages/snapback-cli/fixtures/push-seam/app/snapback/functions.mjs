import {
  defineAction,
  defineConfig,
  defineJsMutation,
  definePushLedgerQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const config = defineConfig({
  expoPushAccessToken: {
    required: false,
    description: 'Optional Expo enhanced-push-security access token.',
  },
});

export const joinAsHost = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'joinAsHost',
  writes: ['appMembers'],
  result: results.value(v.null()),
});

export const leaveHost = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'leaveHost',
  writes: ['appMembers'],
  result: results.value(v.null()),
});

export const sendSelected = defineAction({
  auth: 'authenticated',
  args: {
    principalIds: v.array(v.principal()),
    title: v.string(),
    body: v.string(),
    dedupeKey: v.string(),
    redriveAmbiguous: v.optional(v.boolean()),
  },
  js: { source: 'handlers.mjs', exportName: 'sendSelected' },
  uses: ['expoPushAccessToken'],
  result: results.value(v.object({
    intentId: v.string(),
    attempt: v.integer(),
    targetCount: v.integer(),
    batchCount: v.integer(),
    state: v.string(),
    deduplicated: v.boolean(),
  })),
});

export const pushLedger = definePushLedgerQuery({ auth: 'authenticated' });
