#!/usr/bin/env node
// P0.4 write-amplification spike (LLP 0105 §P0.4, blocking Gate-0
// economics output; LLP 0104 ratification #1 input).
//
// Method: drive the REAL local engine (todo demo backend, dev mode)
// through N insert mutations and N update mutations against a file-
// backed SQLite database; measure durable row-count deltas across
// EVERY table (application + _snapback_* system tables) per mutation,
// count per-table indexes, and compute the provider-billed
// rows-written estimate under DO-SQLite accounting (each secondary
// index entry is an additional row write, D1/DO semantics) at the
// dated price from p0-platform-pricing-facts.md ($1.00/M past 50M).
//
// Honest limits, recorded in the receipt: durable row-count deltas
// under-count in-place updates and index-entry writes (measured
// analytically instead); journal/outbox retention windows mean some
// system rows are transient; the adversarial-but-admitted shape and
// the full five-app corpus remain to run on the real DO target. This
// is the p50-shape first pass Gate 0 needs to decide the
// request/CPU-vs-write-unit question directionally.
//
// Run from repo root: node demos/eas-phase0/spikes/write-amplification.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const { SnapbackClient } = await import(join(repoRoot, 'demos', '_kit', 'client.mjs'));
const { startServer } = await import(join(repoRoot, 'demos', '_kit', 'server-process.mjs'));
const { importGeneratedModule, readGeneratedJson } = await import(join(repoRoot, 'demos', '_kit', 'generated-artifacts.mjs'));

const generatedRoot = join(repoRoot, 'demos', 'todo', 'snapback', 'generated');
const schemaManifest = readGeneratedJson(generatedRoot, 'schema.manifest.json');
const functionManifest = readGeneratedJson(generatedRoot, 'functions.manifest.json');
const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');

const dir = mkdtempSync(join(tmpdir(), 'eas-p04-'));
const dbFile = join(dir, 'app.db');
const ADA = 'ada@example.com';
const N = 200;

const server = await startServer({
  port: 0,
  db: dbFile,
  cwd: repoRoot,
  provenance: { appId: 'todo', artifactsPath: join(repoRoot, 'demos', 'todo', 'snapback', 'generated', 'artifacts.json') },
});
const client = new SnapbackClient(server.baseUrl, server.clientOptions);
await client.loadSchema(schemaManifest);
await client.loadFunctions(functionManifest);

const sql = (q) => execFileSync('/usr/bin/sqlite3', [dbFile, q], { encoding: 'utf8' }).trim();
const tableNames = () => sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;").split('\n').filter(Boolean);
const snapshot = () => {
  const out = {};
  for (const t of tableNames()) out[t] = Number(sql(`SELECT COUNT(*) FROM "${t}";`));
  return out;
};
const delta = (a, b) => {
  const d = {};
  let total = 0;
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const v = (b[t] ?? 0) - (a[t] ?? 0);
    if (v !== 0) d[t] = v;
    total += v;
  }
  return { perTable: d, total };
};

// Warmup (schema/journal bootstrap noise stays out of the measurement).
const ids = [];
for (let i = 0; i < 10; i++) {
  const r = await client.mutate(api.createTodo, { args: { title: `warm ${i}` }, userId: ADA });
  ids.push(r.result);
}
const s0 = snapshot();

// Shape 1: insert-heavy (N createTodo).
for (let i = 0; i < N; i++) {
  const r = await client.mutate(api.createTodo, { args: { title: `todo ${i}` }, userId: ADA });
  ids.push(r.result);
}
const s1 = snapshot();

// Shape 2: update-heavy (N setCompleted over existing rows).
for (let i = 0; i < N; i++) {
  await client.mutate(api.setCompleted, { args: { id: ids[10 + (i % N)], completed: i % 2 === 0 }, userId: ADA });
}
const s2 = snapshot();
await server.stop();

// Index counts per table (secondary indexes = extra provider row writes).
const indexRows = sql("SELECT tbl_name, COUNT(*) FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' GROUP BY tbl_name;")
  .split('\n').filter(Boolean).map((l) => l.split('|'));
const indexesByTable = Object.fromEntries(indexRows.map(([t, c]) => [t, Number(c)]));

const insertDelta = delta(s0, s1);
const updateDelta = delta(s1, s2);

// Provider rows-written estimate (DO/D1 semantics: base row + one per
// secondary index entry touched). Inserts: every durable new row in
// table T costs 1 + indexes(T). Updates: no new durable rows in the app
// table, but each update writes the row (1) + touched indexes
// (conservatively all indexes on the table) + every durable system row
// it appends (journal/outbox/subscription), each with ITS indexes.
const providerWrites = (d, extraPerMutation) => {
  let w = 0;
  for (const [t, n] of Object.entries(d.perTable)) w += n * (1 + (indexesByTable[t] ?? 0));
  return w + extraPerMutation;
};
const todosIdx = indexesByTable['todos'] ?? 0;
const insertProviderRows = providerWrites(insertDelta, 0);
const updateProviderRows = providerWrites(updateDelta, N * (1 + todosIdx)); // in-place row rewrite + its indexes

const price = 1.0 / 1_000_000; // $/row past the 50M/mo inclusion (dated facts)
const receipt = {
  receipt: 'eas-phase0/p0.4/write-amplification',
  date: '2026-08-01',
  engine: 'local snapback (file-backed SQLite), todo demo backend, dev mode',
  mutationsPerShape: N,
  tables: tableNames(),
  indexesByTable,
  shapes: {
    insertHeavy: {
      durableRowDeltaPerMutation: insertDelta.total / N,
      perTable: insertDelta.perTable,
      providerRowsWrittenPerMutation: insertProviderRows / N,
      costPer1kMutationsUSD: (insertProviderRows / N) * 1000 * price,
    },
    updateHeavy: {
      durableRowDeltaPerMutation: updateDelta.total / N,
      perTable: updateDelta.perTable,
      providerRowsWrittenPerMutation: updateProviderRows / N,
      costPer1kMutationsUSD: (updateProviderRows / N) * 1000 * price,
      note: 'in-place app-row rewrite + all todos indexes counted per update (conservative), plus measured durable system-row appends',
    },
  },
  comparison: {
    requestCostPer1kUSD: 0.15 / 1000, // $0.15/M requests
    verdictShape: 'rows-written cost per mutation vs the request coefficient decides 0104 ratification #1',
  },
  limits: [
    'durable row-count deltas under-count transient rows inside retention windows and in-place updates (updates handled analytically)',
    'index-entry accounting is analytic (DO/D1 bills each index entry as a row write); confirm empirically on the real DO target',
    'p50 shape only; adversarial-but-admitted and the five-app corpus run on the real target per 0105',
  ],
};
writeFileSync(join(here, '..', 'receipts', 'p0.4-write-amplification.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({
  insertRowsPerMutation: receipt.shapes.insertHeavy.providerRowsWrittenPerMutation,
  updateRowsPerMutation: receipt.shapes.updateHeavy.providerRowsWrittenPerMutation,
  insertPerTable: insertDelta.perTable,
  updatePerTable: updateDelta.perTable,
}, null, 2));
console.log('db file retained at', dbFile, '(input for logical-storage-formula.mjs)');
