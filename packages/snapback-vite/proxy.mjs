// @expo/snapback-vite — the /__snapback HTTP + WebSocket relay.
//
// The relay rewrites its configured prefix onto the backend's server root, so
// the allowlist in allowlist.mjs is the only thing between browser code and
// the privileged routes that share that root's origin. Every refusal is a
// structured JSON diagnostic, never a bare proxy error.

import http from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

import { matchAppRoute } from './allowlist.mjs';

const DEV_IDENTITY_HEADER = 'x-snapback-dev-identity';

// Hop-by-hop headers are relay-owned and never forwarded verbatim.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function refusalDiagnostic({ method, path, route, mode }) {
  return {
    code: 'SNAPBACK_DEV_PROXY_ROUTE_REFUSED',
    severity: 'error',
    subsystem: 'vite-plugin',
    message: 'the Snapback dev relay forwards an explicit allowlist of app routes; this is not one of them',
    details: {
      target_surface: 'contract-browser-dev',
      method,
      path,
      route,
      mode,
      next_checks: [
        'app data lives on the allowlisted root routes (/query, /mutation, /live, /outbox, /ephemeral app-data routes)',
        'admin and system operations must run server-side (snapback CLI, host-ops, or an explicit admin proxy), never through the app relay',
      ],
    },
  };
}

export function unreachableDiagnostic({ path, route, mode, serverUrl, cause }) {
  return {
    code: 'SNAPBACK_DEV_PROXY_UNREACHABLE',
    severity: 'error',
    subsystem: 'vite-plugin',
    message: 'the Snapback dev relay could not reach its backend target',
    details: {
      target_surface: 'contract-browser-dev',
      path,
      route,
      mode,
      serverUrl: serverUrl ?? null,
      cause: cause ?? null,
      next_checks: [
        'check the plugin lifecycle diagnostics on stderr for the backend state',
        'in external mode, confirm the configured Snapback URL is running',
      ],
    },
  };
}

function sendJson(res, statusCode, payload) {
  if (!res.headersSent) {
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
  }
  res.end(JSON.stringify(payload));
}

// Resolve the relay-relative path. URL() collapses `.`/`..` dot-segments, so
// `/__snapback/query/../_snapback/...` is matched (and refused) in its
// normalized form rather than smuggled to the backend.
function relayTarget(url, base) {
  if (url !== base && !url.startsWith(`${base}/`)) return null;
  const rest = url.slice(base.length) || '/';
  let parsed;
  try {
    parsed = new URL(rest, 'http://snapback-relay.invalid');
  } catch {
    return { pathname: null, search: '' };
  }
  return { pathname: parsed.pathname, search: parsed.search };
}

// Connection-level failures that justify one re-resolve-and-retry pass: the
// cached backend target is gone (dev-loop backend restart), not an
// application error the backend produced.
const RETRYABLE_CONNECT_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH']);

