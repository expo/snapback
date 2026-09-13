import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { build } from 'rolldown';
import { DatabaseSync } from 'node:sqlite';

const output = await mkdtemp(join(tmpdir(), 'snapback3-sqlite-test-modules-'));
await build({
  input: {
    storage: resolve('packages/snapback3/src/resource/sqlite.ts'),
    node: resolve('packages/snapback3/src/node/sqlite.ts'),
    client: resolve('packages/snapback3/src/client.ts'),
    expo: resolve('packages/snapback3/src/expo.ts'),
    runtime: resolve('packages/evaluator/src/value-runtime.ts'),
    hash: resolve('packages/evaluator/src/hash.ts'),
    certificate: resolve('packages/evaluator/src/certificate-identity.ts'),
  },
  platform: 'node',
  transform: { target: 'es2022' },
  external: id => id.startsWith('node:'),
  plugins: [{
    name: 'expo-native-test-stubs',
    resolveId(id) { if (['expo-sqlite', 'expo-crypto', 'expo/fetch'].includes(id)) return `\0${id}`; },
    load(id) {
      if (id === '\0expo-sqlite') return 'export const defaultDatabaseDirectory = "/stub"; export const openDatabaseAsync = (...args) => globalThis.__snapback3ExpoSqlite.openDatabaseAsync(...args);';
      if (id === '\0expo-crypto') return 'export const randomUUID = () => globalThis.__snapback3ExpoId();';
      if (id === '\0expo/fetch') return 'export const fetch = (...args) => globalThis.__snapback3ExpoFetch(...args);';
    },
  }],
  output: { dir: output, format: 'esm', entryFileNames: '[name].mjs', chunkFileNames: 'shared-[hash].mjs' },
});
const { createSQLiteStorage } = await import(new URL(`file://${join(output, 'storage.mjs')}`));
const { nodeSqliteDriver } = await import(new URL(`file://${join(output, 'node.mjs')}`));
const { createClient } = await import(new URL(`file://${join(output, 'client.mjs')}`));
const { createExpoClient, createExpoSQLiteStorage, expoSqliteDriver } = await import(new URL(`file://${join(output, 'expo.mjs')}`));
const { schemaDigest } = await import(new URL(`file://${join(output, 'runtime.mjs')}`));
const { sha256 } = await import(new URL(`file://${join(output, 'hash.mjs')}`));
const { canonicalProgramJson } = await import(new URL(`file://${join(output, 'certificate.mjs')}`));
const clientFixture = JSON.parse(await readFile(resolve('corpus/named-helper-wrapped-scan.json'), 'utf8'));
const roots = [];
after(async () => {
  await rm(output, { recursive: true, force: true });
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
});

async function database(name) {
  const root = await mkdtemp(join(tmpdir(), 'snapback3-sqlite-'));
  roots.push(root);
  return join(root, name);
}

const session = (token = 'token-a', authEpoch = 1, principal = 'alice') => ({ token,
  principal: { id: principal, kind: 'user', name: principal }, authEpoch, expiresAt: 4_102_444_800_000 });
const manifest = (generation = 'generation-a', schemaHash = 'schema-a', seq = 10) => ({
  generation, schemaHash, schema: { tables: {} }, programs: {}, seq,
});
const row = (id, body = id) => ({ table: 'messages', id, row: { id, body } });
const resource = (key, rowKeys, seq = 10) => ({ key, op: 'messages.page', args: { c: null }, rowKeys,
  envelope: { protocol: 1, generation: 'generation-a', schemaHash: 'schema-a', planHash: 'plan',
    authority: { principal: 'alice', authEpoch: 1 }, state: 'complete', data: [], next: null, seq,
    receipt: { ranges: [], absences: [], verdicts: [] } } });
const frame = (seq, rows, resources, principal = 'alice') => ({ seq, generation: 'generation-a', schemaHash: 'schema-a',
  principal, authEpoch: 1, rows, resources });
const operation = (id, body = id) => ({ id, principal: 'alice',
  body: JSON.stringify({ op: 'messages.send', args: { body }, intent: id,
    planHash: 'a'.repeat(64), schemaHash: 'b'.repeat(64) }), status: 'queued', createdAt: 100 });
const checkpoint = (overrides = {}) => ({ id: 'history', declarationHash: 'declaration-a', principal: 'alice',
  authEpoch: 1, generation: 'generation-a', schemaHash: 'schema-a', status: 'acquiring', phase: 'traverse',
  seq: 10, rootKeys: ['rooms'], derivedDeclarations: [], pending: [], resourceKeys: [], pages: 0, ...overrides });
