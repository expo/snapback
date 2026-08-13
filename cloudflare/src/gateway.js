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
import { classifyPlatformError, platformFailureResponse } from './platform-errors.js';
import { wireDiagnostic, wireErrorResponse } from './wire-diagnostic.js';
import { appMeta, capabilityManifest, functions, routesManifest } from 'snapback-app';
// Channel A on the Cloudflare arm (LLP 0090 rollout step 4 / LLP 0092 §0E):
// the gateway owns the HTML response, so it owns the serving seam. The route
// matcher, publicInline gate, and payload embed are the SAME modules the
// local-arm Vite seam uses (packages/snapback-vite), bundled by relative
// import — reuse, never a fork — and the serializer is the byte-pinned
// tests/fixtures/rqs-serializer implementation.
import {
  entryIsPublicInline,
  injectBootPayload,
  matchManifestRoute,
} from '../../packages/snapback-vite/channel-a-core.mjs';
import { serializeBootPayload } from '../../packages/snapback-vite/rqs-serializer.mjs';
import { admitChannelARate } from './rate-windows.js';

export { Coordinator };

const APP_OBJECT_NAME = appMeta.objectName;

// Exact-path API routes forwarded to the coordinator with a fresh POST body.
// /app/bundle is the RQS bundle endpoint (LLP 0092 §0D.1) — forwarded like
// the other app-data JSON routes; the coordinator owns admission and limits.
// Testing seams live under the reserved system namespace
// (/_snapback/test/*, LLP 0094 §0A.3); the corrupt-meta seam is enumerated
// here because it must stay reachable during a startup refusal.
const FORWARDED_JSON_PATHS = new Set(['/query', '/mutation', '/_snapback/test/corrupt-meta', '/connection/open', '/app/ensure', '/app/bundle']);

// Root app-data namespaces reserved by the local route registry. If an
// unimplemented path in one of these namespaces reaches Workers Assets and
// the assets binding answers with its SPA HTML fallback, refuse it as an
// unsupported target route instead of laundering HTML into an HTTP 200 API
// response. Segment-boundary matching keeps ordinary web paths such as
// `/querying` outside the reservation.
// @ref LLP 0031#hosted-app-data-spa-fallback-refusal-2026-08-08
const APP_DATA_PREFIXES = [
  '/auth',
  '/assets',
  '/ephemeral',
  '/push',
  '/app-api',
  '/client-mutations',
  '/live',
  '/outbox',
  '/query',
  '/mutation',
  '/action',
  '/connection',
];

// §0E.5 pinned Channel A budgets (seam policy knobs). The anonymous
// per-client-address rate window is in-memory per gateway isolate — a
// best-effort degrade budget (degrade over the cap, never refuse), not an
// admission control; the coordinator holds the authoritative bundle limits.
const CHANNEL_A_BUDGET_MS = 500;
const CHANNEL_A_MAX_PAYLOAD_BYTES = 256 * 1024;
const CHANNEL_A_ANONYMOUS_RATE_PER_MINUTE = 60;
const channelARateWindows = new Map();

function channelAAdmitRate(key, nowMs) {
  return admitChannelARate(channelARateWindows, key, nowMs, {
    limit: CHANNEL_A_ANONYMOUS_RATE_PER_MINUTE,
  });
}

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
    try {
      return await gatewayFetch(request, env);
    } catch (error) {
      const failure = classifyPlatformError(error, { maxRowBytes: capabilityManifest.runtimeFacts.maxRowBytes });
      if (failure) return platformFailureResponse(new URL(request.url).pathname, failure);
      throw error;
    }
  },
};

