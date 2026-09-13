import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerTransport } from "./worker";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface EffectRunnerLifecycle {
  poke(): void;
  close(): Promise<void>;
}

export interface EffectRunnerEvent {
  id: string;
  effect: string;
  state: string;
  attempt?: number;
  code?: string;
  capture?: unknown;
}

export interface EffectRunnerLimits {
  durationMs: number;
  memoryMb: number;
  requestBytes: number;
  responseBytes: number;
  resultBytes: number;
  logBytes: number;
  logEntries: number;
  outputBytes: number;
  concurrentFetches: number;
  totalFetches: number;
  redirects: number;
  timers: number;
  claimsPerPoke: number;
  settlementAttempts: number;
  settlementRetryMs: number;
  closeDrainMs: number;
  childExitMs: number;
}

export interface EffectRunnerOptions {
  worker: WorkerTransport;
  onCommit(details: { seq?: unknown; generation?: unknown }): void;
  onEvent?(event: EffectRunnerEvent): void;
  log?: (message: string) => void;
  limits?: Partial<EffectRunnerLimits>;
  /** Internal test seam. Production always uses the adjacent built child. */
  childEntry?: URL;
}

interface OutboxRow {
  id: string;
  effect: string;
  payload: Json;
  state: string;
  attempts: number;
  generation?: unknown;
}

interface EffectClaim {
  row: OutboxRow;
  declaration: { name: string; source: string; grants: string[]; then: string | null };
}

interface ClaimResponse {
  failed: OutboxRow[];
  claim: EffectClaim | null;
  recoveredThen: OutboxRow | null;
  seq?: unknown;
  more: boolean;
}

interface Settlement {
  id: string;
  state: "sent" | "queued" | "failed";
  result?: Json;
  error?: string;
  nextAt?: number;
}

interface SettlementResponse { row: OutboxRow & { thenSeq?: unknown }; seq?: unknown }

interface ChildSuccess {
  ok: true;
  result: Json;
  logs: unknown;
  stray: { fetches: number; timers: number };
}

interface ChildFailure {
  ok: false;
  error: { code: string; message: string; retry: boolean };
  logs?: unknown;
  stray?: { fetches: number; timers: number };
}

type ChildOutcome = ChildSuccess | ChildFailure;

const DEFAULT_LIMITS: EffectRunnerLimits = {
  durationMs: 30_000,
  memoryMb: 192,
  requestBytes: 1024 * 1024,
  responseBytes: 4 * 1024 * 1024,
  resultBytes: 16 * 1024,
  logBytes: 32 * 1024,
  logEntries: 100,
  outputBytes: 64 * 1024,
  concurrentFetches: 4,
  totalFetches: 16,
  redirects: 10,
  timers: 64,
  claimsPerPoke: 16,
  settlementAttempts: 3,
  settlementRetryMs: 25,
  closeDrainMs: 5_000,
  childExitMs: 1_000,
};

// @ref LLP 2000#17-completing-the-full-clique-product — Node owns bounded
// provider I/O while effect.claim/effect.settle leave durable authority and
// authored `then` execution in the serial worker.
export function createEffectRunner(options: EffectRunnerOptions): EffectRunnerLifecycle {
  return new NodeEffectRunner(options);
}

class NodeEffectRunner implements EffectRunnerLifecycle {
  private readonly limits: EffectRunnerLimits;
  private readonly childEntry: URL;
  private readonly children = new Set<ChildProcess>();
  private requested = false;
  private closing = false;
  private draining?: Promise<void>;
  private pendingSettlement?: { claim: EffectClaim; settlement: Settlement };

  constructor(private readonly options: EffectRunnerOptions) {
    this.limits = normalizeLimits(options.limits);
    this.childEntry = options.childEntry ?? new URL("./effect-child.mjs", import.meta.url);
  }

  poke(): void {
    if (this.closing) return;
    this.requested = true;
    this.ensureDrain();
  }

  private ensureDrain(): void {
    if (this.draining) return;
    this.draining = this.drain().catch(error => {
      this.report({ id: "runner", effect: "runner", state: "error", code: errorCode(error) });
    }).finally(() => {
      this.draining = undefined;
      if (this.requested && !this.closing) this.ensureDrain();
    });
  }

