// A3-11 render proof: the SAME BoardView module the browser app mounts is
// rendered under jsdom with a real prepared provider against the live dev
// server; the DOM must show the seeded board and update live when an
// independent client commits.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const root = resolve(import.meta.dirname);
const serverUrl = process.env.A3_SERVER_URL;
const token = process.env.A3_TOKEN;
const outFile = process.env.A3_OUT ?? join(root, 'a3-evidence', 'ui-render.json');
assert(serverUrl && token, 'A3_SERVER_URL and A3_TOKEN required');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${serverUrl}/?contract=board`,
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
const { BoardView } = await import('./src/board-view.mjs');
const api = (await import('./snapback/generated/api.mjs')).default;

const functions = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'functions.manifest.json'), 'utf8'));
const capabilityManifest = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'capability.manifest.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'schema.manifest.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(25);
  }
};

let exitCode = 1;
const result = { multiQueryCount: 6, domProof: {}, liveDomUpdate: false };
let provider = null;
let reactRoot = null;
try {
  const client = createExternalSessionClient(serverUrl, { bearerToken: token, rqsStore: null });
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
  });
  provider = createSnapbackReactProvider(binding);
  reactRoot = createRoot(document.getElementById('root'));
  reactRoot.render(h(SnapbackProvider, { provider }, h(BoardView, { orgId: 'org_relay' })));

  await until(() => document.querySelectorAll('[data-testid^="board-issue-ISS-"]').length >= 14, 'board cards render');
  const columns = document.querySelectorAll('[data-testid^="board-column-"]').length;
  const cards = document.querySelectorAll('[data-testid^="board-issue-ISS-"]').length;
  const aggregatesText = document.querySelector('[data-testid="board-aggregates"]').textContent;
  const activityItems = document.querySelectorAll('[data-testid="board-activity"] p').length;
  result.domProof = { columns, cards, aggregatesText, activityItems };
  assert(columns === 4, `4 board columns (${columns})`);
  assert(/\d+ total · \d+ todo/.test(aggregatesText), `aggregates rendered (${aggregatesText})`);

  // live DOM update from an independent (non-provider) client commit
  const independent = new SnapbackClient(serverUrl, {
    bearerToken: token, authClientProtocol: 1, authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1, authorizedLeaseProtocol: 1, rqsStore: null,
  });
  const created = await independent.mutate(api.createIssue, {
    args: { orgId: 'org_relay', teamId: 'team_platform', projectId: 'proj_sync',
      title: 'Rendered live from a second connection', description: '', priority: 3, actorName: 'Render check' } });
  const identifier = created.result.identifier;
  await until(() => (document.querySelector(`[data-testid="board-issue-${identifier}"]`) ? true : null), 'live card appears in DOM');
  const aggregatesAfter = document.querySelector('[data-testid="board-aggregates"]').textContent;
  result.liveDomUpdate = aggregatesAfter !== aggregatesText
    && document.querySelectorAll('[data-testid^="board-issue-ISS-"]').length === cards + 1;
  result.domProof.liveIdentifier = identifier;
  result.domProof.aggregatesAfter = aggregatesAfter;
  exitCode = result.liveDomUpdate ? 0 : 1;
  console.error(`UI RENDER: ${columns} columns, ${cards}→${cards + 1} cards, aggregates "${aggregatesAfter}"`);
} catch (error) {
  result.error = String(error?.message ?? error);
  console.error('UI RENDER FAIL:', result.error);
} finally {
  try { reactRoot?.unmount(); } catch { /* teardown */ }
  try { await provider?.dispose(); } catch { /* teardown */ }
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  process.exit(exitCode);
}
