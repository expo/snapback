// Clip Locker — Snapback arm (LLP 0139 App C). One clips table; the
// share posture is chosen at the intent (private-signed), which is the
// 0044 way: delivery policy follows the asset, so a clip that must be
// shareable is declared shareable from the start.
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema(
  {
    clips: defineTable({
      ownerId: v.principal(),
      title: v.string(),
      video: v.optional(v.assetRef({ upload: 'clipUpload' })),
    })
      .assetSharing({ kind: 'owner', field: 'ownerId' })
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
