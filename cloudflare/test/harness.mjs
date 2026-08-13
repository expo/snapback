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
import { Log, LogLevel, Miniflare } from 'miniflare';
import { assertProofRuntimeNode } from './proof-runtime.mjs';

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

const RUNTIME_DIAGNOSTIC_LIMIT = 32;
const RUNTIME_DIAGNOSTIC_BYTES = 4_096;
const loopbackProofs = new Map();

function sensitiveStrings(bindings) {
  const values = new Set([ADMIN_TOKEN]);
  const visit = (value) => {
    if (typeof value === 'string') {
      if (value.length >= 4) values.add(value);
      try { visit(JSON.parse(value)); } catch (_) {}
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(bindings);
  return [...values].sort((left, right) => right.length - left.length);
}

function diagnosticRecorder(bindings) {
  const retained = [];
  const secrets = sensitiveStrings(bindings);
  const sanitize = (value) => {
    let text = value instanceof Error ? value.stack || value.message : String(value);
    for (const secret of secrets) text = text.split(secret).join('[redacted]');
    if (text.length > RUNTIME_DIAGNOSTIC_BYTES) {
      text = `${text.slice(0, RUNTIME_DIAGNOSTIC_BYTES)}...[truncated]`;
    }
    return text;
  };
  const record = (source, level, value) => {
    retained.push({ at: Date.now(), source, level, message: sanitize(value) });
    if (retained.length > RUNTIME_DIAGNOSTIC_LIMIT) retained.shift();
  };
  return { retained, record, sanitize };
}

class CapturingLog extends Log {
  constructor(record) {
    super(LogLevel.WARN, { prefix: 'snapback-proof' });
    this.record = record;
  }

  error(error) {
    this.record('miniflare', 'error', error);
    super.error(error);
  }

  warn(message) {
    this.record('miniflare', 'warn', message);
    super.warn(message);
  }
}

// Emit the lifecycle evidence retained for the proof serving `target`.
// Called only when a real-loopback transport request fails.
export function reportProofRuntimeFailure(target, error) {
  let client;
  try { client = loopbackProofs.get(new URL(target).origin); } catch (_) {}
  client?.reportRuntimeFailure(error);
}

// The LLP 0049 deploy-time app selector, harness half: the same
// 'snapback-app' alias the wrangler configs pin, resolved per app through
// esbuild's alias option so tests never rewrite a checked-in file.
const APPS = {
  notes: {
    bundle: 'app/notes.app.js',
    gatewayWorker: 'snapback-notes-proof',
    handlerWorker: 'snapback-notes-handler',
  },
  'all-aboard': {
    bundle: 'app/all-aboard.app.js',
    gatewayWorker: 'snapback-all-aboard-proof',
    handlerWorker: 'snapback-all-aboard-handler',
    // Actions run on their own isolate (LLP 0049 Phase 2): the handler
    // server chains invocations per isolate, so a slow action fetch must
    // not share the transactional handler Worker.
    actionHandlerWorker: 'snapback-all-aboard-action-handler',
  },
  // The conformance-twin corpus as a Miniflare app (ENG-23605): executed by
  // twin-engine.mjs under snapback-conformance-twin; never deployed.
  twin: {
    bundle: 'app/twin.app.js',
    gatewayWorker: 'snapback-twin-proof',
    handlerWorker: 'snapback-twin-handler',
  },
};

function seedOverridePlugin(appPath, seedOverride) {
  return {
    name: 'snapback-test-seed-override',
    setup(build) {
      build.onResolve({ filter: /^snapback-app$/ }, () => ({
        path: 'snapback-app-with-test-seed',
        namespace: 'snapback-test-seed',
      }));
      build.onResolve({ filter: /.*/, namespace: 'snapback-test-seed' }, (args) => ({
        path: path.isAbsolute(args.path) ? args.path : path.resolve(root, args.path),
        namespace: 'file',
      }));
      build.onLoad({ filter: /.*/, namespace: 'snapback-test-seed' }, () => ({
        contents: `export * from ${JSON.stringify(appPath)};\nexport const seed = ${JSON.stringify(seedOverride)};`,
        loader: 'js',
        resolveDir: root,
      }));
    },
  };
}

async function bundle(entry, appBundle, { seedOverride } = {}) {
  const appPath = path.join(root, appBundle);
  const hasSeedOverride = seedOverride !== undefined;
  const result = await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'esm',
    write: false,
    loader: { '.json': 'json' },
    platform: 'neutral',
    target: 'esnext',
    ...(hasSeedOverride ? { plugins: [seedOverridePlugin(appPath, seedOverride)] } : { alias: { 'snapback-app': appPath } }),
  });
  return result.outputFiles[0].text;
}

