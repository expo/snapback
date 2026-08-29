// Shared standards-real Chrome/CDP machinery for browser acceptance runners.
// The browser-auth proof owns the original behavior; O14 extends it with
// genuinely separate Target browser contexts and WebSocket proxying.

import { existsSync } from 'node:fs';
import { createServer, request as createHttpRequest } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';

import { build } from 'esbuild';

import { launchChromeCdp } from '../../demos/_kit/chrome-process.mjs';

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function defaultFailure(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  throw error;
}

function underlyingMessage(error) {
  return String(
    error?.diagnostic?.details?.message
      ?? error?.details?.message
      ?? error?.message
      ?? error,
  );
}

export function resolveChromeExecutable({
  explicitPath = null,
  fail = defaultFailure,
  candidates = process.platform === 'darwin'
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
      ],
  missingCode = 'SNAPBACK_BROWSER_NOT_FOUND',
  missingMessage = 'no system Chrome-family browser found',
} = {}) {
  if (explicitPath !== null) {
    const executable = resolve(explicitPath);
    if (!existsSync(executable)) {
      fail(missingCode, `browser executable missing: ${executable}`);
    }
    return executable;
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) fail(missingCode, missingMessage);
  return found;
}

function macAppBundleFor(executable) {
  const marker = '.app/Contents/MacOS/';
  const index = executable.indexOf(marker);
  return index === -1 ? null : executable.slice(0, index + '.app'.length);
}

export async function launchRawCdpChrome({
  executable,
  profilePath,
  headed = false,
  fail = defaultFailure,
  appBundleRequiredCode = 'SNAPBACK_BROWSER_APP_BUNDLE_REQUIRED',
  extraArgs = [],
  startupTimeoutMs = 20_000,
} = {}) {
  const appBundle = process.platform === 'darwin' ? macAppBundleFor(executable) : null;
  if (process.platform === 'darwin' && appBundle === null) {
    fail(
      appBundleRequiredCode,
      `macOS Chrome executable is not inside an app bundle: ${executable}`,
    );
  }
  return launchChromeCdp({
    // macOS 26 aborts app-bundle executables directly spawned while they
    // register with CoreServices. `open -W` performs registration and remains
    // the owned leader until Browser.close.
    chromeBin: process.platform === 'darwin' ? '/usr/bin/open' : executable,
    launchPrefixArgs: process.platform === 'darwin'
      ? ['-n', '-W', appBundle, '--args']
      : [],
    userDataDir: profilePath,
    headless: !headed,
    stopSignal: 'SIGTERM',
    startupTimeoutMs,
    pollMs: 50,
    extraArgs: [
      '--remote-allow-origins=*',
      '--disable-background-networking',
      '--disable-component-update',
      ...extraArgs,
    ],
  });
}

