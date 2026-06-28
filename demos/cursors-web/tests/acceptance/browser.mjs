// Web cursor presence acceptance for LLP 0025.
//
// Launches two isolated Chrome browser contexts through CDP, moves real mouse
// coordinates, and verifies the DOM overlay is fed by Snapback's WebSocket
// ephemeral lane.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { generate } from '../../../_kit/codegen.mjs';
import { assert, assertEqual, assertThrows, createSuite } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'cursors-web', 'snapback');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const suite = createSuite('cursors-web / browser');

let snapbackServer = null;
let staticServer = null;
let chrome = null;
let cdp = null;
let pageA = null;
let pageB = null;
let fatalError = null;

async function main() {
try {
  const generated = await generate(backendDir);
  assert(generated.ok, `codegen failed: ${JSON.stringify(generated.diagnostics)}`);

  snapbackServer = await startServer({ port: 4411, db: ':memory:', cwd: repoRoot });
  const db = new SnapbackClient(snapbackServer.baseUrl);
  staticServer = await startStaticServer(repoRoot);
  chrome = await launchChrome();
  cdp = await CdpConnection.connect(chrome.webSocketDebuggerUrl);

  await suite.check('schema loads once before browser clients connect', async () => {
    const res = await db.loadSchema(generated.schemaManifest);
    assertEqual(res.diagnostics, [], 'schema diagnostics');
    const state = await db.inspect();
    assertEqual(state.ephemeral.room_count, 0, 'rooms before browsers');
    return { baseUrl: snapbackServer.baseUrl, staticUrl: staticServer.baseUrl };
  });

  await suite.check('client A boots and publishes through WebSocket ephemeral lane', async () => {
    pageA = await cdp.newPage({ width: 900, height: 640 });
    await pageA.navigate(demoUrl(staticServer.baseUrl, snapbackServer.baseUrl));
    const state = await pageA.waitForReady();
    await pageA.moveMouse(240, 180);
    await pageA.waitForCursor(state.connectionId);
    return { connectionId: state.connectionId, profile: state.profile };
  });

  await suite.check('opening client B does not clear client A room', async () => {
    const stateA = await pageA.state();
    pageB = await cdp.newPage({ width: 900, height: 640 });
    await pageB.navigate(demoUrl(staticServer.baseUrl, snapbackServer.baseUrl));
    const stateB = await pageB.waitForReady();
    assert(stateA.connectionId !== stateB.connectionId, 'browser contexts should have distinct connection ids');
    const seenA = await pageB.waitForCursor(stateA.connectionId);
    assertEqual(seenA.name, stateA.profile.name, 'client B sees client A label');
    return { a: stateA.connectionId, b: stateB.connectionId, seenA };
  });

  await suite.check('moving client B renders in client A', async () => {
    const stateB = await pageB.state();
    await pageB.moveMouse(620, 390);
    const seenB = await pageA.waitForCursor(stateB.connectionId);
    assertEqual(seenB.name, stateB.profile.name, 'client A sees client B label');
    return seenB;
  });

  await suite.check('cursor publishes do not advance durable storage', async () => {
    const state = await db.inspect();
    assertEqual(state.storage.version, 0, 'durable storage version after cursor moves');
    assertEqual(state.ephemeral.room_count, 1, 'one cursor room');
    assert(state.ephemeral.entry_count >= 2, `expected at least two cursor entries, got ${state.ephemeral.entry_count}`);
    return { storageVersion: state.storage.version, ephemeral: state.ephemeral };
  });

  await suite.check('incompatible collection ensure is structured and non-destructive', async () => {
    const stale = structuredClone(generated.schemaManifest);
    stale.ephemeralCollections[0].maxValueBytes = 512;
    await assertThrows(
      () => db.ensureEphemeralCollections(stale),
      'SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION',
      'stale cursor collection should fail ensure',
    );
    const stateA = await pageA.state();
    const stateB = await pageB.state();
    await pageA.waitForCursor(stateB.connectionId);
    await pageB.waitForCursor(stateA.connectionId);
  });

  await suite.check('closing one browser removes its connection-owned cursor', async () => {
    const stateB = await pageB.state();
    await pageB.close();
    pageB = null;
    const gone = await pageA.waitForNoCursor(stateB.connectionId);
    assert(gone, 'client B cursor still visible after close');
  });
} catch (error) {
  fatalError = error;
  console.log(`  ✗ setup or teardown\n      ${error.stack || error.message}`);
} finally {
  const report = suite.finish();
  await pageB?.close().catch(() => {});
  await pageA?.close().catch(() => {});
  await cdp?.close().catch(() => {});
  await chrome?.stop().catch(() => {});
  await staticServer?.stop().catch(() => {});
  await snapbackServer?.stop?.();
  if (fatalError || !report.ok) process.exitCode = 1;
}
}

