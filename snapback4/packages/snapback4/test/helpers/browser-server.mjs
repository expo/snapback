// @ref LLP 3000#publication-suite-under-contention — immutable fixtures must not invalidate mounted browser contexts.
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../../../..');
const require = createRequire(resolve(root, 'packages/snapback4/package.json'));
const vite = () => import(pathToFileURL(createRequire(resolve(root, 'apps/chat/package.json')).resolve('vite')).href);
const dependencies = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
const navigations = new WeakMap();

// Record violations until teardown: a readiness wait may succeed again in a
// replacement document, even though it lost the state being tested.
export async function loadBrowserPage(t, page, url, { allowSameDocumentNavigation = false } = {}) {
  assert.ok(!navigations.has(page), 'a fixture page has only one initial load');
  const state = { unexpected: [], allowance: undefined };
  navigations.set(page, state);
  const record = url => {
    if (state.allowance && !state.allowance.consumed) state.allowance.consumed = true;
    else state.unexpected.push(url);
  };
  // Playwright's framenavigated merges document replacement and history/hash
  // changes. These Chromium fixtures distinguish them so a declared SPA route
  // allowance can never excuse a reload that discards the mounted document.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  let mainFrame = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
  cdp.on('Page.frameNavigated', ({ frame }) => {
    if (frame.parentId) return;
    mainFrame = frame.id;
    record(frame.url);
  });
  cdp.on('Page.navigatedWithinDocument', ({ frameId, url }) => {
    if (frameId === mainFrame && !allowSameDocumentNavigation) record(url);
  });
  t.after(() => assert.deepEqual(state.unexpected, [], 'unexpected main-frame navigation in immutable browser fixture'));
  return navigate(page, () => page.goto(url));
}

// Only the declared reload's first navigation is allowed. Extra navigations
// during it still fail, and a failed action cannot leave an allowance behind.
export async function reloadBrowserPage(page) {
  return navigate(page, () => page.reload());
}

async function navigate(page, action) {
  const state = navigations.get(page);
  assert.ok(state, 'loadBrowserPage must install the navigation guard first');
  assert.equal(state.allowance, undefined, 'fixture navigations must not overlap');
  state.allowance = { consumed: false };
  try { return await action(); }
  finally { state.allowance = undefined; }
}

// Immutable browser fixtures have no package manifest in their temporary root.
// Prebundle all React entry points before serving: discovering another CJS entry
// later can invalidate already-served modules and request a full-page reload.
// HMR alone suppresses that message, but does not prevent the invalidation.
export async function createBrowserServer(config) {
  const { createServer } = await vite();
  assert.equal(config.server.port, 0, 'immutable fixtures require a kernel-assigned port');
  const server = await createServer({
    ...config,
    // A TMPDIR below a package must not inherit that package's shared cache:
    // another fixture can replace its optimized files while a page uses them.
    cacheDir: resolve(config.root, '.vite'),
    optimizeDeps: { noDiscovery: true, include: dependencies },
    server: { ...config.server, hmr: false, watch: null,
      // Darwin's tmpdir may spell /private/var as /var. Lazy modules do not
      // inherit the initial crawl's safe-module exemption from this allowlist.
      fs: { ...config.server?.fs, allow: config.server.fs.allow.map(path => realpathSync(path)) },
    },
    resolve: { ...config.resolve, alias: [
      ...(config.resolve?.alias ?? []),
      ...dependencies.map(name => ({ find: new RegExp('^' + name + '$'), replacement: require.resolve(name) })),
    ] },
  });
  // Vite 8 probes/closes an ephemeral socket, then binds that concrete port
  // after initializing its environments. Another process can take it during
  // initialization. Bind the real socket atomically with port 0 instead. Vite
  // derives resolvedUrls from that socket's actual address on 'listening'.
  // These immutable fixtures never restart or depend on Vite's remembered port.
  const listen = server.httpServer.listen.bind(server.httpServer);
  server.httpServer.listen = (_probedPort, ...args) => listen(0, ...args);
  return server;
}

export async function browserLogger(trace) {
  const { createLogger } = await vite();
  const logger = createLogger('info');
  for (const level of ['info', 'warn', 'error']) logger[level] = message => trace('vite:' + level, message);
  return logger;
}
