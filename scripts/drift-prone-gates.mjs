#!/usr/bin/env node

// Select the frozen-record checks affected by a push. Ordinary landings defer
// their execution to the independent main backstop; an explicit strict mode
// retains synchronous enforcement for operators that need it.
//
// @ref LLP 0232#optimistic-landing-default-2026-08-13 — ordinary pushes
// preserve selection and attribution inputs without synchronously running gates.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadSelectionContext,
  selectChangedPaths,
  selectDriftProneGates,
  selectGate,
} from './select-local-proof.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ZERO_SHA = /^0{40}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const BYPASS_ENV = 'SNAPBACK_DRIFT_GATES_BYPASS';
const FULL_ENV = 'SNAPBACK_DRIFT_GATES_FULL';
const STRICT_ENV = 'SNAPBACK_DRIFT_GATES_STRICT';
const INFRASTRUCTURE_FAILOPEN_ENV = 'SNAPBACK_DRIFT_INFRA_FAILOPEN';
const TICKET_REQUESTS_ENV = 'SNAPBACK_DRIFT_TICKET_REQUESTS';
const DEPENDENCY_MIRROR_SCHEMA = 'snapback.drift-dependency-mirror.v1';
const TICKET_REQUEST_SCHEMA = 'snapback.drift-ticket-request.v1';
const RUNNER_IDENTITY = 'snapback-drift-prone-gates.d3.v1';
const TICKET_REQUEST_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));
const TICKET_REQUEST_STALE_LOCK_MS = 60_000;
const DEFAULT_TICKET_DATE = () => new Date().toISOString().slice(0, 10);
const INFRASTRUCTURE_TICKET_THRESHOLD = 3;
// @ref LLP 0189#decision — D-1 keys complete-battery repair state on each
// normalized root-failure signature and excludes BLOCKED dependents.
const BATTERY_ESCALATION_THRESHOLD = 4;
const BATTERY_RESULT_SCHEMA = 'snapback.proof-gate-result.v2';
const BATTERY_TICKET_DATE_ENV = 'SNAPBACK_BATTERY_TICKET_DATE';
const PUBLICATION_ROOT_CANDIDATES = Object.freeze([
  'crates/snapback-activation/src',
  'crates/snapback-engine/src',
  'crates/snapback/src',
  'src',
]);
const LEGACY_CLAIM_SCOPE_SHARED_ROOTS = Object.freeze([
  'packages/snapback-codegen',
  'packages/snapback-contract',
  'tests',
]);
const LEGACY_CLAIM_SCOPE_FILES = Object.freeze([
  '.gitmodules',
  'Cargo.lock',
  'Cargo.toml',
  'crates/snapback/build.rs',
  'scripts/check-agent-safe-publication.mjs',
  'scripts/generated-artifact-policy.mjs',
  'vendor/ibex',
]);
const INFRASTRUCTURE_OUTPUT = /^(?:Error \[(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)\]: Cannot find (?:package|module)[^\r\n]*|Error: Cannot find module[^\r\n]*|error: couldn't read [^\r\n]*: No such file or directory(?: \(os error \d+\))?|fatal: this operation must be run in a work tree|\[(?:snapback-bootstrap|runtime-link-smoke|ibex-doctor)\] (?:error: |ERROR )?SNAPBACK_(?:CAPABILITY_IBEX|IBEX)_[A-Z0-9_]+[^\r\n]*)$/mu;
const RUNNER_CONTROLLED_OUTPUT = /^(?:fatal: this operation must be run in a work tree|\[(?:snapback-bootstrap|runtime-link-smoke|ibex-doctor)\] (?:error: |ERROR )?SNAPBACK_(?:CAPABILITY_IBEX_HERMES_MISSING|IBEX_(?:HERMES_DOWNLOAD_FAILED|HERMES_ARTIFACTS_UNUSABLE|HOST_UNSUPPORTED|SUBMODULE_INIT_FAILED|RUNTIME_LINK_INTERRUPTED|RUNTIME_LINK_PROBE_FAILED))[^\r\n]*)$/u;
// Git exports these repository-local variables to hooks. They must not leak
// into commands whose cwd is a detached revision worktree, or Git will keep
// resolving the hook caller's index/HEAD instead of the isolated checkout.
// Connection and identity variables such as GIT_SSH_COMMAND and GIT_AUTHOR_*
// deliberately remain intact.
const GIT_LOCAL_ENVIRONMENT = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error?.code === 'SNAPBACK_DRIFT_GATE_INFRASTRUCTURE') {
      console.error(`[snapback-drift] INFRASTRUCTURE ERROR: ${error.message}`);
    } else {
      console.error(`[snapback-drift] ERROR: ${error?.stack ?? error}`);
    }
    process.exitCode = 2;
  });
}

