import {
  defineAssetUpload,
  defineLiveQuery,
} from '@expo/snapback-codegen/define';

export const profileImageUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 8_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const listProfiles = defineLiveQuery({
  table: 'profiles',
  args: {},
  auth: 'public',
});
