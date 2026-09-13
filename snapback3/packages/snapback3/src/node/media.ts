import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OwnerError } from "./worker.js";

export type AssetKind = "image" | "video";

export interface MediaFacts {
  type: "image/jpeg" | "image/png" | "image/webp" | "video/mp4";
  bytes: number;
  width: number;
  height: number;
  duration?: number;
}

export interface MediaValidator {
  validate(kind: AssetKind, source: string, destination: string): Promise<MediaFacts>;
  close(): Promise<void>;
}

export interface SubprocessMediaOptions {
  command: string;
  timeoutMs?: number;
  maxConcurrent?: number;
  maxQueued?: number;
  /** A sampled process-group RSS control, not a kernel memory ceiling. */
  maxRssBytes?: number;
  rssSampleMs?: number;
  closeTimeoutMs?: number;
  /** Narrow process-boundary fault seam for focused tests. */
  sampleRss?: (processGroup: number) => Promise<number | undefined>;
}

interface Waiter {
  resolve(): void;
  reject(error: Error): void;
}

interface ValidationJob {
  child: ChildProcess;
  done: Promise<void>;
  stop(error: OwnerError): void;
}

const DEFAULT_MAX_RSS_BYTES = 512 * 1024 * 1024;
const REQUIRED_CAPABILITIES = {
  protocol: "snapback3-media/1",
  images: true,
  video: true,
  imageTypes: ["image/jpeg", "image/png", "image/webp"],
  videoTypes: ["video/mp4"],
} as const;

// @ref LLP 1006#14a-codecs-live-in-a-separate-executable-the-type-does-not —
// hostile decoders run in a short-lived, store-less child with a clear
// environment, bounded concurrency/stdout/time, process-group teardown, and
// a sampled RSS control whose observation interval is not claimed as a hard
// kernel ceiling.
export class SubprocessMediaValidator implements MediaValidator {
  private readonly jobs = new Set<ValidationJob>();
  private readonly waiters: Waiter[] = [];
  private active = 0;
  private closed = false;
  private closing?: Promise<void>;

  constructor(private readonly options: SubprocessMediaOptions) {}

