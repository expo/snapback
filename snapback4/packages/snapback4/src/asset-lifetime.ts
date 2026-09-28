import { deliverReadNotifications } from "./read-notifications.ts";
import type { AssetRead, Refusal } from "./contract.ts";

const evidence = new WeakMap<object, { seq?: number; nextExpiry?: number | null; id?: string }>();
export function assetEvidence(read: AssetRead, value: { seq?: number; nextExpiry?: number | null }): AssetRead { evidence.set(read, value); return read; }
const listeners = new WeakMap<object, Set<() => void>>();
const revoked = new WeakSet<object>();
export function assetRevoked(read: AssetRead): boolean { if ("url" in read) void read.url; return revoked.has(read); }
export function onAssetRevoked(read: AssetRead, listener: () => void): () => void {
  let group = listeners.get(read);
  if (!group) listeners.set(read, group = new Set());
  group.add(listener);
  return () => { group.delete(listener); };
}
export const assetInvalidated: Refusal = { code: "E_ASSET_UNKNOWN", family: "asset", message: "the asset's authority changed; open it again from a current readable row" };

// @ref LLP 3000.029#4 — invalidate owned URLs and in-flight acquisitions together.
// A scope owns a bounded set of currently displayed handles, never asset bytes.
export class AssetLifetime {
  revision = 0;
  private lastScopeReset = 0;
  private lastChange = 0;
  private readonly refusals = new Map<string, number>();
  private handles = new Map<() => () => void, { seq?: number; nextExpiry?: number | null; id?: string }>();
  constructor(private now?: () => number) {}
  get size(): number { return this.handles.size; }
  invalidate(seq?: number): void {
    this.revision++;
    if (seq === undefined) { this.lastScopeReset = this.revision; this.lastChange = 0; }
    else this.lastChange = Math.max(this.lastChange, seq);
    const notify = [...this.handles].filter(([, meta]) => seq === undefined || meta.seq === undefined || seq > meta.seq).map(([revoke]) => revoke());
    // Every URL is gone before any application callback can inspect a peer.
    deliverReadNotifications(notify);
  }
  check(): void {
    if (!this.now) return;
    const now = this.now();
    const notify = [...this.handles].filter(([, meta]) => meta.nextExpiry != null && now >= meta.nextExpiry).map(([revoke]) => revoke());
    deliverReadNotifications(notify);
  }
  own(read: AssetRead, revision = this.revision, id?: string): AssetRead {
    if (!("url" in read)) {
      if (id && "denied" in read && read.denied.code === "E_ASSET_UNKNOWN") {
        this.refusals.set(id, ++this.revision);
        const notify = [...this.handles].filter(([, meta]) => meta.id === id).map(([revoke]) => revoke());
        deliverReadNotifications(notify);
      }
      return read;
    }
    const meta = evidence.get(read) ?? {};
    const obsolete = revision !== this.revision && (revision < this.lastScopeReset || meta.seq === undefined || meta.seq < this.lastChange);
    if (obsolete || (id !== undefined && revision < (this.refusals.get(id) ?? 0)) || assetRevoked(read)) { read.revoke(); return { denied: assetInvalidated }; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => this.check();
    const result: AssetRead = {
      get url() { check(); return revoked.has(result) ? "" : read.url; }, type: read.type, bytes: read.bytes,
      revoke: () => { withdraw()(); },
    };
    const withdraw = () => {
      if (revoked.has(result)) return () => {};
      revoked.add(result); this.handles.delete(withdraw);
      clearTimeout(timer); stop(); read.revoke();
      return () => { for (const listener of listeners.get(result) ?? []) { try { listener(); } catch (error) { console.error("snapback4 asset listener:", error); } } };
    };
    this.handles.set(withdraw, { ...meta, ...(id ? { id } : {}) });
    const stop = onAssetRevoked(read, () => withdraw()());
    const arm = () => {
      if (!this.now || meta.nextExpiry == null || revoked.has(result)) return;
      check();
      if (!revoked.has(result)) {
        timer = setTimeout(arm, Math.min(2_147_483_647, Math.max(1, meta.nextExpiry - this.now())));
        (timer as { unref?: () => void }).unref?.();
      }
    };
    arm();
    return assetEvidence(result, meta);
  }
}
