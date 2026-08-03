#!/usr/bin/env node

// Compose and reopen the retained LLP 0154 Phase-1 evidence. The receipt is
// bound to the exact proof-source bytes, so later benchmark/idle changes make
// the ordinary `validate` mode fail until a full clean-release rerun replaces
// the evidence.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = [
  'Cargo.toml',
  'Cargo.lock',
  'demos/_kit/server-process.mjs',
  'scripts/telemetry-phase1-idle-proof.mjs',
  'scripts/telemetry-phase1-evidence.mjs',
  'scripts/verify-telemetry-phase1-proof',
  'scripts/verify-local-proof',
  'src/bench.rs',
  'src/bin/snapback-telemetry-bench.rs',
  'src/telemetry.rs',
  'src/telemetry_bench.rs',
  'tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json',
];

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
  process.stdout.write(`wrote ${outputPath}\n`);
} else if (command === 'validate') {
  const receiptPath = args[0];
  if (!receiptPath || args.length !== 1) usage();
  const receipt = readJson(receiptPath);
  validateReceipt(receipt);
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 'snapback.telemetry-phase1-evidence-validation.v1',
      valid: true,
      sourceRevision: receipt.sourceRevision,
      sourceDigest: receipt.sourceInputs.digest,
    })}\n`,
  );
} else {
  usage();
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
  const baseline = readJson(join(repoRoot, 'tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json'));
  assert(benchmark.ceilings?.revision === baseline.revision, 'ceiling revision');
  assert(benchmark.method === baseline.method, 'benchmark method');
  assert(benchmark.ceilings?.methodDigest === baseline.methodDigest, 'benchmark method digest');
  assert(benchmark.ceilings?.baselineFile === 'tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json', 'benchmark baseline file');
  assert(benchmark.ceilings?.proofProfile === 'full', 'full ceiling profile');
  assert(benchmark.ceilings?.requiredBuildProfile === 'release', 'ceiling build profile');

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
    ['worker flush p95', worker.flushWait.p95Ms, benchmark.ceilings.workerFlushP95Ms],
    ['direct flush p95', benchmark.flush.p95Ms, benchmark.ceilings.directFlushP95Ms],
    ['checkpoint p95', benchmark.checkpoint.p95Ms, benchmark.ceilings.checkpointP95Ms],
    ['sweep', benchmark.sweep.latencyMs, benchmark.ceilings.sweepMs],
    ['event query p95', queries.eventPage.p95Ms, benchmark.ceilings.eventQueryP95Ms],
    ['stats query p95', queries.stats.p95Ms, benchmark.ceilings.statsQueryP95Ms],
    ['app query p95', app.telemetryOn.p95Ms, benchmark.ceilings.appQueryP95Ms],
    ['app p95 overhead', app.p95OverheadPercent, benchmark.ceilings.appP95OverheadPercent],
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
  assert(idle.settle?.lifecycle?.persistedEventBatches <= idle.settle?.policy?.maxPersistedEventBatches, 'bounded settle batches');
  assert(idle.settle?.lifecycle?.eventCount <= idle.settle?.policy?.maxPersistedEvents, 'bounded settle events');
  assert(idle.idle?.windowMs >= 120_000, 'idle window');
  assert(idle.idle?.storageMutationObservationCount === 0, 'idle storage mutations');
  assert(idle.idle?.startSnapshot?.digest === idle.idle?.endSnapshot?.digest, 'idle directory digest');
  assert(JSON.stringify(idle.idle?.startLifecycle) === JSON.stringify(idle.idle?.endLifecycle), 'idle lifecycle events');
  assert(idle.idle?.resources?.source === 'linux-procfs', 'idle procfs witness');
  assert(idle.idle?.resources?.writeBytesDelta === 0, 'idle process writes');
  assert(Number.isFinite(idle.idle?.resources?.userTicksDelta), 'idle CPU witness');
  assert(Number.isFinite(idle.idle?.resources?.rssPagesStart), 'idle RSS witness');
  assert(idle.idle?.resources?.cpuTicksDelta <= idle.idle?.resourceCeilings?.cpuTicksDelta, 'idle CPU ceiling');
  assert(idle.idle?.resources?.rssGrowthPages <= idle.idle?.resourceCeilings?.rssGrowthPages, 'idle RSS ceiling');

  const currentInputs = digestSourceInputs();
  assert(receipt.sourceInputs?.algorithm === 'sha256-length-framed-v1', 'input digest algorithm');
  assert(JSON.stringify(receipt.sourceInputs?.files) === JSON.stringify(sourceFiles), 'input file set');
  assert(receipt.sourceInputs?.digest === currentInputs.digest, 'proof-source digest freshness');
}

function digestSourceInputs() {
  const hash = createHash('sha256');
  for (const file of sourceFiles) {
    const bytes = readFileSync(join(repoRoot, file));
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
    'usage: telemetry-phase1-evidence.mjs compose --benchmark FILE --idle FILE --output FILE | validate RECEIPT',
  );
}
