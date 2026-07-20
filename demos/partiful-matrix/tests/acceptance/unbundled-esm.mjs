import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'packages/snapback-client/index.mjs',
  'packages/snapback-client/external-store.mjs',
  'demos/partiful-matrix/tests/acceptance/unbundled-esm.mjs',
];
const suite = createSuite('partiful matrix / direct unbundled browser ESM', { expectedChecks: 2 });

const html = `<!doctype html><html><body data-imported="pending" data-lifecycle="pending">
<script type="module">
  import { SnapbackClient, createExternalQueryStore } from '/packages/snapback-client/index.mjs';
  const client = new SnapbackClient('http://127.0.0.1:9');
  document.body.dataset.imported = client.baseUrl === 'http://127.0.0.1:9' ? 'yes' : 'no';
  const store = createExternalQueryStore({
    identity: 'unbundled-browser',
    start(controller) {
      controller.ready([{ id: 'browser-row' }], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = store.subscribe(() => {});
  const snapshot = store.getSnapshot();
  document.body.dataset.lifecycle = snapshot.status === 'ready' && snapshot.rows[0]?.id === 'browser-row' ? 'yes' : 'no';
  unsubscribe();
</script></body></html>`;

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(html);
    return;
  }
  const absolute = resolve(repoRoot, `.${pathname}`);
  const allowed = [
    resolve(repoRoot, 'packages/snapback-client'),
    resolve(repoRoot, 'packages/snapback-contract'),
  ].some((root) => absolute === root || absolute.startsWith(`${root}${sep}`));
  if (!allowed || extname(absolute) !== '.mjs') {
    response.writeHead(404).end();
    return;
  }
  try {
    statSync(absolute);
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    response.end(readFileSync(absolute));
  } catch {
    response.writeHead(404).end();
  }
});

const cleanups = [
  () => new Promise((resolveClose) => server.close(resolveClose)),
];

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();

await runAcceptance(suite, async () => {
  const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'partitime-unbundled-' });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.close());
  const page = await cdp.newPage();
  await page.navigate(`http://127.0.0.1:${address.port}/`);
  const output = await page.eval(`(async()=>{const d=Date.now()+10000;while(Date.now()<d){const imported=document.body?.dataset.imported;const lifecycle=document.body?.dataset.lifecycle;if(imported!=='pending'||lifecycle!=='pending')return {imported,lifecycle};await new Promise(r=>setTimeout(r,25));}return {imported:document.body?.dataset.imported,lifecycle:document.body?.dataset.lifecycle};})()`);
  await suite.check('the full Snapback client root imports in a browser without a bundler', async () => {
    assert(output.imported === 'yes', JSON.stringify(output));
  });
  await suite.check('the shipped lifecycle primitive executes from direct browser ESM', async () => {
    assert(output.lifecycle === 'yes', JSON.stringify(output));
  });
}, {
  cleanups,
  reportFile: option('receipt'),
  reportExtra: {
    delivery: 'direct-script-type-module',
    transforms: [],
    testInventory: sourcePaths.map((path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) })),
  },
});

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const value = pending.get(id);
    if (value) clearTimeout(value.timer);
    pending.delete(id);
    return value;
  };
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (!message.id || !pending.has(message.id)) return;
    const request = settle(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result || {});
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
    });
  };
  return {
    close: () => socket.close(),
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      return {
        navigate: (pageUrl) => send('Page.navigate', { url: pageUrl }, sessionId),
        eval: async (expression) => {
          const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
          return result.result?.value;
        },
      };
    },
  };
}
