import type { ClientStorage, FrameHeader, StoragePatch, StoredAcquisition, StoredState } from './types.js';
import { SnapbackError } from './types.js';
import { acquisitionRejected, admitAcquisition, admitFrame, manifestRejected, matchesAcquisition,
  matchesSession, rowKey, sameFrame } from './storage.js';
import type { SqliteDriver, SqliteExecutor } from './sqlite-driver.js';
import { cloneJson, notifyObservers } from './signal.js';

export type { SqliteDriver, SqliteExecutor, SqliteParams, SqliteValue } from './sqlite-driver.js';

type DriverSource = SqliteDriver | (() => SqliteDriver | Promise<SqliteDriver>);
type AuthorityEvent = { source?: string; type: 'authority' };
type Listener = (event: AuthorityEvent) => void;
type JsonRow = { value: string };

export interface SQLiteStorage extends ClientStorage {
  close(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS s3_state (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS s3_rows (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS s3_resources (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS s3_operations (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS s3_acquisitions (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS s3_acquisition_rows (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS s3_acquisition_resources (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`;

// Separate adapter instances in one native JavaScript runtime observe the same
// authority transition after its transaction commits. A host with multiple JS
// runtimes can add its own bridge around ClientStorage.subscribe.
type DatabaseGroup = { peers: Set<Listener>; tail: Promise<void> };
const groups = new Map<string, DatabaseGroup>();

const encode = (value: unknown): string => JSON.stringify(value);
const decode = <T>(row: JsonRow | undefined): T | undefined => row ? JSON.parse(row.value) as T : undefined;
const readOne = async <T>(tx: SqliteExecutor, table: string, key: string): Promise<T | undefined> =>
  decode<T>(await tx.get<JsonRow>(`SELECT value FROM ${table} WHERE key = ?`, [key]));
const readAll = async <T>(tx: SqliteExecutor, table: string, order = 'key'): Promise<T[]> =>
  (await tx.all<JsonRow>(`SELECT value FROM ${table} ORDER BY ${order}`)).map(row => JSON.parse(row.value) as T);
const put = (tx: SqliteExecutor, table: string, key: string, value: unknown): Promise<void> =>
  tx.run(`INSERT INTO ${table} (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, encode(value)]);
const remove = (tx: SqliteExecutor, table: string, key: string): Promise<void> =>
  tx.run(`DELETE FROM ${table} WHERE key = ?`, [key]);
const clear = (tx: SqliteExecutor, table: string): Promise<void> => tx.run(`DELETE FROM ${table}`);

function storageClosed(): SnapbackError {
  return new SnapbackError('S3_STORAGE', 'This SQLite storage adapter is closed.');
}

/** Normalized durable ClientStorage over a host-provided async SQLite driver.
 * The adapter owns the driver and closes it when close() is called. */
// @ref LLP 2000#16-making-acquisition-fast — every bounded checkpoint and
// the data/evidence it certifies enter one transaction, without whole-state rewrites.
export function createSQLiteStorage(source: DriverSource): SQLiteStorage {
  let opened: Promise<SqliteDriver> | undefined;
  let identity: string | undefined;
  let closed = false;
  let tail = Promise.resolve();
  const listeners = new Set<Listener>();
  const peer: Listener = event => notifyObservers(listeners, event);

  const enqueue = <T>(body: () => Promise<T>): Promise<T> => {
    const result = tail.then(body);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const detach = (): void => {
    if (!identity) return;
    const group = groups.get(identity);
    group?.peers.delete(peer);
    if (group?.peers.size === 0) groups.delete(identity);
    identity = undefined;
  };
  const open = (): Promise<SqliteDriver> => {
    if (closed) return Promise.reject(storageClosed());
    return opened ??= Promise.resolve().then(() => typeof source === 'function' ? source() : source).then(async driver => {
      try {
        if (!driver || typeof driver.identity !== 'string' || driver.identity.length === 0)
          throw new SnapbackError('S3_STORAGE', 'The SQLite driver needs a stable database identity.');
        await driver.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
        await driver.exec(SCHEMA);
        identity = driver.identity;
        let group = groups.get(identity);
        if (!group) groups.set(identity, group = { peers: new Set(), tail: Promise.resolve() });
        group.peers.add(peer);
        return driver;
      } catch (error) {
        await driver?.close().catch(() => undefined);
        throw error;
      }
    }).catch(error => { opened = undefined; throw error; });
  };
  const databaseJob = <T>(body: () => Promise<T>): Promise<T> => {
    if (!identity) return Promise.reject(storageClosed());
    const group = groups.get(identity);
    if (!group) return Promise.reject(storageClosed());
    const result = group.tail.then(body);
    group.tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const publish = (event: AuthorityEvent): void => {
    if (!identity) return;
    notifyObservers(groups.get(identity)?.peers ?? [], event);
  };

  return {
    load: () => enqueue(async () => {
      const driver = await open();
      return databaseJob(() => driver.transaction(async tx => {
        const session = await readOne<StoredState['session']>(tx, 's3_state', 'session');
        const manifest = await readOne<StoredState['manifest']>(tx, 's3_state', 'manifest');
        const header = await readOne<FrameHeader>(tx, 's3_state', 'frame');
        const acquisitionFloor = await readOne<number>(tx, 's3_state', 'acquisitionFloor');
        const acquisitionsInvalidated = await readOne<boolean>(tx, 's3_state', 'acquisitionsInvalidated');
        const rows = await readAll<NonNullable<StoredState['frame']>['rows'][number]>(tx, 's3_rows');
        const resources = await readAll<NonNullable<StoredState['frame']>['resources'][number]>(tx, 's3_resources');
        const operations = await readAll<StoredState['operations'][number]>(tx, 's3_operations', 'ordinal');
        const acquisitions = await readAll<NonNullable<StoredState['acquisitions']>[number]>(tx, 's3_acquisitions');
        const acquisitionRows = await readAll<NonNullable<StoredState['acquisitionRows']>[number]>(tx, 's3_acquisition_rows');
        const acquisitionResources = await readAll<NonNullable<StoredState['acquisitionResources']>[number]>(
          tx, 's3_acquisition_resources');
        return { version: 2, session: session ?? null, manifest: manifest ?? null,
          frame: header ? { ...header, rows, resources } : null, operations, acquisitions, acquisitionRows,
          acquisitionResources, acquisitionFloor: acquisitionFloor ?? 0,
          acquisitionsInvalidated: acquisitionsInvalidated ?? false } satisfies StoredState;
      }));
    }),

    write(input) {
      const patch = cloneJson(input, 'S3_STORAGE');
      return enqueue(async () => {
        const driver = await open();
        let authorityChanged = false;
        await databaseJob(async () => {
          await driver.transaction(async tx => {
          let session = await readOne<StoredState['session']>(tx, 's3_state', 'session') ?? null;
          let manifest = await readOne<StoredState['manifest']>(tx, 's3_state', 'manifest') ?? null;
          let header = await readOne<FrameHeader>(tx, 's3_state', 'frame');
          let acquisitionFloor = await readOne<number>(tx, 's3_state', 'acquisitionFloor') ?? 0;
          let acquisitionsInvalidated = await readOne<boolean>(tx, 's3_state', 'acquisitionsInvalidated') ?? false;
          const guardedAcquisition = patch.clearSession?.acquisition
            ? await readOne<StoredAcquisition>(tx, 's3_acquisitions', patch.clearSession.acquisition.id)
            : undefined;

          const clearFrame = async (): Promise<void> => {
            await clear(tx, 's3_rows');
            await clear(tx, 's3_resources');
            await remove(tx, 's3_state', 'frame');
            header = undefined;
          };
          const clearAcquisitions = async (): Promise<void> => {
            await clear(tx, 's3_acquisitions');
            await clear(tx, 's3_acquisition_rows');
            await clear(tx, 's3_acquisition_resources');
          };
          const conditionalClear = patch.clearSession !== undefined
            && matchesSession(session, patch.clearSession)
            && (!patch.clearSession.acquisition
              || matchesAcquisition(guardedAcquisition, patch.clearSession.acquisition));

          if (patch.session !== undefined || conditionalClear) {
            authorityChanged = true;
            session = patch.session !== undefined ? patch.session : null;
            await put(tx, 's3_state', 'session', session);
            await clearFrame();
            await clearAcquisitions();
            acquisitionFloor = 0;
            acquisitionsInvalidated = false;
            await put(tx, 's3_state', 'acquisitionFloor', 0);
            await put(tx, 's3_state', 'acquisitionsInvalidated', false);
          }

          if (patch.manifest) {
            const changed = manifest !== null && (manifest.generation !== patch.manifest.generation
              || manifest.schemaHash !== patch.manifest.schemaHash);
            if (changed && patch.manifest.seq < acquisitionFloor) throw manifestRejected();
            manifest = patch.manifest;
            await put(tx, 's3_state', 'manifest', manifest);
            if (changed) {
              await clearFrame();
              await clearAcquisitions();
              acquisitionFloor = manifest.seq;
              acquisitionsInvalidated = false;
              await put(tx, 's3_state', 'acquisitionFloor', acquisitionFloor);
              await put(tx, 's3_state', 'acquisitionsInvalidated', false);
            }
          }

          if (patch.frame === null) await clearFrame();
          if (patch.acquisitionFloor !== undefined) {
            acquisitionFloor = Math.max(acquisitionFloor, patch.acquisitionFloor);
            await put(tx, 's3_state', 'acquisitionFloor', acquisitionFloor);
          }
          if (patch.acquisitionsInvalidated !== undefined) {
            acquisitionsInvalidated = patch.acquisitionsInvalidated;
            await put(tx, 's3_state', 'acquisitionsInvalidated', acquisitionsInvalidated);
          }
          if (patch.clearAcquisitions) await clearAcquisitions();
          if (patch.invalidateAcquisitions && !patch.clearAcquisitions) {
            for (const item of await readAll<StoredAcquisition>(tx, 's3_acquisitions')) {
              await put(tx, 's3_acquisitions', item.id, { ...item, status: 'acquiring', phase: 'validate', pending: [] });
            }
          }
          if (patch.cancelAcquisition) {
            const expected = patch.cancelAcquisition;
            const acquisition = await readOne<StoredAcquisition>(tx, 's3_acquisitions', expected.id);
            if (matchesSession(session, expected) && matchesAcquisition(acquisition, expected))
              await put(tx, 's3_acquisitions', expected.id, { ...acquisition, status: 'cancelled' });
          }

          const frame = patch.frame;
          if (frame && admitFrame({ session, manifest }, frame)
            && (!header || header.generation !== frame.generation || header.seq <= frame.seq)) {
            if (!header || !sameFrame(header, frame)) await clearFrame();
            const { rows, resources, ...nextHeader } = frame;
            for (const row of rows) await put(tx, 's3_rows', rowKey(row), row);
            for (const resource of resources) await put(tx, 's3_resources', resource.key, resource);
            await put(tx, 's3_state', 'frame', nextHeader);
            header = nextHeader;
          }

          for (const operation of patch.operations ?? []) {
            await tx.run(`INSERT INTO s3_operations (id, value) VALUES (?, ?)
              ON CONFLICT(id) DO UPDATE SET value = excluded.value`, [operation.id, encode(operation)]);
          }

          if (patch.acquisition) {
            if (!admitAcquisition({ session, manifest, acquisitionFloor }, patch.acquisition.acquisition))
              throw acquisitionRejected();
            const { acquisition, rows, resources } = patch.acquisition;
            await put(tx, 's3_acquisitions', acquisition.id, acquisition);
            for (const row of rows) await put(tx, 's3_acquisition_rows', row.versionKey, row);
            for (const resource of resources)
              await put(tx, 's3_acquisition_resources', `${resource.acquisitionId}:${resource.key}`, resource);
          }
          });
          if (authorityChanged) publish({ source: patch.source, type: 'authority' });
        });
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    close: () => enqueue(async () => {
      if (closed) return;
      closed = true;
      const pending = opened;
      opened = undefined;
      listeners.clear();
      try {
        if (pending) {
          const driver = await pending;
          await databaseJob(() => driver.close());
        }
      } finally { detach(); }
    }),
  };
}
