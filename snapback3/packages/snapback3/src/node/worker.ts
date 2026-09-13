import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class OwnerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OwnerError";
  }
}

export interface WorkerTransport {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export interface WorkerOptions {
  command: string;
  /** Initial explicit-source launch arguments. */
  args: string[];
  /** Recovery-only arguments for replacement children. */
  restartArgs?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
  maxPending?: number;
  maxFrameBytes?: number;
  /** At most this many fresh children; submitted requests are never replayed. */
  restarts?: number;
  /** Runs once per fresh child through a transport that deliberately bypasses
   * the barrier. Ordinary requests cannot reach the child until it resolves. */
  initialize?: (transport: WorkerTransport, child: { replacement: boolean }) => Promise<void>;
  closeDrainMs?: number;
  closeExitMs?: number;
  onStderr?: (text: string) => void;
  onUnavailable?: (error: OwnerError) => void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** One bounded JSONL connection. Losing the child loses response knowledge,
 * never the caller's durable operation identity. The next request can restart
 * the child once; a timed-out mutation is not silently submitted again. */
// @ref LLP 2000#5-ownership-before-abstraction — unknown write outcomes keep their identity through owner recovery.
export class WorkerClient implements WorkerTransport {
  private child?: ChildProcessWithoutNullStreams;
  private readonly children = new Set<ChildProcessWithoutNullStreams>();
  private readonly expectedExit = new Set<ChildProcessWithoutNullStreams>();
  private readonly pending = new Map<number, Pending>();
  private readonly active = new Set<Promise<unknown>>();
  private initialization?: { child: ChildProcessWithoutNullStreams; promise: Promise<void> };
  private nextId = 0;
  private starts = 0;
  private closed = false;
  private stopping = false;
  private inputClosing = false;
  private failure?: OwnerError;

  constructor(private readonly options: WorkerOptions) {}

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new OwnerError("S3_OWNER_CLOSED", "The Snapback 3 owner is closed."));
    if (this.stopping) return Promise.reject(this.failure ?? new OwnerError("S3_WORKER_STOPPING", "The worker is restarting; retry shortly."));
    if (this.active.size >= (this.options.maxPending ?? 64)) {
      return Promise.reject(new OwnerError("S3_OWNER_BUSY", "The owner is busy; retry after current work finishes."));
    }
    const request = this.dispatch<T>(method, params);
    this.active.add(request);
    void request.then(() => this.active.delete(request), () => this.active.delete(request));
    return request;
  }

