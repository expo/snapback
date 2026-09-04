import type { OfflineClientOptions, RangeStoreFactory, SnapbackClient } from "./client";

export declare function fileRangeStore(root: string, options?: {
  beforeRename?: (temporaryPath: string, finalPath: string) => void | Promise<void>;
}): RangeStoreFactory;

export declare function journey(name: string, body: (context: {
  as(name: string, options?: {
    store?: "file";
    onTombstone?: OfflineClientOptions["onTombstone"];
  }): SnapbackClient;
  tick(ms: number): Promise<Record<string, unknown>>;
  url: string;
}) => void | Promise<void>): void;
