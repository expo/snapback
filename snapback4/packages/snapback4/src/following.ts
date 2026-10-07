import { Pages } from "./react-pages.ts";
import type { Client, Cursor, FollowingQuery, Observed, Query, Read } from "./contract.ts";
import { followingBlocked, followingRequest, onFollowingChange, type FollowingWire } from "./following-transport.ts";

export type FollowingPhase = "preparing" | "page" | "stalled" | "restart" | "refused" | "offline";
type Authority = { table: string; id: string; fields: string[] };
type Item<T> = { kind: "shaped"; id: string; value: T; authority: Authority[] } | { kind: "omitted"; id: string; code: string };
export interface FollowingSnapshot<T> {
  readonly items: readonly T[];
  readonly phase: FollowingPhase;
  readonly hasMore: boolean;
  readonly omissions: readonly { id: string; code: string }[];
  readonly fact?: "older posts are not on this device";
  readonly code?: string;
  readonly inbox?: Read<readonly T[]>;
}

// @ref LLP 3000.026#9-exact-on-demand-history-design-handoff — one subscriber
// family owns a revision, its tokens and immutable units. No inbox splice online.
export class Following<A, R extends readonly unknown[]> {
  private listeners = new Set<() => void>();
  private stops: (() => void)[] = [];
  private source: Observed<R> | undefined;
  private inbox: Pages<{ c?: Cursor | null }, R> | undefined;
  private stopInbox: (() => void) | undefined;
  private history: Item<R[number]>[] = [];
  private live: Item<R[number]>[] = [];
  private opening: string | undefined;
  private next: string | null | undefined;
  private wantPage = true;
  private withheld = true;
  private epoch = 0;
  private work = false;
  private guards: (() => boolean)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private due = Infinity;
  private withdrawal: ReturnType<typeof setTimeout> | undefined;
  private aborter = new AbortController();
  private phase: FollowingPhase = "preparing";
  private code: string | undefined;
  private snapshot: FollowingSnapshot<R[number]> = { items: [], phase: "preparing", hasMore: false, omissions: [] };
  private readonly args: A;
  constructor(private readonly client: Client, private readonly op: FollowingQuery<A, R>, args: A) {
    // @ref LLP 3000.033#1.2 — no observer or frontier custody in read-only mode.
    if (client.readOnly) this.refuseReadOnly();
    this.args = op.following.cursor ? { ...args, [op.following.cursor]: null } : args;
  }
  getSnapshot = (): FollowingSnapshot<R[number]> => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stop(); };
  };
  loadMore = (): void => {
    if (this.client.link() === "offline") { this.inbox?.loadMore(); return; }
    if (this.next && !this.wantPage && this.client.link() === "online") { this.wantPage = true; this.schedule(0); }
  };
  retry = (): void => { if (this.client.readOnly) { this.refuseReadOnly(); return; } this.code = undefined; this.phase = "preparing"; this.wantPage = this.next !== null; this.schedule(0); };
  private refuseReadOnly(): void {
    this.phase = "refused"; this.code = "E_READ_ONLY";
    this.snapshot = { items: [], phase: "refused", hasMore: false, omissions: [], code: this.code };
    for (const listener of this.listeners) listener();
  }
  private start(): void {
    if (this.client.readOnly) { this.refuseReadOnly(); return; }
    this.aborter = new AbortController();
    this.source = this.client.observe(this.op, this.args);
    this.stops.push(onFollowingChange(this.client, () => this.invalidate()), this.source.subscribe(() => this.changed()), this.client.onLink(() => this.changed()),
      this.client.onPendingWrites(() => { if (followingBlocked(this.client, this.op)) this.invalidate(); else this.schedule(0); }), this.client.onWrite(() => this.invalidate()),
      this.client.onViewer(() => this.reset()), this.client.onSession(() => this.reset()));
    this.changed();
  }
  private stop(): void {
    this.epoch++; this.aborter.abort();
    for (const stop of this.stops.splice(0)) stop();
    this.source?.close(); this.source = undefined;
    if (this.withdrawal) clearTimeout(this.withdrawal); this.withdrawal = undefined;
    this.stopInbox?.(); this.stopInbox = undefined; this.inbox = undefined;
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.opening) void followingRequest(this.client, this.op, this.args, { action: "cancel", opening: this.opening });
    this.opening = undefined; this.next = undefined; this.history = []; this.live = []; this.wantPage = true; this.withheld = true;
  }
  private reset(): void {
    this.epoch++;
    if (this.opening) void followingRequest(this.client, this.op, this.args, { action: "cancel", opening: this.opening });
    this.opening = undefined; this.next = undefined; this.history = []; this.live = []; this.wantPage = true; this.withheld = true;
    this.phase = "restart"; this.code = undefined; this.publish(); this.schedule(25);
  }
  private invalidate(): void { this.epoch++; this.withheld = true; this.publish(); this.schedule(0); }
  private changed(): void {
    if (this.client.link() === "offline" && !this.inbox) {
      const cursor = this.op.following.cursor;
      const original = this.client;
      const client: Client = { ...original, observe: (op, args, options) => {
        const input = { ...this.args, ...(cursor ? { [cursor]: (args as { c?: Cursor | null }).c } : {}) };
        return original.observe(op, input as typeof args, options);
      } };
      this.inbox = new Pages(client, this.op as Query<{ c?: Cursor | null }, R>, {});
      this.stopInbox = this.inbox.subscribe(() => this.publish());
    } else if (this.client.link() !== "offline" && this.inbox) {
      this.stopInbox?.(); this.stopInbox = undefined; this.inbox = undefined;
    }
    const read = this.source?.getSnapshot();
    if (this.client.link() !== "online") { this.epoch++; this.withheld = true; this.publish(); return; }
    // The source remains the SDK's synchronous withdrawal signal. The transport
    // separately checks own-post predictions and unobserved own-edge intents at
    // dispatch AND delivery, so ready local data never authorizes a server page.
    if (followingBlocked(this.client, this.op)) { this.invalidate(); return; }
    // A device inbox can itself be unavailable at its source floor. It is an
    // invalidation signal, not evidence against an independently authorized
    // server history. Give refresh the existing one-second withdrawal window.
    if (read && !this.withdrawal) this.withdrawal = setTimeout(() => {
      this.withdrawal = undefined; this.invalidate();
    }, 1000);
    this.publish(); this.schedule(0);
  }
  private publish(): void {
    const offline = this.client.link() === "offline";
    if (offline) {
      const read = this.source?.getSnapshot();
      this.snapshot = { items: this.inbox?.getSnapshot().items ?? (read && "data" in read ? read.data : []), phase: "offline", hasMore: this.inbox?.getSnapshot().hasMore ?? false, omissions: [], inbox: this.inbox?.getSnapshot().read ?? read ?? { loading: true }, fact: "older posts are not on this device" };
    } else {
      const seen = new Set<string>();
      const rows = this.withheld ? [] : [...this.live, ...this.history].filter(row => !seen.has(row.id) && !!seen.add(row.id));
      this.snapshot = { items: rows.flatMap(row => row.kind === "shaped" ? [row.value] : []),
        omissions: rows.flatMap(row => row.kind === "omitted" ? [{ id: row.id, code: row.code }] : []),
        phase: this.withheld && this.phase === "page" ? "preparing" : this.phase,
        hasMore: !this.wantPage && !!this.next && !this.withheld, ...(this.code ? { code: this.code } : {}) };
    }
    for (const listener of this.listeners) listener();
  }
  private schedule(delay: number): void {
    if (this.phase === "refused" || !this.listeners.size || this.client.link() !== "online") return;
    const due = Date.now() + delay;
    if (this.timer && this.due <= due) return;
    if (this.timer) clearTimeout(this.timer);
    this.due = due;
    this.timer = setTimeout(() => { this.timer = undefined; this.due = Infinity; void this.run(); }, delay);
  }
  private async send(body: FollowingWire): Promise<FollowingWire | undefined> {
    const epoch = this.epoch;
    const answer = await followingRequest(this.client, this.op, this.args, body, this.aborter.signal);
    if (!this.listeners.size || this.client.link() !== "online" || epoch !== this.epoch) {
      if (typeof answer?.opening === "string") void followingRequest(this.client, this.op, this.args, { action: "cancel", opening: answer.opening });
      return;
    }
    if (typeof answer?.__followingCurrent === "function") this.guards.push(answer.__followingCurrent as () => boolean);
    if (followingBlocked(this.client, this.op) || !this.guards.every(current => current())) return;
    return answer;
  }
  private acceptControl(reply: FollowingWire): boolean {
    if (reply.phase === "restart") { this.reset(); return false; }
    if (reply.phase === "refused" || reply.denied) {
      this.phase = "refused"; this.withheld = true;
      this.code = typeof reply.code === "string" ? reply.code : (reply.denied as { code?: string } | undefined)?.code;
      this.publish(); return false;
    }
    return true;
  }
  private async run(): Promise<void> {
    if (this.phase === "refused" || this.work || !this.listeners.size || this.client.link() !== "online") return;
    this.work = true; this.guards = [];
    let delay = 1000;
    try {
      if (!this.opening) {
        const reply = await this.send({ action: "open" });
        if (!reply || !this.acceptControl(reply)) return;
        if (typeof reply.opening !== "string") { this.phase = "refused"; this.code = "E_FOLLOWING_INPUT"; return; }
        this.opening = reply.opening;
      }
      if (this.wantPage) {
        const reply = await this.send({ action: "unit", opening: this.opening, token: this.next ?? null });
        if (!reply || !this.acceptControl(reply)) return;
        if (reply.phase === "preparing" || reply.phase === "stalled") {
          this.next = reply.next as string; this.phase = reply.phase; delay = reply.phase === "stalled" ? 1000 : 10;
        } else if (reply.phase === "page") {
          // The token advances only after accepting the pinned bytes. Transport
          // retries keep the old token, even when the server has committed it.
          this.history.push(...reply.items as Item<R[number]>[]);
          this.next = reply.next as string | null; this.wantPage = false; this.phase = "page";
          // Recheck all mounted identities before showing a new combined list.
          this.withheld = true; delay = 0;
        }
      }
      if (!this.wantPage) await this.refresh();
    } catch { this.withheld = true; }
    finally { this.work = false; this.publish(); if (this.phase !== "refused") this.schedule(this.wantPage && this.phase === "page" ? 0 : delay); }
  }
  private async refresh(): Promise<void> {
    const epoch = this.epoch, opening = this.opening;
    const visible = new Set<string>();
    let live: Item<R[number]>[] = [];
    // Fixed batches bound authority requests independently of mounted length.
    // Withdrawal stays atomic: do not expose a partially revalidated list.
    for (let start = 0; start < Math.max(1, this.history.length); start += 100) {
      const mounted = this.history.slice(start, start + 100).map(item => ({ id: item.id, authority: item.kind === "shaped" ? item.authority : [] }));
      const reply = await this.send({ action: "refresh", opening, mounted });
      if (!reply || !this.acceptControl(reply) || reply.phase !== "page" || epoch !== this.epoch) return;
      for (const id of reply.visible as string[]) visible.add(id);
      live = reply.live as Item<R[number]>[];
    }
    if (epoch !== this.epoch || opening !== this.opening || followingBlocked(this.client, this.op) || !this.guards.every(current => current())) return;
    this.history = this.history.filter(item => visible.has(item.id));
    this.live = live; this.withheld = false; this.phase = "page";
    if (this.withdrawal) clearTimeout(this.withdrawal); this.withdrawal = undefined;
  }
}
