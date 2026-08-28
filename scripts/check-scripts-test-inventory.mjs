#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCAL_SUITES } from '../targets/cloudflare/test/local-suite-manifest.mjs';
import {
  PACKAGE_TEST_INVENTORIES,
  auditInventory as auditPackageInventory,
} from './check-package-test-inventory.mjs';
import { parseGateCalls } from './check-local-proof-gates.mjs';

// @ref LLP 0276#scripts — Phase 0 makes every root scripts/*.test.mjs file
// declare a checked runner or an explicit ticketed unrun disposition.
// @ref LLP 0010#ci-and-review-gates — canonical proof inventories are exact,
// so adding a maintained test cannot silently create an unexecuted sample.

const ROOT = resolve(import.meta.dirname, '..');
const PROOF_PATH = 'scripts/verify-local-proof';
const POLICY_PATH = 'scripts/local-proof-selection-policy.v1.json';
const ROOT_SCRIPTS_TEST_PATTERN = /^scripts\/[A-Za-z0-9._-]+\.test\.mjs$/u;

export const SCRIPTS_TEST_INVENTORY = Object.freeze([
  {
    file: 'scripts/binary-size-metrology.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'runtime-package-authority-fixtures' },
  },
  {
    file: 'scripts/build-linux-runtime-release.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'linux-runtime-release-fixtures' },
  },
  {
    file: 'scripts/check-contract-meta.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'contract-meta-fixtures' },
  },
  {
    file: 'scripts/check-guide-shell-commands.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'guide-shell-command-fixtures' },
  },
  {
    file: 'scripts/check-package-export-types.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'package-export-types-fixtures' },
  },
  {
    file: 'scripts/cold-clone-report-probe.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'cold-clone-report-probe-fixtures' },
  },
  {
    file: 'scripts/generate-app-api-md.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'app-api-md-fixtures' },
  },
  {
    file: 'scripts/generate-control-catalog.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'control-catalog-fixtures' },
  },
  {
    file: 'scripts/generate-diagnostics-registry.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'diagnostics-registry-fixtures' },
  },
  {
    file: 'scripts/guide-authoring-profiles.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'guide-authoring-profile-fixtures' },
  },
  {
    file: 'scripts/guide-freshness.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'guide-freshness-fixtures' },
  },
  {
    file: 'scripts/guide-published-closure.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'guide-published-closure-fixtures' },
  },
  {
    file: 'scripts/local-source-package-closure.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'local-source-package-closure' },
  },
  {
    file: 'scripts/package-readme-funnel.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'package-readme-funnel' },
  },
  {
    file: 'scripts/packaged-store-qualification.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'publication-script-fixtures' },
  },
  {
    file: 'scripts/publication-store-qualification-gate.test.mjs',
    disposition: 'run',
    runner: {
      mechanism: 'verify-local-proof',
      gateId: 'publication-store-qualification-fixtures',
    },
  },
  {
    file: 'scripts/published-closure-boot-smoke.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'published-closure-boot-smoke-fixtures' },
  },
  {
    file: 'scripts/published-closure-rehearsal.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'publication-script-fixtures' },
  },
  {
    file: 'scripts/qualified-staging-ledger-check.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'qualified-staging-ledger-fixtures' },
  },
  {
    file: 'scripts/runtime-package-authority.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'runtime-package-authority-fixtures' },
  },
  {
    file: 'scripts/snapback-fastpath-release.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'fastpath-release-fixtures' },
  },
  {
    file: 'scripts/snapback-generate-latest-proof-plan.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'latest-proof-plan-generator-fixtures' },
  },
  {
    file: 'scripts/snapback-github-latest-proof.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'github-latest-proof-fixtures' },
  },
  {
    file: 'scripts/snapback-observe-prior-vector.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'prior-vector-observer-fixtures' },
  },
  {
    file: 'scripts/snapback-package-cold-install.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'package-cold-install-fixtures' },
  },
  {
    file: 'scripts/snapback-prior-default-closure.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'publication-script-fixtures' },
  },
  {
    file: 'scripts/snapback-publish.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'runtime-package-authority-fixtures' },
  },
  {
    file: 'scripts/snapback-promotion-core.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'promotion-fixtures' },
  },
  {
    file: 'scripts/stage-linux-hermes-release.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'hermes-carrier-staging-fixtures' },
  },
  {
    file: 'scripts/symbol-lifecycle.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'publication-script-fixtures' },
  },
  {
    file: 'scripts/telemetry-phase1-evidence.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'telemetry-evidence-fixtures' },
  },
  {
    file: 'scripts/telemetry-release-gate.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'telemetry-release-gate-fixtures' },
  },
  {
    file: 'scripts/template-portfolio-qualification-lib.test.mjs',
    disposition: 'run',
    runner: { mechanism: 'verify-local-proof', gateId: 'template-portfolio-qualification-fixtures' },
  },
]);

