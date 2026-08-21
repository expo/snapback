import { defineStarterVerifyProfile, defineVerifyConfig } from '@expo/snapback-cli/verify';

// @ref LLP 0196#program — the scaffold's ordinary proof command delegates
// the live starter acceptance to LLP 0146 D2 and retains that receipt.
export default defineVerifyConfig({
  schemaVersion: 'snapback.verify-config.v1',
  backendDirectory: './snapback',
  context: {
    data: { kind: 'fresh-isolated-sqlite', identity: 'crud-dashboard-starter-acceptance.v1' },
    authority: { kind: 'local-admin', identity: 'managed-ready-file-admin', principalClass: 'local-admin' },
    seed: { kind: 'authored-seed-bytes', identity: null },
  },
  profiles: [defineStarterVerifyProfile({
    id: 'crud-dashboard-live',
    title: 'CRUD dashboard starter live acceptance',
    acceptanceFile: new URL('./acceptance.mjs', import.meta.url),
    additionalTestFiles: [
      new URL('./carrier.mjs', import.meta.url),
      new URL(import.meta.resolve('@expo/snapback-cli/carrier-kit')),
    ],
    paths: [
      { id: 'relational-project-directory', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex', functionId: 'crud-dashboard:projectDirectory' },
      { id: 'create-project', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex', functionId: 'crud-dashboard:createProject' },
      { id: 'update-project-live-detail', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'delete-project', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
    ],
    provenanceBaseline: [
      'relational-project-directory',
      'create-project',
      'update-project-live-detail',
      'delete-project',
    ],
  })],
});
