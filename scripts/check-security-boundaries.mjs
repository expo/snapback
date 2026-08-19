#!/usr/bin/env node

// @ref LLP 0284#42-security-boundaries--compile-fail-witnesses-with-span-assertions
// — rustc JSON must place a primary error span on the syn-located @attack.

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPrivilegeSurface } from './check-kernel-raw-sql-api.mjs';
import {
  GateInfrastructureError,
  locationOverlaps,
  runAst,
  runCargoMetadata,
  workspacePackages,
} from './security-gates-lib.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FIXTURE_ROOT = resolve(DEFAULT_ROOT, 'tests/fixtures/security-boundaries');
const TARGET = resolve(DEFAULT_ROOT, 'target/security-boundary-fixtures');
const DIAGNOSTIC = 'SNAPBACK_SECURITY_BOUNDARY';

function sorted(values) {
  return [...new Set(values)].sort();
}

function setDifference(left, right) {
  const rightSet = new Set(right);
  return sorted(left.filter((value) => !rightSet.has(value)));
}

export function loadAttacks(fixtureRoot = DEFAULT_FIXTURE_ROOT) {
  const path = resolve(fixtureRoot, 'attacks.v1.json');
  let document;
  try {
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new GateInfrastructureError(`cannot read attack inventory ${path}: ${error.message}`);
  }
  if (document.schemaVersion !== 'snapback.security-boundary-attacks.v1'
      || !Array.isArray(document.attacks)) {
    throw new GateInfrastructureError(`${path} has an invalid schema`);
  }
  const ids = new Set();
  for (const attack of document.attacks) {
    if (typeof attack.id !== 'string' || ids.has(attack.id)) {
      throw new GateInfrastructureError(`${path} has an invalid or duplicate attack id`);
    }
    ids.add(attack.id);
    if (typeof attack.bin !== 'string' || typeof attack.source !== 'string'
        || typeof attack.mount !== 'string' || !Array.isArray(attack.featureSets)
        || attack.featureSets.length === 0) {
      throw new GateInfrastructureError(`${path} attack ${attack.id} is incomplete`);
    }
  }
  return document.attacks;
}

