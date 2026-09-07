// Independent bounded diagnostic of the public backend with an in-memory SQL driver.
// No database library, native checker, compiler, server or build is invoked.
import { resolve } from 'node:path';
const root = resolve(process.argv[2]);
const { SqliteBackend } = await import(root + '/snapback2/packages/snapback2/src/store/sqlite.ts');
const { emptyState, jsonState } = await import(root + '/snapback2/packages/snapback2/src/store/range-store.ts');
function memoryDriver(identity: string) {
  let data = new Map<string, Map<string, string>>();
  let transactions = 0;
  const table = (name: string) => {
    let rows = data.get(name); if (!rows) data.set(name, rows = new Map()); return rows;
  };
  const driver = {
    identity, async exec() {}, async close() {},
    async get(sql: string, params: any[] = []) {
      if (sql === 'PRAGMA journal_mode=WAL') return { journal_mode: 'wal' };
      if (sql === 'SELECT value FROM state WHERE partition = ?') {
        const value = table('state').get(JSON.stringify([params[0]]));
        return value === undefined ? undefined : { value };
      }
      throw Error('Unexpected get: ' + sql);
    },
    async all(sql: string, params: any[]) {
      const match = /^SELECT key, value FROM (rows|answers|outbox|metadata) WHERE partition = \?$/.exec(sql);
      if (!match) throw Error('Unexpected all: ' + sql);
      return [...table(match[1])].flatMap(([encoded, value]) => {
        const [partition, key] = JSON.parse(encoded); return partition === params[0] ? [{ key, value }] : [];
      });
    },
    async run(sql: string, params: any[]) {
      let match = /^INSERT OR REPLACE INTO (state|metadata|rows|answers|outbox) /.exec(sql);
      if (match) {
        table(match[1]).set(JSON.stringify(match[1] === 'state' ? [params[0]] : params.slice(0, 2)), params.at(-1)); return;
      }
      match = /^DELETE FROM (state|metadata|rows|answers|outbox) WHERE /.exec(sql);
      if (match) { table(match[1]).delete(JSON.stringify(params)); return; }
      throw Error('Unexpected run: ' + sql);
    },
    async transaction(body: (tx: unknown) => unknown) {
      transactions++; const previous = structuredClone(data);
      try { return await body(driver); } catch (error) { data = previous; throw error; }
    },
    get transactions() { return transactions; },
  };
  return driver;
}
const results = [];
for (const scenario of [
  { name: 'existing-object-child-to-undefined', initial: { a: 1, b: 2 }, next: { a: undefined, b: 2 } },
  { name: 'trailing-array-hole', initial: ['a'], next: new Array(3) },
]) {
  const driver = memoryDriver('astra-projection-' + scenario.name);
  const backend = new SqliteBackend(driver);
  await backend.open('probe');
  const state = { ...emptyState(), futureMetadata: scenario.initial };
  await backend.replace(state, { put: [], remove: [] });
  const next = { ...state, futureMetadata: scenario.next }, beforeTransactions = driver.transactions;
  let failure;
  try { await backend.replace(next, { put: [], remove: [] }); }
  catch (error) { failure = { name: error.name, code: error.code, message: error.message }; }
  const replacementTransactions = driver.transactions - beforeTransactions;
  await backend.close(); const reopened = await backend.open('probe'); await backend.close();
  results.push({ name: scenario.name, expected: jsonState(next).futureMetadata,
    reopened: reopened.futureMetadata, failure, replacementTransactions });
}
console.log(JSON.stringify({ root, runtime: process.version, bun: Bun.version,
  attribution: 'exact exported public SqliteBackend source; synthetic transactional Map driver, no real SQLite', results }, null, 2));
