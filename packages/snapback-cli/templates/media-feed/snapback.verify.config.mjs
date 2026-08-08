import { defineStarterVerifyProfile, defineVerifyConfig } from '@expo/snapback-cli/verify';

// @ref LLP 0196#program — the scaffold's ordinary proof command delegates
// the live starter acceptance to LLP 0146 D2 and retains that receipt.
export default defineVerifyConfig({
  schemaVersion: 'snapback.verify-config.v1',
  backendDirectory: './snapback',
  context: {
    data: { kind: 'fresh-isolated-sqlite', identity: 'media-feed-starter-acceptance.v1' },
    authority: { kind: 'ordinary-session', identity: 'acceptance@media-feed.test', principalClass: 'authenticated' },
    seed: { kind: 'authored-seed-bytes', identity: null },
  },
  profiles: [defineStarterVerifyProfile({
    id: 'media-feed-live',
    title: 'Media feed starter live acceptance',
    acceptanceFile: new URL('./acceptance.mjs', import.meta.url),
    paths: [
      { id: 'retained-live-feed-pages', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'session-upload-and-typed-attach', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'thumbnail-rendition-delivery', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'display-rendition-delivery', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
    ],
  })],
});
