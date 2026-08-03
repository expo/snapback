#!/usr/bin/env node

// Compose and reopen the retained LLP 0154 Phase-1 evidence. The receipt is
// bound to a clean measured source revision and the exact proof-source bytes.
// The retained receipt lands in a later carrier commit to avoid a commit-hash
// self-reference; validation requires the measured revision to be an ancestor,
// every source-closure path to be unchanged since it, and the receipt bytes to
// be tracked at current HEAD.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = trackedProofSourceFiles();

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'compose') {
    const benchmarkPath = requiredArg(args, '--benchmark');
    const idlePath = requiredArg(args, '--idle');
    const outputPath = requiredArg(args, '--output');
    const benchmark = readJson(benchmarkPath);
    const idle = readJson(idlePath);
    const receipt = {
      schemaVersion: 'snapback.telemetry-phase1-evidence.v1',
      createdAt: new Date().toISOString(),
      sourceRevision: benchmark.environment?.buildCommit ?? null,
      sourceInputs: digestSourceInputs(),
      benchmark,
      idle,
    };
    validateReceipt(receipt);
    writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
    validateReceipt(readJson(outputPath));
    process.stdout.write(`wrote ${outputPath}\n`);
  } else if (command === 'validate') {
    const receiptPath = args[0];
    if (!receiptPath || args.length !== 1) usage();
    const receipt = readJson(receiptPath);
    validateReceipt(receipt);
    validateRetainedCarrier(receiptPath);
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 'snapback.telemetry-phase1-evidence-validation.v1',
        valid: true,
        sourceRevision: receipt.sourceRevision,
        sourceDigest: receipt.sourceInputs.digest,
      })}\n`,
    );
  } else if (command === 'source-inputs') {
    if (args.length !== 0) usage();
    process.stdout.write(`${JSON.stringify(digestSourceInputs())}\n`);
  } else {
    usage();
  }
}

function validateReceipt(receipt) {
  assert(receipt.schemaVersion === 'snapback.telemetry-phase1-evidence.v1', 'receipt schema');
  assert(typeof receipt.createdAt === 'string' && !Number.isNaN(Date.parse(receipt.createdAt)), 'createdAt');
  const benchmark = receipt.benchmark;
  const idle = receipt.idle;
  assert(benchmark?.schemaVersion === 'snapback.telemetry-phase1-benchmark.v2', 'benchmark schema');
  assert(benchmark.environment?.profile === 'release', 'benchmark release profile');
  assert(benchmark.environment?.buildDirty === false, 'benchmark clean build');
  assertRevision(benchmark.environment?.buildCommit, 'benchmark revision');
  assert(receipt.sourceRevision === benchmark.environment.buildCommit, 'receipt/benchmark revision');
  assert(isAncestor(receipt.sourceRevision, currentRevision()), 'source revision is current HEAD ancestor');
  assert(sourceClosureUnchangedSince(receipt.sourceRevision), 'source closure unchanged since measured revision');
  const baseline = readJson(join(repoRoot, 'tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json'));
  assert(benchmark.method === baseline.method, 'benchmark method');
  const expectedCeilings = {
    revision: baseline.revision,
    methodDigest: baseline.methodDigest,
    baselineFile: 'tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json',
    proofProfile: 'full',
    ...baseline.profiles.full,
  };
  assert(
    canonicalJson(benchmark.ceilings) === canonicalJson(expectedCeilings),
    'entire benchmark ceiling profile equals committed baseline',
  );

  const amplification = benchmark.amplification;
  assert(amplification.httpApplicationQueries >= 800, 'HTTP sample count');
  assert(amplification.functionRows === amplification.httpApplicationQueries, 'function amplification');
  assert(amplification.httpRequestRows === amplification.httpApplicationQueries, 'carrier amplification');
  assert(amplification.totalCountedRows === amplification.httpApplicationQueries * 2, 'total amplification');
  assert(amplification.rowsPerRequest === 2, 'rows/request');
  assert(amplification.disabledCountedRows === 0, 'disabled HTTP rows');

  const worker = benchmark.eventArmedWorker;
  assert(worker.defaultBatchSize === 256, 'default worker batch');
  assert(worker.cycles >= 10, 'worker cycles');
  assert(worker.persistedRows === worker.offeredEvents, 'worker persistence');
  assert(worker.drops === 0, 'worker drops');
  const burst = benchmark.burstAndShed;
  assert(burst.droppedEvents > 0, 'burst shedding');
  assert(burst.reservedEventsRetained === burst.reservedCapacity, 'reserved burst slice');
  const cap = benchmark.fileCap;
  assert(cap.withinCap === true && cap.mainWalShmBytes <= cap.capBytes, 'physical cap');
  assert(cap.droppedEvents > 0, 'cap shedding');
  assert(cap.retainedReservedEvents === cap.offeredReservedEvents, 'cap reserved slice');

  assert(benchmark.flush.samples >= 20, 'flush samples');
  assert(benchmark.checkpoint.samples >= 20, 'checkpoint samples');
  assert(benchmark.sweep.rowsBefore >= 10_000 && benchmark.sweep.rowsAfter === 0, 'sweep workload');
  const queries = benchmark.queries;
  assert(queries.sourceRows >= 9_600, 'query source cardinality');
  assert(queries.hourlyRollupRows > 0 && queries.dailyRollupRows > 0, 'both rollup tiers');
  assert(queries.hourlyRollupRows + queries.dailyRollupRows === queries.sourceRows, 'rollup fixture accounting');
  assert(queries.rollupRowsScanned >= queries.sourceRows, 'actual rollup rows scanned');
  assert(queries.eventPage.samples >= 50 && queries.stats.samples >= 50, 'query samples');
  const app = benchmark.appLatency;
  assert(app.samplesEach >= 800, 'application samples');
  assert(app.workerFlushSentinelSample > 256 && app.workerFlushSentinelSample < app.samplesEach, 'application worker sentinel');
  assert(app.workerFlushedRowsAtSentinel >= 256, 'application worker flush at sentinel');
  assert(app.workerFlushedRowsBeforeFinalDrain >= app.workerFlushedRowsAtSentinel, 'application worker monotonicity');

  for (const [name, observed, ceiling] of [
    ['worker flush p95', worker.flushWait.p95Ms, expectedCeilings.workerFlushP95Ms],
    ['direct flush p95', benchmark.flush.p95Ms, expectedCeilings.directFlushP95Ms],
    ['checkpoint p95', benchmark.checkpoint.p95Ms, expectedCeilings.checkpointP95Ms],
    ['sweep', benchmark.sweep.latencyMs, expectedCeilings.sweepMs],
    ['event query p95', queries.eventPage.p95Ms, expectedCeilings.eventQueryP95Ms],
    ['stats query p95', queries.stats.p95Ms, expectedCeilings.statsQueryP95Ms],
    ['app query p95', app.telemetryOn.p95Ms, expectedCeilings.appQueryP95Ms],
    ['app p95 overhead', app.p95OverheadPercent, expectedCeilings.appP95OverheadPercent],
  ]) {
    assert(Number.isFinite(observed) && observed <= ceiling, `${name} ceiling`);
  }

  assert(idle?.schemaVersion === 'snapback.telemetry-phase1-idle.v2', 'idle schema');
  assert(idle.proofProfile === 'full', 'idle full profile');
  const idleIdentity = idle.build?.identity?.binary;
  assert(idle.build?.launch?.rung === 'configured', 'configured idle binary');
  assert(idle.build?.identity?.verdict === 'verified', 'verified idle identity verdict');
  assert(idleIdentity?.buildProfile === 'release' && idleIdentity?.gitDirty === false, 'idle release identity');
  assert(idleIdentity?.gitCommit === receipt.sourceRevision, 'idle/benchmark revision');
  assert(idle.settle?.terminalWithinBound === true, 'bounded settle');
  assert(idle.settle?.observedMutationCount > 0, 'nonvacuous settle');
  assert(idle.settle?.lifecycle?.watermark > 0, 'settle watermark');
  assert(idle.settle?.lifecycle?.processStartCount >= 1, 'process_start persisted');
  assert(idle.settle?.lifecycle?.processReadyCount >= 1, 'process_ready persisted');
  assert(idle.settle?.lifecycle?.processStartCount === idle.settle?.policy?.exactProcessStartCount, 'exact process_start settle');
  assert(idle.settle?.lifecycle?.processReadyCount === idle.settle?.policy?.exactProcessReadyCount, 'exact process_ready settle');
  assert(idle.settle?.lifecycle?.persistedEventBatches === 1, 'one event-bearing settle flush');
  assert(idle.settle?.lifecycle?.persistedEventBatches === idle.settle?.policy?.exactPersistedEventBatches, 'exact settle flush policy');
  assert(idle.settle?.lifecycle?.processStartFlushSequence === idle.settle?.lifecycle?.processReadyFlushSequence, 'lifecycle rows share settle transaction');
  assert(idle.settle?.lifecycle?.flushCommitSequence === idle.settle?.policy?.exactFlushCommitSequence, 'exact boot flush commit sequence');
  assert(idle.settle?.lifecycle?.processStartFlushSequence === idle.settle?.lifecycle?.flushCommitSequence, 'lifecycle rows belong to boot flush commit');
  assert(idle.settle?.lifecycle?.eventCount <= idle.settle?.policy?.maxPersistedEvents, 'bounded settle events');
  assert(idle.idle?.windowMs >= 120_000, 'idle window');
  assert(idle.idle?.storageMutationObservationCount === 0, 'idle storage mutations');
  assert(idle.idle?.startSnapshot?.digest === idle.idle?.endSnapshot?.digest, 'idle directory digest');
  assert(JSON.stringify(idle.idle?.startLifecycle) === JSON.stringify(idle.idle?.endLifecycle), 'idle lifecycle events');
  assert(idle.idle?.resources?.source === 'linux-procfs', 'idle procfs witness');
  assert(idle.idle?.resources?.writeBytesDelta === 0, 'idle process writes');
  assert(Number.isFinite(idle.idle?.resources?.userTicksDelta), 'idle CPU witness');
  assert(Number.isFinite(idle.idle?.resources?.rssPagesStart), 'idle RSS witness');
  assert(Number.isFinite(idle.idle?.resourceResolution?.clockTicksPerSecond), 'idle CPU resolution');
  assert(idle.idle?.resourceResolution?.cpuTickMilliseconds <= 10, 'idle CPU tick resolution');
  assert(Number.isFinite(idle.idle?.resourceResolution?.pageSizeBytes), 'idle page resolution');
  assert(idle.idle?.resourceCeilings?.cpuTimeMs === 100, 'idle CPU time ceiling baseline');
  assert(
    idle.idle?.resourceCeilings?.cpuTicksDelta === Math.ceil(
      idle.idle.resourceCeilings.cpuTimeMs
        / idle.idle.resourceResolution.cpuTickMilliseconds,
    ),
    'idle CPU tick ceiling derives from procfs clock resolution',
  );
  assert(idle.idle?.resourceCeilings?.rssGrowthPages === 8, 'idle RSS noise band');
  assert(idle.idle?.resources?.cpuTicksDelta <= idle.idle?.resourceCeilings?.cpuTicksDelta, 'idle CPU ceiling');
  assert(idle.idle?.resources?.rssGrowthPages <= idle.idle?.resourceCeilings?.rssGrowthPages, 'idle RSS ceiling');

  validateSourceInputs(receipt.sourceInputs);
}

function trackedProofSourceFiles() {
  const output = execFileSync('git', [
    'ls-files', '-z', '--',
    'Cargo.toml',
    'Cargo.lock',
    'build.rs',
    'src',
    'demos/_kit',
    'demos/todo/snapback',
    'packages/snapback-codegen',
    'packages/snapback-cli',
    'scripts/bootstrap-ibex-runtime',
    'scripts/ibex-runtime-common',
    'scripts/lib',
    'scripts/runtime-link-smoke.mjs',
    'scripts/telemetry-phase1-idle-proof.mjs',
    'scripts/telemetry-phase1-evidence.mjs',
    'scripts/telemetry-phase1-evidence.test.mjs',
    'scripts/verify-telemetry-phase1-proof',
    'scripts/verify-local-proof',
    'tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json',
  ], { cwd: repoRoot, encoding: 'utf8' });
  return output.split('\0').filter(Boolean).sort();
}

function currentRevision() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function sourceClosureUnchangedSince(revision) {
  try {
    execFileSync('git', ['diff', '--quiet', revision, 'HEAD', '--', ...sourceFiles], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function validateRetainedCarrier(path) {
  const absolute = resolve(path);
  const prefix = `${repoRoot}/`;
  assert(absolute.startsWith(prefix), 'receipt carrier is inside repository');
  const relativePath = absolute.slice(prefix.length);
  let committedBytes;
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relativePath], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    committedBytes = execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: repoRoot });
  } catch {
    assert(false, 'receipt carrier is tracked at current HEAD');
  }
  assert(
    Buffer.compare(readFileSync(absolute), committedBytes) === 0,
    'receipt carrier bytes equal current HEAD',
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digestSourceInputs(readSource = (file) => readFileSync(join(repoRoot, file))) {
  const hash = createHash('sha256');
  for (const file of sourceFiles) {
    const bytes = readSource(file);
    hash.update(`${file.length}:`);
    hash.update(file);
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
  return {
    algorithm: 'sha256-length-framed-v1',
    files: sourceFiles,
    digest: hash.digest('hex'),
  };
}

export function validateSourceInputs(sourceInputs, readSource = undefined) {
  const currentInputs = digestSourceInputs(readSource);
  assert(sourceInputs?.algorithm === 'sha256-length-framed-v1', 'input digest algorithm');
  assert(JSON.stringify(sourceInputs?.files) === JSON.stringify(sourceFiles), 'input file set');
  assert(sourceInputs?.digest === currentInputs.digest, 'proof-source digest freshness');
}

function readJson(path) {
  assert(existsSync(path), `missing JSON file ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requiredArg(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) usage();
  return args[index + 1];
}

function assertRevision(value, label) {
  assert(typeof value === 'string' && /^[0-9a-f]{40}$/.test(value), label);
}

function assert(condition, label) {
  if (!condition) throw new Error(`SNAPBACK_TELEMETRY_PHASE1_EVIDENCE_INVALID: ${label}`);
}

function usage() {
  throw new Error(
    'usage: telemetry-phase1-evidence.mjs compose --benchmark FILE --idle FILE --output FILE | validate RECEIPT | source-inputs',
  );
}
