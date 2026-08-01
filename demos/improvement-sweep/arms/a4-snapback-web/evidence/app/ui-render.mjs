// A4 auxiliary render proof (outside the 11 frozen checks, labeled as such):
// the SAME EventView module the browser app mounts is rendered under jsdom
// with a real prepared provider against a live dev server; the DOM must show
// the seeded event and update live when an independent client posts to the
// wall. Owns its dev server and a fresh seed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const root = resolve(import.meta.dirname);
const outFile = process.env.A4_OUT ?? join(root, 'a4-evidence', 'ui-render.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(25);
  }
};

for (const s of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${s}`), { force: true });
}
const guards = [];
for (const port of [4288, 4289, 4290]) {
  const g = createServer(() => {});
  await new Promise((res) => { g.once('error', () => res()); g.listen(port, '127.0.0.1', () => res()); });
  guards.push(g);
}
const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
  cwd: root, stdio: ['pipe', 'ignore', 'ignore'],
  env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
});
let ready = null;
for (let i = 0; i < 600 && !ready; i += 1) {
  await sleep(100);
  try { ready = JSON.parse(readFileSync(join(root, '.snapback', 'dev.ready.json'), 'utf8')); } catch { /* boot */ }
}
for (const g of guards) g.close();
await sleep(1200);
assert(ready && ![4288, 4289, 4290, 4420].includes(ready.port), 'own-port discipline');
const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
const ph = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
const serverUrl = ready.serverUrl;

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${serverUrl}/?contract=event&invite=INV-HOST-2214`,
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLIFrameElement = dom.window.HTMLIFrameElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle;
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const { createElement: h } = await import('react');
const { createRoot } = await import('react-dom/client');
const { SnapbackClient, createExternalSessionClient } = await import('@expo/snapback-client');
const { SnapbackProvider, createSnapbackReactProvider } = await import('@expo/snapback-react');
const { EventView } = await import('./src/event-view.mjs');
const api = (await import('./snapback/generated/api.mjs')).default;

const functions = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'functions.manifest.json'), 'utf8'));
const capabilityManifest = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'capability.manifest.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'schema.manifest.json'), 'utf8'));

async function signIn(email) {
  const requested = await fetch(`${serverUrl}/auth/request-code`, {
    method: 'POST', headers: ph, body: JSON.stringify({ email }) }).then((r) => r.json());
  const mailbox = await fetch(
    `${serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
  ).then((r) => r.json());
  const credential = await fetch(`${serverUrl}/auth/exchange`, {
    method: 'POST', headers: ph,
    body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }) }).then((r) => r.json());
  return credential.token;
}

let exitCode = 1;
const result = { multiQueryCount: 3, domProof: {}, liveDomUpdate: false };
let provider = null;
let reactRoot = null;
let independent = null;
try {
  // the render user enters exactly the deep-link way: invite code from the URL
  const hostToken = await signIn('render-host@sweep-a4.test');
  const hostClient = new SnapbackClient(serverUrl, {
    bearerToken: hostToken, authClientProtocol: 1, rqsStore: null, clientStoreId: `a4-render-${process.pid}` });
  const inviteCode = new URL(dom.window.location.href).searchParams.get('invite');
  await hostClient.mutate(api.redeemInvite, { args: { code: inviteCode, name: 'Render Host', enteredVia: 'deep-link' } });
  await hostClient.closeAuth?.();

  const client = createExternalSessionClient(serverUrl, { bearerToken: hostToken, rqsStore: null });
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
  });
  provider = createSnapbackReactProvider(binding);
  reactRoot = createRoot(document.getElementById('root'));
  reactRoot.render(h(SnapbackProvider, { provider }, h(EventView, { eventId: 'evt_lantern' })));

  await until(() => (document.querySelector('[data-testid="event-title"]')?.textContent === 'Lantern Supper Club' ? true : null), 'event renders');
  const guestCount = document.querySelector('[data-testid="event-guest-count"]').textContent;
  const wallPosts = document.querySelectorAll('[data-testid^="event-wall-"]').length;
  const guestListText = document.querySelector('[data-testid="event-guest-list"]').textContent;
  result.domProof = { guestCount, wallPosts, guestListText };
  assert(guestCount === '6 / 12 attending', `seeded seat math renders (${guestCount})`);
  assert(wallPosts === 3, `seeded wall renders (${wallPosts})`);

  // live DOM update from an independent (non-provider) client commit
  const guestToken = await signIn('render-guest@sweep-a4.test');
  independent = new SnapbackClient(serverUrl, {
    bearerToken: guestToken, authClientProtocol: 1, authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1, authorizedLeaseProtocol: 1, rqsStore: null,
    clientStoreId: `a4-render-ind-${process.pid}` });
  await independent.mutate(api.redeemInvite, { args: { code: 'INV-GUEST-7008', name: 'Render Guest', enteredVia: 'code' } });
  await independent.mutate(api.postWall, {
    args: { eventId: 'evt_lantern', body: 'Rendered live from a second connection', clientKey: 'a4-render-live', authorName: 'Render Guest' } });
  await until(() => (document.querySelectorAll('[data-testid^="event-wall-"]').length === wallPosts + 1 ? true : null), 'live wall post appears in DOM');
  const wallAfter = document.querySelector('[data-testid="event-wall-4"]')?.textContent ?? '';
  result.liveDomUpdate = wallAfter.includes('Rendered live from a second connection');
  result.domProof.wallAfter = wallAfter;
  exitCode = result.liveDomUpdate ? 0 : 1;
  console.error(`UI RENDER: ${guestCount}, wall ${wallPosts}→${wallPosts + 1}, live "${wallAfter}"`);
} catch (error) {
  result.error = String(error?.message ?? error);
  console.error('UI RENDER FAIL:', result.error);
} finally {
  try { reactRoot?.unmount(); } catch { /* teardown */ }
  try { await provider?.dispose(); } catch { /* teardown */ }
  try { await independent?.closeAuth?.(); } catch { /* teardown */ }
  child.stdin.end();
  await until(() => (child.exitCode !== null ? true : null), 'dev exit', 15_000).catch(() => child.kill('SIGTERM'));
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  process.exit(exitCode);
}
