#!/usr/bin/env node

// @ref LLP 0303#q-enumerate-the-effects-siblings-not-the-entry-points — the
// ledger executes complete producer-to-effect compositions, not symbol checks.
// @ref LLP 0284#42-security-boundaries--compile-fail-witnesses-with-span-assertions
// — compile-time CLOSED counts only when rustc's primary span hits @attack.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GateInfrastructureError,
  locationOverlaps,
  runAst,
} from './security-gates-lib.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGNOSTIC = 'SNAPBACK_ROW_ATTACK_CORPUS';
const OBSERVATION_PREFIX = 'SNAPBACK_ROW_ATTACK ';

function rootArgument() {
  const index = process.argv.indexOf('--root');
  if (index === -1) return DEFAULT_ROOT;
  if (!process.argv[index + 1]) throw new GateInfrastructureError('--root requires a path');
  return resolve(process.argv[index + 1]);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new GateInfrastructureError(`cannot read ${label} ${path}: ${error.message}`);
  }
}

export function loadRowAttackLedger(fixtureRoot) {
  const ledgerPath = resolve(fixtureRoot, 'attacks.v1.json');
  const ledger = readJson(ledgerPath, 'row-attack ledger');
  if (ledger.schemaVersion !== 'snapback.row-attacks.v1'
      || !Array.isArray(ledger.featureCells)
      || !Array.isArray(ledger.attacks)
      || typeof ledger.negativeRoutes !== 'object') {
    throw new GateInfrastructureError(`${ledgerPath} has an invalid schema`);
  }
  const cellIds = new Set();
  for (const cell of ledger.featureCells) {
    if (typeof cell.id !== 'string' || cellIds.has(cell.id) || !Array.isArray(cell.features)) {
      throw new GateInfrastructureError(`${ledgerPath} has an invalid or duplicate feature cell`);
    }
    cellIds.add(cell.id);
  }
  const rows = new Set();
  for (const attack of ledger.attacks) {
    if (!/^[CF]\d{3}$/u.test(attack.row) || rows.has(attack.row)
        || typeof attack.bin !== 'string' || typeof attack.source !== 'string'
        || !['OPEN', 'CLOSED'].includes(attack.expected)
        || typeof attack.note !== 'string'
        || (attack.expectedCode !== undefined
          && !/^E\d{4}$/u.test(attack.expectedCode))) {
      throw new GateInfrastructureError(`${ledgerPath} has an invalid or duplicate attack row`);
    }
    // An OPEN row asserts the attack COMPILES and reaches the effect, so no
    // compiler code describes it. Recording one anyway is not merely redundant:
    // if the witness later fails for a mechanical reason -- stale arity, a
    // renamed identifier, a dropped import -- and that failure happens to carry
    // the recorded code, the row is certified CLOSED by a defect in the test
    // rather than a change in the product. F145 reached exactly that state with
    // a recorded E0061 and an arity mismatch that produced E0061.
    if (attack.expected === 'OPEN' && attack.expectedCode !== undefined) {
      throw new GateInfrastructureError(
        `${ledgerPath}: row ${attack.row} is OPEN and must not record an expectedCode`,
      );
    }
    rows.add(attack.row);
  }
  if (ledger.attacks.length === 0 || ledger.featureCells.length === 0) {
    throw new GateInfrastructureError(`${ledgerPath} must declare attacks and feature cells`);
  }
  return ledger;
}

