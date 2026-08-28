import { execFileSync, spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = join(ROOT, '.github', 'workflows');
const workflowNames = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name)).sort();
assert.deepEqual(workflowNames, [
  'all-aboard-cold-clone.yml',
  'app-bound-linux-qualification.yml',
  'deployment-identity.yml',
  'inventories.yml',
  'linux-runtime-package.yml',
  'local-proof.yml',
  'ltx-conformance.yml',
  'public-package-proof.yml',
  'ref-check.yml',
  'required-surface-builds.yml',
  'telemetry-latest-main.yml',
  'visibility-governance-observer.yml',
  'visibility-governance-reconciler.yml',
]);

function declaredWorkflowEvents(name) {
  const text = readFileSync(join(workflowDir, name), 'utf8');
  const triggerBlock = /^on:\n((?:[ \t]+[^\n]*(?:\n|$))*)/mu.exec(text);
  assert(triggerBlock, `${name} must declare workflow triggers`);
  return [...triggerBlock[1].matchAll(/^  ([a-z_]+):/gmu)].map((match) => match[1]);
}

const lowNoiseTriggerContract = new Map([
  ['all-aboard-cold-clone.yml', ['workflow_dispatch']],
  ['deployment-identity.yml', ['pull_request', 'workflow_dispatch']],
  ['inventories.yml', ['pull_request', 'workflow_dispatch']],
  ['linux-runtime-package.yml', ['workflow_dispatch']],
  ['local-proof.yml', ['pull_request', 'schedule', 'workflow_dispatch']],
  ['required-surface-builds.yml', ['workflow_dispatch']],
  ['visibility-governance-observer.yml', ['workflow_dispatch']],
  ['visibility-governance-reconciler.yml', ['workflow_dispatch']],
]);
for (const [name, expectedEvents] of lowNoiseTriggerContract) {
  assert.deepEqual(
    declaredWorkflowEvents(name),
    expectedEvents,
    `${name} must retain the reviewed LLP 0189 low-noise trigger posture`,
  );
}
assert.deepEqual(
  declaredWorkflowEvents('ref-check.yml'),
  ['push', 'pull_request'],
  'ref-check must preserve cheap direct-main and pull-request feedback',
);

const requiredSurfaceBuildsWorkflow = readFileSync(
  join(workflowDir, 'required-surface-builds.yml'),
  'utf8',
);
assert.doesNotMatch(
  requiredSurfaceBuildsWorkflow,
  /^  push:/mu,
  'LLP 0316 Phase 6 proves selectors but must not restore push without author direction',
);
assert.match(
  requiredSurfaceBuildsWorkflow,
  /scripts\/required-surface-build-paths\.v1\.json[\s\S]*tests\/required_surface_builds_v0\.mjs/u,
  'the manual workflow must point future restoration at the machine-tested selector authority',
);

const deploymentIdentityWorkflow = readFileSync(
  join(workflowDir, 'deployment-identity.yml'),
  'utf8',
);
const deploymentCodegenIndex = deploymentIdentityWorkflow.indexOf(
  'node packages/snapback-codegen/index.mjs demos/all-aboard/snapback',
);
const deploymentReviewDriftIndex = deploymentIdentityWorkflow.indexOf(
  'demos/all-aboard/snapback/generated/artifacts.json',
);
const deploymentIdentityCheckIndex = deploymentIdentityWorkflow.indexOf(
  'node targets/cloudflare/scripts/generate-deployment-identity.mjs --check',
);
assert(
  deploymentCodegenIndex >= 0
    && deploymentReviewDriftIndex > deploymentCodegenIndex
    && deploymentIdentityCheckIndex > deploymentReviewDriftIndex,
  'deployment-identity CI must materialize ignored All Aboard inputs and refuse review drift before checking identity',
);

const coldCloneCheck = readFileSync(join(ROOT, 'scripts', 'cold-clone-check.sh'), 'utf8');
assert.match(
  coldCloneCheck,
  /run "\$ROOT\/scripts\/bootstrap-ibex-runtime"/u,
  'cold-clone CI must enter native readiness through the coded bootstrap',
);
assert.doesNotMatch(
  coldCloneCheck,
  /SNAPBACK_BOOTSTRAP_CHECK/u,
  'cold-clone CI must not disable the bootstrap link, launch, VM, or readiness checks',
);

const activeCheckoutUse = /^\s*(?:-\s+)?uses:\s+actions\/checkout@[^\s#]+(?:\s+#.*)?$/;
const activeCredentialCheck = /^\s*run:\s*scripts\/check-checkout-credentials\s*(?:#.*)?$/m;
const activePersistCredentialsFalse = /^\s+persist-credentials:\s*false\s*(?:#.*)?$/m;

function checkoutStepBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!activeCheckoutUse.test(lines[index])) continue;
    const usesIndent = /^\s*/.exec(lines[index])[0].length;
    let start = index;
    let stepIndent = usesIndent;
    if (!/^\s*-\s+uses:/.test(lines[index])) {
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const cursorIndent = /^\s*/.exec(lines[cursor])[0].length;
        if (/^\s*-\s+/.test(lines[cursor]) && cursorIndent < usesIndent) {
          start = cursor;
          stepIndent = cursorIndent;
          break;
        }
        if (lines[cursor].trim() && cursorIndent < usesIndent) break;
      }
    }
    let end = index + 1;
    while (end < lines.length) {
      const nextIndent = /^\s*/.exec(lines[end])[0].length;
      if (/^\s*-\s/.test(lines[end]) && nextIndent === stepIndent) break;
      end += 1;
    }
    blocks.push(lines.slice(start, end).join('\n'));
  }
  return blocks;
}

function assertCheckoutCredentialPolicy(text, name) {
  const blocks = checkoutStepBlocks(text);
  assert(blocks.length > 0, `${name} must contain an active checkout step`);
  for (const block of blocks) {
    assert.match(
      block,
      activePersistCredentialsFalse,
      `${name} checkout must not persist credentials`,
    );
  }
}

