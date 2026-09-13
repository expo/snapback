import type { ClientStorage, FrameHeader, FramePatch, StoragePatch, StoredState } from './types.js';
import { SnapbackError } from './types.js';
import { cloneJson, notifyObservers, reportObserverError } from './signal.js';

const empty = (): StoredState => ({ version: 2, session: null, manifest: null, frame: null, operations: [],
  acquisitions: [], acquisitionRows: [], acquisitionResources: [], acquisitionFloor: 0, acquisitionsInvalidated: false });
export const rowKey = (row: { table: string; id: string }): string => JSON.stringify([row.table, row.id]);

export function sameFrame(a: FrameHeader, b: FrameHeader): boolean {
  return a.seq === b.seq && a.generation === b.generation && a.schemaHash === b.schemaHash
    && a.principal === b.principal && a.authEpoch === b.authEpoch;
}

export function admitFrame(state: Pick<StoredState, 'session' | 'manifest'>, frame: FramePatch): boolean {
  return state.session?.principal.id === frame.principal && state.session.authEpoch === frame.authEpoch
    && state.manifest?.generation === frame.generation && state.manifest.schemaHash === frame.schemaHash;
}

export function matchesSession(session: StoredState['session'], expected: NonNullable<StoragePatch['clearSession']>): boolean {
  return session?.token === expected.token && session.principal.id === expected.principal
    && session.authEpoch === expected.authEpoch;
}

export function admitAcquisition(state: Pick<StoredState, 'session' | 'manifest' | 'acquisitionFloor'>,
  acquisition: NonNullable<StoragePatch['acquisition']>['acquisition']): boolean {
  return state.session?.principal.id === acquisition.principal && state.session.authEpoch === acquisition.authEpoch
    && state.manifest?.generation === acquisition.generation && state.manifest.schemaHash === acquisition.schemaHash
    && (acquisition.seq === undefined || acquisition.seq >= (state.acquisitionFloor ?? 0));
}

export function matchesAcquisition(acquisition: NonNullable<StoredState['acquisitions']>[number] | undefined,
  expected: NonNullable<NonNullable<StoragePatch['clearSession']>['acquisition']>): boolean {
  return acquisition?.id === expected.id && acquisition.declarationHash === expected.declarationHash
    && acquisition.principal === expected.principal && acquisition.authEpoch === expected.authEpoch
    && acquisition.generation === expected.generation && acquisition.schemaHash === expected.schemaHash;
}

function matchesClearSession(state: Pick<StoredState, 'session' | 'acquisitions'>,
  expected: NonNullable<StoragePatch['clearSession']>): boolean {
  return matchesSession(state.session, expected) && (!expected.acquisition
    || matchesAcquisition(state.acquisitions?.find(item => item.id === expected.acquisition!.id), expected.acquisition));
}

export const acquisitionRejected = (): SnapbackError => new SnapbackError('S3_STORAGE',
  'The acquisition checkpoint was rejected because its durable authority or sequence changed.');
export const manifestRejected = (): SnapbackError => new SnapbackError('S3_STORAGE',
  'The application generation was rejected because it predates durable acquisition authority.');