// `app` selects the compiled-in bundle (default: the notes fixture, LLP
// 0040's pinned regression surface). `port` binds Miniflare to a real
// loopback port so the actual kit client (demos/_kit/client.mjs) can drive
// the proof over HTTP + WebSocket — dispatchFetch cannot carry the kit's
// socket upgrades.
// `bindings` merges extra gateway-Worker bindings (e.g. the LLP 0049
// deploy-time secret bindings SNAPBACK_SECRET_* and the
// SNAPBACK_CONFIG_GENERATION attestation carrier) over the defaults.
// `seedOverride` is a test-only compile-time replacement for the selected
// app's seed export. It lets structural-validation tests exercise the real
// compiled-seed preparation path with intentionally invalid fixtures; caller
// bytes still never become production seed authority.
// `assetsDirectory` attaches a Workers Assets directory to the gateway
// Worker (binding ASSETS, SPA fallback, worker-first routing) — the
// Miniflare projection of the wrangler `assets` stanza the All Aboard deploy
// uses, so the RQS Channel A gateway seam (LLP 0090 rollout step 4) is
// testable locally.
// `persistRoot` persists Durable Object storage under a directory so a
// dispose + restart pair simulates a real DO restart (the RQS keyring
// custody proof); default remains in-memory.
// `handlerWireCapture` interposes byte-transparent capture Workers on the
// coordinator↔handler service bindings (the LLP 0060 D6 marker-envelope
// seams) and appends `{lane, path, status, requestBody, responseBody}`
// records to the given array — the hosted real-bytes half of the LLP 0094
// §0F item-1 schema drift gate (`wire-schema-gate.mjs`). Test-only plumbing:
// the production Workers are untouched; only the Miniflare binding graph
// gains the proxies.
export async function startProof({ app = 'notes', port = null, bindings = {}, seedOverride, assetsDirectory = null, persistRoot = null, handlerWireCapture = null, outboundService = null } = {}) {
  // @ref LLP 0040#proof-runtime-preflight-2026-07-14-eng-24454 — fail closed on
  // an unsupported Node major before standing up Miniflare, rather than letting
  // the first real-loopback action reset (`read ECONNRESET`) under Node 25.
  assertProofRuntimeNode();
  const selected = APPS[app];
  if (!selected) throw new Error(`unknown proof app ${app}`);
  const [gatewayScript, handlerScript] = await Promise.all([
    bundle('src/gateway.js', selected.bundle, { seedOverride }),
    bundle('src/handler-worker.js', selected.bundle, { seedOverride }),
  ]);
  const gatewayBindings = { SNAPBACK_ADMIN_TOKEN: ADMIN_TOKEN, SNAPBACK_TESTING: '1', ...bindings };
  // Null means the deployment binding is absent. The LLP 0167 refusal matrix
  // distinguishes absence from exact values, while Miniflare cannot carry
  // undefined/null as a production binding.
  for (const binding of ['SNAPBACK_TESTING', 'SNAPBACK_DERIVED_INSTANCE_ID']) {
    if (bindings[binding] === null) delete gatewayBindings[binding];
  }

  // Byte-transparent capture proxy for one service-binding edge: forwards the
  // request to INNER unchanged, replays the response bytes, and reports the
  // observed pair to the Node-side SINK. `filterPath` scopes reporting to the
  // marker-envelope seam carried on that edge.
  const captureProxySource = (lane, filterPath) => `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const requestBody = method === 'GET' || method === 'HEAD' ? null : await request.text();
    const forwarded = await env.INNER.fetch(request.url, {
      method,
      headers: request.headers,
      ...(requestBody === null ? {} : { body: requestBody }),
    });
    const responseBody = await forwarded.text();
    if (${filterPath === null ? 'true' : `url.pathname === ${JSON.stringify(filterPath)}`}) {
      try {
        await env.SINK.fetch('http://capture-sink/record', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            lane: ${JSON.stringify(lane)},
            path: url.pathname,
            status: forwarded.status,
            requestBody,
            responseBody,
          }),
        });
      } catch (_) {}
    }
    const headers = new Headers(forwarded.headers);
    headers.delete('content-length');
    return new Response(responseBody, { status: forwarded.status, headers });
  },
};
`;
  const invokeCaptureWorker = `${selected.handlerWorker}-wire-capture`;
  const hostCaptureWorker = `${selected.gatewayWorker}-host-capture`;
  const captureSink = async (request) => {
    try {
      handlerWireCapture.push(JSON.parse(await request.text()));
    } catch (_) {}
    return new Response('ok');
  };

  const workers = [
    {
      name: selected.gatewayWorker,
      modules: [{ type: 'ESModule', path: path.join(root, 'src/gateway.js'), contents: gatewayScript }],
      ...compatibilityOptions,
      durableObjects: { COORDINATOR: { className: 'Coordinator', useSQLite: true } },
      serviceBindings: {
        HANDLER: handlerWireCapture ? invokeCaptureWorker : selected.handlerWorker,
        ...(selected.actionHandlerWorker ? { ACTION_HANDLER: selected.actionHandlerWorker } : {}),
      },
      // The admin-token gate on /_snapback/api/app/reset and /_snapback/api/object/evict (ENG-23587); the client
      // below presents it, and the acceptance suite asserts its absence 403s.
      bindings: gatewayBindings,
      ...(outboundService === null ? {} : { outboundService }),
      ...(assetsDirectory
        ? {
            assets: {
              directory: assetsDirectory,
              binding: 'ASSETS',
              routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
              assetConfig: { html_handling: 'auto-trailing-slash', not_found_handling: 'single-page-application' },
            },
          }
        : {}),
    },
    {
      name: selected.handlerWorker,
      modules: [{ type: 'ESModule', path: path.join(root, 'src/handler-worker.js'), contents: handlerScript }],
      ...compatibilityOptions,
      serviceBindings: { HOST: handlerWireCapture ? hostCaptureWorker : selected.gatewayWorker },
    },
  ];
  if (handlerWireCapture) {
    workers.push(
      {
        name: invokeCaptureWorker,
        modules: [{
          type: 'ESModule',
          path: path.join(root, 'src/wire-capture-invoke.mjs'),
          contents: captureProxySource('invoke', '/invoke'),
        }],
        ...compatibilityOptions,
        serviceBindings: { INNER: selected.handlerWorker, SINK: captureSink },
      },
      {
        name: hostCaptureWorker,
        modules: [{
          type: 'ESModule',
          path: path.join(root, 'src/wire-capture-host.mjs'),
          contents: captureProxySource('host-call', '/_snapback/host-call'),
        }],
        ...compatibilityOptions,
        serviceBindings: { INNER: selected.gatewayWorker, SINK: captureSink },
      }
    );
  }
  if (selected.actionHandlerWorker) {
    workers.push({
      name: selected.actionHandlerWorker,
      modules: [{ type: 'ESModule', path: path.join(root, 'src/handler-worker.js'), contents: handlerScript }],
      ...compatibilityOptions,
      serviceBindings: { HOST: selected.gatewayWorker },
    });
  }
  const runtimeDiagnostics = diagnosticRecorder(bindings);
  const mf = new Miniflare({
    ...(port === null ? {} : { host: '127.0.0.1', port }),
    ...(persistRoot === null ? {} : { durableObjectsPersist: persistRoot }),
    log: new CapturingLog(runtimeDiagnostics.record),
    handleStructuredLogs({ level, message }) {
      if (level === 'error' || level === 'warn') {
        runtimeDiagnostics.record('workerd', level, message);
      }
    },
    workers,
  });
  // Force construction / readiness.
  const ready = await mf.ready;
  const client = new ProofClient(mf, runtimeDiagnostics, String(ready).replace(/\/$/, ''));
  client.registerLoopback();
  return client;
}