const syntheticCheckout = `  - uses: actions/checkout@${'0'.repeat(40)} # v-test\n    with:`;
assert.throws(
  () => assertCheckoutCredentialPolicy(`${syntheticCheckout}\n      # persist-credentials: false`, 'commented property fixture'),
  /must not persist credentials/,
  'a commented persist-credentials property must not satisfy checkout policy',
);
assert.throws(
  () => assertCheckoutCredentialPolicy(`#${syntheticCheckout}\n      persist-credentials: false`, 'commented checkout fixture'),
  /active checkout step/,
  'a commented checkout step must not enter the reviewed checkout inventory',
);
assert.doesNotMatch(
  '      # run: scripts/check-checkout-credentials',
  activeCredentialCheck,
  'a commented credential-check command must not satisfy workflow policy',
);

let actionCount = 0;
let setupNodeCount = 0;
for (const name of workflowNames) {
  const text = readFileSync(join(workflowDir, name), 'utf8');
  const permissions = /^permissions:\n((?:[ \t]+[^\n]*(?:\n|$))*)/m.exec(text);
  assert(permissions, `${name} must declare top-level permissions`);
  const expectedPermissions = name === 'app-bound-linux-qualification.yml'
    ? 'contents: read\n  attestations: read'
    : name === 'visibility-governance-observer.yml'
      ? 'contents: read\n  id-token: write\n  attestations: write'
      : 'contents: read';
  assert.equal(
    permissions[1].trim(),
    expectedPermissions,
    `${name} must grant only its reviewed read-only permissions`,
  );
  assert.match(text, activeCredentialCheck, `${name} must attest checkout cleanup`);

  const uses = [...text.matchAll(/^\s*-?\s*uses:\s+([^\s#]+)(?:\s+#\s*(\S+))?$/gm)];
  assert(uses.length > 0, `${name} must contain actions`);
  for (const match of uses) {
    const [ownerRepo, revision] = match[1].split('@');
    assert.match(
      ownerRepo,
      /^[^/\s]+\/[^/\s]+(?:\/[^/\s]+)*$/,
      `${name} has an invalid action owner/repo path`,
    );
    assert.match(revision ?? '', /^[0-9a-f]{40}$/, `${name} action ${match[1]} must use an immutable SHA`);
    assert(match[2], `${name} action ${match[1]} must keep a human-readable version comment`);
    actionCount += 1;
  }

  assertCheckoutCredentialPolicy(text, name);

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('oven-sh/setup-bun@')) continue;
    const indent = /^\s*/.exec(lines[index])[0].length;
    let end = index + 1;
    while (end < lines.length) {
      const nextIndent = /^\s*/.exec(lines[end])[0].length;
      if (/^\s*-\s/.test(lines[end]) && nextIndent === indent) break;
      end += 1;
    }
    assert.match(
      lines.slice(index, end).join('\n'),
      /bun-version-file:\s*package\.json/,
      `${name} setup-bun must consume the root packageManager authority`,
    );
  }

  // ENG-24513: every setup-node step consumes the root .node-version
  // authority; a floating `node-version:` input would let the same SHA run
  // proof scripts under different Node patch releases over time.
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('actions/setup-node@')) continue;
    setupNodeCount += 1;
    const indent = /^\s*/.exec(lines[index])[0].length;
    let end = index + 1;
    while (end < lines.length) {
      const nextIndent = /^\s*/.exec(lines[end])[0].length;
      if (/^\s*-\s/.test(lines[end]) && nextIndent === indent) break;
      end += 1;
    }
    const block = lines.slice(index, end).join('\n');
    assert.match(
      block,
      /node-version-file:\s*\.node-version/,
      `${name} setup-node must consume the root .node-version authority`,
    );
    assert.doesNotMatch(
      block,
      /node-version:/,
      `${name} setup-node must not declare an inline node-version`,
    );
  }
}
// 11 -> 12 (2026-08-22): inventories.yml joins the Node-using workflow set.
assert.equal(setupNodeCount, 12, 'the Node-using workflow inventory changed; review and update this count');
// 30 -> 31 (2026-08-02): the expo-large local-proof runner does not include
// Chrome, so the required admin browser-security lane now provisions one
// through a pinned action instead of inheriting an ambient browser.
// 31 -> 32 (2026-08-05): LLP 0175 retains structured per-gate timings from
// the canonical proof even when the proof itself is red.
// 32 -> 38 (2026-08-05): LLP 0062's Linux final-artifact qualification adds
// six pinned actions: checkout, Node, Bun, cache restore/save, and upload.
// 38 -> 44 (2026-08-06): rolling telemetry evidence adds a coalesced Linux
// producer with checkout, Node, Bun, Hermes/Cargo caches, and artifact upload.
// 44 -> 45 (2026-08-09): LLP 0188 G1 ltx-conformance adds one pinned checkout.
// 45 -> 46 (2026-08-09): the public-package matrix installs checkout-pinned
// Bun for the nested Expo public-registry closure rehearsal.
// 46 -> 53 (2026-08-15): LLP 0234's protected observer projection and
// missing-event reconciler add two checkouts, two Node setups, two retained
// evidence uploads, and one provenance attestation.
// 53 -> 56 (2026-08-22): inventories.yml adds its reviewed pinned actions.
assert.equal(actionCount, 56, 'the reviewed workflow action inventory changed; review and update this count');

const telemetryLatestMain = readFileSync(
  join(workflowDir, 'telemetry-latest-main.yml'),
  'utf8',
);
assert.match(
  telemetryLatestMain,
  /schedule:[\s\S]*cron:[\s\S]*workflow_dispatch:/u,
  'rolling telemetry proof must be scheduled and manually dispatchable',
);
assert.match(
  telemetryLatestMain,
  /group:\s*telemetry-latest-main[\s\S]*cancel-in-progress:\s*false/u,
  'rolling telemetry proof must finish one snapshot while coalescing pending heads',
);
assert.match(
  telemetryLatestMain,
  /SNAPBACK_TELEMETRY_PHASE1_RECEIPT:[\s\S]*scripts\/verify-telemetry-phase1-proof --full/u,
  'rolling telemetry proof must produce an exact candidate outside the tracked carrier',
);
assert.match(
  telemetryLatestMain,
  /sqlite3[\s\S]*telemetry-phase1-\$\{\{ github\.sha \}\}/u,
  'rolling telemetry proof must provision the idle witness and retain a revision-named artifact',
);

