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
    // @ref LLP 0234#phase-g2--d2-enforcing-closure — this starter's anonymous
    // list/create flow is a shared public board, so every todo is public by design.
    todos: defineTable({
      title: v.string(),
      completed: v.boolean(),
    }).visibility({ kind: 'public-read' }).index('by_title', ['title']).sync(),
  },
  { auth: { mode: 'sessions' }, authProgram },
);