function runCargoMetadata(fixtureRoot) {
  const result = spawnSync('cargo', [
    'metadata', '--format-version', '1', '--offline', '--locked', '--no-deps',
    '--manifest-path', resolve(fixtureRoot, 'Cargo.toml'),
  ], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new GateInfrastructureError(
      `cargo metadata failed for row attacks\n${result.stderr || result.stdout}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new GateInfrastructureError(`cargo metadata returned invalid JSON: ${error.message}`);
  }
}

function sorted(values) {
  return [...values].sort();
}

function sameValues(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

export function validateRowAttackInventory(root, fixtureRoot, ledger) {
  const errors = [];
  const metadata = runCargoMetadata(fixtureRoot);
  const pkg = metadata.packages.find(({ name }) => name === 'snapback-row-attack-fixtures');
  if (!pkg) return ['cargo metadata did not return snapback-row-attack-fixtures'];
  const targets = new Map(pkg.targets
    .filter(({ kind }) => kind.includes('bin'))
    .map((target) => [target.name, target]));
  const declaredBins = new Set();
  for (const attack of ledger.attacks) {
    declaredBins.add(attack.bin);
    const target = targets.get(attack.bin);
    if (!target) {
      errors.push(`${attack.row} names missing bin ${attack.bin}`);
      continue;
    }
    const source = resolve(fixtureRoot, attack.source);
    try {
      if (realpathSync(target.src_path) !== realpathSync(source)) {
        errors.push(`${attack.row} source ${attack.source} is not bin ${attack.bin}`);
      }
      const contents = readFileSync(source, 'utf8');
      if (contents.match(/\/\/ @attack/gu)?.length !== 1) {
        errors.push(`${attack.row} source must contain exactly one // @attack marker`);
      }
      runAst(['attack-span', '--file', source]);
    } catch (error) {
      errors.push(`${attack.row} source is not a valid attack fixture: ${error.message}`);
    }
  }
  declaredBins.add(ledger.negativeRoutes.bin);
  const undeclaredBins = [...targets.keys()].filter((name) => !declaredBins.has(name));
  const missingBins = [...declaredBins].filter((name) => !targets.has(name));
  if (undeclaredBins.length > 0) {
    errors.push(`Cargo bin(s) absent from the ledger: ${sorted(undeclaredBins).join(', ')}`);
  }
  if (missingBins.length > 0) {
    errors.push(`ledger bin(s) absent from Cargo metadata: ${sorted(missingBins).join(', ')}`);
  }

  const dependencies = new Map(pkg.dependencies.map((dependency) => [dependency.name, dependency]));
  const snapbackDependencies = [
    'snapback-auth',
    'snapback-engine',
    'snapback-kernel',
    'snapback-sync',
    'snapback-types',
  ];
  for (const name of snapbackDependencies) {
    const dependency = dependencies.get(name);
    if (!dependency) errors.push(`fixture is missing dependency ${name}`);
    else if (dependency.uses_default_features) errors.push(`${name} must disable default features`);
  }
  const engine = dependencies.get('snapback-engine');
  if (engine && !sameValues(engine.features, ['engine-owner'])) {
    errors.push('snapback-engine must enable exactly the required engine-owner feature');
  }
  if (!sameValues(pkg.features.default ?? [], [])) {
    errors.push('fixture default feature set must be empty');
  }
  const requiredAdditive = snapbackDependencies.map((name) => `${name}/test-support`);
  if (!sameValues(pkg.features.additive ?? [], requiredAdditive)) {
    errors.push('additive must unify test-support across auth, engine, kernel, sync, and types');
  }
  const production = ledger.featureCells.find(({ id }) => id === 'production');
  const additive = ledger.featureCells.find(({ id }) => id === 'additive-test-support');
  if (!production || !sameValues(production.features, [])) {
    errors.push('ledger must declare the empty production feature cell');
  }
  if (!additive || !sameValues(additive.features, ['additive'])) {
    errors.push('ledger must declare the additive-test-support feature cell');
  }

  // Existing compile-fail fixtures may opt into this row ledger by declaring
  // row/rows. Once they do, omission here is an inventory error rather than a
  // silently dropped already-proven attack.
  const securityPath = resolve(root, 'tests/fixtures/security-boundaries/attacks.v1.json');
  if (existsSync(securityPath)) {
    const security = readJson(securityPath, 'security-boundary ledger');
    const securityRows = new Set((security.attacks ?? []).flatMap((attack) => [
      ...(typeof attack.row === 'string' ? [attack.row] : []),
      ...(Array.isArray(attack.rows) ? attack.rows : []),
    ]));
    const corpusRows = new Set(ledger.attacks.map(({ row }) => row));
    for (const row of securityRows) {
      if (!corpusRows.has(row)) errors.push(`security-boundary row ${row} is absent from row attacks`);
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
    messages.push({
      code: record.message.code?.code ?? null,
      message: record.message.message,
      rendered: record.message.rendered ?? record.message.message,
      spans: (record.message.spans ?? []).map((span) => {
        let canonical = resolve(fixtureRoot, span.file_name);
        try {
          canonical = realpathSync(canonical);
        } catch {
          // A missing/generated span cannot equal a checked-in attack source.
        }
        return { ...span, canonical };
      }),
    });
  }
  return messages;
}

