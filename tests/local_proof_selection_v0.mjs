import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadSelectionContext,
  planSelection,
  selectChangedPaths,
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
    'package-readme-funnel',
  ]);

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
});

test('native, Cloudflare, seed, and carrier changes select their unique claims', () => {
  const native = select(['src/storage.rs']);
  includesAll(native, [
    'cargo-clippy',
    'rust-tests',
    'snapshot-batch-v2-parity',
    'fleet-observatory-move1-receipt',
    'versioned-seed-conformance',
    'telemetry-smoke',
  ]);

  const cloudflare = select(['cloudflare/src/index.mjs']);
  includesAll(cloudflare, ['cloudflare-local-suite', 'deployment-identity']);
  assert.equal(cloudflare.selectedGates.includes('rust-tests'), false);

  const seed = select(['tests/conformance/versioned-seed-v1.manifest.json']);
  includesAll(seed, [
    'snapshot-batch-v2-parity',
    'fleet-observatory-move1-receipt',
    'versioned-seed-conformance',
    'current-binary-readiness',
  ]);

  const carrier = select(['tests/acceptance/local-store-carrier-exit-v1.mjs']);
  includesAll(carrier, ['local-store-carrier-receipt']);

  const fleet = select(['demos/fleet-observatory-move1/src/App.tsx']);
  includesAll(fleet, ['fleet-observatory-move1-receipt']);
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
