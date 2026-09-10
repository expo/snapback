import type { OfflineClientOptions, RangeStoreFactory, SnapbackClient } from "./client";

/** Read bytes relative to the authored journey file, including from its compiled copy. */
export declare function fixture(name: string): Promise<Uint8Array<ArrayBuffer>>;

export declare function fileRangeStore(root: string, options?: {
  beforeRename?: (temporaryPath: string, finalPath: string) => void | Promise<void>;
}): RangeStoreFactory;

/** A journey client plus the two transport primitives LLP 1012 §10 names. */
export type JourneyDevice = Omit<SnapbackClient, "restart"> & {
  /** Close and reopen this logical device on the same durable partition; a cut device boots cut. */
  restart(): Promise<JourneyDevice>;
  /**
   * The next request to `path` reaches the owner, then its response is
   * replaced by `status` (a 503 after a commit); the owner is untouched.
   */
  failNextResponse(path: string, status: number): void;
  /** Awaits replay; { stopped: "fence" } means the queue still waits for resume. */
  settled(): ReturnType<SnapbackClient["outbox"]["settled"]>;
};

export type EffectRow = {
  id: string;
  seq: number;
  effect: string;
  state: "queued" | "running" | "then_pending" | "sent" | "failed" | "sent_unknown";
  attempts: number;
  nextAt: number;
  lastError: string | null;
  result: unknown;
  resultCapped?: { bytes: number; limit: number };
  then?: { op: string; state: "committed" | "rejected"; seq?: number; code?: string };
};
export type EffectsPage = { rows: EffectRow[]; after: string | null };
export type EffectsSettlement = {
  settled: boolean;
  rows: EffectRow[];
  remaining: { id: string; reason: "backoff" | "then_pending" | "running" | "engine:none" | "budget"; nextAt?: number }[];
};
export type JourneyEffects = {
  rows(options?: { state?: EffectRow["state"]; after?: string; limit?: number }): Promise<EffectsPage>;
  settle(options?: { upTo?: number; budgetMs?: number }): Promise<EffectsSettlement>;
};

export declare function journey(name: string, body: (context: {
  effects: JourneyEffects;
  as(name: string, options?: {
    store?: "file";
  }): JourneyDevice;
  tick(ms: number): Promise<Record<string, unknown>>;
  url: string;
}) => void | Promise<void>): void;