const acquisitionRow = (versionKey, id) => ({ versionKey, seq: 10, row: row(id) });
const acquisitionResource = (key, versionKeys) => ({ acquisitionId: 'history', key, chainKey: 'messages',
  op: 'messages.page', args: { c: null }, rowVersionKeys: versionKeys,
  envelope: resource(key, [], 10).envelope });
const cancellation = (stored, token = 'token-a') => ({ token, id: stored.id, declarationHash: stored.declarationHash,
  principal: stored.principal, authEpoch: stored.authEpoch, generation: stored.generation, schemaHash: stored.schemaHash });
const guardedClear = (stored, token = 'token-a', declarationHash = stored.declarationHash) => ({
  token, principal: stored.principal, authEpoch: stored.authEpoch,
  acquisition: { id: stored.id, declarationHash, principal: stored.principal, authEpoch: stored.authEpoch,
    generation: stored.generation, schemaHash: stored.schemaHash },
});

const clientManifest = () => {
  const ir = { ...structuredClone(clientFixture.program), name: 'cards.add', kind: 'Mutation',
    args: { columnId: 'Id', title: { Text: { max: 64 } } }, body: [{ Return: { Literal: 'Null' } }] };
  const certificate = { ...structuredClone(clientFixture.certificate), program: ir.name,
    plan_hash: sha256(canonicalProgramJson(ir)),
    write_sites: [{ site: 'add.0', table: 'cards', kind: 'insert', max_calls: 1 }] };
  return { generation: sha256('sqlite-client-test'), schemaHash: certificate.schema_hash,
    schema: structuredClone(clientFixture.schema), programs: { 'cards.add': {
      kind: 'mutation', ir, certificate, planHash: certificate.plan_hash,
    } }, seq: 5 };
};

class ClientBackend {
  manifest = clientManifest();
  calls = [];
  ledger = new Map();
  applied = 0;
  network = true;
  afterMutation;
  mutationAborted = 0;
  fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    const principal = new Headers(init.headers).get('Authorization')?.replace('Bearer token-', '') ?? '';
    const rawBody = init.body;
    this.calls.push({ path, body: rawBody, principal });
    if (!this.network) throw new TypeError('network disconnected');
    const body = rawBody ? JSON.parse(rawBody) : {};
    if (path === '/api/manifest') return jsonResponse(this.manifest);
    if (path === '/api/auth/persona') return jsonResponse(session(`token-${body.name}`, 1, body.name));
    if (path === '/api/auth/logout') return jsonResponse({ ok: true });
    if (path.startsWith('/api/operation/'))
      return jsonResponse(this.ledger.get(`${principal}:${path.split('/').at(-1)}`) ?? null);
    if (path === '/api/mutation') {
      const key = `${principal}:${body.intent}`;
      let receipt = this.ledger.get(key);
      if (!receipt) {
        receipt = { state: 'committed', intent: body.intent, seq: ++this.manifest.seq,
          data: { id: `created-${++this.applied}` } };
        this.ledger.set(key, receipt);
      }
      if (init.signal) init.signal.addEventListener('abort', () => { this.mutationAborted++; }, { once: true });
      await this.afterMutation?.(receipt);
      return jsonResponse(receipt);
    }
    throw new Error(`unexpected native client request ${path}`);
  };
}

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json' } });

async function eventually(predicate, message = 'condition did not become true') {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error(message);
}

function nodeBackedExpoModule(root, openedNames) {
  return {
    async openDatabaseAsync(name, options) {
      assert.deepEqual(options, { useNewConnection: true });
      openedNames.push(name);
      const database = new DatabaseSync(join(root, name));
      const executor = {
        async runAsync(sql, params = []) { database.prepare(sql).run(...params); },
        async getFirstAsync(sql, params = []) { return database.prepare(sql).get(...params) ?? null; },
        async getAllAsync(sql, params = []) { return database.prepare(sql).all(...params); },
      };
      return { ...executor,
        async execAsync(sql) { database.exec(sql); },
        async withExclusiveTransactionAsync(body) {
          database.exec('BEGIN IMMEDIATE');
          try { await body(executor); database.exec('COMMIT'); }
          catch (error) { database.exec('ROLLBACK'); throw error; }
        },
        async closeAsync() { database.close(); },
      };
    },
  };
}

