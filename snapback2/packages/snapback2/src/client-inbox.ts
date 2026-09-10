// @ref LLP 1018.004#2-the-inbox — a browser tab that is not the account's
// writer writes its mutations as durable rows in the partition's own database;
// the writer admits them through its ledger. The channel carries nudges and the
// writer's announced status only: nothing on it decides admission, so a lost
// message costs latency, never custody.
// @ref LLP 1018.004#4-liveness-nudges-polls-and-where-admission-runs — polls
// on both sides cover a lost nudge and a browser without BroadcastChannel.
import { blockedStatus } from "./client-outbox.js";
import type { OutboxEntry } from "./store/range-store.js";
import { followerRefusal, RefusalError } from "./client-wire.js";
import { inboxAlias, inboxKeyOf, InboxFull, INBOX_LIMIT } from "./store/inbox.js";
import type { OfflineRuntime } from "./offline.js";
import type { MutationQueued, OutboxStatus, Refusal } from "./types.js";

const PROTOCOL = 2;
/** How long a follower's oldest queued row may go unadmitted after a nudge before the writer counts as unresponsive. */
const UNRESPONSIVE_MS = 5_000;
const WRITER_POLL_MS = 30_000;
const WRITER_POLL_NO_CHANNEL_MS = 5_000;
const FOLLOWER_POLL_MS = 2_000;

type Message =
  | { protocol: 2; type: "writer"; scope: string; principal: string; authEpoch?: number; status: OutboxStatus }
  | { protocol: 2; type: "discover"; scope: string }
  | { protocol: 2; type: "inbox"; scope: string }
  | { protocol: 2; type: "ledger"; scope: string };

/** Canonical backend + carrier + principal identity: the channel name and every row's `scope`. */
export function inboxScope(url: string, carrier: string, principal: string): string {
  return `snapback2:inbox:${url} ${carrier} ${principal}`;
}

export interface ClientInboxHost {
  url: string;
  runtime?: OfflineRuntime;
  closed(): boolean;
  fence(): number;
  superseded(): RefusalError;
  failure(error: unknown, site: string): Refusal;
  /** Ordinary readiness of the writer's ledger, for announcements. */
  writerStatus(): Promise<OutboxStatus>;
  /** Every change of the writer's ledger, so followers can be nudged; subscribed only while this tab is the writer. */
  subscribeLedger(listener: () => void): () => void;
  /** An admission created entries: replay them (respects forced-offline). */
  admitted(): void;
  blocked?(op?: string): void;
}

interface FollowerRole {
  scope: string;
  principal: string;
  authEpoch?: number;
  established: boolean;
  followerId: string;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validStatus(value: unknown): value is OutboxStatus {
  return object(value) && typeof value.ready === "boolean" && typeof value.reason === "string"
    && typeof value.action === "string" && typeof value.remaining === "number" && (value.fence === "inside" || value.fence === "past")
    && (value.draining === undefined || value.draining === true);
}

/**
 * One client's inbox role: a follower that inserts rows and reads the ledger,
 * or a writer that admits rows. Readiness listeners hear every status change.
 */
export class ClientInbox {
  private channel?: BroadcastChannel;
  private follower?: FollowerRole;
  private writerScope?: string;
  private writerAnnounced?: { authEpoch?: number; status: OutboxStatus };
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private unresponsiveTimer?: ReturnType<typeof setTimeout>;
  private unresponsive = false;
  private admitting?: Promise<{ stopped?: string; op?: string }>;
  /** Completed dismissal commands one call is consuming: the first caller to see the durable result owns it. */
  private readonly consuming = new Set<number>();
  private admitAgain = false;
  private unsubscribeLedger?: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private readonly writes = new Set<Promise<unknown>>();

  constructor(private readonly host: ClientInboxHost) {}

  get available(): boolean { return typeof globalThis.BroadcastChannel === "function"; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) try { listener(); } catch { /* readiness observers are isolated */ }
  }