async function gatewayFetch(request, env) {
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
    // @ref LLP 0031#the-invariant — no system operation lives at the root;
    //   the hosted system surface migrated under /_snapback/* (LLP 0094 §0A.3).
    if (path === '/_snapback/host-call') {
      const doId = request.headers.get('x-snapback-do-id');
      const stub = coordinatorStub(env, doId);
      return stub.fetch('http://coordinator/_snapback/host-call', {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });
    }

    // App data plane — one coordinator for the single proof app.
    const stub = coordinatorStub(env, null);
    if (path === '/health') return stub.fetch('http://coordinator/health');
    // Operator config diagnosis (LLP 0049 Phase 1): names, set/missing
    // state, grants, generation — never values.
    if (path === '/_snapback/api/config/status') {
      return stub.fetch(`http://coordinator${path}`, {
        method: request.method,
        headers: request.headers,
      });
    }
    // Cron ledger/activation status (public bounded projection, with scrubbed
    // detail for an authenticated operator), and the admin-gated manual run
    // trigger — forward method/headers so the coordinator owns both decisions.
    if (path === '/_snapback/api/cron/status') {
      return stub.fetch(`http://coordinator${path}`, {
        method: request.method,
        headers: request.headers,
      });
    }
    if (path === '/_snapback/api/cron/run') {
      return stub.fetch(`http://coordinator${path}`, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' ? undefined : request.body,
      });
    }
    // LLP 0167 runtime selector: read/write authority remains coordinator-
    // owned. Forward the caller's method, token, and PUT body unchanged.
    if (path === '/_snapback/api/debug/network-profile') {
      return stub.fetch(`http://coordinator${path}`, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      });
    }
    if (FORWARDED_JSON_PATHS.has(path) || path.startsWith('/_snapback/test/')) {
      if (request.method !== 'POST') {
        // @ref LLP 0094#0c6-response-shape-divergences-audited-at-137dee8c-defects-not-contract — item 8: gateway refusals carry the full
        //   committed Diagnostic (versioned ErrorResponse envelope).
        return json(405, wireErrorResponse(
          wireDiagnostic('SNAPBACK_METHOD_NOT_ALLOWED', `${path} requires POST`, {
            path,
            expectedMethod: 'POST',
          }),
        ));
      }
      return forward(stub, `http://coordinator${path}`, request);
    }
    // Destructive admin endpoints: forwarded with the caller's method and
    // headers so the coordinator can enforce the POST-only, token-gated admin
    // surface (ENG-23587). The gateway itself never mints admin authority.
    if (path === '/_snapback/api/app/reset' || path === '/_snapback/api/object/evict') {
      return stub.fetch(`http://coordinator${path}`, { method: request.method, headers: request.headers });
    }
    // Anything else under the reserved system namespace is an explicit JSON
    // 404: /_snapback/* never falls through to the SPA asset lane, so a
    // proxy's "forward the root, refuse /_snapback/*" rule stays exhaustive.
    if (path === '/_snapback' || path.startsWith('/_snapback/')) {
      return json(404, wireErrorResponse(
        wireDiagnostic('SNAPBACK_ROUTE_UNKNOWN', 'not found', { path }),
      ));
    }
    if (KIT_ROUTE.test(path)) {
      const expectedMethod = path.startsWith('/outbox/') ? 'GET' : 'POST';
      if (request.method !== expectedMethod) {
        return json(405, wireErrorResponse(
          wireDiagnostic('SNAPBACK_METHOD_NOT_ALLOWED', `${path} requires ${expectedMethod}`, {
            path,
            expectedMethod,
          }),
        ));
      }
      // Kit routes carry auth headers (x-snapback-connection-token), so the
      // full header set forwards; the coordinator enforces the token gate.
      return stub.fetch(`http://coordinator${path}`, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' ? undefined : request.body,
      });
    }
    if (path === '/live/stream' || KIT_STREAM_ROUTE.test(path)) {
      if (request.headers.get('upgrade') !== 'websocket') {
        // Same code the coordinator's acceptKitSocket mints for its own
        // pre-upgrade refusal, so the two lanes are indistinguishable.
        return json(426, wireErrorResponse(
          wireDiagnostic('SNAPBACK_UPGRADE_REQUIRED', 'expected websocket upgrade', { path }),
        ));
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
        // Only the SPA fallback signature (200 + HTML) is a miss here; real
        // /__exact/ assets are JSON/JS, and non-200s (304 revalidations,
        // 405s) must pass through untouched.
        const isSpaFallback = asset.status === 200 && contentType.includes('text/html');
        if (!isSpaFallback) {
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
      if (APP_DATA_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
        const asset = await env.ASSETS.fetch(request);
        const contentType = asset.headers.get('content-type') || '';
        const isSpaFallback = asset.status === 200 && contentType.includes('text/html');
        if (!isSpaFallback) return asset;
        return json(501, wireErrorResponse(
          wireDiagnostic(
            'SNAPBACK_ROUTE_UNSUPPORTED_ON_TARGET',
            'the requested app-data route is not implemented on this deployment target',
            { path, target: 'cloudflare' },
          ),
        ));
      }
      // Channel A (LLP 0090 D2 / LLP 0092 §0E): when the pageload's route is
      // manifested and every named query carries the compiled publicInline
      // fact, compose the static shell with ONE coordinator bundle
      // subrequest and embed the snapshots. Any failure, timeout, budget
      // breach, or ineligibility serves the untransformed shell — degrade,
      // never fail the pageload.
      if (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) {
        const match = matchManifestRoute(routesManifest, `${url.pathname}${url.search}`, '/');
        if (match && entryIsPublicInline({ functions }, match.entry)) {
          const clientKey = request.headers.get('cf-connecting-ip') || 'unknown';
          if (channelAAdmitRate(clientKey, Date.now())) {
            const inlined = await channelAInline(request, env, stub, match);
            if (inlined) return inlined;
          }
        }
      }
      return env.ASSETS.fetch(request);
    }
    return json(404, wireErrorResponse(
      wireDiagnostic('SNAPBACK_ROUTE_UNKNOWN', 'not found', { path }),
    ));
}

// Assemble the transformed Channel A document, or null to degrade to the
// untransformed shell. Response mechanics per LLP 0092 §0E.4: the transformed
// document is `Cache-Control: no-store` with a recomputed Content-Length,
// the static shell's validators dropped, compression left to the runtime
// (the body handed over is identity bytes), and any CSP header carried
// through untouched — the boot payload is a non-executable data block.
async function channelAInline(request, env, stub, match) {
  try {
    const asset = await env.ASSETS.fetch(request);
    const contentType = asset.headers.get('content-type') || '';
    if (asset.status !== 200 || !contentType.includes('text/html')) return null;
    const html = await asset.text();
    // One coordinator subrequest per pageload, under the §0E.5 wall budget.
    // The subrequest is raced rather than aborted — a late bundle is simply
    // unused and the shell serves.
    const bundleResponse = await Promise.race([
      stub.fetch('http://coordinator/app/bundle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ route: match.route, params: match.params, mode: 'read' }),
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), CHANNEL_A_BUDGET_MS)),
    ]);
    if (!bundleResponse || !bundleResponse.ok) return null;
    const bundle = await bundleResponse.json();
    // Embedded payload (§0E.1): exactly the read-mode bundle response body
    // plus the matched route pattern; generation/versionStream attestation
    // facts already ride the body. No absolute backend origin appears.
    const serialized = serializeBootPayload({ route: match.route, ...bundle });
    const encoder = new TextEncoder();
    if (encoder.encode(serialized).byteLength > CHANNEL_A_MAX_PAYLOAD_BYTES) return null;
    const body = encoder.encode(injectBootPayload(html, serialized));
    const headers = new Headers();
    for (const [name, value] of asset.headers) {
      const lower = name.toLowerCase();
      if (
        lower === 'etag'
        || lower === 'last-modified'
        || lower === 'content-length'
        || lower === 'content-encoding'
        || lower === 'cache-control'
      ) continue;
      headers.set(name, value);
    }
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store');
    headers.set('content-length', String(body.byteLength));
    return new Response(body, { status: 200, headers });
  } catch (_) {
    // Serializer property-check failure, subrequest failure, or anything
    // else: degrade to the unhydrated shell (LLP 0092 §0E.5).
    return null;
  }
}

async function forward(stub, target, request) {
  const headers = new Headers();
  for (const name of [
    'content-type',
    'x-snapback-admin-token',
    'x-snapback-connection-token',
    'cf-connecting-ip',
  ]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return stub.fetch(target, {
    method: 'POST',
    // Data-plane authority is coordinator-owned. Preserve the admin,
    // connection-grant, and Cloudflare client-address carriers without
    // forwarding unrelated cookies or authorization headers.
    headers,
    body: request.body,
  });
}
