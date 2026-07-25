// Channel A pure helpers shared across serving seams (LLP 0092 §0E.3).
//
// Split out of channel-a.mjs (which stays the local-arm Vite plugin) so the
// Cloudflare gateway Worker — rollout step 4's second Channel A assembler —
// can bundle the SAME route-matching, publicInline-gating, and payload-embed
// logic without pulling node:fs into a Workers bundle. This module must stay
// dependency-free and platform-neutral.

export const SNAPBACK_BOOT_ELEMENT_ID = '__snapback_boot';

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

/// Every query the matched entry names carries the compiled `publicInline`
/// fact in the served functions manifest (LLP 0092 §0E.3 item 2). The served
/// instance re-checks the same facts at admission — this is the seam's
/// zero-cost skip, not the authority.
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
