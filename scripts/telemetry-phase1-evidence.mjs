#!/usr/bin/env node

// Compose and reopen the retained LLP 0154 Phase-1 evidence. A receipt remains
// historically valid for its clean measured source revision even while main
// advances; currentness is a separate assessment, and releases/capability
// promotions retain an exact-current gate.
//
// @ref LLP 0154#amendment-2026-08-06-rolling-trailing-head-evidence — do not
// collapse historical integrity, rolling-main lag, and release currentness.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePolicyPath = join(
  repoRoot,
  'tests',
  'acceptance',
  'telemetry-phase1-evidence-policy.v1.json',
);
const proofSourcePathspecs = [
  'Cargo.toml',
  'Cargo.lock',
  'crates/snapback/Cargo.toml',
  'crates/snapback/build.rs',
  // @ref LLP 0276#phases -- preserve the old monolith-wide compiled-input
  // closure as implementation leaves the remainder. In particular, the
  // benchmark fixture is now types-owned and its engine/server execution
  // path must not disappear from the evidence digest.
  'crates/snapback-activation/Cargo.toml',
  'crates/snapback-activation/src',
  'crates/snapback-auth/Cargo.toml',
  'crates/snapback-auth/src',
  'crates/snapback-engine/Cargo.toml',
  'crates/snapback-engine/build.rs',
  'crates/snapback-engine/src',
  'crates/snapback-kernel/Cargo.toml',
  'crates/snapback-kernel/src',
  'crates/snapback-runtime/Cargo.toml',
  'crates/snapback-runtime/build.rs',
  'crates/snapback-runtime/src',
  'crates/snapback-server/Cargo.toml',
  'crates/snapback-server/build.rs',
  'crates/snapback-server/src',
  'crates/snapback-services/Cargo.toml',
  'crates/snapback-services/src',
  'crates/snapback-sync/Cargo.toml',
  'crates/snapback-sync/src',
  'crates/snapback-types/Cargo.toml',
  'crates/snapback-types/src',
  'crates/snapback/src',
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
  'scripts/telemetry-release-gate.mjs',
  'scripts/telemetry-release-gate.test.mjs',
  'scripts/verify-telemetry-phase1-proof',
  'scripts/verify-local-proof',
  'tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json',
  'tests/acceptance/telemetry-phase1-evidence-policy.v1.json',
];
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
    assert(
      assessReceiptCurrentness(receipt).state === 'CURRENT',
      'newly composed receipt is current at measured revision',
    );
    writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
    validateReceipt(readJson(outputPath));
    process.stdout.write(`wrote ${outputPath}\n`);
  } else if (command === 'validate' || command === 'validate-history') {
    const receiptPath = args[0];
    if (!receiptPath || args.length !== 1) usage();
    const receipt = readJson(receiptPath);
    validateReceipt(receipt);
    validateRetainedCarrier(receiptPath);
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 'snapback.telemetry-phase1-evidence-validation.v2',
        valid: true,
        evidenceState: 'HISTORICAL_VALID',
        sourceRevision: receipt.sourceRevision,
        sourceDigest: receipt.sourceInputs.digest,
      })}\n`,
    );
  } else if (command === 'assess' || command === 'require-current') {
    const receiptPath = args[0];
    const atRevision = command === 'require-current' && args[1] === '--at'
      ? args[2]
      : null;
    if (
      !receiptPath
      || (command === 'assess' && args.length !== 1)
      || (command === 'require-current' && ![1, 3].includes(args.length))
      || (args.length === 3 && atRevision === null)
    ) usage();
    if (atRevision !== null) assertRevision(atRevision, 'target revision');
    const receipt = readJson(receiptPath);
    validateReceipt(receipt);
    validateRetainedCarrier(receiptPath);
    const assessment = atRevision === null
      ? assessReceiptCurrentness(receipt)
      : assessReceiptCurrentnessAtRevision(receipt, atRevision);
    process.stdout.write(`${JSON.stringify(assessment)}\n`);
    if (assessment.state === 'DIVERGED') process.exitCode = 1;
    if (command === 'require-current') {
      assert(
        assessment.state === 'CURRENT',
        `exact-current evidence required; observed ${assessment.state}`,
      );
    }
  } else if (command === 'source-inputs') {
    if (args.length !== 0) usage();
    process.stdout.write(`${JSON.stringify(digestSourceInputs())}\n`);
  } else {
    usage();
  }
}

export function validateReceipt(receipt) {
  assert(receipt.schemaVersion === 'snapback.telemetry-phase1-evidence.v1', 'receipt schema');
  assert(typeof receipt.createdAt === 'string' && !Number.isNaN(Date.parse(receipt.createdAt)), 'createdAt');
  const benchmark = receipt.benchmark;
  const idle = receipt.idle;
  assert(benchmark?.schemaVersion === 'snapback.telemetry-phase1-benchmark.v2', 'benchmark schema');
  assert(benchmark.environment?.profile === 'release', 'benchmark release profile');
  assert(benchmark.environment?.buildDirty === false, 'benchmark clean build');
  assertRevision(benchmark.environment?.buildCommit, 'benchmark revision');
  assert(receipt.sourceRevision === benchmark.environment.buildCommit, 'receipt/benchmark revision');
  assert(
    JSON.stringify(receipt.sourceInputs?.files)
      === JSON.stringify(trackedProofSourceFilesAtRevision(receipt.sourceRevision)),
    'measured input file set',
  );
  const measuredSources = sourceInputsAtRevision(receipt.sourceRevision, receipt.sourceInputs);
  validateSourceInputs(
    receipt.sourceInputs,
    (file) => measuredSources.get(file),
    receipt.sourceInputs.files,
  );
  const baselinePath = 'tests/acceptance/telemetry-phase1-benchmark-baseline.v1.json';
  assert(measuredSources.has(baselinePath), 'measured source closure carries benchmark baseline');
  const baseline = JSON.parse(measuredSources.get(baselinePath).toString('utf8'));
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
}

function trackedProofSourceFiles() {
  const output = execFileSync('git', [
    'ls-files', '-z', '--',
    ...proofSourcePathspecs,
  ], { cwd: repoRoot, encoding: 'utf8' });
  const files = output.split('\0').filter(Boolean);
  const policyFile = 'tests/acceptance/telemetry-phase1-evidence-policy.v1.json';
  // Keep a newly added policy inside the closure before its first commit so
  // local tests exercise the same bytes the clean producer will bind.
  if (existsSync(evidencePolicyPath) && !files.includes(policyFile)) files.push(policyFile);
  return files.sort();
}

function trackedProofSourceFilesAtRevision(revision) {
  assertRevision(revision, 'measured source revision');
  let revisionPathspecs = proofSourcePathspecs;
  try {
    execFileSync('git', ['cat-file', '-e', `${revision}:crates/snapback/Cargo.toml`], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
  } catch {
    revisionPathspecs = proofSourcePathspecs
      .filter((pathspec) => pathspec !== 'crates/snapback/Cargo.toml')
      .map((pathspec) => {
        if (pathspec === 'crates/snapback/build.rs') return 'build.rs'; // path-migration: historical
        if (pathspec === 'crates/snapback/src') return 'src';
        return pathspec;
      });
  }
  let output;
  try {
    output = execFileSync(
      'git',
      ['ls-tree', '-r', '-z', '--name-only', revision, '--', ...revisionPathspecs],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    assert(false, 'measured source revision is readable');
  }
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

export function assessReceiptCurrentness(
  receipt,
  {
    headRevision = currentRevision(),
    currentInputs = digestSourceInputs(),
    now = Date.now(),
    maxAgeHours = evidencePolicy().rollingAssessment.maxAgeHours,
    ancestor = isAncestor(receipt.sourceRevision, headRevision),
    changedFiles = ancestor
      ? changedSourceFilesSince(receipt.sourceRevision, receipt.sourceInputs.files)
      : [],
  } = {},
) {
  const exactInputs = ancestor
    && JSON.stringify(receipt.sourceInputs.files) === JSON.stringify(currentInputs.files)
    && receipt.sourceInputs.digest === currentInputs.digest;
  const ageHours = Math.max(0, now - Date.parse(receipt.createdAt)) / 3_600_000;
  const state = !ancestor
    ? 'DIVERGED'
    : exactInputs
      ? 'CURRENT'
      : ageHours > maxAgeHours
        ? 'OVERDUE'
        : 'LAGGING';
  const reportedChangedFiles = changedFiles.slice(0, 50);
  return {
    schemaVersion: 'snapback.telemetry-phase1-evidence-assessment.v1',
    valid: true,
    evidenceState: 'HISTORICAL_VALID',
    state,
    sourceRevision: receipt.sourceRevision,
    headRevision,
    sourceDigest: receipt.sourceInputs.digest,
    currentDigest: currentInputs.digest,
    ageHours: Number(ageHours.toFixed(3)),
    maxAgeHours,
    changedSourceFileCount: changedFiles.length,
    changedSourceFiles: reportedChangedFiles,
    changedSourceFilesTruncated: changedFiles.length > reportedChangedFiles.length,
    acceptedForOrdinaryMerge: state !== 'DIVERGED',
    acceptedForReleaseOrCapabilityPromotion: state === 'CURRENT',
    rollingFullProofRequested: state !== 'CURRENT',
  };
}

function changedSourceFilesSince(revision, measuredFiles) {
  const files = [...new Set([...measuredFiles, ...sourceFiles])].sort();
  const output = execFileSync(
    'git',
    // Compare the measured tree with the index and working tree, not only
    // HEAD. Local assessment already digests those bytes, so its explanation
    // must attribute the same staged and unstaged changes.
    ['diff', '--name-only', '-z', revision, '--', ...files],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const changed = new Set(output.split('\0').filter(Boolean));
  const measuredSet = new Set(measuredFiles);
  const currentSet = new Set(sourceFiles);
  // `git diff` does not report an untracked path. The policy file is admitted
  // to the local closure before its first commit, and set differences also
  // explain later closure additions and removals precisely.
  for (const file of files) {
    if (measuredSet.has(file) !== currentSet.has(file)) changed.add(file);
  }
  return [...changed].sort();
}

function assessReceiptCurrentnessAtRevision(receipt, revision) {
  const currentInputs = digestSourceInputsAtRevision(revision);
  const ancestor = isAncestor(receipt.sourceRevision, revision);
  return assessReceiptCurrentness(receipt, {
    headRevision: revision,
    currentInputs,
    ancestor,
    changedFiles: ancestor
      ? changedSourceFilesBetweenRevisions(
        receipt.sourceRevision,
        revision,
        receipt.sourceInputs.files,
        currentInputs.files,
      )
      : [],
  });
}

function changedSourceFilesBetweenRevisions(fromRevision, toRevision, fromFiles, toFiles) {
  const files = [...new Set([...fromFiles, ...toFiles])].sort();
  if (files.length === 0) return [];
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '-z', fromRevision, toRevision, '--', ...files],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const changed = new Set(output.split('\0').filter(Boolean));
  const fromSet = new Set(fromFiles);
  const toSet = new Set(toFiles);
  for (const file of files) {
    if (fromSet.has(file) !== toSet.has(file)) changed.add(file);
  }
  return [...changed].sort();
}

function evidencePolicy() {
  const policy = readJson(evidencePolicyPath);
  assert(
    policy.schemaVersion === 'snapback.telemetry-phase1-evidence-policy.v1',
    'evidence policy schema',
  );
  assert(
    Number.isFinite(policy.rollingAssessment?.maxAgeHours)
      && policy.rollingAssessment.maxAgeHours > 0,
    'rolling assessment max age',
  );
  assert(
    policy.rollingAssessment?.overdueFailsOrdinaryMerge === false,
    'ordinary merge accepts explicit overdue state',
  );
  assert(policy.release?.requireCurrent === true, 'release requires current evidence');
  return policy;
}

function sourceInputsAtRevision(revision, sourceInputs) {
  assertRevision(revision, 'measured source revision');
  assert(sourceInputs?.algorithm === 'sha256-length-framed-v1', 'input digest algorithm');
  assert(Array.isArray(sourceInputs?.files) && sourceInputs.files.length > 0, 'input file set');
  const files = sourceInputs.files;
  assert(
    JSON.stringify(files) === JSON.stringify([...new Set(files)].sort()),
    'input file set is sorted and unique',
  );
  for (const file of files) {
    assert(
      typeof file === 'string'
        && file.length > 0
        && !file.startsWith('/')
        && !file.includes('\n')
        && !file.split('/').includes('..'),
      'input file path is repository-relative',
    );
  }

  const queries = files.map((file) => `${revision}:${file}\n`).join('');
  let output;
  try {
    output = execFileSync('git', ['cat-file', '--batch'], {
      cwd: repoRoot,
      input: queries,
      encoding: null,
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch {
    assert(false, 'measured source revision and files are readable');
  }
  const sources = new Map();
  let offset = 0;
  for (const file of files) {
    const headerEnd = output.indexOf(0x0a, offset);
    assert(headerEnd >= 0, 'git source batch header');
    const header = output.subarray(offset, headerEnd).toString('utf8');
    assert(!header.endsWith(' missing'), `measured source contains ${file}`);
    const [, type, sizeText] = header.split(' ');
    const size = Number(sizeText);
    assert(type === 'blob' && Number.isSafeInteger(size), `measured source blob ${file}`);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    assert(contentEnd < output.length && output[contentEnd] === 0x0a, 'git source batch framing');
    sources.set(file, Buffer.from(output.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  assert(offset === output.length, 'git source batch exhausts output');
  return sources;
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

export function digestSourceInputs(
  readSource = (file) => readFileSync(join(repoRoot, file)),
  files = sourceFiles,
) {
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = readSource(file);
    assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, `source bytes for ${file}`);
    hash.update(`${file.length}:`);
    hash.update(file);
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
  return {
    algorithm: 'sha256-length-framed-v1',
    files,
    digest: hash.digest('hex'),
  };
}

export function digestSourceInputsAtRevision(revision) {
  assertRevision(revision, 'source input revision');
  const files = trackedProofSourceFilesAtRevision(revision);
  const algorithm = 'sha256-length-framed-v1';
  const sources = sourceInputsAtRevision(revision, { algorithm, files });
  return digestSourceInputs((file) => sources.get(file), files);
}

export function validateSourceInputs(
  sourceInputs,
  readSource = undefined,
  expectedFiles = sourceFiles,
) {
  const currentInputs = digestSourceInputs(readSource, expectedFiles);
  assert(sourceInputs?.algorithm === 'sha256-length-framed-v1', 'input digest algorithm');
  assert(JSON.stringify(sourceInputs?.files) === JSON.stringify(expectedFiles), 'input file set');
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
    'usage: telemetry-phase1-evidence.mjs compose --benchmark FILE --idle FILE --output FILE | validate-history RECEIPT | assess RECEIPT | require-current RECEIPT [--at SHA] | source-inputs',
  );
}
