// Faceplate r2 — avatar & profile backend (sessions mode).
// One table: a profile row per principal carrying a typed avatar reference.
// `assetSharing: public-read` is the closest declared posture to "any
// viewer of the profile row may fetch the avatar" — item 3's requirement.

import { defineSchema, defineTable, v } from '../../../../_kit/define.mjs';

export default defineSchema(
  {
    profiles: defineTable({
      ownerId: v.principal(),
      displayName: v.string(),
      avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
    })
      .index('by_owner', ['ownerId'])
      .assetSharing({ kind: 'public-read' })
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
