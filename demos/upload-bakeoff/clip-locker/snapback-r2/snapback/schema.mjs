// Clip Locker (round 2) — a large-video vault on Snapback assets.
// One table: clips owned by their uploader. Two typed asset references:
// `video` (private-strict delivery — ranged playback under per-request
// auth) and `shareVideo` (private-signed — bounded share links).
import { defineSchema, defineTable, v } from '../../../../_kit/define.mjs';

export default defineSchema(
  {
    clips: defineTable({
      ownerId: v.principal(),
      title: v.string(),
      video: v.optional(v.assetRef({ upload: 'clipUpload' })),
      shareVideo: v.optional(v.assetRef({ upload: 'shareClipUpload' })),
    })
      .index('by_owner', ['ownerId'])
      .assetSharing({ kind: 'owner', field: 'ownerId' })
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
