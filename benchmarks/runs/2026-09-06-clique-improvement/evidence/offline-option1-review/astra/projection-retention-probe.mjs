import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2], output = process.argv[3];
const { OfflineRuntime, PersistentRangeStore, SqliteBackend } = await import(pathToFileURL(root + '/snapback2/packages/snapback2/dist/sqlite-test.mjs'));
const { RowImage, imageCanonical } = await import(pathToFileURL(root + '/snapback2/packages/snapback2/dist/image-runtime.mjs'));
const { nativeR8: { halo } } = JSON.parse(readFileSync(root + '/snapback2/packages/evaluator/src/test-search-v5-fixtures.json', 'utf8'));

// This driver exercises the shipped JS backend/projection only. It opens no database,
// performs no native operations and retains no row values of its own.
let statements = 0;
const driver = {
  identity: 'astra-bounded-projection-retention',
  async exec() {},
  async get(sql) { return sql.startsWith('PRAGMA') ? { journal_mode: 'wal' } : undefined; },
  async all() { return []; },
  async run() { statements++; },
  async transaction(body) { return body(driver); },
  async close() {},
};
const backend = new SqliteBackend(driver);
const runtime = new OfflineRuntime({ store: () => new PersistentRangeStore(backend) });
await runtime.open(halo.first.authority.principal, true);
await runtime.program(halo.program);
await runtime.commit('clock.fixed', {}, await runtime.accept('clock.fixed', {}, halo.first));
const held = (await runtime.twin.hydrate()).store;
const rows = Object.entries(runtime.store.state.rows);
const mirrors = rows.map(([key, current]) => {
  const encoded = backend.projection.values.rows.get(key);
  return {
    key,
    typedCurrent: RowImage.is(current.row),
    effectiveSharesCurrent: held.byId(current.table, current.id) === current.row,
    retainedWireString: typeof encoded === 'string',
    wireBodyEqualsCurrent: typeof encoded === 'string' && imageCanonical(JSON.parse(encoded).row) === imageCanonical(current.row),
  };
});
const beforeClose = backend.projection.values.rows.size, factSlots = runtime.store.state.factSlots;
await runtime.close();
const result = {
  attribution: 'native26c9 initial halo fixture through checked OfflineRuntime admission; shipped SqliteBackend JS with a synthetic no-storage driver',
  rowCount: rows.length, factSlots,
  statements, beforeClose, afterClose: backend.projection.values.rows.size, mirrors,
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
