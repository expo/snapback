#!/usr/bin/env node

// Resolve a Git diff into the canonical proof's fast/affected gate set.
//
// @ref LLP 0175#d2--assign-every-test-to-an-explicit-cadence — the checked
// path-to-suite authority fails broad for unknown/shared inputs and closes
// every selected gate over its declared prerequisites.

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseGateCalls,
  parseInapplicabilityDeclarations,
  validateInapplicabilityDeclarations,
} from './check-local-proof-gates.mjs';

const ROOT = resolve(import.meta.dirname, '..');
let submodulePathCache = null;
const POLICY_PATH = resolve(ROOT, 'scripts/local-proof-selection-policy.v1.json');
const PROOF_PATH = resolve(ROOT, 'scripts/verify-local-proof');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export function loadSelectionContext() {
  const policyBytes = readFileSync(POLICY_PATH);
  const proofSource = readFileSync(PROOF_PATH, 'utf8');
  const calls = parseGateCalls(proofSource);
  const inapplicabilityDeclarations = parseInapplicabilityDeclarations(proofSource);
  validateInapplicabilityDeclarations(calls, inapplicabilityDeclarations);
  const policy = JSON.parse(policyBytes.toString('utf8'));
  const inventory = validateSelectionPolicy(policy, calls);
  return {
    policy,
    calls,
    inapplicabilityDeclarations,
    inventory,
    policyDigest: sha256(policyBytes),
    gateInventoryDigest: sha256(Buffer.from(JSON.stringify({
      calls,
      inapplicabilityDeclarations,
    }))),
  };
}

