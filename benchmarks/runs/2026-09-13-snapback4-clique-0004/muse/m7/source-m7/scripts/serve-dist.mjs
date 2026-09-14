// Static server for the exported web bundle (M7 choreography + acceptance).
// Serves app-host/clique/dist on a loopback port with SPA fallback so deep
// routes (e.g. /conversation/group/Weekend%20Plans) load index.html.
// Usage: node scripts/serve-dist.mjs --port 49311 [--dir app-host/clique/dist]
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const argv = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const PORT = Number(flag('--port', '49311'));
const DIR = flag('--dir', 'app-host/clique/dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

const server = createServer((req, res) => {
  try {
    const u = new URL(req.url || '/', 'http://x');
    let p = normalize(decodeURIComponent(u.pathname)).replace(/^\/+/, '');
    let file = join(DIR, p);
    let st = null;
    try { st = statSync(file); } catch { st = null; }
    if (!st || st.isDirectory()) {
      if (st?.isDirectory()) {
        try {
          const idx = join(file, 'index.html');
          statSync(idx);
          file = idx;
        } catch { file = join(DIR, 'index.html'); }
      } else {
        file = join(DIR, 'index.html');
      }
    }
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`dist on http://127.0.0.1:${PORT}`));
