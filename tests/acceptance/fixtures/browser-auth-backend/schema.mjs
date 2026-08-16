import {
  defineAuth,
  defineSchema,
  defineTable,
  v,
} from '../../../../demos/_kit/define.mjs';

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

export default defineSchema({
  notes: defineTable({
    ownerId: v.principal(),
    label: v.string(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .sync(),
}, { auth: { mode: 'sessions' }, authProgram });
