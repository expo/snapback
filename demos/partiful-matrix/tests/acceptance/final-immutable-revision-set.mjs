#!/usr/bin/env node
// @ref LLP 0063#sequence — the final program proof binds both repositories,
// installed package identities, every mandatory artifact, and the frozen
// target-profile matrix without allowing the aggregate claim to satisfy
// itself or silently narrow the terminal full-north-star outcome.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertCheckoutForCollection,
  assertFullRevision,
  buildReceiptModel,
  digestGitTreeish,
  instrumentIdentity,
  readExactConsumerPackageSet,
  readSnapbackPublicationPackageSet,
  validateReceiptModel,
  writeReceiptModel,
} from './final-immutable-revision-set-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');

function option(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
}

const snapbackRevision = option('snapback-revision');
const exactRevision = option('exact-revision');
assertFullRevision(snapbackRevision, '--snapback-revision');
assertFullRevision(exactRevision, '--exact-revision');

const exactRoot = resolve(repoRoot, option('exact-root', process.env.EXACT_ROOT ?? '../exact'));
const aggregatePath = resolve(
  repoRoot,
  option(
    'out',
    'demos/partiful-matrix/acceptance/results/final-immutable-revision-set.json',
  ),
);
const profileDirectory = resolve(
  repoRoot,
  option(
    'profile-dir',
    'demos/partiful-matrix/acceptance/results/final-immutable-revision-set.profiles',
  ),
);
const validateOnly = process.argv.includes('--validate-only');
const validateExisting = process.argv.includes('--validate-existing');
const allowRed = process.argv.includes('--allow-red');
assert.equal(
  validateOnly && validateExisting,
  false,
  '--validate-only and --validate-existing are mutually exclusive',
);

function runGit(root, ...args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed in ${root}:\n${result.stderr || result.stdout}`,
  );
  return result.stdout.trim();
}

const revisionSet = validateOnly || validateExisting
  ? {
      snapback: digestGitTreeish(runGit, repoRoot, snapbackRevision, 'Snapback'),
      exact: digestGitTreeish(runGit, exactRoot, exactRevision, 'Exact'),
    }
  : {
      snapback: assertCheckoutForCollection(
        runGit,
        repoRoot,
        snapbackRevision,
        'Snapback',
      ),
      exact: assertCheckoutForCollection(runGit, exactRoot, exactRevision, 'Exact'),
    };

const manifest = JSON.parse(
  readFileSync(
    resolve(repoRoot, 'demos/partiful-matrix/acceptance/claims.v1.json'),
    'utf8',
  ),
);
const protocol = JSON.parse(
  readFileSync(
    resolve(repoRoot, 'demos/partiful-matrix/acceptance/comparison-protocol.v1.json'),
    'utf8',
  ),
);
const packageSets = [
  readSnapbackPublicationPackageSet(repoRoot),
  readExactConsumerPackageSet(repoRoot),
];
const instruments = {
  collector: instrumentIdentity(
    repoRoot,
    'demos/partiful-matrix/tests/acceptance/final-immutable-revision-set.mjs',
  ),
  library: instrumentIdentity(
    repoRoot,
    'demos/partiful-matrix/tests/acceptance/final-immutable-revision-set-lib.mjs',
  ),
  manifestSemantics: instrumentIdentity(
    repoRoot,
    'demos/partiful-matrix/tests/acceptance/manifest-semantics.mjs',
  ),
};
const model = buildReceiptModel({
  manifest,
  protocol,
  repoRoot,
  revisionSet,
  packageSets,
  instruments,
});

let result;
if (validateExisting) {
  result = validateReceiptModel({ model, repoRoot, aggregatePath });
} else if (validateOnly) {
  result = {
    schemaVersion: 'partitime.immutable-revision-set-validation.v1',
    claimId: model.aggregateBase.claimId,
    claimSatisfied: model.aggregateBase.claimSatisfied,
    terminalProfileId: model.aggregateBase.terminalProfileId,
    blockers: model.aggregateBase.blockers,
    revisionSet,
    packageSets: packageSets.map(
      ({ packageSetId, packageCount, packageSetSha256 }) => ({
        packageSetId,
        packageCount,
        packageSetSha256,
      }),
    ),
  };
} else {
  result = writeReceiptModel({
    model,
    repoRoot,
    aggregatePath,
    profileDirectory,
  });
}

console.log(JSON.stringify(result));
if (!result.claimSatisfied && !allowRed) {
  console.error(
    `${result.claimId} remains red; pass --allow-red only when intentionally retaining a non-promoting diagnostic receipt`,
  );
  process.exitCode = 1;
}