function cargoArgs(fixtureRoot, bin, cell, subcommand, messageFormat = false) {
  const args = [
    subcommand,
    '--offline',
    '--locked',
    '--manifest-path', resolve(fixtureRoot, 'Cargo.toml'),
    '--no-default-features',
    '--bin', bin,
  ];
  if (messageFormat) args.push('--message-format=json');
  if (cell.features.length > 0) args.push('--features', cell.features.join(','));
  return args;
}

function spawnCargo(fixtureRoot, targetDir, args) {
  return spawnSync('cargo', args, {
    cwd: fixtureRoot,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

export function parseRuntimeObservation(stdout, row) {
  const lines = stdout.split('\n').filter((line) => line.startsWith(OBSERVATION_PREFIX));
  if (lines.length !== 1) {
    return { observed: 'ERROR', diagnostic: `expected one ${OBSERVATION_PREFIX.trim()} line, saw ${lines.length}` };
  }
  let observation;
  try {
    observation = JSON.parse(lines[0].slice(OBSERVATION_PREFIX.length));
  } catch (error) {
    return { observed: 'ERROR', diagnostic: `invalid observation JSON: ${error.message}` };
  }
  if (observation.row !== row || !['OPEN', 'CLOSED'].includes(observation.observed)
      || typeof observation.diagnostic !== 'string') {
    return { observed: 'ERROR', diagnostic: 'runtime observation has the wrong row or shape' };
  }
  return observation;
}

function compileObservation({ fixtureRoot, targetDir, attack, cell }) {
  const result = spawnCargo(
    fixtureRoot,
    targetDir,
    cargoArgs(fixtureRoot, attack.bin, cell, 'check', true),
  );
  if (result.error || result.status === null) {
    throw new GateInfrastructureError(
      `cargo did not execute ${attack.row}/${cell.id}: ${result.error?.message ?? 'no exit status'}`,
    );
  }
  if (result.status === 0) return null;
  const messages = parseCompilerMessages(`${result.stdout}\n${result.stderr}`, fixtureRoot);
  if (messages.length === 0) {
    throw new GateInfrastructureError(
      `cargo failed ${attack.row}/${cell.id} without a rustc error\n${result.stderr || result.stdout}`,
    );
  }
  const source = realpathSync(resolve(fixtureRoot, attack.source));
  const attackSpan = runAst(['attack-span', '--file', source]);
  const hits = messages.flatMap((message) => message.spans
    .filter((span) => span.is_primary && span.canonical === source
      && locationOverlaps(span, attackSpan))
    .map((span) => ({ message, span })));
  if (hits.length === 0) {
    const nearby = messages.slice(0, 3).map(({ rendered }) => rendered.trim()).join('\n');
    return {
      observed: 'ERROR',
      diagnostic: `compile failed away from @attack; the fixture needs maintenance\n${nearby}`,
    };
  }
  const selected = attack.expectedCode === undefined
    ? hits[0]
    : hits.find(({ message }) => message.code === attack.expectedCode);
  if (!selected) {
    return {
      observed: 'ERROR',
      diagnostic: `compile failed at @attack, but expected ${attack.expectedCode}; saw ${sorted(new Set(hits.map(({ message }) => message.code ?? 'unclassified'))).join(', ')}`,
    };
  }
  const { message, span } = selected;
  return {
    observed: 'CLOSED',
    diagnostic: `${message.code ?? 'rustc error'} at ${relative(fixtureRoot, source)}:${span.line_start}:${span.column_start}: ${message.message}`,
  };
}

export function observeAttack({ fixtureRoot, targetDir, attack, cell }) {
  const compileClosed = compileObservation({ fixtureRoot, targetDir, attack, cell });
  if (compileClosed) return compileClosed;
  const result = spawnCargo(
    fixtureRoot,
    targetDir,
    cargoArgs(fixtureRoot, attack.bin, cell, 'run'),
  );
  if (result.error || result.status === null) {
    throw new GateInfrastructureError(
      `cargo did not run ${attack.row}/${cell.id}: ${result.error?.message ?? 'no exit status'}`,
    );
  }
  if (result.status !== 0) {
    return {
      observed: 'ERROR',
      diagnostic: `attack executable failed before reporting an observation\n${result.stderr || result.stdout}`,
    };
  }
  return parseRuntimeObservation(result.stdout, attack.row);
}

function observeNegativeRoutes({ fixtureRoot, targetDir, ledger, cell }) {
  const result = spawnCargo(
    fixtureRoot,
    targetDir,
    cargoArgs(fixtureRoot, ledger.negativeRoutes.bin, cell, 'check', true),
  );
  if (result.error || result.status === null) {
    throw new GateInfrastructureError(`cargo did not execute negative routes for ${cell.id}`);
  }
  if (result.status === 0) {
    return { passed: false, diagnostic: 'one or more absent carrier routes compiled' };
  }
  const messages = parseCompilerMessages(`${result.stdout}\n${result.stderr}`, fixtureRoot);
  if (messages.length === 0) {
    throw new GateInfrastructureError(
      `negative routes failed without rustc errors in ${cell.id}\n${result.stderr || result.stdout}`,
    );
  }
  const source = realpathSync(resolve(fixtureRoot, ledger.negativeRoutes.source));
  const primarySpans = new Set();
  let outsideSource = false;
  for (const message of messages) {
    const primary = message.spans.filter(({ is_primary }) => is_primary);
    if (primary.some(({ canonical }) => canonical !== source)) outsideSource = true;
    for (const span of primary.filter(({ canonical }) => canonical === source)) {
      primarySpans.add(`${span.line_start}:${span.column_start}:${span.line_end}:${span.column_end}`);
    }
  }
  const expected = ledger.negativeRoutes.expectedExpressions;
  if (outsideSource || primarySpans.size !== expected) {
    return {
      passed: false,
      diagnostic: `expected ${expected} refused expressions in the negative-route source; saw ${primarySpans.size}${outsideSource ? ' plus an error outside the source' : ''}`,
    };
  }
  return { passed: true, diagnostic: `${expected}/${expected} carrier routes refused at their expressions` };
}

export function classifyExpectation(expected, observed) {
  if (observed === 'ERROR') return 'HARNESS ERROR';
  if (expected === observed) return 'MATCH';
  if (expected === 'CLOSED' && observed === 'OPEN') return 'REGRESSION / FALSE CLOSURE';
  return 'NEWLY CLOSED';
}

function table(rows) {
  const headers = ['ROW', 'CELL', 'EXPECTED', 'OBSERVED', 'STATUS'];
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => row[index].length),
  ));
  const render = (row) => row.map((value, index) => value.padEnd(widths[index])).join(' | ');
  return [
    render(headers),
    widths.map((width) => '-'.repeat(width)).join('-|-'),
    ...rows.map(render),
  ].join('\n');
}

