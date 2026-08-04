// Type declarations for rqs-preload.mjs — Channel A boot-payload consumption
// (LLP 0090 D2) and the register-mode registry (LLP 0090 D4).

import type {
  RqsMixedRegisteredRegistry,
  RqsRegisteredRegistry,
} from './index.mjs';

export const RQS_BOOT_ELEMENT_ID: string;

/** The embedded boot payload as parsed from the non-executable
 * `<script type="application/json">` data block. */
export interface RqsBootPayload {
  readonly route?: string;
  readonly generation?: string;
  readonly versionStream?: string;
  readonly entries?: readonly Readonly<{
    function?: string;
    args?: Readonly<Record<string, unknown>>;
    rows?: readonly unknown[];
    resume?: Readonly<{ token?: string; meta?: unknown }> | null;
  }>[];
}

/** Minimal structural document handle so this declaration does not require
 * the DOM lib; pass the real `document` in browsers. */
export interface RqsBootDocument {
  getElementById(elementId: string): { textContent: string | null } | null;
}

/** Read and parse the embedded boot payload; null when absent or
 * unparsable (degraded pageloads simply have no payload). */
export function readInlineBootPayload(options?: {
  readonly document?: RqsBootDocument | null;
  readonly elementId?: string;
}): RqsBootPayload | null;

/** One preloadable entry: rows plus the server-minted resume proof. */
export interface RqsPreloadEntry {
  rows: unknown[];
  resume: Readonly<{ token: string; meta: unknown }> & Readonly<Record<string, unknown>>;
}

export interface RqsPreloadRegistry {
  readonly route: string | null;
  readonly generation: string | null;
  readonly versionStream: string | null;
  readonly size: number;
  lookup(name: string, args?: unknown): RqsPreloadEntry | null;
  /** One-shot: a store is seeded exactly once per pageload. */
  consume(name: string, args?: unknown): RqsPreloadEntry | null;
}

/** Build the preload registry from a boot payload; only entries carrying a
 * server-minted `resume` token enter the registry. */
export function createRqsPreloadRegistry(
  payload: RqsBootPayload | null | undefined,
): RqsPreloadRegistry;

/** Convenience boot helper: read the document payload and return the
 * registry (empty when no payload is embedded). */
export function readRqsPreloadRegistry(options?: {
  readonly document?: RqsBootDocument | null;
  readonly elementId?: string;
}): RqsPreloadRegistry;

/** Build a registered-boot registry from a register-mode bundle response
 * (LLP 0090 D4; contract LLP 0092 §0D.1). */
export function createRqsRegisteredRegistry(bundle: unknown): RqsRegisteredRegistry;
export function createRqsRegisteredRegistry(
  bundle: unknown,
  reference: Readonly<Record<string, unknown>>,
  params?: Readonly<Record<string, string>>,
): RqsMixedRegisteredRegistry;
export type {
  RqsMixedBootEntry,
  RqsMixedReadOnlyResult,
  RqsMixedRegisteredRegistry,
  RqsMixedRegisteredSubscription,
  RqsRegisteredRegistry,
  RqsRegisteredSubscription,
} from './index.mjs';
