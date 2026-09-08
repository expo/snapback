import type { OfflineClientOptions, RangeStoreFactory, SnapbackClient } from "./client";

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

export declare function journey(name: string, body: (context: {
  as(name: string, options?: {
    store?: "file";
  }): JourneyDevice;
  tick(ms: number): Promise<Record<string, unknown>>;
  url: string;
}) => void | Promise<void>): void;