  private async drain(): Promise<void> {
    this.requested = false;
    let turns = 0;
    let more = false;
    if (this.pendingSettlement && !await this.settlePending()) return;
    while (!this.closing && turns++ < this.limits.claimsPerPoke) {
      let response: ClaimResponse;
      try { response = parseClaimResponse(await this.options.worker.request("effect.claim", {})); }
      catch (error) {
        this.report({ id: "runner", effect: "runner", state: "claim_error", code: errorCode(error) });
        return;
      }
      more = response.more;
      for (const row of response.failed) {
        this.report({ id: row.id, effect: row.effect, state: "failed", attempt: row.attempts, code: "E_EFFECT_UNKNOWN" });
      }
      if (response.recoveredThen) {
        this.report({
          id: response.recoveredThen.id, effect: response.recoveredThen.effect,
          state: response.recoveredThen.state, attempt: response.recoveredThen.attempts,
        });
        this.commit(response.seq, response.recoveredThen.generation);
      }
      if (response.claim) await this.executeClaim(response.claim);
      if (this.pendingSettlement && !await this.settlePending()) return;
      if (!response.more && !this.requested) return;
    }
    if (more && !this.closing) this.report({ id: "runner", effect: "runner", state: "work_remaining" });
  }

  private async executeClaim(claim: EffectClaim): Promise<void> {
    const { row } = claim;
    this.report({ id: row.id, effect: row.effect, state: "running", attempt: row.attempts });
    let outcome: ChildOutcome;
    try {
      outcome = await this.runChild(claim);
    } catch (error) {
      const failure = error as Error & { ambiguous?: boolean; code?: string };
      if (failure.ambiguous) {
        // The child crossed the acknowledged socket-dispatch barrier. There is
        // no honest settlement state available here: leave durable `running`
        // custody for the owner's next startup effect.recover → sent_unknown.
        this.report({ id: row.id, effect: row.effect, state: "outcome_unknown", attempt: row.attempts, code: failure.code });
        return;
      }
      const errorText = boundedError(failure);
      this.pendingSettlement = {
        claim,
        settlement: failureSettlement(row, failure.code ?? "E_EFFECT_CHILD_EXIT", errorText),
      };
      return;
    }
    this.report({
      id: row.id,
      effect: row.effect,
      state: outcome.ok ? "executed" : "execution_failed",
      attempt: row.attempts,
      code: outcome.ok ? undefined : outcome.error.code,
      capture: { logs: outcome.logs, stray: outcome.stray },
    });
    const settlement: Settlement = outcome.ok
      ? { id: row.id, state: "sent", result: outcome.result }
      : failureSettlement(row, outcome.error.code, outcome.error.message, outcome.error.retry);
    this.pendingSettlement = { claim, settlement };
  }

  private async settlePending(): Promise<boolean> {
    const pending = this.pendingSettlement;
    if (!pending) return true;
    for (let attempt = 1; attempt <= this.limits.settlementAttempts; attempt++) {
      try {
        const response = parseSettlementResponse(await this.options.worker.request("effect.settle", { ...pending.settlement }));
        this.pendingSettlement = undefined;
        this.report({
          id: response.row.id, effect: response.row.effect, state: response.row.state,
          attempt: response.row.attempts,
          code: response.row.state === "sent_unknown" ? "E_EFFECT_OUTCOME_UNKNOWN" : undefined,
        });
        this.commit(response.seq, response.row.generation);
        return true;
      } catch (error) {
        this.report({
          id: pending.claim.row.id, effect: pending.claim.row.effect, state: "settle_error",
          attempt: pending.claim.row.attempts, code: errorCode(error),
        });
        if (attempt < this.limits.settlementAttempts) await delay(this.limits.settlementRetryMs * attempt);
      }
    }
    return false;
  }

