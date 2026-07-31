// Type declarations for channel-a-core.mjs — Channel A pure helpers shared
// across serving seams (LLP 0092 §0E.3); dependency-free and
// platform-neutral so the Cloudflare gateway bundles the same logic.

export const SNAPBACK_BOOT_ELEMENT_ID: string;

/** One route entry from the generated routes manifest. */
export interface ChannelARouteEntry {
  readonly route: string;
  readonly queries?: readonly Readonly<{
    function: string;
    [key: string]: unknown;
  }>[];
  readonly [key: string]: unknown;
}

export interface ChannelARoutesManifest {
  readonly routes: readonly ChannelARouteEntry[];
  readonly [key: string]: unknown;
}

export interface ChannelAFunctionsManifest {
  readonly functions?: readonly Readonly<{
    name?: string;
    publicInline?: boolean;
    [key: string]: unknown;
  }>[];
  readonly [key: string]: unknown;
}

/** Match a request path (pre-SPA-fallback, base stripped, percent-decoded
 * per segment) against the manifest's exact patterns; null when unmatched. */
export function matchManifestRoute(
  routesManifest: ChannelARoutesManifest | null | undefined,
  rawUrl: string,
  base?: string,
): { route: string; params: Record<string, string>; entry: ChannelARouteEntry } | null;

/** True when every query the matched entry names carries the compiled
 * `publicInline` fact in the served functions manifest. */
export function entryIsPublicInline(
  functionsManifest: ChannelAFunctionsManifest | null | undefined,
  entry: ChannelARouteEntry | null | undefined,
): boolean;

/** Inject the serialized boot payload as a non-executable JSON data block
 * (before `</head>`, else before `</body>`, else appended). */
export function injectBootPayload(html: string, serializedPayload: string): string;
