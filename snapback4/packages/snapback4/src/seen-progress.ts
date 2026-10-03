import { mintId } from "./client.ts";
import type { Client, Observed, Refusal, Write } from "./contract.ts";
import type { ReceiptFamily } from "./receipt-family.ts";

export interface SeenOptions {
  scope: string;
  /** Highest actually visible confirmed message position, or null. Never derive
   * this from pending rows, acquisition, background pages or a scope counter. */
  through: number | null;
  /** Foreground AND viewport visibility, supplied by the app on web and native. */
  active: boolean;
}
export interface SeenSnapshot {
  readonly state: "idle" | "admitting" | "pending" | "retrying" | "failed";
  /** Local progress only; neither delivery nor a confirmed server watermark. */
  readonly through: number;
  readonly why?: Refusal;
}
const EMPTY: SeenSnapshot = { state: "idle", through: 0 };
const admission = (why: Refusal) => ["E_ADMISSION", "E_ADMISSION_STORE", "E_ADMISSION_TIMEOUT"].includes(why.code);
const position = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
type Member = { id: string; pending?: boolean };
type Family = ReceiptFamily<Member, string, string>;
const clients = new WeakMap<Client, Map<string, Progress>>();

// @ref LLP 3000.022#14.6 — one mounted lifetime per client/binding/scope, never a history reader.
// @ref LLP 3000.023#3.4 — synchronous observation withdrawals fence debt and late outcomes.
class Progress {
  readonly owners = new Set<SeenOwner>();
  snapshot: SeenSnapshot = EMPTY;
  private observation: Observed<Member | null>;
  private stops: (() => void)[];
  private epoch = 0;
  private member: string | undefined;
  private floor = 0;
  private acknowledged = 0;
  private target = 0;
  private rejected: number | undefined;
  private flight: { epoch: number; id: string; through: number } | undefined;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private scheduled = false;
  constructor(private client: Client, private family: Family, private scope: string) {
    this.observation = client.observe(family.member, { [family.scopeArgument]: scope });
    this.stops = [this.observation.subscribe(this.read), client.onViewer(this.reset),
      client.onSession(this.reset), client.onLink(link => { if (link === "signed-out") this.reset(); else if (link === "online") this.retry(); }),
      client.onWrite(write => {
        if (this.flight?.id === write.id) this.outcome(this.flight, write);
      })];
    this.read();
  }
  private publish(state: SeenSnapshot["state"] = "idle", why?: Refusal) {
    const next = { state, through: this.target, ...(why ? { why } : {}) };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const owner of this.owners) owner.notify();
  }
  private reset = () => {
    this.epoch++; this.member = undefined; this.target = this.floor = this.acknowledged = this.failures = 0;
    this.rejected = undefined;
    this.flight = undefined; clearTimeout(this.timer); this.timer = undefined;
    this.publish();
  };
  private read = () => {
    if (this.closed) return;
    const read = this.observation.getSnapshot();
    const row = "data" in read ? read.data : null;
    const values = row as unknown as Record<string, unknown> | null;
    const floor = values?.[this.family.mapping.floor], seen = values?.[this.family.mapping.seen];
    if (!row || row.pending || !position(floor) || !position(seen)) {
      if (this.member !== undefined || this.target || this.flight) this.reset();
      return;
    }
    const identity = JSON.stringify([this.client.viewer(), row.id, floor]);
    if (this.member !== identity) { this.reset(); this.member = identity; }
    this.floor = floor;
    this.acknowledged = Math.max(this.acknowledged, floor, seen);
    // Notify even on first membership: a committed render must supply current
    // visible positions after a withdrawal, never replay remembered input.
    for (const owner of this.owners) owner.notify();
    this.schedule();
  };
  update(owner: SeenOwner, through: number | null, active: boolean) {
    owner.active = active;
    if (active && this.member !== undefined && position(through) && through !== this.rejected) {
      this.target = Math.max(this.target, through);
      if (this.snapshot.state === "failed" && this.rejected !== undefined && this.snapshot.why && !admission(this.snapshot.why)
        && through > Math.max(this.floor, this.acknowledged)) {
        this.failures = 0; this.publish();
      } else this.publish(this.snapshot.state, this.snapshot.why);
    }
    this.schedule();
  }
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.flush(); });
  }
  private flush() {
    if (this.closed || ![...this.owners].some(o => o.active) || this.member === undefined || this.flight || this.timer
      || this.snapshot.state === "failed" || this.target <= Math.max(this.floor, this.acknowledged)) return;
    const flight = { epoch: this.epoch, id: mintId(), through: this.target };
    this.flight = flight; this.publish("admitting");
    const args = { [this.family.scopeArgument]: this.scope, [this.family.throughArgument]: flight.through };
    // A record can't express two distinct computed-key value types in TS.
    const run = (async () => this.client.mutate(this.family.seen, args as Record<string, string> & Record<string, number>, { id: flight.id, waitSeconds: 0 }))();
    void run.then(write => {
      if (this.flight !== flight || this.closed || flight.epoch !== this.epoch) return;
      flight.id = write.id;
      this.outcome(flight, write);
      // Settlement may have arrived before admission resolved. Lookup uses the
      // ordinary receipt store; no replay or second outbox is introduced.
      if (write.state === "pending") void this.client.write(write.id).then(found => {
        if (found && found.state !== "pending") this.outcome(flight, found);
      }).catch(() => {});
    }).catch(error => {
      this.outcome(flight, { state: "failed", id: "", why: { code: "E_CLIENT", family: "client",
        message: `Seen admission outcome is unknown: ${String(error)}` } });
    });
  }
  private outcome(flight: NonNullable<Progress["flight"]>, write: Write) {
    if (this.closed || this.flight !== flight || flight.epoch !== this.epoch) return;
    if (write.state === "pending") { this.publish("pending"); return; }
    this.flight = undefined;
    if (write.state === "sent") {
      this.acknowledged = Math.max(this.acknowledged, flight.through); this.failures = 0;
      this.publish(); this.schedule(); return;
    }
    if (admission(write.why) && this.failures < 8) {
      const delay = Math.min(60_000, 1000 * 2 ** this.failures++);
      this.timer = setTimeout(() => { this.timer = undefined; this.publish(); this.schedule(); }, delay);
      this.publish("retrying", write.why);
    } else {
      if (!admission(write.why)) {
        this.rejected = flight.through;
        this.target = Math.max(this.floor, this.acknowledged);
      }
      this.publish("failed", write.why);
    }
  }
  retry = () => {
    if (!this.snapshot.why || !admission(this.snapshot.why)) return;
    clearTimeout(this.timer); this.timer = undefined; this.failures = 0;
    this.publish(); this.schedule();
  };
  close() { this.closed = true; this.reset(); for (const stop of this.stops) stop(); this.observation.close(); }
}

