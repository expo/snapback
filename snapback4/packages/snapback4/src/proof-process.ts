// @ref LLP 3000.011.003.000.000#1 — direct children, file logs and bounded cleanup own proof orchestration.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

const children = new Set<ChildProcess>();
process.once("exit", () => { for (const child of children) child.kill("SIGKILL"); });
export function register(child: ChildProcess): void {
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.on("error", () => children.delete(child));
}
export interface ProofOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  args?: readonly string[];
  timeoutMs?: number;
  stopTimeoutMs?: number;
  logsDir?: string;
  /** Internal: a frontend keeper owns this private process group. */
  detached?: boolean;
  /** Internal: the frontend observes parent death through stdin EOF. */
  livenessPipe?: boolean;
}
export interface ProofHost {
  url: string;
  pid: number;
  logs: { stdout: string; stderr: string };
  stop(): Promise<void>;
}
export function deadline(ms: number | undefined, fallback: number): number {
  const value = ms ?? fallback;
  if (!Number.isFinite(value) || value < 1) throw new RangeError("proof timeout must be positive and finite");
  return value;
}
export async function bounded<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label} timed out after ${ms} ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
/** Attempts every cleanup, even if a preceding step fails or stalls. */
export async function cleanup(...steps: Array<(() => unknown | Promise<unknown>) | undefined>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) if (step) {
    try { await bounded(Promise.resolve().then(step), 10_000, "proof cleanup"); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "proof cleanup failed");
}
export async function stopChild(child: ChildProcess | Pick<ProofHost, "url" | "stop">, graceMs = 5000): Promise<void> {
  deadline(graceMs, 5000);
  if (child && "url" in child && typeof child.url === "string" && typeof child.stop === "function") {
    await bounded(Promise.resolve().then(() => child.stop()), graceMs + 5000, "host stop"); return;
  }
  if (!child || !("kill" in child) || typeof child.kill !== "function" || typeof child.once !== "function"
      || !(child.exitCode === null || typeof child.exitCode === "number")
      || !(child.signalCode === null || typeof child.signalCode === "string")) {
    throw new TypeError("stopChild needs a ChildProcess or { url, stop }");
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  let done!: () => void;
  const exited = new Promise<void>(resolve => { done = resolve; });
  child.once("exit", done);
  child.once("error", done);
  try {
    child.kill("SIGTERM");
    try { await bounded(exited, graceMs, "SIGTERM"); }
    catch {
      child.kill("SIGKILL");
      await bounded(exited, 5000, "SIGKILL reap");
    }
  } finally { child.removeListener("exit", done); child.removeListener("error", done); }
}
export function portRange(env: NodeJS.ProcessEnv = process.env): string {
  const low = env.PORT_LO, high = env.PORT_HI;
  if (low === undefined && high === undefined) return "0";
  if (!low || !high || !/^\d+$/.test(low) || !/^\d+$/.test(high)
      || Number(low) < 1 || Number(high) > 65535 || Number(low) > Number(high)) {
    throw Error("PORT_LO and PORT_HI must both specify an inclusive range, 1 <= low <= high <= 65535");
  }
  return `${Number(low)}-${Number(high)}`;
}
/** Default logs never become application source inputs (including Exact app/). */
export function logsDir(options: Pick<ProofOptions, "cwd" | "logsDir"> = {}): string {
  return options.logsDir === undefined ? join(tmpdir(), "snapback4-proof-logs") : resolve(options.cwd ?? ".", options.logsDir);
}
export function logged(command: string, args: readonly string[], options: ProofOptions = {}) {
  const cwd = resolve(options.cwd ?? "."), id = randomUUID();
  const directory = logsDir(options); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const logs = { stdout: join(directory, `${id}.stdout.log`), stderr: join(directory, `${id}.stderr.log`) };
  const out = openSync(logs.stdout, "wx", 0o600), err = openSync(logs.stderr, "wx", 0o600);
  let child: ChildProcess;
  try { child = spawn(command, [...args], { cwd, detached: options.detached ?? false, env: { ...(options.env ?? process.env), SNAPBACK4_PROOF_LAUNCH: id }, stdio: [options.livenessPipe ? "pipe" : "ignore", out, err] }); }
  finally { closeSync(out); closeSync(err); }
  register(child);
  child.stdin?.on("error", () => {});
  let error: Error | undefined;
  child.on("error", value => { error = value; });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  return { child, logs, id, closed, error: () => error };
}
export const logText = (path: string): string => readFileSync(path, "utf8");
export async function ready(run: ReturnType<typeof logged>, parse: (line: string) => string | undefined, timeoutMs: number): Promise<string> {
  const end = performance.now() + timeoutMs;
  let outAt = 0, errAt = 0;
  while (performance.now() < end) {
    if (run.error()) throw run.error();
    if (run.child.exitCode !== null || run.child.signalCode !== null) {
      throw Error(`proof child exited before ready (${run.child.exitCode ?? run.child.signalCode}); ${run.logs.stderr}\n${logText(run.logs.stderr).slice(-4000)}`);
    }
    for (const [path, offset, stream] of [[run.logs.stdout, outAt, "out"], [run.logs.stderr, errAt, "err"]] as const) {
      const text = logText(path);
      const complete = text.lastIndexOf("\n") + 1;
      for (const line of text.slice(offset, complete).split("\n")) {
        const url = parse(stripVTControlCharacters(line).trim());
        if (url) return url;
      }
      if (stream === "out") outAt = complete; else errAt = complete;
    }
    await sleep(25);
  }
  throw Error(`proof child ready timed out after ${timeoutMs} ms; logs: ${run.logs.stdout}, ${run.logs.stderr}`);
}