  async validate(kind: AssetKind, source: string, destination: string): Promise<MediaFacts> {
    await this.acquire();
    try {
      if (this.closed) throw new OwnerError("S3_OWNER_CLOSED", "The media validator is closed.");
      return await this.run(kind, source, destination);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.closed) return Promise.reject(new OwnerError("S3_OWNER_CLOSED", "The media validator is closed."));
    if (this.active < boundedCount(this.options.maxConcurrent, 2)) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiters.length >= boundedCount(this.options.maxQueued, 8)) {
      return Promise.reject(new OwnerError("S3_OWNER_BUSY", "Media validation is busy; retry this upload shortly."));
    }
    return new Promise<void>((resolveWaiter, reject) => this.waiters.push({
      resolve: () => { this.active++; resolveWaiter(); },
      reject,
    }));
  }

  private release(): void {
    this.active--;
    if (this.closed) return;
    const next = this.waiters.shift();
    next?.resolve();
  }

  private run(kind: AssetKind, source: string, destination: string): Promise<MediaFacts> {
    let child: ChildProcess;
    const detached = process.platform !== "win32";
    try {
      child = spawn(this.options.command, ["validate", kind, source, destination], {
        detached,
        env: {},
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      return Promise.reject(new OwnerError("S3_MEDIA_START", `Cannot start the media validator: ${errorMessage(error)}`));
    }

    let resolveCustody!: () => void;
    const done = new Promise<void>(resolveDone => { resolveCustody = resolveDone; });
    let stop!: (error: OwnerError) => void;
    const job: ValidationJob = { child, done, stop: error => stop(error) };
    this.jobs.add(job);

    return new Promise((resolveRun, rejectRun) => {
      let completed = false;
      let failure: OwnerError | undefined;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let sampling = false;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timeout = setTimeout(() => stop(new OwnerError(
        "S3_MEDIA_TIMEOUT", "Media validation timed out; discard or retry the upload.",
      )), boundedPositive(this.options.timeoutMs, 30_000));
      timeout.unref();
      const rssTimer = setInterval(() => { void sampleMemory(); }, boundedPositive(this.options.rssSampleMs, 100));
      rssTimer.unref();

      stop = (error: OwnerError) => {
        failure ??= error;
        terminateChild(child, detached);
      };
      const sampleMemory = async () => {
        if (completed || failure || sampling || child.pid === undefined) return;
        sampling = true;
        try {
          const bytes = await (this.options.sampleRss ?? sampleProcessGroupRss)(child.pid);
          if (bytes === undefined && !completed && !failure && childRunning(child)) {
            stop(new OwnerError("S3_MEDIA_MEMORY_POLICY", "Media validation RSS monitoring is unavailable on this host."));
            return;
          }
          const limit = boundedPositive(this.options.maxRssBytes, DEFAULT_MAX_RSS_BYTES);
          if (bytes !== undefined && bytes > limit) {
            stop(new OwnerError("S3_MEDIA_MEMORY", `Media validation exceeded its sampled ${limit}-byte RSS budget.`));
          }
        } catch (error) {
          if (!completed && !failure && childRunning(child)) stop(new OwnerError(
            "S3_MEDIA_MEMORY_POLICY", `Media validation RSS monitoring failed: ${errorMessage(error)}`,
          ));
        } finally { sampling = false; }
      };

      child.once("error", error => stop(new OwnerError("S3_MEDIA_START", `Cannot start the media validator: ${error.message}`)));
      child.stdout?.on("data", (chunk: Buffer) => {
        if (completed || failure) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > 64 * 1024) {
          stop(new OwnerError("S3_MEDIA_PROTOCOL", "The media validator returned too much output."));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (completed || stderrBytes >= 4096) return;
        const retained = chunk.subarray(0, 4096 - stderrBytes);
        stderrBytes += retained.length;
        stderr.push(retained);
      });
      child.once("close", (code, signal) => {
        void (async () => {
          completed = true;
          clearTimeout(timeout);
          clearInterval(rssTimer);
          if (detached && child.pid !== undefined) {
            // The direct helper may exit while a decoder descendant remains.
            // Its process group stays ours until every descendant is gone.
            terminateProcessGroup(child.pid);
            const observed = await waitForProcessGroupExit(child.pid, boundedPositive(this.options.closeTimeoutMs, 1_000));
            if (!observed) {
              failure ??= new OwnerError("S3_MEDIA_SHUTDOWN_TIMEOUT", "Media decoder descendants did not exit before the custody bound.");
              // Keep this job registered, and its caller unsettled, until the
              // exact group really disappears. close() may report its bound,
              // but no descendant becomes an unowned background process.
              await waitForProcessGroupExit(child.pid);
            }
          }
          if (failure) {
            await rm(destination, { force: true }).catch(() => undefined);
            rejectRun(failure);
            return;
          }
          let value: unknown;
          try {
            const line = Buffer.concat(stdout, stdoutBytes).toString("utf8");
            if (!line.endsWith("\n") || line.trimEnd().includes("\n")) throw new Error("expected one JSON line");
            value = JSON.parse(line);
          } catch {
            const detail = Buffer.concat(stderr, stderrBytes).toString("utf8").trim();
            rejectRun(new OwnerError("S3_MEDIA_PROTOCOL", detail
              ? `The media validator returned an invalid response: ${detail}`
              : `The media validator returned an invalid response (${signal ?? code ?? "unknown"}).`));
            return;
          }
          if (code !== 0) {
            rejectRun(helperRefusal(value));
            return;
          }
          try {
            const facts = parseMediaFacts(value, kind);
            const information = await lstat(destination);
            if (!information.isFile() || information.size !== facts.bytes) {
              throw new OwnerError("S3_MEDIA_PROTOCOL", "Validated media facts do not match the finalized file.");
            }
            resolveRun(facts);
          } catch (error) {
            rejectRun(error instanceof Error ? error : new OwnerError("S3_MEDIA_PROTOCOL", "The media validator returned invalid facts."));
          }
        })().finally(() => {
          this.jobs.delete(job);
          resolveCustody();
        });
      });
      void sampleMemory();
    });
  }

  close(): Promise<void> {
    return this.closing ??= this.closeOnce();
  }

  private async closeOnce(): Promise<void> {
    this.closed = true;
    const error = new OwnerError("S3_OWNER_CLOSED", "The media validator is closed.");
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    const jobs = [...this.jobs];
    for (const job of jobs) job.stop(error);
    if (!await boundedSettlement(Promise.all(jobs.map(job => job.done)), boundedPositive(this.options.closeTimeoutMs, 2_000))) {
      throw new OwnerError("S3_MEDIA_SHUTDOWN_TIMEOUT", "Media helper custody did not settle before the shutdown bound.");
    }
  }
}

function parseMediaFacts(value: unknown, kind: AssetKind): MediaFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnerError("S3_MEDIA_PROTOCOL", "The media validator returned non-object facts.");
  }
  const record = value as Record<string, unknown>;
  const allowed = kind === "image" ? ["type", "bytes", "width", "height"] : ["type", "bytes", "width", "height", "duration"];
  if (Object.keys(record).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(record, key))) {
    throw new OwnerError("S3_MEDIA_PROTOCOL", "The media validator returned an invalid fact shape.");
  }
  const positive = (name: string) => {
    const item = record[name];
    if (!Number.isSafeInteger(item) || (item as number) <= 0) throw new OwnerError("S3_MEDIA_PROTOCOL", `Media ${name} is not a positive safe integer.`);
    return item as number;
  };
  const type = record.type;
  const imageTypes = REQUIRED_CAPABILITIES.imageTypes as readonly string[];
  if (typeof type !== "string" || (kind === "image" ? !imageTypes.includes(type) : type !== "video/mp4")) {
    throw new OwnerError("S3_MEDIA_PROTOCOL", "The media validator returned the wrong media essence.");
  }
  return {
    type: type as MediaFacts["type"],
    bytes: positive("bytes"),
    width: positive("width"),
    height: positive("height"),
    ...(kind === "video" ? { duration: positive("duration") } : {}),
  };
}