// Keep authored test URLs public-policy admissible while routing their bytes
// to a loopback fixture wholly inside the test harness. Production code sees
// and validates the authored hostname; only Miniflare's outbound service is
// replaced.
export function proxyOutboundTo(origin) {
  const targetOrigin = new URL(origin);
  return async (request) => {
    const authored = new URL(request.url);
    const target = new URL(`${authored.pathname}${authored.search}`, targetOrigin);
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('connection', 'close');
    const method = request.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
    return fetch(target, { method, headers, body, redirect: 'manual', signal: request.signal });
  };
}

class ProofClient {
  constructor(mf, runtimeDiagnostics, loopbackUrl) {
    this.mf = mf;
    this.base = 'http://gateway';
    this.runtimeDiagnostics = runtimeDiagnostics;
    this.loopbackUrl = loopbackUrl;
    this.onUncaughtException = (error, origin) => {
      runtimeDiagnostics.record('node', origin, error);
    };
    process.on('uncaughtExceptionMonitor', this.onUncaughtException);
  }

  registerLoopback() {
    if (this.loopbackUrl) loopbackProofs.set(new URL(this.loopbackUrl).origin, this);
  }

  reportRuntimeFailure(error) {
    const cause = error?.cause;
    const payload = {
      event: 'SNAPBACK_PROOF_RUNTIME_TRANSPORT_FAILURE',
      node: process.version,
      error: this.runtimeDiagnostics.sanitize(error),
      cause: cause ? this.runtimeDiagnostics.sanitize(cause) : null,
      runtimeDiagnostics: this.runtimeDiagnostics.retained,
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }

  async dispose() {
    process.removeListener('uncaughtExceptionMonitor', this.onUncaughtException);
    if (this.loopbackUrl) loopbackProofs.delete(new URL(this.loopbackUrl).origin);
    await this.mf.dispose();
  }

  // The real loopback URL when startProof was given a port — the base the kit
  // client (demos/_kit/client.mjs) drives over HTTP + WebSocket.
  async url() {
    return this.loopbackUrl;
  }

  async inspect() {
    const response = await this.mf.dispatchFetch(`${this.base}/inspect`);
    return response.json();
  }

  async health() {
    const response = await this.mf.dispatchFetch(`${this.base}/health`);
    return response.json();
  }

  async raw(pathName, init = {}) {
    return this.mf.dispatchFetch(`${this.base}${pathName}`, init);
  }

  async reset() {
    const response = await this.mf.dispatchFetch(`${this.base}/_snapback/api/app/reset`, {
      method: 'POST',
      headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
    });
    return response.json();
  }

  async evict() {
    const response = await this.mf.dispatchFetch(`${this.base}/_snapback/api/object/evict`, {
      method: 'POST',
      headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
    });
    return response.json();
  }

  async corruptMeta(payload) {
    const response = await this.mf.dispatchFetch(`${this.base}/_snapback/test/corrupt-meta`, {
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
      headers: { 'content-type': 'application/json', 'x-snapback-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ name, args }),
    });
    return response.json();
  }

  async mutation(name, args) {
    const response = await this.mf.dispatchFetch(`${this.base}/mutation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-snapback-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ name, args }),
    });
    return response.json();
  }

  async kitMutation(name, args) {
    const response = await this.mf.dispatchFetch(`${this.base}/mutation/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-snapback-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ args }),
    });
    return { status: response.status, body: await response.json() };
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
    this.closeQueue = [];
    this.closeWaiters = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
    ws.addEventListener('close', (event) => {
      const closed = { code: event.code, reason: event.reason, wasClean: event.wasClean };
      const waiter = this.closeWaiters.shift();
      if (waiter) waiter(closed);
      else this.closeQueue.push(closed);
    });
  }

  send(value) {
    this.ws.send(JSON.stringify(value));
  }

  sendRaw(value) {
    this.ws.send(value);
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

  waitForClose(timeoutMs = 4000) {
    if (this.closeQueue.length) return Promise.resolve(this.closeQueue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for the live socket to close')), timeoutMs);
      this.closeWaiters.push((closed) => {
        clearTimeout(timer);
        resolve(closed);
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}
