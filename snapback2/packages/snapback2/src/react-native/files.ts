// @ref LLP 1013#2-decisions — native files are derivatives; permission is always the cache's.
import type { AssetCache, ByteCache, ByteDelta } from "../store/byte-cache.js";
import { ASSET_ID, assetIdsIn, byteKey } from "../store/byte-cache.js";
import type { PersistedRangeState, RangeStore, RangeStoreBackend } from "../store/range-store.js";
import type { SnapbackClient } from "../types.js";

export interface NativeFileSystem {
  readonly root: string;
  list(directory: string): Promise<string[]>;
  exists?(uri: string): Promise<boolean>;
  write(uri: string, bytes: Uint8Array): Promise<void>;
  remove(uri: string): Promise<void>;
}
const FILES = Symbol.for("snapback2.native.assetFiles");
type FileStore = RangeStore & { [FILES]?: NativeAssetFiles };
const mediaSuffix = (type: string): string => {
  switch (type.split(";", 1)[0]!.trim().toLowerCase()) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "video/mp4": return ".mp4";
    case "video/quicktime": return ".mov";
    default: return "";
  }
};

export function attachAssetFiles(store: RangeStore, files: NativeAssetFiles): void {
  Object.defineProperty(store, FILES, { value: files });
}
export function nativeAssetFiles(client: SnapbackClient): NativeAssetFiles | undefined {
  return ((client.assetCache as ByteCache | undefined)?.store as FileStore | undefined)?.[FILES];
}

/** Encoded even for adversarial principal strings; no partition can escape its directory. */
export function partitionDirectory(root: string, partition: string): string {
  return `${root.replace(/\/$/, "")}/${encodeURIComponent(partition).replace(/\./g, "%2E")}/`;
}

