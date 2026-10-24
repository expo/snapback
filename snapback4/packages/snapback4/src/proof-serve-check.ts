// @ref LLP 3000.011.003.000.000#16-wave-27-process-checks-dx10 — npm script qualification observes failures before forced cleanup.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { bounded, deadline, register } from "./proof-process.ts";
import { cli } from "./proof.ts";
export interface ServeCheckOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  script?: string;
  /** Deployment whose kernel lock must be released after group SIGTERM. */
  deployment: string;
  /** Startup deadline. Default 30 seconds. */
  timeoutMs?: number;
  /** Time to remain up after readiness. Default 30 seconds. */
  upMs?: number;
  stopTimeoutMs?: number;
}
export interface ServeCheckReport {
  ok: boolean;
  script: string;
  failures: Array<{code:string; message:string}>;
  ready: boolean;
  upMs: number;
  lockReleased: boolean;
}
/** Executes npm run --silent SCRIPT in a private Unix process group.
 * Credentials in script stdout are never returned or written to logs.
 * @throws invalid options, unsupported platform, or inability to inspect/reap the owned group. */
export async function serveCheck(options: ServeCheckOptions): Promise<ServeCheckReport> {
  if (process.platform === "win32") throw Error("E_SERVE_CHECK_PLATFORM: process groups require Unix");
  const script = options.script ?? "prod:serve";
  if (!/^[A-Za-z0-9_:.-]+$/.test(script) || !options.deployment) throw Error("E_PROOF_USAGE: serveCheck requires a script name and deployment");
  const startup = deadline(options.timeoutMs, 30_000), up = deadline(options.upMs, 30_000), stop = deadline(options.stopTimeoutMs, 5000);
  const cwd = resolve(options.cwd ?? "."), failures: ServeCheckReport["failures"] = [];
  const add = (code:string, message:string) => { if (!failures.some(f => f.code === code)) failures.push({code,message}); };
  const child = spawn(process.execPath, [fileURLToPath(new URL("./proof-serve-driver.js", import.meta.url)), script], {
    cwd, env:{...process.env, ...options.env}, detached:true, stdio:["pipe", "pipe", "pipe", "ipc"],
  });
  register(child); child.stdin!.on("error", () => {});
  let keeper = 0, exited = false, ready = false, buffer = "", lineCount = 0, bytes = 0;
  let spawnError: Error | undefined, cleaning = false;
  const lostDriver = () => { if (!cleaning) add("E_SERVE_DRIVER_EXIT", "serve-check driver or keeper exited before inspection completed"); };
  child.once("exit", lostDriver); child.once("disconnect", lostDriver);
  child.on("error", error => { spawnError = error; });
  child.on("message", message => { const event = message as {type:string;keeper?:number}; if (event.type === "started") keeper = event.keeper!; if (event.type === "exited") exited = true; });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  child.stdout!.setEncoding("utf8"); child.stdout!.on("data", chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024 * 1024) { add("E_SERVE_EXTRA_OUTPUT", "stdout exceeds 1 MiB; output withheld"); buffer = ""; return; }
    buffer += chunk;
    for (;;) {
      const at = buffer.indexOf("\n"); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); lineCount++;
      try {
        const value = JSON.parse(line);
        if (!ready && value && typeof value === "object" && !Array.isArray(value)) ready = true;
        else add("E_SERVE_EXTRA_OUTPUT", "stdout must contain exactly one JSON object line");
      } catch { add("E_SERVE_EXTRA_OUTPUT", "non-JSON stdout (including npm banners/blank lines); use npm run --silent and keep diagnostics on stderr"); }
      if (lineCount > 1) add("E_SERVE_EXTRA_OUTPUT", "stdout must contain exactly one JSON object line");
    }
  });
  child.stderr!.resume(); // May contain credentials from application diagnostics; never persist or echo it.
  const members = async () => {
    const {stdout} = await promisify(execFile)("ps", ["-axo", "pid=,pgid=,stat="], {timeout:5000, maxBuffer:16 * 1024 * 1024});
    return stdout.trim().split("\n").filter(Boolean).map(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
      if (!match) throw Error("E_SERVE_INSPECTION: unrecognized ps row");
      return {pid:Number(match[1]), group:Number(match[2]), state:match[3]!};
    }).filter(row => row.group === child.pid && row.pid !== child.pid && row.pid !== keeper && !row.state.startsWith("Z"));
  };
  let lockReleased = false, observedUp = 0;
  try {
    const end = performance.now() + startup;
    while ((!ready || !keeper) && !exited && !spawnError && child.exitCode === null && child.signalCode === null && performance.now() < end) await sleep(20);
    if (!keeper) add("E_SERVE_START", "process-group keeper handshake was not received");
    if (spawnError) add("E_SERVE_START", "npm script could not start");
    if (!ready) add("E_SERVE_NO_JSON", "no complete JSON object line before exit/startup deadline");
    if (ready && !exited) {
      const began = performance.now();
      while (!exited && child.exitCode === null && child.signalCode === null && performance.now() - began < up) await sleep(Math.min(25, Math.max(1, up - (performance.now() - began))));
      observedUp = Math.round(performance.now() - began);
    }
    if (exited) add("E_SERVE_EARLY_EXIT", "npm serve script exited before the up interval completed");
    if (keeper && child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid!, "SIGTERM");
      const end = performance.now() + stop;
      let living = await members();
      while (living.length && performance.now() < end) { await sleep(25); living = await members(); }
      if (living.length) add("E_SERVE_CHILD_RUNNING", "child left running after group SIGTERM");
    }
    if (buffer.length) add("E_SERVE_EXTRA_OUTPUT", "stdout contains an unterminated line");
    // Observe lock BEFORE the keeper kills leftovers: forced cleanup cannot earn a pass.
    const lock = await cli(["serve", resolve(cwd, options.deployment), "--wait-stopped"], {cwd, ...(options.env ? {env:options.env} : {}), timeoutMs:7000});
    lockReleased = lock.code === 0;
    if (!lockReleased) add("E_SERVE_LOCK_HELD", "deployment lock held after group SIGTERM (or lock barrier refused)");
  } finally {
    cleaning = true;
    child.stdin!.destroy(); // keeper EOF kills only its pinned group, including itself.
    await bounded(closed, 7000, "serve-check group reap");
    child.stdout!.destroy(); child.stderr!.destroy();
  }
  // Pipe bytes may be delivered while the lock barrier is running or during final drain.
  if (buffer.length) add("E_SERVE_EXTRA_OUTPUT", "stdout contains an unterminated line");
  return {ok:failures.length === 0, script, failures, ready, upMs:observedUp, lockReleased};
}