  scope(principal: string): string {
    const carrier = this.host.runtime?.coordinationScope;
    if (!carrier) throw new TypeError("the offline carrier has no browser-tab coordination scope");
    return inboxScope(this.host.url, carrier, principal);
  }

  /** This tab follows another tab's partition: open the channel and start reading. */
  following(principal: string, authenticated: boolean, authEpoch: number | undefined, persona: boolean): void {
    const scope = this.scope(principal);
    const established = authenticated || persona;
    if (this.follower && this.follower.scope === scope && this.follower.authEpoch === authEpoch && this.follower.established === established) {
      this.post({ protocol: PROTOCOL, type: "discover", scope });
      this.notify();
      return;
    }
    this.stop();
    this.follower = { scope, principal, ...(authEpoch === undefined ? {} : { authEpoch }), established, followerId: randomId() };
    this.open(scope);
    this.post({ protocol: PROTOCOL, type: "discover", scope });
    this.armFollowerPoll();
    this.notify();
  }

  /** This tab holds the partition: announce, admit what the inbox holds, and keep polling it. */
  async activate(): Promise<void> {
    const runtime = this.host.runtime;
    // A following tab keeps its follower role; only a tab with no partition to announce stops.
    if (runtime?.following) return;
    if (!runtime || !runtime.principal || !runtime.coordinationScope) { this.stop(); return; }
    const scope = this.scope(runtime.principal);
    if (this.writerScope !== scope) {
      this.stop();
      this.writerScope = scope;
      this.open(scope);
      this.unsubscribeLedger = this.host.subscribeLedger(() => this.ledgerChanged());
    }
    await this.announce();
    await this.admit();
    this.armWriterPoll();
  }

  stop(): void {
    this.generation += 1;
    this.unsubscribeLedger?.(); this.unsubscribeLedger = undefined;
    this.channel?.close();
    this.channel = undefined;
    this.follower = undefined;
    this.writerScope = undefined;
    this.writerAnnounced = undefined;
    clearTimeout(this.pollTimer); this.pollTimer = undefined;
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    clearTimeout(this.unresponsiveTimer); this.unresponsiveTimer = undefined;
    this.unresponsive = false;
    this.notify();
  }

  async settled(): Promise<void> {
    while (this.writes.size > 0) await Promise.allSettled([...this.writes]);
    if (this.admitting) await this.admitting.catch(() => undefined);
  }

  /** The writer's ledger status as last announced, for a follower's `detail.writer`. */
  get writer(): OutboxStatus | undefined { return this.writerAnnounced?.status; }

  get isFollower(): boolean { return this.follower !== undefined; }

  // @ref LLP 1018.004#3-readiness-on-a-follower — a follower with a route and
  // capacity is sendable; `writer-unresponsive` is a reason on a ready status.
  async status(): Promise<OutboxStatus> {
    const follower = this.follower, runtime = this.host.runtime;
    if (!follower || !runtime) return { ready: false, reason: "follower", action: "other-tab", remaining: 0, fence: "inside" };
    // Ledger entries are the ones not named by an alias; an admitted row's entry counts as the ledger's.
    const entries = await runtime.itemEntries();
    const blocked = blockedStatus(entries);
    const ledgerQueued = entries.filter((entry) => entry.state === "queued" && inboxKeyOf(entry.intent) === undefined).length;
    const remaining = runtime.inboxPending + ledgerQueued;
    const fence = this.writerAnnounced?.status.fence ?? "inside";
    if (!follower.established) return { ready: false, reason: "sealed", action: "sign-in", remaining, fence, ...blocked };
    if (!runtime.inboxAvailable) return { ready: false, reason: "follower", action: "other-tab", remaining, fence, ...blocked };
    if (runtime.inboxPending >= INBOX_LIMIT) return { ready: false, reason: "inbox-full", action: "wait", remaining, fence, ...blocked };
    return { ready: true, reason: this.unresponsive ? "writer-unresponsive" : "forwarding", action: this.unresponsive || remaining > 0 ? "wait" : "none", remaining, fence, ...blocked };
  }