test('real SQLite preserves normalized frames and FIFO queued operations across close/reopen', async () => {
  const path = await database('reopen.db');
  const first = createSQLiteStorage(nodeSqliteDriver(path));
  const firstRow = row('m1');
  await first.write({ session: session() });
  await first.write({ manifest: manifest() });
  await first.write({ frame: frame(10, [firstRow], [resource('thread-1', ['["messages","m1"]'])]) });
  await first.write({ operations: [operation('z-first', 'first')] });
  await first.write({ operations: [operation('a-second', 'second')] });
  await first.close();

  const reopened = createSQLiteStorage(nodeSqliteDriver(path));
  try {
    const restored = await reopened.load();
    assert.deepEqual(restored.session, session());
    assert.deepEqual(restored.manifest, manifest());
    assert.deepEqual(restored.frame?.rows, [firstRow]);
    assert.equal(restored.frame?.resources[0].key, 'thread-1');
    assert.deepEqual(restored.operations.map(item => item.id), ['z-first', 'a-second'],
      'durable replay order follows admission, not random operation-id order');

    await reopened.write({ frame: frame(10, [row('m2')], [resource('thread-2', ['["messages","m2"]'])]) });
    assert.deepEqual((await reopened.load()).frame.rows.map(item => item.id).sort(), ['m1', 'm2']);
    await reopened.write({ frame: frame(11, [row('m3')], [resource('thread-3', ['["messages","m3"]'])]) });
    assert.deepEqual((await reopened.load()).frame.rows.map(item => item.id), ['m3'],
      'a newer resource frame does not retain rows from the old sequence');
    await reopened.write({ frame: frame(12, [row('forged')], [], 'mallory') });
    assert.equal((await reopened.load()).frame.seq, 11, 'wrong-authority positive data is ignored');
  } finally { await reopened.close(); }
});

test('a client restores a queued operation from real SQLite with every network request failing', async () => {
  const path = await database('offline-client.db');
  const first = createSQLiteStorage(nodeSqliteDriver(path));
  await first.write({ session: session(), operations: [operation('offline-send', 'held across restart')] });
  await first.close();

  const reopened = createSQLiteStorage(nodeSqliteDriver(path));
  const client = createClient({ url: 'http://offline.invalid', storage: reopened, live: false,
    fetch: async () => { throw new TypeError('backend stopped'); } });
  try {
    await client.ready;
    assert.equal(client.getSnapshot().status, 'offline');
    assert.equal(client.getSnapshot().principal.id, 'alice');
    assert.deepEqual(client.getSnapshot().pending.map(item => [item.id, item.status]), [['offline-send', 'queued']]);
  } finally {
    client.close();
    await reopened.close();
  }
});

test('a lost successful reply reopens from SQLite with the immutable retry identity and bytes', async () => {
  const path = await database('lost-reply-client.db');
  const backend = new ClientBackend();
  const firstStorage = createSQLiteStorage(nodeSqliteDriver(path));
  let firstId = 0;
  const first = createClient({ url: 'http://native-owner.test', storage: firstStorage, live: false,
    fetch: backend.fetch, idFactory: () => `lost-first-${++firstId}` });
  try {
    await first.auth.persona('alice');
    backend.afterMutation = () => { backend.network = false; throw new TypeError('reply lost after commit'); };
    const pending = first.mutate('cards.add', { columnId: 'col1', title: 'Send exactly once' });
    await pending.durable;
    await eventually(() => backend.applied === 1 && first.getSnapshot().status === 'offline');
    const submitted = backend.calls.find(call => call.path === '/api/mutation').body;
    const admitted = (await firstStorage.load()).operations[0];
    assert.equal(admitted.id, pending.id);
    assert.equal(admitted.body, submitted);
    first.close(); await first.closeAsync(); await firstStorage.close();

    backend.network = true; backend.afterMutation = undefined;
    const reopenedStorage = createSQLiteStorage(nodeSqliteDriver(path));
    const reopened = createClient({ url: 'http://native-owner.test/', storage: reopenedStorage, live: false,
      fetch: backend.fetch, idFactory: () => 'lost-reopened-client' });
    try {
      await reopened.ready;
      const restored = reopened.operation(pending.id);
      assert.ok(restored, 'the original durable identity is restored');
      assert.equal((await restored.settled).state, 'committed');
      const saved = (await reopenedStorage.load()).operations[0];
      assert.equal(saved.body, submitted, 'lookup/recovery never rewrites immutable request bytes');
      assert.equal(saved.receipt.intent, pending.id);
      assert.equal(backend.applied, 1);
      assert.equal(backend.calls.filter(call => call.path === '/api/mutation').length, 1,
        'reopen recovers the committed receipt instead of resubmitting');
    } finally { reopened.close(); await reopened.closeAsync(); await reopenedStorage.close(); }
  } finally {
    first.close();
    await firstStorage.close().catch(() => {});
  }
});

