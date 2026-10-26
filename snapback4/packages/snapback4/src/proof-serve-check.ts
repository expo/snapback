// @ref LLP 3000.011.003.000.000#17-wave-29-serve-proofs-and-proof-residue-dx12 — callbacks and commands share the npm serve group and cleanup barrier.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { bounded, deadline, register } from "./proof-process.ts";
import { cli } from "./proof.ts";
export interface ServeScriptReady {
  backendUrl?: string; frontendUrl?: string; [key: string]: unknown;
}
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
  /** Run after readiness, inside the owned group (shell command) or callback scope. */
  then?: string | ((ready: ServeScriptReady, signal: AbortSignal) => unknown | Promise<unknown>);
  /** Command/callback deadline. Default 120 seconds. */
  thenTimeoutMs?: number;
}
export interface ServeCheckReport {
  ok: boolean;
  script: string;
  failures: Array<{code:string; message:string}>;
  ready: boolean;
  upMs: number;
  lockReleased: boolean;
  commandCode?: number;
}
/** Executes npm run --silent SCRIPT in a private Unix process group.
 * Credentials in script stdout are never returned or written to logs.
 * @throws invalid options, unsupported platform, or inability to inspect/reap the owned group. */
export async function serveCheck(options: ServeCheckOptions): Promise<ServeCheckReport> {
  if (process.platform === "win32") throw Error("E_SERVE_CHECK_PLATFORM: process groups require Unix");
  const script = options.script ?? "prod:serve";
  if (!/^[A-Za-z0-9_:.-]+$/.test(script) || !options.deployment) throw Error("E_PROOF_USAGE: serveCheck requires a script name and deployment");
  if (options.then !== undefined && typeof options.then !== "function" && (typeof options.then !== "string" || !options.then.trim())) throw Error("E_PROOF_USAGE: then needs a command or callback");
  const thenTimeout = deadline(options.thenTimeoutMs, 120_000);
  const startup = deadline(options.timeoutMs, 30_000), up = deadline(options.upMs, 30_000), stop = deadline(options.stopTimeoutMs, 5000);
  const cwd = resolve(options.cwd ?? "."), failures: ServeCheckReport["failures"] = [];
  const add = (code:string, message:string) => { if (!failures.some(f => f.code === code)) failures.push({code,message}); };
  const observations = mkdtempSync(join(tmpdir(), "snapback4-serve-paths-"));
  const observedStores = join(observations,"stores.jsonl");
  const requested = resolve(cwd,options.deployment), storePath = join(requested,"store.sqlite");
  const canonical = (path:string) => { try {return realpathSync(path);} catch {return resolve(path);} };
  const child = spawn(process.execPath, [fileURLToPath(new URL("./proof-serve-driver.js", import.meta.url)), script], {
    cwd, env:{...process.env, ...options.env, SNAPBACK4_SERVE_CHECK_STORES:observedStores}, detached:true, stdio:["pipe", "pipe", "pipe", "ipc"],
  });
  register(child); child.stdin!.on("error", () => {});
  let serveExitCode: number | null | undefined, serveExitSignal: string | null | undefined;
  let keeper = 0, exited = false, ready = false, buffer = "", lineCount = 0, bytes = 0;
  let spawnError: Error | undefined, cleaning = false;
  const lostDriver = () => { if (!cleaning) add("E_SERVE_DRIVER_EXIT", "serve-check driver or keeper exited before inspection completed"); };
  child.once("exit", lostDriver); child.once("disconnect", lostDriver);
  child.on("error", error => { spawnError = error; });
  let commandCode: number | undefined, readyValue: ServeScriptReady = {};
  child.on("message", message => {
    const command = message as {type:string;code?:number;stream?:string;data?:string};
    if (command.type === "then-result") commandCode = command.code ?? 1;
    if (command.type === "then-output" && typeof command.data === "string") (command.stream === "stderr" ? process.stderr : process.stdout).write(command.data);
    const event = message as {type:string;keeper?:number;code?:number|null;signal?:string|null}; if (event.type === "started") keeper = event.keeper!; if (event.type === "exited") { exited = true; serveExitCode = event.code; serveExitSignal = event.signal; } });
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
        if (!ready && lineCount === 1 && value && typeof value === "object" && !Array.isArray(value)) { ready = true; readyValue = value; }
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
  let lockReleased = false, observedUp = 0, callbackError: unknown;
  try {
    const end = performance.now() + startup;
    while ((!ready || !keeper) && !exited && !spawnError && child.exitCode === null && child.signalCode === null && performance.now() < end) await sleep(20);
    if (!keeper) add("E_SERVE_START", "process-group keeper handshake was not received");
    if (spawnError) add("E_SERVE_START", "npm script could not start");
    if (!ready) add("E_SERVE_NO_JSON", `npm run --silent ${script} ${exited ? "exited without" : `did not emit within ${startup} ms`} a first JSON object line; inspect the serve script startup`);
    if (ready && !exited && options.then !== undefined && failures.length === 0) {
      const began = performance.now();
      const controller = new AbortController();
      try {
        if (typeof options.then === "string") {
          child.send({type:"then", command:options.then, ready:readyValue});
          while (commandCode === undefined && !exited && child.exitCode === null && child.signalCode === null && performance.now() - began < thenTimeout) await sleep(20);
          if (commandCode === undefined && !exited && child.exitCode === null && child.signalCode === null) add("E_SERVE_THEN_TIMEOUT", `command did not exit within ${thenTimeout} ms; owned command and serve group will be stopped`);
        } else {
          await bounded(Promise.resolve().then(() => (options.then as Function)(readyValue, controller.signal)), thenTimeout, "E_SERVE_THEN_TIMEOUT: callback");
        }
      } catch (error) { callbackError = error; add(error instanceof Error && error.message.startsWith("E_SERVE_THEN_TIMEOUT") ? "E_SERVE_THEN_TIMEOUT" : "E_SERVE_THEN_FAILED", "proof callback failed; cleanup still checks group shutdown and lock release"); } finally { controller.abort(); observedUp = Math.round(performance.now() - began); }
    } else if (ready && !exited && options.then === undefined) {
      const began = performance.now();
      while (!exited && child.exitCode === null && child.signalCode === null && performance.now() - began < up) await sleep(Math.min(25, Math.max(1, up - (performance.now() - began))));
      observedUp = Math.round(performance.now() - began);
    }
    if (exited) add("E_SERVE_EARLY_EXIT", "npm serve script exited before the running proof completed");
    if (keeper && child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid!, "SIGTERM");
      const end = performance.now() + stop;
      let living = await members();
      while (living.length && performance.now() < end) { await sleep(25); living = await members(); }
      if (living.length) add("E_SERVE_CHILD_RUNNING", "child left running after group SIGTERM");
    }
    if ((serveExitCode !== undefined && serveExitCode !== null && serveExitCode !== 0) || (serveExitSignal && serveExitSignal !== "SIGTERM")) add("E_SERVE_STOP_FAILED", `npm serve script shutdown failed (${serveExitCode ?? serveExitSignal}); inspect shutdown handlers`);
    if (buffer.length) add("E_SERVE_EXTRA_OUTPUT", "stdout contains an unterminated line");
    // Observe lock BEFORE the keeper kills leftovers: forced cleanup cannot earn a pass.
    const lock = await cli(["serve", resolve(cwd, options.deployment), "--wait-stopped"], {cwd, ...(options.env ? {env:options.env} : {}), timeoutMs:7000});
    lockReleased = lock.code === 0;
    let actual: string[] = [];
    try {actual=readFileSync(observedStores,"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line).directory).filter((value):value is string=>typeof value==="string");} catch { /* no kit-owned serve observation */ }
    const differing=[...new Set(actual)].filter(path=>canonical(path)!==canonical(requested));
    if (differing.length && !actual.some(path=>canonical(path)===canonical(requested))) add("E_SERVE_DEPLOYMENT_MISMATCH", `requested store ${storePath}; the serve script actually opened ${differing.map(path=>join(path,"store.sqlite")).join(", ")}. Set --deployment to the directory the script's --dir/startServe resolves to`);
    if (!lockReleased) {
      if (!existsSync(storePath)) add("E_SERVE_STORE_MISSING", `no store at ${storePath}; the serve script may have deployed elsewhere; --deployment must match its --dir/startServe directory`);
      else {
        // Only the CLI's bounded ownership fields are safe to render. Raw stderr
        // may include app diagnostics or credentials and remains withheld.
        const holder=/owned by ([^;\n]+)/.exec(lock.stderr)?.[1];
        const safeHolder=holder?.match(/^(?:https?:\/\/(?:[A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\]):\d+(?: \(pid \d+\))?|another CLI command or a server starting up \(address pending\))$/)?.[0];
        add(lock.stderr.includes("E_STORE_BUSY")?"E_SERVE_LOCK_HELD":"E_SERVE_LOCK_BARRIER", `store ${storePath}: ${lock.stderr.includes("E_STORE_BUSY")?`lock held after group SIGTERM; actual holder ${safeHolder??"unavailable from the ownership record"}`:"lock barrier refused (store/inspection failure, not evidence of a live holder)"}`);
      }
    }
  } finally {
    cleaning = true;
    child.stdin!.destroy(); // keeper EOF kills only its pinned group, including itself.
    try { await bounded(closed, 7000, "serve-check group reap"); }
    finally {child.stdout!.destroy(); child.stderr!.destroy();rmSync(observations,{recursive:true,force:true});}
  }
  // Pipe bytes may be delivered while the lock barrier is running or during final drain.
  if (buffer.length) add("E_SERVE_EXTRA_OUTPUT", "stdout contains an unterminated line");
  if ((serveExitCode !== undefined && serveExitCode !== null && serveExitCode !== 0) || (serveExitSignal && serveExitSignal !== "SIGTERM")) add("E_SERVE_STOP_FAILED", `npm serve script shutdown failed (${serveExitCode ?? serveExitSignal}); inspect shutdown handlers`);
  const report = {ok:failures.length === 0 && (commandCode === undefined || commandCode === 0), script, failures, ready, upMs:observedUp, lockReleased, ...(commandCode === undefined ? {} : {commandCode})};
  if (callbackError !== undefined) throw Object.assign(callbackError instanceof Error ? callbackError : Error("serve callback failed"), {report});
  return report;
}

/** Run a proof against the app's npm serve script; always stop its group and await lock release.
 * Readiness can include credentials: keep it in memory and never log it.
 * Callback work must honor signal or bound its own external resources.
 * @throws callback failure, deadline, or E_SERVE_CHECK with a credential-free report. */
export async function withServeScript<T>(script: string, fn: (ready: ServeScriptReady, signal: AbortSignal) => T | Promise<T>, options: Omit<ServeCheckOptions, "script" | "then" | "upMs">): Promise<T> {
  let value!: T;
  const report = await serveCheck({...options, script, then: async (ready, signal) => { value = await fn(ready, signal); }});
  if (!report.ok) throw Object.assign(Error(`E_SERVE_CHECK: ${report.failures.map(f => `${f.code}: ${f.message}`).join("; ")}`), {report});
  return value;
}
