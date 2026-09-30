// @ref LLP 3000.023#10 — bound observation starts; expiry and scope resets stay synchronous.
// Each client owns a queue. Distinct watches share capacity; repeated requests
// for a queued watch coalesce. Active watches keep their existing dirty fence.
export const READ_WORK_LIFETIME = 30_000;
export const READ_WORK_EXPIRED = Symbol("read attempt expired");
export function checkRead(signal?: AbortSignal): void { if (signal?.aborted) throw signal.reason; }

// Use the basic AbortController surface shared by web, process and Expo hosts.
// Detach listeners when the transport finishes, even if it ignored abort.
export function withReadSignal<T>(attempt: AbortSignal | undefined, lifetime: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (!attempt) return run(lifetime);
  const controller = new AbortController();
  const clean = () => { attempt.removeEventListener("abort", stop); lifetime.removeEventListener("abort", stop); };
  const stop = () => { clean(); controller.abort(); };
  attempt.addEventListener("abort", stop, { once: true }); lifetime.addEventListener("abort", stop, { once: true });
  if (attempt.aborted || lifetime.aborted) stop();
  return run(controller.signal).finally(clean);
}

// Stop waiting even when an adapter ignores abort. Its continuation must still
// check the signal before adopting evidence or publishing a late answer.
export function duringRead<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const stop = () => { clean(); reject(signal.reason); };
    const clean = () => signal.removeEventListener("abort", stop);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    void work.then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
  });
}

export type ReadWorkState = "queued" | "in-flight" | "idle";
export class ReadWork<W> {
  private readonly pending = new Map<W, (signal: AbortSignal) => Promise<void>>();
  private readonly priority = new Map<W, (signal: AbortSignal) => Promise<void>>();
  private readonly urgent = new Set<W>();
  private readonly active = new Map<W, AbortController>();
  private readonly delayed = new Map<W, ReturnType<typeof setTimeout>>();
  private starts = 0;
  private urgentStarts = 0;
  private queued = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly later: (run: () => void) => ReturnType<typeof setTimeout> = run => setTimeout(run, 0),
    private readonly changed: (watch: W, state: ReadWorkState) => void = () => {}) {}
  schedule(watch: W, run: (signal: AbortSignal) => Promise<void>): void {
    this.stopDelay(watch);
    (this.urgent.has(watch) ? this.priority : this.pending).set(watch, run);
    if (!this.active.has(watch)) this.changed(watch, "queued");
    this.arm();
  }
  prioritize(watch: W): void {
    if (this.pending.has(watch) || this.priority.has(watch) || this.active.has(watch) || this.delayed.has(watch)) this.urgent.add(watch);
    const run = this.pending.get(watch);
    if (run) { this.pending.delete(watch); this.priority.set(watch, run); }
  }
  retry(watch: W, delay: number, run: (signal: AbortSignal) => Promise<void>): void {
    this.stopDelay(watch);
    const timer = setTimeout(() => {
      if (this.delayed.get(watch) !== timer) return;
      this.delayed.delete(watch); this.schedule(watch, run);
    }, delay);
    this.delayed.set(watch, timer);
  }
  private stopDelay(watch: W): boolean {
    const timer = this.delayed.get(watch);
    if (timer === undefined) return false;
    clearTimeout(timer); this.delayed.delete(watch); return true;
  }
  cancel(watch: W): boolean {
    const delayed = this.stopDelay(watch), pending = this.pending.delete(watch), priority = this.priority.delete(watch), active = this.active.get(watch);
    this.urgent.delete(watch);
    active?.abort();
    if (!active && (delayed || pending || priority)) this.changed(watch, "idle");
    return delayed || pending || priority || !!active;
  }
  clear(): void {
    for (const watch of this.delayed.keys()) this.stopDelay(watch);
    for (const watch of this.pending.keys()) if (!this.active.has(watch)) this.changed(watch, "idle");
    for (const watch of this.priority.keys()) if (!this.active.has(watch)) this.changed(watch, "idle");
    this.pending.clear(); this.priority.clear(); this.urgent.clear(); this.urgentStarts = 0;
    for (const attempt of this.active.values()) attempt.abort();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  state(watch: W): ReadWorkState { return this.active.has(watch) ? "in-flight" : this.pending.has(watch) || this.priority.has(watch) || this.delayed.has(watch) ? "queued" : "idle"; }
  private first(queue: Map<W, unknown>): W | undefined {
    // Only active owners (at most eight) can precede the first runnable entry.
    for (const watch of queue.keys()) if (!this.active.has(watch)) return watch;
  }
  // @ref LLP 3000.023#10 — at most eight urgent starts overtake waiting FIFO work.
  private *candidates(): Generator<W> {
    while (true) {
      const ordinary = this.first(this.pending), urgent = this.first(this.priority);
      const watch = urgent !== undefined && (ordinary === undefined || this.urgentStarts < 8) ? urgent : ordinary;
      if (watch === undefined) return;
      yield watch;
    }
  }
  private arm(): void {
    if (this.queued || (!this.pending.size && !this.priority.size) || this.active.size >= 8) return;
    if (this.timer === undefined) this.timer = this.later(() => {
      this.timer = undefined; this.starts = 0; this.arm();
    });
    if (this.starts === 8) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      for (const watch of this.candidates()) {
        const run = this.priority.get(watch) ?? this.pending.get(watch);
        if (!run) continue;
        if (this.starts === 8 || this.active.size === 8) break;
        if (this.active.has(watch)) continue;
        this.urgentStarts = this.urgent.has(watch) ? Math.min(8, this.urgentStarts + 1) : 0;
        this.pending.delete(watch); this.priority.delete(watch); this.urgent.delete(watch);
        const attempt = new AbortController();
        this.active.set(watch, attempt); this.starts++;
        this.changed(watch, "in-flight");
        const deadline = setTimeout(() => attempt.abort(READ_WORK_EXPIRED), READ_WORK_LIFETIME);
        const release = () => {
          clearTimeout(deadline);
          if (this.active.get(watch) !== attempt) return;
          this.active.delete(watch);
          if (!this.pending.has(watch) && !this.priority.has(watch) && !this.delayed.has(watch)) this.urgent.delete(watch);
          this.changed(watch, this.pending.has(watch) || this.priority.has(watch) ? "queued" : "idle"); this.arm();
        };
        attempt.signal.addEventListener("abort", release, { once: true });
        void Promise.resolve().then(() => { checkRead(attempt.signal); return run(attempt.signal); })
          .catch(() => {}).finally(() => { attempt.signal.removeEventListener("abort", release); release(); });
      }
    });
  }
}