  private async dispatch<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const child = await this.readyChild();
    return this.send<T>(child, method, params);
  }

  private async readyChild(): Promise<ChildProcessWithoutNullStreams> {
    if (this.stopping) throw this.failure ?? new OwnerError("S3_WORKER_STOPPING", "The worker is restarting; retry shortly.");
    const child = this.child ?? this.start();
    const initialization = this.initialization;
    if (initialization?.child === child) await initialization.promise;
    if (this.child !== child || this.stopping || this.inputClosing) {
      throw this.failure ?? new OwnerError("S3_WORKER_EXIT", "The worker stopped during initialization.");
    }
    return child;
  }

  private send<T>(child: ChildProcessWithoutNullStreams, method: string, params: Record<string, unknown>): Promise<T> {
    if (this.child !== child || this.stopping || this.inputClosing || child.stdin.destroyed) {
      return Promise.reject(this.failure ?? new OwnerError("S3_WORKER_EXIT", "The worker connection is unavailable."));
    }
    const id = ++this.nextId;
    let frame: string;
    try { frame = `${JSON.stringify({ id, method, params })}\n`; }
    catch { return Promise.reject(new OwnerError("S3_INPUT", "The request must contain JSON values.")); }
    if (Buffer.byteLength(frame) > 2 * 1024 * 1024) {
      return Promise.reject(new OwnerError("S3_INPUT_TOO_LARGE", "The worker request exceeds 2 MiB."));
    }
    return new Promise<T>((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.fail(child, new OwnerError("S3_WORKER_TIMEOUT", "The worker did not answer in time. A submitted write may have committed; retain its operation ID."));
      }, this.options.timeoutMs ?? 10_000);
      timer.unref();
      this.pending.set(id, { resolve: value => resolveRequest(value as T), reject, timer });
      child.stdin.write(frame, error => {
        if (error) this.fail(child, new OwnerError("S3_WORKER_IO", "The worker connection closed. Retain any submitted operation ID."));
      });
    });
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.starts >= 1 + (this.options.restarts ?? 1)) {
      throw this.failure ?? new OwnerError("S3_WORKER_EXIT", "The worker stopped repeatedly. Restart snapback3 dev after correcting the error.");
    }
    const first = this.starts++ === 0;
    this.failure = undefined;
    this.inputClosing = false;
    const child = spawn(this.options.command, first ? this.options.args : (this.options.restartArgs ?? this.options.args), {
      cwd: this.options.cwd, env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.child = child;
    this.children.add(child);
    let chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      let offset = 0;
      for (;;) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        chunks.push(part);
        bytes += part.length;
        if (bytes > (this.options.maxFrameBytes ?? 16 * 1024 * 1024)) {
          this.fail(child, new OwnerError("S3_WORKER_PROTOCOL", "The worker response exceeds its frame limit."));
          return;
        }
        if (newline < 0) break;
        const line = Buffer.concat(chunks, bytes).toString("utf8");
        chunks = []; bytes = 0;
        if (!this.receive(child, line)) return;
        offset = newline + 1;
        if (offset === chunk.length) break;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => this.options.onStderr?.(chunk.toString("utf8")));
    child.stdin.on("error", () => {
      if (!this.expectedExit.has(child)) this.fail(child, new OwnerError("S3_WORKER_IO", "The worker connection closed. Retain any submitted operation ID."));
    });
    child.on("error", error => this.fail(child, new OwnerError("S3_WORKER_START", `Cannot start the Snapback 3 worker: ${error.message}`)));
    child.on("close", (code, signal) => {
      this.children.delete(child);
      if (this.child === child) {
        const failureWasReported = this.failure !== undefined;
        const expected = this.expectedExit.delete(child);
        const error = expected
          ? new OwnerError("S3_OWNER_CLOSED", "The Snapback 3 owner closed. Retain any submitted operation ID.")
          : this.failure ?? new OwnerError("S3_WORKER_EXIT", `The worker stopped (${signal ?? code ?? "unknown"}). Retain any submitted operation ID.`);
        this.rejectPending(error);
        if (!expected && !this.closed && !failureWasReported) this.options.onUnavailable?.(error);
        this.child = undefined;
        if (this.initialization?.child === child) this.initialization = undefined;
        this.stopping = false;
        this.inputClosing = false;
      }
    });
    const raw: WorkerTransport = { request: <T = unknown>(method: string, params: Record<string, unknown> = {}) => this.send<T>(child, method, params) };
    const promise = (async () => {
      try { await this.options.initialize?.(raw, { replacement: !first }); }
      catch (error) {
        const reason = error instanceof OwnerError
          ? error
          : new OwnerError("S3_WORKER_INIT", `Worker recovery failed: ${error instanceof Error ? error.message : String(error)}`);
        this.fail(child, reason);
        throw reason;
      }
    })();
    this.initialization = { child, promise };
    return child;
  }

  private receive(child: ChildProcessWithoutNullStreams, line: string): boolean {
    let frame: { id?: unknown; result?: unknown; error?: unknown };
    try { frame = JSON.parse(line); }
    catch { this.fail(child, new OwnerError("S3_WORKER_PROTOCOL", "The worker returned invalid JSON.")); return false; }
    if (!frame || typeof frame !== "object" || !Number.isSafeInteger(frame.id)
      || Object.hasOwn(frame, "result") === Object.hasOwn(frame, "error")) {
      this.fail(child, new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid response envelope."));
      return false;
    }
    const pending = this.pending.get(frame.id as number);
    if (!pending) {
      this.fail(child, new OwnerError("S3_WORKER_PROTOCOL", "The worker answered an unknown request."));
      return false;
    }
    this.pending.delete(frame.id as number);
    clearTimeout(pending.timer);
    if (Object.hasOwn(frame, "error")) {
      const error = frame.error as { code?: unknown; message?: unknown } | null;
      if (!error || typeof error.code !== "string" || typeof error.message !== "string") {
        const failure = new OwnerError("S3_WORKER_PROTOCOL", "The worker returned an invalid error envelope.");
        pending.reject(failure); this.fail(child, failure); return false;
      }
      pending.reject(new OwnerError(error.code, error.message));
    } else pending.resolve(frame.result);
    return true;
  }

  private fail(child: ChildProcessWithoutNullStreams, error: OwnerError, terminate = true): void {
    if (this.child !== child || (this.stopping && terminate)) return;
    this.failure = error;
    this.rejectPending(error);
    this.stopping = terminate;
    if (!this.closed) this.options.onUnavailable?.(error);
    if (terminate) this.terminate(child);
  }

  private rejectPending(error: OwnerError): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private terminate(child: ChildProcessWithoutNullStreams): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const force = setTimeout(() => {
      if (this.children.has(child)) child.kill("SIGKILL");
    }, 1_000);
    force.unref();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await boundedWait(Promise.allSettled([...this.active]), this.options.closeDrainMs ?? 5_000);
    const child = this.child;
    if (!child) return;
    this.inputClosing = true;
    this.expectedExit.add(child);
    child.stdin.end();
    if (await childExit(child, this.options.closeExitMs ?? 1_000)) return;
    if (this.child === child && this.children.has(child)) child.kill("SIGTERM");
    if (await childExit(child, this.options.closeExitMs ?? 1_000)) return;
    if (this.child === child && this.children.has(child)) child.kill("SIGKILL");
    await childExit(child, this.options.closeExitMs ?? 1_000);
  }
}

