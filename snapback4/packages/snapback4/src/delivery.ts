import type { Refusal } from "./contract.ts";
import { acceptManifest, boundDebt, dropBinding, emptyDelivery, mergeRuns, subtractRuns, type Attempt, type DeliveryRefused, type DeliveryState, type Parked } from "./delivery-state.ts";
export type { DeliveryRefused } from "./delivery-state.ts";

export interface DeliveryStorage {
  update<T>(edit: (state: DeliveryState) => T): Promise<T>;
  clear(): Promise<void>;
}
export function memoryDelivery(): DeliveryStorage {
  let state = emptyDelivery();
  return { async update(edit) { return edit(state); }, async clear() { state = emptyDelivery(); } };
}
export interface DeliveryReply {
  json: Record<string, unknown>;
  obsoleteAuth?: boolean;
  /** The serial chain became busy before transport; no call was dispatched. */
  deferred?: boolean;
  /** Identity observation has passed, against this call's captured floor. */
  accepted: boolean;
}
interface Options {
  storage: DeliveryStorage;
  local: boolean;
  mint(): string;
  ready(): boolean;
  send(mutation: string, body: { id: string; args: Record<string, unknown>; delivery: { fingerprint: string } }, signal: AbortSignal): Promise<DeliveryReply>;
  onOffline?(): void;
  onSettled?(): void;
  onRefused?(event: DeliveryRefused): void;
  now?: () => number;
  jitter?: () => number;
}
interface Flight { key: string; incarnation: number; epoch: number; attempt: Attempt; controller: AbortController; done: Promise<void> }

