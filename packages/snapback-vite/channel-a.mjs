// Channel A serving seam — the local-arm inlined web boot (LLP 0090 D2,
// contract LLP 0092 §0E.3–§0E.5; rollout step 3, ENG-25454).
//
// A composable Vite plugin owning, in order: route matching after
// basePath/SPA-fallback normalization, route-manifest lookup, origin
// handling (the seam calls the local backend itself; no backend origin ever
// reaches the HTML — LLP 0030's generated-app-facts rule), the pinned
// read-mode bundle evaluation, the HTML-safe embed, response mechanics
// (`Cache-Control: no-store`, recomputed Content-Length, no validators), and
// the degrade-to-unhydrated-shell failure posture under a bounded anonymous
// evaluation budget.
//
// The transformed document is produced through Vite's own
// `server.transformIndexHtml` pipeline (the LLP 0030 managed dev loop's
// transformIndexHtml integration), then the boot payload is embedded as a
// non-executable `<script type="application/json" id="__snapback_boot">`
// data block — the seam injects no executable script and rewrites no CSP.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serializeBootPayload } from './rqs-serializer.mjs';

export const SNAPBACK_BOOT_ELEMENT_ID = '__snapback_boot';

/// Pinned §0E.5 defaults (seam policy knobs).
export const CHANNEL_A_BUDGET_MS = 500;
export const CHANNEL_A_MAX_PAYLOAD_BYTES = 256 * 1024;
export const CHANNEL_A_ANONYMOUS_RATE_PER_MINUTE = 60;

/**
 * Match a request path against the route manifest's exact patterns
 * (LLP 0092 §0E.3 item 1): the ORIGINAL request path (pre-SPA-fallback),
 * with the configured base stripped, query/fragment excluded, and
 * percent-decoding applied per segment before `:param` binding. Returns
 * `{ route, params, entry }` or null.
 */
export function matchManifestRoute(routesManifest, rawUrl, base = '/') {
  if (typeof rawUrl !== 'string' || !Array.isArray(routesManifest?.routes)) return null;
  let path = rawUrl.split('#', 1)[0].split('?', 1)[0];
  const normalBase = base.endsWith('/') ? base : `${base}/`;
  if (normalBase !== '/') {
    if (path === normalBase || path === normalBase.slice(0, -1)) path = '/';
    else if (path.startsWith(normalBase)) path = `/${path.slice(normalBase.length)}`;
    else return null;
  }
  if (!path.startsWith('/')) return null;
  // The fallback-resolved literal document never matches as itself; the
  // pre-fallback path is what the manifest speaks about.
  if (path === '/index.html') path = '/';
  const segments = path === '/' ? [] : path.slice(1).split('/');
  let decoded;
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null; // percent-decode failure: unmatched, untransformed shell
  }
  if (decoded.some((segment) => segment.length === 0)) return null;
  for (const entry of routesManifest.routes) {
    const pattern = entry.route;
    const patternSegments = pattern === '/' ? [] : pattern.slice(1).split('/');
    if (patternSegments.length !== decoded.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < patternSegments.length; index += 1) {
      const patternSegment = patternSegments[index];
      if (patternSegment.startsWith(':')) {
        params[patternSegment.slice(1)] = decoded[index];
      } else if (patternSegment !== decoded[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: pattern, params, entry };
  }
  return null;
}

/// Every query the matched entry names carries the codegen-compiled
/// `publicInline` fact in the generated functions manifest (LLP 0092 §0E.3
/// item 2). The served instance re-checks the same facts at admission —
/// this is the seam's zero-cost skip, not the authority.
export function entryIsPublicInline(functionsManifest, entry) {
  const functions = functionsManifest?.functions ?? [];
  return Array.isArray(entry?.queries)
    && entry.queries.length > 0
    && entry.queries.every((spec) => functions.some(
      (fn) => fn.name === spec.function && fn.publicInline === true,
    ));
}

/// Inject the serialized boot payload as a non-executable JSON data block.
/// The serialized bytes contain no `<` or `>` by the §0E.1 whole-output
/// property, so placement inside the document cannot open or close tags.
export function injectBootPayload(html, serializedPayload) {
  const block = `<script type="application/json" id="${SNAPBACK_BOOT_ELEMENT_ID}">${serializedPayload}</script>`;
  const headClose = html.search(/<\/head>/i);
  if (headClose !== -1) {
    return `${html.slice(0, headClose)}${block}\n${html.slice(headClose)}`;
  }
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) {
    return `${html.slice(0, bodyClose)}${block}\n${html.slice(bodyClose)}`;
  }
  return html + block;
}

/**
 * The Channel A Vite plugin. Options:
 * - `origin` (required): the local Snapback backend origin the seam itself
 *   calls (never exposed to the HTML).
 * - `routesManifest` / `routesManifestPath`: the generated
 *   `routes.manifest.json` (object or path), loaded at bring-up like other
 *   generated artifacts (LLP 0041 boundary: codegen stays with the CLI).
 * - `functionsManifest` / `functionsManifestPath`: the generated functions
 *   manifest carrying the `publicInline` facts.
 * - `budgetMs`, `maxPayloadBytes`, `ratePerMinute`: §0E.5 budget knobs.
 * - `onEvent(event)`: observability hook — `{ kind: 'inlined'|'degraded',
 *   code?, route, ms?, bytes? }`; degrade counters key on the causing code.
 */
