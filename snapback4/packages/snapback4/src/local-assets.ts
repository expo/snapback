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
interface Home { table: string; row: string; column: string; generation: number; expiresAt: number | null; type: string }
interface Entry { id: string; home: Home; bytes: number; used: number }
const identity = (home: Home) => JSON.stringify([home.table, home.row, home.column, home.generation]);
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
  private async home(id: string): Promise<Home | null> {
    return await this.call({ op: "asset_home", id, viewer: this.viewer, now: this.now() }) as Home | null;
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
  private async check() {
    let changed = false;
    for (const entry of this.entries.values()) {
      const home = this.options.keep === "viewed" ? await this.home(entry.id) : null;
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
  reconcile() { return this.serial(() => this.check()); }
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
    // The server's once flag is authoritative even when our schema is stale.
    if (response.headers.get("accept-ranges") === "none") return this.invalidate(id);
    if (response.status !== 200 || response.headers.get("accept-ranges") !== "bytes" || this.options.keep !== "viewed" || blob.size > this.options.maxBytes) return Promise.resolve();
    return this.serial(async () => {
      if (this.stopped) return;
      const home = await this.home(id);
      if (!home) { await this.drop(id); await this.save(); return; }
      const bytes = new Uint8Array(await blobArrayBuffer(blob));
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const entry = { id, home: { ...home, type: blob.type }, bytes: blob.size, used: this.now() };
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