function merge(state: StoredState, patch: StoragePatch): StoredState {
  const next: StoredState = { ...state, version: 2, acquisitions: state.acquisitions ?? [],
    acquisitionRows: state.acquisitionRows ?? [], acquisitionResources: state.acquisitionResources ?? [] };
  const conditionalClear = patch.clearSession !== undefined && matchesClearSession(next, patch.clearSession);
  if (patch.session !== undefined || conditionalClear) {
    next.session = patch.session !== undefined ? patch.session : null; next.frame = null; next.acquisitions = []; next.acquisitionRows = [];
    next.acquisitionResources = []; next.acquisitionFloor = 0; next.acquisitionsInvalidated = false;
  }
  if (patch.manifest) {
    const changed = next.manifest !== null && (next.manifest.generation !== patch.manifest.generation
      || next.manifest.schemaHash !== patch.manifest.schemaHash);
    if (changed && patch.manifest.seq < (next.acquisitionFloor ?? 0)) throw manifestRejected();
    next.manifest = patch.manifest;
    if (changed) {
      next.frame = null; next.acquisitions = []; next.acquisitionRows = []; next.acquisitionResources = [];
      next.acquisitionFloor = patch.manifest.seq; next.acquisitionsInvalidated = false;
    }
  }
  if (patch.acquisitionFloor !== undefined) next.acquisitionFloor = Math.max(next.acquisitionFloor ?? 0, patch.acquisitionFloor);
  if (patch.acquisitionsInvalidated !== undefined) next.acquisitionsInvalidated = patch.acquisitionsInvalidated;
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
  if (patch.clearAcquisitions) {
    next.acquisitions = []; next.acquisitionRows = []; next.acquisitionResources = [];
  }
  if (patch.invalidateAcquisitions) next.acquisitions = next.acquisitions!.map(item => ({ ...item,
    status: 'acquiring' as const, phase: 'validate' as const, pending: [] }));
  if (patch.cancelAcquisition && matchesSession(next.session, patch.cancelAcquisition))
    next.acquisitions = next.acquisitions!.map(item => matchesAcquisition(item, patch.cancelAcquisition!)
      ? { ...item, status: 'cancelled' as const } : item);
  if (patch.acquisition) {
    if (!admitAcquisition(next, patch.acquisition.acquisition)) throw acquisitionRejected();
    const acquisitions = new Map(next.acquisitions!.map(item => [item.id, item]));
    const rows = new Map(next.acquisitionRows!.map(item => [item.versionKey, item]));
    const resources = new Map(next.acquisitionResources!.map(item => [`${item.acquisitionId}:${item.key}`, item]));
    acquisitions.set(patch.acquisition.acquisition.id, patch.acquisition.acquisition);
    for (const row of patch.acquisition.rows) rows.set(row.versionKey, row);
    for (const resource of patch.acquisition.resources) resources.set(`${resource.acquisitionId}:${resource.key}`, resource);
    next.acquisitions = [...acquisitions.values()]; next.acquisitionRows = [...rows.values()];
    next.acquisitionResources = [...resources.values()];
  }
  return next;
}