// @ref LLP 0284#36-inventory-honesty — each claimed mount is joined to cargo
// metadata dependency keys, its actual bin source, and parsed crate references;
// descriptive or source-swapped supersets fail.
export function validateFixtureInventory(
  root,
  fixtureRoot,
  attacks,
  privilegeFindings = auditPrivilegeSurface(root).findings,
) {
  const product = runCargoMetadata(resolve(root, 'Cargo.toml'));
  const productNames = new Set(workspacePackages(product).map(({ name }) => name));
  const fixture = runCargoMetadata(resolve(fixtureRoot, 'Cargo.toml'));
  const fixturePackage = fixture.packages.find((pkg) => pkg.name === 'snapback-security-boundary-fixtures');
  if (!fixturePackage) {
    return ['cargo metadata did not return snapback-security-boundary-fixtures'];
  }
  const productDependencies = fixturePackage.dependencies
    .filter((dependency) => productNames.has(dependency.name));
  const dependencyKeys = sorted(productDependencies.map(({ name }) => name));
  const dependencyReference = new Map(productDependencies.map((dependency) => [
    dependency.name,
    (dependency.rename ?? dependency.name).replaceAll('-', '_'),
  ]));
  const privilegeCrates = sorted(privilegeFindings
    .map((finding) => finding.crate)
    .filter((name) => productNames.has(name)));
  const mounts = sorted(attacks.map(({ mount }) => mount));
  const errors = [];
  const missingDependencies = setDifference(mounts, dependencyKeys);
  if (missingDependencies.length > 0) {
    errors.push(`claimed mount(s) absent from cargo metadata dependencies: ${missingDependencies.join(', ')}`);
  }
  const missingPrivilegeCrates = setDifference(privilegeCrates, dependencyKeys);
  const emptyPrivilegeCrates = setDifference(dependencyKeys, privilegeCrates);
  const unmountedDependencies = setDifference(dependencyKeys, mounts);
  const unmountedPrivilegeCrates = setDifference(privilegeCrates, mounts);
  if (missingPrivilegeCrates.length > 0) {
    errors.push(`privilege-bearing workspace crate(s) absent from fixture dependencies: ${missingPrivilegeCrates.join(', ')}`);
  }
  if (emptyPrivilegeCrates.length > 0) {
    errors.push(`fixture dependency crate(s) have scanner-certified empty privilege surface: ${emptyPrivilegeCrates.join(', ')}`);
  }
  if (unmountedDependencies.length > 0) {
    errors.push(`fixture dependency crate(s) have no attack mounts: ${unmountedDependencies.join(', ')}`);
  }
  if (unmountedPrivilegeCrates.length > 0) {
    errors.push(`privilege-bearing workspace crate(s) have no attack mounts: ${unmountedPrivilegeCrates.join(', ')}`);
  }
  const bins = new Map(fixturePackage.targets
    .filter((target) => target.kind.includes('bin'))
    .map((target) => [target.name, target]));
  for (const attack of attacks) {
    if (!productNames.has(attack.mount)) errors.push(`${attack.id} names non-member mount ${attack.mount}`);
    const bin = bins.get(attack.bin);
    if (!bin) {
      errors.push(`${attack.id} names missing bin ${attack.bin}`);
      continue;
    }
    const source = resolve(fixtureRoot, attack.source);
    let canonicalSource;
    try {
      canonicalSource = realpathSync(source);
    } catch (error) {
      errors.push(`${attack.id} names unreadable source ${attack.source}: ${error.message}`);
      continue;
    }
    if (realpathSync(bin.src_path) !== canonicalSource) {
      errors.push(`${attack.id} source ${attack.source} is not the source of bin ${attack.bin}`);
    }
    const expectedReference = dependencyReference.get(attack.mount);
    if (expectedReference) {
      const references = new Set(runAst(['crate-references', '--file', canonicalSource]));
      if (!references.has(expectedReference)) {
        errors.push(
          `${attack.id} source does not reference claimed mount ${attack.mount} as crate ${expectedReference}`,
        );
      }
    }
  }
  return errors;
}

function parseCompilerMessages(output, fixtureRoot) {
  const messages = [];
  for (const line of output.split('\n')) {
    if (!line.startsWith('{')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.reason !== 'compiler-message' || record.message?.level !== 'error') continue;
    const spans = (record.message.spans ?? []).map((span) => {
      const absolute = resolve(fixtureRoot, span.file_name);
      let canonical = absolute;
      try {
        canonical = realpathSync(absolute);
      } catch {
        // A generated/missing span can never equal the real fixture source.
      }
      return { ...span, canonical };
    });
    messages.push({
      code: record.message.code?.code ?? null,
      rendered: record.message.rendered ?? record.message.message,
      message: record.message.message,
      spans,
    });
  }
  return messages;
}

