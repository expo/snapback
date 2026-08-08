import { defineEphemeral, defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
import { typing } from './surface-model.mjs';

export default defineSchema(
  {
    users: defineTable({
      handle: v.string(),
      name: v.string(),
      color: v.string(),
    }).index('by_handle', ['handle'], { unique: true }).sync(),
    conversations: defineTable({
      title: v.string(),
      updatedAt: v.integer(),
      lastPreview: v.string(),
    }).index('by_updated', ['updatedAt']).sync(),
    messages: defineTable({
      conversationId: v.id('conversations'),
      senderId: v.id('users'),
      kind: v.string(),
      text: v.optional(v.string()),
      // The image field admits only assets finalized through the
      // messageImageUpload intent declared in functions.mjs.
      image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
      sentAt: v.integer(),
    })
      .index('by_conversation_sent', ['conversationId', 'sentAt'])
      // Starter choice: message images are public-read. A production chat
      // derives byte authority from conversation membership instead.
      .assetSharing({ kind: 'public-read' })
      .sync(),
  },
  {
    // Sessions lets `bun run dev` → `snapback dev snapback --expo` mint an
    // ordinary session automatically, so authenticated send/upload works
    // with zero edits. App-side uploads require sessions custody and cannot
    // work in dev mode.
    auth: { mode: 'sessions' },
    ephemeral: defineEphemeral({ typing }),
  },
);
