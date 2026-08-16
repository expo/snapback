#!/usr/bin/env node

// LLP 0258 Phase 1.4 standards-real browser proof runner.
//
// This runner reuses the repository's raw-CDP system-Chrome process machinery
// and drives Safari through safaridriver's W3C WebDriver REST API. It has no
// Playwright/Puppeteer dependency and serves the esbuild page bundle from the
// same local origin that proxies the real Snapback server's public auth routes.
//
// @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client
//   — StrictMode and repeated construction measure the exact owner key.
// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
//   — Chromium must expose real IndexedDB and Web Locks; no memory substitute.
// @ref LLP 0059#cross-context-ownership — two real browser contexts share one
//   origin and durable custody; messages are never treated as authority.
// @ref LLP 0059#transition-barrier — hygiene assertions inspect a registered
//   participant's quiesce/blank/clear/settle trace.

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { launchChromeCdp } from '../../demos/_kit/chrome-process.mjs';
import {
  ownProcessTree,
  startServer,
  stopChild,
} from '../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');
const RUN_DATE = '2026-08-16';
const PAGE_MODULE_PATH = join(here, 'browser-auth-bootstrap-v1-page.mjs');
const FIXTURE_BACKEND = join(ROOT, 'demos', 'rbac', 'snapback');
const GENERATED = join(FIXTURE_BACKEND, 'generated');
const DEFAULT_WITNESS_PATH = join(
  ROOT,
  'tests/acceptance/fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json',
);
const DEFAULT_SERVER_BINARY = join(ROOT, 'target', 'debug', 'snapback');
const PROFILE_TEMP_ROOT = process.platform === 'darwin' ? '/tmp' : tmpdir();
const SAFARIDRIVER_PATH = '/usr/bin/safaridriver';
const PAGE_GLOBAL = 'snapbackBrowserAuthBootstrap';
const PROOF_DEFINITIONS = Object.freeze([
  ['1', 'reload-restoration'],
  ['2', 'two-tab-ownership'],
  ['3', 'strict-mode-remount'],
  ['4', 'logout-user-switch-hygiene'],
  ['5', 'corruption'],
  ['6', 'blocked-recovery'],
]);

const options = {
  browser: process.env.CHROME_PATH ?? process.env.SNAPBACK_BROWSER_EXECUTABLE ?? null,
  headed: false,
  webdriverMockCheck: false,
  witness: DEFAULT_WITNESS_PATH,
  serverBinary: process.env.SNAPBACK_RUNTIME_BINARY ?? DEFAULT_SERVER_BINARY,
};

const fail = (code, message, details = {}) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  throw error;
};

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--browser') options.browser = resolve(process.argv[++index]);
  else if (argument === '--headed') options.headed = true;
  else if (argument === '--webdriver-mock-check') options.webdriverMockCheck = true;
  else if (argument === '--witness') options.witness = resolve(process.argv[++index]);
  else if (argument === '--server-binary') options.serverBinary = resolve(process.argv[++index]);
  else fail('SNAPBACK_BROWSER_AUTH_BOOTSTRAP_USAGE', `unknown argument: ${argument}`);
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalValue(value[key]);
    return output;
  }
  return Object.is(value, -0) ? 0 : value;
};
const stableText = (value, spacing = 0) => JSON.stringify(canonicalValue(value), null, spacing);
const publicError = (error) => ({
  code: error?.code ?? error?.diagnostic?.code ?? 'SNAPBACK_BROWSER_AUTH_BOOTSTRAP_RUNNER_ERROR',
  message: String(error?.message ?? error).replace(/sbs_[A-Za-z0-9._~-]+/gu, '[REDACTED]'),
});

function resolveChrome() {
  if (options.browser !== null) {
    if (!existsSync(options.browser)) {
      fail('SNAPBACK_BROWSER_AUTH_BROWSER_NOT_FOUND', `browser executable missing: ${options.browser}`);
    }
    return resolve(options.browser);
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    fail(
      'SNAPBACK_BROWSER_AUTH_BROWSER_NOT_FOUND',
      'no system Chrome-family browser found; pass --browser or set SNAPBACK_BROWSER_EXECUTABLE',
    );
  }
  return found;
}

function macAppBundleFor(executable) {
  const marker = '.app/Contents/MacOS/';
  const index = executable.indexOf(marker);
  return index === -1 ? null : executable.slice(0, index + '.app'.length);
}

// Engine-specific lifecycle/transport is kept behind this adapter boundary;
// the proof choreography below consumes only the small page interface.
const BROWSER_ENGINE_ADAPTERS = Object.freeze({
  chromium: Object.freeze({
    id: 'chromium',
    async launch({ executable, profilePath, headed }) {
      const appBundle = process.platform === 'darwin' ? macAppBundleFor(executable) : null;
      if (process.platform === 'darwin' && appBundle === null) {
        fail(
          'SNAPBACK_BROWSER_AUTH_BROWSER_APP_BUNDLE_REQUIRED',
          `macOS Chrome executable is not inside an app bundle: ${executable}`,
        );
      }
      return launchChromeCdp({
        // macOS 26 aborts app-bundle executables directly spawned while they
        // register with CoreServices. `open -W` performs registration and
        // remains the owned leader until Browser.close.
        chromeBin: process.platform === 'darwin' ? '/usr/bin/open' : executable,
        launchPrefixArgs: process.platform === 'darwin'
          ? ['-n', '-W', appBundle, '--args']
          : [],
        userDataDir: profilePath,
        headless: !headed,
        stopSignal: 'SIGTERM',
        startupTimeoutMs: 20_000,
        pollMs: 50,
        extraArgs: [
          '--remote-allow-origins=*',
          '--disable-background-networking',
          '--disable-component-update',
        ],
      });
    },
  }),
  webkit: Object.freeze({
    id: 'webkit',
    async launch() {
      if (process.platform !== 'darwin' || !existsSync(SAFARIDRIVER_PATH)) {
        fail(
          'SNAPBACK_BROWSER_AUTH_SAFARIDRIVER_UNAVAILABLE',
          'the WebKit arm requires /usr/bin/safaridriver on macOS',
        );
      }
      return launchSafariWebDriver({ executable: SAFARIDRIVER_PATH });
    },
  }),
});

