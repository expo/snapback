import type { RqsRegisteredRegistry } from './index.mjs';

export const RQS_BOOT_ELEMENT_ID: string;

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

export interface RqsBootDocument {
  getElementById(elementId: string): { textContent: string | null } | null;
}

export function readInlineBootPayload(options?: {
  readonly document?: RqsBootDocument | null;
  readonly elementId?: string;
}): RqsBootPayload | null;

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
  consume(name: string, args?: unknown): RqsPreloadEntry | null;
}

export function createRqsPreloadRegistry(
  payload: RqsBootPayload | null | undefined,
): RqsPreloadRegistry;

export function readRqsPreloadRegistry(options?: {
  readonly document?: RqsBootDocument | null;
  readonly elementId?: string;
}): RqsPreloadRegistry;

export function createRqsRegisteredRegistry(bundle: unknown): RqsRegisteredRegistry;
export type { RqsRegisteredRegistry, RqsRegisteredSubscription } from './index.mjs';
