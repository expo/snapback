import { defineSchema, defineTable, v } from './generated/server';

export default defineSchema({
  videos: defineTable({
    ownerId: v.principal(),
    clip: v.assetRef({ upload: 'media.videoUpload' }),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .assetSharing({ kind: 'owner', field: 'ownerId' }),
}, { auth: { mode: 'sessions' } });
