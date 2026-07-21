import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';

// @ref LLP 0064 §§4-6 — Exact owns execution of each no-Hermes carrier;
// Snapback independently imports a committed receipt, verifies its complete
// Parity fact set, and reconstructs the source graph from the named Exact tree.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const platform = option('platform');
assert.ok(['ios', 'android'].includes(platform), '--platform must be ios or android');
const exactRoot = resolve(repoRoot, option('exact-root') ?? '../exact');
const exactRevision = option('exact-revision');
assert.match(exactRevision ?? '', /^[a-f0-9]{40}$/, '--exact-revision must be a full commit id');
const output = resolve(
  repoRoot,
  option('out') ?? `demos/partiful-matrix/acceptance/results/step2-exact-native-${platform}.json`,
);
const exactReceiptPath = `docs/reports/exact-native/partitime-${platform}.json`;
const claimId = platform === 'ios'
  ? 'STEP2.CONTRACT_IOS_PARITY'
  : 'STEP2.CONTRACT_ANDROID_PARITY';
const profileId = `exact-native/${platform}`;
const checkId = `exact-partitime-native-${platform}`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function git(args, encoding = 'utf8') {
  const child = spawnSync('git', args, {
    cwd: exactRoot,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(child.signal, null, `git ${args.join(' ')} was signaled`);
  assert.equal(child.status, 0, `git ${args.join(' ')} failed: ${child.stderr ?? ''}`);
  return child.stdout;
}

function gitObject(revision, path) {
  return git(['show', `${revision}:${path}`], null);
}

assert.equal(
  git(['cat-file', '-t', exactRevision]).trim(),
  'commit',
  'Exact receipt revision is not a commit',
);
const receiptBytes = gitObject(exactRevision, exactReceiptPath);
const receipt = JSON.parse(receiptBytes.toString('utf8'));
assert.equal(receipt.schemaVersion, 'exact.partitime.native-profile-receipt.v1');
assert.equal(receipt.profileId, profileId);
assert.equal(receipt.capabilityClass, 'Parity');
assert.equal(receipt.ok, true);
assert.match(receipt.sourceRevision, /^[a-f0-9]{40}$/);
assert.equal(
  spawnSync('git', ['merge-base', '--is-ancestor', receipt.sourceRevision, exactRevision], {
    cwd: exactRoot,
  }).status,
  0,
  'Exact carrier source revision is not an ancestor of its receipt revision',
);

const expectedFacts = [
  'releaseCarrierBuildAndLaunch',
  'generatedFunctionInitialData',
  'optimisticPendingThenSettlement',
  'authorityRotationThenFreshAuthorizedQuery',
  'backgroundAndForegroundLifecycle',
  'offlineRetentionAndAuthoritativeReconnect',
  'retainedReadsWhileOffline',
  'deterministicLocalGeneratedHandler',
  'durableOrderedQueueAcrossOwnerLifecycle',
  'reconnectReplayRebaseAndConvergence',
  'predecessorAuthorityQueueSuspension',
  'snapbackServerImplementationExcluded',
];
assert.deepEqual(Object.keys(receipt.facts), expectedFacts, 'Exact Parity fact set drifted');
for (const fact of expectedFacts) assert.equal(receipt.facts[fact], true, `${profileId} failed ${fact}`);
assert.equal(receipt.carrierReceipt.profileId, profileId);
assert.equal(receipt.carrierReceipt.mask, 0x7ff);
assert.deepEqual(
  receipt.carrierReceipt.transitions.map(({ event, mask }) => ({ event, mask })),
  [
    { event: 'launch', mask: 0x1ff },
    { event: 'background-quiesced', mask: 0x3ff },
    { event: 'foreground-reconnected', mask: 0x7ff },
  ],
);
assert.ok(receipt.artifact.bytes > 0, 'Exact release artifact is empty');
assert.match(receipt.artifact.sha256, /^[a-f0-9]{64}$/);
assert.equal(receipt.artifact.exclusion.passed, true);

const reconstructedSources = receipt.sourceGraph.files.map((entry) => {
  assert.ok(!entry.path.startsWith('/') && !entry.path.includes('..'), `unsafe Exact source path: ${entry.path}`);
  const bytes = gitObject(receipt.sourceRevision, entry.path);
  const reconstructed = { path: entry.path, bytes: bytes.length, sha256: sha256(bytes) };
  assert.deepEqual(reconstructed, entry, `Exact source identity drifted: ${entry.path}`);
  return reconstructed;
});
const sourceGraphSha256 = sha256(Buffer.from(
  reconstructedSources.map(({ path, sha256: digest }) => `${path}\0${digest}\n`).join(''),
));
assert.equal(sourceGraphSha256, receipt.sourceGraph.sha256, 'Exact source graph digest drifted');

const registryBytes = gitObject(exactRevision, 'exact-verify.json');
const registry = JSON.parse(registryBytes.toString('utf8'));
const registered = registry.checks.find(({ id }) => id === checkId);
assert.ok(registered, `${checkId} is absent from the Exact verification registry`);
assert.deepEqual(registered.platforms, [platform]);
assert.ok(registered.lanes.includes('contract'));
assert.deepEqual(registered.artifacts, [exactReceiptPath]);
assert.ok(registered.command.includes('--check'), `${checkId} is not a retained-receipt check`);

const verifierPath = 'demos/partiful-matrix/tests/acceptance/step2-exact-native.mjs';
const report = {
  schemaVersion: 'partitime.step2-exact-native-import.v1',
  claimId,
  profileId,
  capabilityClass: 'Parity',
  ok: true,
  outcome: 'pass',
  exact: {
    receiptRevision: exactRevision,
    sourceRevision: receipt.sourceRevision,
    receiptPath: exactReceiptPath,
    receiptSha256: sha256(receiptBytes),
    registrySha256: sha256(registryBytes),
    checkId,
  },
  receipt,
  validation: {
    factCount: expectedFacts.length,
    sourceCount: reconstructedSources.length,
    sourceGraphSha256,
    lifecycleMasks: [0x1ff, 0x3ff, 0x7ff],
  },
  verifierInventory: [{
    path: verifierPath,
    sha256: sha256(readFileSync(resolve(repoRoot, verifierPath))),
  }],
};

writeMachineReport(relative(repoRoot, output), report);
console.log(JSON.stringify({
  ok: true,
  claimId,
  profileId,
  exactRevision,
  receiptSha256: report.exact.receiptSha256,
  output: relative(repoRoot, output),
}));