const publicPackageProof = readFileSync(
  join(workflowDir, 'public-package-proof.yml'),
  'utf8',
);
assert.match(
  publicPackageProof,
  /fetch-depth:\s*0/u,
  'public package proof must fetch the immutable candidate revision for its detached source worktree',
);
assert.match(
  publicPackageProof,
  /git worktree add --detach[\s\S]*snapback-package-source[\s\S]*SOURCE_REVISION/u,
  'public package proof must materialize candidate fixtures without replacing the current harness',
);
assert.match(
  publicPackageProof,
  /--source-checkout "\$RUNNER_TEMP\/snapback-package-source"[\s\S]*--proof-harness-revision "\$\{\{ github\.sha \}\}"/u,
  'public package proof must bind separate source and harness revisions',
);
assert.ok(
  (publicPackageProof.match(/scripts\/check-checkout-credentials/g) ?? []).length >= 2,
  'public package proof must credential-check both harness and source checkouts',
);
for (const input of [
  'expected_prior_root_version',
  'authorized_lease_sha256',
  'publication_epoch',
]) {
  assert.match(
    publicPackageProof,
    new RegExp(`^      ${input}:`, 'mu'),
    `public package proof must declare the ${input} authority input`,
  );
}
assert.match(
  publicPackageProof,
  /if \[\[ "\$ROOT_SELECTOR" == latest \]\]; then[\s\S]*--expected-prior-root-version "\$EXPECTED_PRIOR_ROOT_VERSION"[\s\S]*--authorized-lease-sha256 "\$AUTHORIZED_LEASE_SHA256"[\s\S]*--publication-epoch "\$PUBLICATION_EPOCH"/u,
  'latest public proof must pass the complete signed retry authority to the package-owned harness',
);
assert.match(
  publicPackageProof,
  /else[\s\S]*\[\[ -z "\$EXPECTED_PRIOR_ROOT_VERSION" \]\][\s\S]*\[\[ -z "\$AUTHORIZED_LEASE_SHA256" \]\][\s\S]*\[\[ -z "\$PUBLICATION_EPOCH" \]\]/u,
  'exact public proof must refuse latest-root retry authority inputs',
);
assert.match(
  publicPackageProof,
  /if:\s*\$\{\{ steps\.ledger\.outputs\.scope_preset != 'ccheever' \}\}[\s\S]*SNAPBACK_PUBLISHED_CLOSURE_VERSION:\s*\$\{\{ steps\.ledger\.outputs\.version \}\}[\s\S]*node --test scripts\/published-closure-rehearsal\.test\.mjs/u,
  'terminal-scope public package proofs must run the nested Expo registry-closure rehearsal at the ledger version',
);