export function parsePrePushUpdates(input) {
  if (input.trim() === '') return [];
  return input.trim().split(/\r?\n/u).map((line) => {
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 4) fail(`invalid pre-push update line: ${line}`);
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if ((!SHA.test(localSha) && !ZERO_SHA.test(localSha))
      || (!SHA.test(remoteSha) && !ZERO_SHA.test(remoteSha))) {
      fail(`invalid pre-push object id: ${line}`);
    }
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

export function changedPathsForUpdate(root, update, remoteName) {
  if (ZERO_SHA.test(update.localSha)) return [];
  let commits;
  if (ZERO_SHA.test(update.remoteSha)) {
    commits = git(root, [
      'rev-list', '--reverse', update.localSha, '--not', `--remotes=${remoteName}`,
    ]).trim().split('\n').filter(Boolean);
  } else {
    commits = git(root, [
      'rev-list', '--reverse', update.localSha, `^${update.remoteSha}`,
    ]).trim().split('\n').filter(Boolean);
  }
  const paths = new Set();
  for (const commit of commits) {
    for (const path of gitPaths(root, [
      'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z',
      '--no-renames', '--diff-filter=ACDMRTUXB', commit,
    ])) paths.add(path);
  }
  if (!ZERO_SHA.test(update.remoteSha)) {
    for (const path of gitPaths(root, [
      'diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACDMRTUXB',
      update.remoteSha, update.localSha,
    ])) paths.add(path);
  }
  return [...paths].sort();
}

export function planPrePush(
  updates,
  remoteName,
  context = loadSelectionContext(),
  root = ROOT,
  { failClosedDisposition = 'core' } = {},
) {
  const byRevision = new Map();
  for (const update of updates) {
    if (ZERO_SHA.test(update.localSha)) continue;
    const entry = byRevision.get(update.localSha) ?? {
      revision: update.localSha,
      refs: [],
      changedPaths: new Set(),
    };
    entry.refs.push({
      localRef: update.localRef,
      remoteRef: update.remoteRef,
      remoteSha: update.remoteSha,
      scheduledMain: remoteName === 'origin' && update.remoteRef === 'refs/heads/main',
    });
    for (const path of changedPathsForUpdate(root, update, remoteName)) {
      entry.changedPaths.add(path);
    }
    byRevision.set(update.localSha, entry);
  }
  return [...byRevision.values()].map((entry) => {
    const changedPaths = [...entry.changedPaths].sort();
    const selection = selectDriftProneGates(
      changedPaths,
      context,
      { failClosedDisposition },
    );
    return {
      revision: entry.revision,
      refs: entry.refs,
      scheduledMain: entry.refs.some((ref) => ref.scheduledMain),
      changedPaths,
      selection,
      gates: selection.selectedDriftProneGates,
    };
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'pre-push') {
    const remoteName = option(args, '--remote', { required: true });
    assertNoUnknownOptions(args, ['--remote']);
    const input = readFileSync(0, 'utf8');
    process.exitCode = runPrePush({ input, remoteName });
    return;
  }
  if (command === 'backstop') {
    const head = option(args, '--head') ?? defaultMainRef();
    const gate = option(args, '--gate');
    const issuesDir = option(args, '--issues-dir') ?? 'issues';
    assertNoUnknownOptions(args, ['--head', '--gate', '--issues-dir']);
    process.exitCode = runBackstop({ head, gate, issuesDir });
    return;
  }
  if (command === 'battery') {
    const head = option(args, '--head') ?? 'HEAD';
    const resultsPath = option(args, '--results', { required: true });
    const runId = option(args, '--run-id', { required: true });
    const issuesDir = option(args, '--issues-dir') ?? 'issues';
    assertNoUnknownOptions(args, ['--head', '--results', '--run-id', '--issues-dir']);
    process.exitCode = runBatteryBackstop({ head, resultsPath, runId, issuesDir });
    return;
  }
  if (command === 'battery-report') {
    const resultsPath = option(args, '--results', { required: true });
    assertNoUnknownOptions(args, ['--results']);
    process.exitCode = runBatteryReport({ resultsPath });
    return;
  }
  if (command === 'battery-check') {
    const head = option(args, '--head') ?? 'HEAD';
    assertNoUnknownOptions(args, ['--head']);
    process.exitCode = runBatteryCheck({ head });
    return;
  }
  if (command === 'failure-signature') {
    const gateId = option(args, '--gate', { required: true });
    const exitCode = Number(option(args, '--exit-code', { required: true }));
    const stdoutPath = option(args, '--stdout', { required: true });
    const stderrPath = option(args, '--stderr', { required: true });
    const normalizationRoot = option(args, '--normalization-root') ?? ROOT;
    assertNoUnknownOptions(args, [
      '--gate', '--exit-code', '--stdout', '--stderr', '--normalization-root',
    ]);
    process.stdout.write(`${batteryFailureSignature({
      gateId,
      exitCode,
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
      normalizationPaths: [normalizationRoot],
    })}\n`);
    return;
  }
  usage();
}

export function runPrePush({
  input,
  remoteName,
  root = ROOT,
  context = loadSelectionContext(),
  env = process.env,
}) {
  const started = performance.now();
  const bypass = env[BYPASS_ENV] ?? '';
  const full = env[FULL_ENV] ?? '';
  const strict = env[STRICT_ENV] ?? '';
  const infrastructureFailOpen = env[INFRASTRUCTURE_FAILOPEN_ENV] ?? '';
  if (bypass !== '' && bypass !== '1') {
    console.error(`[snapback-drift] REFUSED: ${BYPASS_ENV} must be exactly 1 when used`);
    return 2;
  }
  if (full !== '' && full !== '1') {
    console.error(`[snapback-drift] REFUSED: ${FULL_ENV} must be exactly 1 when used`);
    return 2;
  }
  if (strict !== '' && strict !== '1') {
    console.error(`[snapback-drift] REFUSED: ${STRICT_ENV} must be exactly 1 when used`);
    return 2;
  }
  if (!['', '0', '1'].includes(infrastructureFailOpen)) {
    console.error(
      `[snapback-drift] REFUSED: ${INFRASTRUCTURE_FAILOPEN_ENV} must be 0 or 1 when used`,
    );
    return 2;
  }
  const updates = parsePrePushUpdates(input);
  const plans = planPrePush(
    updates,
    remoteName,
    context,
    root,
    { failClosedDisposition: full === '1' ? 'full' : 'core' },
  );
  if (full === '1') {
    const registered = context.inventory.canonicalGates.filter((gate) => (
      Object.hasOwn(context.policy.driftProneGates, gate)
    ));
    for (const plan of plans) plan.gates = registered;
  }
  const changedPathCount = new Set(plans.flatMap((plan) => plan.changedPaths)).size;
  const selected = [...new Set(plans.flatMap((plan) => plan.gates))];
  // FULL used to be an independent selector. Keep that spelling operational
  // by treating it as strict/full, while making the preferred explicit form
  // visible to callers migrating to the optimistic default.
  const strictMode = strict === '1' || full === '1';

  if (plans.length === 0) {
    console.log(`[snapback-drift] FAST PATH: no pushed commits; 0 drift-prone gates run (${elapsed(started)})`);
    return 0;
  }
  if (selected.length === 0) {
    console.log(
      `[snapback-drift] FAST PATH: ${changedPathCount} committed changed path(s); `
        + `0 drift-prone gates run (${elapsed(started)})`,
    );
    return 0;
  }
  if (full === '1' && strict !== '1') {
    console.error(
      `[snapback-drift] COMPATIBILITY: ${FULL_ENV}=1 implies strict full-registry enforcement; `
        + `prefer ${STRICT_ENV}=1 ${FULL_ENV}=1 git push ...`,
    );
  }
  if (full === '1') {
    console.error(
      `[snapback-drift] FULL REGISTRY: selected all ${selected.length} registered gate(s)`,
    );
  }
  if (bypass === '1') {
    announceBypass(plans, changedPathCount, { strictMode });
    console.error(
      `[snapback-drift] BYPASS ALLOWED: skipped ${selected.length} selected gate(s): `
        + `${selected.join(', ')}`,
    );
    return 0;
  }
  if (!strictMode) {
    announceDeferred(plans, context, started);
    return 0;
  }

  const preExistingGates = new Set();
  const corroboratedInfrastructureGates = new Set();
  for (const plan of plans) {
    if (plan.gates.length === 0) continue;
    announceSelection(plan, context, { strictMode: true });
    const requiredSubmodules = [...new Set(plan.gates.flatMap((gate) => (
      context.policy.driftProneGates[gate].requiredSubmodules ?? []
    )))];
    const result = withRevisionWorktree(
      root,
      plan.revision,
      { preferRoot: true, requiredSubmodules },
      (cwd, revisionEnv) => {
        for (const gate of plan.gates) {
          const metadata = context.policy.driftProneGates[gate];
          const command = commandForGate(context, gate);
          const gateStarted = performance.now();
          console.log(`[snapback-drift] RUN ${gate}: ${command}`);
          const gateEnvironment = { ...revisionEnv, ...env };
          if (infrastructureFailOpen !== '0') {
            provisionEnvironmentPaths(
              root,
              cwd,
              metadata.requiredEnvironmentPaths ?? [],
            );
          }
          const closureBeforeExecution = infrastructureFailOpen === '0'
            ? null
            : observedExecutionClosureDigest({
                cwd,
                gate,
                revision: plan.revision,
                command,
                metadata,
                env: gateEnvironment,
              });
          const execution = executeGate(cwd, gate, command, {
            env: gateEnvironment,
            prepareCommand: metadata.prepareCommand,
            environmentRoot: root,
            requiredEnvironmentPaths: metadata.requiredEnvironmentPaths,
            requiredModules: metadata.requiredModules,
            infrastructureClassification: infrastructureFailOpen === '0' ? 'legacy' : 'd3',
          });
          if (!execution.ok) {
            // @ref LLP 0232#rollout-success-and-rollback — the tripwire restores the
            // complete pre-D-3 classifier and attribution protocol, not only the
            // new infrastructure proceed decision.
            if (infrastructureFailOpen === '0') {
              if (execution.infrastructureReason) {
                writeCapturedOutput(execution);
                printInfrastructureFailure({
                  gate,
                  revision: plan.revision,
                  command,
                  execution,
                });
                return 2;
              }
              writeCapturedOutput(execution, { stripJavaScriptStack: true });
              const baseline = baselineRevisionsForPlan(root, plan);
              if (baseline.error) {
                console.error(
                  `[snapback-drift] attribution unavailable: ${baseline.error}; blocking fail-closed`,
                );
                printRefusal({ gate, revision: plan.revision, metadata, cwd, command });
                return 1;
              }
              let preExisting = true;
              for (const revision of baseline.revisions) {
                console.error(
                  `[snapback-drift] ATTRIBUTION CHECK ${gate} at baseline ${revision.slice(0, 12)}`,
                );
                let baselineExecution;
                try {
                  baselineExecution = runGateAtRevision(
                    root,
                    revision,
                    gate,
                    command,
                    metadata,
                    env,
                  );
                } catch (error) {
                  console.error(
                    `[snapback-drift] attribution baseline ${revision.slice(0, 12)} `
                      + `could not be evaluated: ${error?.message ?? error}`,
                  );
                  preExisting = false;
                  break;
                }
                writeCapturedOutput(baselineExecution, { stripJavaScriptStack: true });
                if (baselineExecution.ok) {
                  console.error(
                    `[snapback-drift] attribution baseline ${revision.slice(0, 12)} passes ${gate}; `
                      + 'the pushed revision introduced the staleness',
                  );
                  preExisting = false;
                  break;
                }
                if (baselineExecution.infrastructureReason) {
                  console.error(
                    `[snapback-drift] attribution baseline ${revision.slice(0, 12)} could not `
                      + `faithfully run ${gate}: ${baselineExecution.infrastructureReason}`,
                  );
                  preExisting = false;
                  break;
                }
              }
              if (!preExisting) {
                printRefusal({ gate, revision: plan.revision, metadata, cwd, command });
                return 1;
              }
              printLegacyPreExistingStaleness({
                gate,
                baselines: baseline.revisions,
                root,
              });
              preExistingGates.add(gate);
              continue;
            }

            const pushedEvidence = failureEvidence(execution);
            const closureAfterFailure = safeWorktreeChanges(cwd);
            const closureCleanAfterFailure = closureAfterFailure.error === null
              && closureAfterFailure.paths.length === 0;
            if (pushedEvidence.kind === 'content' && closureCleanAfterFailure) {
              const closureBeforeRepeat = observedExecutionClosureDigest({
                cwd,
                gate,
                revision: plan.revision,
                command,
                metadata,
                env: gateEnvironment,
              });
              if (closureBeforeRepeat !== closureBeforeExecution) {
                writeCapturedOutput(execution, { stripJavaScriptStack: true });
                printUnknownClassification({
                  gate,
                  revision: plan.revision,
                  command,
                  execution,
                  reason: 'observed execution closure changed after the first determinate red',
                });
                return 2;
              }
              console.error(
                `[snapback-drift] DETERMINISM CHECK ${gate} at ${plan.revision.slice(0, 12)}`,
              );
              const repeated = executeGate(cwd, gate, command, {
                env: gateEnvironment,
                prepareCommand: metadata.prepareCommand,
                environmentRoot: root,
                requiredEnvironmentPaths: metadata.requiredEnvironmentPaths,
                requiredModules: metadata.requiredModules,
                infrastructureClassification: 'd3',
              });
              const closureAfterRepeat = safeWorktreeChanges(cwd);
              const closureAfterRepeatDigest = observedExecutionClosureDigest({
                cwd,
                gate,
                revision: plan.revision,
                command,
                metadata,
                env: gateEnvironment,
              });
              const repeatedEvidence = repeated.ok
                ? passEvidence(repeated)
                : failureEvidence(repeated);
              const repeatedDeterminate = repeated.ok || repeatedEvidence.kind === 'content';
              if (repeatedDeterminate
                && repeatedEvidence.normalizedSignature !== pushedEvidence.normalizedSignature
                && closureAfterRepeat.error === null
                && closureAfterRepeat.paths.length === 0
                && closureAfterRepeatDigest === closureBeforeExecution) {
                writeCapturedOutput(execution, { stripJavaScriptStack: true });
                writeCapturedOutput(repeated, {
                  stripJavaScriptStack: repeatedEvidence.kind !== 'runner-setup',
                });
                const nondeterministicEvidence = contradictionEvidence({
                  closureDigest: closureBeforeExecution,
                  first: pushedEvidence,
                  second: repeatedEvidence,
                });
                const ticketRequest = recordTicketRequest({
                  root,
                  env,
                  gate,
                  outcomeType: 'NONDETERMINISTIC',
                  normalizedSignature: nondeterministicEvidence.normalizedSignature,
                  pushedRevision: plan.revision,
                  baselineRevisions: [],
                  failureOutputDigest: pushedEvidence.outputDigest,
                  baselineOutputsDigest: null,
                  corroboration: nondeterministicEvidence.corroboration,
                  attribution: null,
                });
                printTicketRequest(root, ticketRequest);
                printNondeterministicFailure({
                  gate,
                  revision: plan.revision,
                  command,
                  evidence: nondeterministicEvidence,
                });
                return 2;
              }
              if (closureAfterRepeatDigest !== closureBeforeExecution) {
                writeCapturedOutput(execution, { stripJavaScriptStack: true });
                writeCapturedOutput(repeated, {
                  stripJavaScriptStack: repeatedEvidence.kind !== 'runner-setup',
                });
                printUnknownClassification({
                  gate,
                  revision: plan.revision,
                  command,
                  execution: repeated,
                  reason: 'observed execution closure changed during the contradiction check',
                });
                return 2;
              }
              if (!repeatedDeterminate
                || closureAfterRepeat.error !== null
                || closureAfterRepeat.paths.length !== 0) {
                writeCapturedOutput(execution, { stripJavaScriptStack: true });
                writeCapturedOutput(repeated, {
                  stripJavaScriptStack: repeatedEvidence.kind !== 'runner-setup',
                });
                printUnknownClassification({
                  gate,
                  revision: plan.revision,
                  command,
                  execution: repeated,
                  reason: 'the contradiction check did not preserve a clean determinate closure',
                });
                return 2;
              }
            }

            writeCapturedOutput(execution, {
              stripJavaScriptStack: pushedEvidence.kind !== 'runner-setup',
            });
            if (pushedEvidence.kind === 'unknown') {
              printUnknownClassification({
                gate,
                revision: plan.revision,
                command,
                execution,
                reason: pushedEvidence.reason,
              });
              return 2;
            }
            const baseline = baselineRevisionsForPlan(root, plan);
            if (baseline.error) {
              console.error(
                `[snapback-drift] attribution unavailable: ${baseline.error}; blocking fail-closed`,
              );
              if (pushedEvidence.kind === 'runner-setup') {
                printUncorroboratedInfrastructure({
                  gate,
                  revision: plan.revision,
                  command,
                  execution,
                  reason: 'runner setup failure could not be corroborated at every merge-base',
                });
                return 2;
              }
              printContentRed({ gate, revision: plan.revision, reason: baseline.error });
              printRefusal({ gate, revision: plan.revision, metadata, cwd, command });
              return 1;
            }

            const baselineEvidence = [];
            let reproduced = true;
            let reproductionFailure = null;
            for (const revision of baseline.revisions) {
              console.error(
                `[snapback-drift] ATTRIBUTION CHECK ${gate} at baseline ${revision.slice(0, 12)}`,
              );
              let baselineExecution;
              try {
                baselineExecution = runGateAtRevision(
                  root,
                  revision,
                  gate,
                  command,
                  metadata,
                  env,
                  { infrastructureClassification: 'd3' },
                );
              } catch (error) {
                console.error(
                  `[snapback-drift] attribution baseline ${revision.slice(0, 12)} `
                    + `could not be evaluated: ${error?.message ?? error}`,
                );
                reproductionFailure = `baseline ${revision.slice(0, 12)} unavailable`;
                reproduced = false;
                break;
              }
              const evidence = baselineExecution.ok
                ? passEvidence(baselineExecution)
                : failureEvidence(baselineExecution);
              baselineEvidence.push({ revision, ...evidence });
              writeCapturedOutput(baselineExecution, {
                stripJavaScriptStack: evidence.kind !== 'runner-setup',
              });
              if (baselineExecution.ok) {
                console.error(
                  `[snapback-drift] attribution baseline ${revision.slice(0, 12)} passes ${gate}; `
                    + 'the pushed revision introduced the staleness',
                );
                reproductionFailure = `baseline ${revision.slice(0, 12)} passed`;
                reproduced = false;
                break;
              }
              if (evidence.kind !== pushedEvidence.kind) {
                console.error(
                  `[snapback-drift] attribution baseline ${revision.slice(0, 12)} classified `
                    + `${evidence.kind}, expected ${pushedEvidence.kind}`,
                );
                reproductionFailure = `baseline ${revision.slice(0, 12)} classification mismatch`;
                reproduced = false;
                break;
              }
              if (evidence.normalizedSignature !== pushedEvidence.normalizedSignature) {
                console.error(
                  `[snapback-drift] attribution baseline ${revision.slice(0, 12)} signature `
                    + `${evidence.normalizedSignature ?? '<unavailable>'} does not match pushed `
                    + `${pushedEvidence.normalizedSignature}`,
                );
                reproductionFailure = `baseline ${revision.slice(0, 12)} signature mismatch`;
                reproduced = false;
                break;
              }
            }

            if (!reproduced) {
              if (pushedEvidence.kind === 'runner-setup') {
                printUncorroboratedInfrastructure({
                  gate,
                  revision: plan.revision,
                  command,
                  execution,
                  reason: reproductionFailure,
                });
                return 2;
              }
              printContentRed({
                gate,
                revision: plan.revision,
                reason: reproductionFailure,
              });
              printRefusal({ gate, revision: plan.revision, metadata, cwd, command });
              return 1;
            }

            const baselineOutputsDigest = digestJson(baselineEvidence.map((evidence) => ({
              revision: evidence.revision,
              outputDigest: evidence.outputDigest,
              normalizedSignature: evidence.normalizedSignature,
            })));
            const corroboration = baselineEvidence.map((evidence) => ({
              revision: evidence.revision,
              phase: evidence.phase,
              status: evidence.status,
              signal: evidence.signal,
              kind: evidence.kind,
              reason: evidence.reason,
              normalizedSignature: evidence.normalizedSignature,
              outputDigest: evidence.outputDigest,
            }));
            const outcomeType = pushedEvidence.kind === 'runner-setup'
              ? 'INFRASTRUCTURE'
              : 'INHERITED_RED';
            const ticketRequest = recordTicketRequest({
              root,
              env,
              gate,
              outcomeType,
              normalizedSignature: pushedEvidence.normalizedSignature,
              pushedRevision: plan.revision,
              baselineRevisions: baseline.revisions,
              failureOutputDigest: pushedEvidence.outputDigest,
              baselineOutputsDigest,
              corroboration,
              attribution: outcomeType === 'INHERITED_RED'
                ? { type: 'merge-base-signature-reproduction', revisions: baseline.revisions }
                : null,
            });
            printTicketRequest(root, ticketRequest);
            if (outcomeType === 'INFRASTRUCTURE') {
              printCorroboratedInfrastructure({
                gate,
                revision: plan.revision,
                command,
                pushedEvidence,
                baselineOutputsDigest,
                corroboration,
              });
              corroboratedInfrastructureGates.add(gate);
              continue;
            }
            printPreExistingStaleness({
              gate,
              baselines: baseline.revisions,
              root,
              normalizedSignature: pushedEvidence.normalizedSignature,
            });
            preExistingGates.add(gate);
            continue;
          }
          writeCapturedOutput(execution);
          console.log(`[snapback-drift] PASS ${gate} (${elapsed(gateStarted)})`);
        }
        return 0;
      },
    );
    if (result !== 0) return result;
  }
  if (preExistingGates.size > 0) {
    console.error(
      `[snapback-drift] ALLOWED WITH PRE-EXISTING STALENESS: ${preExistingGates.size} `
        + `gate(s) stale on the baseline; see issues/ tickets (${elapsed(started)})`,
    );
  }
  if (corroboratedInfrastructureGates.size > 0) {
    console.error(
      `[snapback-drift] ALLOWED WITH CORROBORATED INFRASTRUCTURE: `
        + `${corroboratedInfrastructureGates.size} gate(s); durable ticket request(s) recorded `
        + `(${elapsed(started)})`,
    );
  }
  if (preExistingGates.size > 0 || corroboratedInfrastructureGates.size > 0) return 0;
  console.log(
    `[snapback-drift] ALLOWED: ${selected.length} selected drift-prone gate(s) passed `
      + `(${elapsed(started)})`,
  );
  return 0;
}

function baselineRevisionsForPlan(root, plan) {
  const revisions = new Set();
  for (const ref of plan.refs) {
    let target = ref.remoteSha;
    if (ZERO_SHA.test(target)) {
      try {
        target = defaultMainRef(root);
      } catch (error) {
        return { revisions: [], error: error?.message ?? `${error}` };
      }
    }
    let baseline;
    try {
      baseline = git(root, ['merge-base', plan.revision, target]).trim();
    } catch (error) {
      return {
        revisions: [],
        error: `merge-base ${plan.revision.slice(0, 12)} ${target} did not resolve `
          + `(${error?.message ?? error})`,
      };
    }
    if (!SHA.test(baseline)) {
      return { revisions: [], error: `merge-base against ${target} was not a commit` };
    }
    if (baseline === plan.revision) {
      return {
        revisions: [],
        error: `baseline equals pushed revision ${plan.revision.slice(0, 12)}`,
      };
    }
    revisions.add(baseline);
  }
  if (revisions.size === 0) return { revisions: [], error: 'no baseline revision resolved' };
  return { revisions: [...revisions], error: null };
}

function printPreExistingStaleness({ gate, baselines, root, normalizedSignature }) {
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error(
    `[snapback-drift] OUTCOME INHERITED_RED ${gate}: signature ${normalizedSignature} `
      + 'reproduced at every required merge-base; proceeding with ticket request',
  );
  for (const baseline of baselines) {
    console.error(
      `[snapback-drift] PRE-EXISTING STALE ${gate}: also fails at baseline `
        + `${baseline.slice(0, 12)} (not caused by this push)`,
    );
  }
  const ticket = findOpenTicket(join(root, 'issues'), gate);
  if (ticket) {
    console.error(`[snapback-drift] open backstop ticket: ${relative(root, ticket)}`);
  } else {
    console.error(
      '[snapback-drift] no open backstop ticket found; the scheduled complete backstop will file one',
    );
  }
  console.error('[snapback-drift] continuing with the remaining selected gates');
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
}

function printLegacyPreExistingStaleness({ gate, baselines, root }) {
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  for (const baseline of baselines) {
    console.error(
      `[snapback-drift] PRE-EXISTING STALE ${gate}: also fails at baseline `
        + `${baseline.slice(0, 12)} (not caused by this push)`,
    );
  }
  const ticket = findOpenTicket(join(root, 'issues'), gate);
  if (ticket) {
    console.error(`[snapback-drift] open backstop ticket: ${relative(root, ticket)}`);
  } else {
    console.error(
      '[snapback-drift] no open backstop ticket found; the scheduled complete backstop will file one',
    );
  }
  console.error('[snapback-drift] continuing with the remaining selected gates');
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
}

function announceSelection(plan, context, { strictMode }) {
  const short = plan.revision.slice(0, 12);
  console.log(
    `[snapback-drift] ${short}: ${plan.changedPaths.length} committed path(s) across `
      + `${plan.refs.length} ref update(s) selected ${plan.gates.length} gate(s): `
      + `${plan.gates.join(', ')}`,
  );
  if (plan.selection.unknownFiles.length === 0 && plan.selection.broadFiles.length === 0) return;
  const reasons = [
    ...plan.selection.unknownFiles.map((path) => `unknown:${path}`),
    ...plan.selection.broadFiles.map((path) => `broad:${path}`),
  ];
  const disposition = plan.selection.driftFailClosedDisposition.toUpperCase();
  const prefix = strictMode ? 'FAIL-CLOSED' : 'DEFERRED BROAD';
  const action = strictMode ? 'running' : 'selected';
  console.error(
    `[snapback-drift] ${prefix} selection: ${reasons.join(', ')}; ${action} `
      + `${disposition} tier (${plan.gates.length} of `
      + `${Object.keys(context.policy.driftProneGates).length} registered gates)`
      + (plan.selection.driftFailClosedDisposition === 'core'
        ? `; ${STRICT_ENV}=1 ${FULL_ENV}=1 runs the complete registry synchronously`
        : ''),
  );
}

function announceDeferred(plans, context, started) {
  for (const plan of plans) {
    if (plan.gates.length > 0) announceSelection(plan, context, { strictMode: false });
  }
  const scheduledPlans = plans.filter((plan) => plan.scheduledMain);
  const nonMainPlans = plans.filter((plan) => plan.refs.some((ref) => !ref.scheduledMain));
  const nonMainRefCount = nonMainPlans.reduce((count, plan) => (
    count + plan.refs.filter((ref) => !ref.scheduledMain).length
  ), 0);
  const scheduledGates = [...new Set(scheduledPlans.flatMap((plan) => plan.gates))];
  const nonMainGates = [...new Set(nonMainPlans.flatMap((plan) => plan.gates))];
  const scheduledPathCount = new Set(
    scheduledPlans.flatMap((plan) => plan.changedPaths),
  ).size;
  const nonMainPathCount = new Set(nonMainPlans.flatMap((plan) => plan.changedPaths)).size;
  if (scheduledGates.length > 0) {
    console.log(
      `[snapback-drift] DEFERRED BY DEFAULT: ${scheduledPathCount} origin/main committed path(s) selected `
        + `${scheduledGates.length} origin/main drift-prone gate(s); no gate commands ran: `
        + `${scheduledGates.join(', ')}`,
    );
    console.log(
      '[snapback-drift] scheduled authority: node scripts/drift-prone-gates.mjs backstop; '
        + `strict opt-in: ${STRICT_ENV}=1 git push ...`,
    );
  }
  if (nonMainPlans.length > 0) {
    console.log(
      `[snapback-drift] NON-MAIN REF: ${nonMainRefCount} ref update(s) across `
        + `${nonMainPlans.length} distinct revision(s), ${nonMainPathCount} committed path(s), `
        + `selected ${nonMainGates.length} gate(s); no gate commands ran and no independent `
        + `scheduled-main verdict is claimed: ${nonMainGates.join(', ')}`,
    );
    console.log(
      `[snapback-drift] a same-tip origin/main update is covered by that landing; otherwise a `
        + `later origin/main landing is selected from its own ref update; strict opt-in now: `
        + `${STRICT_ENV}=1 git push ...`,
    );
  }
  const disposition = scheduledGates.length > 0
    ? 'origin/main frozen-record checks deferred to the scheduled backstop'
    : 'non-main ref updates left frozen-record execution to an explicit strict run or later origin/main landing';
  console.log(`[snapback-drift] ALLOWED: ${disposition} (${elapsed(started)})`);
}

function announceBypass(plans, changedPathCount, { strictMode }) {
  const gates = [...new Set(plans.flatMap((plan) => plan.gates))];
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error(`[snapback-drift] BYPASS ACTIVE: ${BYPASS_ENV}=1`);
  console.error(
    `[snapback-drift] ${changedPathCount} committed path(s), ${gates.length} selected gate(s); `
      + 'this push may leave frozen records stale and the main backstop remains armed',
  );
  if (!strictMode) {
    console.error(
      `[snapback-drift] COMPATIBILITY BYPASS: ordinary pushes already defer these gates; `
        + `${BYPASS_ENV}=1 remains accepted for legacy callers`,
    );
  }
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
}

export function printRefusal({ gate, revision, metadata, cwd, command }) {
  console.error(
    `[snapback-drift] REFUSED: ${revision.slice(0, 12)} failed drift-prone gate ${gate}`,
  );
  for (const record of metadata.records) {
    console.error(`[snapback-drift] stale record: ${record}`);
  }
  console.error(`[snapback-drift] check command: ${command}`);
  console.error(`[snapback-drift] regenerate: ${metadata.regenerateCommand}`);
  if (metadata.blessedRegenerateCommand) {
    console.error(`[snapback-drift] blessed rollover: ${metadata.blessedRegenerateCommand}`);
  }
  const changes = safeWorktreeChanges(cwd);
  for (const path of changes.paths) {
    console.error(`[snapback-drift] regenerated path: ${path}`);
  }
  if (changes.error) {
    console.error(
      `[snapback-drift] regenerated path inspection unavailable (non-fatal): ${changes.error}`,
    );
  }
  console.error(
    '[snapback-drift] commit/amend the refreshed record with the measured change, then push again',
  );
  console.error(
    `[snapback-drift] emergency bypass (LOUD): ${BYPASS_ENV}=1 git push ...; `
      + 'the main backstop will file an issue if drift remains',
  );
}

function printInfrastructureFailure({ gate, revision, command, execution }) {
  console.error(
    `[snapback-drift] INFRASTRUCTURE ERROR: ${revision.slice(0, 12)} could not faithfully run ${gate}`,
  );
  console.error(`[snapback-drift] infrastructure phase: ${execution.phase}`);
  console.error(`[snapback-drift] infrastructure reason: ${execution.infrastructureReason}`);
  console.error(`[snapback-drift] check command: ${command}`);
  console.error('[snapback-drift] no stale-record conclusion was made; repair the gate environment and retry');
}

function printContentRed({ gate, revision, reason }) {
  console.error(
    `[snapback-drift] OUTCOME CONTENT_RED ${gate} at ${revision.slice(0, 12)}: ${reason}`,
  );
}

function printUnknownClassification({ gate, revision, command, execution, reason }) {
  console.error(
    `[snapback-drift] OUTCOME UNKNOWN ${gate} at ${revision.slice(0, 12)}: `
      + `${reason ?? 'the execution did not yield classifiable evidence'}; blocking control-plane failure`,
  );
  console.error(`[snapback-drift] unknown phase: ${execution.phase}`);
  console.error(`[snapback-drift] unknown status: ${execution.status ?? 'none'}`);
  console.error(`[snapback-drift] unknown signal: ${execution.signal ?? 'none'}`);
  console.error(`[snapback-drift] check command: ${command}`);
}

function printUncorroboratedInfrastructure({ gate, revision, command, execution, reason }) {
  console.error(
    `[snapback-drift] OUTCOME INFRASTRUCTURE-UNCORROBORATED ${gate} `
      + `at ${revision.slice(0, 12)}: ${reason}; blocking as content evidence`,
  );
  console.error(`[snapback-drift] pushed runner-setup phase: ${execution.phase}`);
  console.error(`[snapback-drift] pushed runner-setup reason: ${execution.infrastructureReason}`);
  console.error(`[snapback-drift] check command: ${command}`);
  console.error(
    '[snapback-drift] no stale-record or infrastructure conclusion was made; '
      + 'inspect the pushed change and runner inputs before retrying',
  );
}

function printNondeterministicFailure({ gate, revision, command, evidence }) {
  console.error(
    `[snapback-drift] OUTCOME NONDETERMINISTIC ${gate} at ${revision.slice(0, 12)}: `
      + 'contradictory determinate executions over the same gate/revision closure; '
      + 'blocking control-plane failure with no attribution',
  );
  console.error(`[snapback-drift] nondeterministic signature: ${evidence.normalizedSignature}`);
  console.error(`[snapback-drift] closure digest: ${evidence.closureDigest}`);
  console.error(`[snapback-drift] check command: ${command}`);
}

function printCorroboratedInfrastructure({
  gate,
  revision,
  command,
  pushedEvidence,
  baselineOutputsDigest,
  corroboration,
}) {
  const receipt = {
    outcome: 'INFRASTRUCTURE',
    gate,
    pushedRevision: revision,
    normalizedSignature: pushedEvidence.normalizedSignature,
    reason: pushedEvidence.reason,
    fullFailureOutputDigest: pushedEvidence.outputDigest,
    baselineOutputsDigest,
    corroboration,
  };
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error(
    `[snapback-drift] OUTCOME INFRASTRUCTURE ${gate}: runner-controlled failure `
      + `reproduced at every required merge-base; proceeding with ticket request`,
  );
  console.error(`[snapback-drift] infrastructure reason: ${pushedEvidence.reason}`);
  console.error(`[snapback-drift] infrastructure receipt: ${JSON.stringify(receipt)}`);
  console.error(`[snapback-drift] check command: ${command}`);
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
}

function printTicketRequest(root, result) {
  console.error(
    `[snapback-drift] TICKET REQUEST ${result.created ? 'RECORDED' : 'RETAINED'}: `
      + `${relative(root, result.path)} outcome=${result.request.outcomeType} `
      + `signature=${result.request.normalizedSignature}`,
  );
}

function passEvidence(execution) {
  return {
    kind: 'pass',
    phase: execution.phase,
    status: execution.status,
    signal: execution.signal,
    normalizedSignature: digestJson({ kind: 'pass', status: execution.status }),
    outputDigest: executionOutputDigest(execution),
  };
}

function failureEvidence(execution) {
  const normalizedOutput = {
    stdout: normalizeFailureText(execution.stdout ?? '', execution.normalizationPaths),
    stderr: normalizeFailureText(execution.stderr ?? '', execution.normalizationPaths),
  };
  let kind = execution.failureKind ?? 'unknown';
  let reason = execution.infrastructureReason ?? null;
  if (kind === 'content' && normalizedOutput.stdout === '' && normalizedOutput.stderr === '') {
    kind = 'unknown';
    reason = 'nonzero execution supplied no diagnostic output';
  }
  if (kind === 'runner-setup' && !execution.infrastructureReason) {
    kind = 'unknown';
    reason = 'runner setup classification lacked a positive infrastructure reason';
  }
  const normalized = {
    kind,
    phase: execution.phase,
    status: execution.status,
    signal: execution.signal,
    reason: normalizeFailureText(
      execution.infrastructureReason ?? '',
      execution.normalizationPaths,
    ),
    output: normalizedOutput,
  };
  return {
    ...normalized,
    reason,
    normalizedSignature: kind === 'unknown' ? null : digestJson(normalized),
    outputDigest: executionOutputDigest(execution),
  };
}

function backstopFailureSignature(execution, evidence = failureEvidence(execution)) {
  return evidence.normalizedSignature ?? digestJson({
    kind: 'backstop-unknown',
    phase: execution.phase,
    status: execution.status,
    signal: execution.signal,
    reason: evidence.reason,
    output: evidence.output,
  });
}

export function batteryFailureSignature({
  gateId,
  exitCode,
  stdout,
  stderr,
  normalizationPaths = [],
}) {
  if (typeof gateId !== 'string' || !/^[a-z0-9-]+$/u.test(gateId)) {
    fail(`invalid battery gate id ${gateId}`);
  }
  if (!Number.isSafeInteger(exitCode) || exitCode <= 0) {
    fail(`invalid battery exit code ${exitCode}`);
  }
  return backstopFailureSignature({
    phase: 'check',
    status: exitCode,
    signal: null,
    failureKind: 'content',
    infrastructureReason: null,
    stdout,
    stderr,
    normalizationPaths,
  });
}

function contradictionEvidence({ closureDigest, first, second }) {
  const corroboration = [
    {
      ordinal: 1,
      outcome: 'red',
      kind: first.kind,
      normalizedSignature: first.normalizedSignature,
      outputDigest: first.outputDigest,
    },
    {
      ordinal: 2,
      outcome: second.kind === 'pass' ? 'green' : 'red',
      kind: second.kind,
      normalizedSignature: second.normalizedSignature,
      outputDigest: second.outputDigest,
    },
  ];
  return {
    closureDigest,
    corroboration,
    normalizedSignature: digestJson({
      outcome: 'NONDETERMINISTIC',
      closureDigest,
      executions: corroboration.map(({ outcome, kind, normalizedSignature }) => ({
        outcome,
        kind,
        normalizedSignature,
      })),
    }),
  };
}

function recordTicketRequest({
  root,
  env,
  gate,
  outcomeType,
  normalizedSignature,
  pushedRevision,
  baselineRevisions,
  failureOutputDigest,
  baselineOutputsDigest,
  corroboration,
  attribution,
}) {
  // @ref LLP 0232#d-3-closed-outcome-classification-and-ticketing — proceeding is bound to a durable, signature-keyed
  // request; committed ticket projection remains the backstop's authority.
  const configuredPath = env[TICKET_REQUESTS_ENV]
    ?? 'target/proof/drift-ticket-requests.jsonl';
  const path = resolve(root, configuredPath);
  if (path === resolve(root) || !path.startsWith(`${resolve(root)}${sep}`)) {
    fail(`${TICKET_REQUESTS_ENV} escapes repository: ${configuredPath}`);
  }
  const observedAt = new Date().toISOString();
  const requestKey = digestJson({ gate, normalizedSignature });
  const core = {
    schemaVersion: TICKET_REQUEST_SCHEMA,
    requestKey,
    gateId: gate,
    normalizedSignature,
    outcomeType,
    pushedRevision,
    baselineRevisions: [...baselineRevisions],
    observedAt,
    recordedAt: observedAt,
    projectionDueBy: new Date(Date.parse(observedAt) + 2 * 60 * 60 * 1000).toISOString(),
    runnerIdentity: {
      id: RUNNER_IDENTITY,
      mode: 'pre-push',
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
    },
    failureOutputDigest,
    baselineOutputsDigest,
    corroboration,
    attribution,
  };
  const request = { ...core, requestDigest: digestJson(core) };
  mkdirSync(dirname(path), { recursive: true });
  return withTicketRequestLock(path, () => {
    const existing = readTicketRequests(path);
    const retained = existing.find((candidate) => candidate.requestKey === requestKey);
    if (retained) {
      if (retained.gateId !== gate
        || retained.normalizedSignature !== normalizedSignature
        || retained.outcomeType !== outcomeType) {
        fail(`ticket request key collision for ${gate} ${normalizedSignature}`);
      }
      return { path, request: retained, created: false };
    }
    const descriptor = openSync(path, 'a', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(request)}\n`);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    return { path, request, created: true };
  });
}

function withTicketRequestLock(path, callback) {
  const lock = `${path}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      mkdirSync(lock);
      acquired = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (breakStaleTicketRequestLock(lock)) continue;
      Atomics.wait(TICKET_REQUEST_LOCK_WAIT, 0, 0, 25);
    }
  }
  if (!acquired) fail(`timed out acquiring ticket request lock ${lock}`);
  try {
    return callback();
  } finally {
    rmdirSync(lock);
  }
}

function breakStaleTicketRequestLock(lock) {
  let age;
  try {
    age = Date.now() - statSync(lock).mtimeMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
  if (age <= TICKET_REQUEST_STALE_LOCK_MS) return false;
  const stale = `${lock}.stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(lock, stale);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EEXIST') return true;
    throw error;
  }
  rmSync(stale, { recursive: true, force: true });
  return true;
}

function readTicketRequests(path) {
  if (!existsSync(path)) return [];
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    fail(`could not read ticket requests ${path}: ${error?.message ?? error}`);
  }
  const requests = [];
  const validLines = [];
  const quarantined = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (line.trim() === '') continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch (error) {
      quarantined.push({
        schemaVersion: 'snapback.drift-ticket-request-quarantine.v1',
        observedAt: new Date().toISOString(),
        lineNumber: index + 1,
        rawLine: line,
        rawLineDigest: digestText(line),
        reason: `invalid JSON: ${error?.message ?? error}`,
      });
      continue;
    }
    if (request?.schemaVersion !== TICKET_REQUEST_SCHEMA
      || typeof request.requestKey !== 'string'
      || typeof request.normalizedSignature !== 'string') {
      fail(`invalid ticket request entry in ${path}`);
    }
    const { requestDigest, ...core } = request;
    if (requestDigest !== digestJson(core)
      || request.requestKey !== digestJson({
        gate: request.gateId,
        normalizedSignature: request.normalizedSignature,
      })) {
      fail(`ticket request integrity mismatch in ${path}`);
    }
    requests.push(request);
    validLines.push(JSON.stringify(request));
  }
  if (quarantined.length > 0) {
    appendTicketRequestQuarantine(path, quarantined);
    replaceTicketRequests(path, validLines);
  }
  return requests;
}

function appendTicketRequestQuarantine(path, entries) {
  const descriptor = openSync(`${path}.quarantine.jsonl`, 'a', 0o600);
  try {
    writeFileSync(descriptor, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function replaceTicketRequests(path, lines) {
  const temporary = `${path}.repair-${process.pid}-${Date.now()}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    writeFileSync(descriptor, lines.length > 0 ? `${lines.join('\n')}\n` : '');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function executionOutputDigest(execution) {
  return digestJson({
    phase: execution.phase,
    status: execution.status,
    signal: execution.signal,
    infrastructureReason: execution.infrastructureReason,
    stdout: execution.stdout ?? '',
    stderr: execution.stderr ?? '',
  });
}

function normalizeFailureText(value, paths = []) {
  let normalized = value;
  for (const path of [...new Set(paths)].sort((left, right) => right.length - left.length)) {
    normalized = normalized.split(path).join('<runner-root>');
  }
  return normalized
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[0-9a-f]{40}/gu, '<sha>')
    .replace(/[^\s'"`]*\.snapback-drift-worktree-[^/\s:'"`]+/gu, '<worktree>')
    .replace(/\/var\/folders\/[^\s'"`]+/gu, '<temp-path>')
    .replace(/(?:\/private)?\/tmp\/[^\s'"`]+/gu, '<temp-path>')
    .replace(/\/var\/tmp\/[^\s'"`]+/gu, '<temp-path>')
    .replace(
      /\b((?:temp(?:orary)?(?:dir|directory)?|tmpdir)\s*[:=]\s*)[^\s,'"`}]+/giu,
      '$1<temp-path>',
    )
    // Node's TAP reporter emits both YAML `duration_ms: N` fields and the
    // aggregate `# duration_ms N` line. Some harnesses retain a one-line
    // `timings` object instead. None identifies the root cause.
    .replace(/\b(duration_ms\s*:?\s*)\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu, '$1<duration>')
    .replace(/\b(durationMs\s*[:=]\s*)\d+(?:\.\d+)?(?:e[+-]?\d+)?/gu, '$1<duration>')
    .replace(/\b(timings?\s*[:=]\s*)(?:\{[^\n}]*\}|\[[^\n\]]*\]|[^\n]+)/giu, '$1<timings>')
    .replace(/\b\d+(?:\.\d+)?m?s\b/gu, '<duration>')
    .replace(/\b(pid|process id)\s*[=:]?\s*\d+\b/giu, '$1 <pid>')
    .replace(/\bport\s*[=:]?\s*\d{1,5}\b/giu, 'port <port>')
    .replace(/\b(localhost|127\.0\.0\.1):\d{1,5}\b/gu, '$1:<port>')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line !== '' || (index > 0 && index < lines.length - 1))
    .join('\n')
    .trim();
}

function digestJson(value) {
  return digestText(JSON.stringify(value));
}

function digestText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function observedExecutionClosureDigest({ cwd, gate, revision, command, metadata, env }) {
  const executionEnvironment = sanitizedGitEnvironment(env);
  const environment = Object.entries(executionEnvironment)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => [name, digestText(`${value}`)]);
  const requiredEnvironmentPaths = (metadata.requiredEnvironmentPaths ?? []).map((path) => ({
    path,
    fact: semanticPathFact(join(cwd, path)),
  }));
  const requiredModules = (metadata.requiredModules ?? []).map((specifier) => (
    requiredModuleFact(cwd, specifier)
  ));
  const requiredSubmodules = (metadata.requiredSubmodules ?? []).map((path) => ({
    path,
    fact: gitCheckoutFact(join(cwd, path), { includeRuntimeArtifacts: true }),
  }));
  // @ref LLP 0232#d-4-health-records-producer-map-and-green-pointer — the
  // contradiction boundary covers the complete installed dependency mirror,
  // not only registry-named package roots. Packages such as esbuild execute
  // platform siblings outside their own package directory.
  const installedDependencies = installedDependencyTrees(cwd).map((path) => ({
    path,
    fact: semanticPathDigestFact(join(cwd, path)),
  }));
  return digestJson({
    schemaVersion: 'snapback.drift-observed-execution-closure.v2',
    gate,
    revision,
    tree: git(cwd, ['rev-parse', 'HEAD^{tree}']).trim(),
    command,
    prepareCommand: metadata.prepareCommand ?? null,
    dependencyMirrorKey: dependencyMirrorKey(cwd),
    requiredEnvironmentPaths,
    requiredModules,
    requiredSubmodules,
    installedDependencies,
    preparedEnvironment: preparedEnvironmentFacts(env),
    environment,
    toolchain: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      executables: toolchainExecutableFacts(env),
    },
  });
}

function requiredModuleFact(cwd, specifier) {
  const require = createRequire(join(cwd, 'package.json'));
  let resolved;
  try {
    resolved = require.resolve(specifier);
  } catch {
    return { specifier, kind: 'missing' };
  }
  let packageRoot = dirname(resolved);
  while (packageRoot !== dirname(packageRoot) && !existsSync(join(packageRoot, 'package.json'))) {
    packageRoot = dirname(packageRoot);
  }
  return {
    specifier,
    resolved: relative(cwd, resolved),
    packageRoot: relative(cwd, packageRoot),
    fact: semanticPathFact(packageRoot),
  };
}

function preparedEnvironmentFacts(env) {
  const facts = [];
  const ibex = env.SNAPBACK_IBEX_CHECKOUT;
  if (ibex) {
    facts.push({
      name: 'SNAPBACK_IBEX_CHECKOUT',
      fact: gitCheckoutFact(ibex, { includeRuntimeArtifacts: true }),
    });
  }
  const binary = env.SNAPBACK_PREPARED_RUNTIME_BINARY
    ?? (env.SNAPBACK_PREPARED_RUNTIME_ROOT
      ? join(env.SNAPBACK_PREPARED_RUNTIME_ROOT, 'target/debug/snapback')
      : null);
  if (binary) {
    facts.push({
      name: 'SNAPBACK_PREPARED_RUNTIME_BINARY',
      fact: semanticPathFact(binary),
    });
    facts.push({
      name: 'SNAPBACK_PREPARED_RUNTIME_RECEIPT',
      fact: semanticPathFact(`${binary}.runtime-readiness.json`),
    });
  }
  if (env.CARGO_TARGET_DIR) {
    const targetBinary = join(env.CARGO_TARGET_DIR, 'debug/snapback');
    facts.push({ name: 'CARGO_TARGET_BINARY', fact: semanticPathFact(targetBinary) });
    facts.push({
      name: 'CARGO_TARGET_RUNTIME_RECEIPT',
      fact: semanticPathFact(`${targetBinary}.runtime-readiness.json`),
    });
  }
  if (env.HERMES_LIB_DIR) {
    facts.push({ name: 'HERMES_LIB_DIR', fact: semanticPathFact(env.HERMES_LIB_DIR) });
  }
  return facts;
}

function gitCheckoutFact(path, { includeRuntimeArtifacts = false } = {}) {
  if (!pathExists(path)) return { kind: 'missing' };
  let head = null;
  let tree = null;
  let status = null;
  try {
    head = git(path, ['rev-parse', 'HEAD']).trim();
    tree = git(path, ['rev-parse', 'HEAD^{tree}']).trim();
    status = digestText(git(path, [
      'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no',
    ], { encoding: 'buffer' }));
  } catch {
    return { kind: 'non-git', fact: semanticPathFact(path) };
  }
  const artifacts = includeRuntimeArtifacts
    ? [
        'ios/Frameworks',
        'linux/hermes-headers',
        'linux/lib',
        'tools/hermes',
      ].map((relativePath) => ({
        path: relativePath,
        fact: semanticPathFact(join(path, relativePath)),
      }))
    : [];
  return { kind: 'git', head, tree, status, artifacts };
}

function toolchainExecutableFacts(env) {
  const names = ['bash', 'bun', 'cargo', 'env', 'find', 'git', 'grep', 'node', 'python3', 'rustc', 'sh'];
  const facts = [{ name: 'node-current', path: process.execPath, fact: semanticPathFact(process.execPath) }];
  for (const name of names) {
    const path = resolvePathExecutable(env.PATH ?? '', name);
    facts.push({ name, path, fact: path === null ? { kind: 'missing' } : semanticPathFact(path) });
  }
  facts.push({ name: 'shell-fixed', path: '/bin/sh', fact: semanticPathFact('/bin/sh') });
  return facts;
}

function resolvePathExecutable(pathValue, name) {
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

function semanticPathFact(path, seen = new Set()) {
  if (!pathExists(path)) return { kind: 'missing' };
  const resolved = resolve(path);
  if (seen.has(resolved)) return { kind: 'cycle' };
  seen.add(resolved);
  try {
    const entry = lstatSync(resolved);
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(resolved), readlinkSync(resolved));
      return { kind: 'symlink', target: semanticPathFact(target, seen) };
    }
    if (entry.isFile()) {
      const bytes = readFileSync(resolved);
      return {
        kind: 'file',
        mode: entry.mode & 0o777,
        bytes: bytes.length,
        digest: digestText(bytes),
      };
    }
    if (entry.isDirectory()) {
      return {
        kind: 'directory',
        entries: readdirSync(resolved).sort().map((name) => ({
          name,
          fact: semanticPathFact(join(resolved, name), seen),
        })),
      };
    }
    return { kind: 'other', mode: entry.mode, bytes: entry.size };
  } finally {
    seen.delete(resolved);
  }
}

function semanticPathDigestFact(path, seen = new Set()) {
  if (!pathExists(path)) return { kind: 'missing' };
  const resolved = resolve(path);
  if (seen.has(resolved)) return { kind: 'cycle' };
  seen.add(resolved);
  try {
    const entry = lstatSync(resolved);
    if (entry.isSymbolicLink()) {
      const link = readlinkSync(resolved);
      const target = resolve(dirname(resolved), link);
      return {
        kind: 'symlink',
        link,
        target: semanticPathDigestFact(target, seen),
      };
    }
    if (entry.isFile()) {
      const bytes = readFileSync(resolved);
      return {
        kind: 'file',
        mode: entry.mode & 0o777,
        bytes: bytes.length,
        digest: digestText(bytes),
      };
    }
    if (entry.isDirectory()) {
      const hash = createHash('sha256');
      const names = readdirSync(resolved).sort();
      hash.update('directory\0');
      for (const name of names) {
        const fact = semanticPathDigestFact(join(resolved, name), seen);
        hash.update(`${name}\0${digestJson(fact)}\0`);
      }
      return {
        kind: 'directory',
        entries: names.length,
        digest: `sha256:${hash.digest('hex')}`,
      };
    }
    return {
      kind: 'other',
      mode: entry.mode,
      bytes: entry.size,
      digest: digestJson({ mode: entry.mode, bytes: entry.size }),
    };
  } finally {
    seen.delete(resolved);
  }
}

function validateBatteryResult(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`battery result ${index} must be an object`);
  }
  const requiredKeys = [
    'schemaVersion', 'proofId', 'gateId', 'state', 'startedAtMs', 'endedAtMs',
    'durationMs', 'exitCode', 'prerequisites', 'blockedBy', 'command',
    'failureSignature',
  ];
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...requiredKeys].sort())) {
    fail(`battery result ${index} does not match ${BATTERY_RESULT_SCHEMA}`);
  }
  if (value.schemaVersion !== BATTERY_RESULT_SCHEMA || value.proofId !== 'local-proof') {
    fail(`battery result ${index} has the wrong schema or proof id`);
  }
  if (typeof value.gateId !== 'string' || !/^[a-z0-9-]+$/u.test(value.gateId)) {
    fail(`battery result ${index} has an invalid gate id`);
  }
  if (!['PASS', 'FAIL', 'BLOCKED', 'NOT_SELECTED'].includes(value.state)) {
    fail(`battery result ${index} has an invalid state`);
  }
  for (const key of ['startedAtMs', 'endedAtMs', 'durationMs']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      fail(`battery result ${index} has invalid ${key}`);
    }
  }
  if (!Array.isArray(value.prerequisites)
    || !value.prerequisites.every((entry) => typeof entry === 'string')
    || !Array.isArray(value.blockedBy)
    || !value.blockedBy.every((entry) => typeof entry === 'string')
    || typeof value.command !== 'string') {
    fail(`battery result ${index} has invalid dependency or command fields`);
  }
  if (value.state === 'FAIL') {
    if (!Number.isSafeInteger(value.exitCode) || value.exitCode <= 0
      || typeof value.failureSignature !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(value.failureSignature)) {
      fail(`battery root failure ${value.gateId} lacks a normalized signature`);
    }
  } else if (value.exitCode !== (value.state === 'PASS' ? 0 : null)
    || value.failureSignature !== null) {
    fail(`battery non-root result ${value.gateId} carries root-failure evidence`);
  }
  if (value.state === 'BLOCKED' && value.blockedBy.length === 0) {
    fail(`battery BLOCKED result ${value.gateId} does not name a prerequisite`);
  }
  return value;
}

export function parseBatteryResults(source) {
  if (typeof source !== 'string') fail('battery result source must be text');
  const records = source.split(/\r?\n/u).filter((line) => line.trim() !== '').map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      fail(`battery result ${index} is not JSON: ${error.message}`);
    }
    return validateBatteryResult(value, index);
  });
  if (records.length === 0) fail('battery result source is empty');
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.gateId)) fail(`battery result repeats gate ${record.gateId}`);
    seen.add(record.gateId);
  }
  return records;
}

