import { defineSchema, defineTable, v } from './generated/server';

export default defineSchema({
  videos: defineTable({
    ownerId: v.principal(),
    clip: v.assetRef({ upload: 'media.videoUpload' }),
  }).assetSharing({ kind: 'owner', field: 'ownerId' }),
}, { auth: { mode: 'sessions' } });
