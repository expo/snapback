// @ref LLP 3000.007#8 — ordinary viewed media belongs to its current home row
import type { AssetRead } from "./contract.ts";
import type { DeviceCore } from "./local.ts";
import { blobArrayBuffer } from "./assets.ts";
import { clockDelay } from "./clock.ts";

/** A host's private byte storage. Hex crosses the native JSON bridge; native
 * hosts may also serve a file URI. The client has no dependency on Expo. */
export interface MediaStorage {
  read(id: string): Promise<string | null>;
  write(id: string, hex: string): Promise<void>;
  remove(id: string): Promise<void>;
  uri?(id: string): string;
}
export interface AssetRetention {
  readonly keep: "viewed" | "none";
  /** Nonnegative safe integer byte budget (zero retains no bytes). */
  readonly maxBytes: number;
}
export function assetRetention(options?: AssetRetention): AssetRetention {
  const { keep, maxBytes } = options ?? { keep: "none", maxBytes: 0 };
  if (!["none", "viewed"].includes(keep) || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error("assets needs keep: viewed | none and a nonnegative safe integer maxBytes");
  }
  return { keep, maxBytes };
}
// @ref LLP 3000.019#3.5 — a same-store observation changes only sync metadata.
// Publication, replacement, predictions and expiry still recheck media.
export function changesMediaAuthority(op: string, result: unknown): boolean {
  return op !== "observe_store" || (result as { reset?: boolean } | undefined)?.reset !== false;
}
interface Home { store_id: string; table: string; row: string; column: string; generation: number; expiresAt: number | null; type: string; tables?: string[] }
interface Entry { confirmed?: true; id: string; home: Home; bytes: number; used: number }
const identity = (home: Home) => JSON.stringify([home.store_id, home.table, home.row, home.column, home.generation]);
const absent = (): AssetRead => ({ denied: { code: "E_OFFLINE", family: "link", message: "no retained ordinary media is available offline", retryable: true } });