  /** A follower's write: a durable row before this resolves (LLP 1018.004 §2). */
  mutation(op: string, args: unknown, presentation?: string): Promise<MutationQueued> {
    const follower = this.follower, runtime = this.host.runtime;
    if (!follower || !runtime) return Promise.reject(followerRefusal("client.mutation.inbox"));
    if (!follower.established) {
      return Promise.reject(new RefusalError({ code: "E_OFFLINE_FOLLOWER", family: "offline",
        message: "this tab's account is not established yet; sign in before writing", site: "client.mutation.inbox",
        rewrite: "authenticate this tab, then send again", guide: "offline" }));
    }
    if (!runtime.inboxAvailable) return Promise.reject(followerRefusal("client.mutation.inbox"));
    const fence = this.host.fence(), generation = this.generation;
    const request = (async (): Promise<MutationQueued> => {
      const now = Date.now();
      let key: number;
      try {
        key = await runtime.insertInbox({ kind: "mutation", scope: follower.scope, principal: follower.principal,
          ...(follower.authEpoch === undefined ? {} : { authEpoch: follower.authEpoch }), followerId: follower.followerId,
          op, args, ...(presentation === undefined ? {} : { presentation }), state: "queued", ids: [], createdAt: now, updatedAt: now });
      } catch (error) {
        // Compared by name: the carrier may come from another bundle of the same source (`snapback2/react`).
        if (error instanceof InboxFull || (error instanceof Error && error.name === "InboxFull")) {
          throw new RefusalError({ code: "E_OFFLINE_INBOX_FULL", family: "offline", message: (error as Error).message,
            site: "client.mutation.inbox", rewrite: "wait for the sending tab to admit queued writes", guide: "offline" });
        }
        if (error instanceof TypeError) {
          throw new RefusalError({ code: "E_OFFLINE_ARGUMENTS", family: "offline", message: error.message,
            site: "client.mutation.inbox", rewrite: "send JSON-representable arguments", guide: "offline" });
        }
        throw new RefusalError(this.host.failure(error, "client.mutation.inbox"));
      }
      if (this.host.closed() || this.host.fence() !== fence || this.generation !== generation) {
        // The row is durable regardless; only this call's publication rights ended.
        throw this.host.superseded();
      }
      this.post({ protocol: PROTOCOL, type: "inbox", scope: follower.scope });
      this.armUnresponsive();
      this.armFollowerPoll();
      return { state: "queued", intent: inboxAlias(key), ids: [] };
    })();
    this.writes.add(request);
    void request.finally(() => this.writes.delete(request)).catch(() => undefined);
    return request;
  }

