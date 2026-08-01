// Asset conformance fixture functions: two upload intents (image strip with
// required variants; owner-only files) and the mutation set the vectors
// drive, including the real `ctx.assets.attach` handler the guide
// transcludes and the forged-write refusal case.
import {
  arg,
  authUserId,
  defineAssetUpload,
  defineJsMutation,
  defineMutation,
  insert,
  returnBinding,
  v,
} from '@expo/snapback-codegen/define';

export const photoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png', 'image/jpeg'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [
      { key: 'thumb', width: 4, required: true },
      { key: 'display', width: 8, required: true },
    ],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const fileUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream', 'application/zip'], maxBytes: 100_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// Large enough to force several default-size (4 MiB) TUS chunks: the
// defaults-vs-limits drift the 2 MiB policy-peek regression hid behind
// 64-byte suite chunks (issues/closed/20260801-0044-policy-gate-caps-tus-chunks.md).
export const bulkUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 32_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// The pasteable-delivery pair (LLP 0044 §Delivery profiles, dated note
// 2026-07-31): a public-immutable cover and a private-signed share, both
// strip-declared images with the primary as the only rendition.
export const coverUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png'], maxBytes: 1_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const shareUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-signed' },
  access: { read: 'owner-only' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const createWorkspace = defineJsMutation({
  auth: 'authenticated',
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'createWorkspace',
  writes: ['workspaces', 'workspaceMembers'],
});

export const addMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { workspaceId: v.id('workspaces'), userId: v.principal() },
  source: 'handlers.mjs',
  exportName: 'addMember',
  writes: ['workspaceMembers'],
});

export const leaveWorkspace = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { workspaceId: v.id('workspaces') },
  source: 'handlers.mjs',
  exportName: 'leaveWorkspace',
  writes: ['workspaceMembers'],
});

// Host-plan attachment: the commit boundary derives the admission from the
// field's schema-declared upload restriction (LLP 0044 §Typed references),
// so these plans attach without handler execution.
export const createNotePlan = defineMutation({
  auth: 'authenticated',
  args: { workspaceId: v.id('workspaces'), body: v.string(), assetId: v.string() },
  plan: insert('notes', {
    workspaceId: arg('workspaceId'),
    authorId: authUserId(),
    body: arg('body'),
    photo: arg('assetId'),
  }, { bindIdAs: 'id' }),
  returns: returnBinding('id'),
});

export const createPhotoPlan = defineMutation({
  auth: 'authenticated',
  args: { caption: v.string(), assetId: v.string() },
  plan: insert('photos', {
    ownerId: authUserId(),
    caption: arg('caption'),
    image: arg('assetId'),
  }, { bindIdAs: 'id' }),
  returns: returnBinding('id'),
});

export const createMixedPlan = defineMutation({
  auth: 'authenticated',
  args: { title: v.string(), assetId: v.string() },
  plan: insert('mixedDocs', {
    ownerId: authUserId(),
    title: arg('title'),
    attachment: arg('assetId'),
  }, { bindIdAs: 'id' }),
  returns: returnBinding('id'),
});

// The unrestricted-field refusal: openDocs.attachment carries no upload
// restriction, so a host plan has no declared intent to derive an
// admission from and must refuse.
export const createOpenDocPlan = defineMutation({
  auth: 'authenticated',
  args: { title: v.string(), assetId: v.string() },
  plan: insert('openDocs', {
    ownerId: authUserId(),
    title: arg('title'),
    attachment: arg('assetId'),
  }, { bindIdAs: 'id' }),
  returns: returnBinding('id'),
});

export const createPhoto = defineJsMutation({
  auth: 'authenticated',
  args: { caption: v.string(), assetId: v.string() },
  source: 'handlers.mjs',
  exportName: 'createPhoto',
  writes: ['photos'],
});

export const clearPhoto = defineJsMutation({
  auth: 'authenticated',
  args: { id: v.id('photos') },
  source: 'handlers.mjs',
  exportName: 'clearPhoto',
  writes: ['photos'],
});

export const forgePhoto = defineJsMutation({
  auth: 'authenticated',
  args: { caption: v.string(), assetId: v.string() },
  source: 'handlers.mjs',
  exportName: 'forgePhoto',
  writes: ['photos'],
});

