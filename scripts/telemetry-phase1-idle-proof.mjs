#!/usr/bin/env node

// LLP 0154 C2 evidence: sample before process spawn, provision a real
// file-backed release server, observe process_start + process_ready reach a
// persisted nonzero watermark, then prove the complete scratch directory and
// process write-I/O remain unchanged through an idle window. Graceful-shutdown
// writes happen only after the measured window.
//
// @ref LLP 0154#substrate-constraints-what-the-design-must-honor — C2's
//   bounded settle write and post-settle zero-write contract.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../demos/_kit/server-process.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const smoke = process.argv.includes('--smoke');
const unknownArgs = process.argv.slice(2).filter((argument) => argument !== '--smoke');
if (unknownArgs.length > 0) throw new Error(`unknown arguments: ${unknownArgs.join(', ')}`);
const SETTLE_BOUND_MS = 15_000;
const TERMINAL_QUIET_MS = smoke ? 1_000 : 6_000;
const SETTLE_SAMPLE_MS = 250;
const IDLE_WINDOW_MS = smoke ? 5_000 : 120_000;
const IDLE_SAMPLE_MS = smoke ? 250 : 1_000;
const EXACT_SETTLE_EVENT_BATCHES = 1;
const EXACT_SETTLE_FLUSH_COMMITS = 1;
const MAX_SETTLE_EVENTS = 4;
const RESOURCE_CEILINGS = smoke
  ? { cpuTicksDelta: 25, rssGrowthPages: 512 }
  : { cpuTicksDelta: 1, rssGrowthPages: 8 };
const RESOURCE_RESOLUTION = {
  clockTicksPerSecond: numericGetconf('CLK_TCK'),
  cpuTickMilliseconds: 1_000 / numericGetconf('CLK_TCK'),
  pageSizeBytes: numericGetconf('PAGESIZE'),
};

if (!smoke && (!existsSync('/proc/self/io') || !existsSync('/proc/self/stat'))) {
  throw new Error(
    'SNAPBACK_TELEMETRY_IDLE_FULL_LINUX_REQUIRED: full evidence requires procfs write-I/O, CPU, and RSS counters',
  );
}

const releaseBinary = resolve(process.env.SNAPBACK_SERVER_BINARY ?? '');
const expectedCommit = process.env.SNAPBACK_TELEMETRY_EXPECTED_COMMIT ?? '';
if (!process.env.SNAPBACK_SERVER_BINARY || !existsSync(releaseBinary)) {
  throw new Error(
    'SNAPBACK_TELEMETRY_IDLE_RELEASE_BINARY_REQUIRED: set SNAPBACK_SERVER_BINARY to a qualified release snapback binary',
  );
}
if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
  throw new Error(
    'SNAPBACK_TELEMETRY_IDLE_EXPECTED_COMMIT_REQUIRED: set SNAPBACK_TELEMETRY_EXPECTED_COMMIT to the evidence-harness revision',
  );
}

const scratch = mkdtempSync(join(tmpdir(), 'snapback-telemetry-idle-'));
const database = join(scratch, 'app.sqlite3');
const telemetry = `${database}.telemetry`;
const generated = join(repoRoot, 'demos', 'todo', 'snapback', 'generated');
const schemaPath = join(generated, 'schema.manifest.json');
const functionsPath = join(generated, 'functions.manifest.json');
const startupCarrier = join(scratch, 'startup-artifacts.json');

if (!existsSync(schemaPath) || !existsSync(functionsPath)) {
  execFileSync(process.execPath, [
    join(repoRoot, 'packages', 'snapback-codegen', 'index.mjs'),
    join(repoRoot, 'demos', 'todo', 'snapback'),
  ], { cwd: repoRoot, stdio: 'inherit' });
}
if (!existsSync(schemaPath) || !existsSync(functionsPath)) {
  throw new Error('SNAPBACK_TELEMETRY_IDLE_MANIFEST_GENERATION_FAILED');
}

writeFileSync(
  startupCarrier,
  `${JSON.stringify({
    formatVersion: 1,
    schema: JSON.parse(readFileSync(schemaPath, 'utf8')),
    functions: JSON.parse(readFileSync(functionsPath, 'utf8')),
  })}\n`,
  { mode: 0o600 },
);

