import type { ClientStorage, FrameHeader, FramePatch, StoragePatch, StoredState } from './types.js';
import { SnapbackError } from './types.js';

const empty = (): StoredState => ({ version: 1, session: null, manifest: null, frame: null, operations: [] });
export const rowKey = (row: { table: string; id: string }): string => JSON.stringify([row.table, row.id]);

function sameFrame(a: FrameHeader, b: FrameHeader): boolean {
  return a.seq === b.seq && a.generation === b.generation && a.schemaHash === b.schemaHash
    && a.principal === b.principal && a.authEpoch === b.authEpoch;
}

function admitFrame(state: Pick<StoredState, 'session' | 'manifest'>, frame: FramePatch): boolean {
  return state.session?.principal.id === frame.principal && state.session.authEpoch === frame.authEpoch
    && state.manifest?.generation === frame.generation && state.manifest.schemaHash === frame.schemaHash;
}

function merge(state: StoredState, patch: StoragePatch): StoredState {
  const next = { ...state };
  if (patch.session !== undefined) { next.session = patch.session; next.frame = null; }
  if (patch.manifest) next.manifest = patch.manifest;
  if (patch.frame === null) next.frame = null;
  if (patch.frame && admitFrame(next, patch.frame)) {
    const old = next.frame;
    if (!old || old.generation !== patch.frame.generation || old.seq <= patch.frame.seq) {
      const together = old && sameFrame(old, patch.frame);
      const rows = new Map((together ? old.rows : []).map(row => [rowKey(row), row]));
      const resources = new Map((together ? old.resources : []).map(resource => [resource.key, resource]));
      for (const row of patch.frame.rows) rows.set(rowKey(row), row);
      for (const resource of patch.frame.resources) resources.set(resource.key, resource);
      next.frame = { ...patch.frame, rows: [...rows.values()], resources: [...resources.values()] };
    }
  }
  if (patch.operations) {
    const operations = new Map(next.operations.map(operation => [operation.id, operation]));
    for (const operation of patch.operations) operations.set(operation.id, operation);
    next.operations = [...operations.values()];
  }
  return next;
}

/** Share this adapter between clients to exercise close/reopen without a browser. */
export function createMemoryStorage(): ClientStorage {
  let state = empty();
  let tail = Promise.resolve();
  const listeners = new Set<(event: { source?: string; type: 'authority' }) => void>();
  return {
    async load() { await tail; return structuredClone(state); },
    write(patch) {
      const owned = structuredClone(patch);
      const next = tail.then(() => {
        state = merge(state, owned);
        if (patch.session !== undefined) for (const listener of listeners) listener({ source: patch.source, type: 'authority' });
      });
      tail = next.catch(() => {});
      return next;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** One transaction admits each batch. Rows and resources are separate object
 * stores so acquiring page N does not rewrite the first N−1 pages. */
// @ref LLP 2000#the-client-data-model — normalized durable rows and operation
// identity have one owner; persistence grows with each admitted batch.
export function createIndexedDBStorage(name: string, factory: IDBFactory = globalThis.indexedDB): ClientStorage {
  let opened: Promise<IDBDatabase> | undefined;
  const listeners = new Set<(event: { source?: string; type: 'authority' }) => void>();
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(`snapback3-authority:${name}`);
  if (channel) channel.onmessage = event => {
    if (event.data?.type === 'authority') for (const listener of listeners) listener(event.data);
  };
  const open = (): Promise<IDBDatabase> => opened ??= new Promise((resolve, reject) => {
    if (!factory) { reject(new SnapbackError('S3_STORAGE', 'IndexedDB is unavailable.')); return; }
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      for (const store of ['state', 'rows', 'resources', 'operations']) request.result.createObjectStore(store);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new SnapbackError('S3_STORAGE', 'Close the older Snapback tab to open local storage.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
  const requestValue = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const completion = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new SnapbackError('S3_STORAGE', 'Local transaction was aborted.'));
    transaction.onerror = () => {};
  });
  return {
    async load() {
      const db = await open();
      const transaction = db.transaction(['state', 'rows', 'resources', 'operations'], 'readonly');
      const done = completion(transaction);
      const state = transaction.objectStore('state');
      const [session, manifest, header, rows, resources, operations] = await Promise.all([
        requestValue(state.get('session')), requestValue(state.get('manifest')), requestValue(state.get('frame')),
        requestValue(transaction.objectStore('rows').getAll()), requestValue(transaction.objectStore('resources').getAll()),
        requestValue(transaction.objectStore('operations').getAll()),
      ]);
      await done;
      return { version: 1, session: session ?? null, manifest: manifest ?? null,
        frame: header ? { ...header, rows, resources } : null, operations };
    },
    async write(input) {
      const patch = structuredClone(input);
      const db = await open();
      const transaction = db.transaction(['state', 'rows', 'resources', 'operations'], 'readwrite');
      const done = completion(transaction);
      const state = transaction.objectStore('state');
      // Read/merge/write all happen inside this transaction, including across tabs.
      const requests = [state.get('session'), state.get('manifest'), state.get('frame')];
      let remaining = requests.length;
      for (const request of requests) request.onsuccess = () => {
        if (--remaining !== 0) return;
        try {
          let [session, manifest, header] = requests.map(item => item.result);
          const clear = () => {
            transaction.objectStore('rows').clear();
            transaction.objectStore('resources').clear();
            state.delete('frame'); header = null;
          };
          if (patch.session !== undefined) { session = patch.session; state.put(session, 'session'); clear(); }
          if (patch.manifest) { manifest = patch.manifest; state.put(manifest, 'manifest'); }
          if (patch.frame === null) clear();
          const frame = patch.frame;
          if (frame && admitFrame({ session, manifest }, frame)
            && (!header || header.generation !== frame.generation || header.seq <= frame.seq)) {
            if (!header || !sameFrame(header, frame)) clear();
            const { rows, resources, ...nextHeader } = frame;
            for (const row of rows) transaction.objectStore('rows').put(row, rowKey(row));
            for (const resource of resources) transaction.objectStore('resources').put(resource, resource.key);
            state.put(nextHeader, 'frame');
          }
          for (const operation of patch.operations ?? []) transaction.objectStore('operations').put(operation, operation.id);
        } catch { transaction.abort(); }
      };
      await done;
      if (patch.session !== undefined) {
        const event = { source: patch.source, type: 'authority' as const };
        channel?.postMessage(event);
        for (const listener of listeners) listener(event);
      }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { channel?.close(); listeners.clear(); void opened?.then(db => db.close()); },
  };
}