export async function bundleBrowserPage({
  entryPoint,
  root,
  alias = {},
  define = {},
} = {}) {
  const result = await build({
    entryPoints: [entryPoint],
    absWorkingDir: root,
    alias,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"development"', ...define },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  return result.outputFiles[0].contents;
}

const readRequestBytes = async (request, maximum, bodyLimitCode, bodyLimitMessage, fail) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximum) fail(bodyLimitCode, bodyLimitMessage);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

function createGate(pathname, expected) {
  let resolveEntered;
  let resolveRelease;
  const enteredPromise = new Promise((resolveEnteredPromise) => {
    resolveEntered = resolveEnteredPromise;
  });
  const releasePromise = new Promise((resolveReleasePromise) => {
    resolveRelease = resolveReleasePromise;
  });
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

function proxyWebSocketUpgrade(request, socket, head, upstreamOrigin, requestFacts) {
  const upstream = new URL(upstreamOrigin);
  const proxy = createHttpRequest({
    hostname: upstream.hostname,
    port: upstream.port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: upstream.host },
  });
  proxy.once('upgrade', (response, upstreamSocket, upstreamHead) => {
    requestFacts.push(Object.freeze({
      method: request.method,
      pathname: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      status: response.statusCode ?? 101,
    }));
    const destroyUpstream = () => {
      if (!upstreamSocket.destroyed) upstreamSocket.destroy();
    };
    const destroyClient = () => {
      if (!socket.destroyed) socket.destroy();
    };
    socket.once('error', destroyUpstream);
    upstreamSocket.once('error', destroyClient);
    socket.once('close', destroyUpstream);
    upstreamSocket.once('close', destroyClient);
    const headers = Object.entries(response.headers).flatMap(([name, value]) => (
      Array.isArray(value)
        ? value.map((entry) => `${name}: ${entry}`)
        : value === undefined ? [] : [`${name}: ${value}`]
    ));
    socket.write([
      `HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? 'Switching Protocols'}`,
      ...headers,
      '',
      '',
    ].join('\r\n'));
    if (head.length > 0) upstreamSocket.write(head);
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  proxy.once('response', (response) => {
    socket.end(
      `HTTP/1.1 ${response.statusCode ?? 502} Bad Gateway\r\nConnection: close\r\n\r\n`,
    );
  });
  proxy.once('error', () => socket.destroy());
  proxy.end();
}

export async function startBrowserBundleProxy({
  bundle,
  upstreamOrigin,
  title,
  bodyText = title,
  fail = defaultFailure,
  bindFailureCode = 'SNAPBACK_BROWSER_PROXY_BIND_FAILED',
  bodyLimitCode = 'SNAPBACK_BROWSER_PROXY_BODY_LIMIT',
  bodyLimitMessage = `request body exceeded ${1024 * 1024} bytes`,
  proxyFailureCode = 'SNAPBACK_BROWSER_PROXY_FAILED',
  maximumBodyBytes = 1024 * 1024,
  onProxyRequest = null,
  onProxyResponse = null,
} = {}) {
  const html = Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>`
      + `<body><main id="app">${bodyText}</main>`
      + '<script type="module" src="/bundle.mjs"></script></body></html>',
  );
  const requestFacts = [];
  const gates = new Map();
  const sockets = new Set();
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
        : await readRequestBytes(
            request,
            maximumBodyBytes,
            bodyLimitCode,
            bodyLimitMessage,
            fail,
          );
      await onProxyRequest?.({ body, request, url });
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
      const responseHeaders = {};
      for (const [name, value] of upstream.headers) {
        if (!['connection', 'content-length', 'transfer-encoding'].includes(name)) {
          responseHeaders[name] = value;
        }
      }
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      await onProxyResponse?.({ body, request, upstream, upstreamBody, url });
      response.writeHead(upstream.status, responseHeaders);
      response.end(upstreamBody);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        diagnostic: {
          code: error?.code ?? proxyFailureCode,
          message: 'the local browser proof proxy could not complete the upstream request',
        },
      }));
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    proxyWebSocketUpgrade(request, socket, head, upstreamOrigin, requestFacts);
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    fail(bindFailureCode, 'harness did not bind TCP');
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
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose, rejectClose) => server.close(
        (error) => error ? rejectClose(error) : resolveClose(),
      ));
    },
  };
}

export async function connectRawCdp(webSocketUrl, {
  pageGlobal,
  fail = defaultFailure,
  socketClosedCode = 'SNAPBACK_BROWSER_CDP_SOCKET_CLOSED',
  socketErrorCode = 'SNAPBACK_BROWSER_CDP_SOCKET_ERROR',
  commandFailureCode = 'SNAPBACK_BROWSER_CDP_COMMAND_FAILED',
  commandTimeoutCode = 'SNAPBACK_BROWSER_CDP_COMMAND_TIMEOUT',
  contextCreateFailureCode = 'SNAPBACK_BROWSER_CONTEXT_CREATE_FAILED',
  contextDisposeFailureCode = 'SNAPBACK_BROWSER_CONTEXT_DISPOSE_FAILED',
  pageNotReadyCode = 'SNAPBACK_BROWSER_PAGE_NOT_READY',
  pageNotReadyMessage = 'browser page did not expose its proof API',
} = {}) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const entry = pending.get(id);
    if (entry) clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  };
  const failure = (code, message, details = {}) => {
    try {
      fail(code, message, details);
    } catch (error) {
      return error;
    }
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    error.details = details;
    return error;
  };
  const rejectAll = (code, reason) => {
    for (const id of [...pending.keys()]) {
      settle(id)?.reject(failure(code, reason, { message: reason }));
    }
  };
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (!message.id || !pending.has(message.id)) return;
    const entry = settle(message.id);
    if (message.error) {
      entry.reject(failure(
        commandFailureCode,
        `CDP command failed: ${entry.method}`,
        { message: message.error.message, method: entry.method },
      ));
    }
    else entry.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => rejectAll(socketClosedCode, 'CDP socket closed'));
  socket.addEventListener('error', () => rejectAll(socketErrorCode, 'CDP socket errored'));
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connect failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null, timeoutMs = 60_000) => {
    const id = nextId++;
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        settle(id);
        const message = `CDP command timed out: ${method}`;
        rejectResult(failure(commandTimeoutCode, message, { message, method, timeoutMs }));
      }, timeoutMs);
      pending.set(id, { method, resolve: resolveResult, reject: rejectResult, timer });
      socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : {
        id,
        method,
        params,
      }));
    });
  };
  const waitForPageApi = async (evaluate) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`typeof globalThis.${pageGlobal} === 'object'`)) return;
      } catch {
        // Navigation may replace the execution context between polls.
      }
      await sleep(50);
    }
    fail(pageNotReadyCode, pageNotReadyMessage, { message: pageNotReadyMessage });
  };
  return {
    close() { socket.close(); },
    send,
    browserVersion() { return send('Browser.getVersion'); },
    async createBrowserContext() {
      try {
        const { browserContextId } = await send('Target.createBrowserContext', {
          disposeOnDetach: true,
        });
        if (typeof browserContextId !== 'string' || browserContextId.length === 0) {
          const message = 'Target.createBrowserContext omitted browserContextId';
          fail(contextCreateFailureCode, 'CDP could not create a browser context', { message });
        }
        return browserContextId;
      } catch (error) {
        if (error?.code && error.code !== commandFailureCode) throw error;
        fail(contextCreateFailureCode, 'CDP could not create a browser context', {
          message: underlyingMessage(error),
        });
      }
    },
    async disposeBrowserContext(browserContextId) {
      try {
        return await send('Target.disposeBrowserContext', { browserContextId });
      } catch (error) {
        if (error?.code && error.code !== commandFailureCode) throw error;
        fail(contextDisposeFailureCode, 'CDP could not dispose a browser context', {
          browserContextId,
          message: underlyingMessage(error),
        });
      }
    },
    async newPage(url, { browserContextId = null } = {}) {
      const targetParameters = { url: 'about:blank' };
      if (browserContextId !== null) targetParameters.browserContextId = browserContextId;
      const { targetId } = await send('Target.createTarget', targetParameters);
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
        browserContextId,
        targetId,
        eval: evaluate,
        call(method, argument = undefined, timeoutMs = 60_000) {
          const input = argument === undefined
            ? ''
            : `JSON.parse(${JSON.stringify(JSON.stringify(argument))})`;
          return evaluate(
            `globalThis.${pageGlobal}[${JSON.stringify(method)}](${input})`,
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
