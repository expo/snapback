import { createServer } from 'node:http';

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

export function createDirector({ host = '127.0.0.1', port, config = null } = {}) {
  const commands = [];
  const longPolls = [];
  const events = [];
  const results = new Map();
  let sequence = 0;
  let currentConfig = config;

  const reply = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(body === undefined ? '' : JSON.stringify(body));
  };
  const deliver = () => {
    while (commands.length > 0 && longPolls.length > 0) {
      const response = longPolls.shift();
      if (response.destroyed) continue;
      reply(response, 200, commands.shift());
    }
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/config') {
        reply(response, currentConfig === null ? 503 : 200, currentConfig ?? { unavailable: true });
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
        if (url.pathname === '/event') events.push(Object.freeze({ ...body, receivedAtMs: Date.now() }));
        else {
          const waiter = results.get(body.commandId);
          if (waiter !== undefined) {
            results.delete(body.commandId);
            waiter.resolve(body);
          }
        }
        reply(response, 200, { ok: true });
        return;
      }
      reply(response, 404, { ok: false });
    } catch {
      if (!response.headersSent) reply(response, 400, { ok: false });
      else response.end();
    }
  });

  return Object.freeze({
    events,
    setConfig(value) { currentConfig = value; },
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      for (const response of longPolls.splice(0)) {
        if (!response.destroyed) reply(response, 204);
      }
      await new Promise((resolve) => server.close(resolve));
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
    async waitEvent(predicate, startIndex = 0, timeoutMs = 45_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const match = events.slice(startIndex).find(predicate);
        if (match !== undefined) return match;
        if (Date.now() >= deadline) throw new Error('director event wait timed out');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  });
}