/** Share this adapter between clients to exercise close/reopen without a browser. */
export function createMemoryStorage(): ClientStorage {
  let state = empty();
  let tail = Promise.resolve();
  const listeners = new Set<(event: { source?: string; type: 'authority' }) => void>();
  return {
    async load() { await tail; return cloneJson(state, 'S3_STORAGE'); },
    write(patch) {
      const owned = cloneJson(patch, 'S3_STORAGE');
      const next = tail.then(() => {
        const authorityChanged = owned.session !== undefined
          || owned.clearSession !== undefined && matchesClearSession(state, owned.clearSession);
        state = merge(state, owned);
        if (authorityChanged) notifyObservers(listeners, { source: owned.source, type: 'authority' });
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
    if (event.data?.type === 'authority') notifyObservers(listeners, event.data);
  };
  const open = (): Promise<IDBDatabase> => opened ??= new Promise((resolve, reject) => {
    if (!factory) { reject(new SnapbackError('S3_STORAGE', 'IndexedDB is unavailable.')); return; }
    const request = factory.open(name, 2);
    request.onupgradeneeded = () => {
      for (const store of ['state', 'rows', 'resources', 'operations', 'acquisitions', 'acquisitionRows', 'acquisitionResources']) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      }
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
      const transaction = db.transaction(['state', 'rows', 'resources', 'operations',
        'acquisitions', 'acquisitionRows', 'acquisitionResources'], 'readonly');
      const done = completion(transaction);
      const state = transaction.objectStore('state');
      const [session, manifest, header, acquisitionFloor, acquisitionsInvalidated, rows, resources, operations,
        acquisitions, acquisitionRows, acquisitionResources] = await Promise.all([
        requestValue(state.get('session')), requestValue(state.get('manifest')), requestValue(state.get('frame')),
        requestValue(state.get('acquisitionFloor')), requestValue(state.get('acquisitionsInvalidated')),
        requestValue(transaction.objectStore('rows').getAll()), requestValue(transaction.objectStore('resources').getAll()),
        requestValue(transaction.objectStore('operations').getAll()), requestValue(transaction.objectStore('acquisitions').getAll()),
        requestValue(transaction.objectStore('acquisitionRows').getAll()), requestValue(transaction.objectStore('acquisitionResources').getAll()),
      ]);
      await done;
      return { version: 2, session: session ?? null, manifest: manifest ?? null,
        frame: header ? { ...header, rows, resources } : null, operations, acquisitions, acquisitionRows, acquisitionResources,
        acquisitionFloor: acquisitionFloor ?? 0, acquisitionsInvalidated: acquisitionsInvalidated ?? false };
    },
    async write(input) {
      const patch = cloneJson(input, 'S3_STORAGE');
      const db = await open();
      const transaction = db.transaction(['state', 'rows', 'resources', 'operations',
        'acquisitions', 'acquisitionRows', 'acquisitionResources'], 'readwrite');
      const done = completion(transaction);
      const state = transaction.objectStore('state');
      let authorityChanged = patch.session !== undefined;
      // Read/merge/write all happen inside this transaction, including across tabs.
      const requests = [state.get('session'), state.get('manifest'), state.get('frame'),
        state.get('acquisitionFloor'), state.get('acquisitionsInvalidated')];
      if (patch.clearSession?.acquisition) requests.push(
        transaction.objectStore('acquisitions').get(patch.clearSession.acquisition.id));
      let remaining = requests.length;
      for (const request of requests) request.onsuccess = () => {
        if (--remaining !== 0) return;
        try {
          let [session, manifest, header, acquisitionFloor, acquisitionsInvalidated] = requests.map(item => item.result);
          const clear = () => {
            transaction.objectStore('rows').clear();
            transaction.objectStore('resources').clear();
            state.delete('frame'); header = null;
          };
          const clearAcquisitions = () => {
            transaction.objectStore('acquisitions').clear();
            transaction.objectStore('acquisitionRows').clear();
            transaction.objectStore('acquisitionResources').clear();
          };
          const conditionalClear = patch.clearSession !== undefined && matchesSession(session ?? null, patch.clearSession)
            && (!patch.clearSession.acquisition || matchesAcquisition(requests[5]?.result, patch.clearSession.acquisition));
          if (patch.session !== undefined || conditionalClear) {
            authorityChanged ||= conditionalClear;
            session = patch.session !== undefined ? patch.session : null; state.put(session, 'session'); clear(); clearAcquisitions();
            acquisitionFloor = 0; acquisitionsInvalidated = false;
            state.put(0, 'acquisitionFloor'); state.put(false, 'acquisitionsInvalidated');
          }
          if (patch.manifest) {
            const changed = manifest !== undefined && manifest !== null
              && (manifest.generation !== patch.manifest.generation || manifest.schemaHash !== patch.manifest.schemaHash);
            if (changed && patch.manifest.seq < (acquisitionFloor ?? 0)) throw manifestRejected();
            manifest = patch.manifest; state.put(manifest, 'manifest');
            if (changed) {
              clear(); clearAcquisitions(); acquisitionFloor = manifest.seq; acquisitionsInvalidated = false;
              state.put(acquisitionFloor, 'acquisitionFloor'); state.put(false, 'acquisitionsInvalidated');
            }
          }
          if (patch.frame === null) clear();
          if (patch.acquisitionFloor !== undefined) {
            acquisitionFloor = Math.max(acquisitionFloor ?? 0, patch.acquisitionFloor);
            state.put(acquisitionFloor, 'acquisitionFloor');
          }
          if (patch.acquisitionsInvalidated !== undefined) {
            acquisitionsInvalidated = patch.acquisitionsInvalidated;
            state.put(acquisitionsInvalidated, 'acquisitionsInvalidated');
          }
          if (patch.clearAcquisitions) {
            clearAcquisitions();
          }
          if (patch.invalidateAcquisitions && !patch.clearAcquisitions) {
            const acquisitions = transaction.objectStore('acquisitions');
            const request = acquisitions.getAll();
            request.onsuccess = () => {
              for (const item of request.result) acquisitions.put({ ...item, status: 'acquiring', phase: 'validate', pending: [] }, item.id);
            };
          }
          if (patch.cancelAcquisition) {
            const acquisitions = transaction.objectStore('acquisitions');
            const expected = patch.cancelAcquisition, request = acquisitions.get(expected.id);
            request.onsuccess = () => {
              if (matchesSession(session ?? null, expected) && matchesAcquisition(request.result, expected))
                acquisitions.put({ ...request.result, status: 'cancelled' }, expected.id);
            };
          }
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
          if (patch.acquisition) {
            if (!admitAcquisition({ session, manifest, acquisitionFloor }, patch.acquisition.acquisition))
              throw acquisitionRejected();
            const { acquisition, rows, resources } = patch.acquisition;
            transaction.objectStore('acquisitions').put(acquisition, acquisition.id);
            for (const row of rows) transaction.objectStore('acquisitionRows').put(row, row.versionKey);
            for (const resource of resources) transaction.objectStore('acquisitionResources')
              .put(resource, `${resource.acquisitionId}:${resource.key}`);
          }
        } catch { transaction.abort(); }
      };
      await done;
      if (authorityChanged) {
        const event = { source: patch.source, type: 'authority' as const };
        try { channel?.postMessage(event); } catch (error) { reportObserverError(error); }
        notifyObservers(listeners, event);
      }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { channel?.close(); listeners.clear(); void opened?.then(db => db.close()); },
  };
}