/** Inert during render; committed subscribers own and release the shared work. */
export class SeenOwner {
  active = false;
  private source: Progress | undefined;
  private revision = 0;
  private snapshot = { ...EMPTY, revision: 0 };
  private listeners = new Set<() => void>();
  constructor(private client: Client, private family: Family, private scope: string) {}
  notify = () => {
    this.snapshot = { ...(this.source?.snapshot ?? EMPTY), revision: ++this.revision };
    for (const listener of this.listeners) listener();
  };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => EMPTY;
  retry = () => this.source?.retry();
  update(through: number | null, active: boolean) { this.source?.update(this, through, active); }
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    let scopes = clients.get(this.client);
    if (!scopes) clients.set(this.client, scopes = new Map());
    const key = JSON.stringify([this.family.fingerprint, this.family.member.name, this.family.seen.name, this.scope]);
    let source = scopes.get(key);
    if (!source) { source = new Progress(this.client, this.family, this.scope); scopes.set(key, source); }
    this.source = source; source.owners.add(this); this.notify();
    return () => {
      this.listeners.delete(notify);
      if (this.listeners.size) return;
      this.active = false; source.owners.delete(this); this.source = undefined;
      // Strict Mode's same-turn detach/attach keeps one flight. No owner means
      // no dispatch; cleanup never leaves an unbounded remount cache.
      queueMicrotask(() => {
        if (!source.owners.size && scopes.get(key) === source) { scopes.delete(key); source.close(); }
      });
    };
  };
}
