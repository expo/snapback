// @ref LLP 0155#p6-stronger-claims-require-stronger-evidence — this page
// runs the shipped store against browser-native IndexedDB and Web Locks; the
// Node driver owns actual process death and profile reuse.
import {
  createIndexedDbRqsResumeStore,
  rqsEntryKey,
  verifyPersistedResumeEntry,
} from '/packages/snapback-client/rqs-store.mjs';
import {argsHash, digestOfRows} from '/packages/snapback-client/rqs.mjs';

let store = null;
let databaseName = null;
const queryName = 'stage0BrowserFixture';
const queryArgs = Object.freeze({fixture: 'llp-0155-stage0'});
const key = rqsEntryKey(queryName, queryArgs);

const entry = (version, value) => {
  const rows = [{_id: 'stage0-browser-row', value}];
  return {
    rows,
    meta: {
      app: 'llp-0155-stage0-browser-harness',
      generation: 'gen1:stage0-browser',
      versionStream: 'stream:stage0-browser',
      queryArtifact: 'sha256:stage0-browser-fixture',
      argsHash: argsHash(queryArgs),
      contentDigest: digestOfRows('seq1', rows),
      version,
    },
    token: `sbrt1.stage0.${version}`,
  };
};

const api = Object.freeze({
  async open(name) {
    if (store !== null) throw new Error('store already open in this tab');
    databaseName = name;
    store = createIndexedDbRqsResumeStore({databaseName: name});
    return this.info();
  },

  info() {
    return {
      databaseName,
      indexedDb: typeof globalThis.indexedDB?.open === 'function',
      webLocks: typeof globalThis.navigator?.locks?.request === 'function',
      writer: store?.isWriter() ?? false,
      durability: store?.durability() ?? null,
      userAgent: globalThis.navigator.userAgent,
    };
  },

  async waitForWriter(timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (!store?.isWriter()) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return true;
  },

  async commit(version, value) {
    const result = await store.commit(key, entry(version, value));
    return {result, writer: store.isWriter()};
  },

  async load() {
    const persisted = await store.load(key);
    const verification = persisted === null
      ? {ok: false, reason: 'missing'}
      : verifyPersistedResumeEntry(persisted, {args: queryArgs});
    return {
      persisted,
      verification,
      writer: store.isWriter(),
    };
  },

  async storageFacts() {
    return {
      persisted: typeof navigator.storage?.persisted === 'function'
        ? await navigator.storage.persisted()
        : null,
      estimate: typeof navigator.storage?.estimate === 'function'
        ? await navigator.storage.estimate()
        : null,
    };
  },

  async close() {
    await store?.close();
    store = null;
  },
});

Object.defineProperty(globalThis, 'snapbackStage0Browser', {
  configurable: false,
  enumerable: true,
  writable: false,
  value: api,
});
document.querySelector('#status').textContent = 'ready';