test('a failed real SQLite admission rolls back the operation and sends nothing', async () => {
  const path = await database('failed-admission-client.db');
  const backend = new ClientBackend();
  const base = nodeSqliteDriver(path);
  let armed = true;
  const faulting = {
    get identity() { return base.identity; },
    run: (sql, params) => base.run(sql, params),
    get: (sql, params) => base.get(sql, params),
    all: (sql, params) => base.all(sql, params),
    exec: sql => base.exec(sql),
    transaction: body => base.transaction(async tx => {
      let operationWrite = false;
      const wrapped = {
        get: (sql, params) => tx.get(sql, params),
        all: (sql, params) => tx.all(sql, params),
        run: async (sql, params) => { operationWrite ||= /s3_operations/.test(sql); await tx.run(sql, params); },
      };
      const result = await body(wrapped);
      if (armed && operationWrite) { armed = false; throw new Error('injected admission commit failure'); }
      return result;
    }),
    close: () => base.close(),
  };
  const storage = createSQLiteStorage(faulting);
  const client = createClient({ url: 'http://native-owner.test', storage, live: false,
    fetch: backend.fetch, idFactory: (() => { let id = 0; return () => `admission-${++id}`; })() });
  try {
    await client.auth.persona('alice');
    const pending = client.mutate('cards.add', { columnId: 'col1', title: 'Keep this text' });
    await assert.rejects(pending.durable, /injected admission commit failure/);
    assert.equal(pending.getSnapshot().status, 'error');
    assert.equal(backend.calls.some(call => call.path === '/api/mutation'), false);
  } finally { client.close(); await client.closeAsync(); await storage.close(); }

  const reopened = createSQLiteStorage(nodeSqliteDriver(path));
  try {
    const state = await reopened.load();
    assert.equal(state.session.principal.id, 'alice');
    assert.deepEqual(state.operations, [], 'the failed admission leaves no partial journal row');
  } finally { await reopened.close(); }
});

test('an account switch aborts an in-flight SQLite operation and fences its late reply', async () => {
  const path = await database('account-switch-client.db');
  const backend = new ClientBackend();
  const bobBody = JSON.stringify({ op: 'cards.add', args: { columnId: 'col1', title: 'Bob saved input' },
    intent: 'bob-saved', planHash: backend.manifest.programs['cards.add'].planHash,
    schemaHash: backend.manifest.schemaHash });
  let releaseReply;
  let replyWaiting = false;
  const heldReply = new Promise(resolve => { releaseReply = resolve; });
  backend.afterMutation = async () => { replyWaiting = true; await heldReply; };
  const storage = createSQLiteStorage(nodeSqliteDriver(path));
  await storage.write({ operations: [{ id: 'bob-saved', principal: 'bob', body: bobBody,
    status: 'queued', createdAt: 99 }] });
  let nextId = 0;
  const client = createClient({ url: 'http://native-owner.test', storage, live: false,
    fetch: backend.fetch, idFactory: () => `switch-${++nextId}` });
  try {
    await client.auth.persona('alice');
    const old = client.mutate('cards.add', { columnId: 'col1', title: 'Alice private input' });
    await old.durable; await eventually(() => replyWaiting);
    await client.auth.persona('bob');
    assert.equal(backend.mutationAborted, 1, 'account withdrawal aborts the old transport request');
    assert.equal(old.getSnapshot().status, 'sealed');
    await assert.rejects(old.settled, /previous account/);
    assert.equal(client.operation(old.id), undefined);
    const bob = client.operation('bob-saved');
    assert.ok(bob, 'the new account restores its previously queued operation');
    assert.deepEqual(client.getSnapshot().pending.map(item => item.id), ['bob-saved']);

    releaseReply();
    await eventually(async () => {
      const operations = (await storage.load()).operations;
      return operations.length === 2 && operations.find(item => item.id === old.id)?.status === 'committed'
        && operations.find(item => item.id === 'bob-saved')?.status === 'committed';
    }, 'the new account drain request was lost behind the old account response');
    assert.equal((await bob.settled).state, 'committed');
    const switched = await storage.load();
    assert.equal(switched.session.principal.id, 'bob');
    assert.equal(switched.operations.find(item => item.id === old.id).principal, 'alice');
    assert.equal(switched.operations.find(item => item.id === 'bob-saved').principal, 'bob');
    assert.equal(client.getSnapshot().principal.id, 'bob');
    assert.deepEqual(client.getSnapshot().pending, []);
    assert.equal(client.operation(old.id), undefined, 'Alice\'s late receipt remains hidden under Bob');
    assert.equal(backend.calls.filter(call => call.path === '/api/mutation' && call.principal === 'bob').length, 1);
    assert.equal(backend.calls.find(call => call.path === '/api/mutation' && call.principal === 'bob').body, bobBody,
      'Bob retries the exact immutable saved request body');

    backend.afterMutation = undefined;
    await client.auth.persona('alice');
    const recovered = client.operation(old.id);
    assert.ok(recovered);
    assert.notEqual(recovered, old);
    assert.equal((await recovered.settled).state, 'committed');
    assert.equal(client.operation('bob-saved'), undefined, 'Bob\'s terminal remains hidden after returning to Alice');
    assert.equal(backend.applied, 2);
    assert.equal(backend.calls.filter(call => call.path === '/api/mutation').length, 2);
  } finally {
    releaseReply?.();
    client.close(); await client.closeAsync(); await storage.close();
  }
});

