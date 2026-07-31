// Type declarations for channel-a.mjs — the Channel A serving seam, a
// composable Vite plugin for the local-arm inlined web boot (LLP 0090 D2,
// contract LLP 0092 §0E.3–§0E.5).

export {
  SNAPBACK_BOOT_ELEMENT_ID,
  entryIsPublicInline,
  injectBootPayload,
  matchManifestRoute,
} from './channel-a-core.mjs';
export type {
  ChannelAFunctionsManifest,
  ChannelARouteEntry,
  ChannelARoutesManifest,
} from './channel-a-core.mjs';

/** Pinned §0E.5 defaults (seam policy knobs). */
export const CHANNEL_A_BUDGET_MS: number;
export const CHANNEL_A_MAX_PAYLOAD_BYTES: number;
export const CHANNEL_A_ANONYMOUS_RATE_PER_MINUTE: number;

export type ChannelAEvent =
  | Readonly<{ kind: 'inlined'; route: string; ms: number; bytes: number }>
  | Readonly<{ kind: 'degraded'; code: string; route: string }>;

export interface SnapbackChannelAOptions {
  /** Required: the local Snapback backend origin the seam itself calls
   * (never exposed to the HTML). */
  origin: string;
  routesManifest?: import('./channel-a-core.mjs').ChannelARoutesManifest | null;
  routesManifestPath?: string | null;
  functionsManifest?: import('./channel-a-core.mjs').ChannelAFunctionsManifest | null;
  functionsManifestPath?: string | null;
  budgetMs?: number;
  maxPayloadBytes?: number;
  ratePerMinute?: number;
  /** Observability hook; degrade counters key on the causing code. */
  onEvent?: ((event: ChannelAEvent) => void) | null;
}

// Deliberately structural (the same rule as index.d.mts's snapbackDev):
// @snapback/vite supports multiple Vite majors and must not leak the package
// build's peer copy into an application's config type graph.
export function snapbackChannelA(options: SnapbackChannelAOptions): {
  readonly name: 'snapback-channel-a';
  readonly api: {
    channelAState(): { degradeCounters: Record<string, number> };
  };
  readonly [hook: string]: any;
};
export default snapbackChannelA;
