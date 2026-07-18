// Hand-written ambient types for the shared demo kit (`demos/_kit/client.mjs`)
// and the generated API artifact (`snapback/generated/api.mjs`), which ship as
// untyped ESM. The Contract arm gets typed descriptors from codegen
// (`generated/contract/*.ts`); the React arm types the same seams by hand —
// recorded as part of the hand-wiring cost (ENG-22531).

declare module '*/_kit/client.mjs' {
  export interface EphemeralEntrySnapshot {
    key: string;
    value: unknown;
    expiresAtMs: number;
    receivedAtMs: number;
    scopeEpoch: number;
    entryVersion: number;
  }

  export interface EphemeralOverlay {
    entries: Map<string, unknown>;
    /** Opaque wire id used as the key for connection-owned entries. */
    readonly grantedConnectionId: string;
    publish(
      value: unknown,
      options?: { ttlMs?: number | null },
    ): Promise<{ entry_version: number; scope_epoch: number; key: string }>;
    onChange(listener: (result: string, overlay: EphemeralOverlay) => void): () => void;
    currentEntries(options?: { prune?: boolean }): EphemeralEntrySnapshot[];
    dispose(): void;
  }

  export interface LiveStreamManager {
    isOpen(): boolean;
    onState(listener: (state: string, detail?: { wasOpen?: boolean }) => void): () => void;
  }

  export interface KitReceipt {
    kind: string;
    [key: string]: unknown;
  }

  export class SnapbackClient {
    constructor(baseUrl: string);
    health(): Promise<{ ok: boolean }>;
    loadSchema(manifest: unknown): Promise<unknown>;
    ensureEphemeralCollections(manifest: unknown): Promise<unknown>;
    ensureApp(input: { schema?: unknown; functions?: unknown; seed?: unknown }): Promise<unknown>;
    subscribeEphemeral(
      ref: unknown,
      options: {
        connectionId: string;
        scope?: Record<string, unknown>;
        userId?: string;
        permissions?: string[];
      },
    ): Promise<EphemeralOverlay>;
    liveStreamManager(connectionId: string): LiveStreamManager;
    receipts(): KitReceipt[];
  }
}

declare module '*/generated/api.mjs' {
  export interface EphemeralCollectionRef {
    artifactKind: 'ephemeralCollectionReference';
    name: string;
    keyMode: 'Connection' | 'Session' | 'User' | 'Custom';
    scopeFields: readonly string[];
    routingFields: readonly string[];
    defaultTtlMs: number;
    maxTtlMs: number;
    maxValueBytes: number;
  }
  export const ephemeral: { webCursors: EphemeralCollectionRef };
  const api: { ephemeral: { webCursors: EphemeralCollectionRef } };
  export default api;
}
