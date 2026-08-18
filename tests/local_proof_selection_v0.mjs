import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import {
  loadSelectionContext,
  planSelection,
  selectGate,
  selectChangedPaths,
  selectDriftProneGates,
  validateSelectionReceipt,
} from '../scripts/select-local-proof.mjs';

const root = new URL('..', import.meta.url).pathname;
const context = loadSelectionContext();

function select(paths) {
  return selectChangedPaths(paths, context);
}

function changedBy(commit) {
  const revision = execFileSync('git', ['rev-parse', '--verify', `${commit}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  return execFileSync(
    'git',
    ['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', revision],
    { cwd: root, encoding: 'utf8' },
  ).split('\0').filter(Boolean).sort();
}

function includesAll(plan, gates) {
  for (const gate of gates) {
    assert(plan.selectedGates.includes(gate), `${gate} must be selected`);
  }
}

test('the policy classifies every canonical gate and keeps docs/guide fast', () => {
  assert(context.inventory.canonicalGates.length > 100);

  const docs = select(['llp/0000-snapback.explainer.md']);
  assert.equal(docs.selectionClass, 'FAST_ONLY');
  assert.equal(docs.requirements.native, false);
  assert.deepEqual(docs.selectedGroups, []);
  includesAll(docs, [
    'ref-check',
    'affected-selector-fixtures',
    'package-test-inventory',
    'scripts-test-inventory',
  ]);
  assert.equal(docs.selectedGates.includes('rustfmt'), false);
  assert.equal(docs.selectedGates.includes('package-readme-funnel'), false);
  assert.equal(docs.requirements.javascriptDependencies, false);
  assert.equal(docs.requirements.rustToolchain, false);

  const guide = select(['guide/clients/react-expo.md']);
  assert.equal(guide.selectionClass, 'FAST_ONLY');
  assert.equal(guide.requirements.native, false);
  includesAll(guide, ['generated-artifacts', 'guide']);
});

test('affected groups retain mandatory Contract/Exact and admin behavior', () => {
  const client = select(['packages/snapback-client/index.mjs']);
  assert.equal(client.selectionClass, 'AFFECTED');
  includesAll(client, [
    'snapback-client-package',
    'snapback-react-package',
    'exact-todo-install',
    'exact-todo-contract',
    'admin-acceptance',
    'current-binary-readiness',
  ]);
  assert.equal(client.requirements.native, true);
  assert.equal(client.requirements.browser, true);
  assert.equal(client.selectedGates.includes('cloudflare-local-suite'), false);

  // @ref LLP 0041#runtime-distribution — the admin build is now a published
  // runtime input, so its source changes must select both UI and packaging
  // qualification instead of stopping at browser acceptance.
  const admin = select(['admin-ui/src/main.ts']);
  assert.deepEqual(admin.selectedGroups, ['exact-admin', 'packaging']);
  includesAll(admin, [
    'admin-acceptance',
    'publication-store-qualification-fixtures',
    'published-closure-boot-smoke-fixtures',
  ]);
});

test('single-gate re-entry closes over declared prerequisites', () => {
  assert.deepEqual(selectGate('ref-check', context), ['ref-check']);
  const realServer = selectGate('snapback-cli-real-server', context);
  includesAll({ selectedGates: realServer }, [
    'native-runtime-bootstrap',
    'current-binary-build',
    'current-binary-readiness',
    'runtime-package-stage',
    'snapback-cli-real-server',
  ]);
  assert.throws(() => selectGate('not-a-real-gate', context), /unknown gate/u);
});

test('required Exact mode reaches clean surface installs before availability sentinels', () => {
  const proof = readFileSync(new URL('../scripts/verify-local-proof', import.meta.url), 'utf8');
  const start = proof.indexOf('exact_available() {');
  const end = proof.indexOf('\n}', start);
  assert(start >= 0 && end > start, 'exact availability function must be bounded');
  const availability = proof.slice(start, end + 2);
  assert.match(availability, /command -v bun[^]*VERIFY_EXACT[^]*return 0[^]*node_modules/u);
  assert(
    availability.indexOf('VERIFY_EXACT') < availability.lastIndexOf('node_modules'),
    'required mode must not depend on ignored pre-install surface state',
  );
  const cleanProbe = `${availability}\nROOT=/definitely-missing; bun() { :; }`;
  assert.doesNotThrow(() => execFileSync(
    'bash', ['-c', `VERIFY_EXACT=1; ${cleanProbe}; exact_available`],
  ));
  assert.throws(() => execFileSync(
    'bash', ['-c', `VERIFY_EXACT=auto; ${cleanProbe}; exact_available`],
    { stdio: 'ignore' },
  ));
});

test('package owners select their direct package and harness fixtures', () => {
  const contract = select(['packages/snapback-contract/index.mjs']);
  includesAll(contract, ['snapback-contract-package']);

  const harness = select(['packages/snapback-harness/ctx-bootstrap.js']);
  includesAll(harness, [
    'allowlist-install-fixtures',
    'action-fetch-fence-fixtures',
    'harness-envelope-fixtures',
  ]);

  const cloudflare = select(['cloudflare/src/platform-errors.js']);
  includesAll(cloudflare, ['harness-envelope-fixtures']);

  const publication = select(['scripts/check-agent-safe-publication.mjs']);
  includesAll(publication, ['control-catalog', 'control-catalog-fixtures']);

  const templatePortfolio = select(['scripts/template-registry-canary.mjs']);
  includesAll(templatePortfolio, ['template-portfolio-self-check']);
  assert.equal(
    templatePortfolio.selectedGates.includes('template-registry-canary'),
    false,
    'the live registry canary belongs only to complete scheduled/on-demand proof',
  );
  includesAll(planSelection({ cadence: 'complete' }), ['template-registry-canary']);
});

test('scripts test subjects select their bound fixture gates', () => {
  const guide = select(['scripts/guide-lib.mjs']);
  includesAll(guide, ['guide-freshness-fixtures']);
  assert.equal(guide.selectedGates.includes('publication-script-fixtures'), false);

  includesAll(select(['scripts/build-linux-runtime-release']), [
    'linux-runtime-release-fixtures',
  ]);
  for (const publicationSubject of [
    'scripts/packaged-store-qualification.mjs',
    'scripts/published-closure-rehearsal.test.mjs',
    'scripts/snapback-prior-default-closure.mjs',
    'scripts/symbol-lifecycle.mjs',
  ]) {
    includesAll(select([publicationSubject]), ['publication-script-fixtures']);
  }
});

test('root production audit selection does not depend on Exact/admin baseline gates', () => {
  const isolated = structuredClone(context);
  isolated.policy.affectedBaselineGroups = [];

  const packageManifest = selectChangedPaths(
    ['packages/snapback-client/package.json'],
    isolated,
  );
  includesAll(packageManifest, ['js-production-audit']);
  assert.equal(packageManifest.selectedGates.includes('admin-acceptance'), false);

  const publication = selectChangedPaths(
    ['scripts/check-agent-safe-publication.mjs'],
    isolated,
  );
  includesAll(publication, ['js-production-audit']);
  assert.equal(publication.selectedGates.includes('admin-acceptance'), false);

  for (const rootAuthority of ['bun.lock', 'package.json']) {
    const full = selectChangedPaths([rootAuthority], isolated);
    includesAll(full, ['js-production-audit']);
  }
});

test('a new Rust source file selects the rustfmt gate', () => {
  const rustSource = select(['packages/snapback-client/src/new-native-bridge.rs']);
  includesAll(rustSource, ['rustfmt', 'snapback-client-package']);
  assert(rustSource.matchedRules.includes('rust-sources'));
  assert.equal(rustSource.requirements.rustToolchain, true);

  const nativeRust = select(['src/storage.rs']);
  includesAll(nativeRust, ['rustfmt', 'rust-tests']);
  assert.equal(nativeRust.requirements.rustToolchain, true);

  assert.equal(select(['README.md']).selectedGates.includes('rustfmt'), false);
});

test('published package READMEs select only their fast funnel and its JS setup', () => {
  const packageRoot = new URL('../packages/', import.meta.url);
  const publicReadmes = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        const manifest = JSON.parse(
          readFileSync(new URL(`${entry.name}/package.json`, packageRoot), 'utf8'),
        );
        return manifest.private !== true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    })
    .map(({ name }) => `packages/${name}/README.md`)
    .sort();
  const readmeRule = context.policy.pathRules
    .find(({ id }) => id === 'published-package-readmes');
  assert.deepEqual(readmeRule.files, publicReadmes);

  const readme = select(['packages/snapback-client/README.md']);
  assert.equal(readme.selectionClass, 'FAST_ONLY');
  assert.deepEqual(readme.selectedGroups, ['package-readme']);
  includesAll(readme, ['package-readme-funnel']);
  assert.equal(readme.selectedGates.includes('snapback-client-package'), false);
  assert.equal(readme.requirements.javascriptDependencies, true);
  assert.equal(readme.requirements.native, false);
  assert.equal(readme.requirements.rustToolchain, false);

  const privateReadme = select(['packages/snapback-sidecar/README.md']);
  assert.equal(privateReadme.selectionClass, 'FAIL_CLOSED_FULL');
  assert.equal(privateReadme.matchedRules.includes('published-package-readmes'), false);
});

test('every selected shell-out gate provisions its narrow workflow dependency', () => {
  const cases = [
    [select(['src/storage.rs']), 'rustfmt', 'rustToolchain'],
    [select(['packages/snapback-client/README.md']), 'package-readme-funnel', 'javascriptDependencies'],
    [select(['packages/snapback-client/package.json']), 'package-readme-funnel', 'javascriptDependencies'],
  ];
  for (const [selection, gate, requirement] of cases) {
    assert(selection.selectedGates.includes(gate));
    assert.equal(selection.requirements[requirement], true, `${gate} needs ${requirement}`);
  }
});

test('Rust modules and ownership authorities select the module-ownership ratchet', () => {
  for (const rustModule of ['src/storage.rs', 'src/new-owner-boundary.rs']) {
    includesAll(select([rustModule]), ['module-ownership']);
  }

  for (const authority of [
    'ownership.manifest.json',
    'ownership.baseline.json',
    'scripts/check-module-ownership.mjs',
  ]) {
    const plan = select([authority]);
    assert.equal(plan.selectionClass, 'FAST_ONLY', authority);
    includesAll(plan, ['module-ownership']);
  }
});

test('docs-only pushes still select the always-run module-ownership drift gate', () => {
  assert.deepEqual(context.policy.driftAlwaysRunGates, ['module-ownership']);
  assert.deepEqual(
    selectDriftProneGates(['README.md'], context).selectedDriftProneGates,
    ['module-ownership'],
  );
});

test('native, Cloudflare, seed, and carrier changes select their unique claims', () => {
  const native = select(['src/storage.rs']);
  includesAll(native, [
    'cargo-clippy',
    'rust-tests',
    'snapshot-batch-v2-parity',
    'versioned-seed-conformance',
    'telemetry-smoke',
  ]);

  const cloudflare = select(['cloudflare/src/index.mjs']);
  includesAll(cloudflare, ['cloudflare-local-suite', 'deployment-identity']);
  assert.equal(cloudflare.selectedGates.includes('rust-tests'), false);

  const seed = select(['tests/conformance/versioned-seed-v1.manifest.json']);
  includesAll(seed, [
    'snapshot-batch-v2-parity',
    'versioned-seed-conformance',
    'current-binary-readiness',
  ]);

  const carrier = select(['tests/acceptance/local-store-carrier-exit-v1.mjs']);
  includesAll(carrier, ['local-store-carrier-receipt']);

  const fleet = select(['demos/fleet-observatory-move1/src/App.tsx']);
  includesAll(fleet, ['fleet-observatory-move1-receipt']);
});

test('committed demo distribution leaves select artifact path hygiene and its fixture', () => {
  for (const path of [
    'demos/partiful-matrix/surfaces/contract/dist/snapback/index.html',
    'demos/partiful-matrix/surfaces/react/dist/snapback/assets/index-HASH.js',
    'demos/partiful-matrix/surfaces/vanilla/dist/sqlite/partitime-cost-attribution.json',
    'demos/todo/surfaces/contract/dist/web/assets/index-HASH.js.map',
    'demos/todo-v2/surfaces/contract/dist/web/index.html',
  ]) {
    const plan = select([path]);
    assert.equal(plan.selectionClass, 'AFFECTED', path);
    assert(plan.matchedRules.includes('demo-and-harness'), path);
    includesAll(plan, ['artifact-path-hygiene', 'artifact-path-hygiene-fixtures']);
  }
});

test('shared authorities and unknown paths fail closed into the complete inventory', () => {
  for (const path of [
    'Cargo.lock',
    '.github/workflows/local-proof.yml',
    'scripts/local-proof-selection-policy.v1.json',
    'unclassified/new-surface.xyz',
  ]) {
    const plan = select([path]);
    assert.equal(plan.selectionClass, 'FAIL_CLOSED_FULL', path);
    assert.deepEqual(plan.selectedGates, context.inventory.canonicalGates, path);
    assert.equal(plan.notSelectedGates.length, 0, path);
  }
});

test('selected gates are transitively closed over static and dynamic prerequisites', () => {
  const plans = [
    select(['packages/snapback-client/index.mjs']),
    select(['cloudflare/src/index.mjs']),
    select(['demos/todo/snapback/schema.mjs']),
  ];
  const dependencies = new Map();
  for (const call of context.calls) {
    const current = dependencies.get(call.gateId) ?? [];
    dependencies.set(
      call.gateId,
      [...new Set([...current, ...call.prerequisites.filter((gate) => /^[a-z0-9-]+$/u.test(gate))])],
    );
  }
  for (const [gate, prerequisites] of Object.entries(context.policy.dependencyOverrides)) {
    dependencies.set(gate, [...new Set([...(dependencies.get(gate) ?? []), ...prerequisites])]);
  }
  for (const plan of plans) {
    const selected = new Set(plan.selectedGates);
    for (const gate of selected) {
      for (const prerequisite of dependencies.get(gate) ?? []) {
        assert(selected.has(prerequisite), `${gate} omitted prerequisite ${prerequisite}`);
      }
    }
  }
});

test('historical defect diffs replay to the gates that caught them', () => {
  const clientResume = select(changedBy('41c2db8804ba08071c39641cc46251c9084c7a31'));
  includesAll(clientResume, ['snapback-client-package', 'exact-todo-contract', 'admin-acceptance']);

  const storageAndRoute = select(changedBy('50c1434ed34c62b9d6d61daca491ff718403f4a7'));
  includesAll(storageAndRoute, ['rust-tests', 'versioned-seed-conformance']);

  const deploymentIdentity = select(changedBy('acbb7b922a060788fd09f3f98211eb9ce35f23f4'));
  includesAll(deploymentIdentity, ['deployment-identity', 'cloudflare-local-suite']);

  const generatedSurfaces = select(changedBy('4015569e2ec33851422939dc6e030216d84a19c5'));
  includesAll(generatedSurfaces, ['generated-artifacts', 'required-surface-builds']);
});

test('selection receipts bind the exact policy, inventory, diff, and current HEAD', () => {
  const receipt = planSelection({ cadence: 'affected', base: 'HEAD^', head: 'HEAD' });
  assert.doesNotThrow(() => validateSelectionReceipt(receipt));
  const tampered = structuredClone(receipt);
  tampered.selectedGates = tampered.selectedGates.slice(1);
  tampered.selectedGateCount -= 1;
  assert.throws(
    () => validateSelectionReceipt(tampered),
    /selection receipt is exact and current/u,
  );
});