test('a failed SQLite transaction rolls back partial authority, frame, and operation DML', async () => {
  const path = await database('rollback.db');
  const baseline = createSQLiteStorage(nodeSqliteDriver(path));
  await baseline.write({ session: session(), operations: [operation('held')] });
  await baseline.write({ manifest: manifest(), frame: frame(10, [row('held')], []) });
  await baseline.close();

  const base = nodeSqliteDriver(path);
  let armed = true;
  const faulting = {
    get identity() { return base.identity; },
    run: (sql, params) => base.run(sql, params),
    get: (sql, params) => base.get(sql, params),
    all: (sql, params) => base.all(sql, params),
    exec: sql => base.exec(sql),
    transaction: body => base.transaction(async tx => {
      let writes = 0;
      const wrapped = {
        get: (sql, params) => tx.get(sql, params),
        all: (sql, params) => tx.all(sql, params),
        async run(sql, params) {
          await tx.run(sql, params);
          if (armed && ++writes === 3) { armed = false; throw new Error('injected SQLite failure'); }
        },
      };
      return body(wrapped);
    }),
    close: () => base.close(),
  };
  const storage = createSQLiteStorage(faulting);
  await assert.rejects(storage.write({ session: session('token-b', 2, 'bob'), operations: [operation('not-admitted')] }),
    /injected SQLite failure/);
  await storage.close();

  const reopened = createSQLiteStorage(nodeSqliteDriver(path));
  try {
    const state = await reopened.load();
    assert.deepEqual(state.session, session());
    assert.deepEqual(state.operations.map(item => item.id), ['held']);
    assert.deepEqual(state.frame.rows.map(item => item.id), ['held']);
  } finally { await reopened.close(); }
});

