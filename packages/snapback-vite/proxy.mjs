// @snapback/vite — the /__snapback HTTP + WebSocket relay.
//
// The relay rewrites its configured prefix onto the backend's server root, so
// the allowlist in allowlist.mjs is the only thing between browser code and
// the privileged routes that share that root's origin. Every refusal is a
// structured JSON diagnostic, never a bare proxy error.

import http from 'node:http';
import net from 'node:net';

import { matchAppRoute } from './allowlist.mjs';

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

export function createSnapbackProxy({ base, mode, getState, channel }) {
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
    const upstream = new URL(state.serverUrl);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(name) || name === 'host') continue;
      headers[name] = value;
    }
    headers.host = upstream.host;
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
          if (HOP_BY_HOP.has(name)) continue;
          responseHeaders[name] = value;
        }
        res.writeHead(backendRes.statusCode ?? 502, responseHeaders);
        backendRes.pipe(res);
      },
    );
    proxied.on('error', (error) => {
      sendJson(res, 502, {
        diagnostic: unreachableDiagnostic({
          path: pathname,
          route: base,
          mode,
          serverUrl: state.serverUrl,
          cause: error.message,
        }),
      });
    });
    req.pipe(proxied);
    return undefined;
  }

  // WebSocket upgrades for the live stream. The refusal path answers with a
  // real HTTP response before closing, so a browser sees a structured error
  // instead of a dropped socket.
  function handleUpgrade(req, socket, head) {
    const target = relayTarget(req.url ?? '/', base);
    if (target === null) return false;
    const { pathname, search } = target;
    const match = pathname === null ? { allowed: false } : matchAppRoute(req.method, pathname);
    if (!match.allowed || match.route.ws !== true) {
      const diagnostic = refusalDiagnostic({ method: req.method, path: pathname ?? req.url, route: base, mode });
      emitRefusal(diagnostic, 'websocket');
      const body = JSON.stringify({ diagnostic });
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
      socket.write('HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    const upstream = new URL(state.serverUrl);
    const backend = net.connect(Number(upstream.port), upstream.hostname, () => {
      let requestHead = `${req.method} ${pathname}${search} HTTP/1.1\r\n`;
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        const name = req.rawHeaders[index];
        const value = req.rawHeaders[index + 1];
        if (name.toLowerCase() === 'host') {
          requestHead += `host: ${upstream.host}\r\n`;
          continue;
        }
        requestHead += `${name}: ${value}\r\n`;
      }
      requestHead += '\r\n';
      backend.write(requestHead);
      if (head && head.length > 0) backend.write(head);
      socket.pipe(backend);
      backend.pipe(socket);
    });
    const teardown = () => {
      socket.destroy();
      backend.destroy();
    };
    backend.on('error', teardown);
    socket.on('error', teardown);
    return true;
  }

  return { handleRequest, handleUpgrade };
}
