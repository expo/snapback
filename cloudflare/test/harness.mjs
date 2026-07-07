// Local Miniflare harness for the LLP 0040 proof (the regression surface —
// LLP 0040 §Measurements evidence split: Miniflare is a regression surface
// only; idle economics, real eviction, and billing counters require real
// Cloudflare runs). It bundles the gateway and handler Workers with esbuild
// (resolving the single-sourced harness imports and the allowlist JSON), then
// wires them together in one Miniflare instance with the coordinator Durable
// Object, its embedded SQLite, WebSocket Hibernation, and the cross-Worker
// service bindings that carry the ctx host-call channel.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import { Miniflare } from 'miniflare';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repoRoot = path.resolve(root, '..');
const compatConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'packages/snapback-harness/compat.json'), 'utf8')
);
const compatibilityOptions = {
  compatibilityDate: compatConfig.compatibilityDate,
  compatibilityFlags: compatConfig.compatibilityFlags || [],
};

export const ADMIN_TOKEN = 'miniflare-admin-token';

async function bundle(entry) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'esm',
    write: false,
    loader: { '.json': 'json' },
    platform: 'neutral',
    target: 'esnext',
  });
  return result.outputFiles[0].text;
}

export async function startProof() {
  const [gatewayScript, handlerScript] = await Promise.all([
    bundle('src/gateway.js'),
    bundle('src/handler-worker.js'),
  ]);

  const mf = new Miniflare({
    workers: [
      {
        name: 'snapback-notes-proof',
        modules: [{ type: 'ESModule', path: path.join(root, 'src/gateway.js'), contents: gatewayScript }],
        ...compatibilityOptions,
        durableObjects: { COORDINATOR: { className: 'Coordinator', useSQLite: true } },
        serviceBindings: { HANDLER: 'snapback-notes-handler' },
        // The admin-token gate on /reset and /evict (ENG-23587); the client
        // below presents it, and the acceptance suite asserts its absence 403s.
        bindings: { SNAPBACK_ADMIN_TOKEN: ADMIN_TOKEN, SNAPBACK_TESTING: '1' },
      },
      {
        name: 'snapback-notes-handler',
        modules: [{ type: 'ESModule', path: path.join(root, 'src/handler-worker.js'), contents: handlerScript }],
        ...compatibilityOptions,
        serviceBindings: { HOST: 'snapback-notes-proof' },
      },
    ],
  });
  // Force construction / readiness.
  await mf.ready;
  return new ProofClient(mf);
}

class ProofClient {
  constructor(mf) {
    this.mf = mf;
    this.base = 'http://gateway';
  }

  async dispose() {
    await this.mf.dispose();
  }

  async inspect() {
    const response = await this.mf.dispatchFetch(`${this.base}/inspect`);
    return response.json();
  }

  async health() {
    const response = await this.mf.dispatchFetch(`${this.base}/health`);
    return response.json();
  }

  async reset() {
    const response = await this.mf.dispatchFetch(`${this.base}/reset`, {
      method: 'POST',
      headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
    });
    return response.json();
  }

  async evict() {
    const response = await this.mf.dispatchFetch(`${this.base}/evict`, {
      method: 'POST',
      headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
    });
    return response.json();
  }

  async corruptMeta(payload) {
    const response = await this.mf.dispatchFetch(`${this.base}/__test/corrupt-meta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    return { status: response.status, body: await response.json() };
  }

  // Raw admin request without credentials — the acceptance suite uses this to
  // assert the gate fails closed (ENG-23587).
  async adminWithoutToken(pathName, method = 'POST') {
    const response = await this.mf.dispatchFetch(`${this.base}${pathName}`, { method });
    return { status: response.status, body: await response.json() };
  }

  async query(name, args) {
    const response = await this.mf.dispatchFetch(`${this.base}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, args }),
    });
    return response.json();
  }

  async mutation(name, args) {
    const response = await this.mf.dispatchFetch(`${this.base}/mutation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, args }),
    });
    return response.json();
  }

  async openLiveSocket() {
    const response = await this.mf.dispatchFetch(`${this.base}/live/stream`, {
      headers: { upgrade: 'websocket' },
    });
    const ws = response.webSocket;
    ws.accept();
    return new LiveSocket(ws);
  }
}

// A tiny message-queue wrapper so tests can await specific frames in order.
class LiveSocket {
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.waiters = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
  }

  send(value) {
    this.ws.send(JSON.stringify(value));
  }

  next(timeoutMs = 4000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a live frame')), timeoutMs);
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  async waitFor(type, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${type}`);
      const message = await this.next(remaining);
      if (message.type === type) return message;
    }
  }

  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}