function validateClaimScope(scope, label) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) fail(`${label} is invalid`);
  const roots = scope.roots;
  const files = scope.files;
  if (!Array.isArray(roots) || !Array.isArray(files) || roots.length + files.length === 0) {
    fail(`${label} must carry roots or files`);
  }
  for (const [key, values] of [['roots', roots], ['files', files]]) {
    const sorted = [...values].sort();
    if (!values.every((path) => typeof path === 'string'
      && path !== ''
      && !path.includes('\\')
      && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
      && isRepositoryRelative(path))
      || new Set(values).size !== values.length
      || JSON.stringify(values) !== JSON.stringify(sorted)) {
      fail(`${label}.${key} must be sorted unique repository paths`);
    }
  }
  return { roots: [...roots], files: [...files] };
}

function pathsInClaimScope(root, revision, scope) {
  const authorities = [...new Set([...scope.roots, ...scope.files])];
  const committedPaths = gitPaths(root, [
    'ls-tree', '-r', '--name-only', '-z', revision, '--', ...authorities,
  ]);
  return [...new Set([...scope.files, ...committedPaths])].sort();
}

function relevantGatesForClaim(root, revision, scope, context) {
  const direct = new Set();
  for (const path of pathsInClaimScope(root, revision, scope)) {
    const selection = selectChangedPaths([path], context);
    for (const classification of selection.classifications) {
      for (const group of classification.groups) {
        for (const gateId of context.policy.groups[group].gates) direct.add(gateId);
      }
    }
  }
  const relevant = new Set();
  for (const gateId of direct) {
    for (const selected of selectGate(gateId, context)) relevant.add(selected);
  }
  return relevant;
}

