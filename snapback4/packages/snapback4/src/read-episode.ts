import type { Read } from "./contract.ts";

// @ref LLP 3000.023#10 — queue capacity wait pauses, but never replenishes, the answer's budget.
export class EpisodeQueue {
  private since: number | undefined;
  private elapsed = 0;
  readonly listeners = new Set<() => void>();
  get paused(): boolean { return this.since !== undefined; }
  get time(): number { return this.elapsed + (this.since === undefined ? 0 : Math.max(0, Date.now() - this.since)); }
  set(queued: boolean): void {
    if (queued === this.paused) return;
    if (queued) this.since = Date.now();
    else { this.elapsed = this.time; this.since = undefined; }
    for (const notify of [...this.listeners]) notify();
  }
}
type Budget = { deadline: number; queue?: EpisodeQueue | undefined; offset: number };
const budgets = new WeakMap<Read<unknown>, Budget>();
const deadlineOf = (budget: Budget) => budget.deadline + (budget.queue?.time ?? 0) - budget.offset;
export const episodeDeadline = (read: Read<unknown>): number | undefined => {
  const budget = budgets.get(read); return budget && deadlineOf(budget);
};
export function copyEpisode(from: Read<unknown>, to: Read<unknown>): void {
  const source = budgets.get(from), target = budgets.get(to);
  // Facade copies share only timing, never answer contents or authority.
  if (source && (!target || deadlineOf(source) < deadlineOf(target))) budgets.set(to, source);
}
export function freezeEpisode(read: Read<unknown>, deadline: number): void {
  budgets.set(read, { deadline, offset: 0 });
}
export function beginEpisode(from: Read<unknown>, to: Read<unknown>, bounded: boolean, queue?: EpisodeQueue): void {
  copyEpisode(from, to);
  if (bounded && !budgets.has(to)) budgets.set(to, { deadline: Date.now() + 1000, queue, offset: queue?.time ?? 0 });
}

/** A deadline check and timer share one latch. Withdrawal does not fence the read in flight. */
export class ReadEpisode {
  private budget: Budget | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private withdraw: () => void) {}
  private changed = () => { this.stopTimer(); this.check(); this.schedule(); };
  arm(read: Read<unknown>): void {
    const budget = budgets.get(read);
    if (budget === this.budget) { budget?.queue?.listeners.add(this.changed); this.schedule(); return; }
    this.clear(); this.budget = budget;
    budget?.queue?.listeners.add(this.changed);
    this.schedule();
  }
  check(): void {
    if (this.budget && Date.now() >= deadlineOf(this.budget)) {
      this.clear(); this.withdraw();
    }
  }
  clear(): void { this.stop(); this.budget = undefined; }
  stop(): void { this.stopTimer(); this.budget?.queue?.listeners.delete(this.changed); }
  private stopTimer(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  private schedule(): void {
    if (!this.budget || this.budget.queue?.paused || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined; this.check(); this.schedule();
    }, Math.min(2_147_483_647, Math.max(0, deadlineOf(this.budget) - Date.now())));
    (this.timer as { unref?: () => void }).unref?.();
  }
}
