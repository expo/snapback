import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { manifestSemanticSha256, sha256 } from './manifest-semantics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const acceptanceRoot = resolve(here, '..', '..', 'acceptance');
const option = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const exactRoot = resolve(repoRoot, option('exact-root', '../exact'));
const output = resolve(repoRoot, option(
  'out',
  'demos/partiful-matrix/acceptance/results/step0-shared-manifest-contract.json',
));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
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
const fileIdentity = (root, path) => ({
  path,
  sha256: sha256(readFileSync(resolve(root, path))),
});

const manifestPath = resolve(acceptanceRoot, 'claims.v1.json');
const manifest = readJson(manifestPath);
const distribution = manifest.authority.distribution;
const exactManifest = readJson(resolve(exactRoot, distribution.exactMirrorPath));
const exactRegistry = readJson(resolve(exactRoot, 'exact-verify.json'));
const registeredCheck = (id) => {
  const check = exactRegistry.checks.find((entry) => entry.id === id);
  assert.ok(check, `Exact registry is missing ${id}`);
  return check;
};
const exactManifestCheck = registeredCheck('snapback-partitime-manifest-digest');
const exactAggregateCheck = registeredCheck('snapback-partitime-step0-aggregate');
assert.equal(
  manifestSemanticSha256(exactManifest),
  manifestSemanticSha256(manifest),
  'Exact mirror and Snapback authority have different claim semantics',
);
for (const [sourcePath, mirrorPath, label] of [
  [distribution.schemaPath, distribution.exactMirrorSchemaPath, 'schema'],
  [distribution.protocolPath, distribution.exactMirrorProtocolPath, 'protocol'],
]) {
  assert.deepEqual(
    readFileSync(resolve(repoRoot, sourcePath)),
    readFileSync(resolve(exactRoot, mirrorPath)),
    `Exact ${label} mirror differs from Snapback authority`,
  );
}

const snapbackValidation = JSON.parse(run(
  'node',
  ['demos/partiful-matrix/tests/acceptance/validate-step0.mjs', '--structural-only'],
  repoRoot,
));
const exactValidation = JSON.parse(run(
  'bun',
  ['scripts/check-snapback-partitime-manifest.mjs', '--json'],
  exactRoot,
));
assert.equal(snapbackValidation.validationOk, true);
assert.equal(exactValidation.ok, true);
assertCleanExact();

const result = {
  schemaVersion: 'partitime.shared-manifest-contract.v1',
  claimId: 'STEP0.SHARED_MANIFEST',
  ok: true,
  manifestId: manifest.manifestId,
  workloadVersion: manifest.workloadVersion,
  manifestSemanticSha256: manifestSemanticSha256(manifest),
  authority: {
    repository: manifest.authority.repository,
    path: manifest.authority.path,
    changeControl: manifest.authority.changeControl,
    distribution: {
      digestAlgorithm: distribution.digestAlgorithm,
      lockPath: distribution.lockPath,
      bundlePathTemplate: distribution.bundlePathTemplate,
      exactMirrorPath: distribution.exactMirrorPath,
      exactMirrorLockPath: distribution.exactMirrorLockPath,
      exactMirrorSchemaPath: distribution.exactMirrorSchemaPath,
      exactMirrorProtocolPath: distribution.exactMirrorProtocolPath,
      exactMirrorAggregatePath: distribution.exactMirrorAggregatePath,
    },
  },
  validators: {
    snapback: {
      ...fileIdentity(repoRoot, 'demos/partiful-matrix/tests/acceptance/validate-step0.mjs'),
      command: 'node demos/partiful-matrix/tests/acceptance/validate-step0.mjs',
      resultSchemaVersion: snapbackValidation.schemaVersion,
    },
    exact: {
      ...fileIdentity(exactRoot, 'scripts/check-snapback-partitime-manifest.mjs'),
      command: 'bun scripts/check-snapback-partitime-manifest.mjs --json',
      registeredCheckId: 'snapback-partitime-manifest-digest',
      registeredCommand: exactManifestCheck.command,
      registry: fileIdentity(exactRoot, 'exact-verify.json'),
      resultSchemaVersion: exactValidation.schemaVersion,
    },
    exactAggregate: {
      ...fileIdentity(exactRoot, 'scripts/check-snapback-partitime-step0-aggregate.mjs'),
      command: 'bun scripts/check-snapback-partitime-step0-aggregate.mjs --json',
      registeredCheckId: 'snapback-partitime-step0-aggregate',
      registeredCommand: exactAggregateCheck.command,
      // @ref LLP 0063#sequence — the shared contract identifies the registered
      // aggregate consumer before STEP0.COMPLETE is regenerated. The final
      // cross-repository validator executes it after the aggregate mirror
      // lands; executing it here would create a shared-receipt/aggregate
      // bootstrap cycle during any later protocol amendment.
      resultSchemaVersion: 'partitime.exact-step0-aggregate-validation.v1',
    },
  },
  siblingPlans: {
    snapback: fileIdentity(repoRoot, 'llp/0063-partitime-platform-roadmap.plan.md'),
    exact: fileIdentity(exactRoot, 'llp/0373-contract-and-exact-after-partitime.plan.md'),
  },
  exact: {
    revision: git('rev-parse', 'HEAD'),
    dirty: false,
  },
  inputs: {
    semantics: fileIdentity(repoRoot, relative(repoRoot, resolve(here, 'manifest-semantics.mjs'))),
    schema: fileIdentity(repoRoot, distribution.schemaPath),
    protocol: fileIdentity(repoRoot, distribution.protocolPath),
  },
};

mkdirSync(dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`);
renameSync(temporary, output);
console.log(JSON.stringify(result));