export function validateSelectionPolicy(policy, calls) {
  assert(
    policy?.schemaVersion === 'snapback.local-proof-selection-policy.v1',
    'selection policy schema',
  );
  assert(policy.unknownPathDisposition === 'all', 'unknown paths fail broad');
  const canonicalGates = [...new Set(calls.map(({ gateId }) => gateId))].sort();
  const canonicalSet = new Set(canonicalGates);
  assert(canonicalGates.length > 80, 'canonical gate inventory is non-vacuous');

  const groupNames = Object.keys(policy.groups ?? {}).sort();
  assert(groupNames.length > 0, 'selection groups exist');
  const declared = new Set();
  const grouped = new Set();
  validateGateList(policy.alwaysGates, 'always gates', canonicalSet, declared);
  for (const name of groupNames) {
    const group = policy.groups[name];
    assert(group?.lane === 'fast' || group?.lane === 'affected', `group ${name} lane`);
    validateGateList(group.gates, `group ${name} gates`, canonicalSet, declared);
    for (const gate of group.gates) grouped.add(gate);
  }
  assert(
    canonicalGates.every((gate) => declared.has(gate)),
    `unclassified canonical gates: ${canonicalGates.filter((gate) => !declared.has(gate)).join(',')}`,
  );

  validateUniqueStrings(policy.affectedBaselineGroups, 'affected baseline groups');
  for (const group of policy.affectedBaselineGroups) {
    assert(policy.groups[group]?.lane === 'affected', `affected baseline group ${group}`);
  }

  const ruleIds = new Set();
  assert(Array.isArray(policy.pathRules) && policy.pathRules.length > 0, 'path rules exist');
  for (const rule of policy.pathRules) {
    assert(typeof rule?.id === 'string' && /^[a-z0-9-]+$/u.test(rule.id), 'path rule id');
    assert(!ruleIds.has(rule.id), `duplicate path rule ${rule.id}`);
    ruleIds.add(rule.id);
    const matchers = ['files', 'prefixes', 'suffixes', 'patterns']
      .flatMap((key) => rule[key] ?? []);
    validateUniqueStrings(matchers, `path rule ${rule.id} matchers`);
    assert(matchers.length > 0, `path rule ${rule.id} has a matcher`);
    validateRuleExtensions(rule, `path rule ${rule.id}`);
    validateRulePatterns(rule, `path rule ${rule.id}`);
    if (rule.disposition === 'all') {
      assert(rule.groups === undefined, `broad path rule ${rule.id} has no groups`);
    } else {
      assert(rule.disposition === undefined, `path rule ${rule.id} disposition`);
      validateUniqueStrings(rule.groups, `path rule ${rule.id} groups`);
      for (const group of rule.groups) assert(policy.groups[group], `path rule ${rule.id} group ${group}`);
    }
  }
  assert(Array.isArray(policy.additivePathRules), 'additive path rules exist');
  for (const rule of policy.additivePathRules) {
    assert(typeof rule?.id === 'string' && /^[a-z0-9-]+$/u.test(rule.id), 'additive path rule id');
    assert(!ruleIds.has(rule.id), `duplicate path rule ${rule.id}`);
    ruleIds.add(rule.id);
    const matchers = ['files', 'prefixes', 'suffixes', 'patterns']
      .flatMap((key) => rule[key] ?? []);
    validateUniqueStrings(matchers, `additive path rule ${rule.id} matchers`);
    assert(matchers.length > 0, `additive path rule ${rule.id} has a matcher`);
    validateRuleExtensions(rule, `additive path rule ${rule.id}`);
    validateRulePatterns(rule, `additive path rule ${rule.id}`);
    assert(rule.disposition === undefined, `additive path rule ${rule.id} disposition`);
    validateUniqueStrings(rule.groups, `additive path rule ${rule.id} groups`);
    for (const group of rule.groups) {
      assert(policy.groups[group], `additive path rule ${rule.id} group ${group}`);
    }
  }

  for (const [gate, prerequisites] of Object.entries(policy.dependencyOverrides ?? {})) {
    assert(canonicalSet.has(gate), `dependency override gate ${gate}`);
    validateUniqueStrings(prerequisites, `dependency override ${gate}`);
    for (const prerequisite of prerequisites) {
      assert(canonicalSet.has(prerequisite), `dependency override ${gate} -> ${prerequisite}`);
    }
  }
  for (const [name, markers] of Object.entries(policy.workflowRequirementMarkers ?? {})) {
    validateUniqueStrings(markers, `workflow requirement ${name}`);
    for (const gate of markers) assert(canonicalSet.has(gate), `workflow marker ${name}:${gate}`);
  }
  const driftEntries = Object.entries(policy.driftProneGates ?? {});
  assert(driftEntries.length > 0, 'drift-prone gate registry exists');
  for (const [gate, metadata] of driftEntries) {
    assert(canonicalSet.has(gate), `drift-prone gate ${gate}`);
    assert(grouped.has(gate), `drift-prone gate ${gate} belongs to an affected path group`);
    validateUniqueStrings(metadata?.records, `drift-prone gate ${gate} records`);
    validateUniqueStrings(metadata?.recordPaths, `drift-prone gate ${gate} record paths`);
    for (const path of metadata.recordPaths) {
      assert(validRepositoryPath(path), `drift-prone gate ${gate} record path ${path}`);
    }
    const triggerMatchers = ['files', 'prefixes', 'suffixes']
      .flatMap((key) => metadata?.triggerRules?.[key] ?? []);
    validateUniqueStrings(triggerMatchers, `drift-prone gate ${gate} trigger rules`);
    assert(triggerMatchers.length > 0, `drift-prone gate ${gate} has trigger rules`);
    for (const matcher of triggerMatchers) {
      assert(validRepositoryPath(matcher), `drift-prone gate ${gate} trigger ${matcher}`);
    }
    assert(
      typeof metadata.regenerateCommand === 'string' && metadata.regenerateCommand.length > 0,
      `drift-prone gate ${gate} regenerate command`,
    );
    if (metadata.blessedRegenerateCommand !== undefined) {
      assert(
        typeof metadata.blessedRegenerateCommand === 'string'
          && metadata.blessedRegenerateCommand.length > 0,
        `drift-prone gate ${gate} blessed regenerate command`,
      );
    }
    if (metadata.prepareCommand !== undefined) {
      assert(
        typeof metadata.prepareCommand === 'string' && metadata.prepareCommand.length > 0,
        `drift-prone gate ${gate} prepare command`,
      );
    }
    if (metadata.requiredModules !== undefined) {
      validateUniqueStrings(metadata.requiredModules, `drift-prone gate ${gate} required modules`);
      for (const module of metadata.requiredModules) {
        assert(
          /^[A-Za-z0-9@][A-Za-z0-9@._/-]*$/u.test(module) && !module.includes('..'),
          `drift-prone gate ${gate} required module ${module}`,
        );
      }
    }
    if (metadata.requiredEnvironmentPaths !== undefined) {
      validateUniqueStrings(
        metadata.requiredEnvironmentPaths,
        `drift-prone gate ${gate} required environment paths`,
      );
      for (const path of metadata.requiredEnvironmentPaths) {
        assert(
          validRepositoryPath(path),
          `drift-prone gate ${gate} required environment path ${path}`,
        );
      }
    }
    if (metadata.requiredSubmodules !== undefined) {
      validateUniqueStrings(
        metadata.requiredSubmodules,
        `drift-prone gate ${gate} required submodules`,
      );
      for (const path of metadata.requiredSubmodules) {
        assert(
          validRepositoryPath(path),
          `drift-prone gate ${gate} required submodule ${path}`,
        );
      }
    }
    if (metadata.sameChangeSemantics !== undefined) {
      assert(
        metadata.sameChangeSemantics === 'historical-validity-only-per-llp-0175',
        `drift-prone gate ${gate} same-change semantics`,
      );
    }
  }
  const driftGateIds = new Set(driftEntries.map(([gate]) => gate));
  validateUniqueStrings(policy.driftAlwaysRunGates, 'drift always-run gates');
  assert(policy.driftAlwaysRunGates.length > 0, 'drift always-run gates are non-empty');
  for (const gate of policy.driftAlwaysRunGates) {
    assert(driftGateIds.has(gate), `drift always-run gate ${gate}`);
  }
  validateUniqueStrings(policy.driftFailClosedCoreGates, 'drift fail-closed core gates');
  assert(policy.driftFailClosedCoreGates.length > 0, 'drift fail-closed core gates are non-empty');
  for (const gate of policy.driftFailClosedCoreGates) {
    assert(driftGateIds.has(gate), `drift fail-closed core gate ${gate}`);
  }

  return { canonicalGates, groupNames };
}

