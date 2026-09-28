import { deliverReadNotifications } from "./read-notifications.ts";
import type { AssetRead, Refusal } from "./contract.ts";

type AssetOrder = { seq?: number | undefined; ticket: number };
const assetOrderAtLeast = (next: AssetOrder, prior: AssetOrder): boolean => next.seq !== undefined && prior.seq !== undefined && next.seq !== prior.seq ? next.seq > prior.seq : next.ticket >= prior.ticket;
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
  private lastChangeRevision = 0;
  private tickets = 0;
  begin(): number { return ++this.tickets; }
  private readonly refusals = new Map<string, AssetOrder>();
  private readonly grants = new Map<string, AssetOrder>();
  permits(id: string, seq: number | undefined, ticket: number, revision: number): boolean {
    const order = { seq, ticket }, refusal = this.refusals.get(id);
    if (revision < this.lastScopeReset || (seq === undefined ? revision < this.lastChangeRevision : seq < this.lastChange)) return false;
    // @ref LLP 3000.029#8 — an older in-flight grant cannot cross this asset's refusal.
    if (refusal && !assetOrderAtLeast(order, refusal)) return false;
    return true;
  }
  current(id: string, read: AssetRead, ticket: number): boolean {
    const order = { seq: evidence.get(read)?.seq, ticket }, grant = this.grants.get(id), refusal = this.refusals.get(id);
    return (!grant || assetOrderAtLeast(order, grant)) && (!refusal || assetOrderAtLeast(order, refusal));
  }
  grant(id: string, seq: number | undefined, ticket: number, revision: number): boolean {
    if (!this.permits(id, seq, ticket, revision)) return false;
    const order = { seq, ticket }, prior = this.grants.get(id);
    if (!prior || assetOrderAtLeast(order, prior)) this.grants.set(id, order);
    return true;
  }
  private handles = new Map<() => () => void, { seq?: number; nextExpiry?: number | null; id?: string; ticket: number }>();
  constructor(private now?: () => number) {}
  get size(): number { return this.handles.size; }
  invalidate(seq?: number): void {
    this.revision++;
    if (seq === undefined) { this.lastScopeReset = this.revision; this.lastChange = 0; this.refusals.clear(); this.grants.clear(); }
    else { this.lastChange = Math.max(this.lastChange, seq); this.lastChangeRevision = this.revision; }
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
  own(read: AssetRead, revision = this.revision, id?: string, ticket = this.begin()): AssetRead {
    if (!("url" in read)) {
      if (id && "denied" in read && read.denied.code === "E_ASSET_UNKNOWN" && revision >= this.lastScopeReset && this.current(id, read, ticket)) {
        const order = { seq: evidence.get(read)?.seq, ticket };
        this.revision++;
        this.refusals.set(id, order);
        const notify = [...this.handles].filter(([, meta]) => meta.id === id && assetOrderAtLeast(order, { seq: meta.seq, ticket: meta.ticket })).map(([revoke]) => revoke());
        deliverReadNotifications(notify);
      }
      return read;
    }
    const meta = evidence.get(read) ?? {};
    const obsolete = revision !== this.revision && (revision < this.lastScopeReset || (meta.seq === undefined ? revision < this.lastChangeRevision : meta.seq < this.lastChange));
    if (obsolete || (id !== undefined && !this.grant(id, meta.seq, ticket, revision)) || assetRevoked(read)) { read.revoke(); return { denied: assetInvalidated }; }
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
    this.handles.set(withdraw, { ...meta, ticket, ...(id ? { id } : {}) });
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
