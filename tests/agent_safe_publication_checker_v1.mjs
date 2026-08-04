import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  allowedPublicationPath,
  implementationDigestAt,
  runChecker,
  validatePublishedEvidenceSemantics,
  validatePublicationRecord,
} from '../scripts/check-agent-safe-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storage = {
  id: 'agent_safe_storage_v1',
  anchor: 'src/local-agent-safe-storage-publication.anchor.json',
  carrier: 'src/local-agent-safe-storage-publication.carrier.json',
  receipt: 'tests/acceptance/receipts/agent-safe-storage-publication.2026-08-04.v1.json',
  components: [
    'ordinaryMutationHostPlanEnvelope',
    'ordinaryMutationIbexBufferedEnvelope',
    'hostChildMutationHostPlanEnvelope',
    'hostChildMutationIbexBufferedEnvelope',
    'generatedOwnedCrudOwnerCreateHostPlanExplanation',
    'generatedOwnedCrudOwnerUpdateHostPlanExplanation',
  ],
};
const derived = {
  id: 'agent_safe_derived_deployment_fork_v1',
  anchor: 'src/local-agent-safe-derived-deployment-fork-publication.anchor.json',
  carrier: 'src/local-agent-safe-derived-deployment-fork-publication.carrier.json',
  receipt: 'tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json',
  components: ['derivedDeploymentForkSafetyV1'],
};

function fixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-agent-safe-publication-'));
  for (const path of [storage.anchor, storage.carrier, storage.receipt]) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    cpSync(join(root, path), join(scratch, path));
  }
  return scratch;
}

test('frozen C validates both independent records as withheld', () => {
  assert.deepEqual(runChecker(root).map(({ state }) => state), ['withheld', 'withheld']);
});

test('withheld anchor cannot smuggle a carrier digest', () => {
  const scratch = fixture();
  const path = join(scratch, storage.anchor);
  const value = JSON.parse(readFileSync(path));
  value.carrierSha256 = `sha256:${'a'.repeat(64)}`;
  writeFileSync(path, JSON.stringify(value));
  assert.throws(() => validatePublicationRecord(scratch, storage), /carries authority/u);
});

test('target, evidence locator, and receipt shape tampering fail before publication', () => {
  for (const mutate of [
    (value) => { value.negativeTargetProfileIds.pop(); },
    (value) => { value.evidence[0].path = 'tests/forged.json'; },
    (value) => { value.unregistered = true; },
  ]) {
    const scratch = fixture();
    const path = join(scratch, storage.receipt);
    const value = JSON.parse(readFileSync(path));
    mutate(value);
    writeFileSync(path, JSON.stringify(value));
    assert.throws(() => validatePublicationRecord(scratch, storage));
  }
});

test('derived publication has no storage-evidence substitution path', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.throws(
    () => validatePublishedEvidenceSemantics(root, derived, head),
    /no dedicated end-to-end F0b performance evidence contract/u,
  );
});

test('history digest is deterministic for an immutable qualification commit', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const first = implementationDigestAt(root, head);
  const second = implementationDigestAt(root, head);
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first, second);
});

test('P-vs-C publication path allowlist rejects executable drift', () => {
  assert.equal(allowedPublicationPath('src/local.rs'), false);
  assert.equal(allowedPublicationPath('packages/snapback-client/index.mjs'), false);
  assert.equal(
    allowedPublicationPath('src/local-agent-safe-storage-publication.anchor.json'),
    true,
  );
  assert.equal(
    allowedPublicationPath('tests/acceptance/fixtures/agent-safe-storage/author-acceptance.2026-08-04.v1.json'),
    true,
  );
  assert.equal(allowedPublicationPath('issues/20260803-wave3-program.md'), true);
  assert.equal(allowedPublicationPath('guide/operating/instance-forks.md'), true);
  assert.equal(
    allowedPublicationPath('demos/latency-kanban/snapback/trusted-composition-activation.json'),
    true,
  );
  assert.equal(
    allowedPublicationPath('tests/acceptance/fixtures/latency-kanban/move3-exit.2026-08-04.v1.json'),
    true,
  );
  assert.equal(allowedPublicationPath('guide/arbitrary-executable.mjs'), false);
});
