import {
  defineStarterVerifyProfile,
  defineVerifyConfig,
} from '@expo/snapback-cli/verify';

// @ref LLP 0196#program — the scaffold's one proof command delegates its
// existing live starter acceptance to LLP 0146 D2 and retains that receipt.
export default defineVerifyConfig({
  schemaVersion: 'snapback.verify-config.v1',
  backendDirectory: './snapback',
  context: {
    data: { kind: 'fresh-isolated-sqlite', identity: 'react-starter-acceptance.v1' },
    authority: {
      kind: 'local-admin',
      identity: 'managed-ready-file-admin',
      principalClass: 'local-admin',
    },
    seed: { kind: 'authored-seed-bytes', identity: null },
  },
  profiles: [defineStarterVerifyProfile({
    id: 'react-live',
    title: 'React starter live acceptance',
    acceptanceFile: new URL('./acceptance.mjs', import.meta.url),
    additionalTestFiles: [
      new URL('./carrier.mjs', import.meta.url),
      new URL(import.meta.resolve('@expo/snapback-cli/carrier-kit')),
    ],
    paths: [
      { id: 'list-bugs', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'create-bug', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'update-bug-status', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
    ],
  })],
});