export function runAttack({
  attack,
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  targetDir = TARGET,
  spawnCargo = spawnSync,
}) {
  const source = resolve(fixtureRoot, attack.source);
  const canonicalSource = realpathSync(source);
  const attackSpan = runAst(['attack-span', '--file', source]);
  const outcomes = [];
  for (const features of attack.featureSets) {
    const args = [
      'check',
      '--offline',
      '--locked',
      '--manifest-path', resolve(fixtureRoot, 'Cargo.toml'),
      '--message-format=json',
      '--bin', attack.bin,
    ];
    if (features.length > 0) args.push('--features', features.join(','));
    const result = spawnCargo('cargo', args, {
      cwd: fixtureRoot,
      env: { ...process.env, CARGO_TARGET_DIR: targetDir },
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    if (result.error || result.status === null) {
      throw new GateInfrastructureError(
        `cargo did not execute ${attack.id}: ${result.error?.message ?? 'no exit status'}`,
      );
    }
    const featureLabel = `[${features.join(',')}]`;
    if (result.status === 0) {
      outcomes.push({
        passed: false,
        line: `[security-boundary] RED ${attack.id}: attack compiled under features ${featureLabel}`,
        diagnostics: [],
      });
      continue;
    }
    const messages = parseCompilerMessages(`${result.stdout}\n${result.stderr}`, fixtureRoot);
    if (messages.length === 0) {
      throw new GateInfrastructureError(
        `cargo failed ${attack.id} without a rustc compiler-message error under features ${featureLabel}\n${result.stderr || result.stdout}`,
      );
    }
    const hits = [];
    for (const message of messages) {
      for (const span of message.spans) {
        if (span.is_primary && span.canonical === canonicalSource && locationOverlaps(span, attackSpan)) {
          hits.push({ message, span });
        }
      }
    }
    const expectedHits = attack.expectedCode
      ? hits.filter(({ message }) => message.code === attack.expectedCode)
      : hits;
    if (expectedHits.length === 0) {
      const reason = hits.length > 0
        ? `@attack primary span had ${sorted(hits.map(({ message }) => message.code ?? 'uncoded')).join(', ')}, expected ${attack.expectedCode}`
        : 'no primary span overlapped @attack (unrelated diagnostic would have satisfied a message regex)';
      outcomes.push({
        passed: false,
        line: `[security-boundary] RED ${attack.id}: ${reason} under features ${featureLabel}`,
        diagnostics: messages.slice(0, 3).map(({ rendered }) => rendered.trim()),
      });
      continue;
    }
    const { message, span } = expectedHits[0];
    outcomes.push({
      passed: true,
      line: `[security-boundary] PASS ${attack.id}: ${message.code ?? 'error'} at ${relative(fixtureRoot, canonicalSource)}:${span.line_start}:${span.column_start} under features ${featureLabel}`,
      diagnostics: [],
    });
  }
  return outcomes;
}

function validateSeedWitnessCoverage(privilegeFindings, attacks) {
  const obtainable = sorted(privilegeFindings
    .filter((finding) => ['seed-obtain', 'caller-discriminant'].includes(finding.kind)
      && finding.seedType)
    .map(({ seedType }) => seedType));
  const witnessed = sorted(attacks.flatMap(({ seedTypes = [] }) => seedTypes));
  return setDifference(obtainable, witnessed)
    .map((seed) => `publicly obtainable seed type has no attack witness: ${seed}`);
}

export function auditSecurityBoundaries(
  root = DEFAULT_ROOT,
  fixtureRoot = resolve(root, 'tests/fixtures/security-boundaries'),
) {
  const started = process.hrtime.bigint();
  const attacks = loadAttacks(fixtureRoot);
  const privilegeScan = auditPrivilegeSurface(root);
  const inventoryErrors = [
    ...validateFixtureInventory(root, fixtureRoot, attacks, privilegeScan.findings),
    ...validateSeedWitnessCoverage(privilegeScan.findings, attacks),
  ];
  const outcomes = attacks.flatMap((attack) => runAttack({ attack, fixtureRoot }));
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return { attacks, inventoryErrors, outcomes, durationMs };
}

function printResult(result) {
  for (const error of result.inventoryErrors) {
    process.stderr.write(`[security-boundary] RED inventory: ${error}\n`);
  }
  for (const outcome of result.outcomes) {
    const stream = outcome.passed ? process.stdout : process.stderr;
    stream.write(`${outcome.line}\n`);
    for (const diagnostic of outcome.diagnostics) {
      stream.write(`  ${diagnostic.replaceAll('\n', '\n  ')}\n`);
    }
  }
  const redCount = result.inventoryErrors.length
    + result.outcomes.filter(({ passed }) => !passed).length;
  const passCount = result.outcomes.filter(({ passed }) => passed).length;
  if (redCount > 0) {
    process.stderr.write(`${DIAGNOSTIC}: ${redCount} fixture or inventory violation(s)\n`);
  }
  const summary = `[security-boundary] ${redCount > 0 ? 'RED' : 'PASS'}: ${passCount} attack-span rejection(s), ${redCount} failure(s), ${result.attacks.length} inventoried attack(s); ${(result.durationMs / 1000).toFixed(2)}s\n`;
  (redCount > 0 ? process.stderr : process.stdout).write(summary);
  return redCount > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = printResult(auditSecurityBoundaries());
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: infrastructure failure\n${error.message}\n`);
    process.exitCode = 2;
  }
}