const preSpawnSnapshot = directorySnapshot(scratch);
let server = null;
try {
  server = await startServer({
    port: 0,
    db: database,
    cwd: repoRoot,
    serverBinary: releaseBinary,
    startupArtifacts: startupCarrier,
  });
  if (server.reused || server.launch?.rung !== 'configured' || !Number.isInteger(server.pid)) {
    throw new Error(
      `SNAPBACK_TELEMETRY_IDLE_LAUNCH_INVALID: expected an owned configured child, got ${JSON.stringify({ reused: server.reused, launch: server.launch, pid: server.pid })}`,
    );
  }
  const binaryIdentity = server.identity?.binary;
  if (
    server.identity?.verdict !== 'verified'
    || binaryIdentity?.buildProfile !== 'release'
    || binaryIdentity?.gitDirty !== false
    || !binaryIdentity?.gitCommit
    || binaryIdentity.gitCommit !== expectedCommit
  ) {
    throw new Error(
      `SNAPBACK_TELEMETRY_IDLE_RELEASE_IDENTITY_INVALID: ${JSON.stringify(binaryIdentity)}`,
    );
  }

  const readyAt = Date.now();
  let settled = preSpawnSnapshot;
  let stableSince = readyAt;
  let lifecycle = null;
  const settleChanges = [];
  const immediate = directorySnapshot(scratch);
  const immediateChanges = changedPaths(settled, immediate);
  if (immediateChanges.length > 0) {
    settleChanges.push({ afterReadyMs: 0, paths: immediateChanges });
    settled = immediate;
  }

  while (Date.now() - stableSince < TERMINAL_QUIET_MS || !lifecycleReady(lifecycle)) {
    if (Date.now() - readyAt >= SETTLE_BOUND_MS) {
      throw new Error(
        `SNAPBACK_TELEMETRY_IDLE_SETTLE_TIMEOUT: lifecycle=${JSON.stringify(lifecycle)} changes=${JSON.stringify(settleChanges)}`,
      );
    }
    await delay(SETTLE_SAMPLE_MS);
    server.assertAlive();
    const next = directorySnapshot(scratch);
    const changed = changedPaths(settled, next);
    if (changed.length > 0) {
      settleChanges.push({ afterReadyMs: Date.now() - readyAt, paths: changed });
      stableSince = Date.now();
      settled = next;
    }
    lifecycle = lifecycleWitness(telemetry);
  }
  if (settleChanges.length === 0 || !lifecycleBounded(lifecycle)) {
    throw new Error('SNAPBACK_TELEMETRY_IDLE_SETTLE_VACUOUS');
  }

  const idleStartSnapshot = directorySnapshot(scratch);
  const idleStartLifecycle = lifecycleWitness(telemetry);
  const resourceStart = processResources(server.pid);
  const idleStartedAt = Date.now();
  const idleMutations = [];
  while (Date.now() - idleStartedAt < IDLE_WINDOW_MS) {
    await delay(Math.min(IDLE_SAMPLE_MS, IDLE_WINDOW_MS - (Date.now() - idleStartedAt)));
    server.assertAlive();
    const next = directorySnapshot(scratch);
    const changed = changedPaths(idleStartSnapshot, next);
    if (changed.length > 0) {
      idleMutations.push({ afterIdleStartMs: Date.now() - idleStartedAt, paths: changed });
    }
  }
  const idleEndSnapshot = directorySnapshot(scratch);
  const idleEndLifecycle = lifecycleWitness(telemetry);
  const resourceEnd = processResources(server.pid);
  const resources = resourceDelta(resourceStart, resourceEnd);

  if (idleMutations.length > 0 || changedPaths(idleStartSnapshot, idleEndSnapshot).length > 0) {
    throw new Error(
      `SNAPBACK_TELEMETRY_IDLE_STORAGE_MUTATION_DETECTED: ${JSON.stringify(idleMutations)}`,
    );
  }
  if (JSON.stringify(idleStartLifecycle) !== JSON.stringify(idleEndLifecycle)) {
    throw new Error(
      `SNAPBACK_TELEMETRY_IDLE_EVENT_MUTATION_DETECTED: ${JSON.stringify({ idleStartLifecycle, idleEndLifecycle })}`,
    );
  }
  if (resources.writeBytesDelta !== null && resources.writeBytesDelta !== 0) {
    throw new Error(
      `SNAPBACK_TELEMETRY_IDLE_PROCESS_WRITE_DETECTED: ${JSON.stringify(resources)}`,
    );
  }
  if (
    resources.cpuTicksDelta === null
    || resources.cpuTicksDelta > RESOURCE_CEILINGS.cpuTicksDelta
    || resources.rssGrowthPages === null
    || resources.rssGrowthPages > RESOURCE_CEILINGS.rssGrowthPages
  ) {
    throw new Error(
      `SNAPBACK_TELEMETRY_IDLE_RESOURCE_CEILING_EXCEEDED: ${JSON.stringify({ resources, ceilings: RESOURCE_CEILINGS })}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 'snapback.telemetry-phase1-idle.v2',
      proofProfile: smoke ? 'smoke' : 'full',
      method:
        'explicit clean release child; pre-spawn through lifecycle-watermark settle; ordinary zero-job cron ticker; recursive content/metadata digest, lifecycle-event, process-I/O, CPU, and RSS witnesses; graceful shutdown excluded',
      build: {
        binary: releaseBinary,
        identity: server.identity,
        launch: server.launch,
      },
      settle: {
        boundMs: SETTLE_BOUND_MS,
        terminalQuietMs: TERMINAL_QUIET_MS,
        sampleIntervalMs: SETTLE_SAMPLE_MS,
        observedMutationCount: settleChanges.length,
        lastMutationAfterReadyMs: settleChanges.at(-1).afterReadyMs,
        terminalWithinBound: true,
        policy: {
          exactProcessStartCount: 1,
          exactProcessReadyCount: 1,
          exactPersistedEventBatches: EXACT_SETTLE_EVENT_BATCHES,
          exactFlushCommitSequence: EXACT_SETTLE_FLUSH_COMMITS,
          maxPersistedEvents: MAX_SETTLE_EVENTS,
        },
        preSpawnSnapshot,
        changes: settleChanges,
        lifecycle,
        terminalSnapshot: settled,
      },
      idle: {
        windowMs: IDLE_WINDOW_MS,
        sampleIntervalMs: IDLE_SAMPLE_MS,
        storageMutationObservationCount: idleMutations.length,
        storageMutations: idleMutations,
        startSnapshot: idleStartSnapshot,
        endSnapshot: idleEndSnapshot,
        startLifecycle: idleStartLifecycle,
        endLifecycle: idleEndLifecycle,
        resources,
        resourceResolution: RESOURCE_RESOLUTION,
        resourceCeilings: RESOURCE_CEILINGS,
      },
    }, null, 2)}\n`,
  );
} finally {
  if (server) await server.stop();
  rmSync(scratch, { recursive: true, force: true });
}

function lifecycleReady(witness) {
  return witness
    && witness.watermark > 0
    && witness.processStartCount >= 1
    && witness.processReadyCount >= 1;
}

function lifecycleBounded(witness) {
  return lifecycleReady(witness)
    && witness.processStartCount === 1
    && witness.processReadyCount === 1
    && witness.processStartFlushSequence === witness.processReadyFlushSequence
    && witness.processStartFlushSequence === EXACT_SETTLE_FLUSH_COMMITS
    && witness.persistedEventBatches === EXACT_SETTLE_EVENT_BATCHES
    && witness.flushCommitSequence === EXACT_SETTLE_FLUSH_COMMITS
    && witness.eventCount >= 2
    && witness.eventCount <= MAX_SETTLE_EVENTS;
}

function lifecycleWitness(path) {
  if (!existsSync(path)) return null;
  const output = execFileSync('sqlite3', [
    '-separator', '\t',
    path,
    `SELECT
       coalesce(max(e.recorded_ts_ms),0),
       coalesce(sum(CASE WHEN e.name='process_start' THEN 1 ELSE 0 END),0),
       coalesce(sum(CASE WHEN e.name='process_ready' THEN 1 ELSE 0 END),0),
       count(*),
       count(DISTINCT e.flush_sequence),
       coalesce(min(CASE WHEN e.name='process_start' THEN e.flush_sequence END),0),
       coalesce(min(CASE WHEN e.name='process_ready' THEN e.flush_sequence END),0),
       m.flush_commit_sequence
     FROM telemetry_events e, telemetry_meta m
     WHERE m.singleton=1
       AND m.max_days_mirror > 0
       AND e.generation=m.generation
       AND e.recorded_ts_ms > max(
         m.observation_clock_ms - m.max_days_mirror * 86400000,
         m.retention_floor
       )
       AND e.phase IN ('point','joined','terminal');`,
  ], { encoding: 'utf8' }).trim();
  const [
    watermark = '0',
    processStartCount = '0',
    processReadyCount = '0',
    eventCount = '0',
    persistedEventBatches = '0',
    processStartFlushSequence = '0',
    processReadyFlushSequence = '0',
    flushCommitSequence = '0',
  ] = output.split('\t');
  return {
    watermark: Number(watermark),
    processStartCount: Number(processStartCount),
    processReadyCount: Number(processReadyCount),
    eventCount: Number(eventCount),
    persistedEventBatches: Number(persistedEventBatches),
    processStartFlushSequence: Number(processStartFlushSequence),
    processReadyFlushSequence: Number(processReadyFlushSequence),
    flushCommitSequence: Number(flushCommitSequence),
  };
}

function directorySnapshot(root) {
  const entries = {};
  visit(root);
  const canonical = JSON.stringify(entries);
  return {
    digest: createHash('sha256').update(canonical).digest('hex'),
    entries,
  };

  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      const absolute = join(path, name);
      const key = relative(root, absolute);
      const info = lstatSync(absolute, { bigint: true });
      if (info.isDirectory()) {
        entries[`${key}/`] = { type: 'directory', mode: Number(info.mode) };
        visit(absolute);
      } else if (info.isFile()) {
        const bytes = readFileSync(absolute);
        entries[key] = {
          type: 'file',
          bytes: bytes.length,
          mode: Number(info.mode),
          mtimeNs: info.mtimeNs.toString(),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      } else {
        entries[key] = { type: 'other', mode: Number(info.mode), bytes: Number(info.size) };
      }
    }
  }
}

