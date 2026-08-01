// Faceplate on Snapback (LLP 0139 App A): one profiles table; the avatar is
// a typed reference whose read authority flows via-references through the
// app-public profile row.
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema(
  {
    profiles: defineTable({
      ownerId: v.principal(),
      displayName: v.string(),
      avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
    })
      .assetSharing({ kind: 'public-read' })
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