export function snapbackChannelA(options = {}) {
  const {
    origin,
    routesManifest = null,
    routesManifestPath = null,
    functionsManifest = null,
    functionsManifestPath = null,
    budgetMs = CHANNEL_A_BUDGET_MS,
    maxPayloadBytes = CHANNEL_A_MAX_PAYLOAD_BYTES,
    ratePerMinute = CHANNEL_A_ANONYMOUS_RATE_PER_MINUTE,
    onEvent = null,
  } = options;
  if (typeof origin !== 'string' || origin.length === 0) {
    throw new Error('snapbackChannelA requires the local backend `origin`');
  }

  const degradeCounters = new Map();
  const rateWindows = new Map();
  let resolvedConfig = null;
  let routes = routesManifest;
  let functions = functionsManifest;

  const emit = (event) => {
    if (event.kind === 'degraded') {
      degradeCounters.set(event.code, (degradeCounters.get(event.code) ?? 0) + 1);
    }
    try {
      onEvent?.(event);
    } catch {
      /* observability must never fail the pageload */
    }
  };

  const admitRate = (key, nowMs) => {
    const window = rateWindows.get(key) ?? [];
    while (window.length > 0 && nowMs - window[0] >= 60_000) window.shift();
    if (window.length >= ratePerMinute) {
      rateWindows.set(key, window);
      return false;
    }
    window.push(nowMs);
    rateWindows.set(key, window);
    return true;
  };

  return {
    name: 'snapback-channel-a',

    configResolved(config) {
      resolvedConfig = config;
      if (routes === null && routesManifestPath) {
        routes = JSON.parse(readFileSync(routesManifestPath, 'utf8'));
      }
      if (functions === null && functionsManifestPath) {
        functions = JSON.parse(readFileSync(functionsManifestPath, 'utf8'));
      }
    },

    configureServer(server) {
      // Registered inside configureServer (not as a returned post hook), so
      // the seam sees the ORIGINAL request path before Vite's SPA fallback
      // rewrites it to /index.html (§0E.3 item 1).
      server.middlewares.use((req, res, next) => {
        void (async () => {
          if (req.method !== 'GET') return next();
          const accept = String(req.headers?.accept ?? '');
          if (!accept.includes('text/html')) return next();
          const rawUrl = req.originalUrl ?? req.url ?? '/';
          const base = resolvedConfig?.base ?? '/';
          const match = matchManifestRoute(routes, rawUrl, base);
          if (!match) return next(); // unmanifested: untransformed shell, zero cost
          if (!entryIsPublicInline(functions, match.entry)) {
            // Not Channel A-eligible: not evaluated at all (§0E.3 item 2).
            emit({ kind: 'degraded', code: 'SNAPBACK_BUNDLE_NOT_PUBLIC', route: match.route });
            return next();
          }
          const clientKey = req.socket?.remoteAddress ?? 'unknown';
          if (!admitRate(clientKey, Date.now())) {
            // Over the anonymous budget: degrade, never refuse — the route
            // stays reachable (§0E.5).
            emit({ kind: 'degraded', code: 'SNAPBACK_INLINE_BUDGET_EXCEEDED', route: match.route });
            return next();
          }
          const started = Date.now();
          let payloadBytes;
          let html;
          try {
            // One anonymous read-mode bundle evaluation per pageload over
            // the seam's own loopback lane (§0E.3 items 3–4); the pinned-cut
            // guarantee is the endpoint's.
            const response = await fetch(`${origin.replace(/\/$/, '')}/app/bundle`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ route: match.route, params: match.params, mode: 'read' }),
              signal: AbortSignal.timeout(budgetMs),
            });
            if (!response.ok) {
              let code = 'SNAPBACK_INLINE_UNAVAILABLE';
              try {
                code = (await response.json())?.diagnostic?.code ?? code;
              } catch { /* keep the seam-local code */ }
              emit({ kind: 'degraded', code, route: match.route });
              return next();
            }
            const bundle = await response.json();
            // Embedded payload (§0E.1): exactly the read-mode bundle
            // response body plus the matched route pattern; the attestation
            // facts (`generation`, `versionStream`) already ride the body.
            // No absolute backend origin appears anywhere in it.
            const serialized = serializeBootPayload({ route: match.route, ...bundle });
            if (Buffer.byteLength(serialized, 'utf8') > maxPayloadBytes) {
              emit({ kind: 'degraded', code: 'SNAPBACK_INLINE_BUDGET_EXCEEDED', route: match.route });
              return next();
            }
            const template = readFileSync(join(resolvedConfig.root, 'index.html'), 'utf8');
            const transformed = await server.transformIndexHtml(
              rawUrl.split('?', 1)[0],
              template,
              rawUrl,
            );
            html = injectBootPayload(transformed, serialized);
            payloadBytes = Buffer.byteLength(serialized, 'utf8');
          } catch (error) {
            emit({
              kind: 'degraded',
              code: error?.name === 'TimeoutError'
                ? 'SNAPBACK_INLINE_BUDGET_EXCEEDED'
                : 'SNAPBACK_INLINE_UNAVAILABLE',
              route: match.route,
            });
            return next();
          }
          // Response mechanics (§0E.4): no-store, recomputed length, no
          // validators from the static shell, CSP untouched.
          const body = Buffer.from(html, 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.removeHeader?.('ETag');
          res.removeHeader?.('Last-Modified');
          res.setHeader('Content-Length', String(body.byteLength));
          res.end(body);
          emit({
            kind: 'inlined',
            route: match.route,
            ms: Date.now() - started,
            bytes: payloadBytes,
          });
        })().catch(() => {
          // Absolute backstop: a failure anywhere degrades to the shell.
          try {
            next();
          } catch { /* response already owned */ }
        });
      });
    },

    api: {
      /// Observability snapshot (tests and diagnostics).
      channelAState() {
        return {
          degradeCounters: Object.fromEntries(degradeCounters),
        };
      },
    },
  };
}

export default snapbackChannelA;
