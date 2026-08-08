import { defineVerifyConfig } from '@expo/snapback-cli/verify';

import { runMinimalProfile } from './minimal-profile.mjs';

export default defineVerifyConfig({
  schemaVersion: 'snapback.verify-config.v1',
  backendDirectory: './snapback',
  profiles: [{
    id: 'local-headless',
    title: 'local headless acceptance',
    testFiles: ['./minimal-profile.mjs'],
    requiredCapabilities: ['result_contract_v1'],
    paths: [{
      id: 'list-success',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      functionId: 'app:list',
    }],
    run: runMinimalProfile,
  }],
});