export class MediaCache {
  private entries = new Map<string, Entry>();
  private live = new Map<string, Set<() => void>>();
  private tail: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private store: MediaStorage;
  constructor(private core: DeviceCore, private viewer: string, private options: AssetRetention, private now: () => number = Date.now) {
    this.store = core.media ?? {
      read: async (id) => (await this.call({ op: "meta", key: `media:bytes:${id}` })) as string | null,
      write: async (id, hex) => { await this.call({ op: "set_meta", key: `media:bytes:${id}`, value: hex }); },
      remove: async (id) => { await this.call({ op: "set_meta", key: `media:bytes:${id}`, value: "" }); },
    };
  }
  private async call(request: Record<string, unknown>): Promise<unknown> {
    const reply = await this.core.call(request);
    if (reply.denied) throw new Error(JSON.stringify(reply.denied));
    return reply.ok;
  }
  private serial<T>(body: () => Promise<T>): Promise<T> {
    const result = this.tail.then(body);
    this.tail = result.catch(() => {});
    return result;
  }
  async open() {
    const manifest = await this.call({ op: "meta", key: "media:manifest" });
    if (typeof manifest === "string" && manifest) {
      for (const entry of JSON.parse(manifest) as Entry[]) this.entries.set(entry.id, entry);
    }
    await this.reconcile();
  }
  private async home(id: string, home: Pick<Home, "store_id" | "table" | "row" | "column">): Promise<Home | null> {
    if (typeof home.store_id !== "string" || !home.store_id) return null;
    return await this.call({ op: "asset_home", id, home, viewer: this.viewer, now: this.now() }) as Home | null;
  }
  private async save() {
    await this.call({ op: "set_meta", key: "media:manifest", value: JSON.stringify([...this.entries.values()]) });
  }
  private async drop(id: string) {
    if (!this.entries.has(id) && !this.live.has(id)) return;
    for (const revoke of this.live.get(id) ?? []) revoke();
    this.live.delete(id);
    await this.store.remove(id);
    this.entries.delete(id);
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    const times = [...this.entries.values()].flatMap((e) => e.home.expiresAt == null ? [] : [e.home.expiresAt]);
    if (times.length) {
      this.timer = setTimeout(() => { void this.reconcile().catch(() => {}); }, Math.min(2_147_483_647, Math.max(1, clockDelay(this.now, Math.min(...times)))));
      (this.timer as { unref?: () => void }).unref?.();
    }
  }
  private async check(touched?: readonly string[]) {
    let changed = false;
    for (const entry of this.entries.values()) {
      // @ref LLP 3000.023#10 — these are the interpreter's authorization dependencies,
      // not just the media-bearing table. Unknown/legacy homes and due deadlines
      // still recheck; adoption, identity and scope resets pass no footprint.
      const tables = entry.home.tables;
      if (touched !== undefined && this.options.keep === "viewed" && entry.confirmed
        && Array.isArray(tables) && tables.includes(entry.home.table) && tables.every(table => typeof table === "string")
        && !tables.some(table => touched.includes(table))
        && (entry.home.expiresAt == null || entry.home.expiresAt > this.now())) continue;
      const home = this.options.keep === "viewed" && entry.confirmed ? await this.home(entry.id, entry.home) : null;
      if (!home || identity(home) !== identity(entry.home) || (home.expiresAt != null && home.expiresAt <= this.now())) {
        await this.drop(entry.id);
        changed = true;
      } else { entry.home = home; }
    }
    let bytes = [...this.entries.values()].reduce((sum, e) => sum + e.bytes, 0);
    for (const entry of [...this.entries.values()].sort((a, b) => a.used - b.used)) {
      if (bytes <= this.options.maxBytes) break;
      await this.drop(entry.id);
      bytes -= entry.bytes;
      changed = true;
    }
    if (changed) await this.save();
    this.schedule();
  }
  reconcile(touched?: readonly string[]) {
    const footprint = touched === undefined ? undefined : [...touched];
    return this.serial(() => this.check(footprint));
  }
  invalidate(id: string) { return this.serial(async () => { await this.drop(id); await this.save(); this.schedule(); }); }
  async clear() {
    await this.serial(async () => { for (const id of [...this.entries.keys()]) await this.drop(id); await this.save(); });
    clearTimeout(this.timer);
  }
  private result(entry: Entry, hex: string): AssetRead {
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
    const uri = this.store.uri?.(entry.id);
    const url = uri ?? URL.createObjectURL(new Blob([bytes], { type: entry.home.type }));
    const handles = this.live.get(entry.id) ?? new Set();
    this.live.set(entry.id, handles);
    const revoke = () => { if (!uri) URL.revokeObjectURL(url); handles.delete(revoke); };
    handles.add(revoke);
    return { url, type: entry.home.type, bytes: entry.bytes, revoke };
  }
  read(id: string): Promise<AssetRead> {
    return this.serial(async () => {
      await this.check();
      const entry = this.entries.get(id);
      if (!entry || this.stopped) return absent();
      const hex = await this.store.read(id);
      if (!hex || hex.length !== entry.bytes * 2) { await this.drop(id); await this.save(); return absent(); }
      entry.used = this.now();
      await this.save();
      return this.result(entry, hex);
    });
  }
  viewed(id: string, blob: Blob, response: Response): Promise<AssetRead | void> {
    // @ref LLP 3000.019#3.5 — copied facts and synced references prove no placement.
    let receipt: Pick<Home, "store_id" | "table" | "row" | "column"> | undefined;
    try {
      const value = JSON.parse(decodeURIComponent(response.headers.get("x-snapback-asset-home") ?? ""));
      if (value && typeof value.store_id === "string" && value.store_id && [value.table, value.row, value.column].every(v => typeof v === "string")) receipt = value;
    } catch { /* Older servers and upload previews have no retainable home. */ }
    // The current store's once flag is authoritative even when our schema is stale.
    if (response.headers.get("accept-ranges") === "none") return this.serial(async () => {
      if (this.stopped) return;
      // Check after earlier cache operations: an old store cannot revoke a new store's entry.
      const entry = this.entries.get(id);
      if (entry?.confirmed && receipt && entry.home.store_id !== receipt.store_id) return;
      await this.drop(id); await this.save(); this.schedule();
    });
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
    const complete = response.status === 200 || response.status === 206 && range && Number(range[1]) + 1 === Number(range[2]) && Number(range[2]) === blob.size;
    if (!complete || response.headers.get("accept-ranges") !== "bytes" || this.options.keep !== "viewed" || blob.size > this.options.maxBytes) return Promise.resolve();
    return this.serial(async () => {
      if (this.stopped) return;
      const home = receipt ? await this.home(id, receipt) : null;
      if (!home) {
        // @ref LLP 3000.019#3.5 — an old delivery cannot erase a newer store/cell's bytes or live URLs.
        const entry = this.entries.get(id);
        if (!entry?.confirmed || (receipt && entry.home.store_id === receipt.store_id && entry.home.table === receipt.table
          && entry.home.row === receipt.row && entry.home.column === receipt.column)) {
          await this.drop(id); await this.save();
        }
        return;
      }
      const bytes = new Uint8Array(await blobArrayBuffer(blob));
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const entry: Entry = { confirmed: true, id, home: { ...home, type: blob.type }, bytes: blob.size, used: this.now() };
      // Keep the manifest first so an interrupted byte write is removed on reopen.
      this.entries.set(id, entry);
      await this.save();
      await this.store.write(id, hex);
      await this.check();
      if (this.entries.has(id)) return this.result(entry, hex);
    });
  }
  async close() { this.stopped = true; clearTimeout(this.timer); await this.tail; for (const handles of this.live.values()) for (const revoke of handles) revoke(); }
}
