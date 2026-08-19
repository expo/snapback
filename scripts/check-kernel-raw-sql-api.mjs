#!/usr/bin/env node

// @ref LLP 0284#41-kernel-raw-sql-api--privilege-surface-scanner — public
// privilege closure is derived from syn ASTs over the metadata feature matrix.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  featureCells,
  libraryTarget,
  parseRootArgument,
  repositoryPath,
  runAst,
  runCargoMetadata,
  workspacePackages,
} from './security-gates-lib.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGNOSTIC = 'SNAPBACK_PRIVILEGE_SURFACE';
const ALLOWLIST_NAME = 'crates/privilege-surface-allowlist.v1.json';
const ALLOWLIST_KINDS = new Set([
  'sql-ingress',
  'sql-egress',
  'seed-obtain',
  'seed-clone',
  'reexport',
  'macro-export',
  'macro-generated-api',
  'generated-api',
  'caller-discriminant',
  'impl-trait-return',
]);

function findingKey(finding) {
  return [
    finding.crate,
    finding.file,
    finding.line,
    finding.kind,
    finding.item,
    finding.detail,
    finding.seedType ?? '',
  ].join('\0');
}

function activeLabels(labels) {
  if (labels.has('default')) return ['default'];
  const individual = [...labels].filter((label) => label !== 'all').sort();
  return individual.length > 0 ? individual : ['all'];
}

function calendarDateLosAngeles() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function validateAllowlist(root, findings, violations) {
  const path = resolve(root, ALLOWLIST_NAME);
  if (!existsSync(path)) return [];
  let document;
  try {
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    violations.push({
      crate: '<allowlist>',
      file: ALLOWLIST_NAME,
      line: 1,
      kind: 'allowlist-invalid',
      item: '<document>',
      detail: `invalid JSON: ${error.message}`,
      features: ['default'],
    });
    return [];
  }
  if (document.schemaVersion !== 'snapback.privilege-surface-allowlist.v1'
      || !Array.isArray(document.entries)) {
    violations.push({
      crate: '<allowlist>',
      file: ALLOWLIST_NAME,
      line: 1,
      kind: 'allowlist-invalid',
      item: '<document>',
      detail: 'schemaVersion or entries is invalid',
      features: ['default'],
    });
    return [];
  }
  const observed = new Set();
  const ids = new Set();
  const today = calendarDateLosAngeles();
  for (const entry of document.entries) {
    const invalid = [];
    if (typeof entry.id !== 'string' || !/^[a-z0-9-]+$/u.test(entry.id)) invalid.push('id');
    if (ids.has(entry.id)) invalid.push('duplicate id');
    ids.add(entry.id);
    if (!ALLOWLIST_KINDS.has(entry.kind)) invalid.push('kind');
    if (typeof entry.crate !== 'string') invalid.push('crate');
    if (typeof entry.item !== 'string' || entry.item.includes('*')) invalid.push('item');
    if (!Array.isArray(entry.features) || entry.features.length === 0) invalid.push('features');
    if (typeof entry.reason !== 'string' || entry.reason.length < 20) invalid.push('reason');
    if (typeof entry.ticket !== 'string' || !entry.ticket.startsWith('issues/')) invalid.push('ticket');
    if (typeof entry.expiresAt !== 'string' || entry.expiresAt < today) invalid.push('expiresAt');
    if (!existsSync(resolve(root, entry.ticket ?? ''))) invalid.push('ticket missing');
    const forbiddenLiveDefect = /claim_kernel_commit_authority|AuthorizationCommitCarrierFactory::(?:reservation|prepared)|service_authority_commit_interlock|rusqlite/u.test(entry.item)
      && ['sql-egress', 'seed-obtain', 'reexport'].includes(entry.kind);
    if (forbiddenLiveDefect) invalid.push('LLP 0283 F-1 live defect may not be allowlisted');
    if (invalid.length > 0) {
      violations.push({
        crate: entry.crate ?? '<allowlist>',
        file: ALLOWLIST_NAME,
        line: 1,
        kind: 'allowlist-invalid',
        item: entry.item ?? entry.id ?? '<entry>',
        detail: invalid.join(', '),
        features: entry.features ?? ['default'],
      });
      continue;
    }
    const match = findings.find((finding) => finding.crate === entry.crate
      && finding.item === entry.item
      && finding.kind === entry.kind
      && JSON.stringify(finding.features) === JSON.stringify([...entry.features].sort()));
    if (match) observed.add(entry.id);
  }
  for (const entry of document.entries) {
    if (!observed.has(entry.id)) {
      violations.push({
        crate: entry.crate,
        file: ALLOWLIST_NAME,
        line: 1,
        kind: 'allowlist-stale',
        item: entry.item,
        detail: `allowlist id ${entry.id} was not observed on this revision`,
        features: entry.features,
      });
    }
  }
  return document.entries.filter((entry) => observed.has(entry.id));
}

