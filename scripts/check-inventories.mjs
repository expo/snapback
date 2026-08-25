#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditPackageTestInventories } from './check-package-test-inventory.mjs';
import {
  auditScriptsTestInventory,
  scriptsTestInventoryDriftLines,
} from './check-scripts-test-inventory.mjs';
import { auditGuideManifestInventory } from './guide-lib.mjs';
import { auditDemoCatalog } from './demo-catalog.mjs';
import { auditDemoInventory } from '../tests/demo_setup_v0.mjs';
import { auditAgentSafePublicationLeafSet } from '../tests/agent_safe_publication_checker_v1.mjs';

// @ref LLP 0010#ci-and-review-gates — make the canonical exact inventories
// cheap enough to check before a push without executing their behavioral gates.
// @ref LLP 0162#source-owned-publication-carrier-amendment--2026-08-04 — the
// publication inventory is the reviewed qualification-C regular-leaf set.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pushList(lines, label, values) {
  if (values.length > 0) lines.push(`  ${label}: ${values.join(', ')}`);
}

function packageDriftLines(audit) {
  const lines = [];
  for (const result of audit.results) {
    pushList(lines, `${result.id} unexpected on disk`, result.unexpectedOnDisk);
    pushList(lines, `${result.id} registered but missing on disk`, result.missingOnDisk);
    pushList(lines, `${result.id} absent from package scripts`, result.undeclaredInScripts);
    pushList(
      lines,
      `${result.id} named by package scripts but missing on disk`,
      result.missingFromDiskButDeclared,
    );
  }
  if (audit.totalDrift !== 0) {
    lines.push(`  reviewed total: expected ${audit.expectedTotal}, found ${audit.total}`);
  }
  return lines;
}