export class NativeAssetFiles {
  private partition?: string;
  private state?: PersistedRangeState;
  private revision = 0;
  private custody = 0;
  private readonly assetRevisions = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly materialized = new Set<string>();
  // Serialize file writes and removals; a late write cannot resurrect an evicted file.
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly fs: NativeFileSystem) {}
  getRevision = (): number => this.revision;
  getAssetRevision = (id: string): string => `${this.custody}:${this.assetRevisions.get(id) ?? 0}`;
  getCustody = (): number => this.custody;
  available = (): boolean => this.partition !== undefined && !this.state?.sealed;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private changed(custody = false): void {
    this.revision++;
    if (custody) this.custody++;
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Observers cannot undo a committed carrier swap. */ }
    }
  }
  private enqueue<T>(body: () => Promise<T>): Promise<T> {
    const result = this.tail.then(body);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private remove(uri: string): Promise<void> {
    this.materialized.delete(uri);
    // A failed derivative delete must not turn an already committed SQLite swap
    // into a failed swap. It remains garbage, refused below and swept next open.
    return this.fs.remove(uri).catch(() => undefined);
  }
  private path(key: string, partition = this.partition): string | undefined {
    return partition === undefined ? undefined : partitionDirectory(this.fs.root, partition) + key;
  }
  private eligible(assetId: string, width: number | null): boolean {
    return this.partition !== undefined && !this.state?.sealed && this.state?.assets[byteKey(assetId, width)] !== undefined;
  }

  async get(cache: AssetCache, assetId: string, width: number | null): Promise<string | undefined> {
    if (!ASSET_ID.test(assetId)) return undefined;
    if (width !== null && (!Number.isSafeInteger(width) || width <= 0)) throw new TypeError("asset width must be a positive integer");
    const partition = this.partition;
    if (partition === undefined) return undefined;
    const revision = this.getAssetRevision(assetId);
    // The carrier read checks seal, lease, viewed set, payload existence and length.
    const once = await cache.viewOnce(assetId) || await cache.viewed(assetId);
    const held = once ? undefined : await cache.getBytes(assetId, width);
    if (revision !== this.getAssetRevision(assetId)) return undefined;
    const key = byteKey(assetId, width);
    const uri = this.path(key + mediaSuffix(held?.type ?? this.state?.assets[key]?.type ?? ""), partition)!;
    return this.enqueue(async () => {
      // Recheck after acquiring the queue: viewed custody can move while a
      // preceding materialization holds it, even without a byte delta.
      if (revision !== this.getAssetRevision(assetId)) return undefined;
      const refused = !held || !this.eligible(assetId, width)
        || await cache.viewOnce(assetId) || await cache.viewed(assetId);
      if (revision !== this.getAssetRevision(assetId)) return undefined;
      if (refused) {
        await this.remove(uri);
        return undefined;
      }
      if (!this.materialized.has(uri) || !await this.fs.exists?.(uri)) await this.fs.write(uri, held.bytes);
      if (revision !== this.getAssetRevision(assetId) || !this.eligible(assetId, width)
        || await cache.viewOnce(assetId) || await cache.viewed(assetId)) {
        await this.remove(uri);
        return undefined;
      }
      this.materialized.add(uri);
      return uri;
    });
  }

  /** Only backend success is a commit notification; never call this from beforeCommit. */
  async opened(partition: string, state: PersistedRangeState | undefined): Promise<void> {
    this.materialized.clear();
    this.partition = partition;
    this.state = state;
    this.changed(true);
    const directory = partitionDirectory(this.fs.root, partition);
    await this.enqueue(async () => {
      const expected = new Set(Object.entries(state?.assets ?? {})
        .map(([key, entry]) => key + mediaSuffix(entry.type)));
      for (const name of await this.fs.list(directory)) {
        if (!expected.has(name)) await this.remove(directory + name);
      }
    });
  }
  async replaced(state: PersistedRangeState, bytes: ByteDelta): Promise<void> {
    const previous = this.state;
    const sealed = this.state?.sealed !== state.sealed;
    const before = assetLeases(this.state), after = assetLeases(state);
    const changed = new Set([...before.keys(), ...after.keys()].filter((id) => before.get(id) !== after.get(id)));
    for (const key of [...bytes.remove, ...bytes.put.map((put) => put.key)]) changed.add(key.split(".w")[0]);
    for (const id of changed) this.assetRevisions.set(id, (this.assetRevisions.get(id) ?? 0) + 1);
    this.state = state;
    this.changed(sealed);
    const partition = this.partition;
    // A queued get rechecks the carrier, whose swap is awaiting this notification.
    // Publish custody now; cleanup follows asynchronously, never holding that swap.
    void this.enqueue(async () => {
      for (const key of [...bytes.remove, ...bytes.put.map((put) => put.key)]) {
        const suffixes = new Set(["", mediaSuffix(previous?.assets[key]?.type ?? ""), mediaSuffix(state.assets[key]?.type ?? "")]);
        for (const suffix of suffixes) {
          const uri = this.path(key + suffix, partition);
          if (uri) await this.remove(uri);
        }
      }
    }).catch(() => undefined);
  }
  async wiped(partition: string): Promise<void> {
    if (this.partition === partition) this.closed();
    await this.enqueue(() => this.remove(partitionDirectory(this.fs.root, partition)));
  }
  closed(): void {
    this.materialized.clear();
    this.partition = undefined;
    this.state = undefined;
    this.changed(true);
  }
}

/** A message/grant/watermark swap that leaves a clip's lease unchanged keeps its player. */
function assetLeases(state: PersistedRangeState | undefined): Map<string, string> {
  const refs = new Map<string, string[]>();
  for (const [key, row] of Object.entries(state?.rows ?? {})) {
    for (const id of assetIdsIn(row.row)) {
      const leases = refs.get(id) ?? [];
      leases.push(JSON.stringify([key, row.row, Boolean(state?.viewed[key])]));
      refs.set(id, leases);
    }
  }
  return new Map([...refs].map(([id, leases]) => [id, leases.sort().join("\n")]));
}

export function fileBackend(backend: RangeStoreBackend, files: NativeAssetFiles): RangeStoreBackend {
  return {
    carrier: backend.carrier,
    async open(partition) {
      const state = await backend.open(partition);
      // Sweep errors leave unusable derivatives, never a substituted memory carrier.
      try { await files.opened(partition, state); }
      catch (error) { files.closed(); await backend.close(); throw error; }
      return state;
    },
    async replace(state, bytes) {
      await backend.replace(state, bytes);
      await files.replaced(state, bytes);
    },
    readBytes: backend.readBytes ? (key) => backend.readBytes!(key) : undefined,
    async wipe(partition) {
      await backend.wipe(partition); // Wiping the open partition also closes SQLite.
      await files.wiped(partition);
    },
    async close() {
      files.closed();
      await backend.close();
    },
  };
}
