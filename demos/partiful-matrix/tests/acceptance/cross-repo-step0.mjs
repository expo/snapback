import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from './manifest-semantics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const acceptanceRoot = resolve(here, '..', '..', 'acceptance');
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const exactRoot = resolve(repoRoot, option('exact-root', '../exact'));
const output = resolve(repoRoot, option(
  'out',
  'demos/partiful-matrix/acceptance/results/step0-cross-repo-validation.json',
));
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
const git = (...args) => run('git', args, exactRoot);
const assertCleanExact = () => {
  const changes = git('status', '--porcelain').split('\n').filter(Boolean)
    .filter((line) => !/^\?\? node_modules\/?$/.test(line));
  assert.deepEqual(changes, [], 'Exact checkpoint must be clean apart from installed dependencies');
};
const identity = (root, path) => ({ path, sha256: sha256(readFileSync(resolve(root, path))) });

const manifestBytes = readFileSync(resolve(acceptanceRoot, 'claims.v1.json'));
const manifest = JSON.parse(manifestBytes);
const distribution = manifest.authority.distribution;
const lock = readFileSync(resolve(repoRoot, distribution.lockPath), 'utf8').trim();
assert.equal(lock, sha256(manifestBytes), 'Snapback manifest lock drifted');
assertCleanExact();

for (const [sourcePath, mirrorPath, label] of [
  [manifest.authority.path, distribution.exactMirrorPath, 'manifest'],
  [distribution.lockPath, distribution.exactMirrorLockPath, 'lock'],
  [distribution.schemaPath, distribution.exactMirrorSchemaPath, 'schema'],
  [distribution.protocolPath, distribution.exactMirrorProtocolPath, 'protocol'],
  ['demos/partiful-matrix/acceptance/results/step0-complete.json', distribution.exactMirrorAggregatePath, 'aggregate'],
]) {
  assert.deepEqual(
    readFileSync(resolve(repoRoot, sourcePath)),
    readFileSync(resolve(exactRoot, mirrorPath)),
    `Exact ${label} mirror differs from Snapback authority`,
  );
}

const snapbackValidation = JSON.parse(run('node', ['demos/partiful-matrix/tests/acceptance/validate-step0.mjs'], repoRoot));
const exactManifestValidation = JSON.parse(run('bun', ['scripts/check-snapback-partitime-manifest.mjs', '--json'], exactRoot));
const exactAggregateValidation = JSON.parse(run('bun', ['scripts/check-snapback-partitime-step0-aggregate.mjs', '--json'], exactRoot));
assert.equal(snapbackValidation.validationOk, true);
assert.equal(exactManifestValidation.ok, true);
assert.equal(exactAggregateValidation.ok, true);
const shared = JSON.parse(readFileSync(resolve(acceptanceRoot, 'results/step0-shared-manifest-contract.json')));
assert.deepEqual(identity(exactRoot, shared.validators.exact.path), {
  path: shared.validators.exact.path,
  sha256: shared.validators.exact.sha256,
}, 'Exact manifest validator differs from the shared contract');
assert.deepEqual(identity(exactRoot, shared.validators.exactAggregate.path), {
  path: shared.validators.exactAggregate.path,
  sha256: shared.validators.exactAggregate.sha256,
}, 'Exact aggregate validator differs from the shared contract');
assert.deepEqual(
  identity(exactRoot, shared.validators.exact.registry.path),
  shared.validators.exact.registry,
  'Exact registry differs from the shared contract',
);
assert.deepEqual(
  identity(exactRoot, shared.siblingPlans.exact.path),
  shared.siblingPlans.exact,
  'Exact sibling Plan differs from the shared contract',
);
const exactRegistry = JSON.parse(readFileSync(resolve(exactRoot, shared.validators.exact.registry.path)));
for (const validator of [shared.validators.exact, shared.validators.exactAggregate]) {
  const check = exactRegistry.checks.find(({ id }) => id === validator.registeredCheckId);
  assert.ok(check, `Exact registry is missing ${validator.registeredCheckId}`);
  assert.equal(check.command, validator.registeredCommand, `${validator.registeredCheckId} command drifted`);
}

const result = {
  schemaVersion: 'partitime.cross-repo-step0-validation.v1',
  ok: true,
  manifestId: manifest.manifestId,
  manifestSha256: lock,
  stepZeroClaimCount: manifest.claims.filter(({ step }) => step === 0).length,
  exact: { revision: git('rev-parse', 'HEAD'), dirty: false },
  sharedContractExactRevision: shared.exact.revision,
  validators: {
    snapback: {
      ...identity(repoRoot, 'demos/partiful-matrix/tests/acceptance/validate-step0.mjs'),
      resultSchemaVersion: snapbackValidation.schemaVersion,
    },
    crossRepository: identity(repoRoot, 'demos/partiful-matrix/tests/acceptance/cross-repo-step0.mjs'),
    semantics: identity(repoRoot, 'demos/partiful-matrix/tests/acceptance/manifest-semantics.mjs'),
    exactManifest: {
      ...shared.validators.exact,
    },
    exactAggregate: {
      ...shared.validators.exactAggregate,
    },
    exactRegistry: { ...shared.validators.exact.registry },
  },
  siblingPlans: {
    snapback: identity(repoRoot, 'llp/0063-partitime-platform-roadmap.plan.md'),
    exact: identity(exactRoot, 'llp/0373-contract-and-exact-after-partitime.plan.md'),
  },
  results: {
    snapback: snapbackValidation,
    exactManifest: exactManifestValidation,
    exactAggregate: exactAggregateValidation,
  },
  mirrors: {
    manifest: { source: identity(repoRoot, manifest.authority.path), exactPath: distribution.exactMirrorPath },
    lock: { source: identity(repoRoot, distribution.lockPath), exactPath: distribution.exactMirrorLockPath },
    schema: { source: identity(repoRoot, distribution.schemaPath), exactPath: distribution.exactMirrorSchemaPath },
    protocol: { source: identity(repoRoot, distribution.protocolPath), exactPath: distribution.exactMirrorProtocolPath },
    aggregate: {
      source: identity(repoRoot, 'demos/partiful-matrix/acceptance/results/step0-complete.json'),
      exactPath: distribution.exactMirrorAggregatePath,
    },
  },
};

mkdirSync(dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`);
renameSync(temporary, output);
console.log(JSON.stringify(result));
