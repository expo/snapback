#!/usr/bin/env node

// @ref LLP 0284#41-kernel-raw-sql-api--privilege-surface-scanner — public
// privilege closure is derived from syn ASTs over the metadata feature matrix.

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GateInfrastructureError,
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
    finding.generatedExpression ?? '',
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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function rustCrateName(name) {
  return name.replaceAll('-', '_');
}

function manifestKey(path) {
  return realpathSync(path);
}

function withinRoot(root, path) {
  return path === root || path.startsWith(`${root}/`);
}

// @ref LLP 0284#41-kernel-raw-sql-api--privilege-surface-scanner — cargo
// metadata owns crate identity. Inspect excluded local bridge packages only
// when their dependency graph leads back to a workspace package; ordinary
// third-party path dependencies do not become independently audited members.
function localSymbolGraphPackages(root, workspace) {
  const byManifest = new Map(workspace.map((pkg) => [manifestKey(pkg.manifest_path), pkg]));
  const pending = [...workspace];
  for (let index = 0; index < pending.length; index += 1) {
    const pkg = pending[index];
    for (const dependency of pkg.dependencies) {
      if (!dependency.path || dependency.kind !== null) continue;
      const manifest = resolve(dependency.path, 'Cargo.toml');
      if (!existsSync(manifest)) continue;
      const key = manifestKey(manifest);
      if (!withinRoot(root, key) || byManifest.has(key)) continue;
      const metadata = runCargoMetadata(manifest);
      const candidate = metadata.packages.find((entry) =>
        manifestKey(entry.manifest_path) === key);
      if (!candidate || !libraryTarget(candidate)) continue;
      byManifest.set(key, candidate);
      pending.push(candidate);
    }
  }

  const selected = new Set(workspace.map(({ manifest_path: manifest }) => manifestKey(manifest)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [manifest, pkg] of byManifest) {
      if (selected.has(manifest)) continue;
      if (pkg.dependencies.some((dependency) => dependency.kind === null
        && dependency.path
        && existsSync(resolve(dependency.path, 'Cargo.toml'))
        && selected.has(manifestKey(resolve(dependency.path, 'Cargo.toml'))))) {
        selected.add(manifest);
        changed = true;
      }
    }
  }
  return [...byManifest]
    .filter(([manifest]) => selected.has(manifest))
    .map(([, pkg]) => pkg);
}

function parsePrivilegeCell(root, pkg, cell, externalSeeds = {}) {
  const lib = libraryTarget(pkg);
  const crateRoot = dirname(pkg.manifest_path);
  const args = [
    'privilege',
    '--crate-name', pkg.name,
    '--crate-root', crateRoot,
    '--lib', lib.src_path,
    '--features', cell.features.join(','),
  ];
  if (pkg.dependencies.some((dependency) => dependency.kind === null
    && rustCrateName(dependency.rename ?? dependency.name) === 'rusqlite')) {
    args.push('--raw-sql-substitution');
  }
  if (Object.keys(externalSeeds).length > 0) {
    args.push('--external-seeds', JSON.stringify(externalSeeds));
  }
  return runAst(args).map((finding) => ({
    ...finding,
    crate: pkg.name,
    file: repositoryPath(root, resolve(crateRoot, finding.file)),
  }));
}

function symbolRelativeItem(pkg, item) {
  const prefix = `${rustCrateName(pkg.name)}::`;
  return item.startsWith(prefix) ? item.slice(prefix.length) : undefined;
}

function dependencyPackages(pkg, packagesByManifest) {
  const dependencies = new Map();
  for (const dependency of pkg.dependencies) {
    if (dependency.kind !== null
      || !dependency.path
      || !existsSync(resolve(dependency.path, 'Cargo.toml'))) continue;
    const target = packagesByManifest.get(manifestKey(resolve(dependency.path, 'Cargo.toml')));
    if (!target) continue;
    dependencies.set(rustCrateName(dependency.rename ?? dependency.name), target);
  }
  return dependencies;
}

function scanPrivilegeGraph(root, graphPackages) {
  const packagesByManifest = new Map(graphPackages.map((pkg) => [
    manifestKey(pkg.manifest_path),
    pkg,
  ]));
  const scans = new Map();
  const visiting = new Set();

  const visit = (pkg) => {
    const packageKey = manifestKey(pkg.manifest_path);
    if ([...scans.keys()].some((key) => key.startsWith(`${packageKey}\0`))) return;
    if (visiting.has(packageKey)) {
      throw new GateInfrastructureError(`local Cargo dependency cycle reaches ${pkg.name}`);
    }
    visiting.add(packageKey);
    const dependencies = dependencyPackages(pkg, packagesByManifest);
    for (const dependency of dependencies.values()) visit(dependency);

    for (const cell of featureCells(pkg)) {
      const externalSeeds = {};
      for (const [dependencyKey, dependency] of dependencies) {
        const dependencyScan = scans.get(
          `${manifestKey(dependency.manifest_path)}\0${cell.label}`,
        );
        for (const finding of dependencyScan?.parsed ?? []) {
          if (finding.kind !== 'reexport' || !finding.seedType) continue;
          const relative = symbolRelativeItem(dependency, finding.item);
          if (relative) externalSeeds[`${dependencyKey}::${relative}`] = finding.seedType;
        }
      }
      scans.set(`${packageKey}\0${cell.label}`, {
        pkg,
        cell,
        parsed: parsePrivilegeCell(root, pkg, cell, externalSeeds),
      });
    }
    visiting.delete(packageKey);
  };

  for (const pkg of graphPackages) visit(pkg);
  return scans;
}

