// Real-Chromium acceptance for the Snapback-owned operator documents.
//
// Prerequisites:
//   bun run --cwd admin-ui build
//   cargo build --bin snapback
// Run:
//   node admin-ui/tests/acceptance/csp-browser.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const adminDist = join(repoRoot, 'admin-ui', 'dist');
const snapbackBin = process.env.SNAPBACK_BIN || join(repoRoot, 'target', 'debug', 'snapback');
const chromeBin = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MASTER = 'browser-admin-master-SENTINEL';

for (const [label, path] of [
  ['built admin index', join(adminDist, 'index.html')],
  ['Snapback binary', snapbackBin],
  ['Chrome binary', chromeBin],
]) {
  assert.equal(existsSync(path), true, `${label} missing at ${path}`);
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const serverStateDir = mkdtempSync(join(tmpdir(), 'snapback-admin-server-'));
const readyFile = join(serverStateDir, 'ready.json');
const server = spawn(snapbackBin, [
  '--host', '0.0.0.0',
  '--port', String(port),
  '--memory',
  '--ready-file', readyFile,
  '--allow-insecure-dev-auth',
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    SNAPBACK_ADMIN_DIST: adminDist,
    SNAPBACK_ADMIN_TOKEN: MASTER,
    SNAPBACK_PROFILE: 'dev',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let serverStderr = '';
server.stderr.on('data', (chunk) => {
  serverStderr = `${serverStderr}${chunk}`.slice(-8_000);
});

let chrome = null;
let cdp = null;
try {
  await waitForHttp(`${origin}/health`, server, 30_000, () => serverStderr);

  const headerProof = {
    admin: await proveResponseCsp(`${origin}/_snapback/admin`, 2),
    setup: await proveResponseCsp(`${origin}/_snapback/admin/setup`, 1),
  };

  chrome = await launchChrome();
  cdp = await connectCdp(chrome.ws);

  const admin = await cdp.newPage();
  await admin.navigate(`${origin}/_snapback/admin`);
  const adminPrompt = await admin.eval(`(async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      const input = document.querySelector('input[name="admin-token"]');
      if (input) return document.querySelector('h1')?.textContent || '';
      if (Date.now() > deadline) throw new Error('admin credential prompt did not render');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })()`);
  assert.equal(adminPrompt, 'Admin token required');
  await admin.eval(`(() => {
    const input = document.querySelector('input[name="admin-token"]');
    input.value = ${JSON.stringify(MASTER)};
    input.closest('form').requestSubmit();
  })()`);
  const adminBoot = await admin.eval(`(async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      const title = document.querySelector('[data-testid="title"]')?.textContent?.trim();
      if (title) return { title, root: document.querySelector('#exact-root')?.textContent || '' };
      if (Date.now() > deadline) {
        return {
          title: null,
          root: document.querySelector('#exact-root')?.textContent || '',
          promptError: document.querySelector('form pre')?.textContent || '',
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })()`);
  if (!adminBoot.title) {
    const failureEvents = await admin.events();
    throw new Error(`admin Contract surface did not boot after credential exchange: ${JSON.stringify({
      boot: adminBoot,
      events: failureEvents,
    })}`);
  }
  const adminTitle = adminBoot.title;
  assert.equal(adminTitle, 'Overview');
  const adminBrand = await admin.eval(`(() => {
    const image = document.querySelector('[data-testid="brand-mark"]');
    return image ? {
      tag: image.tagName,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      source: image.currentSrc,
    } : null;
  })()`);
  assert.equal(adminBrand?.tag, 'IMG');
  assert.equal(adminBrand.complete, true);
  assert.ok(adminBrand.naturalWidth > 0, `static brand mark did not load: ${JSON.stringify(adminBrand)}`);
  assert.match(adminBrand.source, /snapback-mark-(?:light|dark)\.svg$/);
  const adminDocs = await admin.eval(`(async () => {
    document.querySelector('[data-testid="nav-Docs"]')?.click();
    const deadline = Date.now() + 20000;
    for (;;) {
      const raw = document.querySelector('[data-testid="guide-open-raw"]');
      const title = document.querySelector('[data-testid="title"]')?.textContent?.trim();
      const text = document.querySelector('#exact-root')?.textContent || '';
      if (title === 'Docs' && raw && text.includes('The Snapback Guide')) {
        return { title, href: raw.getAttribute('href'), text };
      }
      if (Date.now() > deadline) return { title, href: raw?.getAttribute('href') || '', text };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })()`);
  assert.equal(adminDocs.title, 'Docs');
  assert.equal(adminDocs.href, '/_snapback/guide/index.md');
  assert.match(adminDocs.text, /The Snapback Guide/);
  assert.match(adminDocs.text, /Capability index/);
  const adminCustody = await browserCustodyProjection(admin);
  assert.equal(adminCustody.text.includes(MASTER), false);
  assert.equal(adminCustody.storage.includes(MASTER), false);
  assert.equal(adminCustody.storage.includes('sbcc_'), true);
  const adminEvents = await admin.events();
  assertCleanBoot('admin', adminEvents);
  const adminTrustedTypes = await proveTrustedTypesEnforcement(admin);

  const setup = await cdp.newPage();
  await setup.navigate(`${origin}/_snapback/admin/setup`);
  const setupPrompt = await setup.eval(`(async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      const auth = document.querySelector('#auth');
      if (auth && !auth.hidden) return document.querySelector('#authmsg')?.textContent || '';
      if (Date.now() > deadline) throw new Error('setup credential prompt did not render');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })()`);
  assert.match(setupPrompt, /admin API is disabled|admin token/i);
  await setup.eval(`(() => {
    const input = document.querySelector('#tokenInput');
    input.value = ${JSON.stringify(MASTER)};
    document.querySelector('#tokenSave').click();
  })()`);
  const setupSummary = await setup.eval(`(async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      const summary = document.querySelector('#summary');
      const auth = document.querySelector('#auth');
      if (summary && !summary.hidden && auth?.hidden) return summary.textContent.trim();
      if (Date.now() > deadline) throw new Error('setup did not refresh after credential exchange');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })()`);
  assert.ok(setupSummary.length > 0);
  const setupCustody = await browserCustodyProjection(setup);
  assert.equal(setupCustody.text.includes(MASTER), false);
  assert.equal(setupCustody.storage.includes(MASTER), false);
  assert.equal(setupCustody.storage.includes('sbcc_'), true);
  const setupEvents = await setup.events();
  assertCleanBoot('setup', setupEvents);
  const setupTrustedTypes = await proveTrustedTypesEnforcement(setup);

  console.log(JSON.stringify({
    ok: true,
    chrome: chrome.version,
    headerProof,
    admin: {
      prompt: adminPrompt,
      title: adminTitle,
      staticBrandImage: true,
      docsRendered: true,
      runtimeExceptions: adminEvents.runtimeExceptions.length,
      consoleErrors: adminEvents.consoleErrors.length,
      securityPolicyViolations: adminEvents.dom.violations.length,
      trustedTypes: adminTrustedTypes,
    },
    setup: {
      prompted: true,
      summaryRendered: true,
      runtimeExceptions: setupEvents.runtimeExceptions.length,
      consoleErrors: setupEvents.consoleErrors.length,
      securityPolicyViolations: setupEvents.dom.violations.length,
      trustedTypes: setupTrustedTypes,
    },
  }, null, 2));
} finally {
  try { cdp?.close(); } catch {}
  try { chrome?.stop(); } catch {}
  if (server.exitCode === null) server.kill('SIGTERM');
  rmSync(serverStateDir, { recursive: true, force: true });
}

async function browserCustodyProjection(page) {
  return page.eval(`(() => {
    const storage = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      storage.push([key, localStorage.getItem(key)]);
    }
    return { text: document.body.textContent || '', storage: JSON.stringify(storage) };
  })()`);
}

function assertCleanBoot(label, events) {
  assert.deepEqual(events.dom.violations, [], `${label}: securitypolicyviolation during boot`);
  assert.deepEqual(events.dom.errors, [], `${label}: window error during boot`);
  assert.deepEqual(events.dom.rejections, [], `${label}: unhandled rejection during boot`);
  assert.deepEqual(events.runtimeExceptions, [], `${label}: Runtime.exceptionThrown during boot`);
  assert.deepEqual(events.consoleErrors, [], `${label}: console error/assert during boot`);
  const securityLogs = events.logs.filter((entry) => (
    /content security policy|trusted(?:html|script| types)|refused to|security policy violation/i
      .test(`${entry.text || ''} ${entry.url || ''}`)
  ));
  assert.deepEqual(securityLogs, [], `${label}: CSP/Trusted Types browser log during boot`);
}

async function proveTrustedTypesEnforcement(page) {
  const result = await page.eval(`(async () => {
    const before = globalThis.__snapbackBrowserSecurityProbe.violations.length;
    let threw = false;
    let name = '';
    try {
      const node = document.createElement('div');
      node.innerHTML = '<span>must be rejected</span>';
    } catch (error) {
      threw = true;
      name = error?.name || '';
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const added = globalThis.__snapbackBrowserSecurityProbe.violations.slice(before);
    return {
      supported: typeof trustedTypes !== 'undefined',
      threw,
      name,
      violationDirectives: added.map((item) => item.effectiveDirective),
    };
  })()`);
  assert.equal(result.supported, true, 'Chrome exposes Trusted Types');
  assert.equal(result.threw, true, 'string innerHTML is rejected under require-trusted-types-for');
  assert.equal(result.name, 'TypeError');
  assert.ok(
    result.violationDirectives.includes('require-trusted-types-for'),
    `intentional Trusted Types sink produced no policy violation: ${JSON.stringify(result)}`,
  );
  return result;
}

async function proveResponseCsp(url, expectedInlineScripts) {
  const response = await fetch(url);
  assert.equal(response.status, 200, `${url}: expected HTTP 200`);
  const csp = response.headers.get('content-security-policy') || '';
  const html = await response.text();
  const bodies = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((body) => body.length > 0);
  assert.equal(bodies.length, expectedInlineScripts, `${url}: unexpected inline script inventory`);
  const hashes = bodies.map((body) => crypto.createHash('sha256').update(body).digest('base64'));
  for (const hash of hashes) {
    assert.ok(csp.includes(`'sha256-${hash}'`), `${url}: exact served inline hash missing`);
  }
  assert.ok(csp.includes("require-trusted-types-for 'script'"));
  assert.ok(csp.includes('trusted-types snapback'));
  assert.equal(/script-src[^;]*unsafe-inline/.test(csp), false);
  return { inlineScripts: bodies.length, exactHashesAdmitted: hashes.length };
}

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'snapback-admin-csp-'));
  const child = spawn(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const portFile = join(userDataDir, 'DevToolsActivePort');
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before CDP startup: ${stderr}`);
    try {
      const [debugPort] = readFileSync(portFile, 'utf8').trim().split('\n');
      const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((res) => res.json());
      return {
        ws: version.webSocketDebuggerUrl,
        version: version.Browser,
        stop() {
          try { child.kill('SIGKILL'); } catch {}
          rmSync(userDataDir, { recursive: true, force: true });
        },
      };
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Chrome did not expose DevToolsActivePort: ${stderr}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const sessionEvents = new Map();
  let nextId = 1;
  const settle = (id) => {
    const entry = pending.get(id);
    if (entry) clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  };
  const rejectAll = (reason) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason));
  };
  socket.addEventListener('message', async (event) => {
    const text = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(text);
    if (message.id && pending.has(message.id)) {
      const entry = settle(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result || {});
      return;
    }
    if (message.sessionId && message.method) {
      sessionEvents.get(message.sessionId)?.(message.method, message.params || {});
    }
  });
  socket.addEventListener('close', () => rejectAll('CDP socket closed'));
  socket.addEventListener('error', () => rejectAll('CDP socket errored'));
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connection failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectSend(new Error(`CDP command timed out: ${method}`));
      }, 30_000);
      pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
    });
  };
  return {
    close: () => socket.close(),
    async newPage() {
      const { browserContextId } = await send('Target.createBrowserContext');
      const { targetId } = await send('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
      });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const captured = { runtimeExceptions: [], consoleErrors: [], logs: [] };
      sessionEvents.set(sessionId, (method, params) => {
        if (method === 'Runtime.exceptionThrown') {
          captured.runtimeExceptions.push({
            text: params.exceptionDetails?.text,
            description: params.exceptionDetails?.exception?.description,
            url: params.exceptionDetails?.url,
          });
        } else if (method === 'Runtime.consoleAPICalled'
          && ['error', 'assert'].includes(params.type)) {
          captured.consoleErrors.push({
            type: params.type,
            values: (params.args || []).map((arg) => arg.value ?? arg.description ?? arg.type),
          });
        } else if (method === 'Log.entryAdded') {
          captured.logs.push(params.entry || {});
        }
      });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Log.enable', {}, sessionId);
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
          const probe = { violations: [], errors: [], rejections: [] };
          Object.defineProperty(globalThis, '__snapbackBrowserSecurityProbe', {
            value: probe, configurable: false, enumerable: false, writable: false,
          });
          document.addEventListener('securitypolicyviolation', (event) => {
            probe.violations.push({
              effectiveDirective: event.effectiveDirective,
              violatedDirective: event.violatedDirective,
              blockedURI: event.blockedURI,
              disposition: event.disposition,
              sample: event.sample,
              sourceFile: event.sourceFile,
              lineNumber: event.lineNumber,
              columnNumber: event.columnNumber,
            });
          }, true);
          globalThis.addEventListener('error', (event) => {
            probe.errors.push({ message: event.message, source: event.filename, line: event.lineno });
          });
          globalThis.addEventListener('unhandledrejection', (event) => {
            probe.rejections.push(String(event.reason?.message || event.reason));
          });
        })();`,
      }, sessionId);
      const evalRaw = async (expression) => {
        const result = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        }, sessionId);
        if (result.exceptionDetails) {
          throw new Error(
            result.exceptionDetails.exception?.description || result.exceptionDetails.text,
          );
        }
        return result.result?.value;
      };
      return {
        async navigate(pageUrl) {
          await send('Page.navigate', { url: pageUrl }, sessionId);
          await sleep(100);
          await evalRaw(`(async () => {
            const deadline = Date.now() + 20000;
            while (document.readyState !== 'complete') {
              if (Date.now() > deadline) throw new Error('document did not finish loading');
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
          })()`);
        },
        eval: evalRaw,
        async events() {
          const dom = await evalRaw(`structuredClone(globalThis.__snapbackBrowserSecurityProbe)`);
          return { dom, ...structuredClone(captured) };
        },
      };
    },
  };
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const serverSocket = net.createServer();
    serverSocket.once('error', rejectPort);
    serverSocket.listen(0, '127.0.0.1', () => {
      const address = serverSocket.address();
      serverSocket.close(() => resolvePort(address.port));
    });
  });
}

async function waitForHttp(url, child, timeoutMs, stderr) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Snapback exited before serving ${url}:\n${stderr()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Snapback did not serve ${url} within ${timeoutMs}ms:\n${stderr()}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