async function boundedWait(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>(done => { timer = setTimeout(done, positiveTimeout(timeoutMs)); timer.unref(); }),
  ]);
  if (timer) clearTimeout(timer);
}

async function childExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = await Promise.race([
    new Promise<true>(done => child.once("close", () => done(true))),
    new Promise<false>(done => { timer = setTimeout(() => done(false), positiveTimeout(timeoutMs)); timer.unref(); }),
  ]);
  if (timer) clearTimeout(timer);
  return exited;
}

function positiveTimeout(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), 2_147_483_647) : 1_000;
}

export function findWorker(projectRoot = process.cwd()): string {
  if (process.env.SNAPBACK3_WORKER) return resolve(process.env.SNAPBACK3_WORKER);
  const here = dirname(fileURLToPath(import.meta.url));
  const executable = process.platform === "win32" ? "snapback3-worker.exe" : "snapback3-worker";
  // @ref LLP 2000#8-craft-distribution-and-operations — installed applications
  // get their matching worker from the package, independently of a checkout.
  const packaged = join(here, "native", `${process.platform}-${process.arch}`, executable);
  if (existsSync(packaged)) return packaged;
  const starts = [here, resolve(projectRoot), process.cwd()];
  for (const start of starts) {
    let directory = start;
    for (;;) {
      for (const profile of ["release", "debug"]) {
        const binary = join(directory, "target", profile, executable);
        if (existsSync(binary)) return binary;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw new OwnerError("S3_WORKER_MISSING", `No worker is installed for ${process.platform}-${process.arch}. Install its matching experimental tarball, build snapback3-worker with Cargo in snapback3/, or set SNAPBACK3_WORKER.`);
}