export function selectChangedPaths(changedFiles, context = loadSelectionContext()) {
  const { policy, calls, inventory } = context;
  validateUniqueStrings(changedFiles, 'changed files');
  const classifications = [];
  const selectedGroups = new Set();
  const matchedRules = new Set();
  const broadFiles = [];
  const unknownFiles = [];

  for (const path of [...changedFiles].sort()) {
    assert(validRepositoryPath(path), `invalid changed path ${JSON.stringify(path)}`);
    const rule = policy.pathRules.find((candidate) => matchesRule(path, candidate));
    const additiveRules = policy.additivePathRules
      .filter((candidate) => matchesRule(path, candidate));
    const additiveRuleIds = additiveRules.map(({ id }) => id).sort();
    const additiveGroups = additiveRules.flatMap(({ groups }) => groups);
    for (const { id } of additiveRules) matchedRules.add(id);
    for (const group of additiveGroups) selectedGroups.add(group);
    if (!rule) {
      unknownFiles.push(path);
      classifications.push({
        path,
        ruleId: null,
        additiveRuleIds,
        disposition: 'all',
        groups: [...new Set(additiveGroups)].sort(),
      });
      continue;
    }
    matchedRules.add(rule.id);
    const disposition = rule.disposition === 'all' ? 'all' : 'groups';
    const groups = [...new Set([...(rule.groups ?? []), ...additiveGroups])].sort();
    if (disposition === 'all') broadFiles.push(path);
    for (const group of groups) selectedGroups.add(group);
    classifications.push({ path, ruleId: rule.id, additiveRuleIds, disposition, groups });
  }

  const failBroad = broadFiles.length > 0 || unknownFiles.length > 0;
  if (failBroad) {
    for (const group of inventory.groupNames) selectedGroups.add(group);
  }
  const hasAffectedGroup = [...selectedGroups]
    .some((group) => policy.groups[group].lane === 'affected');
  if (hasAffectedGroup) {
    for (const group of policy.affectedBaselineGroups) selectedGroups.add(group);
  }

  const selected = new Set(policy.alwaysGates);
  for (const group of selectedGroups) {
    for (const gate of policy.groups[group].gates) selected.add(gate);
  }
  closePrerequisites(selected, calls, policy.dependencyOverrides ?? {});
  if (failBroad) for (const gate of inventory.canonicalGates) selected.add(gate);

  const selectedGates = inventory.canonicalGates.filter((gate) => selected.has(gate));
  const notSelectedGates = inventory.canonicalGates.filter((gate) => !selected.has(gate));
  const selectedSet = new Set(selectedGates);
  const markers = policy.workflowRequirementMarkers;
  const requires = (name) => markers[name].some((gate) => selectedSet.has(gate));
  const selectionClass = failBroad
    ? 'FAIL_CLOSED_FULL'
    : hasAffectedGroup
      ? 'AFFECTED'
      : 'FAST_ONLY';

  return {
    selectionClass,
    classifications,
    matchedRules: [...matchedRules].sort(),
    selectedGroups: [...selectedGroups].sort(),
    broadFiles,
    unknownFiles,
    selectedGates,
    notSelectedGates,
    requirements: {
      // @ref LLP 0175#d2--assign-every-test-to-an-explicit-cadence — the
      // docs-only core stays dependency-free; fast path-owned gates declare
      // the narrow workflow setup they need instead of widening the core.
      javascriptDependencies: selectionClass !== 'FAST_ONLY'
        || selectedSet.has('generated-artifacts')
        || requires('javascriptDependencies'),
      native: requires('native'),
      rustToolchain: requires('native') || requires('rustToolchain'),
      browser: requires('browser'),
      cargoAudit: requires('cargoAudit'),
      privateRoot: requires('privateRoot'),
    },
  };
}

