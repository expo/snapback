#!/usr/bin/env node

// Couple measured commits to their frozen records at push time, and provide an
// independent main backstop that turns any missed predicate into an owned
// filesystem ticket.
//
// @ref LLP 0175#same-change-frozen-record-coupling — only registered
// frozen-record gates run pre-push; unknown paths fail closed to the registry.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants as fsConstants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadSelectionContext,
  selectDriftProneGates,
} from './select-local-proof.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ZERO_SHA = /^0{40}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const BYPASS_ENV = 'SNAPBACK_DRIFT_GATES_BYPASS';
const DEPENDENCY_MIRROR_SCHEMA = 'snapback.drift-dependency-mirror.v1';
const DEFAULT_TICKET_DATE = () => new Date().toISOString().slice(0, 10);
const INFRASTRUCTURE_OUTPUT = /(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find package|command not found|couldn't read .*No such file or directory|this operation must be run in a work tree|SNAPBACK_(?:CAPABILITY_IBEX|IBEX)_[A-Z0-9_]+)/u;
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

export function planPrePush(updates, remoteName, context = loadSelectionContext(), root = ROOT) {
  const byRevision = new Map();
  for (const update of updates) {
    if (ZERO_SHA.test(update.localSha)) continue;
    const entry = byRevision.get(update.localSha) ?? {
      revision: update.localSha,
      refs: [],
      changedPaths: new Set(),
    };
    entry.refs.push({ localRef: update.localRef, remoteRef: update.remoteRef });
    for (const path of changedPathsForUpdate(root, update, remoteName)) {
      entry.changedPaths.add(path);
    }
    byRevision.set(update.localSha, entry);
  }
  return [...byRevision.values()].map((entry) => {
    const changedPaths = [...entry.changedPaths].sort();
    const selection = selectDriftProneGates(changedPaths, context);
    return {
      revision: entry.revision,
      refs: entry.refs,
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
  if (bypass !== '' && bypass !== '1') {
    console.error(`[snapback-drift] REFUSED: ${BYPASS_ENV} must be exactly 1 when used`);
    return 2;
  }
  const updates = parsePrePushUpdates(input);
  const plans = planPrePush(updates, remoteName, context, root);
  const changedPathCount = new Set(plans.flatMap((plan) => plan.changedPaths)).size;
  const selected = [...new Set(plans.flatMap((plan) => plan.gates))];

  if (bypass === '1') announceBypass(plans, changedPathCount);
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
  if (bypass === '1') {
    console.error(
      `[snapback-drift] BYPASS ALLOWED: skipped ${selected.length} selected gate(s): `
        + `${selected.join(', ')}`,
    );
    return 0;
  }

  for (const plan of plans) {
    if (plan.gates.length === 0) continue;
    const short = plan.revision.slice(0, 12);
    console.log(
      `[snapback-drift] ${short}: ${plan.changedPaths.length} committed path(s) selected `
        + `${plan.gates.length} gate(s): ${plan.gates.join(', ')}`,
    );
    if (plan.selection.unknownFiles.length > 0 || plan.selection.broadFiles.length > 0) {
      const reasons = [
        ...plan.selection.unknownFiles.map((path) => `unknown:${path}`),
        ...plan.selection.broadFiles.map((path) => `broad:${path}`),
      ];
      console.error(
        `[snapback-drift] FAIL-CLOSED selection: ${reasons.join(', ')}; `
          + 'running every registered drift-prone gate',
      );
    }
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
          const execution = executeGate(cwd, gate, command, {
            env: { ...revisionEnv, ...env },
            prepareCommand: metadata.prepareCommand,
            environmentRoot: root,
            requiredEnvironmentPaths: metadata.requiredEnvironmentPaths,
            requiredModules: metadata.requiredModules,
          });
          if (!execution.ok) {
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
            printRefusal({ gate, revision: plan.revision, metadata, cwd, command });
            return 1;
          }
          writeCapturedOutput(execution);
          console.log(`[snapback-drift] PASS ${gate} (${elapsed(gateStarted)})`);
        }
        return 0;
      },
    );
    if (result !== 0) return result;
  }
  console.log(
    `[snapback-drift] ALLOWED: ${selected.length} selected drift-prone gate(s) passed `
      + `(${elapsed(started)})`,
  );
  return 0;
}

function announceBypass(plans, changedPathCount) {
  const gates = [...new Set(plans.flatMap((plan) => plan.gates))];
  console.error('[snapback-drift] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.error(`[snapback-drift] BYPASS ACTIVE: ${BYPASS_ENV}=1`);
  console.error(
    `[snapback-drift] ${changedPathCount} committed path(s), ${gates.length} selected gate(s); `
      + 'this push may leave frozen records stale and the main backstop remains armed',
  );
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
  let failures = 0;
  let infrastructureFailures = 0;
  for (const gateId of gates) {
    const command = commandForGate(context, gateId);
    const metadata = context.policy.driftProneGates[gateId];
    const execution = runGateAtRevision(root, revision, gateId, command, metadata, env);
    if (execution.ok) {
      console.log(`[snapback-drift-backstop] PASS ${gateId}`);
      continue;
    }
    if (execution.infrastructureReason) {
      infrastructureFailures += 1;
      writeCapturedOutput(execution);
      console.error(
        `[snapback-drift-backstop] INFRASTRUCTURE ERROR ${gateId} at ${revision}: `
          + execution.infrastructureReason,
      );
      console.error('[snapback-drift-backstop] no stale-record ticket was filed');
      continue;
    }
    failures += 1;
    console.error(`[snapback-drift-backstop] STALE ${gateId} at ${revision}`);
    writeCapturedOutput(execution);
    const existing = findOpenTicket(ticketRoot, gateId);
    if (existing) {
      console.error(
        `[snapback-drift-backstop] existing open ticket ${relative(root, existing)}; `
          + 'not filing a duplicate',
      );
      continue;
    }
    const culprit = findCausalLanding({
      root,
      headRevision: revision,
      gate: gateId,
      command,
      metadata,
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
      date: env.SNAPBACK_DRIFT_TICKET_DATE ?? DEFAULT_TICKET_DATE(),
    });
    console.error(`[snapback-drift-backstop] FILED ${relative(root, ticket)}`);
  }
  if (infrastructureFailures > 0) return 2;
  return failures === 0 ? 0 : 1;
}

function runGateAtRevision(root, revision, gate, command, metadata, env) {
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
  });
  return { ...result, changedPaths: safeWorktreeChanges(root).paths };
}

