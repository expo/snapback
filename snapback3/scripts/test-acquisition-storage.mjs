import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { chromium } from 'playwright-core';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(workspace, '..');
const dist = resolve(process.env.SNAPBACK3_DIST ?? join(workspace, 'packages/snapback3/dist'));
const executable = process.env.SNAPBACK3_BROWSER
  ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const port = Number(process.env.SNAPBACK3_STORAGE_PORT ?? 54926);
const output = resolve(process.env.SNAPBACK3_ACQUISITION_STORAGE_RESULT
  ?? join(repository, '.llp/ship-runs/snapback3-acquisition-20260912/storage-controls/result.json'));
const packageArtifact = process.env.SNAPBACK3_PACKAGE_ARTIFACT;
const startedAt = new Date().toISOString();
const evidence = {
  test: 'snapback3-real-indexeddb-acquisition-storage', startedAt, host: hostname(), platform: process.platform,
  node: process.version, port, browserExecutable: executable, dist, sdkSourceHashes: {}, checks: [],
  browser: null, result: 'failed', error: null, finishedAt: null,
};
let browser;
let browserServer;
let browserPid;
let server;
const browserMarker = `--snapback3-storage-control=${port}`;

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const exists = async path => stat(path).then(() => true, () => false);
const listen = server => new Promise((done, reject) => {
  server.once('error', reject); server.listen(port, '127.0.0.1', done);
});
const closeServer = server => server ? new Promise(done => server.close(() => done())) : Promise.resolve();

async function linuxProcess(pid) {
  if (process.platform !== 'linux') return { pid, startTicks: null, command: null };
  const command = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  const status = await readFile(`/proc/${pid}/stat`, 'utf8');
  const tail = status.slice(status.lastIndexOf(')') + 2).split(' ');
  return { pid, startTicks: tail[19], command };
}

async function persistEvidence() {
  evidence.finishedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
}