export function createSnapbackProxy({
  base,
  mode,
  getState,
  channel,
  refreshTarget = null,
  getDevIdentityCapability = null,
}) {
  const emitRefusal = (diagnostic, transport) => {
    channel?.emit({
      event: 'proxy-refused',
      severity: 'warning',
      transport,
      code: diagnostic.code,
      method: diagnostic.details.method ?? 'GET',
      path: diagnostic.details.path,
    });
  };

  // @ref LLP 0262#d2-carriers-per-shipped-topology — the relay owns the
  //   browser carrier, so every forwarding attempt obtains the current
  //   capability before resolving the target. The lifecycle reader re-reads
  //   the sidecar and may advance same-port restart state first.
  const forwardContext = () => ({
    devIdentityCapability: getDevIdentityCapability?.() ?? null,
    state: getState(),
  });

  function handleRequest(req, res, next) {
    const target = relayTarget(req.url ?? '/', base);
    if (target === null) return next();
    const { pathname, search } = target;
    const match = pathname === null ? { allowed: false } : matchAppRoute(req.method, pathname);
    if (!match.allowed) {
      const diagnostic = refusalDiagnostic({ method: req.method, path: pathname ?? req.url, route: base, mode });
      emitRefusal(diagnostic, 'http');
      sendJson(res, 403, { diagnostic });
      return undefined;
    }
    const state = getState();
    if (!state.serverUrl) {
      sendJson(res, 502, {
        diagnostic: unreachableDiagnostic({ path: pathname, route: base, mode, serverUrl: null, cause: 'no backend target' }),
      });
      return undefined;
    }
    // The request body is buffered (dev-scale app-data payloads) so retry-safe
    // routes can be replayed once against a target re-resolved from the ready
    // file. Routes whose generated registry entry marks them unsafe never
    // replay: ECONNRESET cannot distinguish a pre-send failure from a server
    // commit followed by a dropped response.
    const forward = (serverUrl, body, mayRetry, devIdentityCapability) => {
      const upstream = new URL(serverUrl);
      const headers = {};
      for (const [name, value] of Object.entries(req.headers)) {
        const normalizedName = name.toLowerCase();
        if (HOP_BY_HOP.has(normalizedName) || normalizedName === 'host' || normalizedName === DEV_IDENTITY_HEADER) continue;
        headers[name] = value;
      }
      headers.host = upstream.host;
      if (devIdentityCapability) headers[DEV_IDENTITY_HEADER] = devIdentityCapability;
      const proxied = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          method: req.method,
          path: `${pathname}${search}`,
          headers,
        },
        (backendRes) => {
          const responseHeaders = {};
          for (const [name, value] of Object.entries(backendRes.headers)) {
            const normalizedName = name.toLowerCase();
            if (HOP_BY_HOP.has(normalizedName) || normalizedName === DEV_IDENTITY_HEADER) continue;
            responseHeaders[name] = value;
          }
          res.writeHead(backendRes.statusCode ?? 502, responseHeaders);
          backendRes.pipe(res);
        },
      );
      proxied.on('error', (error) => {
        if (mayRetry && refreshTarget && RETRYABLE_CONNECT_CODES.has(error.code)) {
          void Promise.resolve(refreshTarget()).then((refreshed) => {
            if (refreshed?.serverUrl) {
              const context = forwardContext();
              forward(context.state.serverUrl ?? refreshed.serverUrl, body, false, context.devIdentityCapability);
              return;
            }
            sendJson(res, 502, {
              diagnostic: unreachableDiagnostic({ path: pathname, route: base, mode, serverUrl, cause: error.message }),
            });
          });
          return;
        }
        sendJson(res, 502, {
          diagnostic: unreachableDiagnostic({ path: pathname, route: base, mode, serverUrl, cause: error.message }),
        });
      });
      proxied.end(body);
    };
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const context = forwardContext();
      forward(
        context.state.serverUrl ?? state.serverUrl,
        Buffer.concat(chunks),
        match.route.retrySafe,
        context.devIdentityCapability,
      );
    });
    req.on('error', () => res.destroy());
    return undefined;
  }

  // @ref LLP 0030#proxy-surface — ws-layer relay because Bun's node:http shim
  // black-holes raw upgrade-socket writes.
  // WebSocket upgrades for the live stream. The refusal path answers with a
  // real HTTP response before closing, so a browser sees a structured error
  // instead of a dropped socket.
  // Browser-side handshake completion is delegated to `ws` in noServer mode.
  // Under `bun --bun`, raw writes on the upgrade socket are silently dropped
  // by Bun's node:http shim, while the `ws` package resolves to Bun's native
  // implementation and works — the same path Vite's own HMR socket uses. A
  // ws-level relay is therefore the only tunnel that behaves identically
  // under Node and Bun.
  const browserWss = new WebSocketServer({ noServer: true });

  function handleUpgrade(req, socket, head) {
    const target = relayTarget(req.url ?? '/', base);
    if (target === null) return false;
    const { pathname, search } = target;
    const match = pathname === null ? { allowed: false } : matchAppRoute(req.method, pathname);
    if (!match.allowed || match.route.ws !== true) {
      const diagnostic = refusalDiagnostic({ method: req.method, path: pathname ?? req.url, route: base, mode });
      emitRefusal(diagnostic, 'websocket');
      const body = JSON.stringify({ diagnostic });
      // Best-effort diagnostic body (a no-op under Bun's http shim), then a
      // hard close either way — the refusal must never leave a half-open socket.
      socket.write(
        'HTTP/1.1 403 Forbidden\r\n'
          + 'content-type: application/json; charset=utf-8\r\n'
          + `content-length: ${Buffer.byteLength(body)}\r\n`
          + 'connection: close\r\n\r\n'
          + body,
      );
      socket.destroy();
      return true;
    }
    const state = getState();
    if (!state.serverUrl) {
      socket.destroy();
      return true;
    }
    // Same restart tolerance as handleRequest: one re-resolve-and-reconnect
    // pass before giving up. The browser handshake is not completed until a
    // backend connection succeeds, so retrying never replays consumed data.
    const connectBackend = (serverUrl, mayRetry, devIdentityCapability) => {
      const upstream = new URL(serverUrl);
      const wsProtocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
      const headers = {};
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        const name = req.rawHeaders[index].toLowerCase();
        if (HOP_BY_HOP.has(name) || name === 'host'
          || name === DEV_IDENTITY_HEADER
          || name.startsWith('sec-websocket-')) continue;
        headers[req.rawHeaders[index]] = req.rawHeaders[index + 1];
      }
      if (devIdentityCapability) headers[DEV_IDENTITY_HEADER] = devIdentityCapability;
      const protocolHeader = req.headers['sec-websocket-protocol'];
      const protocols = typeof protocolHeader === 'string'
        ? protocolHeader.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
      const backend = new WebSocket(
        `${wsProtocol}//${upstream.host}${pathname}${search}`,
        protocols,
        { headers },
      );
      let browser = null;
      const teardown = () => {
        try { backend.close(); } catch { /* already closing */ }
        if (browser) {
          try { browser.close(); } catch { /* already closing */ }
        } else {
          socket.destroy();
        }
      };
      backend.on('error', (error) => {
        if (mayRetry && refreshTarget && RETRYABLE_CONNECT_CODES.has(error.code)) {
          void Promise.resolve(refreshTarget()).then((refreshed) => {
            if (refreshed?.serverUrl) {
              const context = forwardContext();
              connectBackend(
                context.state.serverUrl ?? refreshed.serverUrl,
                false,
                context.devIdentityCapability,
              );
            }
            else socket.destroy();
          });
          return;
        }
        teardown();
      });
      backend.on('unexpected-response', (_request, response) => {
        // The backend refused the stream at HTTP level (e.g. an unknown
        // connection id). There is no browser websocket yet to carry the
        // status, so close the raw socket; the client treats it as a failed
        // connect and falls back or retries.
        response.resume();
        teardown();
      });
      backend.on('open', () => {
        browserWss.handleUpgrade(req, socket, head, (client) => {
          browser = client;
          client.on('message', (data, isBinary) => backend.send(data, { binary: isBinary }));
          backend.on('message', (data, isBinary) => client.send(data, { binary: isBinary }));
          client.on('close', () => { try { backend.close(); } catch { /* closing */ } });
          backend.on('close', (code, reason) => {
            try {
              client.close(code, reason);
            } catch {
              client.terminate();
            }
          });
          client.on('error', teardown);
        });
      });
    };
    const context = forwardContext();
    connectBackend(
      context.state.serverUrl ?? state.serverUrl,
      true,
      context.devIdentityCapability,
    );
    return true;
  }

  return { handleRequest, handleUpgrade };
}