async function ensureFixtureArtifacts() {
  execFileSync(process.execPath, [
    join(ROOT, 'packages/snapback-codegen/index.mjs'),
    FIXTURE_BACKEND,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const required = [
    'schema.manifest.json',
    'functions.manifest.json',
    'app.descriptor.json',
    'app.mjs',
  ];
  for (const name of required) {
    if (!existsSync(join(GENERATED, name))) {
      fail('SNAPBACK_BROWSER_AUTH_FIXTURE_CODEGEN_FAILED', `codegen omitted ${name}`);
    }
  }
  const descriptor = JSON.parse(await readFile(join(GENERATED, 'app.descriptor.json'), 'utf8'));
  if (
    descriptor?.authBootstrap?.custody !== 'durable-required'
    || !descriptor?.authBootstrap?.entryMechanisms?.includes('password-v1')
  ) {
    fail(
      'SNAPBACK_BROWSER_AUTH_FIXTURE_POLICY_INVALID',
      'fixture descriptor must require durable custody and admit password-v1',
    );
  }
  return descriptor;
}

async function bundlePage() {
  const result = await build({
    entryPoints: [PAGE_MODULE_PATH],
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"development"' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  return result.outputFiles[0].contents;
}

const readRequestBytes = async (request, maximum = 1024 * 1024) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximum) fail('SNAPBACK_BROWSER_AUTH_PROXY_BODY_LIMIT', 'request body exceeded 1 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

function createGate(pathname, expected) {
  let resolveEntered;
  let resolveRelease;
  const enteredPromise = new Promise((resolve) => { resolveEntered = resolve; });
  const releasePromise = new Promise((resolve) => { resolveRelease = resolve; });
  return {
    pathname,
    expected,
    entered: 0,
    released: false,
    enteredPromise,
    releasePromise,
    enter() {
      this.entered += 1;
      if (this.entered >= this.expected) resolveEntered();
    },
    release() {
      if (this.released) return;
      this.released = true;
      resolveRelease();
    },
  };
}

async function startHarnessServer(bundle, upstreamOrigin) {
  const html = Buffer.from(
    '<!doctype html><html><head><meta charset="utf-8"><title>browser-auth-bootstrap-v1</title></head>'
      + '<body><main id="app">browser-auth-bootstrap-v1</main>'
      + '<script type="module" src="/bundle.mjs"></script></body></html>',
  );
  const requestFacts = [];
  const gates = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(html);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/bundle.mjs') {
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(bundle);
        return;
      }
      const gate = gates.get(url.pathname) ?? null;
      if (gate !== null) {
        gate.enter();
        await gate.releasePromise;
      }
      const body = ['GET', 'HEAD'].includes(request.method ?? 'GET')
        ? undefined
        : await readRequestBytes(request);
      const headers = new Headers();
      for (const [name, rawValue] of Object.entries(request.headers)) {
        if (
          rawValue === undefined
          || ['connection', 'content-length', 'host', 'transfer-encoding'].includes(name)
        ) continue;
        headers.set(name, Array.isArray(rawValue) ? rawValue.join(', ') : rawValue);
      }
      const upstream = await fetch(`${upstreamOrigin}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body,
        redirect: 'manual',
      });
      requestFacts.push(Object.freeze({
        method: request.method,
        pathname: url.pathname,
        status: upstream.status,
      }));
      if (process.env.SNAPBACK_BROWSER_AUTH_DEBUG_HEADERS === '1' && url.pathname.startsWith('/auth/')) {
        const scrubbed = Object.fromEntries(Object.entries(request.headers).map(([n, v]) =>
          [n, /authorization|cookie|token/i.test(n) ? '<redacted-present>' : v]));
        const bodyText = body ? Buffer.from(body).toString('utf8').replace(/"password":"[^"]*"/g, '"password":"<redacted>"') : null;
        console.error('AUTH-DEBUG', url.pathname, JSON.stringify({ headers: scrubbed, body: bodyText, status: upstream.status }).slice(0, 900));
      }
      const responseHeaders = {};
      for (const [name, value] of upstream.headers) {
        if (!['connection', 'content-length', 'transfer-encoding'].includes(name)) {
          responseHeaders[name] = value;
        }
      }
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      if (process.env.SNAPBACK_BROWSER_AUTH_DEBUG_HEADERS === '1' && url.pathname.startsWith('/auth/')) {
        const match = upstreamBody.toString('utf8').match(/"userId":"([^"]+)"/);
        console.error('AUTH-DEBUG-RESPONSE', url.pathname, upstream.status, 'serverUserId=' + (match?.[1] ?? 'none'));
      }
      response.writeHead(upstream.status, responseHeaders);
      response.end(upstreamBody);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        diagnostic: {
          code: error?.code ?? 'SNAPBACK_BROWSER_AUTH_PROXY_FAILED',
          message: 'the local browser proof proxy could not complete the upstream request',
        },
      }));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    fail('SNAPBACK_BROWSER_AUTH_HARNESS_BIND_FAILED', 'harness did not bind TCP');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requestFacts,
    armGate(pathname, expected = 2) {
      if (gates.has(pathname)) throw new Error(`route gate already active for ${pathname}`);
      const gate = createGate(pathname, expected);
      gates.set(pathname, gate);
      return gate;
    },
    async waitForGate(gate, timeoutMs = 15_000) {
      await Promise.race([
        gate.enteredPromise,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error(`timed out waiting for ${gate.pathname} race gate`)),
          timeoutMs,
        )),
      ]);
    },
    releaseGate(gate) {
      gate.release();
      gates.delete(gate.pathname);
    },
    releaseAllGates() {
      for (const gate of gates.values()) gate.release();
      gates.clear();
    },
    counts() {
      const output = {};
      for (const fact of requestFacts) {
        const key = `${fact.method} ${fact.pathname}`;
        output[key] ??= { total: 0, statuses: {} };
        output[key].total += 1;
        output[key].statuses[fact.status] = (output[key].statuses[fact.status] ?? 0) + 1;
      }
      return output;
    },
    close: () => new Promise((resolveClose, rejectClose) => server.close(
      (error) => error ? rejectClose(error) : resolveClose(),
    )),
  };
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
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
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (!message.id || !pending.has(message.id)) return;
    const entry = settle(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => rejectAll('CDP socket closed'));
  socket.addEventListener('error', () => rejectAll('CDP socket errored'));
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connect failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null, timeoutMs = 60_000) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectResult(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
    });
  };
  const waitForPageApi = async (evaluate) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`typeof globalThis.${PAGE_GLOBAL} === 'object'`)) return;
      } catch {
        // Navigation may replace the execution context between polls.
      }
      await sleep(50);
    }
    fail('SNAPBACK_BROWSER_AUTH_PAGE_NOT_READY', 'browser page did not expose its proof API');
  };
  return {
    close() { socket.close(); },
    async newPage(url) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      const evaluate = async (expression, timeoutMs = 60_000) => {
        const result = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }, sessionId, timeoutMs);
        if (result.exceptionDetails) {
          const description = result.exceptionDetails.exception?.description
            ?? result.exceptionDetails.text
            ?? 'browser evaluation failed';
          throw new Error(description.replace(/sbs_[A-Za-z0-9._~-]+/gu, '[REDACTED]'));
        }
        return result.result?.value;
      };
      await send('Page.navigate', { url }, sessionId);
      await waitForPageApi(evaluate);
      return {
        targetId,
        eval: evaluate,
        call(method, argument = undefined, timeoutMs = 60_000) {
          const input = argument === undefined
            ? ''
            : `JSON.parse(${JSON.stringify(JSON.stringify(argument))})`;
          return evaluate(
            `globalThis.${PAGE_GLOBAL}[${JSON.stringify(method)}](${input})`,
            timeoutMs,
          );
        },
        async reload() {
          await send('Page.reload', { ignoreCache: true }, sessionId);
          await waitForPageApi(evaluate);
        },
        close: () => send('Target.closeTarget', { targetId }),
      };
    },
  };
}

async function reserveLoopbackPort() {
  const reservation = createServer();
  await new Promise((resolveListen, rejectListen) => {
    reservation.once('error', rejectListen);
    reservation.listen(0, '127.0.0.1', resolveListen);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolveClose) => reservation.close(resolveClose));
    fail('SNAPBACK_BROWSER_AUTH_WEBDRIVER_PORT_FAILED', 'could not reserve a safaridriver port');
  }
  await new Promise((resolveClose, rejectClose) => reservation.close(
    (error) => error ? rejectClose(error) : resolveClose(),
  ));
  return address.port;
}

function webdriverFailure(payload, status, method, pathname) {
  const remote = payload?.value && typeof payload.value === 'object' ? payload.value : {};
  const message = String(remote.message ?? `${method} ${pathname} returned HTTP ${status}`)
    .replace(/sbs_[A-Za-z0-9._~-]+/gu, '[REDACTED]');
  const error = new Error(`WebDriver ${method} ${pathname} failed: ${message}`);
  error.code = 'SNAPBACK_BROWSER_AUTH_WEBDRIVER_COMMAND_FAILED';
  error.webdriverError = remote.error ?? null;
  error.details = { status, method, pathname, webdriverError: error.webdriverError };
  return error;
}

async function createWebDriverSession(baseUrl) {
  const request = async (method, pathname, body = undefined, timeoutMs = 70_000) => {
    let response;
    try {
      response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const wrapped = new Error(`WebDriver ${method} ${pathname} transport failed: ${error.message}`);
      wrapped.code = 'SNAPBACK_BROWSER_AUTH_WEBDRIVER_TRANSPORT_FAILED';
      wrapped.cause = error;
      throw wrapped;
    }
    const text = await response.text();
    let payload = {};
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw webdriverFailure({ value: { message: 'response was not JSON' } }, response.status, method, pathname);
      }
    }
    if (!response.ok || payload?.value?.error) {
      throw webdriverFailure(payload, response.status, method, pathname);
    }
    return payload.value;
  };

  const created = await request('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'safari' } },
  }, 120_000);
  const sessionId = created?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    fail('SNAPBACK_BROWSER_AUTH_WEBDRIVER_SESSION_INVALID', 'safaridriver omitted the session id');
  }
  const capabilities = created.capabilities ?? {};
  const sessionPath = `/session/${encodeURIComponent(sessionId)}`;
  let initialHandle;
  try {
    await request('POST', `${sessionPath}/timeouts`, {
      implicit: 0,
      pageLoad: 60_000,
      script: 120_000,
    });
    const handles = await request('GET', `${sessionPath}/window/handles`);
    initialHandle = Array.isArray(handles) ? handles[0] ?? null : null;
    if (initialHandle === null) {
      fail('SNAPBACK_BROWSER_AUTH_WEBDRIVER_WINDOW_MISSING', 'Safari session opened without a window');
    }
  } catch (error) {
    try { await request('DELETE', sessionPath); } catch { /* best-effort initialization cleanup */ }
    throw error;
  }

  let queue = Promise.resolve();
  let sessionClosed = false;
  const openHandles = new Set();
  const enqueue = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
  const command = (method, pathname, body = undefined, timeoutMs = 70_000) => (
    request(method, `${sessionPath}${pathname}`, body, timeoutMs)
  );
  const switchTo = (handle) => command('POST', '/window', { handle });
  const withWindow = (handle, operation) => enqueue(async () => {
    await switchTo(handle);
    return operation();
  });
  const executeSync = (handle, script, args = [], timeoutMs = 70_000) => withWindow(
    handle,
    () => command('POST', '/execute/sync', { script, args }, timeoutMs),
  );
  const waitForPageApi = async (handle) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const ready = await executeSync(
          handle,
          'return typeof globalThis[arguments[0]] === "object";',
          [PAGE_GLOBAL],
        );
        if (ready === true) return;
      } catch {
        // Navigation may replace the execution context between polls.
      }
      await sleep(50);
    }
    fail('SNAPBACK_BROWSER_AUTH_PAGE_NOT_READY', 'Safari page did not expose its proof API');
  };

  const startOperationScript = `
    const [globalName, method, hasArgument, argument, operationId] = arguments;
    const registryName = '__snapbackWebDriverOperationsV1';
    const registry = globalThis[registryName] ??= Object.create(null);
    registry[operationId] = { done: false };
    let operation;
    try {
      const api = globalThis[globalName];
      operation = hasArgument ? api[method](argument) : api[method]();
    } catch (error) {
      registry[operationId] = {
        done: true,
        ok: false,
        error: String(error?.stack ?? error?.message ?? error),
      };
      return true;
    }
    Promise.resolve(operation).then(
      (value) => { registry[operationId] = { done: true, ok: true, value }; },
      (error) => {
        registry[operationId] = {
          done: true,
          ok: false,
          error: String(error?.stack ?? error?.message ?? error),
        };
      },
    );
    return true;
  `;
  const pollOperationScript = `
    const registry = globalThis.__snapbackWebDriverOperationsV1;
    const entry = registry?.[arguments[0]];
    if (!entry?.done) return { done: false };
    delete registry[arguments[0]];
    return entry;
  `;
  const call = async (handle, method, argument = undefined, timeoutMs = 60_000) => {
    const operationId = randomUUID();
    await executeSync(handle, startOperationScript, [
      PAGE_GLOBAL,
      method,
      argument !== undefined,
      argument ?? null,
      operationId,
    ]);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await executeSync(handle, pollOperationScript, [operationId]);
      if (result?.done === true) {
        if (result.ok === true) return result.value;
        throw new Error(String(result.error ?? 'Safari page evaluation failed')
          .replace(/sbs_[A-Za-z0-9._~-]+/gu, '[REDACTED]'));
      }
      await sleep(20);
    }
    fail(
      'SNAPBACK_BROWSER_AUTH_WEBDRIVER_SCRIPT_TIMEOUT',
      `Safari page operation timed out: ${method}`,
    );
  };

  return {
    capabilities,
    get sessionClosed() { return sessionClosed; },
    async newPage(url) {
      let handle;
      if (initialHandle !== null) {
        handle = initialHandle;
        initialHandle = null;
      } else {
        const createdWindow = await enqueue(() => command('POST', '/window/new', { type: 'tab' }));
        handle = createdWindow?.handle;
      }
      if (typeof handle !== 'string' || handle.length === 0) {
        fail('SNAPBACK_BROWSER_AUTH_WEBDRIVER_WINDOW_INVALID', 'Safari omitted a new window handle');
      }
      openHandles.add(handle);
      await withWindow(handle, () => command('POST', '/url', { url }));
      await waitForPageApi(handle);
      let closed = false;
      return {
        targetId: handle,
        eval(expression) {
          return executeSync(handle, `return (${expression});`);
        },
        call(method, argument = undefined, timeoutMs = 60_000) {
          return call(handle, method, argument, timeoutMs);
        },
        async reload() {
          await withWindow(handle, () => command('POST', '/refresh'));
          await waitForPageApi(handle);
        },
        async close() {
          if (closed) return;
          closed = true;
          if (sessionClosed) return;
          if (openHandles.size <= 1) return;
          try {
            await withWindow(handle, () => command('DELETE', '/window'));
          } finally {
            openHandles.delete(handle);
          }
        },
      };
    },
    async close() {
      if (sessionClosed) return;
      try {
        await enqueue(() => request('DELETE', sessionPath));
      } catch (error) {
        if (error?.webdriverError !== 'invalid session id') throw error;
      } finally {
        sessionClosed = true;
        openHandles.clear();
      }
    },
  };
}

async function launchSafariWebDriverAttempt({ executable }) {
  const port = await reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(executable, ['--port', String(port)], {
    cwd: ROOT,
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = (chunk) => {
    output = `${output}${chunk}`.slice(-16_000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const ownership = ownProcessTree(child, () => stopChild(child, { graceMs: 3_000 }));
  try {
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        fail(
          'SNAPBACK_BROWSER_AUTH_SAFARIDRIVER_EXITED',
          `safaridriver exited during startup: ${output.trim() || 'no diagnostic output'}`,
        );
      }
      try {
        const response = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(1_000) });
        const payload = response.ok ? await response.json() : null;
        if (payload?.value?.ready !== false) {
          ready = response.ok;
          if (ready) break;
        }
      } catch {
        // The process may not have bound its socket yet.
      }
      await sleep(50);
    }
    if (!ready) {
      fail(
        'SNAPBACK_BROWSER_AUTH_SAFARIDRIVER_START_TIMEOUT',
        `safaridriver did not become ready on its ephemeral port: ${output.trim() || 'no diagnostic output'}`,
      );
    }
    const client = await createWebDriverSession(baseUrl);
    return {
      client,
      capabilities: client.capabilities,
      async closeSession() { await client.close(); },
      async stop() { await ownership.stop(); },
    };
  } catch (error) {
    try {
      await ownership.stop();
    } catch (cleanupError) {
      const startupAndCleanupError = new AggregateError(
        [error, cleanupError],
        `safaridriver startup and cleanup failed: ${error.message}`,
        { cause: error },
      );
      startupAndCleanupError.code = error?.code;
      throw startupAndCleanupError;
    }
    throw error;
  }
}

const SAFARIDRIVER_START_ATTEMPTS = 3;

function retryableSafariDriverStartup(error) {
  return error?.code === 'SNAPBACK_BROWSER_AUTH_SAFARIDRIVER_EXITED'
    || (
      error?.code === 'SNAPBACK_BROWSER_AUTH_SAFARIDRIVER_START_TIMEOUT'
      && /address(?: already)? in use|bind|EADDRINUSE/iu.test(error.message)
    );
}

async function launchSafariWebDriver({ executable }) {
  for (let attempt = 1; attempt <= SAFARIDRIVER_START_ATTEMPTS; attempt += 1) {
    try {
      return await launchSafariWebDriverAttempt({ executable });
    } catch (error) {
      if (!retryableSafariDriverStartup(error)) throw error;
      if (attempt === SAFARIDRIVER_START_ATTEMPTS) {
        fail(
          error.code,
          `safaridriver startup failed after ${attempt} freshly reserved-port attempts: ${error.message}`,
          { attempts: attempt, lastFailure: publicError(error) },
        );
      }
    }
  }
  throw new Error('unreachable safaridriver startup retry state');
}

async function runWebDriverMockCheck() {
  const sessionId = 'mock-session';
  const handles = ['mock-window-a'];
  const operations = new Map();
  const facts = {
    sessionCreated: false,
    secondWindowCreated: false,
    windowSwitched: 0,
    navigationCount: 0,
    reloadCount: 0,
    secondWindowClosed: false,
    sessionClosed: false,
    initializationFailureCleaned: false,
  };
  let failInitialization = false;
  let currentHandle = handles[0];
  const mock = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const bodyBytes = ['GET', 'DELETE'].includes(request.method ?? 'GET')
      ? Buffer.alloc(0)
      : await readRequestBytes(request);
    const body = bodyBytes.length === 0 ? {} : JSON.parse(bodyBytes.toString('utf8'));
    let value = null;
    if (request.method === 'POST' && url.pathname === '/session') {
      facts.sessionCreated = true;
      value = {
        sessionId,
        capabilities: { browserName: 'safari', browserVersion: 'mock-1' },
      };
    } else if (request.method === 'POST' && url.pathname === `/session/${sessionId}/timeouts`) {
      if (failInitialization) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ value: { error: 'timeout', message: 'mock init failure' } }));
        return;
      }
      value = null;
    } else if (request.method === 'GET' && url.pathname === `/session/${sessionId}/window/handles`) {
      value = [...handles];
    } else if (request.method === 'POST' && url.pathname === `/session/${sessionId}/window/new`) {
      const handle = 'mock-window-b';
      handles.push(handle);
      facts.secondWindowCreated = true;
      value = { handle, type: body.type };
    } else if (request.method === 'POST' && url.pathname === `/session/${sessionId}/window`) {
      currentHandle = body.handle;
      facts.windowSwitched += 1;
      value = null;
    } else if (request.method === 'POST' && url.pathname === `/session/${sessionId}/url`) {
      facts.navigationCount += 1;
      value = null;
    } else if (request.method === 'POST' && url.pathname === `/session/${sessionId}/refresh`) {
      facts.reloadCount += 1;
      value = null;
    } else if (request.method === 'POST' && url.pathname === `/session/${sessionId}/execute/sync`) {
      if (body.script.includes('typeof globalThis[arguments[0]]')) {
        value = true;
      } else if (body.script.includes("const registryName = '__snapbackWebDriverOperationsV1'")) {
        const operationId = body.args[4];
        operations.set(operationId, {
          done: true,
          ok: true,
          value: { method: body.args[1], argument: body.args[3], handle: currentHandle },
        });
        value = true;
      } else if (body.script.includes('globalThis.__snapbackWebDriverOperationsV1')) {
        value = operations.get(body.args[0]) ?? { done: false };
        operations.delete(body.args[0]);
      } else {
        value = true;
      }
    } else if (request.method === 'DELETE' && url.pathname === `/session/${sessionId}/window`) {
      const index = handles.indexOf(currentHandle);
      if (index !== -1) handles.splice(index, 1);
      currentHandle = handles[0] ?? null;
      facts.secondWindowClosed = handles.length === 1;
      value = [...handles];
    } else if (request.method === 'DELETE' && url.pathname === `/session/${sessionId}`) {
      facts.sessionClosed = true;
      if (failInitialization) facts.initializationFailureCleaned = true;
      value = null;
    } else {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ value: { error: 'unknown command', message: url.pathname } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ value }));
  });
  await new Promise((resolveListen, rejectListen) => {
    mock.once('error', rejectListen);
    mock.listen(0, '127.0.0.1', resolveListen);
  });
  const address = mock.address();
  if (!address || typeof address === 'string') {
    fail('SNAPBACK_BROWSER_AUTH_WEBDRIVER_MOCK_BIND_FAILED', 'mock WebDriver did not bind TCP');
  }
  try {
    const client = await createWebDriverSession(`http://127.0.0.1:${address.port}`);
    const pageA = await client.newPage('http://example.invalid/a');
    const pageB = await client.newPage('http://example.invalid/b');
    const [left, right] = await Promise.all([
      pageA.call('mockLeft', { side: 'left' }),
      pageB.call('mockRight', { side: 'right' }),
    ]);
    if (
      left.method !== 'mockLeft'
      || left.argument?.side !== 'left'
      || left.handle !== 'mock-window-a'
      || right.method !== 'mockRight'
      || right.argument?.side !== 'right'
      || right.handle !== 'mock-window-b'
    ) {
      fail('SNAPBACK_BROWSER_AUTH_WEBDRIVER_MOCK_CALL_FAILED', 'mock page calls crossed window handles');
    }
    await pageA.reload();
    await pageB.close();
    await pageA.close();
    await client.close();
    failInitialization = true;
    let initializationFailure = null;
    try {
      await createWebDriverSession(`http://127.0.0.1:${address.port}`);
    } catch (error) {
      initializationFailure = error;
    }
    if (initializationFailure?.code !== 'SNAPBACK_BROWSER_AUTH_WEBDRIVER_COMMAND_FAILED') {
      fail(
        'SNAPBACK_BROWSER_AUTH_WEBDRIVER_MOCK_INIT_FAILURE_MISSING',
        'mock WebDriver initialization did not fail with the expected typed command diagnostic',
      );
    }
  } finally {
    await new Promise((resolveClose, rejectClose) => mock.close(
      (error) => error ? rejectClose(error) : resolveClose(),
    ));
  }
  if (!Object.values(facts).every((value) => value === true || (typeof value === 'number' && value > 0))) {
    fail('SNAPBACK_BROWSER_AUTH_WEBDRIVER_MOCK_INCOMPLETE', 'mock WebDriver did not observe every lifecycle arm', facts);
  }
  return facts;
}

const proofResult = (id, name, checks, details = {}) => {
  const failed = checks.filter(({ pass }) => !pass);
  return {
    id,
    name,
    outcome: failed.length === 0 ? 'PASS' : 'FAIL',
    evidence: failed.length === 0
      ? checks.map(({ note }) => note).join('; ')
      : failed.map(({ note }) => note).join('; '),
    checks,
    details,
  };
};

const check = (name, pass, note) => ({ name, pass: pass === true, note });

// Durable restoration deliberately does not fabricate entry-only provenance
// (`provider`) or bearer-derived expiry hints. "Same settled principal" is
// the stable public authority identity, while revision/epoch are asserted
// independently and exactly.
const principalIdentity = (principal) => {
  if (principal?.status === 'authenticated') {
    return {
      status: principal.status,
      userId: principal.userId ?? null,
      sessionId: principal.sessionId ?? null,
      authorityInstanceId: principal.authorityInstanceId ?? null,
      authorizationStreamIncarnation: principal.authorizationStreamIncarnation ?? null,
      sessionClass: principal.sessionClass ?? null,
      sessionGeneration: principal.sessionGeneration ?? null,
    };
  }
  if (principal?.status === 'anonymous') {
    return {
      status: principal.status,
      authorityInstanceId: principal.authorityInstanceId ?? null,
      authorizationStreamIncarnation: principal.authorizationStreamIncarnation ?? null,
    };
  }
  return principal ?? null;
};
const samePrincipal = (left, right) => (
  stableText(principalIdentity(left)) === stableText(principalIdentity(right))
);
const captureMatchesCustody = (snapshot) => Boolean(
  snapshot?.capture
  && snapshot?.custody?.shape === 'record'
  && snapshot.capture.authorityEpoch === snapshot.custody.authorityEpoch
  && snapshot.capture.custodyRevision === snapshot.custody.revision
);
const settledUser = (snapshot) => snapshot?.custody?.phase === 'settled'
  ? snapshot.custody.userId
  : null;
const protectedEmpty = (snapshot) => (
  snapshot?.protected?.rows?.length === 0
  && snapshot?.protected?.optimistic?.length === 0
);
const protectedMaterialized = (snapshot) => (
  snapshot?.protected?.rows?.length === 1
  && snapshot?.protected?.optimistic?.length === 1
);
const sameSettledAuthority = (left, right) => Boolean(
  left?.custody?.phase === 'settled'
  && right?.custody?.phase === 'settled'
  && left?.capture
  && right?.capture
  && left.capture.authorityEpoch === right.capture.authorityEpoch
  && left.capture.authorityKey === right.capture.authorityKey
  && left.custody.authorityKind === right.custody.authorityKind
  && left.custody.userId === right.custody.userId
  && left.custody.sessionId === right.custody.sessionId
  && samePrincipal(left.principal, right.principal)
);
const sameSettledCustody = (left, right) => (
  sameSettledAuthority(left, right)
  && left.capture.custodyRevision === right.capture.custodyRevision
  && left.custody.revision === right.custody.revision
);
const barrierBlankedAfterSeed = (seed, settled) => {
  if (!protectedMaterialized(seed) || !Array.isArray(settled?.barrierEvents)) return false;
  const events = settled.barrierEvents.slice(seed.barrierEvents?.length ?? 0);
  return events.some(({ phase, protectedRows }) => phase === 'blank' && protectedRows === 0)
    && events.some(({ phase, optimisticState }) => (
      phase === 'clearMemory' && optimisticState === 0
    ));
};
const barrierEvidenceAfterSeed = (seed, settled) => ({
  seed: snapshotEvidence(seed),
  events: (settled?.barrierEvents ?? []).slice(seed?.barrierEvents?.length ?? 0).map((event) => ({
    phase: event.phase,
    reason: event.reason,
    protectedRows: event.protectedRows,
    optimisticState: event.optimisticState,
  })),
});

const snapshotEvidence = (snapshot) => ({
  bootstrap: snapshot?.bootstrap ? {
    status: snapshot.bootstrap.status ?? null,
    authoritySource: snapshot.bootstrap.authoritySource ?? null,
    diagnosticCode: snapshot.bootstrap.diagnosticCode ?? null,
    custody: snapshot.bootstrap.custody ?? null,
  } : null,
  principal: principalIdentity(snapshot?.principal),
  custody: snapshot?.custody ? {
    shape: snapshot.custody.shape ?? null,
    phase: snapshot.custody.phase ?? null,
    authorityKind: snapshot.custody.authorityKind ?? null,
    userId: snapshot.custody.userId ?? null,
    sessionId: snapshot.custody.sessionId ?? null,
    revision: snapshot.custody.revision ?? null,
    authorityEpoch: snapshot.custody.authorityEpoch ?? null,
    bearerPresent: snapshot.custody.bearerPresent ?? false,
    pendingAuthorityPresent: snapshot.custody.pendingAuthorityPresent ?? false,
    pendingBearerPresent: snapshot.custody.pendingBearerPresent ?? false,
  } : null,
  capture: snapshot?.capture ?? null,
  protected: {
    rows: snapshot?.protected?.rows?.length ?? null,
    optimistic: snapshot?.protected?.optimistic?.length ?? null,
  },
  lastError: snapshot?.lastError ? {
    ok: snapshot.lastError.ok ?? false,
    code: snapshot.lastError.code ?? null,
    bootstrap: snapshot.lastError.bootstrap ?? null,
  } : null,
});

const operationEvidence = (result) => ({
  ok: result?.ok === true,
  code: result?.code ?? null,
  snapshot: snapshotEvidence(result?.snapshot),
});

const manualRecoveryEvidence = (recovery) => ({
  results: recovery.results.map(operationEvidence),
  snapshots: recovery.snapshots.map(snapshotEvidence),
});

const raceEvidence = (race, automatic) => ({
  results: race.results.map(operationEvidence),
  requests: race.requests,
  automatic: automatic.map(snapshotEvidence),
});

async function gatedRace(harness, pathname, calls) {
  const beforeIndex = harness.requestFacts.length;
  const gate = harness.armGate(pathname, calls.length);
  const pending = calls.map((call) => call());
  try {
    await harness.waitForGate(gate);
  } finally {
    harness.releaseGate(gate);
  }
  const results = await Promise.all(pending);
  const requests = harness.requestFacts.slice(beforeIndex).filter((fact) => fact.pathname === pathname);
  return { results, requests };
}

async function observePages(pageA, pageB, milliseconds = 1_500) {
  const deadline = Date.now() + milliseconds;
  let snapshots;
  do {
    snapshots = await Promise.all([pageA.call('snapshot'), pageB.call('snapshot')]);
    const [left, right] = snapshots;
    if (
      samePrincipal(left.principal, right.principal)
      && captureMatchesCustody(left)
      && captureMatchesCustody(right)
    ) break;
    await sleep(50);
  } while (Date.now() < deadline);
  return snapshots;
}

async function manuallyConverge(pageA, pageB) {
  const results = await Promise.all([pageA.call('synchronize'), pageB.call('synchronize')]);
  return {
    results,
    snapshots: await Promise.all([pageA.call('snapshot'), pageB.call('snapshot')]),
  };
}

const proofSkips = (code, reason) => PROOF_DEFINITIONS.map(([id, name]) => ({
  id,
  name,
  outcome: 'SKIP',
  code,
  evidence: reason,
}));

const engineSkip = (engine, code, reason, details = {}) => ({
  engine,
  status: 'SKIP',
  skip: { code, reason },
  proofs: proofSkips(code, reason),
  ...details,
});

if (options.webdriverMockCheck) {
  const facts = await runWebDriverMockCheck();
  process.stdout.write(`${JSON.stringify({ ok: true, webdriverMock: facts })}\n`);
  process.exit(0);
}

const browserExecutable = resolveChrome();
if (!existsSync(options.serverBinary)) {
  fail(
    'SNAPBACK_BROWSER_AUTH_SERVER_BINARY_NOT_FOUND',
    `server binary is missing: ${options.serverBinary}`,
  );
}

const fixtureDescriptor = await ensureFixtureArtifacts();
const bundle = await bundlePage();
const schema = JSON.parse(await readFile(join(GENERATED, 'schema.manifest.json'), 'utf8'));
const functions = JSON.parse(await readFile(join(GENERATED, 'functions.manifest.json'), 'utf8'));
const fixtureFiles = [
  'demos/rbac/snapback/schema.mjs',
  'demos/rbac/snapback/functions.mjs',
  'demos/rbac/snapback/generated/artifacts.json',
  'demos/rbac/snapback/generated/schema.manifest.json',
  'demos/rbac/snapback/generated/functions.manifest.json',
  'demos/rbac/snapback/generated/app.descriptor.json',
];
const sourceFiles = [
  'tests/acceptance/browser-auth-bootstrap-v1.mjs',
  'tests/acceptance/browser-auth-bootstrap-v1-page.mjs',
  'packages/snapback-client/app-client.mjs',
  'packages/snapback-contract/auth-custody-indexeddb.mjs',
  'demos/_kit/chrome-process.mjs',
  'demos/_kit/server-process.mjs',
];
const hashFiles = async (paths) => Promise.all(paths.map(async (path) => ({
  path,
  sha256: sha256(await readFile(join(ROOT, path))),
})));
const binaryStats = await stat(options.serverBinary);
const chromeVersion = execFileSync(browserExecutable, ['--version'], { encoding: 'utf8' }).trim();
const safariDriverVersion = existsSync(SAFARIDRIVER_PATH)
  ? execFileSync(SAFARIDRIVER_PATH, ['--version'], { encoding: 'utf8' }).trim()
  : null;
const osVersion = process.platform === 'darwin'
  ? execFileSync('sw_vers', [], { encoding: 'utf8' }).trim().replaceAll('\t', ' ')
  : execFileSync('uname', ['-a'], { encoding: 'utf8' }).trim();
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const gitDirty = execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';
const engineInputs = Object.fromEntries(['chromium', 'webkit'].map((engine) => {
  const credentialNonce = randomBytes(12).toString('hex');
  return [engine, {
    databaseName: `snapback-browser-auth-bootstrap-${engine}-${randomUUID()}`,
    credentials: {
      alice: {
        email: `browser-auth-${engine}-a-${credentialNonce}@example.invalid`,
        password: `A-${randomBytes(24).toString('base64url')}!9z`,
      },
      bob: {
        email: `browser-auth-${engine}-b-${credentialNonce}@example.invalid`,
        password: `B-${randomBytes(24).toString('base64url')}!9z`,
      },
    },
  }];
}));

const witness = {
  schemaVersion: 'snapback.browser-auth-bootstrap-witness.v1',
  runDate: RUN_DATE,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  ok: false,
  source: {
    gitCommit,
    gitDirty,
    note: 'Executed bytes are pinned below; this witness and its proof artifacts are committed with the landing.',
    node: process.version,
    files: await hashFiles(sourceFiles),
    bundle: { sha256: sha256(bundle), bytes: bundle.length },
  },
  server: {
    binary: {
      path: resolve(options.serverBinary),
      sha256: sha256(await readFile(options.serverBinary)),
      size: binaryStats.size,
      mtimeMs: binaryStats.mtimeMs,
      version: execFileSync(options.serverBinary, ['--version'], { encoding: 'utf8' }).trim(),
    },
    origin: null,
    requests: null,
  },
  fixture: {
    identity: {
      appId: fixtureDescriptor.identity.app,
      schema: fixtureDescriptor.identity.schema,
      functions: fixtureDescriptor.identity.functions,
      descriptor: fixtureDescriptor.identity.descriptor,
    },
    authBootstrap: fixtureDescriptor.authBootstrap,
    startupArtifactIdentity: {
      schemaHash: schema.schemaHash,
      bundleHash: functions.bundleHash,
    },
    files: await hashFiles(fixtureFiles),
  },
  engines: [],
  cleanup: {
    browserStopped: false,
    profileRemoved: false,
    harnessClosed: false,
    serverStopped: false,
    scratchRemoved: false,
    databaseDeleted: false,
    engines: {},
  },
  nonclaims: [
    'The StrictMode proof drives React development StrictMode and repeated real DOM mount/unmount; it does not drive a Metro/Vite Fast Refresh session and is not Fast Refresh evidence.',
    'Chromium and WebKit evidence does not establish Firefox, native custody, hosted auth, XSS resistance, or sender-constrained credentials.',
  ],
  secretScan: null,
};

let scratch = null;
let server = null;
let harness = null;
let infrastructureFailure = null;
const infrastructureFailures = [];
let launchedBinaryPath = null;

try {
  scratch = await mkdtemp(join(tmpdir(), 'snapback-browser-auth-bootstrap-'));
  // The requested binary can live outside this worktree (as it does in the
  // Lane W invocation). The shared server helper persists a digest-bound
  // readiness receipt beside the executable after running runtime-qualify.
  // Launch a byte-identical scratch copy so the proof neither rewrites the
  // primary checkout's receipt nor falls back to Cargo when that directory is
  // read-only to the lane.
  launchedBinaryPath = join(scratch, 'snapback');
  await copyFile(options.serverBinary, launchedBinaryPath);
  await chmod(launchedBinaryPath, 0o755);
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  await writeFile(
    startupArtifacts,
    `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
    { mode: 0o600 },
  );
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: ROOT,
    startupArtifacts,
    captureImpersonationCapability: false,
    serverBinary: launchedBinaryPath,
  });
  witness.server.launch = {
    strategy: 'qualified-byte-identical-scratch-copy',
    path: '<run-scratch>/snapback',
    sha256: sha256(await readFile(launchedBinaryPath)),
    sourceByteIdentical: sha256(await readFile(launchedBinaryPath))
      === witness.server.binary.sha256,
    identityVerdict: server.identity?.verdict ?? null,
    identity: server.identity?.binary ?? null,
  };
  witness.server.origin = server.baseUrl.replace(/:\d+$/u, ':<ephemeral-port>');
  harness = await startHarnessServer(bundle, server.baseUrl);
  for (const engineId of ['chromium', 'webkit']) {
    const { databaseName, credentials } = engineInputs[engineId];
    const proofs = [];
    const engineCleanup = engineId === 'chromium'
      ? { transportClosed: false, browserStopped: false, profileRemoved: false, databaseDeleted: false }
      : { sessionClosed: false, driverStopped: false, databaseDeleted: false };
    witness.cleanup.engines[engineId] = engineCleanup;
    let profilePath = null;
    let chrome = null;
    let cdp = null;
    let webkit = null;
    let browser = null;
    let pageA = null;
    let pageB = null;
    let seedPage = null;
    let lockPage = null;
    let environment = null;
    let environmentSkip = null;
    let engineEntry = null;
    let engineFailure = null;

    try {
      if (engineId === 'chromium') {
        profilePath = await mkdtemp(join(PROFILE_TEMP_ROOT, 'snapback-browser-auth-bootstrap-profile-'));
        chrome = await BROWSER_ENGINE_ADAPTERS.chromium.launch({
          executable: browserExecutable,
          profilePath,
          headed: options.headed,
        });
        cdp = await connectCdp(chrome.ws);
        browser = cdp;
      } else {
        webkit = await BROWSER_ENGINE_ADAPTERS.webkit.launch();
        browser = webkit.client;
      }
      const pageUrl = `${harness.origin}/?database=${encodeURIComponent(databaseName)}`;
      pageA = await browser.newPage(pageUrl);
      environment = await pageA.call('envFacts');
      const unavailable = [
        ...(environment.indexedDb === true ? [] : ['IndexedDB']),
        ...(environment.webLocks === true ? [] : ['Web Locks']),
      ];
      if (engineId === 'webkit' && unavailable.length > 0) {
        const code = unavailable.includes('Web Locks')
          ? 'SNAPBACK_BROWSER_AUTH_WEBKIT_WEB_LOCKS_UNAVAILABLE'
          : 'SNAPBACK_BROWSER_AUTH_WEBKIT_INDEXEDDB_UNAVAILABLE';
        const reason = `Safari ${unavailable.join(' and ')} capability unavailable: `
          + `indexedDB=${environment.indexedDb}, navigator.locks=${environment.webLocks}`;
        environmentSkip = { code, reason };
        proofs.push(...proofSkips(code, reason));
        const databaseCleanup = await pageA.call('deleteDatabase');
        engineCleanup.databaseDeleted = databaseCleanup.databaseDeleted === true;
      } else {
        const initialReady = await pageA.call('ready');
        if (!initialReady.ok || environment.indexedDb !== true || environment.webLocks !== true) {
          fail(
            'SNAPBACK_BROWSER_AUTH_PLATFORM_CAPABILITY_MISSING',
            `${engineId} did not expose a ready durable IndexedDB/Web Locks app client`,
            { initialReady, environment },
          );
        }
        const countsAtEngineStart = harness.counts();
        const issuanceAtEngineStart =
          (countsAtEngineStart['POST /auth/password/signup']?.total ?? 0)
          + (countsAtEngineStart['POST /auth/password/signin']?.total ?? 0);

  // Proof 1: signup + signin, then a real same-origin page reload.
  const proof1Checks = [];
  const signup = await pageA.call('signUp', credentials.alice);
  const signupLogout = await pageA.call('signOut');
  const signin = await pageA.call('signIn', credentials.alice);
  const beforeReload = await pageA.call('snapshot');
  const countsBeforeReload = harness.counts();
  await pageA.reload();
  const afterReloadReady = await pageA.call('ready');
  const afterReload = afterReloadReady.snapshot;
  const reloadEnvironment = await pageA.call('envFacts');
  const countsAfterReload = harness.counts();
  const issuanceBefore = (countsBeforeReload['POST /auth/password/signup']?.total ?? 0)
    + (countsBeforeReload['POST /auth/password/signin']?.total ?? 0)
    - issuanceAtEngineStart;
  const issuanceAfter = (countsAfterReload['POST /auth/password/signup']?.total ?? 0)
    + (countsAfterReload['POST /auth/password/signin']?.total ?? 0)
    - issuanceAtEngineStart;
  proof1Checks.push(
    check('signup', signup.ok, 'password signup settled through the app-client facade'),
    check('logout-before-signin', signupLogout.ok, 'signup authority blanked to anonymous before signin'),
    check('signin', signin.ok, 'password signin settled through the app-client facade'),
    check(
      'real-reload',
      reloadEnvironment.navigationType === 'reload',
      `navigation entry reports ${reloadEnvironment.navigationType ?? 'missing'} (expected reload)`,
    ),
    check(
      'same-principal',
      samePrincipal(beforeReload.principal, afterReload.principal),
      'the stable public authority identity is unchanged across reload',
    ),
    check(
      'exact-revision-epoch',
      beforeReload.custody?.revision === afterReload.custody?.revision
        && beforeReload.custody?.authorityEpoch === afterReload.custody?.authorityEpoch,
      `custody stayed revision ${beforeReload.custody?.revision ?? '?'} / epoch ${beforeReload.custody?.authorityEpoch ?? '?'}`,
    ),
    check(
      'no-reissuance',
      issuanceBefore === issuanceAfter,
      `credential issuance count stayed ${issuanceBefore}`,
    ),
    check(
      'restored-source',
      afterReload.bootstrap?.authoritySource === 'durable-restored',
      `reload bootstrap source is ${afterReload.bootstrap?.authoritySource ?? 'missing'}`,
    ),
    check('durable-capture-exact', captureMatchesCustody(afterReload), 'local capture matches durable revision/epoch'),
  );
  proofs.push(proofResult('1', 'reload-restoration', proof1Checks, {
    before: snapshotEvidence(beforeReload),
    after: snapshotEvidence(afterReload),
    issuanceBefore,
    issuanceAfter,
  }));

  // Seed a second real account through a distinct explicit custody partition.
  seedPage = await browser.newPage(`${pageUrl}&partition=seed-b`);
  const seedReady = await seedPage.call('ready');
  const seedBob = seedReady.ok ? await seedPage.call('signUp', credentials.bob) : seedReady;
  await seedPage.call('dispose');
  await seedPage.close();
  seedPage = null;
  const seededAliceUserId = settledUser(signup.snapshot);
  const seededBobUserId = settledUser(seedBob.snapshot);
  if (
    !seedBob.ok
    || seededAliceUserId === null
    || seededBobUserId === null
    || seededAliceUserId === seededBobUserId
  ) {
    fail(
      'SNAPBACK_BROWSER_AUTH_SECOND_ACCOUNT_FAILED',
      `could not seed two distinct accounts (seedReady=${seedReady.ok === true} seedBobOk=${
        seedBob.ok === true
      } seedBobCode=${seedBob.code ?? 'none'} alice=${seededAliceUserId} bob=${
        seededBobUserId
      } distinct=${seededAliceUserId !== seededBobUserId})`,
    );
  }

  // Proof 3: actual React DOM StrictMode plus repeated mount/unmount.
  const strictMetrics = await pageA.call('runStrictModeRemount', { cycles: 3 }, 120_000);
  const proof3Checks = [
    check(
      'strict-double-mount',
      strictMetrics.effectMounts >= 6 && strictMetrics.effectCleanups >= 6,
      `React StrictMode ran ${strictMetrics.effectMounts} effects and ${strictMetrics.effectCleanups} cleanups`,
    ),
    check(
      'single-concurrent-owner',
      strictMetrics.maxConcurrentOwners === 1
        && strictMetrics.cycleOwnerIds.every((ids) => ids.length === 1)
        && strictMetrics.cycleCoordinatorIds.every((ids) => ids.length === 1),
      `maximum concurrent owner count was ${strictMetrics.maxConcurrentOwners}`,
    ),
    check(
      'all-projections-disposed',
      strictMetrics.activeOwners === 0
        && strictMetrics.activeProjections === 0
        && strictMetrics.projectionsCreated === strictMetrics.projectionsDisposed,
      `${strictMetrics.projectionsDisposed}/${strictMetrics.projectionsCreated} projections disposed`,
    ),
    check(
      'no-listener-leak',
      strictMetrics.leakedListeners === 0
        && strictMetrics.activeBootstrapListeners === 0
        && strictMetrics.activePrincipalListeners === 0,
      `page listener counter settled at ${strictMetrics.leakedListeners}`,
    ),
    check(
      'fast-refresh-nonclaim',
      strictMetrics.fastRefreshDriven === false,
      'Fast Refresh was not driven and is explicitly excluded from this evidence',
    ),
  ];
  proofs.push(proofResult('3', 'strict-mode-remount', proof3Checks, strictMetrics));
  await pageA.call('ready');

  // Proof 4: the registered protected-state participant must blank rows and
  // optimistic state before logout/user-switch successor publication.
  const protectedA = await pageA.call('seedProtected', { label: 'principal-a' });
  const logoutA = await pageA.call('signOut');
  const afterLogoutA = await pageA.call('snapshot');
  const signinB = await pageA.call('signIn', credentials.bob);
  const afterSwitchToB = await pageA.call('snapshot');
  const protectedB = await pageA.call('seedProtected', { label: 'principal-b' });
  const logoutB = await pageA.call('signOut');
  const signinA = await pageA.call('signIn', credentials.alice);
  const afterSwitchToA = await pageA.call('snapshot');
  const barrierTrace = afterSwitchToA.barrierEvents ?? [];
  const expectedBarrierPhases = [
    'quiesce',
    'blank',
    'clearMemory',
    'commitDurable',
    'resume',
    'stagePublication',
  ];
  const barrierTransitions = Array.from(
    { length: Math.ceil(barrierTrace.length / expectedBarrierPhases.length) },
    (_, index) => barrierTrace.slice(
      index * expectedBarrierPhases.length,
      (index + 1) * expectedBarrierPhases.length,
    ),
  );
  const barrierOrderExact = barrierTransitions.length === 4
    && barrierTransitions.every((transition) => (
      transition.length === expectedBarrierPhases.length
      && transition.every((event, index) => event.phase === expectedBarrierPhases[index])
      && transition[1].protectedRows === 0
      && transition[2].optimisticState === 0
    ));
  const proof4Checks = [
    check(
      'predecessor-a-was-visible',
      protectedA.protected.rows.length === 1 && protectedA.protected.optimistic.length === 1,
      'principal A had one protected row and one optimistic layer before logout',
    ),
    check('logout-a-completed', logoutA.ok, 'principal A logout completed'),
    check('logout-a-blank', protectedEmpty(afterLogoutA), 'logout exposed zero predecessor rows/optimistic state'),
    check(
      'logout-a-custody',
      afterLogoutA.custody?.phase === 'settled'
        && afterLogoutA.custody?.authorityKind === 'anonymous'
        && afterLogoutA.custody?.bearerPresent === false,
      'logout settled anonymous custody with no bearer presence',
    ),
    check('switch-to-b', signinB.ok, 'successor principal B entered only after anonymous settlement'),
    check('switch-to-b-no-a', protectedEmpty(afterSwitchToB), 'principal B release exposed no principal A probe state'),
    check(
      'predecessor-b-was-visible',
      protectedB.protected.rows.length === 1 && protectedB.protected.optimistic.length === 1,
      'principal B had one protected row and one optimistic layer before switch',
    ),
    check('logout-b-completed', logoutB.ok, 'principal B logout completed'),
    check('switch-back-a', signinA.ok, 'principal A successor entry completed'),
    check('switch-back-no-b', protectedEmpty(afterSwitchToA), 'principal A release exposed no principal B probe state'),
    check(
      'successor-custody',
      afterSwitchToA.custody?.phase === 'settled'
        && afterSwitchToA.custody?.userId === afterSwitchToA.principal?.userId
        && afterSwitchToA.custody?.bearerPresent === true,
      'successor principal and settled custody agree',
    ),
    check(
      'transition-barrier-order',
      barrierOrderExact,
      'all four logout/entry transitions followed quiesce→blank→clearMemory→commitDurable→resume→publication',
    ),
  ];
  proofs.push(proofResult('4', 'logout-user-switch-hygiene', proof4Checks, {
    afterLogout: snapshotEvidence(afterLogoutA),
    afterSwitchToB: snapshotEvidence(afterSwitchToB),
    afterSwitchToA: snapshotEvidence(afterSwitchToA),
    barrierTrace: barrierTrace.map((event) => ({
      phase: event.phase,
      reason: event.reason,
      protectedRows: event.protectedRows,
      optimisticState: event.optimisticState,
    })),
  }));

  // Proof 2: two independent targets, one profile/origin/custody record.
  pageB = await browser.newPage(pageUrl);
  const pageBReady = await pageB.call('ready');
  if (!pageBReady.ok) fail('SNAPBACK_BROWSER_AUTH_SECOND_TAB_FAILED', 'second tab did not restore custody');
  const twoTabChecks = [];
  const raceDetails = {};

  const refreshStart = await observePages(pageA, pageB);
  const refreshPrecondition = refreshStart.every((snapshot) => (
    snapshot.principal?.status === 'authenticated'
    && snapshot.custody?.authorityKind === 'session'
    && snapshot.custody?.bearerPresent === true
    && captureMatchesCustody(snapshot)
    && sameSettledCustody(refreshStart[0], snapshot)
  ));
  const refreshRace = await gatedRace(harness, '/auth/refresh', [
    () => pageA.call('refresh'),
    () => pageB.call('refresh'),
  ]);
  const refreshAuto = await observePages(pageA, pageB);
  const successfulRefreshes = refreshRace.results.filter(({ ok }) => ok);
  const failedRefreshes = refreshRace.results.filter(({ ok }) => !ok);
  const refreshSuccesses = successfulRefreshes.length;
  const refreshWinner = successfulRefreshes.length === 1 ? successfulRefreshes[0].snapshot : null;
  const refreshLoserTyped = failedRefreshes.length === 1
    && failedRefreshes[0].code === 'SNAPBACK_AUTH_REFRESH_SUPERSEDED';
  const refreshWinnerRotated = refreshPrecondition
    && refreshWinner?.principal?.status === 'authenticated'
    && refreshWinner?.custody?.authorityKind === 'session'
    && refreshWinner?.custody?.bearerPresent === true
    && refreshWinner?.custody?.revision === refreshStart[0].custody.revision + 1
    && refreshWinner?.capture?.custodyRevision === refreshWinner.custody.revision
    && sameSettledAuthority(refreshWinner, refreshStart[0])
    && captureMatchesCustody(refreshWinner);
  const refreshProjectionConverged = refreshWinner !== null && refreshAuto.every((snapshot) => (
    snapshot.principal?.status === 'authenticated'
    && snapshot.custody?.authorityKind === 'session'
    && sameSettledCustody(snapshot, refreshWinner)
  ));
  const refreshCapturesMatch = refreshAuto.every(captureMatchesCustody);
  const refreshConverged = refreshSuccesses === 1
    && refreshWinnerRotated
    && refreshLoserTyped
    && refreshProjectionConverged
    && refreshCapturesMatch;
  const refreshFailClosedBlank = refreshSuccesses === 0 && refreshAuto.every((snapshot) => (
    snapshot.principal?.status === 'anonymous'
    && snapshot.custody?.phase === 'settled'
    && snapshot.custody?.authorityKind === 'anonymous'
    && snapshot.custody?.bearerPresent === false
    && protectedEmpty(snapshot)
    && captureMatchesCustody(snapshot)
    && sameSettledCustody(refreshAuto[0], snapshot)
  ));
  const refreshFailureNote = (() => {
    if (refreshConverged) return 'one refresh won, its peer refused superseded, and both tabs converged on the same-authority rotated custody revision';
    if (refreshSuccesses === 0 && refreshFailClosedBlank) {
      return 'refresh race had zero caller successes and fail-closed blanked both tabs automatically';
    }
    if (refreshSuccesses !== 1) {
      return `refresh race had ${refreshSuccesses} caller successes and did not produce exactly one winner`;
    }
    if (!refreshWinnerRotated || !refreshLoserTyped) {
      return 'refresh winner/loser capture contract did not prove a same-authority revision-only rotation with a typed superseded loser';
    }
    if (!refreshProjectionConverged) {
      return 'a refresh winner existed but at least one tab retained a stale principal or custody projection';
    }
    return 'both tabs projected the refresh winner but at least one local capture mismatched durable custody';
  })();
  twoTabChecks.push(check(
    'concurrent-refresh',
    refreshConverged,
    refreshFailureNote,
  ));
  raceDetails.refresh = {
    predecessor: refreshStart.map(snapshotEvidence),
    ...raceEvidence(refreshRace, refreshAuto),
  };
  if (!refreshConverged) {
    raceDetails.refresh.manualRecovery = manualRecoveryEvidence(
      await manuallyConverge(pageA, pageB),
    );
  }

  // A failed refresh is required to blank rather than retain an unsafe
  // predecessor. Re-establish one shared authenticated starting point before
  // testing logout so the logout arm cannot pass vacuously on two anonymous
  // callers.
  let logoutStart = await Promise.all([pageA.call('snapshot'), pageB.call('snapshot')]);
  const logoutStartUser = settledUser(logoutStart[0]);
  const logoutStartReady = logoutStartUser !== null && logoutStart.every((snapshot) => (
    snapshot.principal?.status === 'authenticated'
    && snapshot.principal.userId === logoutStartUser
    && snapshot.principal.sessionId === snapshot.custody?.sessionId
    && samePrincipal(logoutStart[0].principal, snapshot.principal)
    && settledUser(snapshot) === logoutStartUser
    && captureMatchesCustody(snapshot)
  ));
  let logoutPreparationEntry = null;
  let logoutPreparationRecovery = null;
  if (!logoutStartReady) {
    logoutPreparationEntry = await pageA.call('signIn', credentials.alice);
    logoutPreparationRecovery = await manuallyConverge(pageA, pageB);
    logoutStart = await Promise.all([pageA.call('snapshot'), pageB.call('snapshot')]);
  }
  const preparedLogoutUser = settledUser(logoutStart[0]);
  const logoutPrecondition = preparedLogoutUser !== null && logoutStart.every((snapshot) => (
    snapshot.principal?.status === 'authenticated'
    && snapshot.principal.userId === preparedLogoutUser
    && snapshot.principal.sessionId === snapshot.custody?.sessionId
    && samePrincipal(logoutStart[0].principal, snapshot.principal)
    && settledUser(snapshot) === preparedLogoutUser
    && captureMatchesCustody(snapshot)
  ));
  twoTabChecks.push(check(
    'authenticated-logout-precondition',
    logoutPrecondition,
    'both tabs held the same exact authenticated authority before the logout race',
  ));
  raceDetails.logoutPreparation = {
    entry: logoutPreparationEntry ? operationEvidence(logoutPreparationEntry) : null,
    recovery: logoutPreparationRecovery
      ? manualRecoveryEvidence(logoutPreparationRecovery)
      : null,
    snapshots: logoutStart.map(snapshotEvidence),
  };

  const logoutSeeds = await Promise.all([
    pageA.call('seedProtected', { label: 'two-tab-logout-a' }),
    pageB.call('seedProtected', { label: 'two-tab-logout-b' }),
  ]);
  const logoutPredecessorMaterialized = logoutSeeds.every(protectedMaterialized);
  twoTabChecks.push(check(
    'logout-predecessor-materialized',
    logoutPredecessorMaterialized,
    'both tabs exposed one protected row and optimistic layer before the logout race',
  ));
  const logoutRace = await gatedRace(harness, '/auth/logout', [
    () => pageA.call('signOut'),
    () => pageB.call('signOut'),
  ]);
  const logoutAuto = await observePages(pageA, pageB);
  const logoutSuccesses = logoutRace.results.filter(({ ok }) => ok).length;
  const logoutConverged = logoutPrecondition
    && logoutSuccesses === 1
    && logoutPredecessorMaterialized
    && logoutAuto.every((snapshot, index) => (
      snapshot.principal?.status === 'anonymous'
      && snapshot.custody?.authorityKind === 'anonymous'
      && snapshot.custody?.bearerPresent === false
      && protectedEmpty(snapshot)
      && captureMatchesCustody(snapshot)
      && barrierBlankedAfterSeed(logoutSeeds[index], snapshot)
    ));
  twoTabChecks.push(check(
    'concurrent-logout',
    logoutConverged,
    logoutConverged
      ? 'one logout won and both tabs converged on one blank settled anonymous record'
      : `logout race had ${logoutSuccesses} caller successes and did not blank/converge both tab projections`,
  ));
  raceDetails.logout = {
    ...raceEvidence(logoutRace, logoutAuto),
    predecessorBarriers: logoutAuto.map((snapshot, index) => (
      barrierEvidenceAfterSeed(logoutSeeds[index], snapshot)
    )),
  };
  if (!logoutConverged) {
    raceDetails.logout.manualRecovery = manualRecoveryEvidence(
      await manuallyConverge(pageA, pageB),
    );
  }

  const signinSeeds = await Promise.all([
    pageA.call('seedProtected', { label: 'two-tab-signin-a' }),
    pageB.call('seedProtected', { label: 'two-tab-signin-b' }),
  ]);
  const signinPredecessorMaterialized = signinSeeds.every(protectedMaterialized);
  twoTabChecks.push(check(
    'signin-predecessor-materialized',
    signinPredecessorMaterialized,
    'both tabs exposed one protected row and optimistic layer before the sign-in race',
  ));
  const signinRace = await gatedRace(harness, '/auth/password/signin', [
    () => pageA.call('signIn', credentials.alice),
    () => pageB.call('signIn', credentials.bob),
  ]);
  const signinAuto = await observePages(pageA, pageB);
  const successfulSignins = signinRace.results.filter(({ ok }) => ok);
  const signinSuccesses = successfulSignins.length;
  const signinWinner = successfulSignins.length === 1 ? successfulSignins[0].snapshot : null;
  const signinConverged = signinSuccesses === 1
    && signinPredecessorMaterialized
    && signinWinner?.principal?.status === 'authenticated'
    && signinWinner?.custody?.authorityKind === 'session'
    && captureMatchesCustody(signinWinner)
    && signinAuto.every((snapshot, index) => (
      snapshot.principal?.status === 'authenticated'
      && sameSettledAuthority(snapshot, signinWinner)
      && protectedEmpty(snapshot)
      && captureMatchesCustody(snapshot)
      && barrierBlankedAfterSeed(signinSeeds[index], snapshot)
    ));
  twoTabChecks.push(check(
    'concurrent-signin',
    signinConverged,
    signinConverged
      ? 'one sign-in won and both tabs observed its exact settled authority'
      : `sign-in race had ${signinSuccesses} caller successes and did not automatically converge`,
  ));
  raceDetails.signin = {
    ...raceEvidence(signinRace, signinAuto),
    winner: signinWinner ? snapshotEvidence(signinWinner) : null,
    predecessorBarriers: signinAuto.map((snapshot, index) => (
      barrierEvidenceAfterSeed(signinSeeds[index], snapshot)
    )),
  };
  if (!signinConverged) {
    raceDetails.signin.manualRecovery = manualRecoveryEvidence(
      await manuallyConverge(pageA, pageB),
    );
  }

  const switchStart = await Promise.all([pageA.call('snapshot'), pageB.call('snapshot')]);
  const switchPredecessorUserId = settledUser(switchStart[0]);
  const switchTarget = seededAliceUserId !== switchPredecessorUserId
    ? { credentials: credentials.alice, userId: seededAliceUserId }
    : { credentials: credentials.bob, userId: seededBobUserId };
  const switchPrecondition = switchPredecessorUserId !== null && switchStart.every((snapshot) => (
    snapshot.principal?.status === 'authenticated'
    && settledUser(snapshot) === switchPredecessorUserId
    && sameSettledAuthority(snapshot, switchStart[0])
    && captureMatchesCustody(snapshot)
  ));
  const switchSeeds = await Promise.all([
    pageA.call('seedProtected', { label: 'two-tab-user-switch-a' }),
    pageB.call('seedProtected', { label: 'two-tab-user-switch-b' }),
  ]);
  const switchPredecessorMaterialized = switchSeeds.every(protectedMaterialized);
  twoTabChecks.push(check(
    'user-switch-predecessor-materialized',
    switchPredecessorMaterialized,
    'both tabs exposed one protected row and optimistic layer before the user-switch race',
  ));
  const switchRace = await gatedRace(harness, '/auth/logout', [
    () => pageA.call('switchUser', switchTarget.credentials),
    () => pageB.call('switchUser', switchTarget.credentials),
  ]);
  const switchAuto = await observePages(pageA, pageB);
  const successfulSwitches = switchRace.results.filter(({ ok }) => ok);
  const switchSuccesses = successfulSwitches.length;
  const switchWinner = successfulSwitches.length === 1 ? successfulSwitches[0].snapshot : null;
  const switchWinnerUserId = settledUser(switchWinner);
  const switchConverged = switchPrecondition
    && switchSuccesses === 1
    && switchPredecessorMaterialized
    && switchWinner?.principal?.status === 'authenticated'
    && switchWinner?.custody?.authorityKind === 'session'
    && switchWinnerUserId === switchTarget.userId
    && switchWinnerUserId !== switchPredecessorUserId
    && captureMatchesCustody(switchWinner)
    && switchAuto.every((snapshot, index) => (
      snapshot.principal?.status === 'authenticated'
      && sameSettledAuthority(snapshot, switchWinner)
      && protectedEmpty(snapshot)
      && captureMatchesCustody(snapshot)
      && barrierBlankedAfterSeed(switchSeeds[index], snapshot)
    ));
  twoTabChecks.push(check(
    'concurrent-user-switch',
    switchConverged,
    switchConverged
      ? 'one composed user switch won for the distinct target account and both tabs exposed only its successor'
      : `user-switch race had ${switchSuccesses} caller successes, or its winner did not settle the target account distinct from the predecessor, or both tabs did not automatically converge`,
  ));
  raceDetails.userSwitch = {
    predecessor: switchStart.map(snapshotEvidence),
    targetUserId: switchTarget.userId,
    ...raceEvidence(switchRace, switchAuto),
    winner: switchWinner ? snapshotEvidence(switchWinner) : null,
    predecessorBarriers: switchAuto.map((snapshot, index) => (
      barrierEvidenceAfterSeed(switchSeeds[index], snapshot)
    )),
  };
  if (!switchConverged) {
    raceDetails.userSwitch.manualRecovery = manualRecoveryEvidence(
      await manuallyConverge(pageA, pageB),
    );
  }
  const finalTwoTab = await Promise.all([pageA.call('snapshot'), pageB.call('snapshot')]);
  twoTabChecks.push(check(
    'one-logical-record',
    finalTwoTab[0].custody?.revision === finalTwoTab[1].custody?.revision
      && finalTwoTab[0].custody?.authorityEpoch === finalTwoTab[1].custody?.authorityEpoch
      && finalTwoTab[0].custody?.userId === finalTwoTab[1].custody?.userId,
    'both tabs read one final durable custody revision/epoch/principal',
  ));
  proofs.push(proofResult('2', 'two-tab-ownership', twoTabChecks, raceDetails));

  await pageB.call('dispose');
  await pageB.close();
  pageB = null;

  // Proof 5: corrupt between sessions, require a typed refusal, then perform
  // explicit destructive recovery and prove anonymous entry remains usable.
  await pageA.call('dispose');
  const corruptWrite = await pageA.call('corruptCustody');
  const issuanceBeforeCorruptionReload = (() => {
    const counts = harness.counts();
    return (counts['POST /auth/password/signup']?.total ?? 0)
      + (counts['POST /auth/password/signin']?.total ?? 0)
      - issuanceAtEngineStart;
  })();
  await pageA.reload();
  const corruptBoot = await pageA.call('ready');
  const issuanceAfterCorruptionReload = (() => {
    const counts = harness.counts();
    return (counts['POST /auth/password/signup']?.total ?? 0)
      + (counts['POST /auth/password/signin']?.total ?? 0)
      - issuanceAtEngineStart;
  })();
  const explicitClear = await pageA.call('clearCustodyExplicitly');
  await pageA.reload();
  const anonymousRecovery = await pageA.call('ready');
  const recoveryEntry = await pageA.call('signIn', credentials.alice);
  const afterRecoveryEntry = await pageA.call('snapshot');
  const proof5Checks = [
    check(
      'garbage-written',
      corruptWrite?.shape === 'invalid-nonrecord',
      'a truncated non-record was written to the real custody object store',
    ),
    check(
      'typed-corruption',
      corruptBoot.ok === false
        && corruptBoot.code === 'SNAPBACK_AUTH_CUSTODY_CORRUPT'
        && corruptBoot.bootstrap?.status === 'blocked',
      `corrupt boot surfaced ${corruptBoot.code ?? 'no code'} / ${corruptBoot.bootstrap?.status ?? 'no state'}`,
    ),
    check(
      'no-silent-issuance',
      issuanceBeforeCorruptionReload === issuanceAfterCorruptionReload,
      'corrupt boot issued no replacement credential',
    ),
    check('explicit-recovery-cleared', explicitClear === null, 'custody deletion occurred only through the explicit recovery step'),
    check(
      'settled-anonymous',
      anonymousRecovery.ok
        && anonymousRecovery.snapshot.principal?.status === 'anonymous'
        && anonymousRecovery.snapshot.custody?.authorityKind === 'anonymous',
      'explicit recovery established server-witnessed anonymous custody',
    ),
    check(
      'entry-available',
      recoveryEntry.ok
        && afterRecoveryEntry.principal?.status === 'authenticated'
        && captureMatchesCustody(afterRecoveryEntry),
      'password entry remained usable after typed explicit recovery',
    ),
  ];
  proofs.push(proofResult('5', 'corruption', proof5Checks, {
    corruptWrite,
    corruptBoot: operationEvidence(corruptBoot),
    issuanceBeforeCorruptionReload,
    issuanceAfterCorruptionReload,
    anonymousRecovery: operationEvidence(anonymousRecovery),
    afterRecoveryEntry: snapshotEvidence(afterRecoveryEntry),
  }));

  // Proof 6: one tab owns the exact Web Lock, a second operation queues, then
  // killing only the owning target releases the browser lock and lets the
  // pending durable synchronization settle.
  lockPage = await browser.newPage(pageUrl);
  const lockReady = await lockPage.call('ready');
  const held = await lockPage.call('holdCustodyLock');
  const blockedOperation = pageA.call('synchronize', undefined, 90_000);
  await sleep(300);
  const blockedState = await pageA.call('lockState');
  await lockPage.close();
  lockPage = null;
  const recoveredOperation = await blockedOperation;
  const recoveredSnapshot = await pageA.call('snapshot');
  const recoveredLockState = await pageA.call('lockState');
  const proof6Checks = [
    check('owner-ready', lockReady.ok, 'the second real tab restored the shared authority before taking ownership'),
    check('lock-held', held.held === true, 'the second tab held the exact custody Web Lock'),
    check(
      'operation-blocked',
      blockedState.held === 1 && blockedState.pending >= 1,
      `Web Locks reported held=${blockedState.held}, pending=${blockedState.pending}`,
    ),
    check(
      'owner-loss-recovered',
      recoveredOperation.ok === true
        && recoveredLockState.held === 0
        && recoveredLockState.pending === 0,
      'killing only the owning tab released the lock and settled the queued operation',
    ),
    check(
      'exact-recovery-settlement',
      recoveredSnapshot.bootstrap?.status === 'ready'
        && recoveredSnapshot.principal?.status === 'authenticated'
        && captureMatchesCustody(recoveredSnapshot),
      'post-loss recovery settled ready on the exact durable capture',
    ),
  ];
  proofs.push(proofResult('6', 'blocked-recovery', proof6Checks, {
    blockedState,
    recoveredLockState,
    recoveredSnapshot: snapshotEvidence(recoveredSnapshot),
  }));

  await pageA.call('dispose');
  const databaseCleanup = await pageA.call('deleteDatabase');
  engineCleanup.databaseDeleted = databaseCleanup.databaseDeleted === true;
      }

      const browserFacts = engineId === 'chromium'
        ? {
            executable: browserExecutable,
            executableSha256: sha256(await readFile(browserExecutable)),
            version: chromeVersion,
            userAgent: environment.userAgent,
            navigatorPlatform: environment.platform,
            automation: 'raw-cdp-over-node-websocket',
            profile: 'one-persistent-profile-two-real-targets',
          }
        : {
            driverExecutable: SAFARIDRIVER_PATH,
            driverExecutableSha256: sha256(await readFile(SAFARIDRIVER_PATH)),
            driverVersion: safariDriverVersion,
            version: webkit.capabilities?.browserVersion
              ? `Safari ${webkit.capabilities.browserVersion}`
              : 'Safari (version not reported)',
            platformVersion: webkit.capabilities?.['safari:platformVersion'] ?? null,
            userAgent: environment.userAgent,
            navigatorPlatform: environment.platform,
            automation: 'w3c-webdriver-rest-over-node-fetch',
            profile: 'safaridriver-owned-session-with-two-window-handles',
          };
      const carrier = {
        indexedDb: environment.indexedDb,
        webLocks: environment.webLocks,
        databaseNameHash: sha256(databaseName),
        ...(engineId === 'chromium' ? { profileTempRoot: PROFILE_TEMP_ROOT } : {}),
      };
      const orderedProofs = PROOF_DEFINITIONS.map(
        ([id]) => proofs.find((proof) => proof.id === id),
      );
      if (environmentSkip !== null) {
        engineEntry = engineSkip(engineId, environmentSkip.code, environmentSkip.reason, {
          browser: browserFacts,
          os: { platform: process.platform, arch: process.arch, version: osVersion },
          carrier,
        });
      } else {
        const engineOk = orderedProofs.length === PROOF_DEFINITIONS.length
          && orderedProofs.every(({ outcome }) => outcome === 'PASS');
        engineEntry = {
          engine: engineId,
          status: engineOk ? 'PASS' : 'FAIL',
          browser: browserFacts,
          os: { platform: process.platform, arch: process.arch, version: osVersion },
          carrier,
          proofs: orderedProofs,
        };
      }
    } catch (error) {
      engineFailure = error;
    } finally {
      harness.releaseAllGates();
      for (const page of [seedPage, pageB, lockPage, pageA]) {
        if (page === null) continue;
        try { await page.close(); } catch (error) { engineFailure ??= error; }
      }
      if (cdp !== null) {
        try {
          cdp.close();
          engineCleanup.transportClosed = true;
        } catch (error) {
          engineFailure ??= error;
        }
      }
      if (webkit !== null) {
        try {
          await webkit.closeSession();
          engineCleanup.sessionClosed = webkit.client.sessionClosed;
        } catch (error) {
          engineFailure ??= error;
        }
      }
      if (chrome !== null) {
        try {
          await chrome.stop();
          engineCleanup.browserStopped = true;
        } catch (error) {
          engineFailure ??= error;
        }
      }
      if (webkit !== null) {
        try {
          await webkit.stop();
          engineCleanup.driverStopped = true;
        } catch (error) {
          engineFailure ??= error;
        }
      }
      if (profilePath !== null) {
        try {
          await rm(profilePath, { recursive: true, force: true });
          engineCleanup.profileRemoved = !existsSync(profilePath);
        } catch (error) {
          engineFailure ??= error;
        }
      }
    }

    if (engineFailure !== null) {
      infrastructureFailure ??= engineFailure;
      infrastructureFailures.push({ engine: engineId, error: publicError(engineFailure) });
    }
    if (engineEntry === null) {
      const existing = new Map(proofs.map((proof) => [proof.id, proof]));
      engineEntry = {
        engine: engineId,
        status: 'FAIL',
        browser: engineId === 'chromium'
          ? { executable: browserExecutable, version: chromeVersion }
          : { driverExecutable: SAFARIDRIVER_PATH, driverVersion: safariDriverVersion },
        os: { platform: process.platform, arch: process.arch, version: osVersion },
        proofs: PROOF_DEFINITIONS.map(([id, name]) => existing.get(id) ?? ({
          id,
          name,
          outcome: 'FAIL',
          evidence: 'proof did not run to completion because browser/server infrastructure failed',
          code: 'SNAPBACK_BROWSER_AUTH_PROOF_NOT_RUN',
        })),
        infrastructureError: publicError(engineFailure),
      };
    }
    engineEntry.cleanup = engineCleanup;
    witness.engines.push(engineEntry);
  }
} catch (error) {
  infrastructureFailure = error;
  infrastructureFailures.push({ engine: 'shared', error: publicError(error) });
} finally {
  harness?.releaseAllGates();
  if (harness !== null) {
    try {
      witness.server.requests = harness.counts();
      await harness.close();
      witness.cleanup.harnessClosed = true;
    } catch (error) {
      infrastructureFailure ??= error;
      infrastructureFailures.push({ engine: 'shared-cleanup', error: publicError(error) });
    }
  }
  if (server !== null) {
    try {
      await server.stop();
      witness.cleanup.serverStopped = true;
    } catch (error) {
      infrastructureFailure ??= error;
      infrastructureFailures.push({ engine: 'shared-cleanup', error: publicError(error) });
    }
  }
  if (scratch !== null) {
    try {
      await rm(scratch, { recursive: true, force: true });
      witness.cleanup.scratchRemoved = !existsSync(scratch);
    } catch (error) {
      infrastructureFailure ??= error;
      infrastructureFailures.push({ engine: 'shared-cleanup', error: publicError(error) });
    }
  }
}
witness.cleanup.browserStopped = witness.cleanup.engines.chromium?.browserStopped === true
  && witness.cleanup.engines.webkit?.driverStopped === true;
witness.cleanup.profileRemoved = witness.cleanup.engines.chromium?.profileRemoved === true;
witness.cleanup.databaseDeleted = ['chromium', 'webkit'].every(
  (engine) => witness.cleanup.engines[engine]?.databaseDeleted === true,
);
witness.finishedAt = new Date().toISOString();
if (infrastructureFailure !== null) witness.infrastructureError = publicError(infrastructureFailure);
if (infrastructureFailures.length > 0) witness.infrastructureErrors = infrastructureFailures;

const chromium = witness.engines.find(({ engine }) => engine === 'chromium');
const webkit = witness.engines.find(({ engine }) => engine === 'webkit');
witness.ok = infrastructureFailure === null
  && chromium?.status === 'PASS'
  && webkit?.status === 'PASS'
  && chromium?.cleanup?.transportClosed === true
  && webkit?.cleanup?.sessionClosed === true
  && witness.cleanup.browserStopped
  && witness.cleanup.profileRemoved
  && witness.cleanup.harnessClosed
  && witness.cleanup.serverStopped
  && witness.cleanup.scratchRemoved
  && witness.cleanup.databaseDeleted;

// Scan the final public receipt, not page memory or automation arguments. The receipt
// must contain no bearer/recovery-token spellings or the generated credentials.
const witnessBeforeScan = stableText(witness);
const leakedGeneratedCredential = Object.values(engineInputs).some(({ credentials }) => (
  Object.values(credentials).some(({ email, password }) => (
    witnessBeforeScan.includes(email) || witnessBeforeScan.includes(password)
  ))
));
const tokenPatternLeak = /(?:sbs_|sbrv1_)[A-Za-z0-9._~-]+/u.test(witnessBeforeScan);
witness.secretScan = {
  outcome: leakedGeneratedCredential || tokenPatternLeak ? 'FAIL' : 'PASS',
  generatedCredentialAbsent: !leakedGeneratedCredential,
  bearerOrRecoveryPatternAbsent: !tokenPatternLeak,
};
if (witness.secretScan.outcome !== 'PASS') witness.ok = false;

let witnessWritten = false;
if (infrastructureFailure === null) {
  await mkdir(dirname(options.witness), { recursive: true });
  await writeFile(options.witness, `${stableText(witness, 2)}\n`);
  witnessWritten = true;
}

const summary = {
  ok: witness.ok,
  chromium: chromium?.status ?? 'FAIL',
  proofs: chromium?.proofs?.map(({ id, name, outcome }) => ({ id, name, outcome })) ?? [],
  webkit: webkit?.status ?? 'FAIL',
  webkitProofs: webkit?.proofs?.map(({ id, name, outcome, code }) => ({
    id,
    name,
    outcome,
    ...(code ? { code } : {}),
  })) ?? [],
  witness: options.witness,
  witnessWritten,
  infrastructureError: witness.infrastructureError ?? null,
  infrastructureErrors: witness.infrastructureErrors ?? [],
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (!witness.ok) process.exitCode = 1;