export function auditPrivilegeSurface(root = DEFAULT_ROOT) {
  const started = process.hrtime.bigint();
  const metadata = runCargoMetadata(resolve(root, 'Cargo.toml'));
  const packages = workspacePackages(metadata).filter(libraryTarget);
  const aggregated = new Map();
  let cellCount = 0;

  for (const pkg of packages) {
    const lib = libraryTarget(pkg);
    const crateRoot = dirname(pkg.manifest_path);
    for (const cell of featureCells(pkg)) {
      cellCount += 1;
      const parsed = runAst([
        'privilege',
        '--crate-name', pkg.name,
        '--crate-root', crateRoot,
        '--lib', lib.src_path,
        '--features', cell.features.join(','),
      ]).map((finding) => ({
        ...finding,
        crate: pkg.name,
        file: repositoryPath(root, resolve(crateRoot, finding.file)),
      }));
      const obtainable = new Set(parsed
        .filter((finding) => ['seed-obtain', 'reexport'].includes(finding.kind))
        .map((finding) => finding.seedType)
        .filter(Boolean));
      for (const finding of parsed) {
        if (finding.kind === 'seed-ingress-candidate') {
          if (!obtainable.has(finding.seedType)) continue;
          finding.kind = 'seed-obtain';
          finding.detail = `reachable privilege sink accepts obtainable ${finding.seedType}`;
        }
        const key = findingKey(finding);
        const current = aggregated.get(key) ?? { ...finding, labels: new Set() };
        current.labels.add(cell.label);
        aggregated.set(key, current);
      }
    }
  }

  const findings = [...aggregated.values()].map(({ labels, ...finding }) => ({
    ...finding,
    features: activeLabels(labels),
  }));
  findings.sort((left, right) => left.file.localeCompare(right.file)
    || left.line - right.line
    || left.kind.localeCompare(right.kind)
    || left.item.localeCompare(right.item));

  const violations = [];
  const allowlisted = validateAllowlist(root, findings, violations);
  const allowedKeys = new Set(allowlisted.map((entry) =>
    [entry.crate, entry.item, entry.kind, JSON.stringify([...entry.features].sort())].join('\0')));
  for (const finding of findings) {
    const key = [
      finding.crate,
      finding.item,
      finding.kind,
      JSON.stringify(finding.features),
    ].join('\0');
    if (!allowedKeys.has(key)) violations.push(finding);
  }
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    findings,
    violations,
    allowlisted,
    cellCount,
    durationMs,
    packages: packages.map(({ name }) => name),
  };
}

function printResult(result) {
  if (result.violations.length > 0) {
    process.stderr.write(`${DIAGNOSTIC}: ${result.violations.length} violation(s)\n`);
    for (const finding of result.violations) {
      process.stderr.write(
        `  ${finding.file}:${finding.line}: ${finding.kind} ${finding.detail} via ${finding.item} [${finding.features.join(',')}]\n`,
      );
    }
    process.stderr.write(
      `privilege-surface: scanned ${result.cellCount} feature cells in ${(result.durationMs / 1000).toFixed(2)}s\n`,
    );
    return 1;
  }
  process.stdout.write(
    `privilege-surface: ok (${result.allowlisted.length} allowlisted ingress item(s); ${result.cellCount} feature cells; ${(result.durationMs / 1000).toFixed(2)}s)\n`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = printResult(auditPrivilegeSurface(parseRootArgument()));
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: infrastructure failure\n${error.message}\n`);
    process.exitCode = 2;
  }
}