function jsonAtRevision(root, revision, path, label) {
  try {
    return JSON.parse(git(root, ['show', `${revision}:${path}`]));
  } catch (error) {
    fail(`could not read ${label} ${path}: ${error?.message ?? error}`);
  }
}

function publicationAnchorPaths(root, revision) {
  const known = gitPaths(root, [
    'ls-tree', '-r', '--name-only', '-z', revision,
  ]).filter((path) => /publication\.anchor(?:\.v\d+)?\.json$/u.test(path));
  const anchors = PUBLICATION_ROOT_CANDIDATES.flatMap((publicationRoot) => gitPaths(root, [
    'ls-tree', '-r', '--name-only', '-z', revision, '--', publicationRoot,
  ]).filter((path) => /publication\.anchor(?:\.v\d+)?\.json$/u.test(path)));
  const omitted = known.filter((path) => !anchors.includes(path));
  if (omitted.length > 0) {
    fail(`publication roots omitted known anchor(s): ${omitted.join(', ')}`);
  }
  return [...new Set(anchors)].sort();
}

function publicationRootForAnchor(anchorPath) {
  const publicationRoot = PUBLICATION_ROOT_CANDIDATES.find(
    (candidate) => anchorPath.startsWith(`${candidate}/`),
  );
  if (!publicationRoot) fail(`claim anchor ${anchorPath} is outside every publication root`);
  return publicationRoot;
}

