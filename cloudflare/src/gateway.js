// The gateway Worker for the LLP 0040 Cloudflare narrow proof.
//
// It routes app HTTP and WebSocket requests to the app coordinator Durable
// Object, and it routes the handler isolate's re-entrant host calls back to
// the coordinator that owns the live invocation. It also serves the target
// capability manifest.
//
// App identity is registry-owned in the full plan (LLP 0014 one-way door 6);
// the narrow proof has one app, so its object key is a fixed logical name
// resolved to an object id here. Names, not idFromName puns, are the seam that
// grows into the registry later.
import { Coordinator } from './coordinator.js';
import manifest from '../generated/capability.manifest.cloudflare-do-sqlite-v8.json';

export { Coordinator };

const APP_OBJECT_NAME = 'notes-proof';

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
    // the acceptance suite.
    if (path === '/inspect' || path === '/capability') {
      return json(200, manifest);
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
    if (path === '/query') return forward(stub, 'http://coordinator/query', request);
    if (path === '/mutation') return forward(stub, 'http://coordinator/mutation', request);
    // Destructive admin endpoints: forwarded with the caller's method and
    // headers so the coordinator can enforce the POST-only, token-gated admin
    // surface (ENG-23587). The gateway itself never mints admin authority.
    if (path === '/reset' || path === '/evict') {
      return stub.fetch(`http://coordinator${path}`, { method: request.method, headers: request.headers });
    }
    if (path === '/__test/corrupt-meta') {
      return forward(stub, 'http://coordinator/__test/corrupt-meta', request);
    }
    if (path === '/live/stream') {
      if (request.headers.get('upgrade') !== 'websocket') {
        return json(426, { error: 'expected websocket upgrade' });
      }
      return stub.fetch('http://coordinator/live/stream', request);
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
