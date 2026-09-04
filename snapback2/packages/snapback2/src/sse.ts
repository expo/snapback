import type { Subscription } from "./types.js";

interface ParsedEvent { id?: string; data: string }
interface ErrorDecision<Event> { event?: Event; failure?: Error; retry: boolean }
export interface ReconnectingSseOptions<Event> {
  open(lastEventId: string | undefined, signal: AbortSignal): Promise<Response>;
  decode(event: ParsedEvent, current: () => boolean): Event | Promise<Event>;
  bufferedTerminal?(event: ParsedEvent): Error | undefined;
  onError(error: unknown, hadDelivery: boolean): Promise<ErrorDecision<Event>> | ErrorDecision<Event>;
  onLoss(last: Event | undefined): Event | undefined;
  terminal?(event: Event): Error | undefined;
  onEvent?: (event: Event) => void;
}
interface Waiter<Event> {
  predicate: (event: Event) => boolean;
  resolve: (event: Event) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function abortError(): Error {
  const error = new Error("subscription closed");
  error.name = "AbortError";
  return error;
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function* parseSse(
  response: Response,
  signal: AbortSignal,
  onActivity: () => void,
): AsyncGenerator<ParsedEvent> {
  if (!response.body) throw new Error("SSE response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let id: string | undefined;
  let finished = false;
  const line = (raw: string): ParsedEvent | undefined => {
    const value = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (value === "") {
      if (data.length === 0) return undefined;
      const event = { id, data: data.join("\n") };
      data = [];
      id = undefined;
      onActivity();
      return event;
    }
    if (value.startsWith(":")) {
      onActivity();
      return undefined;
    }
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    let fieldValue = colon < 0 ? "" : value.slice(colon + 1);
    if (fieldValue.startsWith(" ")) fieldValue = fieldValue.slice(1);
    if (field === "data") data.push(fieldValue);
    if (field === "id" && !fieldValue.includes("\0")) id = fieldValue;
    return undefined;
  };
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const event = line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (event) yield event;
        newline = buffer.indexOf("\n");
      }
      // A fence may race with a read that already returned bytes. Let the
      // transport inspect complete buffered frames for terminal authority
      // evidence, but never finalize an incomplete frame after abort.
      if (signal.aborted) throw abortError();
      if (chunk.done) {
        finished = true;
        break;
      }
    }
    if (buffer.length > 0) {
      const event = line(buffer);
      if (event) yield event;
    }
    const final = line("");
    if (final) yield final;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// @ref LLP 1002#4-the-wire — streaming fetch consumes SSE id/data frames and ignores heartbeat comments in browsers and Node.
export class ReconnectingSse<Event> implements Subscription<Event> {
  private readonly controller = new AbortController();
  private readonly waiters = new Set<Waiter<Event>>();
  private last: Event | undefined;
  private lastEventId: string | undefined;
  private terminalFailure: Error | undefined;
  private closed = false;
  private activeAttempt?: AbortController;
  private retryNow?: () => void;
  private resets = 0;
  private running?: Promise<void>;

  constructor(private readonly options: ReconnectingSseOptions<Event>) {
    this.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(abortError());
    }
    this.waiters.clear();
  }

  /** Interrupt only the current attempt; the reconnecting subscription stays mounted. */
  reconnect(): void {
    if (this.closed) return;
    this.activeAttempt?.abort();
    this.retryNow?.();
  }

  /** A successor starts a new stream, with no predecessor event id or answer. */
  reset(): void {
    if (this.closed) return;
    this.terminalFailure = undefined;
    this.resets += 1;
    this.lastEventId = undefined;
    this.last = undefined;
    this.reconnect();
    this.start();
  }

  until(predicate: (event: Event) => boolean, timeoutMs = 30_000): Promise<Event> {
    if (this.terminalFailure) return Promise.reject(this.terminalFailure);
    if (this.last !== undefined && predicate(this.last)) return Promise.resolve(this.last);
    if (this.closed) return Promise.reject(abortError());
    return new Promise<Event>((resolve, reject) => {
      const waiter: Waiter<Event> = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`subscription condition timed out after ${timeoutMs} ms`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private deliver(event: Event, settleWaiters = true): void {
    this.last = event;
    try {
      this.options.onEvent?.(event);
    } catch {
      // A consumer callback must not tear down the transport.
    }
    if (!settleWaiters) return;
    for (const waiter of [...this.waiters]) {
      let matches = false;
      try {
        matches = waiter.predicate(event);
      } catch (error) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      if (!matches) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(event);
    }
  }

  private fail(error: Error): void {
    this.terminalFailure = error;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private start(): void {
    if (this.closed || this.running) return;
    const reset = this.resets;
    const run = this.run();
    this.running = run;
    void run.finally(() => {
      this.running = undefined;
      // reset() can clear a terminal latch while the old run is unwinding.
      if (!this.closed && !this.terminalFailure && reset !== this.resets) this.start();
    }).catch(() => undefined);
  }

  private async run(): Promise<void> {
    let backoff = 250;
    let hadDelivery = false;
    let lossReported = false;
    while (!this.closed) {
      const reset = this.resets;
      const attempt = new AbortController();
      this.activeAttempt = attempt;
      const closeAttempt = () => attempt.abort();
      this.controller.signal.addEventListener("abort", closeAttempt, { once: true });
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let idle = false;
      let decodingTerminal: Error | undefined;
      const current = () => !this.closed && reset === this.resets && !attempt.signal.aborted;
      const armIdle = () => {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idle = true;
          attempt.abort();
        }, 30_000);
      };
      try {
        armIdle();
        const response = await this.options.open(this.lastEventId, attempt.signal);
        if (!response.ok) throw response;
        for await (const parsed of parseSse(response, attempt.signal, armIdle)) {
          if (this.closed || attempt.signal.aborted) {
            let terminal: Error | undefined;
            try {
              terminal = this.options.bufferedTerminal?.(parsed);
            } catch {
              // Malformed or stale nonterminal buffered frames stay suppressed.
            }
            if (terminal !== undefined) {
              try {
                await this.options.onError(terminal, hadDelivery);
              } catch {
                // A closed transport has no remaining observer to fail.
              }
              return;
            }
            continue;
          }
          try { decodingTerminal = this.options.bufferedTerminal?.(parsed); } catch { decodingTerminal = undefined; }
          const event = await this.options.decode(parsed, current);
          decodingTerminal = undefined;
          if (!current()) continue;
          if (parsed.id !== undefined) this.lastEventId = parsed.id;
          this.deliver(event);
          hadDelivery = true;
          lossReported = false;
          backoff = 250;
          const terminal = this.options.terminal?.(event);
          if (terminal !== undefined) {
            this.fail(terminal);
            return;
          }
        }
        if (this.closed) return;
        if (reset === this.resets && !lossReported) {
          const loss = this.options.onLoss(this.last);
          if (loss !== undefined) this.deliver(loss);
          lossReported = true;
        }
      } catch (error) {
        // Session evidence survives a decode crossing reset/close; onError
        // still fences it by the exact bearer before retiring any custody.
        if (decodingTerminal && !current()) {
          const decision = await this.options.onError(decodingTerminal, hadDelivery);
          if (!this.closed) {
            if (decision.event !== undefined) this.deliver(decision.event, decision.failure === undefined);
            if (decision.failure !== undefined) this.fail(decision.failure);
          }
          return;
        }
        if (this.closed || this.controller.signal.aborted) return;
        if (reset !== this.resets) continue;
        const failure = idle
          ? new Error("SSE stream idle for 30000 ms")
          : error;
        const decision = await this.options.onError(failure, hadDelivery);
        if (this.closed || this.controller.signal.aborted) return;
        if (decision.event !== undefined) this.deliver(decision.event, decision.failure === undefined);
        if (decision.failure !== undefined) this.fail(decision.failure);
        if (!decision.retry) return;
        if (!lossReported) {
          const loss = this.options.onLoss(this.last);
          if (loss !== undefined) this.deliver(loss);
          lossReported = true;
        }
      } finally {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        this.controller.signal.removeEventListener("abort", closeAttempt);
        if (this.activeAttempt === attempt) this.activeAttempt = undefined;
      }
      if (reset !== this.resets) continue;
      try {
        await Promise.race([
          delay(backoff, this.controller.signal),
          new Promise<void>((resolve) => { this.retryNow = resolve; }),
        ]);
      } catch {
        return;
      } finally {
        this.retryNow = undefined;
      }
      backoff = Math.min(backoff * 2, 5_000);
    }
  }
}
