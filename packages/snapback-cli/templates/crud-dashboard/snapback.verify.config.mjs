import { defineStarterVerifyProfile, defineVerifyConfig } from '@expo/snapback-cli/verify';
import { starterVerifyProfileOptions } from '@expo/snapback-acceptance';
import { acceptance } from './acceptance.mjs';

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
  profiles: [defineStarterVerifyProfile(starterVerifyProfileOptions(acceptance, {
    id: 'crud-dashboard-live',
    title: 'CRUD dashboard starter live acceptance',
    additionalTestFiles: [
      new URL('./carrier.mjs', import.meta.url),
      new URL(import.meta.resolve('@expo/snapback-cli/carrier-kit')),
    ],
  }))],
});
