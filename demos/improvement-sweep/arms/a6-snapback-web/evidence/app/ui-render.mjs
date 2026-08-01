// A6 auxiliary render proof (outside the 10 frozen checks, labeled as such):
// the SAME OpsView module the browser app mounts is rendered under jsdom
// with a real prepared provider against a live dev server; the DOM must
// show the seeded ledger and update live — including the nested JobPanel
// (a second provider-owned live-query group) reflecting an independent
// operator's claim and a fresh JOB-4 sequence allocation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const root = resolve(import.meta.dirname);
const outFile = process.env.A6_OUT ?? join(root, 'a6-evidence', 'ui-render.json');
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
for (const port of [4287, 4288, 4289, 4290, 4291, 4292]) {
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
assert(ready && ![4287, 4288, 4289, 4290, 4291, 4292, 4420].includes(ready.port), 'own-port discipline');
const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
const ph = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
const serverUrl = ready.serverUrl;

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${serverUrl}/?contract=ops&invite=INV-DISPATCH-5501`,
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
const { OpsView } = await import('./src/ops-view.mjs');
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
const result = { multiQueryGroups: 2, domProof: {}, liveDomUpdate: false };
let provider = null;
let reactRoot = null;
let independent = null;
try {
  // the render user enters exactly the deep-link way: invite code from the URL
  const dispatcherToken = await signIn('render-dispatcher@sweep-a6.test');
  const seatClient = new SnapbackClient(serverUrl, {
    bearerToken: dispatcherToken, authClientProtocol: 1, rqsStore: null, clientStoreId: `a6-render-${process.pid}` });
  const inviteCode = new URL(dom.window.location.href).searchParams.get('invite');
  await seatClient.mutate(api.redeemInvite, { args: { code: inviteCode } });
  await seatClient.closeAuth?.();

  const client = createExternalSessionClient(serverUrl, { bearerToken: dispatcherToken, rqsStore: null });
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
  });
  provider = createSnapbackReactProvider(binding);
  reactRoot = createRoot(document.getElementById('root'));
  reactRoot.render(h(SnapbackProvider, { provider }, h(OpsView, { orgId: 'org_meridian' })));

  await until(() => (document.querySelector('[data-testid="ops-org-name"]')?.textContent === 'Meridian Operations' ? true : null), 'org renders');
  await until(() => (document.querySelectorAll('[data-testid^="ops-job-JOB-"]').length >= 3 ? true : null), 'seeded jobs render');
  const counts = document.querySelector('[data-testid="ops-dashboard-counts"]').textContent;
  const seededRows = [...document.querySelectorAll('[data-testid="ops-job-list"] .issue-row')].map((b) => b.dataset.testid);
  await until(() => (document.querySelector('[data-testid="ops-detail-title"]') ? true : null), 'detail panel renders');
  const detailTitle = document.querySelector('[data-testid="ops-detail-title"]').textContent;
  const detailSteps = document.querySelectorAll('[data-testid="ops-detail-steps"] li').length;
  result.domProof = { counts, seededRows, detailTitle, detailSteps };
  assert(counts.includes('3 jobs') && counts.includes('2 open') && counts.includes('1 done') && counts.includes('seq 3'),
    `seeded aggregates render (${counts})`);

  // live DOM update from an independent (non-provider) client: an operator
  // claims JOB-2 and creates JOB-4; both must land in the dispatcher's DOM.
  const operatorToken = await signIn('render-operator@sweep-a6.test');
  independent = new SnapbackClient(serverUrl, {
    bearerToken: operatorToken, authClientProtocol: 1, authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1, authorizedLeaseProtocol: 1, rqsStore: null,
    clientStoreId: `a6-render-ind-${process.pid}` });
  await independent.mutate(api.redeemInvite, { args: { code: 'INV-OP-6601' } });
  const t0 = Date.now();
  await independent.mutate(api.claimJob, { args: { jobId: 'job_repair_delta', actorName: 'Render Operator', leaseMs: 120000 } });
  await until(() => (document.querySelector('[data-testid="ops-job-status-JOB-2"]')?.textContent?.includes('claimed') ? true : null), 'claim renders live');
  const claimMs = Date.now() - t0;
  const claimedPill = document.querySelector('[data-testid="ops-job-status-JOB-2"]').textContent;
  const customers = await independent.query(api.customerList, { args: { orgId: 'org_meridian' } });
  const northYard = customers.rows.find((c) => c.name === 'North Yard');
  const t1 = Date.now();
  const created = await independent.mutate(api.createJob, { args: {
    orgId: 'org_meridian', title: 'Render probe: fence check', customerId: northYard._id,
    scheduledFor: Date.now(), dedupeKey: 'render-job-1', creatorName: 'Render Operator', followUpDelayMs: 0 } });
  await until(() => (document.querySelector(`[data-testid="ops-job-${created.result.display}"]`) ? true : null), 'new sequence renders live');
  const createMs = Date.now() - t1;
  const countsAfter = document.querySelector('[data-testid="ops-dashboard-counts"]').textContent;
  result.domProof = {
    ...result.domProof, claimedPill, claimMs, createdDisplay: created.result.display, createMs, countsAfter,
  };
  result.liveDomUpdate = claimedPill.includes('Render Operator') && created.result.display === 'JOB-4'
    && countsAfter.includes('4 jobs') && countsAfter.includes('1 claimed');
  exitCode = result.liveDomUpdate ? 0 : 1;
  console.error(`UI RENDER: ${counts} -> ${countsAfter}; claim ${claimMs}ms (${claimedPill}); ${created.result.display} appeared in ${createMs}ms`);
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
