// Reproduce the RN carrier's store locally: the default ladder takes its
// React Native branch on `navigator.product === 'ReactNative'`, and the client
// package ships a fake expo-file-system for exactly this.
//
// Question: does a file store reporting durable:false get refused a resume
// token (NOT_RQS_ELIGIBLE), the way the device does?
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must look like React Native BEFORE the client resolves its store.
Object.defineProperty(globalThis, 'navigator', {
  value: { product: 'ReactNative' }, configurable: true, writable: true,
});

const { createFakeExpoFileSystem } = await import(
  '../../../packages/snapback-client/fake-expo-file-system.mjs'
);
const { SnapbackClient, registerExpoFileSystemRqsFiles } = await import(
  '../../../packages/snapback-client/index.mjs'
);
const { startServer } = await import('../../_kit/server-process.mjs');
const { freePort } = await import('../../_kit/provenance.mjs');

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const appDir = join(repoRoot, 'demos', 'warble');
const gen = (n) => JSON.parse(readFileSync(join(appDir, 'snapback', 'generated', n), 'utf8'));
const seed = JSON.parse(readFileSync(join(appDir, 'snapback', 'seed.json'), 'utf8'));

const stateDir = mkdtempSync(join(tmpdir(), 'warble-rn-'));
const fs = createFakeExpoFileSystem(join(stateDir, 'docs'));
registerExpoFileSystemRqsFiles(fs.module, {
  crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) % 256; return a; } },
});

const port = await freePort();
const server = await startServer({
  port, bindPortExactly: true, db: join(stateDir, 'rn.db'), cwd: repoRoot,
  provenance: { appId: 'warble', artifactsPath: join(appDir, 'snapback', 'generated', 'artifacts.json') },
});
const p = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
await p.ensureApp({ schema: gen('schema.manifest.json'), functions: gen('functions.manifest.json'), seed });

const client = new SnapbackClient(server.baseUrl, server.clientOptions);
console.log('storeInfo      ', JSON.stringify(client.rqsStoreInfo));

const h = await client.liveQuery('timeline', {
  connectionId: 'rn-probe', args: {}, transport: 'stream',
});
console.log('retention      ', JSON.stringify({
  freshness: h.freshness, connection: h.connection,
  retainable: h.retention?.retainable ?? null,
  code: h.retention?.code ?? null,
  resume: h.rqsResume ? 'token' : null,
}));

h.dispose();
await client.rqsStore?.close?.();
await server.stop();

// --- Second leg: the EXACT call the React provider makes (index.mjs:682) ---
const server2 = await startServer({
  port: await freePort(), bindPortExactly: true, db: join(stateDir, 'rn2.db'), cwd: repoRoot,
  provenance: { appId: 'warble', artifactsPath: join(appDir, 'snapback', 'generated', 'artifacts.json') },
});
const p2 = new SnapbackClient(server2.baseUrl, { ...server2.clientOptions, rqsStore: null });
await p2.ensureApp({ schema: gen('schema.manifest.json'), functions: gen('functions.manifest.json'), seed });
const c2 = new SnapbackClient(server2.baseUrl, server2.clientOptions);
const api = (await import(join(appDir, 'snapback', 'generated', 'api.mjs'))).default;

const h2 = await c2.startLiveQuery(api.timeline, {
  connectionId: 'rn-provider-shape',
  args: {},
  transport: 'stream',
  fallbackToPoll: false,
  persistResume: true,
});
await new Promise((r) => setTimeout(r, 2500));
console.log('provider-shape ', JSON.stringify({
  freshness: h2.freshness, connection: h2.connection,
  retainable: h2.retention?.retainable ?? null,
  code: h2.retention?.code ?? null,
  resume: h2.rqsResume ? 'token' : null,
}));
h2.dispose();
await c2.rqsStore?.close?.();
await server2.stop();
