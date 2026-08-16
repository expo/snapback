import {
  definePushSeam,
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

export const appMembers = defineTable({
  principal: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'principal' }).membership({
  principal: 'principal',
  role: 'role',
  roles: ['host'],
  scope: 'app',
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['host'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['host'] },
  ],
});

export const pushSeam = definePushSeam({
  appScope: {
    easProjectId: 'fake-expo-push-seam',
    applicationId: 'dev.expo.snapback.push-seam',
    environment: 'test',
  },
  registry: { idleRetentionMs: 86_400_000 },
  audiences: {
    selectedGuests: {
      resolve: { principalsArg: 'principalIds', maxItems: 10 },
      authorize: { membership: appMembers, roles: ['host'] },
    },
  },
  uses: ['expoPushAccessToken'],
  ledger: { retentionMs: 86_400_000 },
});

export default defineSchema({ appMembers }, {
  auth: { mode: 'sessions' },
  pushSeam,
});