function publicationCarrierForAnchor(root, revision, publicationRoot, anchorPath, anchor) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(anchor.carrierSha256 ?? '')) {
    fail(`published claim anchor ${anchorPath} lacks a carrier digest`);
  }
  const candidates = gitPaths(root, [
    'ls-tree', '-r', '--name-only', '-z', revision, '--', publicationRoot,
  ]).filter((path) => path.includes('publication')
    && path.endsWith('.json')
    && !path.includes('.anchor.'));
  const matches = candidates.flatMap((path) => {
    const bytes = git(root, ['show', `${revision}:${path}`]);
    return digestText(bytes) === anchor.carrierSha256 ? [{ path, bytes }] : [];
  });
  if (matches.length !== 1) {
    fail(`published claim anchor ${anchorPath} resolves ${matches.length} carriers`);
  }
  let value;
  try {
    value = JSON.parse(matches[0].bytes);
  } catch (error) {
    fail(`claim carrier ${matches[0].path} is not JSON: ${error.message}`);
  }
  const carrierIds = value.capabilityId ? [value.capabilityId] : value.capabilityIds;
  if (!Array.isArray(carrierIds) || !carrierIds.includes(anchor.capabilityId)) {
    fail(`claim carrier ${matches[0].path} does not contain ${anchor.capabilityId}`);
  }
  return { path: matches[0].path, value };
}

function publicationReceiptForCarrier(root, revision, capabilityId, carrier) {
  if (!carrier.implementationTreeSha256) return null;
  if (!/^sha256:[0-9a-f]{64}$/u.test(carrier.qualificationReceiptSha256 ?? '')) {
    fail(`claim carrier ${capabilityId} lacks a qualification receipt digest`);
  }
  const candidates = gitPaths(root, [
    'ls-tree', '-r', '--name-only', '-z', revision, '--', 'tests/acceptance',
  ]).filter((path) => path.endsWith('.json'));
  const matches = candidates.flatMap((path) => {
    const bytes = git(root, ['show', `${revision}:${path}`]);
    return digestText(bytes) === carrier.qualificationReceiptSha256 ? [{ path, bytes }] : [];
  });
  if (matches.length !== 1) {
    fail(`claim carrier ${capabilityId} resolves ${matches.length} qualification receipts`);
  }
  let value;
  try {
    value = JSON.parse(matches[0].bytes);
  } catch (error) {
    fail(`claim receipt ${matches[0].path} is not JSON: ${error.message}`);
  }
  if (value.capabilityId !== capabilityId) {
    fail(`claim receipt ${matches[0].path} has invalid identity`);
  }
  return { path: matches[0].path, value };
}

function legacyClaimScope(publicationRoot) {
  return {
    roots: [publicationRoot, ...LEGACY_CLAIM_SCOPE_SHARED_ROOTS].sort(),
    files: [...LEGACY_CLAIM_SCOPE_FILES],
  };
}

function legacyPublicationScope(
  root,
  revision,
  publicationRoot,
  anchorPath,
  carrierPath,
  carrier,
) {
  const files = new Set([anchorPath, carrierPath]);
  for (const [key, value] of Object.entries(carrier)) {
    if (!key.endsWith('SourceSha256') || !value || typeof value !== 'object'
      || Array.isArray(value)) continue;
    for (const path of Object.keys(value)) files.add(path);
  }
  const carrierPrefix = `${publicationRoot}/local-`;
  if (!carrierPath.startsWith(carrierPrefix)) {
    fail(`legacy publication carrier ${carrierPath} is outside ${publicationRoot}`);
  }
  const conformancePath = `tests/conformance/local-${carrierPath.slice(carrierPrefix.length)}`
    .replace(/\.publication\.v(\d+)\.json$/u, '-publication-v$1.mjs');
  const committed = new Set(gitPaths(root, [
    'ls-tree', '-r', '--name-only', '-z', revision, '--', conformancePath,
  ]));
  if (committed.has(conformancePath)) files.add(conformancePath);
  return validateClaimScope({ roots: [], files: [...files].sort() }, 'legacy publication D-4 scope');
}

export function standingBatteryClaims({
  root = ROOT,
  revision = resolveCommit(root, 'HEAD'),
  context = loadSelectionContext(),
} = {}) {
  const claims = [];
  for (const anchorPath of publicationAnchorPaths(root, revision)) {
    const publicationRoot = publicationRootForAnchor(anchorPath);
    const anchor = jsonAtRevision(root, revision, anchorPath, 'claim anchor');
    if (anchor?.schemaVersion !== 'snapback.local-capability-publication-anchor.v1'
      || typeof anchor.capabilityId !== 'string'
      || !['published', 'withheld'].includes(anchor.state)) {
      fail(`claim anchor ${anchorPath} has invalid identity or state`);
    }
    if (anchor.state !== 'published') continue;
    const carrier = publicationCarrierForAnchor(
      root,
      revision,
      publicationRoot,
      anchorPath,
      anchor,
    );
    const receipt = publicationReceiptForCarrier(
      root,
      revision,
      anchor.capabilityId,
      carrier.value,
    );
    const scope = validateClaimScope(
      receipt?.value.implementationScope
        ?? (carrier.value.implementationTreeSha256
          ? legacyClaimScope(publicationRoot)
          : legacyPublicationScope(
            root,
            revision,
            publicationRoot,
            anchorPath,
            carrier.path,
            carrier.value,
          )),
      `${anchor.capabilityId} D-4 scope`,
    );
    claims.push({
      id: anchor.capabilityId,
      recordPath: anchorPath,
      scope,
      relevantGates: relevantGatesForClaim(root, revision, scope, context),
    });
  }
  return claims;
}

function batteryTicketMarker(gateId) {
  return `**Battery gate:** \`${gateId}\``;
}

function batterySignatureMarker(signature) {
  return `**Failure signature:** \`${signature}\``;
}

function batteryTicketsForGate(ticketRoot, gateId) {
  if (!existsSync(ticketRoot)) return [];
  const marker = batteryTicketMarker(gateId);
  return readdirSync(ticketRoot).sort().flatMap((name) => {
    const path = join(ticketRoot, name);
    if (!name.endsWith('.md') || !lstatSync(path).isFile()) return [];
    return readFileSync(path, 'utf8').includes(marker) ? [path] : [];
  });
}

function findBatteryTicket(ticketRoot, gateId, signature) {
  const signatureMarker = batterySignatureMarker(signature);
  for (const directory of [ticketRoot, join(ticketRoot, 'closed')]) {
    for (const path of batteryTicketsForGate(directory, gateId)) {
      if (readFileSync(path, 'utf8').includes(signatureMarker)) return path;
    }
  }
  return null;
}

function ticketConsecutiveRuns(body) {
  const match = body.match(/^\*\*Consecutive red runs:\*\* `(\d+)`$/mu);
  return match ? Number(match[1]) : 0;
}

function replaceTicketLine(body, label, value) {
  const line = `**${label}:** ${value}`;
  const pattern = new RegExp(`^\\*\\*${label}:\\*\\* .*?$`, 'mu');
  if (pattern.test(body)) return body.replace(pattern, line);
  return body.replace(/^(\*\*Status:\*\* .*?)$/mu, `$1\n${line}`);
}

function removeTicketSection(body, heading) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start === -1) return body;
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
  let removalStart = start;
  while (removalStart > 0 && lines[removalStart - 1] === '') removalStart -= 1;
  lines.splice(removalStart, end - removalStart);
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

function updateBatteryTicketObservation(path, { runId, headRevision }) {
  let body = readFileSync(path, 'utf8');
  const lastProcessed = body.match(/^\*\*Last processed run:\*\* `([^`]+)`$/mu)?.[1] ?? null;
  if (lastProcessed === runId) return ticketConsecutiveRuns(body);
  const consecutive = ticketConsecutiveRuns(body) + 1;
  body = replaceTicketLine(body, 'Last observed run', `\`${runId}\``);
  body = replaceTicketLine(body, 'Last processed run', `\`${runId}\``);
  body = replaceTicketLine(body, 'Last observed revision', `\`${headRevision}\``);
  body = replaceTicketLine(body, 'Consecutive red runs', `\`${consecutive}\``);
  body = replaceTicketLine(
    body,
    'Escalation',
    consecutive >= BATTERY_ESCALATION_THRESHOLD
      ? '`AUTHOR_ESCALATION_REQUIRED`'
      : `\`pending (${consecutive}/${BATTERY_ESCALATION_THRESHOLD})\``,
  );
  if (consecutive >= BATTERY_ESCALATION_THRESHOLD
    && !body.includes('## Author escalation')) {
    body += `\n## Author escalation\n\nThis root-failure signature remained red for ${consecutive} consecutive scheduled\nbattery runs. Escalate to the author (Charlie Cheever) before the next run.\n`;
  }
  writeFileSync(path, body);
  return consecutive;
}

function resetBatteryTicketStreak(path, { runId }) {
  let body = readFileSync(path, 'utf8');
  const lastProcessed = body.match(/^\*\*Last processed run:\*\* `([^`]+)`$/mu)?.[1] ?? null;
  if (lastProcessed === runId) return;
  body = replaceTicketLine(body, 'Last processed run', `\`${runId}\``);
  body = replaceTicketLine(body, 'Consecutive red runs', '`0`');
  body = replaceTicketLine(body, 'Escalation', '`pending (0/4)`');
  body = removeTicketSection(body, 'Author escalation');
  writeFileSync(path, body);
}

function closeBatteryTicket(path, { runId, headRevision, reason, ticketRoot }) {
  let body = readFileSync(path, 'utf8');
  body = replaceTicketLine(body, 'Status', 'Closed');
  body = replaceTicketLine(body, 'Last processed run', `\`${runId}\``);
  body = replaceTicketLine(body, 'Closed at revision', `\`${headRevision}\``);
  body = replaceTicketLine(body, 'Closure', reason);
  writeFileSync(path, body);
  const closedRoot = join(ticketRoot, 'closed');
  mkdirSync(closedRoot, { recursive: true });
  const target = join(closedRoot, path.slice(path.lastIndexOf(sep) + 1));
  if (existsSync(target)) fail(`battery ticket close collision at ${relative(ROOT, target)}`);
  renameSync(path, target);
  return target;
}

function reopenBatteryTicket(path, { ticketRoot, runId }) {
  const target = join(ticketRoot, path.slice(path.lastIndexOf(sep) + 1));
  if (existsSync(target)) fail(`battery ticket reopen collision at ${relative(ROOT, target)}`);
  let body = readFileSync(path, 'utf8');
  body = replaceTicketLine(body, 'Status', 'Open');
  body = replaceTicketLine(body, 'Consecutive red runs', '`0`');
  body = replaceTicketLine(body, 'Escalation', '`pending (0/4)`');
  body = replaceTicketLine(body, 'Reopened by battery run', `\`${runId}\``);
  body = removeTicketSection(body, 'Author escalation');
  writeFileSync(path, body);
  renameSync(path, target);
  return target;
}

function fileBatteryTicket({
  root,
  ticketRoot,
  gateId,
  signature,
  command,
  exitCode,
  runId,
  headRevision,
  claims,
  date,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail(`invalid ticket date ${date}`);
  const signatureSlug = signature.replace(/^sha256:/u, '').slice(0, 16);
  const compactDate = date.replaceAll('-', '');
  const path = join(ticketRoot, `${compactDate}-battery-${gateId}-${signatureSlug}.md`);
  if (existsSync(path)) fail(`battery ticket signature collision at ${relative(root, path)}`);
  const claimLines = claims.length === 0
    ? '- None.'
    : claims.map(({ id, recordPath }) => `- \`${id}\` — \`${recordPath}\``).join('\n');
  const body = `# complete battery red: ${gateId}\n\n**Status:** Open\n**Impact:** 5\n**Urgency:** 5\n**Ease:** 4\n**Confidence:** 5\n**Systems:** Testing, CI\n**Date:** ${date}\n**Battery gate:** \`${gateId}\`\n**Failure signature:** \`${signature}\`\n**First observed run:** \`${runId}\`\n**Last observed run:** \`${runId}\`\n**Last processed run:** \`${runId}\`\n**Detected at revision:** \`${headRevision}\`\n**Last observed revision:** \`${headRevision}\`\n**Consecutive red runs:** \`1\`\n**Escalation:** \`pending (1/${BATTERY_ESCALATION_THRESHOLD})\`\n**Related:** LLP 0189 D-1, LLP 0175 D2.3\n\n## Summary\n\nThe scheduled complete canonical battery reported \`${gateId}\` as a root\nfailure (exit ${exitCode}). This ticket is keyed by gate plus the normalized\nroot-failure signature and remains idempotent while open. Dependent \`BLOCKED\`\nresults do not create tickets.\n\n## Standing claim cross-references\n\n${claimLines}\n\nThese are the standing published claims whose recorded LLP 0189 D-4 scope\nderives \`${gateId}\` as claim-relevant for this battery revision.\n\n## Reproduce and repair\n\n\`\`\`sh\n${command}\n\`\`\`\n\nFix forward, rerun the complete battery, and let the next determinate pass close\nthis signature. Four consecutive red observations require author escalation.\n`;
  writeFileSync(path, body);
  return path;
}

export function runBatteryCheck({
  head = 'HEAD',
  root = ROOT,
  context = loadSelectionContext(),
} = {}) {
  const revision = resolveCommit(root, head);
  const claims = standingBatteryClaims({ root, revision, context });
  console.log(
    `[snapback-battery-backstop] CHECK PASS ${context.inventory.canonicalGates.length} gate(s), `
      + `${claims.length} standing published claim(s) at ${revision}`,
  );
  return 0;
}

function validateCompleteBatteryInventory(records, expected) {
  const actual = new Set(records.map(({ gateId }) => gateId));
  const expectedSet = new Set(expected);
  const missing = expected.filter((gateId) => !actual.has(gateId));
  const unexpected = [...actual].filter((gateId) => !expectedSet.has(gateId)).sort();
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      'battery results do not cover the complete canonical gate inventory'
      + `${missing.length > 0 ? `; missing: ${missing.join(',')}` : ''}`
      + `${unexpected.length > 0 ? `; unexpected: ${unexpected.join(',')}` : ''}`,
    );
  }
}