function changedPaths(before, after) {
  const paths = new Set([
    ...Object.keys(before.entries),
    ...Object.keys(after.entries),
  ]);
  return [...paths].sort().filter(
    (path) => JSON.stringify(before.entries[path]) !== JSON.stringify(after.entries[path]),
  );
}

function processResources(pid) {
  const procIo = `/proc/${pid}/io`;
  const procStat = `/proc/${pid}/stat`;
  if (existsSync(procIo) && existsSync(procStat)) {
    const io = Object.fromEntries(readFileSync(procIo, 'utf8').trim().split('\n').map((line) => {
      const [key, value] = line.split(':');
      return [key.trim(), Number(value.trim())];
    }));
    const stat = readFileSync(procStat, 'utf8').trim();
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
    return {
      source: 'linux-procfs',
      readBytes: io.read_bytes ?? null,
      writeBytes: io.write_bytes ?? null,
      userTicks: Number(fields[11]),
      systemTicks: Number(fields[12]),
      rssPages: Number(fields[21]),
    };
  }
  const rssKb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim());
  return {
    source: 'portable-ps-rss',
    readBytes: null,
    writeBytes: null,
    userTicks: null,
    systemTicks: null,
    rssPages: null,
    rssKb: Number.isFinite(rssKb) ? rssKb : null,
  };
}

function resourceDelta(start, end) {
  const subtract = (field) => start[field] === null || end[field] === null
    ? null
    : end[field] - start[field];
  const userTicksDelta = subtract('userTicks');
  const systemTicksDelta = subtract('systemTicks');
  const rssPagesDelta = subtract('rssPages');
  return {
    source: start.source,
    readBytesDelta: subtract('readBytes'),
    writeBytesDelta: subtract('writeBytes'),
    userTicksDelta,
    systemTicksDelta,
    cpuTicksDelta: userTicksDelta === null || systemTicksDelta === null
      ? null
      : userTicksDelta + systemTicksDelta,
    rssPagesStart: start.rssPages,
    rssPagesEnd: end.rssPages,
    rssPagesDelta,
    rssGrowthPages: rssPagesDelta === null ? null : Math.max(0, rssPagesDelta),
    rssKbStart: start.rssKb ?? null,
    rssKbEnd: end.rssKb ?? null,
  };
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function numericGetconf(name) {
  const value = Number(execFileSync('getconf', [name], { encoding: 'utf8' }).trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`SNAPBACK_TELEMETRY_IDLE_RESOURCE_RESOLUTION_INVALID: ${name}=${value}`);
  }
  return value;
}