  /** A follower's dismissal is a durable command row the writer consumes; a rejected row of its own is deleted directly. */
  async dismiss(intent: string): Promise<OutboxEntry | undefined> {
    const follower = this.follower, runtime = this.host.runtime;
    if (runtime?.principal && !runtime.following) return runtime.outbox.dismiss(intent, undefined,
      runtime.coordinationScope ? { scope: this.scope(runtime.principal), principal: runtime.principal, authEpoch: runtime.authEpoch } : undefined);
    if (!follower || !runtime || !runtime.inboxAvailable) throw followerRefusal("client.outbox.dismiss");
    const key = inboxKeyOf(intent);
    const row = key === undefined ? undefined : runtime.inboxRows.find((candidate) => candidate.key === key);
    if (row && row.state === "rejected" && row.admitted === undefined) { await runtime.removeInboxRow(row.key); return; }
    await this.refresh();
    const generation = this.generation, fence = this.host.fence();
    const now = Date.now();
    const existing = runtime.inboxRows.find(row => row.kind === "dismiss" && row.target === intent
      && row.scope === follower.scope && row.authEpoch === follower.authEpoch);
    const command = existing?.key ?? await runtime.insertInbox({ kind: "dismiss", scope: follower.scope, principal: follower.principal,
      ...(follower.authEpoch === undefined ? {} : { authEpoch: follower.authEpoch }), followerId: follower.followerId,
      target: intent, state: "queued", ids: [], createdAt: now, updatedAt: now });
    this.post({ protocol: PROTOCOL, type: "inbox", scope: follower.scope });
    const deadline = now + UNRESPONSIVE_MS;
    for (;;) {
      if (this.generation !== generation || this.host.fence() !== fence || this.host.closed()) throw this.host.superseded();
      await this.refresh();
      if (this.generation !== generation || this.host.fence() !== fence || this.host.closed()) throw this.host.superseded();
      const result = runtime.inboxRows.find(row => row.key === command);
      if (!result) return undefined;
      if (result.state === "done") {
        // The role was checked before the row is consumed, never after: once the durable
        // result is gone its bytes belong to this caller whatever the role became meanwhile,
        // and a role that changed first leaves the row for the new writer to recover. One
        // consumer per command, so overlapping calls cannot both return the same bytes.
        if (this.consuming.has(command)) return undefined;
        this.consuming.add(command);
        try { await runtime.removeInboxRow(command); } finally { this.consuming.delete(command); }
        return (result.response ?? undefined) as OutboxEntry | undefined;
      }
      if (Date.now() >= deadline) throw followerRefusal("client.outbox.dismiss");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  /** A follower re-reads its rows and the ledger now (a nudge, a poll, or `online()`). */
  async refresh(): Promise<void> {
    const runtime = this.host.runtime;
    if (!runtime || !this.follower) return;
    const changed = await runtime.refreshInbox().catch(() => false);
    if (runtime.inboxPending === 0) this.clearUnresponsive();
    else this.armUnresponsive();
    // Rows read from durable state, after a reload, need the same poll and timer a fresh insertion arms.
    this.armFollowerPoll();
    if (changed) this.notify();
  }

  /**
   * The writer admits the inbox now; concurrent calls coalesce into one more
   * pass. Runs whether or not the follower marker is still set, so takeover
   * can admit inherited rows before its first resume (LLP 1018.004 §4).
   */
  admit(): Promise<{ stopped?: string; op?: string }> {
    const runtime = this.host.runtime;
    if (!runtime || !runtime.principal || !runtime.coordinationScope) return Promise.resolve({});
    if (this.admitting) { this.admitAgain = true; return this.admitting; }
    const run = (async (): Promise<{ stopped?: string; op?: string }> => {
      let last: { stopped?: string; op?: string } = {};
      do {
        this.admitAgain = false;
        const fence = this.host.fence(), principal = runtime.principal!;
        const scope = this.scope(principal);
        const custody = () => {
          if (this.host.closed() || this.host.fence() !== fence || runtime.principal !== principal) throw this.host.superseded();
        };
        let verdict: { admitted: number; stopped?: string } = { admitted: 0 };
        try { verdict = await runtime.admitInbox({ scope, custody }); }
        catch (error) { if (!this.host.closed()) this.host.failure(error, "client.inbox.admit"); }
        if (verdict.admitted > 0) this.host.admitted();
        const op = verdict.stopped === undefined ? undefined
          : runtime.inboxRows.find(row => row.kind === "mutation" && row.state === "queued" && row.admitted === undefined)?.op;
        last = verdict.stopped === undefined ? {} : { stopped: verdict.stopped, op };
        this.host.blocked?.(op);
        this.post({ protocol: PROTOCOL, type: "ledger", scope });
        if (this.writerScope === scope) await this.announce();
      } while (this.admitAgain && !this.host.closed());
      return last;
    })();
    this.admitting = run.finally(() => { this.admitting = undefined; });
    return this.admitting;
  }

  /**
   * Every swap of the writer's ledger nudges followers, so their read model
   * follows the writer's; and while rows wait on something the ledger just
   * gained (a grant, a bound, a resume), the same signal retries admission.
   * A pass that changes nothing does not notify, so this converges.
   */
  ledgerChanged(): void {
    if (!this.writerScope) return;
    this.post({ protocol: PROTOCOL, type: "ledger", scope: this.writerScope });
    // Replay activity changes even when a transport stop leaves every entry intact.
    void this.announce();
    if ((this.host.runtime?.inboxPending ?? 0) > 0 && !this.admitting && !this.retryTimer) {
      this.retryTimer = setTimeout(() => { this.retryTimer = undefined; if (this.writerScope) void this.admit(); }, 0);
      (this.retryTimer as { unref?: () => void }).unref?.();
    }
  }

  private async announce(): Promise<void> {
    const runtime = this.host.runtime, scope = this.writerScope;
    if (!runtime || !scope || !runtime.principal) return;
    let status: OutboxStatus;
    try { status = { ...await this.host.writerStatus(), ...blockedStatus(await runtime.itemEntries()), ...(runtime.draining ? { draining: true as const } : {}) }; }
    catch { return; }
    if (this.writerScope !== scope) return;
    this.post({ protocol: PROTOCOL, type: "writer", scope, principal: runtime.principal,
      ...(runtime.authEpoch === undefined ? {} : { authEpoch: runtime.authEpoch }), status });
  }

  private armWriterPoll(): void {
    clearTimeout(this.pollTimer);
    if (!this.writerScope) return;
    this.pollTimer = setTimeout(() => {
      if (!this.writerScope || this.host.closed()) return;
      void this.admit().finally(() => this.armWriterPoll());
    }, this.available ? WRITER_POLL_MS : WRITER_POLL_NO_CHANNEL_MS);
    (this.pollTimer as { unref?: () => void }).unref?.();
  }

  private armFollowerPoll(): void {
    clearTimeout(this.pollTimer);
    const runtime = this.host.runtime;
    if (!this.follower || !runtime) return;
    const pending = runtime.inboxPending > 0 || runtime.inboxRows.some((row) => row.kind === "dismiss" && row.state === "queued");
    if (!pending && this.available) return;
    this.pollTimer = setTimeout(() => {
      if (!this.follower || this.host.closed()) return;
      void this.refresh().finally(() => this.armFollowerPoll());
    }, FOLLOWER_POLL_MS);
    (this.pollTimer as { unref?: () => void }).unref?.();
  }

  private armUnresponsive(): void {
    if (this.unresponsiveTimer) return;
    this.unresponsiveTimer = setTimeout(() => {
      this.unresponsiveTimer = undefined;
      if (!this.follower || (this.host.runtime?.inboxPending ?? 0) === 0) return;
      if (!this.unresponsive) { this.unresponsive = true; this.notify(); }
    }, UNRESPONSIVE_MS);
    (this.unresponsiveTimer as { unref?: () => void }).unref?.();
  }

  private clearUnresponsive(): void {
    clearTimeout(this.unresponsiveTimer); this.unresponsiveTimer = undefined;
    if (this.unresponsive) { this.unresponsive = false; this.notify(); }
  }

  private open(scope: string): void {
    if (!this.available) return;
    const generation = ++this.generation;
    const channel = new BroadcastChannel(scope);
    this.channel = channel;
    channel.onmessage = ({ data }) => {
      if (generation !== this.generation || this.channel !== channel || !object(data) || data.protocol !== PROTOCOL) return;
      void this.receive(data as unknown as Message);
    };
  }

  private post(message: Message): boolean {
    if (!this.channel) return false;
    try { this.channel.postMessage(message); return true; }
    catch { return false; }
  }

  private async receive(message: Message): Promise<void> {
    if (message.type === "discover") { if (this.writerScope === message.scope) await this.announce(); return; }
    if (message.type === "inbox") { if (this.writerScope === message.scope) await this.admit(); return; }
    if (message.type === "writer") {
      if (this.follower?.scope !== message.scope || !validStatus(message.status)) return;
      this.writerAnnounced = { ...(message.authEpoch === undefined ? {} : { authEpoch: message.authEpoch }), status: message.status };
      await this.refresh();
      this.notify();
      return;
    }
    if (message.type === "ledger") { if (this.follower?.scope === message.scope) await this.refresh(); }
  }
}
