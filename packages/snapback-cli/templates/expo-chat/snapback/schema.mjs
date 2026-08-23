import {
  AUTH_DEFAULT_UNCLAIMED_GUEST_RETENTION_MS,
  defineAuth,
  defineEphemeral,
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';
import { typing } from './surface-model.mjs';

// @ref LLP 0214#11-guest-first-template-posture — this starter explicitly
// opts into guest identity; guest auth is not a platform-wide default.
const authProgram = defineAuth({
  version: 1,
  // Native durable-required remains refused until the per-OS Phase 2 proof in
  // issues/20260815-llp-0258-phase-2-native-custody-evidence.md passes. This
  // disposable starter therefore makes its volatile auth custody explicit.
  custody: 'volatile-explicit',
  mechanisms: {
    guest: { kind: 'guest' },
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
    emailCode: {
      kind: 'email-code',
      identityKind: 'email',
      provider: 'emailCode',
      canonicalization: 'email-v1',
      delivery: 'email',
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
  guestPolicy: {
    enabled: true,
    claiming: ['emailCode', 'password'],
    reaping: {
      afterMs: AUTH_DEFAULT_UNCLAIMED_GUEST_RETENTION_MS,
      cleanup: { kind: 'declarative', default: 'tombstone', tables: {} },
    },
  },
  abuseBudgets: { version: 1, preset: 'guest-entry-v1' },
  secretReferences: {},
});

export default defineSchema(
  {
    // @ref LLP 0234#phase-g2--d2-enforcing-closure — retained history in this
    // seeded test-persona starter is public by design; production chat uses membership.
    users: defineTable({
      handle: v.string(),
      name: v.string(),
      color: v.string(),
    }).visibility({ kind: 'public-read' }).index('by_handle', ['handle'], { unique: true }).sync(),
    conversations: defineTable({
      kind: v.string(),
      title: v.string(),
      updatedAt: v.integer(),
      lastPreview: v.string(),
    }).visibility({ kind: 'public-read' }).index('by_updated', ['updatedAt']).sync(),
    // @ref LLP 0196#program — the T0 starter models
    // inbox membership explicitly so the visible test persona changes data.
    memberships: defineTable({
      conversationId: v.id('conversations'),
      userId: v.id('users'),
    })
      .visibility({ kind: 'public-read' })
      .index('by_user', ['userId'])
      .index('by_conversation', ['conversationId'])
      .index('by_conversation_user', ['conversationId', 'userId'], { unique: true })
      .sync(),
    messages: defineTable({
      conversationId: v.id('conversations'),
      senderId: v.id('users'),
      kind: v.string(),
      text: v.optional(v.string()),
      // The image field admits only assets finalized through the
      // messageImageUpload intent declared in functions.mjs.
      image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
      replyToId: v.optional(v.id('messages')),
      sentAt: v.integer(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_conversation_sent', ['conversationId', 'sentAt'])
      // Starter choice: message images are public-read. A production chat
      // derives byte authority from conversation membership instead.
      .assetSharing({ kind: 'public-read' })
      .sync(),
    reactions: defineTable({
      conversationId: v.id('conversations'),
      messageId: v.id('messages'),
      userId: v.id('users'),
      emoji: v.string(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_conversation', ['conversationId'])
      .index('by_message', ['messageId'])
      .index('by_message_user_emoji', ['messageId', 'userId', 'emoji'], { unique: true })
      .sync(),
  },
  {
    // Sessions lets `bun run dev` → `snapback dev snapback --expo` mint an
    // ordinary session automatically, so authenticated send/upload works
    // with zero edits. App-side uploads require sessions custody and cannot
    // work in dev mode.
    auth: { mode: 'sessions' },
    authProgram,
    ephemeral: defineEphemeral({ typing }),
  },
);