test('the Expo driver uses the exclusive transaction handle and propagates rollback', async () => {
  const database = new DatabaseSync(':memory:');
  let closed = false;
  const calls = { outerRuns: 0, transactionRuns: 0 };
  const executor = (inside) => ({
    async runAsync(sql, params = []) {
      if (inside) calls.transactionRuns++; else calls.outerRuns++;
      database.prepare(sql).run(...params);
    },
    async getFirstAsync(sql, params = []) { return database.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql, params = []) { return database.prepare(sql).all(...params); },
  });
  const nativeDatabase = {
    ...executor(false),
    async execAsync(sql) { database.exec(sql); },
    async withExclusiveTransactionAsync(body) {
      database.exec('BEGIN IMMEDIATE');
      try { await body(executor(true)); database.exec('COMMIT'); }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async closeAsync() { closed = true; database.close(); },
  };
  const driver = expoSqliteDriver('native.db', { defaultDatabaseDirectory: '/documents',
    async openDatabaseAsync() { return nativeDatabase; } });
  assert.equal(driver.identity, 'expo-sqlite:/documents/native.db');
  await driver.exec('CREATE TABLE proof (value TEXT)');
  await assert.rejects(driver.transaction(async tx => {
    await tx.run('INSERT INTO proof VALUES (?)', ['rolled-back']);
    throw new Error('abort Expo transaction');
  }), /abort Expo transaction/);
  assert.equal((await driver.get('SELECT COUNT(*) AS count FROM proof')).count, 0);
  await driver.transaction(tx => tx.run('INSERT INTO proof VALUES (?)', ['committed']));
  assert.equal((await driver.get('SELECT value FROM proof')).value, 'committed');
  assert.equal(calls.outerRuns, 0, 'transaction DML never escapes onto Expo\'s outer connection');
  assert.equal(calls.transactionRuns, 2);
  await driver.close();
  assert.equal(closed, true);
  assert.throws(() => expoSqliteDriver(), /name is required/,
    'the public driver cannot silently select the legacy unscoped filename');
  assert.throws(() => expoSqliteDriver('../escape.db'), /plain file name/);
});

test('acquisition checkpoints, versions, invalidation, cancellation, and floors conform', async () => {
  const path = await database('acquisition.db');
  const storage = createSQLiteStorage(nodeSqliteDriver(path));
  const pageOne = checkpoint({ pending: [{ key: 'p2', op: 'messages.page', args: { c: '2' }, cursor: 'c', follow: true }],
    resourceKeys: ['p1'], pages: 1 });
  const pageTwo = checkpoint({ status: 'ready', phase: 'validate', pending: [], resourceKeys: ['p1', 'p2'], pages: 2 });
  try {
    await storage.write({ session: session(), manifest: manifest() });
    await storage.write({ acquisition: { acquisition: pageOne, rows: [acquisitionRow('v1', 'm1')],
      resources: [acquisitionResource('p1', ['v1'])] } });
    await storage.write({ acquisition: { acquisition: pageTwo, rows: [acquisitionRow('v2', 'm2')],
      resources: [acquisitionResource('p2', ['v2'])] } });
    let state = await storage.load();
    assert.deepEqual(state.acquisitions, [pageTwo]);
    assert.deepEqual(state.acquisitionRows.map(item => item.versionKey), ['v1', 'v2']);
    assert.deepEqual(state.acquisitionResources.map(item => item.key), ['p1', 'p2']);

    await storage.write({ acquisitionFloor: 12, invalidateAcquisitions: true, acquisitionsInvalidated: true });
    state = await storage.load();
    assert.equal(state.acquisitionFloor, 12);
    assert.equal(state.acquisitionsInvalidated, true);
    assert.deepEqual(state.acquisitions[0], { ...pageTwo, status: 'acquiring', phase: 'validate', pending: [] });
    assert.equal(state.acquisitionRows.length, 2, 'invalidation retains physical row versions for reconfirmation');
    await assert.rejects(storage.write({ acquisition: { acquisition: pageTwo, rows: [], resources: [] } }),
      error => error?.code === 'S3_STORAGE' && /authority or sequence/.test(error.message));
    await assert.rejects(storage.write({ acquisition: { acquisition: { ...pageTwo, seq: 13, authEpoch: 2 },
      rows: [], resources: [] } }), error => error?.code === 'S3_STORAGE' && /authority or sequence/.test(error.message));
    await assert.rejects(storage.write({ manifest: manifest('generation-b', 'schema-b', 11) }),
      error => error?.code === 'S3_STORAGE' && /predates durable acquisition authority/.test(error.message));
    assert.deepEqual((await storage.load()).manifest, manifest(), 'stale manifest rejection is atomic');

    await storage.write({ cancelAcquisition: { ...cancellation(pageTwo), declarationHash: 'wrong' } });
    assert.equal((await storage.load()).acquisitions[0].status, 'acquiring');
    await storage.write({ cancelAcquisition: cancellation(pageTwo) });
    assert.equal((await storage.load()).acquisitions[0].status, 'cancelled');
  } finally { await storage.close(); }
});

test('conditional withdrawal includes acquisition identity and notifies distinct adapters only after admission', async () => {
  const path = await database('authority.db');
  const first = createSQLiteStorage(nodeSqliteDriver(path));
  const second = createSQLiteStorage(nodeSqliteDriver(path));
  const stored = checkpoint({ status: 'ready', phase: 'validate' });
  const events = [];
  try {
    await Promise.all([first.load(), second.load()]);
    second.subscribe(event => events.push(event));
    await first.write({ session: session(), manifest: manifest(), acquisition: {
      acquisition: stored, rows: [acquisitionRow('v1', 'm1')], resources: [acquisitionResource('p1', ['v1'])],
    }, source: 'first' });
    assert.deepEqual(events, [{ source: 'first', type: 'authority' }]);
    events.length = 0;

    await first.write({ clearSession: guardedClear(stored, 'wrong-token'), source: 'stale-token' });
    const beforeStaleAcquisition = await second.load();
    assert.deepEqual(beforeStaleAcquisition.session, session());
    assert.equal(beforeStaleAcquisition.acquisitions[0].declarationHash, 'declaration-a');
    assert.deepEqual(events, []);
    await first.write({ clearSession: guardedClear(stored, 'token-a', 'successor'), source: 'stale-acquisition' });
    assert.deepEqual(events, [], 'refused conditional clears do not broadcast an authority transition');
    assert.deepEqual((await second.load()).session, session());

    await first.write({ clearSession: guardedClear(stored), source: 'accepted-clear' });
    assert.deepEqual(events, [{ source: 'accepted-clear', type: 'authority' }]);
    const state = await second.load();
    assert.equal(state.session, null);
    assert.deepEqual(state.acquisitions, []);
    assert.deepEqual(state.acquisitionRows, []);
    assert.deepEqual(state.acquisitionResources, []);
  } finally {
    await first.close();
    await second.close();
  }
});

test('throwing account observers cannot reject a committed SQLite switch or suppress later peers', async () => {
  const path = await database('observer-account-switch.db');
  const backend = new ClientBackend();
  const firstStorage = createSQLiteStorage(nodeSqliteDriver(path));
  const throwingStorage = createSQLiteStorage(nodeSqliteDriver(path));
  const laterStorage = createSQLiteStorage(nodeSqliteDriver(path));
  await firstStorage.load(); await throwingStorage.load(); await laterStorage.load();
  await firstStorage.write({ session: session(), manifest: backend.manifest });
  const first = createClient({ url: 'http://native-owner.test', storage: firstStorage, live: false,
    fetch: backend.fetch, idFactory: () => 'observer-first' });
  const throwing = createClient({ url: 'http://native-owner.test', storage: throwingStorage, live: false,
    fetch: backend.fetch, idFactory: () => 'observer-throwing' });
  const later = createClient({ url: 'http://native-owner.test', storage: laterStorage, live: false,
    fetch: backend.fetch, idFactory: () => 'observer-later' });
  throwing.setOnline(false); later.setOnline(false);
  await Promise.all([first.ready, throwing.ready, later.ready]);

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
  const reported = [];
  Object.defineProperty(globalThis, 'reportError', { configurable: true,
    value: error => reported.push({ error, principal: throwing.getSnapshot().principal?.id }) });
  let laterPeerNotified = 0;
  const stopThrowing = throwing.subscribe(() => { throw new Error('observer fixture failure'); });
  const stopLater = later.subscribe(() => { laterPeerNotified++; });
  try {
    const switched = await first.auth.persona('bob');
    assert.equal(switched.principal.id, 'bob', 'observer failure cannot reject the writer after COMMIT');
    await eventually(() => throwing.getSnapshot().principal?.id === 'bob'
      && later.getSnapshot().principal?.id === 'bob');
    assert.ok(reported.some(item => /observer fixture failure/.test(item.error?.message)),
      'observer errors remain application-visible');
    assert.ok(reported.every(item => item.principal !== 'alice'),
      'the throwing peer hides old authority before reporting its observer error');
    assert.ok(laterPeerNotified > 0, 'a throwing earlier peer cannot suppress later authority notification');
    assert.equal((await firstStorage.load()).session.principal.id, 'bob');
  } finally {
    stopThrowing(); stopLater();
    if (descriptor) Object.defineProperty(globalThis, 'reportError', descriptor);
    else delete globalThis.reportError;
    first.close(); throwing.close(); later.close();
    await Promise.all([first.closeAsync(), throwing.closeAsync(), later.closeAsync()]);
    await Promise.all([firstStorage.close(), throwingStorage.close(), laterStorage.close()]);
  }
});

test('the exported Expo client derives a normalized owner-scoped real SQLite default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapback3-expo-default-'));
  roots.push(root);
  const openedNames = [];
  const backend = new ClientBackend();
  let nextId = 0;
  globalThis.__snapback3ExpoSqlite = nodeBackedExpoModule(root, openedNames);
  globalThis.__snapback3ExpoId = () => `expo-default-${++nextId}`;
  globalThis.__snapback3ExpoFetch = backend.fetch;
  let ownerA, ownerB, reopenedA;
  try {
    const legacy = createExpoSQLiteStorage('snapback3.db');
    await legacy.write({ session: session('legacy-owner-token'), operations: [operation('legacy-operation')] });
    await legacy.close();

    ownerA = createExpoClient({ url: 'http://owner-a.test///', fetch: backend.fetch, live: false });
    await ownerA.ready; await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(ownerA.getSnapshot().status, 'signed-out',
      'the URL-scoped default does not adopt the old unscoped database');
    assert.equal(backend.calls.length, 0, 'the legacy token is never sent to the selected owner');
    await ownerA.auth.persona('alice'); ownerA.setOnline(false);
    const pending = ownerA.mutate('cards.add', { columnId: 'col1', title: 'Owner A only' });
    await pending.durable; await ownerA.closeAsync();

    const callsBeforeOwnerB = backend.calls.length;
    ownerB = createExpoClient({ url: 'http://owner-b.test', fetch: backend.fetch, live: false });
    await ownerB.ready; await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(ownerB.getSnapshot().status, 'signed-out');
    assert.deepEqual(ownerB.getSnapshot().pending, []);
    assert.equal(backend.calls.length, callsBeforeOwnerB,
      'another owner receives neither the old session token nor its queued operation');
    await ownerB.closeAsync();

    reopenedA = createExpoClient({ url: 'http://owner-a.test/', fetch: backend.fetch, live: false });
    reopenedA.setOnline(false); await reopenedA.ready;
    assert.equal(reopenedA.getSnapshot().principal.id, 'alice');
    assert.deepEqual(reopenedA.getSnapshot().pending.map(item => item.id), [pending.id]);
    await reopenedA.closeAsync();

    const ownerAName = `snapback3-${sha256('http://owner-a.test')}.db`;
    const ownerBName = `snapback3-${sha256('http://owner-b.test')}.db`;
    assert.deepEqual(openedNames, ['snapback3.db', ownerAName, ownerBName, ownerAName]);
    assert.notEqual(ownerAName, ownerBName);
    assert.throws(() => createExpoSQLiteStorage(), /databaseName is required/,
      'the lower-level factory cannot silently select the legacy unscoped filename');
  } finally {
    ownerA?.close(); ownerB?.close(); reopenedA?.close();
    delete globalThis.__snapback3ExpoSqlite;
    delete globalThis.__snapback3ExpoId;
    delete globalThis.__snapback3ExpoFetch;
  }
});

