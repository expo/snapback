import { defineAuth } from '@expo/snapback-codegen/define';
import { defineSchema, defineTable, v } from './generated/server';

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
  records: defineTable({ ownerId: v.principal(), value: v.string() })
    .visibility({ kind: 'owner', field: 'ownerId' }),
}, { auth: { mode: 'sessions' }, authProgram });