  private runChild(claim: EffectClaim): Promise<ChildOutcome> {
    const row = claim.row;
    const child = spawn(process.execPath, [
      `--max-old-space-size=${Math.max(16, Math.floor(this.limits.memoryMb / 2))}`,
      fileURLToPath(this.childEntry),
    ], {
      cwd: dirname(fileURLToPath(this.childEntry)),
      env: childEnvironment(),
      serialization: "json",
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });
    this.children.add(child);
    let dispatched = false;
    let finished = false;
    let outputBytes = 0;
    return new Promise<ChildOutcome>((resolve, reject) => {
      const deadline = setTimeout(() => {
        const error = runnerError("E_EFFECT_TIMEOUT", `effect exceeded ${this.limits.durationMs} ms`, dispatched);
        finishError(error);
        terminate(child);
      }, this.limits.durationMs);
      deadline.unref();
      const finishError = (error: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        reject(error);
      };
      const finishResult = (outcome: ChildOutcome) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        resolve(outcome);
      };
      const countOutput = (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > this.limits.outputBytes) {
          finishError(runnerError("E_EFFECT_OUTPUT_LIMIT", "effect child output exceeded its bound", dispatched));
          terminate(child);
        }
      };
      child.stdout?.on("data", countOutput);
      child.stderr?.on("data", countOutput);
      child.on("message", message => {
        if (!message || typeof message !== "object") {
          finishError(runnerError("E_EFFECT_PROTOCOL", "effect child returned a non-JSON message", dispatched));
          terminate(child);
          return;
        }
        const frame = message as Record<string, unknown>;
        if (frame.type === "dispatch" && Number.isSafeInteger(frame.token)) {
          dispatched = true;
          child.send?.({ type: "dispatch-ack", token: frame.token }, error => {
            if (error) finishError(runnerError("E_EFFECT_CHILD_IO", "effect dispatch acknowledgement failed", true));
          });
          return;
        }
        if (frame.type === "result") {
          try { finishResult(parseChildOutcome(frame)); }
          catch (error) {
            finishError(runnerError("E_EFFECT_PROTOCOL", boundedError(error), dispatched));
            terminate(child);
          }
          return;
        }
        finishError(runnerError("E_EFFECT_PROTOCOL", "effect child returned an unknown message", dispatched));
        terminate(child);
      });
      child.on("error", error => finishError(runnerError("E_EFFECT_CHILD_START", error.message, dispatched)));
      child.on("close", (code, signal) => {
        this.children.delete(child);
        if (!finished) finishError(runnerError(
          "E_EFFECT_CHILD_EXIT", `effect child stopped (${signal ?? code ?? "unknown"})`, dispatched,
        ));
      });
      const job = {
        type: "run",
        source: claim.declaration.source,
        grants: claim.declaration.grants,
        payload: row.payload,
        meta: { id: row.id, effect: row.effect, attempt: row.attempts },
        limits: childLimits(this.limits),
      };
      let encoded: string;
      try { encoded = JSON.stringify(job); }
      catch {
        finishError(runnerError("E_EFFECT_PROTOCOL", "effect claim is not JSON", false));
        terminate(child);
        return;
      }
      if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) {
        finishError(runnerError("E_EFFECT_PROTOCOL", "effect claim exceeds the child IPC bound", false));
        terminate(child);
        return;
      }
      child.send?.(JSON.parse(encoded), error => {
        if (error) finishError(runnerError("E_EFFECT_CHILD_IO", "effect child job delivery failed", false));
      });
    });
  }

  private report(event: EffectRunnerEvent): void {
    try { this.options.onEvent?.(event); }
    catch (error) { this.writeError(`effect event callback failed: ${boundedError(error)}`); }
    if (event.code || event.state.endsWith("error") || event.state === "outcome_unknown") {
      this.writeError(`snapback3 effect ${event.id} ${event.state}${event.code ? ` (${event.code})` : ""}`);
    }
  }

  private commit(seq: unknown, generation: unknown): void {
    if (seq === undefined) return;
    try { this.options.onCommit({ seq, generation }); }
    catch (error) {
      this.report({ id: "runner", effect: "runner", state: "commit_callback_error", code: errorCode(error) });
    }
  }

  private writeError(message: string): void {
    (this.options.log ?? console.error)(message);
  }

  async close(): Promise<void> {
    if (this.closing) {
      if (this.draining) await boundedWait(this.draining, this.limits.closeDrainMs);
      return;
    }
    this.closing = true;
    this.requested = false;
    if (this.pendingSettlement && !this.draining) this.ensureDrain();
    if (this.draining) await boundedWait(this.draining, this.limits.closeDrainMs);
    for (const child of this.children) terminate(child);
    await boundedWait(Promise.all([...this.children].map(childExit)), this.limits.childExitMs);
    for (const child of this.children) child.kill("SIGKILL");
    await boundedWait(Promise.all([...this.children].map(childExit)), this.limits.childExitMs);
    if (this.draining) await boundedWait(this.draining, this.limits.childExitMs);
  }
}

function failureSettlement(row: OutboxRow, code: string, message: string, retry = true): Settlement {
  const error = `${code}: ${message}`.slice(0, 2_048);
  if (retry && row.attempts < 5) {
    const exponent = Math.max(0, Math.min(30, row.attempts - 1));
    return { id: row.id, state: "queued", error, nextAt: Date.now() + 1_000 * 2 ** exponent };
  }
  return { id: row.id, state: "failed", error };
}

