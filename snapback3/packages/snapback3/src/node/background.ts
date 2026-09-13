import { OwnerError, type WorkerTransport } from "./worker.js";

export interface CommitDetails {
  seq?: unknown;
  generation?: unknown;
}

export interface EffectRunnerEvent {
  id: string;
  effect: string;
  state: string;
  attempt?: number;
  code?: string;
  capture?: unknown;
}

/** The effect implementation owns isolation and provider I/O. The owner only
 * needs a coalescing wakeup and an orderly lifecycle boundary. */
export interface EffectRunnerLifecycle {
  poke(): void;
  close(): Promise<void>;
}

export interface EffectRunnerOptions {
  worker: WorkerTransport;
  onCommit(details: CommitDetails): void;
  onEvent?(event: EffectRunnerEvent): void;
  log?: (message: string) => void;
}

interface BackgroundTurn {
  at: number;
  timers: unknown[];
  job: unknown;
  seq: number;
  nextTimerAt: number | null;
  clockQueries: Record<string, { granularityMs: number }>;
}

export interface BackgroundOptions {
  worker: WorkerTransport;
  onCommit(details: CommitDetails): void;
  onClock(operations: readonly string[]): void;
  effectRunner?: EffectRunnerLifecycle;
  log?: (message: string) => void;
  onFatal?(error: OwnerError): void;
  pollMs?: number;
  transportRetries?: number;
  transportRetryMs?: number;
  transportRetryMaxMs?: number;
  busyRetryMs?: number;
  busyRetryMaxMs?: number;
  closeTimeoutMs?: number;
  now?: () => number;
}

/** Drives one private bounded turn at a time. Every continuation crosses a
 * timer boundary so foreground requests can enter the serial worker queue. */
// @ref LLP 2000#17-completing-the-full-clique-product — periodic work runs without clients and yields between bounded turns.
// @ref LLP 1025.001#d1--the-rule — the worker owns the timer-first barrier inside each bounded turn.
export class BackgroundOwner {
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private closed = false;
  private dirty = false;
  private started = false;
  private transportFailures = 0;
  private busyTurns = 0;
  private failure?: OwnerError;
  private lastSeq = -1;
  private generation?: string;
  private nextTimerAt: number | null = null;
  private readonly clocks = new Map<string, { granularityMs: number; nextAt: number }>();
  private readonly now: () => number;

  constructor(private readonly options: BackgroundOptions) {
    this.now = options.now ?? Date.now;
  }

  start(initial: CommitDetails = {}): void {
    if (this.started || this.closed || this.failure) return;
    this.started = true;
    this.remember(initial, false);
    this.schedule(0);
  }

  /** Records an actually observed worker commit/generation and wakes both
   * autonomous owners. Values that are not worker-issued identities are ignored. */
  noteCommit(details: CommitDetails): void {
    if (this.remember(details, true)) this.options.effectRunner?.poke();
    this.poke();
  }

  poke(): void {
    if (this.closed || this.failure) return;
    this.dirty = true;
    if (!this.running) this.schedule(0);
  }

  private remember(details: CommitDetails, publish: boolean): boolean {
    const seq = safeSequence(details.seq);
    const generation = typeof details.generation === "string" && details.generation.length
      ? details.generation
      : undefined;
    const seqChanged = seq !== undefined && seq > this.lastSeq;
    const generationChanged = generation !== undefined && generation !== this.generation;
    if (seq !== undefined) this.lastSeq = Math.max(this.lastSeq, seq);
    if (generation !== undefined) this.generation = generation;
    if (publish && (seqChanged || generationChanged)) {
      this.options.onCommit({ ...(seq !== undefined ? { seq } : {}), ...(generation !== undefined ? { generation } : {}) });
    }
    return seqChanged || generationChanged;
  }

