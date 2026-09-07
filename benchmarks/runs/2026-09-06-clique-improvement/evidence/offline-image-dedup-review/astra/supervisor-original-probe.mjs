import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { OfflineRuntime, PersistentRangeStore, SqliteBackend } from './artifacts/snapback2/packages/snapback2/dist/sqlite-test.mjs';

// Bounded JS-only reproduction: shipped backend, synthetic transactional driver.
// No SQLite connection, native checker, build, benchmark, or network operation.
const start = performance.now();
let records = Object.fromEntries(['state', 'metadata', 'rows', 'answers', 'outbox', 'bytes'].map(t => [t, new Map()]));
const statements = [];
const driver = {
  identity: 'astra-r8-metadata-repro',
  async exec() {},
  async get(sql, p = []) {
    if (sql.startsWith('PRAGMA')) return { journal_mode: 'wal' };
    const table = /FROM (\w+)/.exec(sql)?.[1];
    assert.ok(table, sql);
    const value = records[table].get(JSON.stringify(table === 'state' ? [p[0]] : p));
    return value === undefined ? undefined : { value };
  },
  async all(sql, p = []) {
    const table = /FROM (\w+)/.exec(sql)?.[1];
    assert.ok(table, sql);
    return [...records[table]].flatMap(([tuple, value]) => {
      const [partition, key] = JSON.parse(tuple);
      return partition === p[0] ? [{ key, value }] : [];
    });
  },
  async run(sql, p = []) {
    statements.push({ sql, params: p });
    const insert = /^INSERT OR REPLACE INTO (\w+)/.exec(sql);
    if (insert) {
      records[insert[1]].set(JSON.stringify(p.slice(0, -1)), p.at(-1));
      return;
    }
    const remove = /^DELETE FROM (\w+)/.exec(sql);
    assert.ok(remove, sql);
    if (p.length === 2) records[remove[1]].delete(JSON.stringify(p));
    else for (const key of records[remove[1]].keys()) if (JSON.parse(key)[0] === p[0]) records[remove[1]].delete(key);
  },
  async transaction(body) {
    const before = structuredClone(records);
    try { return await body(driver); } catch (e) { records = before; throw e; }
  },
  async close() {},
};
const fixturePath = '../packet/source/snapback2/packages/evaluator/src/test-search-v5-fixtures.json';
const { nativeR8: { halo } } = JSON.parse(readFileSync(fixturePath, 'utf8'));
let rejectNext = false;
const backend = new SqliteBackend(driver, { beforeCommit() { if (rejectNext) { rejectNext = false; throw new Error('synthetic transaction rejection'); } } });
const runtime = new OfflineRuntime({ store: () => new PersistentRangeStore(backend) });
const principal = halo.first.authority.principal;
await runtime.open(principal, true);
await runtime.program(halo.program);
await runtime.commit('clock.fixed', {}, await runtime.accept('clock.fixed', {}, halo.first));
await runtime.resetCoverage(halo.first.authority.authEpoch);
assert.equal(runtime.resetNeeded, true);
const pending = (await runtime.coverage()).superseded;
rejectNext = true;
await assert.rejects(runtime.completeReset(runtime.coverageRevision), /synthetic transaction rejection/);
assert.equal(runtime.resetNeeded, true);
assert.deepEqual((await runtime.coverage()).superseded, pending);
const offset = statements.length;
assert.equal(await runtime.completeReset(runtime.coverageRevision), true);
const inMemory = (await runtime.coverage()).superseded;
assert.equal(runtime.resetNeeded, false);
assert.equal(inMemory, undefined);
const clearStatements = statements.slice(offset);
const staleMetadata = [...records.metadata].filter(([key]) => key.includes('superseded'));
await runtime.close();
await runtime.open(principal, true);
const reopened = (await runtime.coverage()).superseded;
assert.deepEqual(reopened, pending);
assert.equal(runtime.resetNeeded, true);
await runtime.close();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const result = {
  source: '2ce04895fa833ef40d8aad4e06b86c4ddae29a8c',
  runtime: { node: process.version, platform: process.platform, arch: process.arch, binarySha256: hash(process.execPath) },
  artifactSha256: hash('./artifacts/snapback2/packages/snapback2/dist/sqlite-test.mjs'),
  imageRuntimeSha256: hash('./artifacts/snapback2/packages/snapback2/dist/image-runtime.mjs'),
  fixtureSha256: hash(fixturePath),
  attribution: 'Frozen native26c9 halo fixture through checked OfflineRuntime admission; public resetCoverage/completeReset/close/open; shipped SqliteBackend JS with synthetic transactional map driver. No native operations.',
  failedClearRolledBack: true,
  successfulClear: { returned: true, resetNeeded: false, coverageHasSuperseded: inMemory !== undefined },
  clearStatements,
  staleMetadata,
  reopened: { resetNeeded: true, superseded: reopened },
  elapsedMs: performance.now() - start,
};
writeFileSync('probe-metadata-result.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
