import {
  defineAuth,
  defineSchema,
  defineTable,
  v,
} from '../../_kit/define.mjs';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
      minimumLength: 8,
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
    profiles: defineTable({
      ownerId: v.principal(),
      fixtureId: v.optional(v.string()),
      handle: v.string(),
      displayName: v.string(),
      bio: v.string(),
      location: v.string(),
      link: v.string(),
      avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
      avatarSourceDigest: v.optional(v.string()),
    })
      .index('by_owner', ['ownerId'], { unique: true })
      .index('by_fixture_id', ['fixtureId'], { unique: true })
      .index('by_handle', ['handle'], { unique: true })
      .visibility({ kind: 'public-read' })
      .assetSharing({ kind: 'public-read' })
      .sync(),
  },
  {
    auth: { mode: 'sessions' },
    authProgram,
  },
);
