// Dev persona broker for Rematch.
// Trusted LOCAL process: holds the Snapback ready-file + admin token and mints
// ordinary sessions for the demo personas via `snapback session mint`
// (the paved trusted-broker seam from the Snapback guide, backend/assets.md).
// Never ship anything like this in a real app bundle.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const runDir = join(root, 'run');
const readyFile = join(runDir, 'dev.ready.json');
const backendDir = join(root, 'backend', 'rematch');
const PORT = Number(process.env.BROKER_PORT ?? 8788);

const PERSONAS = [
  { handle: 'ada', name: 'Ada Lovelace', email: 'ada@rematch.dev', color: '#7c5cff' },
  { handle: 'grace', name: 'Grace Hopper', email: 'grace@rematch.dev', color: '#00a884' },
  { handle: 'kai', name: 'Kai Tanaka', email: 'kai@rematch.dev', color: '#e8590c' },
];

function ready() {
  return JSON.parse(readFileSync(readyFile, 'utf8'));
}

function mintSession(email) {
  const adminToken = readFileSync(ready().adminTokenFile, 'utf8').trim();
  return new Promise((resolve, reject) => {
    execFile(
      join(backendDir, 'node_modules', '.bin', 'snapback'),
      ['session', 'mint', '--email', email, '--ready-file', readyFile],
      { cwd: backendDir, env: { ...process.env, SNAPBACK_ADMIN_TOKEN: adminToken } },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`mint failed: ${stderr || stdout}`));
        try {
          const envelope = JSON.parse(stdout);
          if (!envelope.ok) return reject(new Error(`mint refused: ${stdout}`));
          resolve(envelope.data);
        } catch (cause) {
          reject(cause);
        }
      },
    );
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/personas') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ personas: PERSONAS, serverUrl: `http://127.0.0.1:${RELAY_PORT}` }));
      return;
    }
    if (url.pathname === '/mint') {
      const email = url.searchParams.get('email');
      const persona = PERSONAS.find((entry) => entry.email === email);
      if (!persona) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown persona' }));
        return;
      }
      const minted = await mintSession(email);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        bearerToken: minted.token,
        userId: minted.session.userId,
        serverUrl: `http://127.0.0.1:${RELAY_PORT}`,
        directServerUrl: ready().serverUrl,
        persona,
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`rematch dev broker listening on http://127.0.0.1:${PORT}`);
});

// ---------------------------------------------------------------------------
// Dev relay (CORS-permissive reverse proxy in front of the Snapback server).
// Browser TUS uploads are blocked cross-origin because the server's
// access-control-allow-headers list omits the TUS headers; the paved browser
// answer is the @expo/snapback-vite relay, which Expo web doesn't have.
// This is the same trusted-local role, ~60 lines. HTTP + WebSocket pass-through.
// ---------------------------------------------------------------------------
import net from 'node:net';

const RELAY_PORT = Number(process.env.RELAY_PORT ?? 8789);

function backendPort() {
  try {
    return ready().port;
  } catch {
    return 4287;
  }
}

const relay = http.createServer((req, res) => {
  const origin = req.headers.origin ?? '*';
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT',
      'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
      'access-control-expose-headers': '*',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
    res.end();
    return;
  }
  const upstream = http.request(
    { host: '127.0.0.1', port: backendPort(), path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${backendPort()}` } },
    (upstreamRes) => {
      const headers = { ...upstreamRes.headers };
      headers['access-control-allow-origin'] = origin;
      headers['access-control-expose-headers'] = '*';
      res.writeHead(upstreamRes.statusCode ?? 502, headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': origin });
    res.end(JSON.stringify({ error: String(error.message) }));
  });
  req.pipe(upstream);
});

relay.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(backendPort(), '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index];
      const value = name.toLowerCase() === 'host'
        ? `127.0.0.1:${backendPort()}`
        : req.rawHeaders[index + 1];
      lines.push(`${name}: ${value}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const drop = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', drop);
  socket.on('error', drop);
});

relay.listen(RELAY_PORT, '127.0.0.1', () => {
  console.log(`rematch dev relay listening on http://127.0.0.1:${RELAY_PORT}`);
});
