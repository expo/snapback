import {
  defineAuth,
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export default defineSchema(
  {
    // This demo is an intentionally shared public bug board. Authentication remains
    // available in the application descriptor without gating the first-use flow.
    bugs: defineTable({
      title: v.string(),
      description: v.string(),
      priority: v.string(),
      status: v.string(),
      createdAt: v.integer(),
    }).visibility({ kind: 'public-read' }).index('by_created_at', ['createdAt']).sync(),
  },
  { auth: { mode: 'sessions' }, authProgram },
);