export function selectDriftProneGates(
  changedFiles,
  context = loadSelectionContext(),
  { failClosedDisposition = 'core' } = {},
) {
  assert(
    failClosedDisposition === 'core' || failClosedDisposition === 'full',
    `drift fail-closed disposition ${failClosedDisposition}`,
  );
  const selection = selectChangedPaths(changedFiles, context);
  const driftGateIds = new Set(Object.keys(context.policy.driftProneGates));
  const selected = new Set(context.policy.driftAlwaysRunGates);
  for (const gate of driftGateIds) {
    if (changedFiles.some((path) => (
      matchesRule(path, context.policy.driftProneGates[gate].triggerRules)
    ))) selected.add(gate);
  }
  const driftFailClosedDisposition = selection.selectionClass === 'FAIL_CLOSED_FULL'
    ? failClosedDisposition
    : null;
  if (driftFailClosedDisposition === 'full') {
    for (const gate of driftGateIds) selected.add(gate);
  } else if (driftFailClosedDisposition === 'core') {
    for (const gate of context.policy.driftFailClosedCoreGates) selected.add(gate);
  }
  const selectedDriftProneGates = context.inventory.canonicalGates.filter((gate) => (
    selected.has(gate)
  ));
  return { ...selection, driftFailClosedDisposition, selectedDriftProneGates };
}

export function completeSelection(context = loadSelectionContext()) {
  const { inventory, policy } = context;
  const selectedSet = new Set(inventory.canonicalGates);
  const markers = policy.workflowRequirementMarkers;
  const requires = (name) => markers[name].some((gate) => selectedSet.has(gate));
  return {
    selectionClass: 'COMPLETE',
    classifications: [],
    matchedRules: [],
    selectedGroups: inventory.groupNames,
    broadFiles: [],
    unknownFiles: [],
    selectedGates: inventory.canonicalGates,
    notSelectedGates: [],
    requirements: {
      javascriptDependencies: true,
      native: requires('native'),
      rustToolchain: requires('native') || requires('rustToolchain'),
      browser: requires('browser'),
      cargoAudit: requires('cargoAudit'),
      privateRoot: requires('privateRoot'),
    },
  };
}

export function selectGate(gateId, context = loadSelectionContext()) {
  assert(/^[a-z0-9-]+$/u.test(gateId), `invalid gate id ${JSON.stringify(gateId)}`);
  assert(context.inventory.canonicalGates.includes(gateId), `unknown gate ${gateId}`);
  const selected = new Set([gateId]);
  closePrerequisites(selected, context.calls, context.policy.dependencyOverrides ?? {});
  return context.inventory.canonicalGates.filter((gate) => selected.has(gate));
}

export function planSelection({
  cadence,
  base = null,
  head = 'HEAD',
  includeWorktree = false,
}) {
  const context = loadSelectionContext();
  const headRevision = resolveCommit(head);
  let requestedBaseRevision = null;
  let baseRevision = null;
  let changedFiles = [];
  let committedChangedFiles = [];
  let worktree = null;
  let selection;
  if (cadence === 'complete') {
    assert(base === null, 'complete cadence does not accept a base');
    assert(includeWorktree === false, 'complete cadence does not accept --include-worktree');
    selection = completeSelection(context);
  } else if (cadence === 'affected') {
    assert(typeof base === 'string' && base.length > 0, 'affected cadence requires a base');
    requestedBaseRevision = resolveCommit(base);
    baseRevision = mergeBase(requestedBaseRevision, headRevision);
    committedChangedFiles = changedPaths(requestedBaseRevision, headRevision);
    // @ref LLP 0175#d25-local-worktree-affected-proof-amendment-2026-08-28 —
    // the union is deduplicated and classified once, so a path present in both
    // the committed diff and the worktree selects exactly like any other path.
    if (includeWorktree) {
      worktree = worktreeSnapshot();
      changedFiles = [...new Set([...committedChangedFiles, ...worktree.paths])].sort();
    } else {
      changedFiles = committedChangedFiles;
    }
    selection = selectChangedPaths(changedFiles, context);
  } else {
    fail(`unsupported cadence ${cadence}`);
  }
  return {
    schemaVersion: 'snapback.local-proof-selection.v1',
    cadence,
    policyDigest: context.policyDigest,
    gateInventoryDigest: context.gateInventoryDigest,
    requestedBaseRevision,
    baseRevision,
    headRevision,
    changedFiles,
    // Committed-only receipts keep their exact v1 shape; the worktree fields
    // appear only when the mode is requested, so commit-bound consumers,
    // replay, CI, hooks, backstops, and claim qualification are untouched.
    worktreeIncluded: includeWorktree,
    ...(includeWorktree ? {
      committedChangedFiles,
      worktreeChangedFiles: worktree.inventory,
      worktreeSelectionDigest: worktree.selectionDigest,
      worktreeContentDigest: worktree.contentDigest,
    } : {}),
    canonicalGateCount: context.inventory.canonicalGates.length,
    selectedGateCount: selection.selectedGates.length,
    selectedGateDigest: digestSelectedGateIds(selection.selectedGates),
    ...selection,
  };
}

