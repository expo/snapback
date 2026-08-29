import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const milestones = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm8'];

export async function runEvidenceProfile({ artifact, profileId }) {
  assert.equal(profileId, 'clique-evidence-closure');
  assert.equal(typeof artifact?.identity?.inputsHash, 'string');
  for (const milestone of milestones) {
    const suite = JSON.parse(readFileSync(new URL(`../receipts/suite-${milestone}.json`, import.meta.url), 'utf8'));
    const choreography = readFileSync(new URL(`../receipts/choreography-${milestone}.jsonl`, import.meta.url), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line)).findLast((row) => row.type === 'segment-summary');
    assert.equal(suite.pass, true, `${milestone} suite`);
    assert.equal(suite.coverage.complete, true, `${milestone} suite coverage`);
    assert.equal(choreography?.green, true, `${milestone} choreography`);
  }
  return {
    ok: true,
    context: {
      target: { kind: 'local-generated-artifact', identity: artifact.identity.inputsHash },
      data: { kind: 'local-dev-sqlite-receipts', identity: artifact.seedIdentity.identity },
      authority: { kind: 'password-session-personas', identity: 'clique-fixture-personas-v1', principalClass: 'authenticated-fixture' },
      seed: artifact.seedIdentity,
    },
  };
}