function findCausalLanding({ root, headRevision, gate, command, metadata, env }) {
  let recordCommit;
  try {
    recordCommit = git(root, [
      'log', '-1', '--format=%H', headRevision, '--', ...metadata.recordPaths,
    ]).trim();
  } catch {
    return { revision: headRevision, method: 'head-fallback' };
  }
  if (!SHA.test(recordCommit) || recordCommit === headRevision) {
    return { revision: headRevision, method: 'head-fallback' };
  }
  const baseline = runGateAtRevision(root, recordCommit, gate, command, metadata, env);
  if (!baseline.ok) return { revision: headRevision, method: 'record-epoch-not-green' };
  const tail = git(root, [
    'rev-list', '--first-parent', '--reverse', `${recordCommit}..${headRevision}`,
  ]).trim().split('\n').filter(Boolean);
  const commits = [recordCommit, ...tail];
  let low = 0;
  let high = commits.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const result = runGateAtRevision(root, commits[mid], gate, command, metadata, env);
    if (result.ok) low = mid;
    else high = mid;
  }
  return { revision: commits[high], method: 'first-parent-record-epoch-bisection' };
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
  date,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail(`invalid ticket date ${date}`);
  const compactDate = date.replaceAll('-', '');
  const subject = git(root, ['show', '-s', '--format=%s', culprit.revision]).trim();
  const records = metadata.records.map((record) => `- \`${record}\``).join('\n');
  const regenerated = changedPaths.length === 0
    ? '- The checker did not materialize a working-tree diff; see its command output.'
    : changedPaths.map((path) => `- \`${path}\``).join('\n');
  let path = join(ticketRoot, `${compactDate}-main-drift-${gate}.md`);
  if (existsSync(path)) path = join(
    ticketRoot,
    `${compactDate}-main-drift-${gate}-${headRevision.slice(0, 8)}.md`,
  );
  const body = `# main drift: ${gate} has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** ${date}
**Drift gate:** \`${gate}\`
**Causal landing:** \`${culprit.revision}\` (${subject})
**Detected at:** \`${headRevision}\`
**Attribution:** \`${culprit.method}\`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran \`${gate}\` independently of path selection on
\`main\` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

${records}

Checker materialization, when available:

${regenerated}

## Reproduce and reconcile

Check:

\`\`\`sh
${command}
\`\`\`

Regenerate/reconcile:

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

function findOpenTicket(ticketRoot, gate) {
  if (!existsSync(ticketRoot)) return null;
  const marker = `**Drift gate:** \`${gate}\``;
  for (const name of readdirSync(ticketRoot).sort()) {
    const path = join(ticketRoot, name);
    if (!name.endsWith('.md') || !lstatSync(path).isFile()) continue;
    if (readFileSync(path, 'utf8').includes(marker)) return path;
  }
  return null;
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
}) {
  const executionEnvironment = sanitizedGitEnvironment(env);
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
      return {
        ok: false,
        phase: 'prepare',
        status: prepared.status,
        signal: prepared.signal,
        stdout: prepared.stdout ?? '',
        stderr: prepared.stderr ?? '',
        infrastructureReason: executionInfrastructureReason(prepared, 'prepare command failed'),
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
  return {
    ok: result.status === 0,
    phase: 'check',
    status: result.status,
    signal: result.signal,
    stdout: `${prepared.stdout ?? ''}${result.stdout ?? ''}`,
    stderr: `${prepared.stderr ?? ''}${result.stderr ?? ''}`,
    infrastructureReason: result.status === 0
      ? null
      : executionInfrastructureReason(result),
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
  if (execution.status === null) return fallback ?? 'gate process did not report an exit status';
  if (execution.status === 126 || execution.status === 127) {
    return `gate process exited ${execution.status} (command unavailable)`;
  }
  const output = `${execution.stdout ?? ''}\n${execution.stderr ?? ''}`;
  const match = output.match(INFRASTRUCTURE_OUTPUT);
  return match ? `gate output reported ${match[0]}` : fallback;
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

function defaultMainRef() {
  for (const ref of ['refs/remotes/origin/main', 'refs/heads/main']) {
    try {
      resolveCommit(ROOT, ref);
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
      + 'backstop [--head REV] [--gate ID[,ID...]] [--issues-dir PATH]',
  );
}
