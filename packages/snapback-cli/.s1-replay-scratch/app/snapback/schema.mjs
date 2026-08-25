import { defineAuth, defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// LLP 0307.000 Acceptance 1 fixture backend: same shape as the CI replay
// test's synthetic `apply(seq)` mutation, realized as a real generated app.
// Sessions mode is required because minted replay custody mints real
// sessions via `snapback session mint` (auth.mintSession requires settled
// sessions mode). Auth program mirrors templates/todo-contract.
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
    rows: defineTable({ seq: v.integer(), persona: v.string() })
      .visibility({ kind: 'public-read' })
      .index('by_seq', ['seq'])
      .sync(),
  },
  { auth: { mode: 'sessions' }, authProgram },
);
