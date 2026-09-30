import type { Client } from "./contract.ts";
import type { ReadObservation } from "./read-observation.ts";
import { ReadWork } from "./read-work.ts";

// @ref LLP 3000.023#10 — bounded, data-free inspection follows the observation queue.
export interface PressureCounts {
  observations: number;
  subscribers: number;
  queued: number;
  inFlight: number;
  revalidating: number;
  withdrawn: number;
  loading: number;
}
export interface ReadInspection {
  version: 1;
  supported: boolean;
  totals: PressureCounts;
  queries: readonly (PressureCounts & { name: string })[];
  recentWithdrawals: readonly { at: number; query: string; cause: string; code?: string }[];
  latency: { samples: number; queueMs: Percentiles; attemptMs: Percentiles };
}
interface Percentiles { p50: number | null; p95: number | null; max: number | null }
type Watch = ReadObservation<unknown> & { op: { name: string }; subscribers: Set<() => void> };
const emptyCounts = (): PressureCounts => ({ observations: 0, subscribers: 0, queued: 0, inFlight: 0, revalidating: 0, withdrawn: 0, loading: 0 });
const percentile = (values: number[]): Percentiles => {
  values.sort((a, b) => a - b);
  return { p50: values[Math.ceil(values.length * .5) - 1] ?? null, p95: values[Math.ceil(values.length * .95) - 1] ?? null, max: values.at(-1) ?? null };
};
const sources = new WeakMap<Client["observe"], () => ReadInspection>();
/** On-demand local/online observation pressure. No arguments, values or identities. */
export function inspect(client: Client): ReadInspection {
  return sources.get(client.observe)?.() ?? unsupported();
}
function unsupported(): ReadInspection { return { version: 1, supported: false, totals: emptyCounts(), queries: [], recentWithdrawals: [],
    latency: { samples: 0, queueMs: percentile([]), attemptMs: percentile([]) } };
}
export function forwardInspection(client: Client, raw: Client, valid: () => boolean): void {
  sources.set(client.observe, () => valid() ? inspect(raw) : unsupported());
}
export class ObservationWork<W extends Watch> extends ReadWork<W> {
  private watches: () => Iterable<W> = () => [];
  private readonly withdrawals: ReadInspection["recentWithdrawals"][number][] = [];
  private readonly timings: { queueMs: number; attemptMs: number }[] = [];
  constructor() {
    const queued = new WeakMap<W, number>(), started = new WeakMap<W, { at: number; queueMs: number }>();
    super(undefined, (watch, state) => {
      watch.withdrawal = (cause, code) => {
        this.withdrawals.push({ at: Date.now(), query: watch.op.name, cause, ...(code ? { code } : {}) });
        if (this.withdrawals.length > 64) this.withdrawals.shift();
      };
      const now = performance.now(), attempt = started.get(watch);
      if (state !== "in-flight" && attempt) {
        this.timings.push({ queueMs: attempt.queueMs, attemptMs: Math.max(0, now - attempt.at) });
        if (this.timings.length > 256) this.timings.shift();
        started.delete(watch);
      }
      if (state === "queued" && !queued.has(watch)) queued.set(watch, now);
      if (state === "in-flight") {
        started.set(watch, { at: now, queueMs: Math.max(0, now - (queued.get(watch) ?? now)) }); queued.delete(watch);
      }
      if (state === "idle") queued.delete(watch);
      watch.queueEpisode(state === "queued");
    });
  }
  bind(client: Client, watches: Map<string, W>): void { this.watches = () => watches.values(); sources.set(client.observe, () => this.inspect()); }
  inspect(): ReadInspection {
    const groups = new Map<string, PressureCounts>(), totals = emptyCounts();
    for (const watch of this.watches()) {
      let counts = groups.get(watch.op.name);
      if (!counts) groups.set(watch.op.name, counts = emptyCounts());
      const read = watch.snapshot, state = this.state(watch);
      counts.observations++; counts.subscribers += watch.subscribers.size;
      counts.queued += Number(state === "queued"); counts.inFlight += Number(state === "in-flight");
      counts.revalidating += Number("data" in read && read.revalidating === true);
      counts.loading += Number("loading" in read);
      counts.withdrawn += Number(watch.hasAnswered && !("data" in read));
    }
    for (const counts of groups.values()) for (const key of Object.keys(totals) as (keyof PressureCounts)[]) totals[key] += counts[key];
    return { version: 1, supported: true, totals, queries: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, counts]) => ({ name, ...counts })),
      recentWithdrawals: this.withdrawals.map(event => ({ ...event })),
      latency: { samples: this.timings.length, queueMs: percentile(this.timings.map(x => x.queueMs)), attemptMs: percentile(this.timings.map(x => x.attemptMs)) } };
  }
}
