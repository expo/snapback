import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

Object.defineProperty(globalThis, 'navigator', {
  value: { product: 'ReactNative' },
  configurable: true,
});

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..', '..', '..');
const generated = (name) => JSON.parse(readFileSync(join(appDir, 'snapback', 'generated', name), 'utf8'));
const api = (await import(join(appDir, 'snapback', 'generated', 'api.mjs'))).default;
const { createFakeExpoFileSystem } = await import(join(repoRoot, 'packages', 'snapback-client', 'fake-expo-file-system.mjs'));
const { SnapbackClient, registerExpoFileSystemRqsFiles } = await import(join(repoRoot, 'packages', 'snapback-client', 'index.mjs'));
const { startServer } = await import(join(repoRoot, 'demos', '_kit', 'server-process.mjs'));
const { freePort } = await import(join(repoRoot, 'demos', '_kit', 'provenance.mjs'));

const stateDir = mkdtempSync(join(tmpdir(), 'relay-room-offline-'));
const fakeFileSystem = createFakeExpoFileSystem(join(stateDir, 'documents'));
registerExpoFileSystemRqsFiles(fakeFileSystem.module, {
  crypto: {
    getRandomValues(values) {
      for (let index = 0; index < values.length; index += 1) values[index] = (index * 31 + 17) % 256;
      return values;
    },
  },
});

const server = await startServer({
  port: await freePort(),
  bindPortExactly: true,
  db: join(stateDir, 'relay-room.db'),
  cwd: repoRoot,
  provenance: {
    appId: 'snapback-expo',
    artifactsPath: join(appDir, 'snapback', 'generated', 'artifacts.json'),
  },
});

const provisioner = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
await provisioner.ensureApp({
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
  seed: JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8')),
});

const manifest = {
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
  capabilityManifest: generated('capability.manifest.json'),
};
const online = new SnapbackClient(server.baseUrl, server.clientOptions);
await online.prepareReactBinding({ generatedManifest: manifest });
const onlineStarted = online.startLiveQuery(api.messagesForConversation, {
  connectionId: 'relay-room-online',
  args: { conversationId: 'conversation_engine_room' },
  fallbackToPoll: false,
  persistResume: true,
});
await onlineStarted.started();
const onlineHandle = onlineStarted.current;
if (!onlineHandle) throw new Error('online live query did not produce a handle');

await eventually(() => onlineHandle.rows.length >= 3 && onlineHandle.freshness === 'current', 'current online rows', onlineHandle);
await onlineHandle.flushResumeState();
onlineStarted.dispose();
await online.closeAuth();
await server.stop();

const offline = new SnapbackClient(server.baseUrl);
await offline.prepareReactBinding({ generatedManifest: manifest });
const offlineStarted = offline.startLiveQuery(api.messagesForConversation, {
  connectionId: 'relay-room-offline',
  args: { conversationId: 'conversation_engine_room' },
  fallbackToPoll: false,
  persistResume: true,
});
await Promise.race([
  offlineStarted.started(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('offline live query did not start from retention')), 5_000)),
]);
const offlineHandle = offlineStarted.current;
if (!offlineHandle) throw new Error('offline live query did not produce a handle');
await eventually(() => offlineHandle.rows.length >= 3 && offlineHandle.freshness === 'retained', 'retained offline rows', offlineHandle);

console.log(JSON.stringify({
  ok: true,
  onlineRows: onlineHandle.rows.length,
  offlineRows: offlineHandle.rows.length,
  offlineFreshness: offlineHandle.freshness,
  retainable: offlineHandle.retention?.retainable ?? null,
  store: offline.rqsStoreInfo,
}, null, 2));

offlineStarted.dispose();
await offline.closeAuth();

async function eventually(predicate, label, handle) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({ rows: handle.rows.length, freshness: handle.freshness, connection: handle.connection, retention: handle.retention })}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}
