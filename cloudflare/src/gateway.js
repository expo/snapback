// The gateway Worker for the LLP 0040 Cloudflare narrow proof and its
// LLP 0049 All Aboard extension.
//
// It routes app HTTP and WebSocket requests to the app coordinator Durable
// Object, routes the handler isolate's re-entrant host calls back to the
// coordinator that owns the live invocation, serves the target capability
// manifest, and — when the deploy config carries a static-assets binding —
// serves the built Contract web bundle same-origin (LLP 0049 §Realtime And
// Browser Surface: API routes take precedence; assets are the fallback, so
// the CORS surface never exists).
//
// App identity is registry-owned in the full plan (LLP 0014 one-way door 6);
// the narrow proof has one app, so its object key is a fixed logical name
// resolved to an object id here. The name comes from the selected app bundle
// (LLP 0049 Phase 0 deploy-time app selector — the 'snapback-app' alias).
import { Coordinator } from './coordinator.js';
import { appMeta, capabilityManifest } from 'snapback-app';

export { Coordinator };

const APP_OBJECT_NAME = appMeta.objectName;

// Exact-path API routes forwarded to the coordinator with a fresh POST body.
const FORWARDED_JSON_PATHS = new Set(['/query', '/mutation', '/__test/corrupt-meta', '/connection/open', '/app/ensure']);

// Kit wire-protocol prefixes (LLP 0049 Phase 0): the generated Contract
// surface speaks the local server's protocol; these are its routes.
const KIT_ROUTE = /^\/(?:query|mutation|action)\/[A-Za-z0-9_-]+$|^\/live\/[A-Za-z0-9_.-]+\/(?:subscribe|unsubscribe)$|^\/outbox\/[A-Za-z0-9_.-]+$/;
const KIT_STREAM_ROUTE = /^\/live\/[A-Za-z0-9_.-]+\/stream$/;

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function coordinatorStub(env, doIdString) {
  if (doIdString) {
    return env.COORDINATOR.get(env.COORDINATOR.idFromString(doIdString));
  }
  return env.COORDINATOR.get(env.COORDINATOR.idFromName(APP_OBJECT_NAME));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // The capability manifest (LLP 0040 §Capability report): served, honest
    // about missing features, validated against its generated JSON Schema by
    // the acceptance suite. Each app bundle carries its own manifest — the
    // All Aboard profile declares different facts than the notes proof.
    if (path === '/inspect' || path === '/capability') {
      return json(200, capabilityManifest);
    }

    // Re-entrant host calls from the handler isolate. The coordinator id rides
    // x-snapback-do-id so the call reaches the object holding the invocation.
    if (path === '/host-call') {
      const doId = request.headers.get('x-snapback-do-id');
      const stub = coordinatorStub(env, doId);
      return stub.fetch('http://coordinator/host-call', {
        method: 'POST',
        headers: request.headers,
        body: await request.text(),
      });
    }

    // App data plane — one coordinator for the single proof app.
    const stub = coordinatorStub(env, null);
    if (path === '/health') return stub.fetch('http://coordinator/health');
    // Operator config diagnosis (LLP 0049 Phase 1): names, set/missing
    // state, grants, generation — never values.
    if (path === '/config/status') return stub.fetch('http://coordinator/config/status');
    // Cron ledger/activation status (LLP 0049 Phase 3), and the admin-gated
    // manual run trigger — forwarded with the caller's method and headers so
    // the coordinator enforces the token gate (ENG-23587).
    if (path === '/cron/status') return stub.fetch('http://coordinator/cron/status');
    if (path === '/cron/run') {
      return stub.fetch('http://coordinator/cron/run', {
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' ? undefined : await request.text(),
      });
    }
    if (FORWARDED_JSON_PATHS.has(path) || path.startsWith('/__test/')) {
      return forward(stub, `http://coordinator${path}`, request);
    }
    // Destructive admin endpoints: forwarded with the caller's method and
    // headers so the coordinator can enforce the POST-only, token-gated admin
    // surface (ENG-23587). The gateway itself never mints admin authority.
    if (path === '/reset' || path === '/evict') {
      return stub.fetch(`http://coordinator${path}`, { method: request.method, headers: request.headers });
    }
    if (KIT_ROUTE.test(path)) {
      // Kit routes carry auth headers (x-snapback-connection-token), so the
      // full header set forwards; the coordinator enforces the token gate.
      return stub.fetch(`http://coordinator${path}`, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' ? undefined : await request.text(),
      });
    }
    if (path === '/live/stream' || KIT_STREAM_ROUTE.test(path)) {
      if (request.headers.get('upgrade') !== 'websocket') {
        return json(426, { error: 'expected websocket upgrade' });
      }
      return stub.fetch(`http://coordinator${path}${url.search}`, request);
    }

    // Static web bundle, same-origin (LLP 0049 §Realtime And Browser
    // Surface): every API route above took precedence; anything else is an
    // asset lookup when this deploy carries the assets binding. Deploys
    // without assets (the notes proof) fall through to the JSON 404.
    if (env.ASSETS) {
      // /__exact/* paths are Exact protocol endpoints (platform manifest,
      // native envelopes, dev-server agent surfaces), never SPA routes: a
      // miss there must fail as an explicit JSON 404 instead of the
      // single-page-application index.html fallback, or native hosts and the
      // Exact Log Console misread web HTML as a protocol payload (ENG-23643).
      if (path.startsWith('/__exact/')) {
        const asset = await env.ASSETS.fetch(request);
        const contentType = asset.headers.get('content-type') || '';
        if (asset.ok && !contentType.includes('text/html')) {
          return asset;
        }
        if (path.startsWith('/__exact/agent/')) {
          return json(404, {
            error: 'agent-unavailable',
            path,
            detail:
              'Exact agent endpoints (logs, run-js) are dev-server features; this Cloudflare deployment serves only the static bundle and Snapback API routes.',
          });
        }
        return json(404, { error: 'not found', path });
      }
      return env.ASSETS.fetch(request);
    }
    return json(404, { error: 'not found', path });
  },
};

async function forward(stub, target, request) {
  return stub.fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text(),
  });
}