function demoUrl(staticBaseUrl, serverBaseUrl) {
  const url = new URL('/demos/cursors-web/surfaces/web/index.html', staticBaseUrl);
  url.searchParams.set('server', serverBaseUrl);
  url.searchParams.set('room', 'acceptance');
  return String(url);
}

async function startStaticServer(root) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const file = safeJoin(root, pathname === '/' ? '/index.html' : pathname);
      const stat = statSync(file);
      if (!stat.isFile()) throw Object.assign(new Error('not found'), { statusCode: 404 });
      res.writeHead(200, { 'content-type': contentType(file) });
      res.end(readFileSync(file));
    } catch (error) {
      res.writeHead(error.statusCode || 404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolveStop) => server.close(resolveStop)),
  };
}

function safeJoin(root, pathname) {
  const file = normalize(join(root, pathname));
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!file.startsWith(normalizedRoot)) {
    throw Object.assign(new Error('path escaped root'), { statusCode: 403 });
  }
  return file;
}

function contentType(file) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  }[extname(file)] || 'application/octet-stream';
}

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'snapback-cursors-chrome-'));
  const child = spawn(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited early (${child.exitCode}): ${stderr}`);
    }
    try {
      const [port] = readFileSync(portFile, 'utf8').trim().split('\n');
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json());
      return {
        webSocketDebuggerUrl: version.webSocketDebuggerUrl,
        stop: () => stopChrome(child, userDataDir),
      };
    } catch {
      await sleep(100);
    }
  }
  await stopChrome(child, userDataDir);
  throw new Error(`Chrome did not expose DevToolsActivePort: ${stderr}`);
}

function stopChrome(child, userDataDir) {
  return new Promise((resolveStop) => {
    const done = () => {
      rmSync(userDataDir, { recursive: true, force: true });
      resolveStop();
    };
    if (child.exitCode !== null) return done();
    const kill = setTimeout(() => child.kill('SIGKILL'), 2_000);
    child.on('exit', () => {
      clearTimeout(kill);
      done();
    });
    child.kill('SIGTERM');
  });
}

class CdpConnection {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', () => rejectOpen(new Error(`CDP socket failed: ${url}`)), { once: true });
    });
    return new CdpConnection(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener('message', async (event) => {
      const message = JSON.parse(await websocketText(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId = null) {
    const id = this.nextId++;
    const payload = sessionId === null ? { id, method, params } : { id, method, params, sessionId };
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { method, resolve: resolveSend, reject: rejectSend });
    });
  }

  async newPage({ width, height }) {
    const { browserContextId } = await this.send('Target.createBrowserContext');
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    return new CdpPage(this, { browserContextId, targetId, sessionId });
  }

  async close() {
    this.socket.close();
  }
}

class CdpPage {
  constructor(cdp, ids) {
    this.cdp = cdp;
    this.browserContextId = ids.browserContextId;
    this.targetId = ids.targetId;
    this.sessionId = ids.sessionId;
  }

  async navigate(url) {
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }, this.sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  waitForReady() {
    return this.evaluate(`(async () => {
      const deadline = Date.now() + 10000;
      while (!window.cursorDemo || window.cursorDemo.state().status !== 'ready') {
        if (Date.now() > deadline) {
          throw new Error(window.cursorDemo ? JSON.stringify(window.cursorDemo.state()) : 'cursorDemo not installed');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await window.cursorDemo.ready;
      return window.cursorDemo.state();
    })()`);
  }

  state() {
    return this.evaluate('window.cursorDemo.state()');
  }

  async moveMouse(x, y) {
    await this.cdp.send('Page.bringToFront', {}, this.sessionId);
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
    }, this.sessionId);
  }

  waitForCursor(connectionId) {
    return this.evaluate(`(async () => {
      const key = ${JSON.stringify(connectionId)};
      const deadline = Date.now() + 10000;
      while (Date.now() <= deadline) {
        const node = document.querySelector('.cursor[data-cursor-key="' + CSS.escape(key) + '"]');
        if (node) {
          return {
            key,
            name: node.dataset.name,
            x: Number(node.dataset.x),
            y: Number(node.dataset.y),
            label: node.querySelector('.cursor-label')?.textContent || ''
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('cursor not visible: ' + key);
    })()`);
  }

  waitForNoCursor(connectionId) {
    return this.evaluate(`(async () => {
      const key = ${JSON.stringify(connectionId)};
      const deadline = Date.now() + 10000;
      while (Date.now() <= deadline) {
        const node = document.querySelector('.cursor[data-cursor-key="' + CSS.escape(key) + '"]');
        if (!node) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    })()`);
  }

  async close() {
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
    await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.browserContextId }).catch(() => {});
  }
}

async function websocketText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data && typeof data.text === 'function') return data.text();
  return String(data);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

await main();
