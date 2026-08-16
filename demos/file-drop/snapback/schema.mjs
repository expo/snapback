import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema(
  {
    photos: defineTable({
      ownerId: v.principal(),
      title: v.string(),
      image: v.assetRef({ upload: 'photoUpload' }),
    })
      .visibility({ kind: 'public-read' })
      // @ref LLP 0044#asset-read-authorization — the gallery and its bytes
      // are public; upload and attachment still require a session identity.
      .assetSharing({ kind: 'public-read' })
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