try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('SNAPBACK3_STORAGE_PORT is invalid.');
  await access(executable); await access(join(dist, 'client.mjs'));
  for (const path of [
    'snapback3/packages/snapback3/src/client.ts',
    'snapback3/packages/snapback3/src/resource/acquisition.ts',
    'snapback3/packages/snapback3/src/resource/storage.ts',
    'snapback3/packages/snapback3/src/resource/types.ts',
    'snapback3/scripts/test-acquisition-storage.mjs',
  ]) evidence.sdkSourceHashes[path] = await sha256(join(repository, path));
  evidence.sdkBundleHash = await sha256(join(dist, 'client.mjs'));
  if (packageArtifact) evidence.packageArtifact = { path: packageArtifact, sha256: await sha256(packageArtifact) };

  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('<!doctype html><meta charset="utf-8"><title>Snapback3 IndexedDB controls</title>');
        return;
      }
      if (!pathname.startsWith('/sdk/')) { response.writeHead(404).end(); return; }
      const relative = pathname.slice('/sdk/'.length);
      const path = resolve(dist, relative);
      if (!path.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
      const body = await readFile(path);
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end(String(error));
    }
  });
  await listen(server);
  browserServer = await chromium.launchServer({ executablePath: executable, headless: true, args: [browserMarker] });
  const launched = browserServer.process();
  if (!launched?.pid) throw new Error('Playwright did not expose the launched Chromium process.');
  browserPid = await linuxProcess(launched.pid);
  browser = await chromium.connect(browserServer.wsEndpoint());
  evidence.browser = { version: await browser.version(), rootPid: browserPid?.pid ?? null,
    rootStartTicks: browserPid?.startTicks ?? null, rootCommand: browserPid?.command ?? null };
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const { createIndexedDBStorage } = await import('/sdk/client.mjs');
    const dbName = 'snapback3-acquisition-storage-controls';
    const generationA = 'a'.repeat(64), generationB = 'b'.repeat(64), schemaHash = 'c'.repeat(64);
    const planHash = 'd'.repeat(64), validator = 'e'.repeat(64);
    const alice = { token: 'token-alice', principal: { id: 'alice', kind: 'user' }, authEpoch: 7,
      expiresAt: Date.now() + 3_600_000 };
    const bob = { token: 'token-bob', principal: { id: 'bob', kind: 'user' }, authEpoch: 2,
      expiresAt: Date.now() + 3_600_000 };
    const manifest = generation => ({ generation, schemaHash, schema: { tables: {} }, programs: {}, seq: generation === generationA ? 5 : 7 });
    const open = (version, upgrade) => new Promise((done, reject) => {
      const request = indexedDB.open(dbName, version);
      request.onupgradeneeded = () => upgrade?.(request.result);
      request.onsuccess = () => done(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    const transactionDone = transaction => new Promise((done, reject) => {
      transaction.oncomplete = () => done();
      transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
      transaction.onerror = () => {};
    });
    const remove = () => new Promise((done, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => done(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB deletion blocked'));
    });
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const rejects = async (promise, description) => {
      try { await promise; } catch { return; }
      throw new Error(`${description} unexpectedly committed`);
    };
    const resource = (acquisitionId, key, versionKey, generation, seq) => ({
      acquisitionId, key, chainKey: 'chain', op: 'notes.page', args: { c: null }, rowVersionKeys: [versionKey],
      envelope: { protocol: 1, generation, schemaHash, planHash, authority: { principal: 'alice', authEpoch: 7 },
        state: 'complete', data: null, next: null, seq, receipt: { ranges: [], absences: [], verdicts: [] }, validator },
    });
    const row = (versionKey, body, seq) => ({ versionKey, seq,
      row: { table: 'notes', id: versionKey.slice(0, 8), row: { id: versionKey.slice(0, 8), body } } });
    const metadata = (id, generation, seq, resourceKeys = []) => ({ id, declarationHash: 'f'.repeat(64),
      principal: 'alice', authEpoch: 7, generation, schemaHash, status: 'acquiring', phase: 'traverse', seq,
      rootKeys: ['chain'], derivedDeclarations: [], pending: [], resourceKeys, pages: resourceKeys.length });
    const patch = (id, generation, seq, key, versionKey, overrides = {}) => ({
      acquisition: { acquisition: { ...metadata(id, generation, seq, [key]), ...overrides },
        rows: [row(versionKey, id, seq)], resources: [resource(id, key, versionKey, generation, seq)] },
    });

    await remove();
    const v1 = await open(1, db => {
      for (const name of ['state', 'rows', 'resources', 'operations']) db.createObjectStore(name);
    });
    const seed = v1.transaction(['state', 'rows', 'resources', 'operations'], 'readwrite');
    const frameRow = { table: 'notes', id: 'seed', row: { id: 'seed', body: 'preserved v1 row' } };
    const frameResource = { key: 'notes-v1', op: 'notes.page', args: { c: null }, rowKeys: [JSON.stringify(['notes', 'seed'])],
      envelope: { protocol: 1, generation: generationA, schemaHash, planHash,
        authority: { principal: 'alice', authEpoch: 7 }, state: 'complete', data: null, next: null, seq: 5,
        receipt: { ranges: [], absences: [], verdicts: [] }, validator } };
    const operationBody = JSON.stringify({ op: 'messages.send', args: { conversationId: 'studio', body: 'preserve me' },
      intent: 'intent-v1', planHash, schemaHash });
    seed.objectStore('state').put(alice, 'session');
    seed.objectStore('state').put(manifest(generationA), 'manifest');
    seed.objectStore('state').put({ seq: 5, generation: generationA, schemaHash, principal: 'alice', authEpoch: 7 }, 'frame');
    seed.objectStore('rows').put(frameRow, JSON.stringify(['notes', 'seed']));
    seed.objectStore('resources').put(frameResource, frameResource.key);
    seed.objectStore('operations').put({ id: 'intent-v1', principal: 'alice', body: operationBody,
      status: 'queued', createdAt: 1 }, 'intent-v1');
    await transactionDone(seed); v1.close();

    let storage = createIndexedDBStorage(dbName);
    let state = await storage.load();
    assert(state.version === 2, 'v1 database did not upgrade to storage state v2');
    assert(state.frame?.rows[0]?.row.body === 'preserved v1 row' && state.frame.resources[0]?.key === 'notes-v1',
      'v1 frame was not preserved');
    assert(state.operations[0]?.body === operationBody, 'v1 operation journal bytes changed during upgrade');
    const schema = await open(2); const stores = [...schema.objectStoreNames]; schema.close();
    for (const name of ['acquisitions', 'acquisitionRows', 'acquisitionResources'])
      assert(stores.includes(name), `v2 upgrade omitted ${name}`);
    const checks = ['v1-upgrade-preserved-frame-and-operation'];

    const good = patch('dataset', generationA, 5, 'page-1', '1'.repeat(64));
    await storage.write({ ...good, acquisitionFloor: 5, acquisitionsInvalidated: false });
    storage.close(); storage = createIndexedDBStorage(dbName); state = await storage.load();
    assert(state.acquisitions?.[0]?.id === 'dataset' && state.acquisitionRows?.length === 1
      && state.acquisitionResources?.length === 1, 'acquisition batch did not survive real close/reopen');
    checks.push('atomic-acquisition-batch-close-reopen');

    await rejects(storage.write(patch('bad-principal', generationA, 5, 'bad-p', '2'.repeat(64), { principal: 'mallory' })), 'old principal');
    await rejects(storage.write(patch('bad-epoch', generationA, 5, 'bad-e', '3'.repeat(64), { authEpoch: 6 })), 'old auth epoch');
    await rejects(storage.write(patch('bad-generation', generationB, 5, 'bad-g', '4'.repeat(64))), 'old generation');
    await storage.write({ acquisitionFloor: 6 });
    await rejects(storage.write({ ...patch('bad-floor', generationA, 5, 'bad-f', '5'.repeat(64)),
      acquisitionFloor: 9, acquisitionsInvalidated: true }), 'old sequence floor');
    state = await storage.load();
    assert(state.acquisitionFloor === 6 && state.acquisitionsInvalidated === false,
      'rejected batch did not roll back floor and invalidation writes');
    assert(state.acquisitions?.length === 1 && state.acquisitionRows?.length === 1
      && state.acquisitionResources?.length === 1, 'rejected batch admitted checkpoint bytes');
    checks.push('authority-floor-rejection-and-whole-transaction-rollback');

    await storage.write({ manifest: manifest(generationB) }); state = await storage.load();
    assert(state.acquisitionFloor === 7 && state.acquisitions?.length === 0 && state.acquisitionRows?.length === 0
      && state.acquisitionResources?.length === 0 && state.frame === null, 'generation replacement did not clear acquisition/frame state');
    await storage.write({ ...patch('generation-b', generationB, 7, 'b-page', '6'.repeat(64)), acquisitionFloor: 7 });
    await storage.write({ session: bob }); state = await storage.load();
    assert(state.acquisitionFloor === 0 && state.acquisitionsInvalidated === false && state.acquisitions?.length === 0
      && state.acquisitionRows?.length === 0 && state.acquisitionResources?.length === 0,
      'session replacement did not clear acquisition authority');
    checks.push('generation-and-session-replacement-clear-acquisitions');

    await storage.write({ session: alice });
    const peer = createIndexedDBStorage(dbName);
    const shared = metadata('shared', generationB, 7, ['shared-1', 'shared-2']);
    await Promise.all([
      storage.write({ acquisition: { acquisition: shared, rows: [row('7'.repeat(64), 'first', 7)],
        resources: [resource('shared', 'shared-1', '7'.repeat(64), generationB, 7)] }, acquisitionFloor: 7 }),
      peer.write({ acquisition: { acquisition: shared, rows: [row('8'.repeat(64), 'second', 7)],
        resources: [resource('shared', 'shared-2', '8'.repeat(64), generationB, 7)] }, acquisitionFloor: 7 }),
    ]);
    storage.close(); peer.close(); storage = createIndexedDBStorage(dbName); state = await storage.load();
    assert(state.acquisitions?.find(item => item.id === 'shared')?.resourceKeys.length === 2,
      'shared database lost acquisition metadata ordering');
    assert(state.acquisitionRows?.filter(item => item.seq === 7).length === 2
      && state.acquisitionResources?.filter(item => item.acquisitionId === 'shared').length === 2,
      'shared database lost a page batch');
    checks.push('two-adapters-two-pages-serialized-without-loss');

    const newerAlice = { ...alice, token: 'token-alice-newer' };
    await storage.write({ session: newerAlice });
    const guardVersion = '9'.repeat(64), guardRow = row(guardVersion, 'conditional-clear', 7);
    const guardEnvelope = resource('guard', 'guard-page', guardVersion, generationB, 7).envelope;
    await storage.write({ ...patch('guard', generationB, 7, 'guard-page', guardVersion, { status: 'ready', phase: 'validate' }),
      frame: { seq: 7, generation: generationB, schemaHash, principal: 'alice', authEpoch: 7,
        rows: [guardRow.row], resources: [{ key: 'guard-live', op: 'notes.page', args: { c: null },
          rowKeys: [JSON.stringify(['notes', guardRow.row.id])], envelope: guardEnvelope }] } });
    await storage.write({ clearSession: { token: alice.token, principal: alice.principal.id, authEpoch: alice.authEpoch } });
    state = await storage.load();
    assert(state.session?.token === newerAlice.token && state.frame?.resources[0]?.key === 'guard-live'
      && state.acquisitions?.[0]?.id === 'guard' && state.acquisitionRows?.length === 1
      && state.acquisitionResources?.length === 1,
      'an old conditional clear erased newer durable authority');

    const identity = acquisition => ({ id: acquisition.id, declarationHash: acquisition.declarationHash,
      principal: acquisition.principal, authEpoch: acquisition.authEpoch, generation: acquisition.generation,
      schemaHash: acquisition.schemaHash });
    const guardIdentity = identity(state.acquisitions[0]);
    const guardCancellation = { token: newerAlice.token, ...guardIdentity };
    await storage.write({ cancelAcquisition: { ...guardCancellation, declarationHash: '0'.repeat(64) } });
    await storage.write({ cancelAcquisition: { ...guardCancellation, principal: 'mallory' } });
    state = await storage.load();
    assert(state.acquisitions?.[0]?.status === 'ready' && state.acquisitionRows?.length === 1
      && state.acquisitionResources?.length === 1, 'a mismatched conditional cancellation changed its checkpoint');
    await storage.write({ cancelAcquisition: guardCancellation }); state = await storage.load();
    assert(state.acquisitions?.[0]?.status === 'cancelled' && state.acquisitionRows?.length === 1
      && state.acquisitionResources?.length === 1 && state.session?.token === newerAlice.token,
      'an exact conditional cancellation did not update only its checkpoint status');
    checks.push('conditional-acquisition-cancel-requires-exact-checkpoint');

    const newestAlice = { ...alice, token: 'token-alice-newest' };
    await storage.write({ session: newestAlice });
    await storage.write(patch('guard', generationB, 7, 'guard-page', guardVersion, { status: 'ready', phase: 'validate' }));
    await storage.write({ cancelAcquisition: guardCancellation }); state = await storage.load();
    assert(state.session?.token === newestAlice.token && state.acquisitions?.[0]?.status === 'ready',
      'a cancellation from an older same-principal session changed the newer session checkpoint');
    checks.push('conditional-acquisition-cancel-requires-current-session-token');

    const newestGuardIdentity = identity(state.acquisitions[0]);
    const successorHash = '0'.repeat(64);
    await storage.write(patch('guard', generationB, 7, 'guard-page', guardVersion,
      { declarationHash: successorHash, status: 'ready', phase: 'validate' }));
    await storage.write({ cancelAcquisition: { token: newestAlice.token, ...newestGuardIdentity } });
    await storage.write({ clearSession: { token: newestAlice.token, principal: newestAlice.principal.id,
      authEpoch: newestAlice.authEpoch, acquisition: newestGuardIdentity } });
    state = await storage.load();
    assert(state.session?.token === newestAlice.token && state.acquisitions?.[0]?.declarationHash === successorHash
      && state.acquisitions?.[0]?.status === 'ready' && state.acquisitionRows?.length === 1
      && state.acquisitionResources?.length === 1,
      'an old acquisition cancellation or fail-closed clear erased its same-authority successor');
    checks.push('conditional-cancellation-and-session-clear-guard-successor');

    await storage.write({ clearSession: { token: newestAlice.token, principal: newestAlice.principal.id,
      authEpoch: newestAlice.authEpoch, acquisition: identity(state.acquisitions[0]) } });
    state = await storage.load();
    assert(state.session === null && state.frame === null && state.acquisitions?.length === 0
      && state.acquisitionRows?.length === 0 && state.acquisitionResources?.length === 0
      && state.acquisitionFloor === 0 && state.acquisitionsInvalidated === false,
      'a matching conditional clear did not atomically erase durable authority');
    checks.push('conditional-session-clear-guards-newer-and-erases-matching-authority');
    storage.close(); await remove();
    return { checks, note: 'The preserved v1 operation is validated byte-for-byte as adapter state; this control does not execute or recover it.' };
  });
  await context.close();
  evidence.checks = result.checks; evidence.note = result.note; evidence.result = 'passed';
} catch (error) {
  evidence.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
} finally {
  try { await browser?.close(); } catch { /* Evidence records the primary result. */ }
  try { await browserServer?.close(); } catch { /* Evidence records the primary result. */ }
  try { await closeServer(server); } catch { /* Evidence records the primary result. */ }
  if (browserPid) {
    for (let attempt = 0; attempt < 40 && await exists(`/proc/${browserPid.pid}`); attempt++)
      await new Promise(done => setTimeout(done, 50));
    evidence.browser.rootCleaned = !await exists(`/proc/${browserPid.pid}`);
  }
  await persistEvidence();
  console.log(JSON.stringify(evidence, null, 2));
}

if (evidence.result !== 'passed' || evidence.browser?.rootCleaned === false) process.exitCode = 1;
