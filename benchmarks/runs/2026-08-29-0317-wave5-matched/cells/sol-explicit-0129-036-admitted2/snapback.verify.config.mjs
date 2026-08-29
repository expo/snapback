import { defineVerifyConfig } from '@expo/snapback-cli/verify';

import { runEvidenceProfile } from './scripts/verify-evidence-profile.mjs';

const milestones = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm8'];

export default defineVerifyConfig({
  schemaVersion: 'snapback.verify-config.v1',
  backendDirectory: './snapback',
  profiles: [{
    id: 'clique-evidence-closure',
    title: 'Clique typed suite and two-browser evidence closure',
    testFiles: [
      './scripts/verify-evidence-profile.mjs',
      './scripts/acceptance.mjs',
      './scripts/replay.mjs',
      './tests/evidence.test.mjs',
      ...milestones.flatMap((milestone) => [
        `./receipts/suite-${milestone}.json`,
        `./receipts/choreography-${milestone}.jsonl`,
        `./receipts/choreography-${milestone}.observations.jsonl`,
      ]),
      './receipts/replay.json',
      './receipts/replay-sample-50.json',
    ],
    requiredCapabilities: ['result_contract_v1'],
    paths: [],
    run: runEvidenceProfile,
  }],
});