function helperRefusal(value: unknown): OwnerError {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const message = typeof record.message === "string" ? record.message : "Media validation failed.";
  if (record.code === "E_ASSET_TOO_LARGE") return new OwnerError("S3_ASSET_TOO_LARGE", message);
  if (record.code === "E_ASSET_TYPE") return new OwnerError("S3_ASSET_TYPE", message);
  if (record.code === "E_OWNER_ASSET_IO") return new OwnerError("S3_ASSET_IO", message);
  return new OwnerError("S3_MEDIA_PROTOCOL", "The media validator returned an unknown refusal.");
}

export function findMediaHelper(projectRoot = process.cwd()): string {
  if (process.env.SNAPBACK3_MEDIA) return resolve(process.env.SNAPBACK3_MEDIA);
  const here = dirname(fileURLToPath(import.meta.url));
  const executable = process.platform === "win32" ? "snapback3-media.exe" : "snapback3-media";
  const packaged = join(here, "native", `${process.platform}-${process.arch}`, executable);
  if (existsSync(packaged)) return packaged;
  for (const start of [here, resolve(projectRoot), process.cwd()]) {
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
  throw new OwnerError("S3_MEDIA_MISSING", `No media validator is installed for ${process.platform}-${process.arch}. Build snapback3-media in snapback3/ or install the matching package.`);
}

// Finding a file is not a readiness claim. The helper's capabilities command
// runs its compiled fixture probes and binds this owner to the exact protocol
// and format envelope before the worker is told media is present.
export async function qualifiedMediaHelper(projectRoot = process.cwd()): Promise<string | undefined> {
  let command: string;
  try { command = findMediaHelper(projectRoot); }
  catch { return undefined; }
  try {
    const stdout = await capabilityProbe(command);
    if (!stdout.endsWith("\n") || stdout.trimEnd().includes("\n")) return undefined;
    const value: unknown = JSON.parse(stdout);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!sameKeys(record, Object.keys(REQUIRED_CAPABILITIES))
      || record.protocol !== REQUIRED_CAPABILITIES.protocol
      || record.images !== true || record.video !== true
      || !sameStrings(record.imageTypes, REQUIRED_CAPABILITIES.imageTypes)
      || !sameStrings(record.videoTypes, REQUIRED_CAPABILITIES.videoTypes)) return undefined;
    return command;
  } catch (error) {
    if (error instanceof OwnerError && ["S3_MEDIA_MEMORY", "S3_MEDIA_MEMORY_POLICY", "S3_MEDIA_SHUTDOWN_TIMEOUT"].includes(error.code)) throw error;
    return undefined;
  }
}