function difference(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value)).sort();
}

function directoryEntryKind(entry) {
  if (entry.isSymbolicLink()) return 'symlink';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFIFO()) return 'FIFO';
  if (entry.isSocket()) return 'socket';
  if (entry.isBlockDevice()) return 'block device';
  if (entry.isCharacterDevice()) return 'character device';
  return 'non-regular entry';
}

function discoverScriptsTests(root) {
  const files = [];
  const errors = [];

  function walk(relativeDirectory) {
    const entries = readdirSync(resolve(root, relativeDirectory), { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        errors.push(`${relativePath}: scripts test inventory refuses symlinks`);
        continue;
      }
      if (entry.name.endsWith('.test.mjs')) {
        if (relativeDirectory !== 'scripts') {
          errors.push(
            `${relativePath}: nested scripts test files are outside the root scripts/*.test.mjs inventory scope`,
          );
        } else {
          if (!ROOT_SCRIPTS_TEST_PATTERN.test(relativePath)) {
            errors.push(
              `${relativePath}: scripts test inventory filenames must use only shell-safe letters, digits, dots, underscores, and hyphens`,
            );
          }
          if (!entry.isFile()) {
            errors.push(
              `${relativePath}: scripts test inventory requires a regular file, found ${directoryEntryKind(entry)}`,
            );
          } else {
            files.push(relativePath);
          }
        }
      }
      if (entry.isDirectory()) walk(relativePath);
    }
  }

  walk('scripts');
  return { files: files.sort(), errors: errors.sort() };
}

function nodeCommandRunsFile(command, file) {
  if (!ROOT_SCRIPTS_TEST_PATTERN.test(file)) return false;
  const words = command.trim().split(/\s+/u);
  if (words[0] !== 'node') return false;
  if (words.length === 2) {
    return ROOT_SCRIPTS_TEST_PATTERN.test(words[1]) && words[1] === file;
  }
  if (words[1] !== '--test') return false;

  const targets = words.slice(2);
  return targets.length > 0
    && targets.every((target) => ROOT_SCRIPTS_TEST_PATTERN.test(target))
    && targets.includes(file);
}

function commandRunsFile(calls, gateId, file) {
  return calls
    .filter((call) => call.gateId === gateId)
    .some((call) => nodeCommandRunsFile(call.command, file));
}

function validateRunEntry(entry, context, errors) {
  const runner = entry.runner;
  if (!runner || typeof runner !== 'object') {
    errors.push(`${entry.file}: run disposition requires runner metadata`);
    return;
  }

  if (runner.mechanism === 'verify-local-proof') {
    if (!context.gateIds.has(runner.gateId)) {
      errors.push(`${entry.file}: verify-local-proof gate ${runner.gateId ?? '(missing)'} does not exist`);
    } else {
      if (!context.classifiedGateIds.has(runner.gateId)) {
        errors.push(
          `${entry.file}: verify-local-proof gate ${runner.gateId} is not classified by the local-proof selection policy`,
        );
      }
      if (!commandRunsFile(context.calls, runner.gateId, entry.file)) {
        errors.push(`${entry.file}: verify-local-proof gate ${runner.gateId} does not run this file`);
      }
    }
    return;
  }

  if (runner.mechanism === 'package-inventory') {
    const inventory = context.packageInventories.find(({ id }) => id === runner.inventoryId);
    if (!inventory) {
      errors.push(`${entry.file}: package inventory ${runner.inventoryId ?? '(missing)'} does not exist`);
      return;
    }
    const resolvedFile = posix.normalize(posix.join(inventory.packageDir, runner.expectedFile ?? ''));
    if (resolvedFile !== entry.file || !inventory.expectedFiles.includes(runner.expectedFile)) {
      errors.push(`${entry.file}: package inventory ${runner.inventoryId} does not name this exact file`);
      return;
    }
    const audit = auditPackageInventory({ root: context.root, inventory });
    if (audit.undeclaredInScripts.includes(runner.expectedFile)) {
      errors.push(`${entry.file}: package inventory ${runner.inventoryId} does not execute this file`);
    }
    return;
  }

  if (runner.mechanism === 'cloudflare-suite') {
    const suite = context.cloudflareSuites.find(({ id }) => id === runner.suiteId);
    if (!suite || suite.file !== entry.file) {
      errors.push(`${entry.file}: Cloudflare suite ${runner.suiteId ?? '(missing)'} does not run this file`);
    }
    return;
  }

  if (runner.mechanism === 'drift-registry') {
    if (!context.selectionPolicy.driftProneGates?.[runner.gateId]) {
      errors.push(`${entry.file}: drift registry gate ${runner.gateId ?? '(missing)'} does not exist`);
    } else if (!context.gateIds.has(runner.gateId)
      || !commandRunsFile(context.calls, runner.gateId, entry.file)) {
      errors.push(`${entry.file}: drift registry gate ${runner.gateId} does not run this file`);
    }
    return;
  }

  errors.push(`${entry.file}: unknown runner mechanism ${runner.mechanism ?? '(missing)'}`);
}