function readCompleteBatteryResults({ root, resultsPath, context }) {
  const resolvedResults = resolve(root, resultsPath);
  if (resolvedResults === resolve(root) || !resolvedResults.startsWith(`${resolve(root)}${sep}`)) {
    fail(`battery results escape repository: ${resultsPath}`);
  }
  const records = parseBatteryResults(readFileSync(resolvedResults, 'utf8'));
  validateCompleteBatteryInventory(records, context.inventory.canonicalGates);
  return records;
}

export function runBatteryReport({
  resultsPath,
  root = ROOT,
  context = loadSelectionContext(),
} = {}) {
  const records = readCompleteBatteryResults({ root, resultsPath, context });
  const counts = Object.fromEntries(
    ['PASS', 'FAIL', 'BLOCKED', 'NOT_SELECTED'].map((state) => [
      state,
      records.filter((record) => record.state === state).length,
    ]),
  );
  const red = counts.FAIL > 0 || counts.BLOCKED > 0;
  console[red ? 'error' : 'log'](
    `[snapback-battery-report] ${red ? 'RED' : 'GREEN'} `
      + `${counts.PASS} passed, ${counts.FAIL} root failure(s), `
      + `${counts.BLOCKED} blocked, ${counts.NOT_SELECTED} host-conditioned not selected`,
  );
  return red ? 1 : 0;
}

export function runBatteryBackstop({
  head = 'HEAD',
  resultsPath,
  runId,
  issuesDir = 'issues',
  root = ROOT,
  context = loadSelectionContext(),
  env = process.env,
  claims = null,
}) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9._:-]+$/u.test(runId)) {
    fail(`invalid battery run id ${runId}`);
  }
  const revision = resolveCommit(root, head);
  const records = readCompleteBatteryResults({ root, resultsPath, context });

  const ticketRoot = safeIssuesRoot(root, issuesDir);
  mkdirSync(ticketRoot, { recursive: true });
  const standingClaims = claims ?? standingBatteryClaims({ root, revision, context });
  let batteryRed = false;
  for (const record of records) {
    const openForGate = () => batteryTicketsForGate(ticketRoot, record.gateId);
    if (record.state === 'PASS') {
      for (const path of openForGate()) {
        const closed = closeBatteryTicket(path, {
          runId,
          headRevision: revision,
          reason: '`determinate PASS`',
          ticketRoot,
        });
        console.log(`[snapback-battery-backstop] CLOSED ${relative(root, closed)}`);
      }
      continue;
    }
    if (record.state === 'BLOCKED') {
      batteryRed = true;
      for (const path of openForGate()) resetBatteryTicketStreak(path, { runId });
      console.log(
        `[snapback-battery-backstop] BLOCKED ${record.gateId} by ${record.blockedBy.join(',')}; no ticket filed`,
      );
      continue;
    }
    if (record.state === 'NOT_SELECTED') {
      for (const path of openForGate()) resetBatteryTicketStreak(path, { runId });
      console.log(
        `[snapback-battery-backstop] NOT_SELECTED ${record.gateId}; `
          + 'host-conditioned absence breaks the red streak and files no ticket',
      );
      continue;
    }

    batteryRed = true;
    for (const path of openForGate()) {
      if (!readFileSync(path, 'utf8').includes(batterySignatureMarker(record.failureSignature))) {
        const closed = closeBatteryTicket(path, {
          runId,
          headRevision: revision,
          reason: '`signature absent from determinate FAIL`',
          ticketRoot,
        });
        console.log(`[snapback-battery-backstop] CLOSED ${relative(root, closed)}`);
      }
    }
    let ticket = findBatteryTicket(ticketRoot, record.gateId, record.failureSignature);
    if (ticket && dirname(ticket) === join(ticketRoot, 'closed')) {
      ticket = reopenBatteryTicket(ticket, { ticketRoot, runId });
      console.error(`[snapback-battery-backstop] REOPENED ${relative(root, ticket)}`);
    }
    if (ticket) {
      const consecutive = updateBatteryTicketObservation(ticket, {
        runId,
        headRevision: revision,
      });
      console.error(
        `[snapback-battery-backstop] RETAINED ${relative(root, ticket)}; `
          + `consecutive=${consecutive}`,
      );
      continue;
    }
    const claimRefs = standingClaims.filter(({ relevantGates }) => relevantGates.has(record.gateId));
    ticket = fileBatteryTicket({
      root,
      ticketRoot,
      gateId: record.gateId,
      signature: record.failureSignature,
      command: record.command,
      exitCode: record.exitCode,
      runId,
      headRevision: revision,
      claims: claimRefs,
      date: env[BATTERY_TICKET_DATE_ENV] ?? DEFAULT_TICKET_DATE(),
    });
    console.error(`[snapback-battery-backstop] FILED ${relative(root, ticket)}`);
  }
  return batteryRed ? 1 : 0;
}

export function runBackstop({
  head,
  gate = null,
  issuesDir = 'issues',
  root = ROOT,
  context = loadSelectionContext(),
  env = process.env,
}) {
  const revision = resolveCommit(root, head);
  const registered = Object.keys(context.policy.driftProneGates);
  const gates = gate === null ? registered : gate.split(',').filter(Boolean);
  for (const gateId of gates) {
    if (!registered.includes(gateId)) fail(`unknown drift-prone gate ${gateId}`);
  }
  const ticketRoot = safeIssuesRoot(root, issuesDir);
  mkdirSync(ticketRoot, { recursive: true });
  const infrastructureStreaks = readInfrastructureStreaks(root);
  let failures = 0;
  let infrastructureFailures = 0;
  for (const gateId of gates) {
    const command = commandForGate(context, gateId);
    const metadata = context.policy.driftProneGates[gateId];
    const observation = runBackstopGateAtRevision(
      root,
      revision,
      gateId,
      command,
      metadata,
      env,
    );
    const { execution } = observation;
    if (execution.ok) {
      delete infrastructureStreaks[gateId];
      console.log(`[snapback-drift-backstop] PASS ${gateId}`);
      continue;
    }
    if (observation.nondeterministic) {
      delete infrastructureStreaks[gateId];
      failures += 1;
      const normalizedSignature = observation.nondeterministic.normalizedSignature;
      console.error(`[snapback-drift-backstop] NONDETERMINISTIC ${gateId} at ${revision}`);
      console.error(`[snapback-drift-backstop] signature ${normalizedSignature}`);
      writeCapturedOutput(execution, { stripJavaScriptStack: true });
      writeCapturedOutput(observation.repeated, { stripJavaScriptStack: true });
      const existing = findOpenTicket(ticketRoot, gateId, normalizedSignature);
      if (existing) {
        updateDriftTicketObservation(existing, { normalizedSignature, headRevision: revision });
        console.error(
          `[snapback-drift-backstop] existing open ticket ${relative(root, existing)}; `
            + 'not filing a duplicate; updated its last observation',
        );
        continue;
      }
      const ticket = fileDriftTicket({
        root,
        ticketRoot,
        gate: gateId,
        metadata,
        command,
        headRevision: revision,
        culprit: { revision, method: 'none-nondeterministic' },
        changedPaths: execution.changedPaths,
        normalizedSignature,
        outcome: 'NONDETERMINISTIC',
        date: env.SNAPBACK_DRIFT_TICKET_DATE ?? DEFAULT_TICKET_DATE(),
      });
      console.error(`[snapback-drift-backstop] FILED ${relative(root, ticket)}`);
      continue;
    }
    const evidence = observation.evidence ?? failureEvidence(execution);
    if (evidence.kind === 'runner-setup' || evidence.kind === 'unknown') {
      infrastructureFailures += 1;
      const streak = (infrastructureStreaks[gateId] ?? 0) + 1;
      infrastructureStreaks[gateId] = streak;
      writeCapturedOutput(execution);
      const reason = evidence.reason ?? 'unclassified backstop execution';
      console.error(
        `[snapback-drift-backstop] ${evidence.kind === 'unknown' ? 'UNKNOWN' : 'INFRASTRUCTURE ERROR'} `
          + `${gateId} at ${revision}: ${reason}`,
      );
      console.error('[snapback-drift-backstop] no stale-record ticket was filed');
      console.error(
        `[snapback-drift-backstop] infrastructure classification ${streak}`
          + ` of ${INFRASTRUCTURE_TICKET_THRESHOLD} before self-health ticketing`,
      );
      if (streak >= INFRASTRUCTURE_TICKET_THRESHOLD) {
        const existing = findOpenInfrastructureTicket(ticketRoot, gateId);
        if (existing) {
          console.error(
            `[snapback-drift-backstop] existing self-health ticket ${relative(root, existing)}; `
              + 'not filing a duplicate',
          );
        } else {
          const ticket = fileInfrastructureTicket({
            ticketRoot,
            gate: gateId,
            command,
            headRevision: revision,
            reason,
            date: env.SNAPBACK_DRIFT_TICKET_DATE ?? DEFAULT_TICKET_DATE(),
          });
          console.error(`[snapback-drift-backstop] FILED ${relative(root, ticket)}`);
        }
      }
      continue;
    }
    delete infrastructureStreaks[gateId];
    failures += 1;
    // @ref LLP 0189#decision — the authoritative scheduled verdict keeps one
    // open ticket per normalized root-failure signature, not merely per gate.
    const normalizedSignature = backstopFailureSignature(execution, evidence);
    console.error(`[snapback-drift-backstop] STALE ${gateId} at ${revision}`);
    console.error(`[snapback-drift-backstop] signature ${normalizedSignature}`);
    writeCapturedOutput(execution);
    const existing = findOpenTicket(ticketRoot, gateId, normalizedSignature);
    if (existing) {
      updateDriftTicketObservation(existing, { normalizedSignature, headRevision: revision });
      console.error(
        `[snapback-drift-backstop] existing open ticket ${relative(root, existing)}; `
          + 'not filing a duplicate; updated its last observation',
      );
      continue;
    }
    const culprit = findCausalLanding({
      root,
      headRevision: revision,
      gate: gateId,
      command,
      metadata,
      normalizedSignature,
      env,
    });
    const ticket = fileDriftTicket({
      root,
      ticketRoot,
      gate: gateId,
      metadata,
      command,
      headRevision: revision,
      culprit,
      changedPaths: execution.changedPaths,
      normalizedSignature,
      outcome: 'STALE',
      date: env.SNAPBACK_DRIFT_TICKET_DATE ?? DEFAULT_TICKET_DATE(),
    });
    console.error(`[snapback-drift-backstop] FILED ${relative(root, ticket)}`);
  }
  writeInfrastructureStreaks(root, infrastructureStreaks);
  if (infrastructureFailures > 0) return 2;
  return failures === 0 ? 0 : 1;
}

function runBackstopGateAtRevision(root, revision, gate, command, metadata, env) {
  return withRevisionWorktree(
    root,
    revision,
    { preferRoot: false, requiredSubmodules: metadata.requiredSubmodules ?? [] },
    (cwd, revisionEnv) => {
      const gateEnvironment = { ...revisionEnv, ...env };
      provisionEnvironmentPaths(root, cwd, metadata.requiredEnvironmentPaths ?? []);
      const closureBeforeExecution = observedExecutionClosureDigest({
        cwd,
        gate,
        revision,
        command,
        metadata,
        env: gateEnvironment,
      });
      const execute = () => executeGate(cwd, gate, command, {
        env: gateEnvironment,
        prepareCommand: metadata.prepareCommand,
        environmentRoot: root,
        requiredEnvironmentPaths: metadata.requiredEnvironmentPaths,
        requiredModules: metadata.requiredModules,
        infrastructureClassification: 'd3',
      });
      const execution = execute();
      execution.changedPaths = safeWorktreeChanges(cwd).paths;
      if (execution.ok) return { execution, evidence: passEvidence(execution) };

      const evidence = failureEvidence(execution);
      const closureAfterFailure = safeWorktreeChanges(cwd);
      if (evidence.kind !== 'content'
        || closureAfterFailure.error !== null
        || closureAfterFailure.paths.length !== 0) {
        return { execution, evidence };
      }
      const closureBeforeRepeat = observedExecutionClosureDigest({
        cwd,
        gate,
        revision,
        command,
        metadata,
        env: gateEnvironment,
      });
      if (closureBeforeRepeat !== closureBeforeExecution) {
        return {
          execution,
          evidence: unknownEvidence(
            execution,
            'observed execution closure changed after the first determinate red',
          ),
        };
      }

      console.error(
        `[snapback-drift-backstop] DETERMINISM CHECK ${gate} at ${revision.slice(0, 12)}`,
      );
      const repeated = execute();
      repeated.changedPaths = safeWorktreeChanges(cwd).paths;
      const repeatedEvidence = repeated.ok ? passEvidence(repeated) : failureEvidence(repeated);
      const closureAfterRepeat = safeWorktreeChanges(cwd);
      const closureAfterRepeatDigest = observedExecutionClosureDigest({
        cwd,
        gate,
        revision,
        command,
        metadata,
        env: gateEnvironment,
      });
      const repeatedDeterminate = repeated.ok || repeatedEvidence.kind === 'content';
      const contradictory = repeatedDeterminate
        && repeatedEvidence.normalizedSignature !== evidence.normalizedSignature
        && closureAfterRepeat.error === null
        && closureAfterRepeat.paths.length === 0
        && closureAfterRepeatDigest === closureBeforeExecution;
      if (contradictory) {
        return {
          execution,
          evidence,
          repeated,
          nondeterministic: contradictionEvidence({
            closureDigest: closureBeforeExecution,
            first: evidence,
            second: repeatedEvidence,
          }),
        };
      }
      if (closureAfterRepeatDigest !== closureBeforeExecution) {
        return {
          execution: repeated,
          evidence: unknownEvidence(
            repeated,
            'observed execution closure changed during the contradiction check',
          ),
        };
      }
      if (!repeatedDeterminate
        || closureAfterRepeat.error !== null
        || closureAfterRepeat.paths.length !== 0) {
        return {
          execution: repeated,
          evidence: unknownEvidence(
            repeated,
            'the contradiction check did not preserve a clean determinate closure',
          ),
        };
      }
      return { execution, evidence, repeated };
    },
  );
}

function unknownEvidence(execution, reason) {
  return {
    ...failureEvidence(execution),
    kind: 'unknown',
    reason,
    normalizedSignature: null,
  };
}