function ensureRuntime(root) {
  const ibexManifest = resolve(root, 'vendor/ibex/Cargo.toml');
  const platformArtifact = process.platform === 'linux'
    ? resolve(root, 'vendor/ibex/linux/lib/libhermesvm.so')
    : process.platform === 'darwin'
      ? resolve(root, 'vendor/ibex/ios/Frameworks/hermesvm.framework')
      : ibexManifest;
  if (existsSync(ibexManifest) && existsSync(platformArtifact)) return;
  const bootstrap = spawnSync(resolve(root, 'scripts/bootstrap-ibex-runtime'), [], {
    cwd: root,
    stdio: 'inherit',
  });
  if (bootstrap.status !== 0) {
    throw new GateInfrastructureError('scripts/bootstrap-ibex-runtime failed');
  }
}

export function runCorpus(root = DEFAULT_ROOT) {
  const fixtureRoot = resolve(root, 'tests/fixtures/row-attacks');
  const targetDir = resolve(root, 'target/row-attacks');
  ensureRuntime(root);
  const ledger = loadRowAttackLedger(fixtureRoot);
  const inventoryErrors = validateRowAttackInventory(root, fixtureRoot, ledger);
  if (inventoryErrors.length > 0) return { ledger, inventoryErrors, observations: [], negative: [] };
  const observations = [];
  for (const attack of ledger.attacks) {
    for (const cell of ledger.featureCells) {
      const observation = observeAttack({ fixtureRoot, targetDir, attack, cell });
      observations.push({
        ...attack,
        cell: cell.id,
        ...observation,
        status: classifyExpectation(attack.expected, observation.observed),
      });
    }
  }
  const negative = ledger.featureCells.map((cell) => ({
    cell: cell.id,
    ...observeNegativeRoutes({ fixtureRoot, targetDir, ledger, cell }),
  }));
  return { ledger, inventoryErrors, observations, negative };
}