const localProof = readFileSync(join(workflowDir, 'local-proof.yml'), 'utf8');
assert.match(localProof, /SNAPBACK_VERIFY_EXACT:\s*"1"/, 'canonical CI must require Exact/admin checks');
assert.match(
  localProof,
  /bun install --frozen-lockfile\s+node scripts\/ensure-workspace-hoist\.mjs/u,
  'canonical CI must materialize the root workspace links its clean-clone fixtures consume',
);
assert.match(
  localProof,
  /apt-get install -y[^\n]*\blsof\b/u,
  'canonical CI must provision the listener inventory tool required by Expo supervision',
);
assert.match(
  localProof,
  /schedule:[\s\S]*cron:[\s\S]*workflow_dispatch:/u,
  'complete local proof must be scheduled and manually dispatchable',
);
assert.match(
  localProof,
  /PROOF_CADENCE:[^\n]*schedule[^\n]*workflow_dispatch[^\n]*complete[^\n]*affected/u,
  'PR proof must select affected gates while schedule/manual retains complete cadence',
);
assert.match(
  localProof,
  /group:[^\n]*schedule[^\n]*workflow_dispatch[^\n]*latest-main[^\n]*github\.ref/u,
  'scheduled complete proof must coalesce latest-main while PR proof remains ref-scoped',
);
assert.match(
  localProof,
  /ref:[^\n]*schedule[^\n]*workflow_dispatch[^\n]*refs\/heads\/main[^\n]*github\.ref/u,
  'scheduled/manual complete proof must checkout main while PR proof retains its event ref',
);
assert.doesNotMatch(
  localProof,
  /^  push:/mu,
  'temporary low-noise posture must not launch local proof on direct main pushes',
);
assert.match(
  localProof,
  /cancel-in-progress:[^\n]*github\.event_name == 'pull_request'/u,
  'only superseded pull-request affected proofs may be cancelled',
);
assert.match(
  localProof,
  /node scripts\/select-local-proof\.mjs[\s\S]*requires_rust_toolchain[\s\S]*requires_native[\s\S]*scripts\/verify-local-proof --selection-receipt/u,
  'CI must plan once, condition heavyweight setup, and reopen the exact selector receipt',
);
assert.equal(
  localProof.match(/\$\{\{ runner\.temp \}\}\/local-proof-selection\.json/gu)?.length,
  3,
  'planning, verification, and artifact retention must share one runner-temporary selector receipt',
);
assert.doesNotMatch(
  localProof,
  /(?:PROOF_SELECTION|SNAPBACK_PROOF_SELECTION_RESULTS):[^\n]*target\/proof/u,
  'the selector receipt must survive Rust cache restoration by living outside target/',
);
assert.match(
  localProof,
  /Initialize native runtime submodules[\s\S]*if:\s*steps\.selection\.outputs\.requires_native == 'true'[\s\S]*git submodule update --init --recursive/u,
  'large native submodules must be demand-loaded only for native selections',
);
const rustToolchainStepStart = localProof.indexOf('      - name: Install the pinned Rust toolchain');
const rustToolchainStepEnd = localProof.indexOf('\n      - ', rustToolchainStepStart + 1);
assert(
  rustToolchainStepStart >= 0 && rustToolchainStepEnd > rustToolchainStepStart,
  'Rust toolchain step block must be bounded',
);
const rustToolchainStep = localProof.slice(rustToolchainStepStart, rustToolchainStepEnd);
assert.match(
  rustToolchainStep,
  /if:\s*steps\.selection\.outputs\.requires_rust_toolchain == 'true'/u,
  'Rust formatting selections must provision cargo without selecting native setup',
);
assert.match(
  localProof,
  /id:\s*setup-chrome[\s\S]*browser-actions\/setup-chrome@[0-9a-f]{40}[\s\S]*chrome-version:\s*stable/,
  'canonical CI must provision a pinned stable Chrome for required browser acceptance',
);
assert.match(
  localProof,
  /CHROME_BIN:\s*\$\{\{ steps\.setup-chrome\.outputs\.chrome-path \}\}/,
  'canonical CI must pass the action-owned Chrome path to the proof',
);
const nextestStepStart = localProof.indexOf('      - name: Install cargo-nextest');
const nextestStepEnd = localProof.indexOf('\n      - ', nextestStepStart + 1);
assert(
  nextestStepStart >= 0 && nextestStepEnd > nextestStepStart,
  'cargo-nextest install step block must be bounded',
);
const nextestStep = localProof.slice(nextestStepStart, nextestStepEnd);
assert.match(
  nextestStep,
  /if:\s*steps\.selection\.outputs\.requires_native == 'true'/u,
  'cargo-nextest must be provisioned for native selections only',
);
assert.match(
  nextestStep,
  /cargo install cargo-nextest --version 0\.9\.143 --locked/u,
  'canonical CI must install the fleet cargo-nextest version from its locked crate graph',
);
assert.match(
  localProof,
  /target\/nextest\/local-proof\/rust-tests\.junit\.xml/u,
  'canonical CI must retain the deterministic nextest JUnit report',
);
assert.match(
  localProof,
  /if:\s*always\(\)[\s\S]*name:\s*local-proof-gate-results-\$\{\{ github\.run_id \}\}/,
  'canonical CI must retain structured local-proof gate results on green and red runs',
);
assert.match(
  localProof,
  /Report complete-battery verdict[\s\S]*if:\s*always\(\).*github\.event_name == 'schedule'.*github\.event_name == 'workflow_dispatch'[\s\S]*drift-prone-gates\.mjs battery-report[\s\S]*--results "\$SNAPBACK_PROOF_RESULTS"[\s\S]*--completion "\$SNAPBACK_PROOF_COMPLETION_RECEIPT"/u,
  'scheduled and on-demand GitHub proofs must report the complete-battery verdict',
);
assert.doesNotMatch(
  localProof,
  /drift-prone-gates\.mjs battery(?:\s|\\)|issues\/\*battery-|SNAPBACK_BATTERY_RUN_ID/u,
  'the read-only GitHub checkout must not mutate or retain artifact-only ticket state',
);
const visibilityObserver = readFileSync(
  join(workflowDir, 'visibility-governance-observer.yml'),
  'utf8',
);
assert.match(
  visibilityObserver,
  /if:\s*\$\{\{ github\.event_name == 'push' \}\}/u,
  'manual dispatch must not manufacture a protected observer verdict without an authenticated push event',
);
const localProofBackstop = readFileSync(
  join(ROOT, 'scripts', 'local-proof-backstop-runner'),
  'utf8',
);
assert.match(
  localProofBackstop,
  /scripts\/verify-local-proof --complete[\s\S]*drift-prone-gates\.mjs battery[\s\S]*--completion "\$completion_path"[\s\S]*git -C "\$battery_repo" add -A -- issues[\s\S]*git -C "\$battery_repo" push origin HEAD:main/u,
  'the local scheduled battery must run complete proof, project tickets, commit them, and push durable state',
);
const localProofBackstopPlist = readFileSync(
  join(ROOT, 'scripts', 'launchd', 'com.snapback.local-proof-backstop.plist.template'),
  'utf8',
);
assert.match(
  localProofBackstopPlist,
  /com\.snapback\.local-proof-backstop[\s\S]*<integer>21600<\/integer>/u,
  'the durable local complete battery must retain the six-hour cadence',
);
assert.doesNotMatch(
  localProof,
  /install-dependencies:\s*true/,
  'the expo-large Chrome step must not invoke the unavailable apt-get dependency installer',
);
assert.match(
  localProof,
  /CARGO_BUILD_JOBS:\s*"1"/,
  'canonical CI must serialize Cargo links within the hosted-runner resource budget',
);
assert.match(
  localProof,
  /CARGO_PROFILE_DEV_DEBUG:\s*"0"/,
  'canonical CI must omit dev-profile debug symbols from native links',
);
assert.match(
  localProof,
  /CARGO_PROFILE_TEST_DEBUG:\s*"0"/,
  'canonical CI must omit test-profile debug symbols from native links',
);
const [localProofCheckout] = checkoutStepBlocks(localProof);
assert(localProofCheckout, 'canonical CI must contain an active checkout step');
assert.match(
  localProofCheckout,
  /^\s+fetch-depth:\s*0\s*(?:#.*)?$/m,
  'canonical CI must fetch guide review identities so freshness is verifiable',
);
// The self-hosted expo runners do not carry the GitHub image's unused
// Android/.NET toolchains, so the reviewed rm allowlist retired with the
// migration; the pre-proof headroom gate remains.
assert.match(
  localProof,
  /Require workspace disk headroom/,
  'canonical CI must gate on pre-proof disk headroom',
);
const headroomStepStart = localProof.indexOf('      - name: Require workspace disk headroom');
const headroomStepEnd = localProof.indexOf('\n      - ', headroomStepStart + 1);
assert(headroomStepStart >= 0 && headroomStepEnd > headroomStepStart, 'disk headroom step block must be bounded');
const headroomStep = localProof.slice(headroomStepStart, headroomStepEnd);
assert.match(
  headroomStep,
  /if:\s*steps\.selection\.outputs\.requires_native == 'true'/u,
  'fast docs/guide selections must not pay the native disk-admission cost',
);
assert.match(
  headroomStep,
  /SNAPBACK_CI_DISK_HEADROOM_LOW/,
  'canonical CI must fail early with a stable diagnostic when the runner starts too full',
);
assert.match(
  headroomStep,
  /ci_required_kib=\$\(\(20 \* 1024 \* 1024\)\)/,
  'canonical CI must retain 20 GiB of pre-proof headroom for native clippy/test artifacts',
);
for (const laterStep of [
  'Cache Hermes Linux build',
  'Cache Rust build',
  'Install cargo-nextest',
  'Install cargo-audit',
  'Verify Snapback local proof',
]) {
  assert(
    headroomStepStart < localProof.indexOf(`- name: ${laterStep}`),
    `the disk headroom gate must run before ${laterStep}`,
  );
}
const hermesIdentityInputs = [
  'vendor/ibex/scripts/hermes-version.sh',
  'vendor/ibex/scripts/apply-hermes-patches.sh',
  'vendor/ibex/scripts/build-hermes-linux.sh',
  'vendor/ibex/patches/hermes/*.patch',
  'vendor/ibex/Cargo.toml',
];
function assertExactHermesCache(workflow, workflowName) {
  const stepStart = workflow.indexOf('      - name: Cache Hermes Linux build');
  const stepEnd = workflow.indexOf('\n      - ', stepStart + 1);
  assert(
    stepStart >= 0 && stepEnd > stepStart,
    `${workflowName} Hermes cache step block must be bounded`,
  );
  const step = workflow.slice(stepStart, stepEnd);
  for (const identityInput of hermesIdentityInputs) {
    assert(
      step.includes(`'${identityInput}'`),
      `${workflowName} Hermes cache identity must include ${identityInput}`,
    );
  }
  assert.match(
    step,
    /key:\s*\$\{\{ runner\.os \}\}-hermes-\$\{\{ hashFiles\(/,
    `${workflowName} Hermes cache must derive its exact key from the reviewed identity inputs`,
  );
  assert.doesNotMatch(
    step,
    /restore-keys:/,
    `${workflowName} Hermes cache must not restore an artifact built for a different runtime identity`,
  );
}
assertExactHermesCache(localProof, 'local-proof');
const coldClone = readFileSync(join(workflowDir, 'all-aboard-cold-clone.yml'), 'utf8');
assertExactHermesCache(coldClone, 'all-aboard-cold-clone');
const linuxRuntimePackage = readFileSync(join(workflowDir, 'linux-runtime-package.yml'), 'utf8');
assertExactHermesCache(linuxRuntimePackage, 'linux-runtime-package');
// @ref LLP 0314.000#phase-1--ship-the-ship-profile-and-strip-it — public
// packaging qualifies and seals the production-profile bytes. The second,
// ordinary release build exists only for linked source-checkout custody.
const linuxProductionBuildIndex = linuxRuntimePackage.indexOf(
  'SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --profile production --bin snapback',
);
const linuxProductionReceiptIssueIndex = linuxRuntimePackage.indexOf(
  'node packages/snapback-cli/runtime-readiness.mjs issue',
);
const linuxProductionLoaderClosureIndex = linuxRuntimePackage.indexOf(
  'cp vendor/ibex/linux/lib/libhermesvm.so target/lib/libhermesvm.so',
);
const linuxProductionReceiptVerifyIndex = linuxRuntimePackage.indexOf(
  'node packages/snapback-cli/runtime-readiness.mjs verify',
);
const linuxReleaseBuildIndex = linuxRuntimePackage.indexOf(
  'cargo build --release --bin snapback',
  linuxProductionReceiptVerifyIndex,
);
const linuxSourceReceiptIssueIndex = linuxRuntimePackage.indexOf(
  'node packages/snapback-cli/runtime-readiness.mjs issue',
  linuxReleaseBuildIndex,
);
const linuxSourceReceiptVerifyIndex = linuxRuntimePackage.indexOf(
  'node packages/snapback-cli/runtime-readiness.mjs verify',
  linuxSourceReceiptIssueIndex,
);
const linuxPackagePreparationIndex = linuxRuntimePackage.indexOf(
  'node packages/snapback-runtime-linux-x64/prepare-runtime.mjs',
);
const linuxPackageTestIndex = linuxRuntimePackage.indexOf(
  'node packages/snapback-runtime-linux-x64/package.test.mjs',
);
assert(
  linuxProductionBuildIndex >= 0
    && linuxProductionLoaderClosureIndex > linuxProductionBuildIndex
    && linuxProductionReceiptIssueIndex > linuxProductionLoaderClosureIndex
    && linuxProductionReceiptVerifyIndex > linuxProductionReceiptIssueIndex
    && linuxReleaseBuildIndex > linuxProductionReceiptVerifyIndex
    && linuxSourceReceiptIssueIndex > linuxReleaseBuildIndex
    && linuxSourceReceiptVerifyIndex > linuxSourceReceiptIssueIndex
    && linuxPackagePreparationIndex > linuxSourceReceiptVerifyIndex
    && linuxPackageTestIndex > linuxPackagePreparationIndex,
  'Linux runtime workflow must qualify the production package bytes, retain separate release source custody, then prepare and test the package',
);
assert.match(
  linuxRuntimePackage,
  /--binary "\$GITHUB_WORKSPACE\/target\/production\/snapback"[\s\S]*--issuer linux-runtime-package-production/u,
  'Linux runtime workflow must bind package qualification to target/production/snapback with a named issuer',
);
assert.match(
  linuxRuntimePackage,
  /--binary "\$GITHUB_WORKSPACE\/target\/release\/snapback"[\s\S]*--issuer linux-runtime-package-source-release/u,
  'Linux runtime workflow must bind source qualification to target/release/snapback with a named issuer',
);
assert.match(
  linuxRuntimePackage,
  /snapback-package-cold-install\.mjs/,
  'Linux runtime workflow must exercise the external package cold-install proof',
);
assert.match(
  linuxRuntimePackage,
  /actions\/upload-artifact@[0-9a-f]{40}/,
  'Linux runtime workflow must retain its package and cold-install evidence',
);
// Qualified staging moved to EAS Workflows (4de409ab); the invariants below
// guard the same proof surface in its new home.
const qualifiedPackageStaging = readFileSync(
  join(ROOT, '.eas', 'workflows', 'qualified-package-staging.yml'),
  'utf8',
);
assert.equal(
  qualifiedPackageStaging.match(/SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --profile production --bin snapback/g)?.length,
  2,
  'both EAS native runtime jobs must build the public package with the production profile',
);
assert.doesNotMatch(
  qualifiedPackageStaging,
  /SNAPBACK_BUILD_DISTRIBUTION=public-package cargo build --release --bin snapback/u,
  'EAS public-package jobs must not build an ordinary release-profile binary',
);
const runtimeAssembler = readFileSync(
  join(ROOT, 'scripts', 'assemble-runtime-package'),
  'utf8',
);
assert.match(
  runtimeAssembler,
  /cargo build --profile production --bin snapback/u,
  'the host runtime assembler must build the production-profile binary',
);
const assemblerReleaseBuildIndex = runtimeAssembler.indexOf(
  'cargo build --release --bin snapback',
);
const assemblerSourceReceiptIndex = runtimeAssembler.indexOf(
  '--issuer source-runtime-repair',
);
const assemblerSourceVerifyIndex = runtimeAssembler.indexOf(
  'runtime-readiness.mjs verify',
);
const assemblerProductionBuildIndex = runtimeAssembler.indexOf(
  'cargo build --profile production --bin snapback',
);
assert(
  assemblerReleaseBuildIndex >= 0
    && assemblerSourceReceiptIndex > assemblerReleaseBuildIndex
    && assemblerSourceVerifyIndex > assemblerSourceReceiptIndex
    && assemblerProductionBuildIndex > assemblerSourceVerifyIndex,
  'the host runtime assembler must repair and reopen release source custody before building the separate production package binary',
);
const linuxRuntimeBuilder = readFileSync(
  join(ROOT, 'scripts', 'build-linux-runtime-release'),
  'utf8',
);
assert.match(
  linuxRuntimeBuilder,
  /runner\('cargo', \['build', '--profile', 'production', '--bin', 'snapback'\]/u,
  'the standalone Linux runtime builder must use the production profile',
);
for (const relativePath of [
  'packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs',
  'packages/snapback-runtime-linux-x64/prepare-runtime.mjs',
  'scripts/packaged-store-qualification.mjs',
]) {
  const source = readFileSync(join(ROOT, relativePath), 'utf8');
  assert.match(
    source,
    /target['"], ['"]production['"], ['"]snapback|target\/production\/snapback/u,
    `${relativePath} must default to the production-profile binary`,
  );
}
const qualifiedStagingAssembly = readFileSync(
  join(ROOT, 'scripts', 'qualified-staging-assemble'),
  'utf8',
);
const qualifiedStagingLedgerCheck = readFileSync(
  join(ROOT, 'scripts', 'qualified-staging-ledger-check.mjs'),
  'utf8',
);
const qualifiedStagingRetainRelease = readFileSync(
  join(ROOT, 'scripts', 'qualified-staging-retain-release'),
  'utf8',
);
assert(
  Buffer.byteLength(qualifiedPackageStaging, 'utf8') <= 16_384,
  'qualified package staging must fit EAS\'s 16 KiB workflow revision limit',
);
const qualifiedStagingSources = [
  qualifiedPackageStaging,
  qualifiedStagingAssembly,
  qualifiedStagingLedgerCheck,
  qualifiedStagingRetainRelease,
].join('\n');
for (const required of [
  'SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY',
  'SNAPBACK_RUNTIME_LINUX_X64_HERMES_LIBRARY',
  'SNAPBACK_RUNTIME_LINUX_X64_HERMES_HEADER',
  'SNAPBACK_RUNTIME_LINUX_X64_BUILD_ATTESTATION',
  'SNAPBACK_RUNTIME_LINUX_X64_BUNDLED_LIBS_DIR',
  'SNAPBACK_RUNTIME_LINUX_X64_SOURCE_REVISION',
  'snapback-create-runtime-artifact-attestation.mjs',
  '--bundled-libs-dir',
  'elf-portability.mjs',
  '--hermes-header',
  'runtime-readiness.json',
  '--runtime-platforms all',
  'snapback.package-qualified-staging-ledger.v1',
  '--install-source staged',
  'snapback-darwin-arm64-staged-receipt.json',
  'snapback-linux-x64-staged-receipt.json',
  'snapback-qualified-release',
]) {
  assert(
    qualifiedStagingSources.includes(required),
    `qualified package staging must retain ${required}`,
  );
}
assert.match(
  qualifiedStagingAssembly,
  /candidate_tag="bakeoff-\$\{RELEASE_VERSION\/\/\.\/-\}-\$\{source_revision:0:12\}"/,
  'qualified package staging must bind the candidate tag to version and source revision',
);
assert.equal(
  qualifiedPackageStaging.match(/scripts\/qualified-staging-assemble/g)?.length,
  2,
  'qualified staging must assemble once for receipt minting and once for receipt-qualified proof',
);
for (const job of [
  'linux_store_qualification',
  'darwin_staged_proof',
  'linux_staged_proof',
]) {
  const start = qualifiedPackageStaging.indexOf(`  ${job}:`);
  const bodyStart = start + `  ${job}:`.length;
  const nextJob = qualifiedPackageStaging.slice(bodyStart).search(/\n  [a-z][a-z_]+:\n/u);
  const end = nextJob === -1
    ? qualifiedPackageStaging.length
    : bodyStart + nextJob;
  const block = qualifiedPackageStaging.slice(
    start,
    end,
  );
  assert(start >= 0, `qualified staging must retain the ${job} job`);
  assert.match(
    block,
    /eas\/install_node_modules[\s\S]*scripts\/(?:qualified-staging-store-qualification|snapback-package-cold-install)\.mjs/u,
    `${job} must install the publication validator dependencies before qualification`,
  );
}
{
  const start = qualifiedPackageStaging.indexOf('  linux_staged_proof:');
  const bodyStart = start + '  linux_staged_proof:'.length;
  const nextJob = qualifiedPackageStaging.slice(bodyStart).search(/\n  [a-z][a-z_]+:\n/u);
  const end = nextJob === -1
    ? qualifiedPackageStaging.length
    : bodyStart + nextJob;
  const block = qualifiedPackageStaging.slice(start, end);
  assert.match(
    block,
    /apt-get install -y lsof[\s\S]*snapback-package-cold-install\.mjs/u,
    'Linux staged proof must install lsof before exercising supervised readiness',
  );
}
assert.match(
  qualifiedPackageStaging,
  /scripts\/qualified-staging-retain-release/u,
  'qualified staging must retain the final closure through its size-capped checked-in script',
);
{
  const start = qualifiedPackageStaging.indexOf('  qualified_release:');
  const block = qualifiedPackageStaging.slice(start);
  assert(start >= 0, 'qualified staging must retain the qualified_release job');
  assert.match(
    block,
    /eas\/checkout[\s\S]*scripts\/qualified-staging-retain-release/u,
    'qualified release retention must checkout the retained release script before invoking it',
  );
}
for (const artifact of [
  'snapback-qualification-tarballs',
  'snapback-darwin-store-receipt',
  'snapback-linux-store-receipt',
]) {
  assert(
    qualifiedPackageStaging.includes(artifact),
    `qualified staging must retain its two-pass artifact ${artifact}`,
  );
}
assert.match(
  qualifiedStagingAssembly,
  /SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS=1[\s\S]*qualified-staging-ledger-check\.mjs/u,
  'only the receipt-minting assembly pass may relax the runtime receipt gate',
);
assert.equal(
  qualifiedPackageStaging.match(/SNAPBACK_BOOTSTRAP_CHECK=0 scripts\/bootstrap-ibex-runtime/g)?.length,
  2,
  'qualified native builds must materialize Hermes before their extended exact-link proof',
);
assert.equal(
  qualifiedPackageStaging.match(/--timeout-ms 900000/g)?.length,
  2,
  'qualified native builds must allow a cold exact-link proof to finish on hosted runners',
);
assert.equal(
  qualifiedStagingSources.match(/bin\/snapback"? build-identity/g)?.length,
  3,
  'qualified native builds must launch both packaged binaries through a supported identity command, and assembly must revision-check the transported macOS runtime',
);
assert.doesNotMatch(
  qualifiedPackageStaging,
  /bin\/snapback --version/,
  'qualified native builds must not call the unsupported Snapback --version flag',
);
const prepareHermesStart = localProof.indexOf('      - name: Prepare exact Hermes runtime');
const verifyProofStart = localProof.indexOf('      - name: Verify Snapback local proof');
assert(
  prepareHermesStart > localProof.indexOf('      - name: Cache Hermes Linux build')
    && prepareHermesStart < verifyProofStart,
  'canonical CI must prepare an exact cache miss before the local-proof preflight',
);
assert.match(
  localProof,
  /target\/proof\/local-proof-results\.jsonl[\s\S]*\$\{\{ runner\.temp \}\}\/local-proof-selection\.json/u,
  'CI must retain both execution results and their exact selection authority',
);
const prepareHermesEnd = localProof.indexOf('\n      - ', prepareHermesStart + 1);
assert.match(
  localProof.slice(prepareHermesStart, prepareHermesEnd),
  /run:\s*scripts\/bootstrap-ibex-runtime/,
  'canonical CI must use the repository bootstrap to materialize and launch-test Hermes',
);
const localProofScript = readFileSync(join(ROOT, 'scripts', 'verify-local-proof'), 'utf8');
assert(
  localProofScript.indexOf('check-required-surface-builds.mjs')
    < localProofScript.indexOf('headsign-typecheck.test.ts'),
  'Exact-dependent surface type tests must run after the frozen surface install/build gate',
);
assert.match(
  localProofScript,
  /admin-ui[^\n]*audit:production|audit:production/,
  'canonical local/CI proof must run the admin production dependency audit',
);

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
assert.match(packageJson.packageManager ?? '', /^bun@\d+\.\d+\.\d+$/);
assert.match(packageJson.devDependencies?.typescript ?? '', /^\d+\.\d+\.\d+$/);

// ENG-24513: .node-version is the single exact Node runtime authority for CI
// and the canonical proof. Package engines stay compatibility ranges that the
// authority must satisfy — declarations, never the CI authority itself.
const nodeAuthorityText = readFileSync(join(ROOT, '.node-version'), 'utf8');
assert.match(
  nodeAuthorityText,
  /^\d+\.\d+\.\d+\n$/,
  '.node-version must pin one exact Node release (no v prefix, one trailing newline)',
);
const nodeAuthority = nodeAuthorityText.trim().split('.').map(Number);
for (const entry of readdirSync(join(ROOT, 'packages')).sort()) {
  const manifestPath = join(ROOT, 'packages', entry, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const engineRange = JSON.parse(readFileSync(manifestPath, 'utf8')).engines?.node;
  if (engineRange === undefined) continue;
  const minimum = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(engineRange);
  assert(
    minimum,
    `packages/${entry} engines.node must stay a >=x.y.z compatibility range, found ${engineRange}`,
  );
  const floor = minimum.slice(1, 4).map(Number);
  const satisfied = nodeAuthority[0] !== floor[0]
    ? nodeAuthority[0] > floor[0]
    : nodeAuthority[1] !== floor[1]
      ? nodeAuthority[1] > floor[1]
      : nodeAuthority[2] >= floor[2];
  assert(
    satisfied,
    `.node-version ${nodeAuthorityText.trim()} must satisfy packages/${entry} engines.node ${engineRange}`,
  );
}

const toolchainAuthority = readFileSync(join(ROOT, 'scripts', 'check-toolchain-authority.mjs'), 'utf8');
assert.match(
  toolchainAuthority,
  /\.node-version/,
  'the canonical toolchain proof must assert the Node runtime authority',
);

const generatedTypesGate = join(ROOT, 'scripts', 'check-generated-types');
const generatedTypesSource = readFileSync(generatedTypesGate, 'utf8');
assert.doesNotMatch(
  generatedTypesSource,
  /\b(?:npx|bunx)\b/,
  'generated-types proof must not contain a registry-capable package-runner fallback',
);
const missingTypeScriptRoot = mkdtempSync(join(tmpdir(), 'snapback-missing-typescript-'));
try {
  const missingTypeScript = spawnSync(generatedTypesGate, [], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SNAPBACK_TYPESCRIPT_NODE_MODULES: missingTypeScriptRoot },
  });
  assert.equal(missingTypeScript.status, 1, 'missing locked TypeScript must fail closed');
  assert.match(missingTypeScript.stderr, /locked TypeScript .* is not installed/);
  assert.doesNotMatch(
    `${missingTypeScript.stdout}${missingTypeScript.stderr}`,
    /downloading|fetching|registry\.npmjs|npm ERR/i,
    'missing TypeScript must not trigger or suggest an automatic network fallback',
  );
} finally {
  rmSync(missingTypeScriptRoot, { recursive: true, force: true });
}

const installerGuard = join(ROOT, 'scripts', 'require-bun-package-manager.mjs');
const rejected = spawnSync(process.execPath, [installerGuard], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, npm_config_user_agent: '', npm_execpath: '' },
});
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /SNAPBACK_PACKAGE_MANAGER_UNSUPPORTED/);
const accepted = spawnSync(process.execPath, [installerGuard], {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, npm_config_user_agent: `bun/${packageJson.packageManager.slice(4)}`, npm_execpath: 'bun' },
});
assert.equal(accepted.status, 0, accepted.stderr);

const credentialCheckScript = join(ROOT, 'scripts', 'check-checkout-credentials');
const runCredentialCheck = (cwd) => spawnSync(credentialCheckScript, [], {
  cwd,
  encoding: 'utf8',
});
const assertCredentialRejected = (result, sentinel, label, message = /authorization header in a repository config/) => {
  assert.equal(result.status, 1, `${label} must fail the checkout proof`);
  assert.match(result.stderr, message);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    new RegExp(sentinel),
    `${label} credential values must never enter diagnostics`,
  );
};

const credentialCheck = runCredentialCheck(ROOT);
assert.equal(credentialCheck.status, 0, credentialCheck.stderr);

const credentialScratch = mkdtempSync(join(tmpdir(), 'snapback-checkout-credentials-'));
try {
  const child = join(credentialScratch, 'child');
  const grandchild = join(credentialScratch, 'grandchild');
  const parent = join(credentialScratch, 'parent');
  execFileSync('git', ['init', '--quiet', grandchild]);
  execFileSync('git', ['-C', grandchild, '-c', 'user.name=Snapback Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'seed']);
  execFileSync('git', ['init', '--quiet', child]);
  execFileSync('git', ['-C', child, '-c', 'user.name=Snapback Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'seed']);
  execFileSync('git', ['init', '--quiet', parent]);
  execFileSync('git', ['-C', parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', child, 'modules/child']);

  execFileSync('git', ['-C', parent, 'config',
    'http.https://github.com/.extraheader', 'AUTHORIZATION: basic root-sentinel-must-not-leak']);
  assertCredentialRejected(
    runCredentialCheck(parent),
    'root-sentinel-must-not-leak',
    'root credential',
  );
  execFileSync('git', ['-C', parent, 'config', '--unset-all', 'http.https://github.com/.extraheader']);

  const benignCredentialsConfig = join(credentialScratch, 'git-credentials-benign.config');
  execFileSync('git', ['config', '--file', benignCredentialsConfig, 'user.name', 'Benign Include']);
  execFileSync('git', ['-C', parent, 'config', 'include.path', benignCredentialsConfig]);
  const benignIncludeCheck = runCredentialCheck(parent);
  assert.equal(
    benignIncludeCheck.status,
    0,
    `an included config without an extraheader must not be a false positive: ${benignIncludeCheck.stderr}`,
  );
  execFileSync('git', ['-C', parent, 'config', '--local', '--no-includes',
    '--unset-all', 'include.path']);

  const rootIncludedCredentials = join(credentialScratch, 'git-credentials-root.config');
  execFileSync('git', ['config', '--file', rootIncludedCredentials,
    'http.https://github.com/.extraheader', 'AUTHORIZATION: basic include-sentinel-must-not-leak']);
  execFileSync('git', ['-C', parent, 'config', 'include.path', rootIncludedCredentials]);
  assertCredentialRejected(
    runCredentialCheck(parent),
    'include-sentinel-must-not-leak',
    'root include credential',
  );
  execFileSync('git', ['-C', parent, 'config', '--local', '--no-includes',
    '--unset-all', 'include.path']);

  const parentGitDir = execFileSync(
    'git',
    ['-C', parent, 'rev-parse', '--absolute-git-dir'],
    { encoding: 'utf8' },
  ).trim().replaceAll('\\', '/');
  const rootIncludeIfKey = `includeIf.gitdir:${parentGitDir}.path`;
  execFileSync('git', ['-C', parent, 'config', rootIncludeIfKey, rootIncludedCredentials]);
  assertCredentialRejected(
    runCredentialCheck(parent),
    'include-sentinel-must-not-leak',
    'root includeIf credential',
  );
  execFileSync('git', ['-C', parent, 'config', '--unset-all', rootIncludeIfKey]);

  const malformedIncludedConfig = join(credentialScratch, 'git-credentials-malformed.config');
  writeFileSync(
    malformedIncludedConfig,
    '[http "https://github.com/"]\n\textraheader = malformed-sentinel-must-not-leak\n[broken\n',
  );
  execFileSync('git', ['-C', parent, 'config', 'include.path', malformedIncludedConfig]);
  assertCredentialRejected(
    runCredentialCheck(parent),
    'malformed-sentinel-must-not-leak',
    'malformed included credential config',
    /could not inspect the effective repository config/,
  );
  rmSync(malformedIncludedConfig);
  execFileSync('git', ['-C', parent, 'config', '--local', '--no-includes',
    '--unset-all', 'include.path']);

  execFileSync('git', ['-C', join(parent, 'modules/child'), 'config',
    'http.https://github.com/.extraheader', 'AUTHORIZATION: basic sentinel-must-not-leak']);
  assertCredentialRejected(
    runCredentialCheck(parent),
    'sentinel-must-not-leak',
    'submodule credential',
  );
  execFileSync('git', ['-C', join(parent, 'modules/child'), 'config',
    '--unset-all', 'http.https://github.com/.extraheader']);

  const childCheckout = join(parent, 'modules/child');
  execFileSync('git', ['-C', childCheckout, '-c', 'protocol.file.allow=always',
    'submodule', 'add', '--quiet', grandchild, 'modules/grandchild']);
  const grandchildCheckout = join(childCheckout, 'modules/grandchild');
  const grandchildGitDir = execFileSync(
    'git',
    ['-C', grandchildCheckout, 'rev-parse', '--absolute-git-dir'],
    { encoding: 'utf8' },
  ).trim().replaceAll('\\', '/');
  const nestedCredentialsConfig = join(credentialScratch, 'git-credentials-nested.config');
  execFileSync('git', ['config', '--file', nestedCredentialsConfig,
    'http.https://github.com/.extraheader', 'AUTHORIZATION: basic nested-sentinel-must-not-leak']);
  execFileSync('git', ['-C', grandchildCheckout, 'config',
    `includeIf.gitdir:${grandchildGitDir}.path`, nestedCredentialsConfig]);
  assertCredentialRejected(
    runCredentialCheck(parent),
    'nested-sentinel-must-not-leak',
    'recursive submodule includeIf credential',
  );
} finally {
  rmSync(credentialScratch, { recursive: true, force: true });
}

console.log(`CI workflow tests: PASS (${workflowNames.length} workflows, ${actionCount} immutable action pins)`);