export function selectedGateBytes(gateIds) {
  validateUniqueStrings(gateIds, 'selected gates');
  for (const gateId of gateIds) {
    assert(/^[a-z0-9-]+$/u.test(gateId), `selected gate id ${JSON.stringify(gateId)}`);
  }
  return Buffer.from(gateIds.map((gateId) => `${gateId}\n`).join(''));
}

export function digestSelectedGateIds(gateIds) {
  return `sha256:${sha256(selectedGateBytes(gateIds))}`;
}

export function materializeSelectedGates(gateIds, output) {
  assert(typeof output === 'string' && output.length > 0, 'selected gate output path');
  const bytes = selectedGateBytes(gateIds);
  const temporary = resolve(dirname(output), `.selected-gates-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
  return {
    selectedGateCount: gateIds.length,
    selectedGateDigest: `sha256:${sha256(bytes)}`,
  };
}

// @ref LLP 0175#d25-local-worktree-affected-proof-amendment-2026-08-28 —
// recomputed before the outer proof writes a successful completion receipt.
// A selected proof may have been correct for the opening snapshot; it cannot
// claim the closing one. This is completion-receipt invalidation, not a sixth
// gate terminal result, so it returns a verdict rather than failing a gate.
export function recheckWorktreeSnapshot(receipt) {
  return recheckWorktreeSnapshotIn(ROOT, receipt);
}

export function recheckWorktreeSnapshotIn(root, receipt) {
  if (receipt?.worktreeIncluded !== true) return { checked: false, unchanged: true };
  const current = worktreeSnapshot(root);
  const selectionUnchanged = current.selectionDigest === receipt.worktreeSelectionDigest;
  const contentUnchanged = current.contentDigest === receipt.worktreeContentDigest;
  return {
    checked: true,
    unchanged: selectionUnchanged && contentUnchanged,
    selectionUnchanged,
    contentUnchanged,
    opening: {
      selectionDigest: receipt.worktreeSelectionDigest,
      contentDigest: receipt.worktreeContentDigest,
    },
    closing: {
      selectionDigest: current.selectionDigest,
      contentDigest: current.contentDigest,
    },
  };
}

export function validateSelectionReceipt(receipt) {
  assert(receipt?.schemaVersion === 'snapback.local-proof-selection.v1', 'selection receipt schema');
  assert(receipt.headRevision === resolveCommit('HEAD'), 'selection receipt matches current HEAD');
  const expected = planSelection({
    cadence: receipt.cadence,
    base: receipt.cadence === 'affected' ? receipt.requestedBaseRevision : null,
    head: receipt.headRevision,
    includeWorktree: receipt.worktreeIncluded === true,
  });
  assert(JSON.stringify(receipt) === JSON.stringify(expected), 'selection receipt is exact and current');
  return receipt;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'plan') {
    validateOptionArgs(args, [
      '--cadence', '--output', '--base', '--head', '--github-output',
    ], ['--include-worktree']);
    const cadence = requiredArg(args, '--cadence');
    const output = requiredArg(args, '--output');
    const base = optionalArg(args, '--base');
    const head = optionalArg(args, '--head') ?? 'HEAD';
    const githubOutput = optionalArg(args, '--github-output');
    const receipt = planSelection({
      cadence, base, head, includeWorktree: args.includes('--include-worktree'),
    });
    writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
    if (githubOutput) writeGitHubOutputs(githubOutput, receipt);
    process.stdout.write(`${JSON.stringify(summary(receipt))}\n`);
  } else if (command === 'recheck-worktree') {
    const path = onlyPathArg(args);
    const verdict = recheckWorktreeSnapshot(readJson(path));
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    if (verdict.checked && !verdict.unchanged) process.exit(3);
  } else if (command === 'validate') {
    const path = onlyPathArg(args);
    const receipt = validateSelectionReceipt(readJson(path));
    process.stdout.write(`${JSON.stringify(summary(receipt))}\n`);
  } else if (command === 'gates') {
    const path = onlyPathArg(args);
    const receipt = validateSelectionReceipt(readJson(path));
    process.stdout.write(selectedGateBytes(receipt.selectedGates));
  } else if (command === 'materialize') {
    validateOptionArgs(args, ['--receipt', '--output']);
    const receipt = validateSelectionReceipt(readJson(requiredArg(args, '--receipt')));
    const metadata = materializeSelectedGates(receipt.selectedGates, requiredArg(args, '--output'));
    process.stdout.write(`${JSON.stringify(metadata)}\n`);
  } else if (command === 'gate') {
    validateOptionArgs(args, ['--id', '--output']);
    const gates = selectGate(requiredArg(args, '--id'));
    const output = optionalArg(args, '--output');
    if (output) {
      process.stdout.write(`${JSON.stringify(materializeSelectedGates(gates, output))}\n`);
    } else {
      process.stdout.write(selectedGateBytes(gates));
    }
  } else {
    usage();
  }
}

function closePrerequisites(selected, calls, overrides) {
  const dependencies = new Map();
  for (const call of calls) {
    const known = call.prerequisites.filter((gate) => /^[a-z0-9-]+$/u.test(gate));
    const current = dependencies.get(call.gateId) ?? [];
    dependencies.set(call.gateId, [...new Set([...current, ...known])]);
  }
  for (const [gate, prerequisites] of Object.entries(overrides)) {
    dependencies.set(gate, [...new Set([...(dependencies.get(gate) ?? []), ...prerequisites])]);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const gate of [...selected]) {
      for (const prerequisite of dependencies.get(gate) ?? []) {
        if (selected.has(prerequisite)) continue;
        selected.add(prerequisite);
        changed = true;
      }
    }
  }
}

function matchesRule(path, rule) {
  const matchesPath = (rule.files ?? []).includes(path)
    || (rule.prefixes ?? []).some((prefix) => path.startsWith(prefix))
    || (rule.suffixes ?? []).some((suffix) => path.endsWith(suffix))
    || (rule.patterns ?? []).some((pattern) => new RegExp(pattern, 'u').test(path));
  return matchesPath && (
    rule.extensions === undefined
    || rule.extensions.some((extension) => path.endsWith(extension))
  );
}

function validateRulePatterns(rule, description) {
  if (rule.patterns === undefined) return;
  validateUniqueStrings(rule.patterns, `${description} patterns`);
  assert(rule.patterns.length > 0, `${description} patterns are non-empty`);
  for (const pattern of rule.patterns) {
    assert(pattern.startsWith('^') && pattern.endsWith('$'), `${description} anchored pattern ${pattern}`);
    try {
      new RegExp(pattern, 'u');
    } catch {
      assert(false, `${description} valid pattern ${pattern}`);
    }
  }
}

function validateRuleExtensions(rule, description) {
  if (rule.extensions === undefined) return;
  validateUniqueStrings(rule.extensions, `${description} extensions`);
  assert(rule.extensions.length > 0, `${description} extensions are non-empty`);
  for (const extension of rule.extensions) {
    assert(/^\.[a-z0-9]+$/u.test(extension), `${description} extension ${extension}`);
  }
}

function validRepositoryPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.split('/').includes('..');
}

// @ref LLP 0175#d25-local-worktree-affected-proof-amendment-2026-08-28 —
// the committed selector answers "what did these commits change?". The most
// common local question is "do the changes in front of me pass?", and staged,
// unstaged, deleted, renamed, intent-to-add, untracked, and dirty-submodule
// bytes never participated in that answer. This mode adds them.
//
// Read-only by construction: every command below is a query. Nothing here runs
// `git add`, commits, stashes, cleans, or fetches.

function nulSeparated(output) {
  return output.split('\0').filter(Boolean);
}

// `-z` name-status output is a flat NUL stream of alternating status and path,
// except renames/copies which carry two paths. `--no-renames` is deliberately
// NOT used: both sides of a rename must select, which is the fail-broad
// posture D2 already takes for unknown inputs.
function gitIn(root, args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
}

function nameStatusPairs(root, args) {
  const fields = nulSeparated(gitIn(root, args));
  const entries = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    index += 1;
    if (status === undefined) break;
    const isRenameOrCopy = /^[RC]/u.test(status);
    const from = fields[index];
    index += 1;
    if (from === undefined) break;
    if (isRenameOrCopy) {
      const to = fields[index];
      index += 1;
      entries.push({ path: from, status });
      if (to !== undefined) entries.push({ path: to, status });
    } else {
      entries.push({ path: from, status });
    }
  }
  return entries;
}

function worktreeEntries(root) {
  const entries = [];
  // 2. staged relative to HEAD
  for (const entry of nameStatusPairs(root, ['diff', '--name-status', '--cached', '-z', 'HEAD'])) {
    entries.push({ ...entry, source: 'staged' });
  }
  // 3. unstaged tracked relative to the index (also surfaces intent-to-add)
  for (const entry of nameStatusPairs(root, ['diff', '--name-status', '-z'])) {
    entries.push({ ...entry, source: 'unstaged' });
  }
  // 5. non-ignored untracked files from the superproject only
  for (const path of nulSeparated(gitIn(root, ['ls-files', '--others', '--exclude-standard', '-z']))) {
    entries.push({ path, status: '?', source: 'untracked' });
  }
  // 6. a submodule root whose recorded commit, index entry, or worktree is
  //    dirty. Ignored submodule byproducts do not participate, which is why
  //    this uses --ignore-submodules=untracked rather than =none.
  for (const line of nulSeparated(gitIn(
    root, ['status', '--porcelain=v1', '-z', '--ignore-submodules=untracked'],
  ))) {
    const path = line.slice(3);
    if (!path || !submodulePaths(root).has(path)) continue;
    entries.push({ path, status: line.slice(0, 2).trim() || 'M', source: 'submodule' });
  }
  return entries;
}

function submodulePaths(root) {
  if (root === ROOT && submodulePathCache) return submodulePathCache;
  let output = '';
  try {
    output = gitIn(root, ['ls-files', '--stage', '-z']);
  } catch {
    output = '';
  }
  const paths = new Set();
  for (const record of nulSeparated(output)) {
    // mode SP sha SP stage TAB path; gitlinks are mode 160000
    if (record.startsWith('160000 ')) paths.add(record.slice(record.indexOf('\t') + 1));
  }
  if (root === ROOT) submodulePathCache = paths;
  return paths;
}

// The canonical selection input: one deterministic line per (path, status),
// deduplicated, sorted. The same path arriving from several sources is
// classified once.
function canonicalWorktreeInventory(entries) {
  const byPath = new Map();
  for (const { path, status } of entries) {
    const statuses = byPath.get(path) ?? new Set();
    statuses.add(status);
    byPath.set(path, statuses);
  }
  return [...byPath.entries()]
    .map(([path, statuses]) => ({ path, status: [...statuses].sort().join('') }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function worktreeSelectionDigest(inventory) {
  const hash = createHash('sha256');
  for (const { path, status } of inventory) hash.update(`${path}\0${status}\0`);
  return `sha256:${hash.digest('hex')}`;
}

// A content digest over the changed worktree inputs. Repo-relative paths and
// content *digests* only — never file contents. Deletion, symlink-target,
// Git-link, and ordinary-file markers keep distinct states distinct, so a file
// replaced by a symlink to the same bytes still rotates the digest.
function worktreeContentDigest(root, inventory) {
  const hash = createHash('sha256');
  for (const { path } of inventory) {
    const absolute = resolve(root, path);
    let stats = null;
    try {
      stats = lstatSync(absolute);
    } catch {
      hash.update(`d\0${path}\0`);
      continue;
    }
    if (stats.isSymbolicLink()) {
      hash.update(`l\0${path}\0${readlinkSync(absolute)}\0`);
    } else if (stats.isDirectory()) {
      // a gitlink: identify by the submodule's currently checked-out commit
      let recorded = '';
      try {
        recorded = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: absolute, encoding: 'utf8',
        }).trim();
      } catch {
        recorded = 'unresolved';
      }
      hash.update(`g\0${path}\0${recorded}\0`);
    } else {
      hash.update(`f\0${path}\0${createHash('sha256').update(readFileSync(absolute)).digest('hex')}\0`);
    }
  }
  return `sha256:${hash.digest('hex')}`;
}

export function worktreeSnapshot(root = ROOT) {
  const inventory = canonicalWorktreeInventory(worktreeEntries(root));
  return {
    inventory,
    paths: inventory.map(({ path }) => path),
    selectionDigest: worktreeSelectionDigest(inventory),
    contentDigest: worktreeContentDigest(root, inventory),
  };
}

function changedPaths(base, head) {
  const output = git([
    'diff', '--name-only', '--no-renames', '--diff-filter=ACDMRTUXB', '-z', `${base}...${head}`,
  ], { encoding: 'utf8' });
  return output.split('\0').filter(Boolean).sort();
}

function resolveCommit(revision) {
  assert(typeof revision === 'string' && revision.length > 0, 'Git revision');
  const resolved = git(['rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' }).trim();
  assert(/^[0-9a-f]{40}$/u.test(resolved), `resolved Git revision ${revision}`);
  return resolved;
}

function mergeBase(left, right) {
  const resolved = git(['merge-base', left, right], { encoding: 'utf8' }).trim();
  assert(/^[0-9a-f]{40}$/u.test(resolved), 'Git merge base');
  return resolved;
}

function git(args, options) {
  try {
    return execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...options });
  } catch (error) {
    fail(`Git command failed: git ${args.join(' ')} (${error.status ?? 'unknown'})`);
  }
}

function writeGitHubOutputs(path, receipt) {
  const pairs = {
    cadence: receipt.cadence,
    selection_class: receipt.selectionClass,
    selected_gate_count: receipt.selectedGateCount,
    selected_gate_digest: receipt.selectedGateDigest,
    requires_javascript_dependencies: receipt.requirements.javascriptDependencies,
    requires_native: receipt.requirements.native,
    requires_rust_toolchain: receipt.requirements.rustToolchain,
    requires_browser: receipt.requirements.browser,
    requires_cargo_audit: receipt.requirements.cargoAudit,
    requires_private_root: receipt.requirements.privateRoot,
  };
  appendFileSync(path, `${Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
}

function summary(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    cadence: receipt.cadence,
    selectionClass: receipt.selectionClass,
    baseRevision: receipt.baseRevision,
    headRevision: receipt.headRevision,
    changedFileCount: receipt.changedFiles.length,
    selectedGateCount: receipt.selectedGateCount,
    selectedGateDigest: receipt.selectedGateDigest,
    canonicalGateCount: receipt.canonicalGateCount,
    selectedGroups: receipt.selectedGroups,
    unknownFiles: receipt.unknownFiles,
    broadFiles: receipt.broadFiles,
    requirements: receipt.requirements,
  };
}

function validateGateList(values, label, canonicalSet, declared) {
  validateUniqueStrings(values, label);
  for (const gate of values) {
    assert(canonicalSet.has(gate), `${label} contains unknown gate ${gate}`);
    declared.add(gate);
  }
}

function validateUniqueStrings(values, label) {
  assert(Array.isArray(values), `${label} is an array`);
  assert(values.every((value) => typeof value === 'string' && value.length > 0), `${label} strings`);
  assert(new Set(values).size === values.length, `${label} is unique`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requiredArg(args, name) {
  const value = optionalArg(args, name);
  if (value === null) usage();
  return value;
}

function optionalArg(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) usage();
  return args[index + 1];
}

function validateOptionArgs(args, allowed, booleans = []) {
  // Boolean flags carry no value; strip them before the pair check so the
  // name/value contract still holds for everything else.
  for (const flag of booleans) {
    assert(args.filter((arg) => arg === flag).length <= 1, `duplicate option ${flag}`);
  }
  const pairArgs = args.filter((arg) => !booleans.includes(arg));
  assert(pairArgs.length % 2 === 0, 'plan arguments are name/value pairs');
  const seen = new Set();
  for (let index = 0; index < pairArgs.length; index += 2) {
    const name = pairArgs[index];
    assert(allowed.includes(name), `unknown option ${name}`);
    assert(!seen.has(name), `duplicate option ${name}`);
    assert(pairArgs[index + 1] && !pairArgs[index + 1].startsWith('--'), `missing value for ${name}`);
    seen.add(name);
  }
}

function onlyPathArg(args) {
  if (args.length !== 1 || args[0].startsWith('--')) usage();
  return args[0];
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, label) {
  if (!condition) fail(label);
}

function fail(label) {
  throw new Error(`SNAPBACK_LOCAL_PROOF_SELECTION_INVALID: ${label}`);
}

function usage() {
  throw new Error(
    'usage: select-local-proof.mjs plan --cadence complete|affected [--base REV] [--head REV] --output FILE [--github-output FILE] | validate RECEIPT | gates RECEIPT | materialize --receipt RECEIPT --output FILE | gate --id ID [--output FILE]',
  );
}
