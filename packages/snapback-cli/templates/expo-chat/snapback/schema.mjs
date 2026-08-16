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
  mechanisms: {
    guest: { kind: 'guest' },
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
    claiming: ['emailCode'],
    reaping: {
      afterMs: AUTH_DEFAULT_UNCLAIMED_GUEST_RETENTION_MS,
      cleanup: { kind: 'declarative', default: 'tombstone', tables: {} },
    },
  },
  secretReferences: {},
});

export default defineSchema(
  {
    users: defineTable({
      handle: v.string(),
      name: v.string(),
      color: v.string(),
    }).index('by_handle', ['handle'], { unique: true }).sync(),
    conversations: defineTable({
      kind: v.string(),
      title: v.string(),
      updatedAt: v.integer(),
      lastPreview: v.string(),
    }).index('by_updated', ['updatedAt']).sync(),
    // @ref LLP 0196#program — the T0 starter models
    // inbox membership explicitly so the visible test persona changes data.
    memberships: defineTable({
      conversationId: v.id('conversations'),
      userId: v.id('users'),
    })
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