test('the Expo entry uses native UUID and streaming fetch defaults while preserving overrides', async () => {
  const schema = { tables: {} };
  const nativeManifest = { generation: 'a'.repeat(64), schemaHash: schemaDigest(schema), schema, programs: {}, seq: 0 };
  const expoCalls = [], overrideCalls = [];
  const transport = calls => async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/api/auth/persona') return new Response(JSON.stringify(session()), { status: 200 });
    if (path === '/api/manifest') return new Response(JSON.stringify(nativeManifest), { status: 200 });
    if (path === '/api/events') return new Response(new ReadableStream({ start(controller) { controller.close(); } }));
    if (path === '/api/read') {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ generation: nativeManifest.generation, seq: 0,
        resources: body.queries.map(query => ({ key: query.key, error: { code: 'S3_OPERATION_UNKNOWN', message: 'test' } })) }));
    }
    throw new Error(`unexpected Expo request ${path}`);
  };
  let ids = 0;
  globalThis.__snapback3ExpoId = () => `expo-id-${++ids}`;
  globalThis.__snapback3ExpoFetch = transport(expoCalls);
  const descriptors = new Map(['crypto', 'structuredClone', 'window'].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let nativeHost, browserHost, native, overridden;
  try {
    for (const name of ['crypto', 'structuredClone'])
      Object.defineProperty(globalThis, name, { configurable: true, value: undefined });

    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    nativeHost = createClient({ url: 'http://native-shaped.test', storage: false,
      fetch: transport([]), idFactory: () => 'native-shaped-client' });
    nativeHost.setOnline(false); await nativeHost.ready; await nativeHost.closeAsync(); nativeHost.close();

    const added = [], removed = [];
    const browserWindow = {
      addEventListener(type, listener) { added.push([type, listener]); },
      removeEventListener(type, listener) { removed.push([type, listener]); },
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow });
    browserHost = createClient({ url: 'http://browser-shaped.test', storage: false,
      fetch: transport([]), idFactory: () => 'browser-shaped-client' });
    browserHost.setOnline(false); await browserHost.ready;
    assert.deepEqual(added.map(([type]) => type), ['online', 'offline']);
    await browserHost.closeAsync(); browserHost.close();
    assert.deepEqual(removed, added, 'close removes exactly the browser listeners this client registered');

    delete globalThis.window;
    native = createExpoClient({ url: 'http://native.test', storage: false });
    await native.ready; await native.auth.persona('alice');
    const stopNative = native.watch('native.events', {}).subscribe(() => {});
    for (let attempt = 0; attempt < 100 && !expoCalls.includes('/api/events'); attempt++)
      await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(expoCalls.includes('/api/events'), 'native live responses use expo/fetch by default');
    stopNative();

    const overrideFetch = transport(overrideCalls);
    overridden = createExpoClient({ url: 'http://override.test', storage: false, fetch: overrideFetch,
      idFactory: () => 'override-client' });
    await overridden.ready; await overridden.auth.persona('alice');
    const expoBefore = expoCalls.length;
    const stopOverride = overridden.watch('override.events', {}).subscribe(() => {});
    for (let attempt = 0; attempt < 100 && !overrideCalls.includes('/api/events'); attempt++)
      await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(overrideCalls.includes('/api/events'));
    assert.equal(expoCalls.length, expoBefore, 'an explicit fetch override owns native event requests');
    stopOverride();
  } finally {
    nativeHost?.close(); browserHost?.close(); native?.close(); overridden?.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    delete globalThis.__snapback3ExpoId;
    delete globalThis.__snapback3ExpoFetch;
  }
});