function runGateAtRevision(
  root,
  revision,
  gate,
  command,
  metadata,
  env,
  { infrastructureClassification = 'legacy' } = {},
) {
  return withRevisionWorktree(
    root,
    revision,
    { preferRoot: false, requiredSubmodules: metadata.requiredSubmodules ?? [] },
    (cwd, revisionEnv) => {
      const result = executeGate(cwd, gate, command, {
        env: { ...revisionEnv, ...env },
        prepareCommand: metadata.prepareCommand,
        environmentRoot: root,
        requiredEnvironmentPaths: metadata.requiredEnvironmentPaths,
        requiredModules: metadata.requiredModules,
        infrastructureClassification,
      });
      return { ...result, changedPaths: safeWorktreeChanges(cwd).paths };
    },
  );
}

export function runRegisteredGateAtRevision({
  gate,
  revision = 'HEAD',
  isolated = true,
  root = ROOT,
  context = loadSelectionContext(),
  env = process.env,
}) {
  const resolved = resolveCommit(root, revision);
  const metadata = context.policy.driftProneGates[gate];
  if (!metadata) fail(`unknown drift-prone gate ${gate}`);
  const command = commandForGate(context, gate);
  if (isolated) return runGateAtRevision(root, resolved, gate, command, metadata, env);
  if (resolveCommit(root, 'HEAD') !== resolved) {
    fail(`real-worktree gate ${gate} requires revision ${resolved} at HEAD`);
  }
  const result = executeGate(root, gate, command, {
    env,
    environmentRoot: root,
    prepareCommand: metadata.prepareCommand,
    requiredEnvironmentPaths: metadata.requiredEnvironmentPaths,
    requiredModules: metadata.requiredModules,
    infrastructureClassification: 'legacy',
  });
  return { ...result, changedPaths: safeWorktreeChanges(root).paths };
}

function findCausalLanding({
  root,
  headRevision,
  gate,
  command,
  metadata,
  normalizedSignature,
  env,
}) {
  let recordCommit;
  try {
    recordCommit = git(root, [
      'log', '-1', '--format=%H', headRevision, '--', ...metadata.recordPaths,
    ]).trim();
  } catch {
    return { revision: null, method: 'record-epoch-unavailable' };
  }
  if (!SHA.test(recordCommit)) {
    return { revision: null, method: 'record-epoch-unavailable' };
  }
  if (recordCommit === headRevision) {
    return { revision: headRevision, method: 'head-record-change' };
  }
  const firstParentChain = new Set(git(root, [
    'rev-list', '--first-parent', headRevision,
  ]).trim().split('\n').filter(Boolean));
  if (!firstParentChain.has(recordCommit)) {
    return { revision: null, method: 'record-epoch-off-first-parent' };
  }
  const baseline = runBackstopGateAtRevision(
    root,
    recordCommit,
    gate,
    command,
    metadata,
    env,
  );
  if (!baseline.execution.ok || baseline.nondeterministic) {
    return { revision: null, method: 'record-epoch-not-green' };
  }
  const newestFirst = git(root, [
    'rev-list', '--first-parent', `${recordCommit}..${headRevision}`,
  ]).trim().split('\n').filter(Boolean);
  let culprit = headRevision;
  for (const revision of newestFirst.slice(1)) {
    const observation = runBackstopGateAtRevision(
      root,
      revision,
      gate,
      command,
      metadata,
      env,
    );
    const result = observation.execution;
    if (result.ok
      || observation.nondeterministic
      || backstopFailureSignature(result, observation.evidence) !== normalizedSignature) break;
    culprit = revision;
  }
  return { revision: culprit, method: 'first-parent-signature-epoch' };
}

function fileDriftTicket({
  root,
  ticketRoot,
  gate,
  metadata,
  command,
  headRevision,
  culprit,
  changedPaths,
  normalizedSignature,
  outcome = 'STALE',
  date,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail(`invalid ticket date ${date}`);
  const compactDate = date.replaceAll('-', '');
  const attributed = typeof culprit.revision === 'string' && SHA.test(culprit.revision);
  const subject = attributed
    ? git(root, ['show', '-s', '--format=%s', culprit.revision]).trim()
    : null;
  const records = metadata.records.map((record) => `- \`${record}\``).join('\n');
  const regenerated = changedPaths.length === 0
    ? '- The checker did not materialize a working-tree diff; see its command output.'
    : changedPaths.map((path) => `- \`${path}\``).join('\n');
  const signatureSlug = normalizedSignature.replace(/^sha256:/u, '').slice(0, 16);
  const path = join(ticketRoot, `${compactDate}-main-drift-${gate}-${signatureSlug}.md`);
  if (existsSync(path)) fail(`drift ticket signature collision at ${relative(root, path)}`);
  const nondeterministic = outcome === 'NONDETERMINISTIC';
  const body = `# main drift: ${gate} ${nondeterministic
    ? 'is nondeterministic'
    : 'has a stale committed record'}

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** ${date}
**Drift gate:** \`${gate}\`
**Outcome:** \`${outcome}\`
**Failure signature:** \`${normalizedSignature}\`
**Causal landing:** ${nondeterministic
    ? '`none — contradictory same-closure executions`'
    : attributed
      ? `\`${culprit.revision}\` (${subject})`
      : `\`none — ${culprit.method}\``}
**Detected at:** \`${headRevision}\`
**Last observed:** \`${headRevision}\`
**Attribution:** \`${culprit.method}\`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran \`${gate}\` independently of path selection on
\`main\` and ${nondeterministic
    ? 'observed contradictory determinate executions over the same clean revision closure. No repair attribution is made for nondeterminism'
    : attributed
      ? `found the committed record stale. The conservative ${culprit.method} attribution names the landing above`
      : `found the committed record stale, but ${culprit.method} prevents a supported causal-landing claim`}. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## ${nondeterministic ? 'Affected frozen-record surface' : 'Stale record'}

${records}

Checker materialization, when available:

${regenerated}

## Reproduce and reconcile

Check:

\`\`\`sh
${command}
\`\`\`

${nondeterministic ? 'Inspect the contradiction, then regenerate/reconcile only after restoring deterministic execution:' : 'Regenerate/reconcile:'}

\`\`\`sh
${metadata.regenerateCommand}
\`\`\`
${metadata.blessedRegenerateCommand ? `
For an explicitly reviewed bundle rollover:

\`\`\`sh
${metadata.blessedRegenerateCommand}
\`\`\`
` : ''}
Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to \`issues/closed/\`.
`;
  writeFileSync(path, body);
  return path;
}

function findOpenTicket(ticketRoot, gate, normalizedSignature = null) {
  if (!existsSync(ticketRoot)) return null;
  const marker = `**Drift gate:** \`${gate}\``;
  const signatureMarker = normalizedSignature === null
    ? null
    : `**Failure signature:** \`${normalizedSignature}\``;
  let legacy = null;
  for (const name of readdirSync(ticketRoot).sort()) {
    const path = join(ticketRoot, name);
    if (!name.endsWith('.md') || !lstatSync(path).isFile()) continue;
    const body = readFileSync(path, 'utf8');
    if (!body.includes(marker)) continue;
    if (signatureMarker === null || body.includes(signatureMarker)) return path;
    if (!body.includes('**Failure signature:**') && legacy === null) legacy = path;
  }
  return legacy;
}

function updateDriftTicketObservation(path, { normalizedSignature, headRevision }) {
  let body = readFileSync(path, 'utf8');
  const signatureLine = `**Failure signature:** \`${normalizedSignature}\``;
  if (!body.includes('**Failure signature:**')) {
    body = body.replace(/(\*\*Drift gate:\*\* `[^`]+`\n)/u, `$1${signatureLine}\n`);
  }
  const observedLine = `**Last observed:** \`${headRevision}\``;
  if (/^\*\*Last observed:\*\* .*$/mu.test(body)) {
    body = body.replace(/^\*\*Last observed:\*\* .*$/mu, observedLine);
  } else if (/^\*\*Detected at:\*\* .*$/mu.test(body)) {
    body = body.replace(/(\*\*Detected at:\*\* `[^`]+`\n)/u, `$1${observedLine}\n`);
  } else {
    body = body.replace(/(\*\*Failure signature:\*\* `[^`]+`\n)/u, `$1${observedLine}\n`);
  }
  writeFileSync(path, body);
}

function readInfrastructureStreaks(root) {
  const path = join(root, 'target', 'drift-backstop-infrastructure-streaks.v1.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.schemaVersion !== 'snapback.drift-backstop-infrastructure-streaks.v1'
      || typeof parsed.streaks !== 'object' || parsed.streaks === null) return {};
    return Object.fromEntries(Object.entries(parsed.streaks).filter(([gate, count]) => (
      /^[a-z0-9-]+$/u.test(gate) && Number.isSafeInteger(count) && count > 0
    )));
  } catch {
    return {};
  }
}

function writeInfrastructureStreaks(root, streaks) {
  const path = join(root, 'target', 'drift-backstop-infrastructure-streaks.v1.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    schemaVersion: 'snapback.drift-backstop-infrastructure-streaks.v1',
    streaks,
  }, null, 2)}\n`);
}

function findOpenInfrastructureTicket(ticketRoot, gate) {
  if (!existsSync(ticketRoot)) return null;
  const marker = `**Infrastructure gate:** \`${gate}\``;
  for (const name of readdirSync(ticketRoot).sort()) {
    const path = join(ticketRoot, name);
    if (!name.endsWith('.md') || !lstatSync(path).isFile()) continue;
    if (readFileSync(path, 'utf8').includes(marker)) return path;
  }
  return null;
}

