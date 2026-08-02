// @expo/snapback-vite — the default app-route allowlist for the /__snapback relay.
//
// @ref LLP 0030#proxy-surface — the default app proxy is an explicit
//   method+path allowlist of app-data routes, never a deny-list: system root
//   routes, the retired /admin/* aliases, and everything under /_snapback/*
//   must be unreachable through the relay.
// @ref LLP 0031#route-classification — the entries below are the AppData rows
//   of `core_route_registrations()` in src/server.rs; `/ephemeral/delete` and
//   `/ephemeral/collections/ensure` are app-data and forward, while
//   `/ephemeral/cleanup`, the `/ephemeral/collections` register route, and
//   `/connections/{id}/disconnect` are system and stay refused.
//
// `/app/ensure` is deliberately absent even though the server classifies it
// AppData: its legacy/provision half loads schema and executable function
// bundles under a dev profile, which is exactly the bring-up authority
// LLP 0030#backend-setup-ownership moves out of the browser and into the
// plugin's managed setup step.

const entry = (method, path, extra = {}) => Object.freeze({ method, path, ws: false, ...extra });

export const APP_ROUTE_ALLOWLIST = Object.freeze([
  entry('GET', '/'),
  entry('GET', '/health'),
  entry('GET', '/inspect'),
  entry('GET', '/auth/session'),
  entry('POST', '/auth/request-code'),
  entry('POST', '/auth/exchange'),
  entry('POST', '/auth/refresh'),
  entry('POST', '/auth/logout'),
  entry('POST', '/auth/family-alarm'),
  entry('POST', '/auth/step-up/request'),
  entry('POST', '/auth/pairing-codes'),
  entry('POST', '/auth/agents/pair'),
  entry('POST', '/auth/agents/rotate'),
  entry('POST', '/auth/agents/token'),
  entry('POST', '/auth/agents/revoke-self'),
  entry('GET', '/auth/grant-requests'),
  entry('POST', '/auth/grant-requests/{id}/approve'),
  entry('POST', '/auth/grant-requests/{id}/deny'),
  entry('GET', '/auth/grants'),
  entry('DELETE', '/auth/grants/by-actor/{actor_id}'),
  entry('DELETE', '/auth/grants/{id}'),
  entry('POST', '/query/{name}'),
  entry('POST', '/query/{name}/authorized-lease'),
  entry('POST', '/client-mutations/acknowledge'),
  entry('POST', '/mutation/{name}'),
  entry('POST', '/action/{name}'),
  entry('POST', '/connection/open'),
  entry('POST', '/live/authorization-invalidation/acknowledge'),
  entry('POST', '/live/authorization-invalidation/manual-retry'),
  entry('POST', '/live/{name}/subscribe'),
  entry('POST', '/live/{name}/resume'),
  entry('POST', '/live/{name}/unsubscribe'),
  entry('GET', '/live/{connection_id}/stream', { ws: true }),
  entry('GET', '/outbox/{connection_id}'),
  entry('POST', '/ephemeral/collections/ensure'),
  entry('POST', '/ephemeral/publish'),
  entry('POST', '/ephemeral/subscribe'),
  entry('POST', '/ephemeral/delete'),
  // Asset upload sessions and delivery (LLP 0044; LLP 0031 dated amendment
  // 2026-07-31): the whole root-level `/assets/*` family is AppData in
  // `core_route_registrations()` — creation admits through the generated
  // intent's authorizer, attempt/TUS operations are authority-bound, and
  // every delivery lane re-authorizes (or carries the whole authority in
  // the URL for the signed/public pasteable lanes). No system or admin
  // authority rides these routes, so the relay forwards them all.
  entry('POST', '/assets/attempts'),
  entry('GET', '/assets/attempts/{id}'),
  entry('POST', '/assets/attempts/{id}/cancel'),
  entry('POST', '/assets/attempts/{id}/finalize'),
  entry('HEAD', '/assets/tus/{id}'),
  entry('PATCH', '/assets/tus/{id}'),
  entry('DELETE', '/assets/tus/{id}'),
  entry('GET', '/assets/records/{id}'),
  entry('DELETE', '/assets/records/{id}'),
  entry('GET', '/assets/records/{id}/bytes/{variant}'),
  entry('POST', '/assets/records/{id}/signed-url'),
  entry('GET', '/assets/signed/{id}/{variant}'),
  entry('GET', '/assets/public/{id}/{variant}'),
]);

const compiled = APP_ROUTE_ALLOWLIST.map((route) => ({
  route,
  segments: route.path === '/' ? [''] : route.path.slice(1).split('/'),
}));

/**
 * Match one already-normalized request path (no query string, dot-segments
 * resolved by the caller) against the allowlist. Template segments such as
 * `{name}` match exactly one non-empty path segment; nothing matches across
 * a `/`, so a coarse prefix can never re-admit a system sibling.
 */
export function matchAppRoute(method, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.includes('\0')) {
    return { allowed: false };
  }
  const requestSegments = pathname === '/' ? [''] : pathname.slice(1).split('/');
  const upperMethod = String(method ?? '').toUpperCase();
  for (const { route, segments } of compiled) {
    if (route.method !== upperMethod) continue;
    if (segments.length !== requestSegments.length) continue;
    let matched = true;
    for (let index = 0; index < segments.length; index += 1) {
      const template = segments[index];
      const actual = requestSegments[index];
      if (template.startsWith('{') && template.endsWith('}')) {
        if (actual.length === 0) {
          matched = false;
          break;
        }
        continue;
      }
      if (template !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { allowed: true, route };
  }
  return { allowed: false };
}
