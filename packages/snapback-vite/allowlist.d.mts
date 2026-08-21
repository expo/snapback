// Type declarations for allowlist.mjs — the default app-route allowlist for
// the /__snapback relay (LLP 0030 proxy surface / LLP 0031 route classes).

export interface AppRouteAllowlistEntry {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly ws: boolean;
  readonly retrySafe: boolean;
}

export const APP_ROUTE_ALLOWLIST: readonly AppRouteAllowlistEntry[];

/** Match one already-normalized request path (no query string, dot-segments
 * resolved by the caller) against the allowlist. Template segments such as
 * `{name}` match exactly one non-empty path segment. */
export function matchAppRoute(
  method: string,
  pathname: string,
): { allowed: false; route?: never } | { allowed: true; route: AppRouteAllowlistEntry };