// @ref LLP 0284#37-what-is-not-an-invariant-honest-limits — generated Rust
// is review debt, not executable evidence. The review is pinned to Cargo's
// actual custom-build target so changing either the manifest target or its
// source forces a new review instead of silently preserving the exception.
function validateAllowlist(root, packages, findings, violations) {
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
    if (entry.kind === 'generated-api') {
      if (typeof entry.source !== 'string' || entry.source.includes('*')
          || !existsSync(resolve(root, entry.source ?? ''))) invalid.push('source');
      if (typeof entry.expression !== 'string' || entry.expression.length === 0) {
        invalid.push('expression');
      }
      const pkg = packages.find((candidate) => candidate.name === entry.crate);
      const producer = pkg?.targets.find((target) => target.kind.includes('custom-build'));
      if (!producer) {
        invalid.push('cargo metadata custom-build target missing');
      } else {
        const producerPath = repositoryPath(root, producer.src_path);
        if (entry.producer !== producerPath) invalid.push('producer is not Cargo custom-build target');
        if (typeof entry.producerSha256 !== 'string'
            || !/^[0-9a-f]{64}$/u.test(entry.producerSha256)) {
          invalid.push('producerSha256');
        } else if (entry.producerSha256 !== sha256(producer.src_path)) {
          invalid.push('producer source changed');
        }
      }
    }
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
      && (entry.kind !== 'generated-api' || (finding.file === entry.source
        && finding.generatedExpression === entry.expression))
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
  root = realpathSync(root);
  const started = process.hrtime.bigint();
  const metadata = runCargoMetadata(resolve(root, 'Cargo.toml'));
  const packages = workspacePackages(metadata).filter(libraryTarget);
  const graphPackages = localSymbolGraphPackages(root, packages);
  let registeredPrivilegeSinks;
  const declaredPrivilegeSinks = new Set();
  const aggregated = new Map();
  let cellCount = 0;

  registeredPrivilegeSinks = runAst(['privilege-sinks']);
  const graphScans = scanPrivilegeGraph(root, graphPackages);

  for (const pkg of packages) {
    for (const cell of featureCells(pkg)) {
      cellCount += 1;
      const cellKey = `${manifestKey(pkg.manifest_path)}\0${cell.label}`;
      const parsed = graphScans.get(cellKey).parsed;
      const obtainable = new Set(parsed
        .filter((finding) => ['seed-obtain', 'reexport'].includes(finding.kind))
        .map((finding) => finding.seedType)
        .filter(Boolean));
      for (const finding of parsed) {
        if (finding.kind === 'sink-registry-declared') {
          declaredPrivilegeSinks.add(finding.item.split('::').at(-1));
          continue;
        }
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
  // @ref LLP 0284#38-authority-discriminators — declaration liveness remains
  // a corpus-wide registry check, but it supplies no body-flow coverage. The
  // Rust pass binds every flowed terminal call at its own span and emits an
  // immediate unresolved-sink violation when that call is renamed.
  for (const sink of registeredPrivilegeSinks) {
    if (declaredPrivilegeSinks.has(sink)) continue;
    findings.push({
      crate: '<registry>',
      file: 'scripts/security-gates-rust/src/main.rs',
      line: 1,
      kind: 'sink-registry-unresolved',
      item: sink,
      detail: `registered privilege sink ${sink} does not resolve to an item in the scanned corpus`,
      features: ['all'],
    });
  }
  findings.sort((left, right) => left.file.localeCompare(right.file)
    || left.line - right.line
    || left.kind.localeCompare(right.kind)
    || left.item.localeCompare(right.item));

  const violations = [];
  const allowlisted = validateAllowlist(root, packages, findings, violations);
  const allowedKeys = new Set(allowlisted.map((entry) => [
    entry.crate,
    entry.item,
    entry.kind,
    JSON.stringify([...entry.features].sort()),
    entry.kind === 'generated-api' ? entry.source : '',
    entry.kind === 'generated-api' ? entry.expression : '',
  ].join('\0')));
  for (const finding of findings) {
    const key = [
      finding.crate,
      finding.item,
      finding.kind,
      JSON.stringify(finding.features),
      finding.kind === 'generated-api' ? finding.file : '',
      finding.kind === 'generated-api' ? finding.generatedExpression : '',
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
  process.stdout.write(
    'privilege-surface: this scanner is a ratchet, not a proof; residual evasions are documented in LLP 0284 §3.7\n',
  );
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
    `privilege-surface: ok (${result.allowlisted.length} allowlisted item(s); ${result.cellCount} feature cells; ${(result.durationMs / 1000).toFixed(2)}s)\n`,
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
