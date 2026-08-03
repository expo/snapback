#!/usr/bin/env node

// LLP 0154 C2 evidence: provision a real file-backed server, observe the
// event-armed boot flush reach a bounded terminal state, then prove the app and
// telemetry SQLite siblings receive zero writes through a 120-second idle
// window. Graceful-shutdown writes happen only after the measured window.
//
// @ref LLP 0154#substrate-constraints-what-the-design-must-honor — C2's
//   bounded settle write and post-settle zero-write contract.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../demos/_kit/server-process.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETTLE_BOUND_MS = 15_000;
const TERMINAL_QUIET_MS = 6_000;
const SETTLE_SAMPLE_MS = 250;
const IDLE_WINDOW_MS = 120_000;
const IDLE_SAMPLE_MS = 1_000;

const scratch = mkdtempSync(join(tmpdir(), 'snapback-telemetry-idle-'));
const database = join(scratch, 'app.sqlite3');
const telemetry = `${database}.telemetry`;
const tracked = [
  database,
  `${database}-wal`,
  `${database}-shm`,
  telemetry,
  `${telemetry}-wal`,
  `${telemetry}-shm`,
];
const generated = join(repoRoot, 'demos', 'todo', 'snapback', 'generated');
const schemaPath = join(generated, 'schema.manifest.json');
const functionsPath = join(generated, 'functions.manifest.json');
const startupCarrier = join(scratch, 'startup-artifacts.json');

if (!existsSync(schemaPath) || !existsSync(functionsPath)) {
  throw new Error(
    'telemetry idle proof requires the todo manifests; run ' +
      '`node packages/snapback-codegen/index.mjs demos/todo/snapback` first',
  );
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

let server = null;
try {
  server = await startServer({
    port: 0,
    db: database,
    cwd: repoRoot,
    serverBinary: process.env.SNAPBACK_SERVER_BINARY ?? null,
    startupArtifacts: startupCarrier,
    cronDisabled: true,
  });
  const readyAt = Date.now();
  let settled = fileSnapshot(tracked);
  let stableSince = readyAt;
  const settleChanges = [];

  while (Date.now() - stableSince < TERMINAL_QUIET_MS) {
    if (Date.now() - readyAt >= SETTLE_BOUND_MS) {
      throw new Error(
        `SNAPBACK_TELEMETRY_IDLE_SETTLE_TIMEOUT: tracked files did not become terminal within ${SETTLE_BOUND_MS}ms`,
      );
    }
    await delay(SETTLE_SAMPLE_MS);
    server.assertAlive();
    const next = fileSnapshot(tracked);
    const changed = changedPaths(settled, next);
    if (changed.length > 0) {
      settleChanges.push({ afterReadyMs: Date.now() - readyAt, paths: changed });
      stableSince = Date.now();
      settled = next;
    }
  }

  const idleStartedAt = Date.now();
  const idleChanges = [];
  while (Date.now() - idleStartedAt < IDLE_WINDOW_MS) {
    await delay(Math.min(IDLE_SAMPLE_MS, IDLE_WINDOW_MS - (Date.now() - idleStartedAt)));
    server.assertAlive();
    const next = fileSnapshot(tracked);
    const changed = changedPaths(settled, next);
    if (changed.length > 0) {
      idleChanges.push({ afterIdleStartMs: Date.now() - idleStartedAt, paths: changed });
      settled = next;
    }
  }

  if (idleChanges.length > 0) {
    throw new Error(
      `SNAPBACK_TELEMETRY_IDLE_WRITE_DETECTED: ${JSON.stringify(idleChanges)}`,
    );
  }

  const lastSettleChangeMs = settleChanges.at(-1)?.afterReadyMs ?? 0;
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 'snapback.telemetry-phase1-idle.v1',
        method:
          'real release server with the todo startup carrier, cron disabled, six app/telemetry SQLite siblings sampled after readiness; graceful shutdown excluded',
        build: {
          identity: server.identity,
          launch: server.launch,
        },
        settle: {
          boundMs: SETTLE_BOUND_MS,
          terminalQuietMs: TERMINAL_QUIET_MS,
          sampleIntervalMs: SETTLE_SAMPLE_MS,
          observedChangeCount: settleChanges.length,
          lastChangeAfterReadyMs: lastSettleChangeMs,
          terminalWithinBound: true,
          changes: settleChanges,
          terminalSnapshot: settled,
        },
        idle: {
          windowMs: IDLE_WINDOW_MS,
          sampleIntervalMs: IDLE_SAMPLE_MS,
          writeCount: idleChanges.length,
          changes: idleChanges,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (server) await server.stop();
  rmSync(scratch, { recursive: true, force: true });
}

function fileSnapshot(paths) {
  return Object.fromEntries(
    paths.map((path) => {
      if (!existsSync(path)) return [path, { exists: false, bytes: 0, mtimeNs: null }];
      const stat = statSync(path, { bigint: true });
      return [
        path,
        {
          exists: true,
          bytes: Number(stat.size),
          mtimeNs: stat.mtimeNs.toString(),
        },
      ];
    }),
  );
}

function changedPaths(before, after) {
  return Object.keys(after).filter(
    (path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]),
  );
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