function validateUnrunEntry(entry, root, errors) {
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    errors.push(`${entry.file}: unrun disposition requires a reason`);
  }
  if (typeof entry.ticket !== 'string'
    || !/^issues\/\d{8}-[a-z0-9-]+\.md$/u.test(entry.ticket)
    || !existsSync(resolve(root, entry.ticket))) {
    errors.push(`${entry.file}: unrun disposition requires an existing open issues/ burn-down ticket`);
  }
  if (entry.runner !== undefined) {
    errors.push(`${entry.file}: unrun disposition must not declare a runner`);
  }
}

export function auditScriptsTestInventory({
  root = ROOT,
  inventory = SCRIPTS_TEST_INVENTORY,
  proofSource = readFileSync(resolve(root, PROOF_PATH), 'utf8'),
  packageInventories = PACKAGE_TEST_INVENTORIES,
  cloudflareSuites = LOCAL_SUITES,
  selectionPolicy = JSON.parse(readFileSync(resolve(root, POLICY_PATH), 'utf8')),
} = {}) {
  const discovery = discoverScriptsTests(root);
  const discovered = discovery.files;
  const expected = inventory.map(({ file }) => file).sort();
  const calls = parseGateCalls(proofSource);
  const classifiedGateIds = new Set([
    ...(selectionPolicy.alwaysGates ?? []),
    ...Object.values(selectionPolicy.groups ?? {}).flatMap(({ gates = [] }) => gates),
  ]);
  const context = {
    root,
    calls,
    gateIds: new Set(calls.map(({ gateId }) => gateId)),
    classifiedGateIds,
    packageInventories,
    cloudflareSuites,
    selectionPolicy,
  };
  const errors = [...discovery.errors];

  if (new Set(expected).size !== expected.length) errors.push('inventory contains duplicate file entries');
  for (const entry of inventory) {
    if (!ROOT_SCRIPTS_TEST_PATTERN.test(entry.file ?? '')) {
      errors.push(`${entry.file ?? '(missing file)'}: inventory path must be a root scripts/*.test.mjs file`);
      continue;
    }
    if (entry.disposition === 'run') validateRunEntry(entry, context, errors);
    else if (entry.disposition === 'unrun') validateUnrunEntry(entry, root, errors);
    else errors.push(`${entry.file}: disposition must be run or unrun`);
  }

  return {
    count: discovered.length,
    runCount: inventory.filter(({ disposition }) => disposition === 'run').length,
    unrunCount: inventory.filter(({ disposition }) => disposition === 'unrun').length,
    files: discovered,
    unexpectedOnDisk: difference(discovered, expected),
    missingOnDisk: difference(expected, discovered),
    errors,
  };
}

export function scriptsTestInventoryDriftLines(audit) {
  const lines = [];
  if (audit.unexpectedOnDisk.length > 0) {
    lines.push(`unexpected on disk: ${audit.unexpectedOnDisk.join(', ')}`);
  }
  if (audit.missingOnDisk.length > 0) {
    lines.push(`registered but missing on disk: ${audit.missingOnDisk.join(', ')}`);
  }
  lines.push(...audit.errors);
  return lines;
}

export function checkScriptsTestInventory(options = {}) {
  const audit = auditScriptsTestInventory(options);
  const drift = scriptsTestInventoryDriftLines(audit);
  assert.equal(
    drift.length,
    0,
    `scripts test inventory failed:\n- ${drift.join('\n- ')}`,
  );
  return audit;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg === -1 ? ROOT : resolve(process.argv[rootArg + 1]);
  try {
    const result = checkScriptsTestInventory({ root });
    process.stdout.write(
      `[scripts-test-inventory] PASS: ${result.count} declared test files `
        + `(${result.runCount} run, ${result.unrunCount} unrun)\n`,
    );
  } catch (error) {
    process.stderr.write(`[scripts-test-inventory] FAIL\n${error.message}\n`);
    process.exitCode = 1;
  }
}