export function runInventoryChecks({
  root = ROOT,
  packageOptions = {},
  scriptsTestOptions = {},
  demoOptions = {},
  demoCatalogOptions = {},
  publicationOptions = {},
  guideOptions = {},
} = {}) {
  const failures = [];
  const warnings = [];
  const counts = {};

  try {
    const audit = auditPackageTestInventories({ root, ...packageOptions });
    counts.packageTests = audit.total;
    const lines = packageDriftLines(audit);
    if (lines.length > 0) {
      failures.push({
        id: 'package-test',
        lines,
        registration:
          'name each maintained test in its package.json test command and matching expectedFiles entry, then update the reviewed total/changelog in scripts/check-package-test-inventory.mjs',
      });
    }
  } catch (error) {
    failures.push({
      id: 'package-test',
      lines: [`  ${error.message}`],
      registration:
        'repair the package test command and expectedFiles entry in scripts/check-package-test-inventory.mjs',
    });
  }

  try {
    const audit = auditScriptsTestInventory({ root, ...scriptsTestOptions });
    counts.scriptsTests = audit.count;
    const lines = scriptsTestInventoryDriftLines(audit).map((line) => `  ${line}`);
    if (lines.length > 0) {
      failures.push({
        id: 'scripts-test',
        lines,
        registration:
          'add each root scripts/*.test.mjs file to SCRIPTS_TEST_INVENTORY with a reality-checked runner, or an open ticket plus reason for an unrun disposition',
      });
    }
  } catch (error) {
    failures.push({
      id: 'scripts-test',
      lines: [`  ${error.message}`],
      registration:
        'repair scripts/check-scripts-test-inventory.mjs and its canonical proof runner joins',
    });
  }

  try {
    const audit = auditDemoInventory({ root, ...demoOptions });
    counts.demos = audit.discovered.length;
    if (audit.unexpected.length > 0 || audit.missing.length > 0) {
      const lines = [];
      pushList(lines, 'metadata-declared but unregistered', audit.unexpected);
      pushList(lines, 'registered but absent from demo.snapback.json metadata', audit.missing);
      failures.push({
        id: 'demo-materialization',
        lines,
        registration:
          'review the demo metadata, then add/remove its id in EXPECTED_DEMO_IDS in tests/demo_setup_v0.mjs',
      });
    }
  } catch (error) {
    failures.push({
      id: 'demo-materialization',
      lines: [`  ${error.message}`],
      registration:
        'repair demo.snapback.json metadata, then reconcile EXPECTED_DEMO_IDS in tests/demo_setup_v0.mjs',
    });
  }

  try {
    // @ref LLP 0015#acceptance-rules — each declared demo has one checked
    // selection/documentation contract and explicit nonclaim boundary.
    const audit = auditDemoCatalog({ root, ...demoCatalogOptions });
    counts.demoCatalog = audit.catalogCount;
    if (audit.errors.length > 0) {
      failures.push({
        id: 'demo-catalog',
        lines: audit.errors.map((error) => `  ${error}`),
        registration:
          'join the manifest, demos/catalog.v1.json, demos/README.md, local README/evidence, and capabilityGapsBoundary against guide/capabilities.md',
      });
    }
  } catch (error) {
    failures.push({
      id: 'demo-catalog',
      lines: [`  ${error.message}`],
      registration:
        'repair demos/catalog.v1.json and its manifest/README/capability joins',
    });
  }

  try {
    const audit = auditAgentSafePublicationLeafSet({ rootPath: root, ...publicationOptions });
    counts.publicationLeaves = audit.actual.size;
    if (audit.unexpected.length > 0 || audit.missing.length > 0) {
      const lines = [];
      pushList(lines, 'on disk but outside the qualification-C exact set', audit.unexpected);
      pushList(lines, 'reviewed at qualification C but missing on disk', audit.missing);
      failures.push({
        id: 'agent-safe-publication-leaf-set',
        lines,
        registration:
          'review/regenerate the publication outputs, then reconcile REVIEWED_GENERATED_PUBLICATION_PATHS in tests/agent_safe_publication_checker_v1.mjs at qualification C',
      });
    }
  } catch (error) {
    failures.push({
      id: 'agent-safe-publication-leaf-set',
      lines: [`  ${error.message}`],
      registration:
        'repair the generated-artifact registry/manifests before reconciling the qualification-C leaf set',
    });
  }

  try {
    const audit = auditGuideManifestInventory({
      root,
      readGeneratedFile: (path) => readFileSync(join(root, path), 'utf8'),
      ...guideOptions,
    });
    counts.guidePages = audit.pageCount;
    counts.guideSnippets = audit.snippetCount;
    warnings.push(...audit.warnings);
    if (audit.errors.length > 0 || audit.stale.length > 0) {
      const lines = audit.errors.map((error) => `  guide source error: ${error}`);
      pushList(lines, 'stale generated artifact', audit.stale);
      failures.push({
        id: 'guide-manifest',
        lines,
        registration:
          'fix any guide source errors, run node scripts/generate-guide-manifest.mjs, and commit both generated guide projections',
      });
    }
  } catch (error) {
    failures.push({
      id: 'guide-manifest',
      lines: [`  ${error.message}`],
      registration:
        'fix the guide corpus, then run node scripts/generate-guide-manifest.mjs and commit both generated guide projections',
    });
  }

  return { failures, warnings, counts };
}

export function printInventoryCheckResult(result, output = process) {
  for (const warning of result.warnings ?? []) {
    output.stdout.write(`[check-inventories] ${warning}\n`);
  }
  if (result.failures.length === 0) {
    output.stdout.write(
      `[check-inventories] PASS: ${result.counts.packageTests} package tests; `
        + `${result.counts.scriptsTests} scripts tests; `
        + `${result.counts.demos} demos/${result.counts.demoCatalog} catalog entries; `
        + `${result.counts.publicationLeaves} publication leaves; `
        + `${result.counts.guidePages} guide pages/${result.counts.guideSnippets} snippets\n`,
    );
    return 0;
  }
  for (const failure of result.failures) {
    output.stderr.write(`[check-inventories] FAIL ${failure.id}\n`);
    for (const line of failure.lines) output.stderr.write(`${line}\n`);
    output.stderr.write(`  registration step: ${failure.registration}\n`);
  }
  return 1;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg === -1 ? ROOT : resolve(process.argv[rootArg + 1]);
  process.exitCode = printInventoryCheckResult(runInventoryChecks({ root }));
}