// @ref LLP 3000.019#4 — delivery belongs to the SDK, independent of mounted screens.
// @ref LLP 3000.022#4 — receipt success is coverage; uncertain retries retain their persisted id.
export class DeliveryQueue {
  private epoch = 0;
  private stopped = false;
  private paused = false;
  private offline = false;
  private pumping = false;
  private startup: { key: string; incarnation: number; runs: [number, number][] }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private slow: ReturnType<typeof setTimeout> | undefined;
  private flights = new Set<Flight>();
  private tasks = new Set<Promise<unknown>>();
  private readonly now: () => number;
  constructor(private options: Options) { this.now = options.now ?? Date.now; }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.tasks.add(promise); void promise.finally(() => this.tasks.delete(promise)).catch(() => {}); return promise;
  }
  async start(): Promise<void> {
    // Snapshot only the debt present at startup. New live collections cannot
    // extend this barrier and starve the device's first activation.
    this.startup = await this.options.storage.update(state => Object.entries(state.groups).map(([key, g]) => ({
      key, incarnation: g.incarnation, runs: mergeRuns([...g.owed, ...g.parked.filter(p => p.kind !== "full").map(p => p.run)]),
    })));
    await this.wake("start");
    if (await this.options.storage.update(state => Object.keys(state.groups).length > 0)) this.slowTimer();
  }
  async accept(manifest: unknown, publish: () => boolean = () => true): Promise<void> {
    if (this.stopped) return;
    const epoch = this.epoch;
    const changed = await this.track(this.options.storage.update(state => {
      if (epoch === this.epoch && !this.stopped && publish()) return acceptManifest(state, manifest, this.options.local ? 4096 : 1024);
    }));
    if (changed && !this.slow) this.slowTimer();
    this.schedule(250);
  }
  /** Device publication already persisted the collection and its wake flag. */
  published(): void { if (!this.slow) this.slowTimer(); this.schedule(250); }
  available(): void { this.schedule(0); }
  async reconnect(): Promise<void> { this.offline = false; await this.wake("reconnect"); }
  private slowTimer(): void {
    if (this.stopped) return;
    this.slow = setTimeout(() => {
      if (!this.offline && this.options.ready()) void this.wake("timer");
      this.slowTimer();
    }, 600_000 + Math.floor((this.options.jitter ?? Math.random)() * 60_000));
    (this.slow as { unref?: () => void }).unref?.();
  }
  async wake(reason: "start" | "reconnect" | "timer"): Promise<void> {
    if (this.stopped) return;
    await this.track(this.options.storage.update(state => {
      for (const group of Object.values(state.groups)) {
        group.wake = true;
        for (const parked of [...group.parked]) {
          if (parked.kind === "retry" && reason !== "timer") parked.ready = true;
          if (parked.kind === "start" && reason === "start") {
            group.parked.splice(group.parked.indexOf(parked), 1);
            group.owed = mergeRuns([...group.owed, parked.run]);
          }
        }
      }
    }));
    this.schedule(0);
  }
  private schedule(delay: number): void {
    if (this.stopped || this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.pump().catch(() => this.schedule(1000)); }, delay);
    (this.timer as { unref?: () => void }).unref?.();
  }
  async pump(): Promise<void> {
    if (this.pumping || this.stopped || this.paused || this.offline || !this.options.ready()) return;
    this.pumping = true;
    try {
      while (this.flights.size < 4 && !this.stopped && !this.paused && !this.offline && this.options.ready()) {
        const epoch = this.epoch, now = this.now();
        let nextAt = Infinity;
        const selected = await this.track(this.options.storage.update(state => {
          if (epoch !== this.epoch || this.stopped) return;
          const idle = Object.entries(state.groups).filter(([key, g]) => !g.saturated && ![...this.flights].some(f => f.key === key));
          const ready = idle.filter(([, g]) => {
            if (!g.owed.length && !g.attempt && !g.parked.some(p => p.kind === "retry" && p.ready)) return false;
            const at = g.attempt?.readyAt ?? 0;
            if (at > now) { nextAt = Math.min(nextAt, at); return false; }
            return true;
          }).sort(([, a], [, b]) => a.ready - b.ready);
          let entry = ready[0];
          if (!entry) {
            const parked = idle.filter(([, g]) => g.wake && g.parked.some(p => p.kind === "full"))
              .map(([key, group]) => ({ key, group, run: group.parked.filter(p => p.kind === "full").sort((a, b) => a.at - b.at)[0]! }))
              .filter(item => { if (item.run.at + 30_000 <= now) return true; nextAt = Math.min(nextAt, item.run.at + 30_000); return false; })
              .sort((a, b) => a.group.ready - b.group.ready)[0];
            if (parked) {
              parked.group.parked.splice(parked.group.parked.indexOf(parked.run), 1);
              parked.group.owed = mergeRuns([...parked.group.owed, parked.run.run]);
              parked.group.wake = false;
              entry = [parked.key, parked.group];
            }
          }
          if (!entry) return;
          const [key, group] = entry;
          // Each exhausted uncertain interval retains its own attempt, even
          // when several intervals in this group exhausted before reconnect.
          if (!group.attempt) {
            const retry = group.parked.filter(p => p.kind === "retry" && p.ready).sort((a, b) => a.run[0] - b.run[0])[0];
            if (retry && (!group.owed.length || retry.run[0] < group.owed[0]![0])) {
              group.parked.splice(group.parked.indexOf(retry), 1);
              group.owed = mergeRuns([...group.owed, retry.run]);
              if (retry.attempt) group.attempt = { ...retry.attempt, retries: 0, readyAt: 0 };
            }
          }
          if (!group.parked.some(p => p.kind === "full")) group.wake = false;
          // This commit precedes transport, including the local host persistence batch.
          if (!group.attempt) {
            group.attempt = { id: this.options.mint(), run: [...group.owed[0]!], retries: 0, readyAt: 0, recent: [] };
            group.recent = [];
          }
          return { key, incarnation: group.incarnation, binding: group.binding, group: group.group, attempt: { ...group.attempt, run: [...group.attempt.run] as [number, number] } };
        }));
        if (!selected) { if (Number.isFinite(nextAt)) this.schedule(Math.max(1, nextAt - this.now())); break; }
        if (epoch !== this.epoch || this.stopped) break;
        const flight: Flight = { ...selected, epoch, controller: new AbortController(), done: Promise.resolve() };
        this.flights.add(flight);
        const [groupArg, fromArg, throughArg] = selected.binding.args;
        const body = { delivery: { fingerprint: selected.binding.fingerprint }, id: selected.attempt.id, args: { [groupArg]: selected.group, [fromArg]: selected.attempt.run[0], [throughArg]: selected.attempt.run[1] } };
        flight.done = this.run(flight, selected.binding.mutation, body);
        void flight.done.catch(() => {});
      }
    } finally { this.pumping = false; }
  }
  private current(f: Flight): boolean { return !this.stopped && f.epoch === this.epoch; }
  private async run(f: Flight, mutation: string, body: { id: string; args: Record<string, unknown>; delivery: { fingerprint: string } }): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let deferred = false;
    try {
      const timeout = new Promise<undefined>(resolve => {
        f.controller.signal.addEventListener("abort", () => resolve(undefined), { once: true });
        deadline = setTimeout(() => { f.controller.abort(); resolve(undefined); }, 15_000);
      });
      let reply: DeliveryReply | undefined;
      try { reply = await Promise.race([this.options.send(mutation, body, f.controller.signal), timeout]); } catch { /* uncertain */ }
      if (!this.current(f)) return;
      if (reply?.deferred) { deferred = true; return; }
      const json = reply?.json;
      const why = (json?.why ?? json?.denied) as Refusal | undefined;
      if (why?.code === "E_STORE_REPLACED" || why?.code === "E_STORE_RESTORE") { await this.reset(true); return; }
      const outcome = await this.track(this.options.storage.update(state => {
        if (!this.current(f)) return;
        const group = state.groups[f.key];
        if (!group || group.incarnation !== f.incarnation || group.attempt?.id !== f.attempt.id) return;
        const effects: { refused?: DeliveryRefused; paused?: boolean; offline?: boolean } = {};
        const attempt = group.attempt, run = attempt.run, now = this.now();
        const remove = () => { group.owed = subtractRuns(group.owed, [run]); delete group.attempt; };
        const park = (kind: Parked["kind"], keepId = false) => { remove(); group.parked.push({ run, kind, at: now, ...(keepId ? { attempt } : {}) }); };
        const retry = (recorded: boolean) => {
          if (recorded) { attempt.id = this.options.mint(); attempt.recent = []; group.recent = []; }
          if (attempt.retries >= 8) { park("retry", true); return; }
          attempt.readyAt = now + Math.min(60_000, 1000 * 2 ** attempt.retries++);
        };
        group.ready = ++state.serial;
        if (why?.code === "E_AUTH") {
          if (reply?.obsoleteAuth) attempt.readyAt = now;
          else effects.paused = true;
        } else if (why?.code === "E_OFFLINE") effects.offline = true;
        else if (!reply || !reply.accepted || !Number.isSafeInteger(json?.head) || Number(json?.head) < 0) retry(false);
        else if (why?.code === "E_DELIVERY_BINDING") { dropBinding(state, group.binding); }
        else if (json?.state === "sent") {
          remove(); group.reported = mergeRuns([...group.reported, run]).slice(-256); group.wake = true;
        } else if (why?.code === "RUNS_FULL") park("full");
        else if (why?.code === "NOT_MEMBER" || why?.code === "NOT_FOUND") {
          const recent = attempt.recent ?? group.recent;
          if (!this.options.local && recent.length) {
            group.owed = recent; group.parked = []; delete group.attempt;
            group.incarnation = ++state.serial;
          } else { delete state.groups[f.key]; delete state.retired[f.key]; }
        } else if (why?.code === "NOT_A_RUN" || why?.code === "PAST_LAST_MESSAGE") {
          remove(); group.refused = mergeRuns([...group.refused, run]);
          if (group.refused.length >= 64) { group.saturated = true; group.owed = []; group.parked = []; }
          effects.refused = { ...group.binding, group: group.group, from: run[0], through: run[1], why };
        } else if (why?.retryable) retry(json?.state === "failed" || why.code === "E_CONFLICT");
        else if (why) { park("start"); effects.refused = { ...group.binding, group: group.group, from: run[0], through: run[1], why }; }
        else retry(false);
        boundDebt(group);
        return effects;
      }));
      // Local CAS can rerun the edit after a concurrent leave/publication. Only
      // the successfully committed edit may pause dispatch or notify the app.
      if (outcome && this.current(f)) {
        if (outcome.paused) this.paused = true;
        if (outcome.offline) { this.offline = true; this.options.onOffline?.(); }
        if (outcome.refused) this.options.onRefused?.(outcome.refused);
      }
    } finally {
      if (deadline) clearTimeout(deadline);
      // Old-incarnation completions release their slot even when they adopt nothing.
      this.flights.delete(f);
      this.schedule(deferred ? 250 : 0);
      this.options.onSettled?.();
    }
  }
  /** Activation cannot displace debt that has not had its startup flush. */
  async flushed(): Promise<boolean> {
    await this.pump();
    return this.options.storage.update(state => !this.startup.some(({ key, incarnation, runs }) => {
      const g = state.groups[key];
      return g?.incarnation === incarnation && runs.some(([a, b]) => g.owed.some(([x, y]) => a <= y && x <= b));
    }));
  }
  /** Store/generation changes fence every callback. Sign-out keeps local debt. */
  async reset(clear: boolean): Promise<void> {
    this.epoch++;
    for (const flight of this.flights) flight.controller.abort();
    this.flights.clear();
    if (clear) await this.options.storage.clear();
  }
  async stop(wait = false): Promise<void> {
    this.paused = true;
    this.epoch++; // Sign-out fences outcomes immediately, before its bounded drain.
    if (this.timer) clearTimeout(this.timer);
    if (this.slow) clearTimeout(this.slow);
    if (wait && this.flights.size) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled([...this.flights].map(f => f.done)), new Promise<void>(r => { timer = setTimeout(r, 1000); })]);
      if (timer) clearTimeout(timer);
    }
    this.stopped = true;
    await this.reset(false);
    await Promise.allSettled([...this.tasks]);
  }
}
