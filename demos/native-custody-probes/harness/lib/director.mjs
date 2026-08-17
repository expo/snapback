import { createServer } from 'node:http';

import {
  prepareHarnessPort,
  removeHarnessPortOwner,
  writeHarnessPortOwner,
} from './process.mjs';

function readJson(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > limit) {
        reject(new Error('director request body exceeded limit'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

const EXTENSION_RESULT_FIELDS = Object.freeze([
  'schemaVersion',
  'bundleIdentifier',
  'extensionPointIdentifier',
  'pid',
  'code',
  'reason',
  'ioOccurred',
  'atMs',
]);

function validExtensionResult(body) {
  return body !== null
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).length === EXTENSION_RESULT_FIELDS.length
    && EXTENSION_RESULT_FIELDS.every((field) => Object.hasOwn(body, field))
    && body.schemaVersion === 'snapback.native-custody-extension.v1'
    && typeof body.bundleIdentifier === 'string'
    && body.bundleIdentifier.length > 0
    && typeof body.extensionPointIdentifier === 'string'
    && body.extensionPointIdentifier.length > 0
    && Number.isSafeInteger(body.pid)
    && body.pid > 0
    && typeof body.code === 'string'
    && body.code.length > 0
    && typeof body.reason === 'string'
    && body.reason.length > 0
    && typeof body.ioOccurred === 'boolean'
    && Number.isSafeInteger(body.atMs)
    && body.atMs > 0;
}

export function createDirector({
  host = '127.0.0.1',
  port,
  config = null,
  ownerFile = null,
} = {}) {
  const commands = [];
  const longPolls = [];
  const events = [];
  const extensionResults = [];
  const results = new Map();
  const secretValues = new Set();
  const secretCounts = new Map();
  const requestLog = [];
  const eventWaiters = new Set();
  const extensionResultWaiters = new Set();
  let sequence = 0;
  let currentConfig = config;
  const commandToken = 'native-custody-probes/harness/run-';

  const reply = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(body === undefined ? '' : JSON.stringify(body));
  };
  const logRequest = (request, pathname, status) => {
    requestLog.push(`${new Date().toISOString()} ${request.method} ${pathname} ${status}`);
  };
  const deliver = () => {
    while (commands.length > 0 && longPolls.length > 0) {
      const response = longPolls.shift();
      if (response.destroyed) continue;
      reply(response, 200, commands.shift());
    }
  };
  const publishEvent = (event) => {
    events.push(event);
    const index = events.length - 1;
    for (const waiter of [...eventWaiters]) {
      if (index < waiter.startIndex || !waiter.predicate(event)) continue;
      eventWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  };
  const publishExtensionResult = (result) => {
    extensionResults.push(result);
    const index = extensionResults.length - 1;
    for (const waiter of [...extensionResultWaiters]) {
      if (index < waiter.startIndex || !waiter.predicate(result)) continue;
      extensionResultWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(result);
    }
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/config') {
        const status = currentConfig === null ? 503 : 200;
        logRequest(request, url.pathname, status);
        reply(response, status, currentConfig ?? { unavailable: true });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/cmd') {
        const timer = setTimeout(() => {
          const index = longPolls.indexOf(response);
          if (index !== -1) longPolls.splice(index, 1);
          if (!response.destroyed) reply(response, 204);
        }, 25_000);
        response.once('close', () => {
          clearTimeout(timer);
          const index = longPolls.indexOf(response);
          if (index !== -1) longPolls.splice(index, 1);
        });
        response.once('finish', () => clearTimeout(timer));
        longPolls.push(response);
        deliver();
        return;
      }
      if (request.method === 'POST' && ['/event', '/result'].includes(url.pathname)) {
        const body = await readJson(request);
        if (url.pathname === '/event') {
          publishEvent(Object.freeze({ ...body, receivedAtMs: Date.now() }));
        }
        else {
          const waiter = results.get(body.commandId);
          if (waiter !== undefined) {
            results.delete(body.commandId);
            waiter.resolve(body);
          }
        }
        logRequest(request, url.pathname, 200);
        reply(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/extension-result') {
        const body = await readJson(request, 64 * 1024);
        if (!validExtensionResult(body)) {
          logRequest(request, url.pathname, 400);
          reply(response, 400, { ok: false });
          return;
        }
        publishExtensionResult(Object.freeze({ ...body, receivedAtMs: Date.now() }));
        logRequest(request, url.pathname, 200);
        reply(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/secret') {
        const body = await readJson(request, 64 * 1024);
        if (
          !['bearer', 'recovery-code'].includes(body?.kind)
          || typeof body?.literal !== 'string'
          || body.literal.length === 0
        ) {
          logRequest(request, url.pathname, 400);
          reply(response, 400, { ok: false });
          return;
        }
        secretValues.add(body.literal);
        secretCounts.set(body.kind, (secretCounts.get(body.kind) ?? 0) + 1);
        // Never retain or log the request body. Only the scanner's in-memory
        // literal set and a non-secret per-kind count survive this callback.
        logRequest(request, url.pathname, 200);
        reply(response, 200, { ok: true });
        return;
      }
      logRequest(request, url.pathname, 404);
      reply(response, 404, { ok: false });
    } catch {
      requestLog.push(`${new Date().toISOString()} ${request.method} <parse-error> 400`);
      if (!response.headersSent) reply(response, 400, { ok: false });
      else response.end();
    }
  });

  return Object.freeze({
    events,
    extensionResults,
    secretLiterals() { return Object.freeze([...secretValues]); },
    secretSummary() { return Object.freeze(Object.fromEntries(secretCounts)); },
    capturedLog() { return `${requestLog.join('\n')}\n`; },
    setConfig(value) { currentConfig = value; },
    async listen() {
      if (ownerFile !== null && port !== 0) {
        await prepareHarnessPort({ port, ownerFile, role: 'director' });
      }
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      if (ownerFile !== null && port !== 0) {
        writeHarnessPortOwner({
          port,
          ownerFile,
          role: 'director',
          pid: process.pid,
          commandToken,
        });
      }
      return server.address();
    },
    async close() {
      for (const waiter of eventWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('director closed while waiting for an event'));
      }
      eventWaiters.clear();
      for (const waiter of extensionResultWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('director closed while waiting for an extension result'));
      }
      extensionResultWaiters.clear();
      for (const response of longPolls.splice(0)) {
        if (!response.destroyed) reply(response, 204);
      }
      await new Promise((resolve) => server.close(resolve));
      if (ownerFile !== null && port !== 0) removeHarnessPortOwner(ownerFile, process.pid);
    },
    sendCommand(name, args = {}, timeoutMs = 60_000) {
      sequence += 1;
      const id = `cmd-${sequence}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          results.delete(id);
          reject(new Error(`director command ${name} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        results.set(id, {
          resolve(value) { clearTimeout(timer); resolve(value); },
        });
        commands.push(Object.freeze({ id, name, args }));
        deliver();
      });
    },
    waitEvent(predicate, startIndex = 0, timeoutMs = 45_000) {
      const match = events.slice(startIndex).find(predicate);
      if (match !== undefined) return Promise.resolve(match);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, startIndex, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          eventWaiters.delete(waiter);
          reject(new Error('director event wait timed out (heartbeat silence)'));
        }, timeoutMs);
        eventWaiters.add(waiter);
      });
    },
    waitExtensionResult(predicate, startIndex = 0, timeoutMs = 45_000) {
      const match = extensionResults.slice(startIndex).find(predicate);
      if (match !== undefined) return Promise.resolve(match);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          startIndex,
          resolve,
          reject,
          timer: null,
        };
        waiter.timer = setTimeout(() => {
          extensionResultWaiters.delete(waiter);
          reject(new Error(`director extension result timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        extensionResultWaiters.add(waiter);
      });
    },
  });
}