  private schedule(delay: number): void {
    if (this.closed || this.failure) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.running) {
        const turn = this.turn();
        this.running = turn;
        void turn.finally(() => { if (this.running === turn) this.running = undefined; });
      }
    }, Math.max(0, Math.min(delay, 2_147_483_647)));
    this.timer.unref();
  }

  private async turn(): Promise<void> {
    this.dirty = false;
    let immediate = false;
    let retryDelay: number | undefined;
    try {
      const raw = await this.options.worker.request("background.turn", {});
      const result = backgroundTurn(raw);
      this.nextTimerAt = result.nextTimerAt;
      const clockDue = this.updateClocks(result.clockQueries, result.at);
      if (clockDue.length) this.options.onClock(clockDue);
      const committed = this.remember({ seq: result.seq }, true);
      if (committed) this.options.effectRunner?.poke();
      immediate = result.timers.length > 0 || result.job !== null;
      this.transportFailures = 0;
      this.busyTurns = 0;
    } catch (error) {
      const reason = backgroundError(error);
      this.options.log?.(`S3_BACKGROUND: ${reason.code}: ${reason.message}`);
      if (reason.code === "S3_OWNER_BUSY") {
        // Local capacity is healthy backpressure, not a failed child. Keep it
        // outside the bounded transport budget and yield fairly until the
        // admitted foreground work releases capacity.
        this.busyTurns++;
        const base = boundedPositive(this.options.busyRetryMs ?? 2, 2);
        const ceiling = boundedPositive(this.options.busyRetryMaxMs ?? 100, 100);
        retryDelay = Math.min(ceiling, base * (2 ** Math.min(this.busyTurns - 1, 20)));
      } else if (recoverableTransport(reason)) {
        this.transportFailures++;
        const retries = boundedCount(this.options.transportRetries, 3);
        if (this.transportFailures <= retries) {
          const base = boundedPositive(this.options.transportRetryMs ?? 50, 50);
          const ceiling = boundedPositive(this.options.transportRetryMaxMs ?? 1_000, 1_000);
          retryDelay = Math.min(ceiling, base * (2 ** Math.min(this.transportFailures - 1, 20)));
        } else this.fail(reason);
      } else this.fail(reason);
    } finally {
      if (this.closed || this.failure) return;
      // A zero-delay timer is an intentional event-loop yield, not a recursive
      // promise continuation. One turn can never queue the next turn inline.
      if (retryDelay !== undefined) this.schedule(retryDelay);
      else if (this.dirty || immediate) this.schedule(0);
      else this.schedule(this.nextDelay());
    }
  }

  private fail(error: OwnerError): void {
    if (this.failure || this.closed) return;
    this.failure = error;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.options.onFatal?.(error);
  }

  private updateClocks(next: Record<string, { granularityMs: number }>, at: number): string[] {
    const due: string[] = [];
    const names = new Set(Object.keys(next));
    for (const name of this.clocks.keys()) if (!names.has(name)) this.clocks.delete(name);
    for (const [name, declaration] of Object.entries(next)) {
      const current = this.clocks.get(name);
      if (!current || current.granularityMs !== declaration.granularityMs) {
        this.clocks.set(name, {
          granularityMs: declaration.granularityMs,
          nextAt: nextBoundary(at, declaration.granularityMs),
        });
      } else if (at >= current.nextAt) {
        due.push(name);
        current.nextAt = nextBoundary(at, current.granularityMs);
      }
    }
    return due;
  }

  private nextDelay(): number {
    const now = this.now();
    let delay = boundedPositive(this.options.pollMs ?? 1_000, 1_000);
    if (this.nextTimerAt !== null) delay = Math.min(delay, Math.max(0, this.nextTimerAt - now));
    for (const { nextAt } of this.clocks.values()) delay = Math.min(delay, Math.max(0, nextAt - now));
    return delay;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const running = this.running;
    if (running) await boundedSettlement(running, this.options.closeTimeoutMs ?? 2_000);
    await this.options.effectRunner?.close();
  }
}

function backgroundTurn(value: unknown): BackgroundTurn {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocol("background turn must be an object");
  const turn = value as Record<string, unknown>;
  const at = safeSequence(turn.at), seq = safeSequence(turn.seq);
  if (at === undefined || seq === undefined || !Array.isArray(turn.timers)) throw protocol("background turn has invalid at, seq, or timers");
  const nextTimerAt = turn.nextTimerAt === null ? null : safeSequence(turn.nextTimerAt);
  if (nextTimerAt === undefined) throw protocol("background turn has an invalid nextTimerAt");
  if (!turn.clockQueries || typeof turn.clockQueries !== "object" || Array.isArray(turn.clockQueries)) throw protocol("background turn has invalid clockQueries");
  const clockQueries: Record<string, { granularityMs: number }> = {};
  for (const [name, raw] of Object.entries(turn.clockQueries as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw protocol(`clock query ${name} is invalid`);
    const granularityMs = safeSequence((raw as Record<string, unknown>).granularityMs);
    if (granularityMs === undefined || granularityMs < 1) throw protocol(`clock query ${name} has invalid granularity`);
    clockQueries[name] = { granularityMs };
  }
  return { at, seq, timers: turn.timers, job: turn.job ?? null, nextTimerAt, clockQueries };
}

function safeSequence(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0) ? value as number : undefined;
}

function nextBoundary(at: number, granularityMs: number): number {
  return Math.floor(at / granularityMs) * granularityMs + granularityMs;
}

function boundedPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 2_147_483_647) : fallback;
}

function protocol(message: string): OwnerError {
  return new OwnerError("S3_WORKER_PROTOCOL", `The worker ${message}.`);
}

function backgroundError(error: unknown): OwnerError {
  return error instanceof OwnerError
    ? error
    : new OwnerError("S3_BACKGROUND", error instanceof Error ? error.message : String(error));
}

function recoverableTransport(error: OwnerError): boolean {
  return ["S3_WORKER_IO", "S3_WORKER_EXIT", "S3_WORKER_TIMEOUT", "S3_WORKER_STOPPING", "S3_WORKER_START"].includes(error.code);
}

function boundedCount(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 10) : fallback;
}

async function boundedSettlement(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>(done => { timer = setTimeout(done, boundedPositive(timeoutMs, 2_000)); timer.unref(); }),
  ]);
  if (timer) clearTimeout(timer);
}