function fileInfrastructureTicket({
  ticketRoot,
  gate,
  command,
  headRevision,
  reason,
  date,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail(`invalid ticket date ${date}`);
  const compactDate = date.replaceAll('-', '');
  let path = join(ticketRoot, `${compactDate}-drift-backstop-infrastructure-${gate}.md`);
  if (existsSync(path)) path = join(
    ticketRoot,
    `${compactDate}-drift-backstop-infrastructure-${gate}-${headRevision.slice(0, 8)}.md`,
  );
  const body = `# drift backstop self-health: ${gate} is repeatedly unavailable

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** ${date}
**Infrastructure gate:** \`${gate}\`
**Detected at:** \`${headRevision}\`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop classified \`${gate}\` as infrastructure for at
least ${INFRASTRUCTURE_TICKET_THRESHOLD} consecutive runs. During that streak
the backstop could not determine whether the gate's committed record was
current, so its scheduled self-health needs repair.

Latest infrastructure reason: \`${reason}\`

## Reproduce and repair

Run the canonical check in the scheduled backstop environment:

\`\`\`sh
${command}
\`\`\`

Repair the environment or classifier, verify a backstop run can classify the
gate, record the resolution here, and move this ticket to \`issues/closed/\`.
`;
  writeFileSync(path, body);
  return path;
}

function commandForGate(context, gate) {
  const commands = [...new Set(
    context.calls.filter((call) => call.gateId === gate).map((call) => call.command),
  )];
  if (commands.length !== 1) fail(`${gate} must have exactly one canonical command`);
  return commands[0];
}

function executeGate(cwd, gate, command, {
  env,
  environmentRoot,
  prepareCommand,
  requiredEnvironmentPaths = [],
  requiredModules = [],
  infrastructureClassification = 'legacy',
}) {
  const executionEnvironment = sanitizedGitEnvironment(env);
  const infrastructureReasonFor = infrastructureClassification === 'd3'
    ? d3ExecutionInfrastructureReason
    : executionInfrastructureReason;
  const normalizationPaths = [...new Set(
    [cwd, environmentRoot].filter(Boolean).map((path) => resolve(path)),
  )];
  const environmentPathFailure = provisionEnvironmentPaths(
    environmentRoot,
    cwd,
    requiredEnvironmentPaths,
  );
  if (environmentPathFailure) {
    return {
      ok: false,
      phase: 'environment-preflight',
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      infrastructureReason: environmentPathFailure,
      failureKind: 'runner-setup',
      normalizationPaths,
    };
  }
  const missingModules = unresolvedModules(cwd, requiredModules);
  if (missingModules.length > 0) {
    return {
      ok: false,
      phase: 'environment-preflight',
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      infrastructureReason: `required Node module(s) unavailable: ${missingModules.join(', ')}`,
      failureKind: 'runner-setup',
      normalizationPaths,
    };
  }
  let prepared = { status: 0, signal: null, stdout: '', stderr: '', error: null };
  if (prepareCommand) {
    console.log(`[snapback-drift] PREPARE ${gate}: ${prepareCommand}`);
    prepared = spawnSync('/bin/sh', ['-c', prepareCommand], {
      cwd,
      env: { ...executionEnvironment, SNAPBACK_DRIFT_GATE: gate },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (prepared.status !== 0) {
      const infrastructureReason = infrastructureReasonFor(prepared, 'prepare command failed');
      return {
        ok: false,
        phase: 'prepare',
        status: prepared.status,
        signal: prepared.signal,
        stdout: prepared.stdout ?? '',
        stderr: prepared.stderr ?? '',
        infrastructureReason,
        failureKind: processFailureKind(prepared, infrastructureReason),
        normalizationPaths,
      };
    }
  }
  const result = spawnSync('/bin/sh', ['-c', command], {
    cwd,
    env: { ...executionEnvironment, SNAPBACK_DRIFT_GATE: gate },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const infrastructureReason = result.status === 0
    ? null
    : infrastructureReasonFor(result);
  return {
    ok: result.status === 0,
    phase: 'check',
    status: result.status,
    signal: result.signal,
    stdout: `${prepared.stdout ?? ''}${result.stdout ?? ''}`,
    stderr: `${prepared.stderr ?? ''}${result.stderr ?? ''}`,
    infrastructureReason,
    failureKind: result.status === 0
      ? null
      : processFailureKind(result, infrastructureReason),
    normalizationPaths,
  };
}

function provisionEnvironmentPaths(sourceRoot, cwd, paths) {
  for (const path of paths) {
    const source = join(sourceRoot, path);
    const target = join(cwd, path);
    if (pathExists(target)) continue;
    if (!pathExists(source)) return `required prepared path unavailable: ${path}`;
    mkdirSync(dirname(target), { recursive: true });
    const sourceKind = lstatSync(source).isDirectory() ? 'dir' : 'file';
    symlinkSync(source, target, sourceKind);
  }
  return null;
}

function withRevisionWorktree(
  root,
  revision,
  { preferRoot, requiredSubmodules = [] },
  callback,
) {
  if (preferRoot && resolveCommit(root, 'HEAD') === revision && worktreeChanges(root).length === 0) {
    return callback(root, {});
  }
  // Keep the detached checkout beside the invoking worktree so repository
  // sibling dependencies (for example ../ibex and ../exact) resolve exactly
  // as they do for the real checkout.
  const checkout = mkdtempSync(join(dirname(root), '.snapback-drift-worktree-'));
  rmdirSync(checkout);
  let added = false;
  try {
    let dependencyTrees;
    try {
      git(root, [
        '-c', 'core.hooksPath=/dev/null',
        'worktree', 'add', '--detach', '--quiet', checkout, revision,
      ]);
      added = true;
      dependencyTrees = linkDependencyTrees(root, checkout);
      initializeAvailableSubmodules(root, checkout, requiredSubmodules);
      validateRevisionEnvironment(checkout, revision, dependencyTrees);
    } catch (error) {
      infrastructureFail(
        `isolated checkout for ${revision.slice(0, 12)} is not faithful: ${error?.message ?? error}`,
      );
    }
    return callback(checkout, revisionEnvironment(root));
  } finally {
    if (added) {
      try {
        git(root, ['worktree', 'remove', '--force', checkout]);
      } catch {}
    }
    rmSync(checkout, { recursive: true, force: true });
  }
}

function linkDependencyTrees(root, checkout) {
  // @ref LLP 0175#dependency-mirror-cache — the cache contains only the
  // portable link scaffold; workspace links stay relative to the revision.
  const key = dependencyMirrorKey(checkout);
  const mirror = cachedDependencyMirror(root, key);
  const linked = [];
  const copyStrategies = new Set();
  for (const tree of mirror.trees) {
    const { path, entries } = tree;
    const source = join(mirror.payload, path);
    const target = join(checkout, path);
    if (!existsSync(dirname(target))) continue;
    copyStrategies.add(copyDependencyTree(source, target));
    linked.push({ path, entries });
  }
  console.log(
    `[snapback-drift] dependency mirror cache ${mirror.hit ? 'HIT' : 'MISS'} `
      + `${key.slice(0, 16)}; ${linked.length} tree(s); copy=${[...copyStrategies].join('+') || 'none'}`,
  );
  return linked;
}

function dependencyMirrorKey(checkout) {
  const authorityPaths = [...new Set(gitPaths(checkout, [
    'ls-files', '-z', '--', 'bun.lock', 'package.json', ':(glob)**/package.json',
  ]))].sort();
  const hash = createHash('sha256');
  hash.update(`${DEPENDENCY_MIRROR_SCHEMA}\0${process.platform}\0${process.arch}\0`);
  for (const path of authorityPaths) {
    const bytes = readFileSync(join(checkout, path));
    hash.update(`${path}\0${bytes.length}\0`);
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function cachedDependencyMirror(root, key) {
  const gitPath = git(root, ['rev-parse', '--git-path', 'snapback-drift-dependency-cache']).trim();
  const cacheRoot = resolve(root, gitPath);
  const final = join(cacheRoot, key);
  const existing = readDependencyMirror(final, { key, root });
  if (existing) return { ...existing, hit: true };
  if (pathExists(final)) {
    const winner = readDependencyMirror(final, { key, root });
    if (winner) return { ...winner, hit: true };
    infrastructureFail(`dependency mirror cache is invalid: ${final}`);
  }

  mkdirSync(cacheRoot, { recursive: true });
  const staged = mkdtempSync(join(cacheRoot, `.build-${key.slice(0, 16)}-`));
  try {
    const payload = join(staged, 'payload');
    mkdirSync(payload);
    const trees = buildDependencyMirror(root, payload);
    writeFileSync(join(staged, 'receipt.json'), `${JSON.stringify({
      schemaVersion: DEPENDENCY_MIRROR_SCHEMA,
      key,
      sourceRoot: resolve(root),
      trees,
    }, null, 2)}\n`);
    try {
      renameSync(staged, final);
    } catch (error) {
      const winner = readDependencyMirror(final, { key, root });
      if (winner) return { ...winner, hit: true };
      throw error;
    }
    const published = readDependencyMirror(final, { key, root });
    if (!published) infrastructureFail(`published dependency mirror cache is invalid: ${final}`);
    return { ...published, hit: false };
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

function readDependencyMirror(directory, { key, root }) {
  try {
    const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'));
    if (receipt.schemaVersion !== DEPENDENCY_MIRROR_SCHEMA
      || receipt.key !== key
      || receipt.sourceRoot !== resolve(root)
      || !Array.isArray(receipt.trees)) return null;
    const trees = receipt.trees.map((tree) => ({
      path: tree.path,
      entries: [...tree.entries],
    }));
    for (const tree of trees) {
      if (!isRepositoryRelative(tree.path)
        || tree.path === ''
        || !Array.isArray(tree.entries)
        || !tree.entries.every((entry) => typeof entry === 'string')) return null;
      if (!pathExists(join(directory, 'payload', tree.path))) return null;
    }
    return { payload: join(directory, 'payload'), trees };
  } catch {
    return null;
  }
}

function buildDependencyMirror(root, payload) {
  const trees = [];
  for (const path of installedDependencyTrees(root)) {
    const source = join(root, path);
    const target = join(payload, path);
    mkdirSync(target, { recursive: true });
    const entries = readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      mirrorDependencyEntry({
        entry,
        sourceDirectory: source,
        targetDirectory: target,
        sourceRoot: root,
        targetRoot: payload,
      });
    }
    trees.push({ path, entries: entries.map(({ name }) => name).sort() });
  }
  return trees;
}

function copyDependencyTree(source, target) {
  const cloned = spawnSync('/bin/cp', ['-cR', '-P', source, target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!cloned.error && cloned.status === 0) return 'clonefile';
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    mode: fsConstants.COPYFILE_FICLONE,
    verbatimSymlinks: true,
  });
  return 'portable';
}

function mirrorDependencyEntry({
  entry,
  sourceDirectory,
  targetDirectory,
  sourceRoot,
  targetRoot,
}) {
  const sourceEntry = join(sourceDirectory, entry.name);
  const targetEntry = join(targetDirectory, entry.name);
  if (pathExists(targetEntry)) return;
  if (entry.isSymbolicLink()) {
    const sourceResolved = resolve(sourceDirectory, readlinkSync(sourceEntry));
    const sourceRelative = relative(sourceRoot, sourceResolved);
    const targetResolved = isRepositoryRelative(sourceRelative)
      ? join(targetRoot, sourceRelative)
      : sourceEntry;
    const linkTarget = isRepositoryRelative(sourceRelative)
      ? relative(targetDirectory, targetResolved)
      : targetResolved;
    let type = 'file';
    try {
      if (lstatSync(sourceResolved).isDirectory()) type = 'dir';
    } catch {}
    symlinkSync(linkTarget, targetEntry, type);
    return;
  }
  if (entry.isDirectory() && (entry.name.startsWith('@') || entry.name === '.bin')) {
    mkdirSync(targetEntry);
    for (const child of readdirSync(sourceEntry, { withFileTypes: true })) {
      mirrorDependencyEntry({
        entry: child,
        sourceDirectory: sourceEntry,
        targetDirectory: targetEntry,
        sourceRoot,
        targetRoot,
      });
    }
    return;
  }
  symlinkSync(sourceEntry, targetEntry, entry.isDirectory() ? 'dir' : 'file');
}

function isRepositoryRelative(path) {
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
}

function installedDependencyTrees(root) {
  const directories = new Set(['']);
  for (const path of gitPaths(root, ['ls-files', '-z'])) {
    let directory = dirname(path);
    while (directory !== '.') {
      directories.add(directory);
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const candidates = new Set(['node_modules', '.snapback-deps']);
  for (const directory of directories) {
    candidates.add(join(directory, 'node_modules'));
  }
  return [...candidates]
    .filter((path) => existsSync(join(root, path)))
    .sort();
}

function initializeAvailableSubmodules(root, checkout, paths) {
  for (const path of paths) {
    const sourceSubmodule = join(root, path);
    if (!isIndependentGitWorktree(sourceSubmodule)) {
      infrastructureFail(`required prepared submodule unavailable: ${path}`);
    }
    git(checkout, ['submodule', 'update', '--init', '--recursive', '--', path]);
  }
}

function isIndependentGitWorktree(path) {
  if (!existsSync(path)) return false;
  try {
    return resolve(git(path, ['rev-parse', '--show-toplevel']).trim()) === resolve(path);
  } catch {
    return false;
  }
}

function revisionEnvironment(root) {
  const environment = {};
  if (isIndependentGitWorktree(join(root, 'vendor/ibex'))) {
    environment.SNAPBACK_IBEX_CHECKOUT = join(root, 'vendor/ibex');
  }
  if (existsSync(join(root, 'target'))) {
    environment.CARGO_TARGET_DIR = join(root, 'target');
  }
  const preparedRuntimeBinary = join(root, 'target', 'debug', 'snapback');
  if (existsSync(preparedRuntimeBinary)
    && existsSync(`${preparedRuntimeBinary}.runtime-readiness.json`)) {
    // @ref LLP 0232#d-2-prepared-execution-and-rebase-stable-records — detached heavy gates may propose the invoking
    // worktree's prepared binary; bootstrap remains the proof consumer and
    // accepts it only after closure and readiness verification.
    // The runtime self-reports its invoking build commit and implementation digest, so never extend this advertisement to a future gate that validates served build identity against its pushed revision.
    environment.SNAPBACK_PREPARED_RUNTIME_ROOT = root;
    environment.SNAPBACK_PREPARED_RUNTIME_BINARY = preparedRuntimeBinary;
  }
  return environment;
}

function validateRevisionEnvironment(checkout, revision, dependencyTrees) {
  const actual = resolveCommit(checkout, 'HEAD');
  if (actual !== revision) fail(`isolated checkout resolved ${actual}, expected ${revision}`);
  for (const { path, entries } of dependencyTrees) {
    const missing = entries.filter((entry) => !pathExists(join(checkout, path, entry)));
    if (missing.length > 0) {
      fail(`isolated dependency tree ${path} is incomplete: ${missing.join(', ')}`);
    }
  }
  const changes = worktreeChanges(checkout);
  if (changes.length > 0) {
    fail(`isolated checkout is dirty before gate execution: ${changes.join(', ')}`);
  }
}

function unresolvedModules(cwd, modules) {
  if (!Array.isArray(modules) || modules.length === 0) return [];
  const require = createRequire(join(cwd, 'package.json'));
  return modules.filter((module) => {
    try {
      require.resolve(module);
      return false;
    } catch {
      return true;
    }
  });
}

function executionInfrastructureReason(execution, fallback = null) {
  if (execution.error) return execution.error.message;
  if (execution.signal) return `gate process terminated by ${execution.signal}`;
  if (execution.status === null || execution.status === undefined) {
    return fallback ?? 'gate process did not report an exit status';
  }
  if (execution.status === 126 || execution.status === 127) {
    return `gate process exited ${execution.status} (command unavailable)`;
  }
  const output = `${execution.stdout ?? ''}\n${execution.stderr ?? ''}`;
  const match = output.match(INFRASTRUCTURE_OUTPUT);
  return match ? `gate output reported ${match[0]}` : fallback;
}

function d3ExecutionInfrastructureReason(execution) {
  if (execution.error) return execution.error.message;
  if (execution.signal) return `gate process terminated by ${execution.signal}`;
  if (execution.status === null || execution.status === undefined) {
    return 'gate process did not report an exit status';
  }
  if (execution.status === 126 || execution.status === 127) {
    return `gate process exited ${execution.status} (command unavailable)`;
  }
  const output = `${execution.stdout ?? ''}\n${execution.stderr ?? ''}`;
  const match = output.match(INFRASTRUCTURE_OUTPUT);
  return match && RUNNER_CONTROLLED_OUTPUT.test(match[0])
    ? `gate output reported ${match[0]}`
    : null;
}

function processFailureKind(execution, infrastructureReason) {
  if (execution.error) return 'runner-setup';
  if (execution.signal || execution.status === null || execution.status === undefined) return 'unknown';
  if (infrastructureReason) return 'runner-setup';
  return Number.isInteger(execution.status) && execution.status !== 0
    ? 'content'
    : 'unknown';
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function worktreeChanges(cwd) {
  const output = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
  const records = output.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!isLinkedDependencyPath(record.slice(3))) paths.push(record.slice(3));
    if (record.startsWith('R') || record.startsWith('C')) {
      index += 1;
      if (records[index] && !isLinkedDependencyPath(records[index])) paths.push(records[index]);
    }
  }
  return [...new Set(paths)].sort();
}

function safeWorktreeChanges(cwd) {
  try {
    return { paths: worktreeChanges(cwd), error: null };
  } catch (error) {
    return {
      paths: [],
      error: `${error?.message ?? error}`.replace(/^SNAPBACK_DRIFT_GATE_INVALID:\s*/u, ''),
    };
  }
}

function isLinkedDependencyPath(path) {
  return path === 'node_modules' || path.endsWith('/node_modules');
}

function writeCapturedOutput(execution, { stripJavaScriptStack = false } = {}) {
  const clean = (output) => stripJavaScriptStack ? withoutJavaScriptStack(output) : output;
  const stdout = clean(execution.stdout);
  const stderr = clean(execution.stderr);
  if (stdout.trim()) process.stderr.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

function withoutJavaScriptStack(output) {
  return output.split(/(?<=\n)/u).filter((line) => (
    !/^\s+at (?:async )?/u.test(line)
      && !/^file:\/\/\/.*:\d+(?::\d+)?\s*$/u.test(line)
      && !/^\s*throw new Error\(/u.test(line)
      && !/^\s*\^+\s*$/u.test(line)
      && !/^Node\.js v\d/u.test(line)
  )).join('');
}

function safeIssuesRoot(root, issuesDir) {
  const path = resolve(root, issuesDir);
  const canonical = resolve(root, 'issues');
  if (path !== canonical && !path.startsWith(`${canonical}${sep}`)) {
    fail(`issues directory escapes repository: ${issuesDir}`);
  }
  return path;
}

function defaultMainRef(root = ROOT) {
  for (const ref of ['refs/remotes/origin/main', 'refs/heads/main']) {
    try {
      resolveCommit(root, ref);
      return ref;
    } catch {}
  }
  fail('main ref is unavailable; pass --head REV explicitly');
}

function resolveCommit(root, revision) {
  const resolved = git(root, ['rev-parse', '--verify', `${revision}^{commit}`]).trim();
  if (!SHA.test(resolved)) fail(`revision ${revision} did not resolve to a commit`);
  return resolved;
}

function gitPaths(root, args) {
  return git(root, args, { encoding: 'buffer' }).toString('utf8').split('\0').filter(Boolean);
}

function git(root, args, { encoding = 'utf8' } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      env: sanitizedGitEnvironment(process.env),
      encoding: encoding === 'buffer' ? null : encoding,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const detail = `${error.stderr ?? ''}`.trim();
    fail(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
}

function sanitizedGitEnvironment(environment) {
  const sanitized = { ...environment };
  for (const name of GIT_LOCAL_ENVIRONMENT) delete sanitized[name];
  return sanitized;
}

function option(args, name, { required = false } = {}) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) usage();
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) usage();
  return value;
}

function assertNoUnknownOptions(args, allowed) {
  if (args.length % 2 !== 0) usage();
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.includes(args[index]) || seen.has(args[index])) usage();
    seen.add(args[index]);
  }
}

function elapsed(started) {
  return `${Math.round(performance.now() - started)} ms`;
}

function fail(message) {
  throw new Error(`SNAPBACK_DRIFT_GATE_INVALID: ${message}`);
}

function infrastructureFail(message) {
  const error = new Error(message);
  error.code = 'SNAPBACK_DRIFT_GATE_INFRASTRUCTURE';
  throw error;
}

function usage() {
  throw new Error(
    'usage: drift-prone-gates.mjs pre-push --remote NAME | '
      + 'backstop [--head REV] [--gate ID[,ID...]] [--issues-dir PATH] | '
      + 'battery --results PATH --run-id ID [--head REV] [--issues-dir PATH] | '
      + 'battery-report --results PATH | '
      + 'battery-check [--head REV]',
  );
}