async function capabilityProbe(command: string): Promise<string> {
  const detached = process.platform !== "win32";
  const child = spawn(command, ["capabilities"], {
    detached, env: {}, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  return new Promise((resolveProbe, rejectProbe) => {
    let failure: Error | undefined;
    let completed = false;
    let sampling = false;
    let bytes = 0;
    const stdout: Buffer[] = [];
    const stop = (error: Error) => {
      failure ??= error;
      terminateChild(child, detached);
    };
    const timeout = setTimeout(() => stop(new OwnerError("S3_MEDIA_TIMEOUT", "Media helper qualification timed out.")), 5_000);
    timeout.unref();
    const sample = async () => {
      if (completed || failure || sampling || child.pid === undefined) return;
      sampling = true;
      try {
        const rss = await sampleProcessGroupRss(child.pid);
        if (rss === undefined && !completed && !failure && childRunning(child)) {
          stop(new OwnerError("S3_MEDIA_MEMORY_POLICY", "Media helper qualification RSS monitoring is unavailable on this host."));
        } else if (rss !== undefined && rss > DEFAULT_MAX_RSS_BYTES) {
          stop(new OwnerError("S3_MEDIA_MEMORY", `Media helper qualification exceeded its sampled ${DEFAULT_MAX_RSS_BYTES}-byte RSS budget.`));
        }
      } catch (error) {
        if (!completed && !failure && childRunning(child)) stop(new OwnerError(
          "S3_MEDIA_MEMORY_POLICY", `Media helper qualification RSS monitoring failed: ${errorMessage(error)}`,
        ));
      } finally { sampling = false; }
    };
    const rssTimer = setInterval(() => { void sample(); }, 100);
    rssTimer.unref();
    child.once("error", error => stop(new OwnerError("S3_MEDIA_START", `Cannot start the media validator: ${error.message}`)));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > 64 * 1024) { stop(new OwnerError("S3_MEDIA_PROTOCOL", "The media helper qualification returned too much output.")); return; }
      stdout.push(chunk);
    });
    child.once("close", code => {
      void (async () => {
        completed = true; clearTimeout(timeout); clearInterval(rssTimer);
        if (detached && child.pid !== undefined) {
          terminateProcessGroup(child.pid);
          if (!await waitForProcessGroupExit(child.pid, 1_000)) {
            failure ??= new OwnerError("S3_MEDIA_SHUTDOWN_TIMEOUT", "Media helper qualification descendants did not exit before the custody bound.");
            await waitForProcessGroupExit(child.pid);
          }
        }
        if (failure) rejectProbe(failure);
        else if (code !== 0) rejectProbe(new OwnerError("S3_MEDIA_PROTOCOL", "Media helper qualification failed."));
        else resolveProbe(Buffer.concat(stdout, bytes).toString("utf8"));
      })();
    });
    void sample();
  });
}

function sameKeys(value: Record<string, unknown>, wanted: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === wanted.length && wanted.every(key => Object.hasOwn(value, key));
}

function sameStrings(value: unknown, wanted: readonly string[]): boolean {
  return Array.isArray(value) && value.length === wanted.length
    && wanted.every((item, index) => value[index] === item);
}

function terminateChild(child: ChildProcess, detached: boolean): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  try {
    if (detached) terminateProcessGroup(child.pid);
    else child.kill("SIGKILL");
  } catch { /* The exact child/process group already exited. */ }
}

function childRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function terminateProcessGroup(processGroup: number): void {
  try { process.kill(-processGroup, "SIGKILL"); }
  catch { /* The exact process group already exited. */ }
}

async function sampleProcessGroupRss(processGroup: number): Promise<number | undefined> {
  if (process.platform === "win32") return undefined;
  const stdout = await new Promise<string>((resolveSample, rejectSample) => {
    execFile("/bin/ps", ["-o", "rss=", "-g", String(processGroup)], {
      env: {}, timeout: 1_000, maxBuffer: 64 * 1024, windowsHide: true,
    }, (error, value) => error ? rejectSample(error) : resolveSample(value));
  });
  let kib = 0;
  for (const line of stdout.split("\n")) {
    const value = line.trim();
    if (!value) continue;
    if (!/^[0-9]+$/.test(value)) return undefined;
    kib += Number(value);
  }
  return Number.isSafeInteger(kib) && kib > 0 ? kib * 1024 : undefined;
}

async function waitForProcessGroupExit(processGroup: number, timeoutMs?: number): Promise<boolean> {
  if (process.platform === "win32") return true;
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  while (processGroupExists(processGroup) && (deadline === undefined || Date.now() < deadline)) {
    await new Promise(done => setTimeout(done, 10));
  }
  return !processGroupExists(processGroup);
}

function processGroupExists(processGroup: number): boolean {
  try { process.kill(-processGroup, 0); return true; }
  catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error
      && (error as { code?: unknown }).code === "EPERM");
  }
}

async function boundedSettlement(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    promise.then(() => true, () => true),
    new Promise<false>(done => { timer = setTimeout(() => done(false), timeoutMs); timer.unref(); }),
  ]);
  if (timer) clearTimeout(timer);
  return settled;
}

function boundedPositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.min(Math.floor(value), 2_147_483_647)
    : fallback;
}

function boundedCount(value: number | undefined, fallback: number): number {
  return Math.min(boundedPositive(value, fallback), 1_024);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
