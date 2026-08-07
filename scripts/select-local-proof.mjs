#!/usr/bin/env node

// Resolve a Git diff into the canonical proof's fast/affected gate set.
//
// @ref LLP 0175#d2--assign-every-test-to-an-explicit-cadence — the checked
// path-to-suite authority fails broad for unknown/shared inputs and closes
// every selected gate over its declared prerequisites.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGateCalls } from './check-local-proof-gates.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const POLICY_PATH = resolve(ROOT, 'scripts/local-proof-selection-policy.v1.json');
const PROOF_PATH = resolve(ROOT, 'scripts/verify-local-proof');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export function loadSelectionContext() {
  const policyBytes = readFileSync(POLICY_PATH);
  const proofSource = readFileSync(PROOF_PATH, 'utf8');
  const calls = parseGateCalls(proofSource);
  const policy = JSON.parse(policyBytes.toString('utf8'));
  const inventory = validateSelectionPolicy(policy, calls);
  return {
    policy,
    calls,
    inventory,
    policyDigest: sha256(policyBytes),
    gateInventoryDigest: sha256(Buffer.from(JSON.stringify(calls))),
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
    const matchers = ['files', 'prefixes', 'suffixes'].flatMap((key) => rule[key] ?? []);
    validateUniqueStrings(matchers, `path rule ${rule.id} matchers`);
    assert(matchers.length > 0, `path rule ${rule.id} has a matcher`);
    if (rule.disposition === 'all') {
      assert(rule.groups === undefined, `broad path rule ${rule.id} has no groups`);
    } else {
      assert(rule.disposition === undefined, `path rule ${rule.id} disposition`);
      validateUniqueStrings(rule.groups, `path rule ${rule.id} groups`);
      for (const group of rule.groups) assert(policy.groups[group], `path rule ${rule.id} group ${group}`);
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

  return { canonicalGates, groupNames };
}

export function selectChangedPaths(changedFiles, context = loadSelectionContext()) {
  const { policy, calls, inventory } = context;
  validateUniqueStrings(changedFiles, 'changed files');
  const classifications = [];
  const selectedGroups = new Set();
  const broadFiles = [];
  const unknownFiles = [];

  for (const path of [...changedFiles].sort()) {
    assert(validRepositoryPath(path), `invalid changed path ${JSON.stringify(path)}`);
    const rule = policy.pathRules.find((candidate) => matchesRule(path, candidate));
    if (!rule) {
      unknownFiles.push(path);
      classifications.push({ path, ruleId: null, disposition: 'all', groups: [] });
      continue;
    }
    const disposition = rule.disposition === 'all' ? 'all' : 'groups';
    const groups = [...(rule.groups ?? [])].sort();
    if (disposition === 'all') broadFiles.push(path);
    for (const group of groups) selectedGroups.add(group);
    classifications.push({ path, ruleId: rule.id, disposition, groups });
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
    matchedRules: [...new Set(classifications.map(({ ruleId }) => ruleId).filter(Boolean))].sort(),
    selectedGroups: [...selectedGroups].sort(),
    broadFiles,
    unknownFiles,
    selectedGates,
    notSelectedGates,
    requirements: {
      javascriptDependencies: selectionClass !== 'FAST_ONLY' || selectedSet.has('generated-artifacts'),
      native: requires('native'),
      browser: requires('browser'),
      cargoAudit: requires('cargoAudit'),
      privateRoot: requires('privateRoot'),
    },
  };
}

export function selectDriftProneGates(changedFiles, context = loadSelectionContext()) {
  const selection = selectChangedPaths(changedFiles, context);
  const driftGateIds = new Set(Object.keys(context.policy.driftProneGates));
  const selectedDriftProneGates = context.inventory.canonicalGates.filter((gate) => (
    driftGateIds.has(gate)
      && (
        selection.selectionClass === 'FAIL_CLOSED_FULL'
          || changedFiles.some((path) => (
            matchesRule(path, context.policy.driftProneGates[gate].triggerRules)
          ))
      )
  ));
  return { ...selection, selectedDriftProneGates };
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
      browser: requires('browser'),
      cargoAudit: requires('cargoAudit'),
      privateRoot: requires('privateRoot'),
    },
  };
}

export function planSelection({ cadence, base = null, head = 'HEAD' }) {
  const context = loadSelectionContext();
  const headRevision = resolveCommit(head);
  let requestedBaseRevision = null;
  let baseRevision = null;
  let changedFiles = [];
  let selection;
  if (cadence === 'complete') {
    assert(base === null, 'complete cadence does not accept a base');
    selection = completeSelection(context);
  } else if (cadence === 'affected') {
    assert(typeof base === 'string' && base.length > 0, 'affected cadence requires a base');
    requestedBaseRevision = resolveCommit(base);
    baseRevision = mergeBase(requestedBaseRevision, headRevision);
    changedFiles = changedPaths(requestedBaseRevision, headRevision);
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
    canonicalGateCount: context.inventory.canonicalGates.length,
    selectedGateCount: selection.selectedGates.length,
    ...selection,
  };
}

export function validateSelectionReceipt(receipt) {
  assert(receipt?.schemaVersion === 'snapback.local-proof-selection.v1', 'selection receipt schema');
  assert(receipt.headRevision === resolveCommit('HEAD'), 'selection receipt matches current HEAD');
  const expected = planSelection({
    cadence: receipt.cadence,
    base: receipt.cadence === 'affected' ? receipt.requestedBaseRevision : null,
    head: receipt.headRevision,
  });
  assert(JSON.stringify(receipt) === JSON.stringify(expected), 'selection receipt is exact and current');
  return receipt;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'plan') {
    validateOptionArgs(args, [
      '--cadence', '--output', '--base', '--head', '--github-output',
    ]);
    const cadence = requiredArg(args, '--cadence');
    const output = requiredArg(args, '--output');
    const base = optionalArg(args, '--base');
    const head = optionalArg(args, '--head') ?? 'HEAD';
    const githubOutput = optionalArg(args, '--github-output');
    const receipt = planSelection({ cadence, base, head });
    writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
    if (githubOutput) writeGitHubOutputs(githubOutput, receipt);
    process.stdout.write(`${JSON.stringify(summary(receipt))}\n`);
  } else if (command === 'validate') {
    const path = onlyPathArg(args);
    const receipt = validateSelectionReceipt(readJson(path));
    process.stdout.write(`${JSON.stringify(summary(receipt))}\n`);
  } else if (command === 'gates') {
    const path = onlyPathArg(args);
    const receipt = validateSelectionReceipt(readJson(path));
    process.stdout.write(`${receipt.selectedGates.join('\n')}\n`);
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
  return (rule.files ?? []).includes(path)
    || (rule.prefixes ?? []).some((prefix) => path.startsWith(prefix))
    || (rule.suffixes ?? []).some((suffix) => path.endsWith(suffix));
}

function validRepositoryPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.split('/').includes('..');
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
    requires_javascript_dependencies: receipt.requirements.javascriptDependencies,
    requires_native: receipt.requirements.native,
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

function validateOptionArgs(args, allowed) {
  assert(args.length % 2 === 0, 'plan arguments are name/value pairs');
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    assert(allowed.includes(name), `unknown option ${name}`);
    assert(!seen.has(name), `duplicate option ${name}`);
    assert(args[index + 1] && !args[index + 1].startsWith('--'), `missing value for ${name}`);
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
    'usage: select-local-proof.mjs plan --cadence complete|affected [--base REV] [--head REV] --output FILE [--github-output FILE] | validate RECEIPT | gates RECEIPT',
  );
}