function parseClaimResponse(value: unknown): ClaimResponse {
  if (!isRecord(value) || !Array.isArray(value.failed) || typeof value.more !== "boolean"
    || !(value.claim === null || isRecord(value.claim))
    || !(value.recoveredThen === null || isRecord(value.recoveredThen))) {
    throw runnerError("E_EFFECT_PROTOCOL", "worker returned an invalid effect claim", false);
  }
  const failed = value.failed.map(parseRow);
  const recoveredThen = value.recoveredThen === null ? null : parseRow(value.recoveredThen);
  let claim: EffectClaim | null = null;
  if (value.claim !== null) {
    const raw = value.claim;
    if (!isRecord(raw.row) || !isRecord(raw.declaration)) {
      throw runnerError("E_EFFECT_PROTOCOL", "worker returned an invalid effect declaration", false);
    }
    const row = parseRow(raw.row);
    const declaration = raw.declaration;
    if (typeof declaration.name !== "string" || declaration.name !== row.effect
      || typeof declaration.source !== "string" || declaration.source.length > 1024 * 1024
      || !Array.isArray(declaration.grants) || !declaration.grants.every(grant => typeof grant === "string")
      || !(declaration.then === null || typeof declaration.then === "string")) {
      throw runnerError("E_EFFECT_PROTOCOL", "worker returned an invalid effect declaration", false);
    }
    claim = { row, declaration: declaration as EffectClaim["declaration"] };
  }
  return { failed, claim, recoveredThen, seq: value.seq, more: value.more };
}

function parseRow(value: unknown): OutboxRow {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.effect !== "string"
    || typeof value.state !== "string" || !Number.isSafeInteger(value.attempts) || (value.attempts as number) < 0
    || !isJson(value.payload)) {
    throw runnerError("E_EFFECT_PROTOCOL", "worker returned an invalid outbox row", false);
  }
  return value as unknown as OutboxRow;
}

function parseSettlementResponse(value: unknown): SettlementResponse {
  if (!isRecord(value) || !isRecord(value.row)) {
    throw runnerError("E_EFFECT_PROTOCOL", "worker returned an invalid effect settlement", false);
  }
  return { row: parseRow(value.row) as SettlementResponse["row"], seq: value.seq };
}

function parseChildOutcome(frame: Record<string, unknown>): ChildOutcome {
  if (frame.ok === true && isJson(frame.result) && isRecord(frame.stray)
    && Number.isSafeInteger(frame.stray.fetches) && Number.isSafeInteger(frame.stray.timers)) {
    return { ok: true, result: frame.result, logs: frame.logs, stray: frame.stray as ChildSuccess["stray"] };
  }
  if (frame.ok === false && isRecord(frame.error) && typeof frame.error.code === "string"
    && typeof frame.error.message === "string" && typeof frame.error.retry === "boolean") {
    return {
      ok: false,
      error: frame.error as unknown as ChildFailure["error"],
      logs: frame.logs,
      stray: isRecord(frame.stray) ? frame.stray as unknown as ChildFailure["stray"] : undefined,
    };
  }
  throw new TypeError("effect child returned an invalid result");
}

function normalizeLimits(overrides: Partial<EffectRunnerLimits> | undefined): EffectRunnerLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`effect limit ${name} must be a positive safe integer`);
  }
  limits.memoryMb = Math.max(64, Math.min(1024, limits.memoryMb));
  limits.durationMs = Math.min(300_000, limits.durationMs);
  limits.claimsPerPoke = Math.min(64, limits.claimsPerPoke);
  limits.concurrentFetches = Math.min(32, limits.concurrentFetches);
  limits.totalFetches = Math.min(256, limits.totalFetches);
  return limits;
}

function childLimits(limits: EffectRunnerLimits) {
  return {
    durationMs: limits.durationMs,
    memoryBytes: limits.memoryMb * 1024 * 1024,
    requestBytes: limits.requestBytes,
    responseBytes: limits.responseBytes,
    resultBytes: limits.resultBytes,
    logBytes: limits.logBytes,
    logEntries: limits.logEntries,
    concurrentFetches: limits.concurrentFetches,
    totalFetches: limits.totalFetches,
    redirects: limits.redirects,
    timers: limits.timers,
  };
}

function childEnvironment(): NodeJS.ProcessEnv {
  if (process.platform !== "win32") return {};
  const names = ["SYSTEMROOT", "WINDIR", "TEMP", "TMP"] as const;
  return Object.fromEntries(names.flatMap(name => process.env[name] ? [[name, process.env[name]]] : []));
}

function runnerError(code: string, message: string, ambiguous: boolean): Error & { code: string; ambiguous: boolean } {
  const error = new Error(message) as Error & { code: string; ambiguous: boolean };
  error.code = code;
  error.ambiguous = ambiguous;
  return error;
}

function errorCode(error: unknown): string {
  return typeof (error as { code?: unknown } | null)?.code === "string"
    ? (error as { code: string }).code.slice(0, 128) : "E_EFFECT_RUNNER";
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_048);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJson);
}

function terminate(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}

function childExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => child.once("close", () => resolve()));
}

async function boundedWait(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); timer.unref(); }),
  ]);
  if (timer) clearTimeout(timer);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