function printCorpus(result) {
  for (const error of result.inventoryErrors) {
    process.stderr.write(`${DIAGNOSTIC}: inventory: ${error}\n`);
  }
  if (result.observations.length > 0) {
    process.stdout.write(`${table(result.observations.map((observation) => [
      observation.row,
      observation.cell,
      observation.expected,
      observation.observed,
      observation.status,
    ]))}\n`);
  }
  for (const observation of result.observations.filter(({ status }) => status !== 'MATCH')) {
    const message = observation.status === 'REGRESSION / FALSE CLOSURE'
      ? 'expected CLOSED, observed OPEN — regression or closure claim was never true'
      : observation.status === 'NEWLY CLOSED'
        ? 'expected OPEN, observed CLOSED — good news: another lane closed this row'
        : 'the row could not be classified because the fixture failed away from @attack';
    process.stderr.write(`\n${observation.row}/${observation.cell}: ${message}\n${observation.diagnostic}\n`);
  }
  for (const route of result.negative) {
    const stream = route.passed ? process.stdout : process.stderr;
    stream.write(`[row-attacks] ${route.passed ? 'PASS' : 'FAIL'} negative-routes/${route.cell}: ${route.diagnostic}\n`);
  }
  const mismatches = result.observations.filter(({ status }) => status !== 'MATCH').length;
  const negativeFailures = result.negative.filter(({ passed }) => !passed).length;
  const failures = result.inventoryErrors.length + mismatches + negativeFailures;
  const summary = `[row-attacks] ${failures === 0 ? 'PASS' : 'MISMATCH'}: ${result.ledger.attacks.length} row(s), ${result.ledger.featureCells.length} feature cell(s), ${mismatches} ledger mismatch(es), ${result.inventoryErrors.length + negativeFailures} corpus error(s)\n`;
  (failures === 0 ? process.stdout : process.stderr).write(summary);
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = printCorpus(runCorpus(rootArgument()));
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: infrastructure failure\n${error.message}\n`);
    process.exitCode = 2;
  }
}
