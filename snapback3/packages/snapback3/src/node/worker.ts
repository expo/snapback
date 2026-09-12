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
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  maxPending?: number;
  maxFrameBytes?: number;
  /** At most this many fresh children; submitted requests are never replayed. */
  restarts?: number;
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
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private starts = 0;
  private closed = false;
  private stopping = false;
  private failure?: OwnerError;

  constructor(private readonly options: WorkerOptions) {}

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new OwnerError("S3_OWNER_CLOSED", "The Snapback 3 owner is closed."));
    if (this.stopping) return Promise.reject(this.failure ?? new OwnerError("S3_WORKER_STOPPING", "The worker is restarting; retry shortly."));
    if (this.pending.size >= (this.options.maxPending ?? 64)) {
      return Promise.reject(new OwnerError("S3_OWNER_BUSY", "The owner is busy; retry after current work finishes."));
    }
    const id = ++this.nextId;
    let frame: string;
    try { frame = `${JSON.stringify({ id, method, params })}\n`; }
    catch { return Promise.reject(new OwnerError("S3_INPUT", "The request must contain JSON values.")); }
    if (Buffer.byteLength(frame) > 2 * 1024 * 1024) {
      return Promise.reject(new OwnerError("S3_INPUT_TOO_LARGE", "The worker request exceeds 2 MiB."));
    }
    let child: ChildProcessWithoutNullStreams;
    try { child = this.child ?? this.start(); }
    catch (error) { return Promise.reject(error); }
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
    this.starts++;
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.child = child;
    this.children.add(child);
    let chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child || this.stopping) return;
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
    child.stdin.on("error", () => this.fail(child, new OwnerError("S3_WORKER_IO", "The worker connection closed. Retain any submitted operation ID.")));
    child.on("error", error => this.fail(child, new OwnerError("S3_WORKER_START", `Cannot start the Snapback 3 worker: ${error.message}`)));
    child.on("close", (code, signal) => {
      this.children.delete(child);
      if (this.child === child) {
        this.fail(child, new OwnerError("S3_WORKER_EXIT", `The worker stopped (${signal ?? code ?? "unknown"}). Retain any submitted operation ID.`), false);
        this.child = undefined;
        this.stopping = false;
      }
    });
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
    if (this.child !== child || this.stopping) return;
    this.failure = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.stopping = terminate;
    if (!this.closed) this.options.onUnavailable?.(error);
    if (terminate) this.terminate(child);
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new OwnerError("S3_OWNER_CLOSED", "The Snapback 3 owner closed. Retain any submitted operation ID."));
    }
    this.pending.clear();
    const children = [...this.children];
    await Promise.all(children.map(child => new Promise<void>(done => {
      child.once("close", () => done());
      this.terminate(child);
    })));
  }
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
