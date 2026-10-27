import { watchParent } from "./parent-lifetime.ts";
import { currentProbeGuard, probeAdvice } from "./proof-probe.ts";
export { probeServeGuard } from "./proof-probe.ts";
export { loadFixtures, type FixtureRow, type LoadFixturesOptions } from "./proof-fixtures.ts";
import { devAccounts, provisionAccounts, seedAccounts, type ProvisionAccountsOptions, type ProvisionedSessions, type SeedAccountsOptions, type StagingSessions } from "./proof-accounts.ts";
export { devAccounts, provisionAccounts, seedAccounts, type SeedAccountsOptions, type StagingAccount, type StagingSessions, type ProvisionAccountsOptions, type ProvisionedAccount, type ProvisionedSessions } from "./proof-accounts.ts";
// @ref LLP 3000.011.003.000.000#1 — the packaged proof kit owns hosts; builders own assertions.
import { appendFileSync, mkdirSync, openSync, closeSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { BrowserContext, BrowserType, LaunchOptions, Locator, Page } from "playwright-core";
import type { Cursor, ReadCut, Refusal } from "./contract.ts";
import { renderedSelector, registerRenderedSelector, registeredLocator, visibleText, armFreshText, scopedLocators } from "./proof-text.ts";
import { webWitnessObserverScript } from "./witness-web.ts";
import { resolveBinary } from "./bin-path.ts";
import { bounded, cleanup, deadline, logged, logText, portRange, ready, stopChild, type ProofHost, type ProofOptions, logsDir } from "./proof-process.ts";
export { bounded, cleanup, stopChild, portRange } from "./proof-process.ts";
export type { ProofHost, ProofOptions } from "./proof-process.ts";

const fetchIdentity = async (url: string, timeoutMs: number) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return { response, body: await response.json() as Record<string, unknown> };
};
async function nativeHost(verb: "dev" | "serve", prefix: string[], options: ProofOptions): Promise<ProofHost & { personas?: string[] }> {
  const env = { ...process.env, ...options.env }, id = randomUUID();
  const ports = portRange(env), timeout = deadline(options.timeoutMs, 30_000);
  const args = [...(options.args ?? [])];
  if (!args.includes("--port")) args.push("--port", ports);
  const run = logged(resolveBinary(env), [verb, ...prefix, ...args], { ...options, processGroup: true, env: { ...env, SNAPBACK4_PROOF_ID: id, SNAPBACK4_SUPERVISOR_PID: String(process.pid) } });
  try {
    await bounded(run.started, timeout, "proof process-group handshake");
    const url = await ready(run, line => {
      const match = line.match(/^SNAPBACK4_READY verb=(dev|serve) generation=\d+ url=(http:\/\/[^ ]+) pid=(\d+)(?: |$)/);
      if (!match) return;
      if (match[1] !== verb || Number(match[3]) !== run.pid()) throw Error("proof ready identity mismatch");
      return match[2];
    }, timeout);
    const { response, body } = await fetchIdentity(`${url}/auth/config`, timeout);
    if (!response.ok || body.proof_id !== id) throw Error("proof served identity mismatch");
    if (verb === "dev" && body.devDoors === false) process.stderr.write("snapback4: password-only development doors CLOSED (/seed, /dev/*, personas). For shared previews and probe:serve run snapback4 deploy staging --staging, then startServe(\"staging\"); see snapback4 guide staging. Local fixtures require dev --unsafe-dev-doors.\n");
    let personas: string[] = [];
    if (verb === "dev" && body.devDoors !== false) {
      const status = await fetchIdentity(`${url}/dev/status`, timeout);
      if (status.body.pid !== run.pid()) throw Error("proof dev PID mismatch");
      if (!Array.isArray(status.body.personas) || !status.body.personas.every(name => typeof name === "string")) throw Error("proof dev personas missing");
      personas = status.body.personas;
    }
    return { url, ...(verb === "dev" ? { personas } : {}), pid: run.pid()!, logs: run.logs, stop: () => stopChild(run.child, deadline(options.stopTimeoutMs, 5000)) };
  } catch (error) { await stopChild(run.child, deadline(options.stopTimeoutMs, 5000)); throw error; }
}
export interface DevHost extends ProofHost {
  devAccounts(options: SeedAccountsOptions): Promise<StagingSessions>;
  personas: string[];
  /** Read the current authoritative development time, including all clock advances. */
  now(): Promise<number>;
  advance(duration: string, options?: AdvanceOptions): Promise<ClockAdvance>;
  drain(options?: Pick<AdvanceOptions, "eachBoundary" | "allowHeld">): Promise<ClockAdvance>;
  operatorToken(service?: string, days?: number): Promise<string>;
}
/** The array form preserves the former startDev(args) recipe. */
/** @throws invalid port range or conflicting memory flags; child exits, readiness deadline, PID/served identity mismatch, or unavailable dev clock. */
export function startDev(options: ProofOptions | readonly string[] = {}): Promise<DevHost> {
  const opts: ProofOptions = Array.isArray(options) ? { args: options } : options as ProofOptions;
  const args = [...(opts.args ?? [])];
  const persistent = args.some(arg => arg === "--store" || arg.startsWith("--store=") || arg === "--no-memory");
  if (persistent && args.includes("--memory")) throw new TypeError("proof startDev: --memory conflicts with --store/--no-memory");
  // Native persistence is the default. --no-memory remains a consumed explicit alias.
  const host = nativeHost("dev", [], { ...opts, args: args.filter(arg => arg !== "--no-memory") });
  return host.then(host => {
    const operatorToken = async (service = "operator", days = 1) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(service) || !Number.isSafeInteger(days) || days < 1 || days > 3650) throw Error("proof operatorToken: invalid service or days (1..3650)");
      const port = new URL(host.url).port;
      const result = await cli(["token", "--service", service, "--days", String(days), "--port", port, "--quiet"], opts);
      if (result.code !== 0) throw Error(`proof development operator token refused: ${result.stderr}`);
      const token = result.stdout.trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error("proof development operator token malformed");
      return token;
    };
    const clockCall = async (body?: object): Promise<ClockAdvance> => {
      const response = await fetch(`${host.url}/dev/clock/${body ? "advance" : "status"}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${await operatorToken()}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(deadline(opts.timeoutMs, 60_000)) });
      const result = await response.json() as Partial<ClockAdvance> & {denied?:{code?:string;message?:string}};
      if (!response.ok || result.denied || !Number.isSafeInteger(result.now)) throw Object.assign(Error(`development clock refused or reply unavailable; inspect before retrying: ${result.denied?.code ?? response.status} ${result.denied?.message ?? ""}`), {report:result});
      const now = result.now!;
      return { now, fired: result.fired ?? [], held: result.held ?? [], maintenancePaused: result.maintenancePaused ?? false, valueOf() { return now; } };
    };
    return { ...host, personas: host.personas!, operatorToken, devAccounts: (options: SeedAccountsOptions) => devAccounts({...host, operatorToken}, options), now: async () => (await clockCall()).now,
      advance: (duration: string, advanceOptions: AdvanceOptions = {}) => {
        if (typeof duration !== "string" || (!/^\+?\d+(ms|s|m|h|d|w)$/.test(duration) || BigInt(duration.replace(/\D/g, "")) === 0n)) throw new TypeError("E_PROOF_USAGE: advance requires a positive whole duration");
        return clockCall({duration, ...advanceOptions});
      },
      drain: (advanceOptions: Pick<AdvanceOptions,"eachBoundary"|"allowHeld"> = {}) => clockCall({duration:"0ms",drain:true,...advanceOptions}),
    };
  });
}
export interface ScheduleOutcome {
  name: string;
  target: string;
  period: string;
  fired: boolean;
  reason: string;
  holdCode?: "disabled" | "saved-boundary" | "initialized" | "not-due" | "maintenance-failed";
  savedBoundary?: number;
  nextBoundary: string;
  heldUntil?: string;
  periodStart?: number;
  periodEnd?: number;
  firedWindows: { periodStart: number; periodEnd: number }[];
  skippedPeriods?: number;
  skippedBoundaries: { periodStart: number; periodEnd: number; command: string }[];
  skippedBoundariesOmitted?: number;
  run?: { id: string; state: string; rowsWritten: number; error: string | null; errorTruncated: boolean };
}
export interface ClockAdvance { now: number; fired: ScheduleOutcome[]; held: ScheduleOutcome[]; maintenancePaused: boolean; valueOf(): number }
export interface AdvanceOptions { eachBoundary?: boolean; drain?: boolean; allowHeld?: boolean; sessions?: "preserve" | "expire" }
export interface ServeHost extends ProofHost {
  readonly deploymentDir: string;
  /** Authoritative staging time; requires a staging store and local operator authority. */
  now(): Promise<number>;
  /** Advance staging time once and drain due work. A lost reply must not be retried. */
  advance(duration: string, options?: AdvanceOptions): Promise<ClockAdvance>;
  /** Resume and drain maintenance without advancing time. */
  drain(options?: Pick<AdvanceOptions, "eachBoundary" | "allowHeld">): Promise<ClockAdvance>;
  operatorToken(service?: string, days?: number): Promise<string>;
  seedAccounts(options: SeedAccountsOptions): Promise<StagingSessions>;
  provisionAccounts(options: ProvisionAccountsOptions): Promise<ProvisionedSessions>;
  sessions?: StagingSessions;
}
export interface ServeOptions extends ProofOptions { seedUsers?: SeedAccountsOptions; provisionUsers?: ProvisionAccountsOptions; clockOffset?: string }
// @ref LLP 3000.000.000.001#2-real-staging-accounts — operator authority stays in the existing local store proof; bulk setup refuses production.
/** Starts a release. stop() awaits native exit and kernel store release.
 * @throws E_PROOF_USAGE for missing deployment directory; child exit, readiness deadline or served identity mismatch. stop() rejects bounded cleanup failure. */
export async function startServe(deployDir: string, options: ServeOptions | readonly string[] = {}): Promise<ServeHost> {
  if (typeof deployDir !== "string" || !deployDir.trim()) throw Object.assign(new TypeError("E_PROOF_USAGE: startServe(deployDir, options) requires a deployment directory as its first argument"), { code: "E_PROOF_USAGE" });
  const opts: ServeOptions = Array.isArray(options) ? { args: options } : options as ServeOptions;
  const directory = resolve(opts.cwd ?? ".", deployDir);
  if (opts.clockOffset !== undefined && (typeof opts.clockOffset !== "string" || !/^[+-]?\d+(ms|s|m|h|d|w)$/.test(opts.clockOffset))) throw new TypeError("E_PROOF_USAGE: clockOffset is a signed duration such as +25h");
  if (opts.clockOffset !== undefined && opts.args?.some(arg => arg === "--clock-offset" || arg.startsWith("--clock-offset="))) throw new TypeError("E_PROOF_USAGE: pass clockOffset once");
  const host = await nativeHost("serve", [directory], { ...opts, args: [...(opts.args ?? []), ...(opts.clockOffset === undefined ? [] : ["--clock-offset", opts.clockOffset])] });
  // A private path-only observation lets serve-check compare the script's actual
  // startServe directory with its requested lock barrier. Never record readiness.
  try {
    if (process.env.SNAPBACK4_SERVE_CHECK_STORES) appendFileSync(process.env.SNAPBACK4_SERVE_CHECK_STORES, JSON.stringify({directory}) + "\n");
  } catch {await host.stop();throw Error("E_SERVE_INSPECTION: cannot record the script's deployment path");}
  const clockCall = async (body?: object): Promise<ClockAdvance> => {
    const config = await fetchIdentity(`${host.url}/auth/config`, deadline(opts.timeoutMs, 10_000));
    if (!config.response.ok || config.body.environment !== "staging") throw Error("E_CLOCK_DEV_ONLY: clock controls require a deploy --staging store");
    const clockToken = served.operatorToken("clock");
    const response = await fetch(`${host.url}/dev/clock/${body ? "advance" : "status"}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${await clockToken}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(deadline(opts.timeoutMs, 60_000)) });
    const result = await response.json() as Partial<ClockAdvance> & { sessionNotice?: string; denied?: { code?: string; message?: string } };
    if (result.sessionNotice) process.stderr.write(`snapback4: ${result.sessionNotice}\n`);
    if (!response.ok || result.denied || !Number.isSafeInteger(result.now)) throw Object.assign(Error(`staging clock refused or reply unavailable; inspect clock and queued work before retrying: ${result.denied?.code ?? response.status} ${result.denied?.message ?? ""}`), { report: result });
    if (body && (!Array.isArray(result.fired) || !Array.isArray(result.held))) throw Error("staging clock reply has no schedule report; inspect clock and queued work before retrying");
    for (const schedule of result.held ?? []) if (schedule.holdCode === "saved-boundary") process.stderr.write(`snapback4: schedule ${schedule.name}: ${schedule.reason}\n`);
    const report: ClockAdvance = { now: result.now!, fired: result.fired ?? [], held: result.held ?? [], maintenancePaused: result.maintenancePaused ?? false, valueOf() { return this.now; } };
    return report;
  };
  // Exit can precede inherited watchdog flock release. The private local
  // barrier observes the same canonical ownership sidecar without writing data.
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    await host.stop();
    const result = await cli(["serve", directory, "--wait-stopped"], {...opts, timeoutMs:6000});
    if (result.code !== 0) throw Error(`proof serve store release failed: ${result.stderr}`);
  })().catch(error => { stopping = undefined; throw error; });
  const served: ServeHost = { ...host, stop, deploymentDir: directory,
    now: async () => (await clockCall()).now,
    advance: (duration, options = {}) => {
      if (typeof duration !== "string" || (!/^\+?\d+(ms|s|m|h|d|w)$/.test(duration) || BigInt(duration.replace(/\D/g, "")) === 0n)) throw new TypeError("E_PROOF_USAGE: advance requires a positive whole duration");
      return clockCall({ duration, ...options });
    },
    drain: (options = {}) => clockCall({ duration: "0ms", drain: true, ...options }),
    operatorToken: async (service = "operator", days = 1) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(service) || !Number.isSafeInteger(days) || days < 1 || days > 3650) throw Error("proof operatorToken: invalid service or days (1..3650)");
      const result = await cli(["token", "--service", service, "--days", String(days), "--release", directory, "--quiet"], opts);
      if (result.code !== 0) throw Error(`proof operator token refused: ${result.stderr}`);
      const token = result.stdout.trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error("proof operator token malformed");
      return token;
    },
    seedAccounts: accountOptions => seedAccounts(served, accountOptions),
    provisionAccounts: accountOptions => provisionAccounts(served, accountOptions),
  };
  try {
    if (opts.seedUsers && opts.provisionUsers) throw new TypeError("E_PROOF_USAGE: choose seedUsers for staging or provisionUsers for production");
    if (opts.seedUsers) served.sessions = await served.seedAccounts(opts.seedUsers);
    if (opts.provisionUsers) served.sessions = await served.provisionAccounts(opts.provisionUsers);
    return served;
  }
  catch (error) { await served.stop(); throw error; }
}
async function frontend(kind: "static" | "vite", dir: string, options: ProofOptions): Promise<ProofHost> {
  const env = { ...process.env, ...options.env }, ports = portRange(env), timeout = deadline(options.timeoutMs, 30_000);
  const cwd = resolve(options.cwd ?? ".");
  const directory = resolve(cwd, dir);
  // Vite is resolved from the app, never the proof package's development dependencies.
  const vite = kind === "vite" ? createRequire(resolve(directory, "package.json")).resolve("vite") : "";
  const run = logged(process.execPath, [fileURLToPath(new URL("./proof-host.js", import.meta.url)), kind, directory, ports, vite], { ...options, env, detached: process.platform !== "win32", livenessPipe: true });
  try {
    const url = await ready(run, line => {
      const match = line.match(/^SNAPBACK4_PROOF_READY (\{.*\})$/);
      if (!match) return;
      const data = JSON.parse(match[1]!);
      if (data.pid !== run.child.pid || data.kind !== kind) throw Error("proof frontend PID mismatch");
      return data.url as string;
    }, timeout);
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (response.headers.get("x-snapback4-proof") !== String(run.child.pid) + ":" + run.id) throw Error("proof frontend identity mismatch");
    await response.body?.cancel();
    return { url, pid: run.child.pid!, logs: run.logs, stop: () => stopChild(run.child, deadline(options.stopTimeoutMs, 5000)) };
  } catch (error) { await stopChild(run.child, deadline(options.stopTimeoutMs, 5000)); throw error; }
}
/** @throws missing export/index or build script precondition; exhausted ports, readiness deadline or served identity mismatch. */
export function startStatic(dir: string, options: ProofOptions = {}): Promise<ProofHost> { return frontend("static", dir, options); }
/** @throws missing Vite dependency/configuration; exhausted ports, readiness deadline or served identity mismatch. */
export function startVite(dir: string, options: ProofOptions = {}): Promise<ProofHost> { return frontend("vite", dir, options); }

export interface CliResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; logs: ProofHost["logs"] }
/** Waits for close (stdio drained), never merges the two streams. Nonzero is returned for refusal assertions. */
/** @throws spawn error or command deadline; nonzero exit is returned in code, not thrown. */
export function cli(args: readonly string[], options: ProofOptions = {}): Promise<CliResult> {
  return command(process.execPath, [fileURLToPath(new URL("../bin/snapback4.js", import.meta.url)), ...args], { ...options, secret: options.secret || args[0] === "token" });
}
/** A bounded directly spawned build/tool command, with the same file logs. */
/** @throws spawn error or command deadline; nonzero exit is returned in code, not thrown. */
export async function command(binary: string, args: readonly string[], options: ProofOptions = {}): Promise<CliResult> {
  const run = logged(binary, args, { ...options, processGroup: true, env: { ...process.env, ...options.env } });
  try {
    await bounded(run.closed, deadline(options.timeoutMs, 120_000), "proof cli close");
    if (run.error()) throw run.error();
    return { code: run.code(), signal: run.signal(), stdout: run.stdout(), stderr: logText(run.logs.stderr), logs: run.logs };
  } catch (error) { await stopChild(run.child, deadline(options.stopTimeoutMs, 5000)); throw error; }
  finally { run.child.stdout?.destroy(); } // Secret capture must not pin the driver after a deadline.
}
async function successful(args: string[], options: ProofOptions) {
  const result = await cli(args, options);
  if (result.code !== 0) {
    const stdout = result.stdout.trimEnd();
    const tail = stdout.length > 4000 ? `…${stdout.slice(-4000)}` : stdout;
    throw Error(`proof CLI failed (${result.code}): ${result.stderr}; stdout tail: ${tail || "(empty)"}; logs: ${result.logs.stderr}`);
  }
  return result;
}
/** @throws missing explicit saved source, CLI failure, spawn error or deadline. */
export function deploy(dir: string, schema: string, options: ProofOptions = {}) {
  if (typeof schema !== "string" || !schema) throw Error(`proof deploy requires an explicit saved schema file or directory; got ${JSON.stringify(schema) ?? String(schema)}: did npm run day2:proof pass versions/v1?`);
  return successful(["deploy", dir, "--schema", schema, ...(options.args ?? [])], options);
}
/** @throws invalid explicit release target, CLI failure, spawn error or deadline. */
export function rollback(dir: string, to: number | "latest", options: ProofOptions = {}) {
  if (to !== "latest" && (!Number.isSafeInteger(to) || to < 1)) throw Error(`proof rollback requires an explicit immutable release target; got ${JSON.stringify(to) ?? String(to)}`);
  return successful(["rollback", dir, "--to", String(to), ...(options.args ?? [])], options);
}
// @ref LLP 3000.011.003.000.000#11-wave-14-truthful-starter-custody-day4 — saved-source proof results expose authored cases separately from query sweeps.
export interface TestSourceOptions extends ProofOptions { fixtureOnly?: boolean }
export interface TestSourceResult extends CliResult { casesRun: number; casesSkipped: number }
/** @throws missing source, CLI failure, invalid business-case summary or zero cases without fixtureOnly. */
export function testSource(source: string, options: TestSourceOptions = {}): Promise<TestSourceResult> {
  if (typeof source !== "string" || !source) throw Error(`proof testSource requires an explicit saved source file or directory; got ${JSON.stringify(source) ?? String(source)}: pass versions/v1`);
  const { fixtureOnly = false, ...proofOptions } = options;
  return successful(["test", "--source", source, ...(fixtureOnly ? ["--fixture-only"] : []), ...(proofOptions.args ?? [])], proofOptions).then(result => {
    const summaries = [...result.stdout.matchAll(/^SNAPBACK4_TEST_CASES (\{.*\})$/gm)];
    if (summaries.length !== 1) throw Error(`proof testSource received no unique business-case summary; stdout tail: ${result.stdout.trimEnd().slice(-4000) || "(empty)"}; logs: ${result.logs.stdout}`);
    let cases: { run: number; skipped: number };
    try { cases = JSON.parse(summaries[0]![1]!) as { run: number; skipped: number }; }
    catch { throw Error(`proof testSource received a malformed business-case summary: ${summaries[0]![0]}; logs: ${result.logs.stdout}`); }
    if (!Number.isSafeInteger(cases.run) || cases.run < 0 || !Number.isSafeInteger(cases.skipped) || cases.skipped < 0) {
      throw Error(`proof testSource received invalid business-case counts: ${summaries[0]![0]}; logs: ${result.logs.stdout}`);
    }
    if (cases.run === 0 && !fixtureOnly) {
      throw Error(`proof testSource ran no business cases (${cases.skipped} skipped); add test.cases.jsonl for this saved version, or pass { fixtureOnly: true } when fixture loading alone is the intended proof; stdout tail: ${result.stdout.trimEnd().slice(-4000) || "(empty)"}`);
    }
    return { ...result, casesRun: cases.run, casesSkipped: cases.skipped };
  });
}

/** @throws None; returns a boolean for recognized sandbox launch errors. */
export function sandboxUnavailable(error: unknown): boolean {
  return /No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace|SUID sandbox|sandbox.*Operation not permitted|Failed to unshare.*Operation not permitted/i.test(String(error));
}
/** @throws E_PROOF_BROWSER for missing playwright-core; invalid deadline, browser launch failure or callback error; bounded context/browser cleanup failure. */
export async function withBrowser<T>(options: LaunchOptions & Pick<ProofOptions, "cwd" | "logsDir"> & { chromium?: BrowserType }, proof: (context: BrowserContext) => Promise<T>): Promise<T> {
  const { chromium: suppliedChromium, executablePath, cwd: _cwd, logsDir: _logs, ...other } = options;
  const requireCaller = createRequire(resolve(options.cwd ?? process.cwd(), "package.json"));
  let caller = suppliedChromium;
  {
    for (const peer of ["playwright-core", "@playwright/test", "playwright"]) {
      let path: string;
      try { path = requireCaller.resolve(peer); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") continue; throw error; }
      const peerModule = await import(path);
      await registerRenderedSelector(peerModule.selectors ?? peerModule.default?.selectors);
      caller ??= (peerModule.chromium ?? peerModule.default?.chromium) as BrowserType;
      break;
    }
  }
  if (!caller) {
    try { caller = (await import("playwright-core")).chromium; }
    catch (cause) { throw new Error("E_PROOF_BROWSER: withBrowser requires playwright-core; run npm install --save-dev playwright-core before deploying or starting proof hosts", { cause }); }
  }
  const directory = logsDir(options); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const err = openSync(join(directory, `${randomUUID()}.browser.stderr.log`), "wx", 0o600);
  const diagnostic = openSync(join(directory, `${randomUUID()}.witness.private.jsonl`), "wx", 0o600);

  const launch = { ...other, ...(executablePath === undefined ? {} : { executablePath }), timeout: deadline(options.timeout, 30_000), logger: {
    isEnabled: () => true,
    log: (name: string, severity: string, message: string | Error) => { writeSync(err, `${name} ${severity}: ${String(message)}\n`); },
  } };
  const args = [...(options.args ?? [])];
  if (process.getuid?.() === 0 && !args.includes("--no-sandbox")) args.push("--no-sandbox");
  // Playwright owns its browser child over a pipe, including parent-exit cleanup.
  // No WebSocket server or TCP debugging port is opened.
  let browser;
  try {
    try { browser = await caller.launch({ ...launch, args, chromiumSandbox: !args.includes("--no-sandbox") }); }
    catch (error) {
      if (args.includes("--no-sandbox") || !sandboxUnavailable(error)) throw error;
      browser = await caller.launch({ ...launch, args: [...args, "--no-sandbox"], chromiumSandbox: false });
    }
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext();
      await context.exposeBinding("__snapback4ProofDiagnostic", (_source, value: unknown) => {
        writeSync(diagnostic, `${JSON.stringify(value)}\n`);
      });
      // Init scripts run on each document, including HTTP redirect destinations,
      // before any application script samples its URL.
      await context.addInitScript(() => {
        if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
        const url = new URL(location.href);
        url.searchParams.set("witness", "web");
        history.replaceState(history.state, "", url.href);
      });
      // The bridge function is self-contained after TypeScript erases types.
      // Proof code lives in this realm, outside the application's bundle.
      await context.addInitScript({ content: webWitnessObserverScript() });
      context.setDefaultTimeout(30_000); context.setDefaultNavigationTimeout(30_000);
      return await proof(context);
    } finally {
      try { if (context) await bounded(context.close(), 5000, "browser context close"); }
      finally { await bounded(browser.close(), 5000, "browser close"); }
    }
  } finally { closeSync(err); closeSync(diagnostic); }
}
/** Keep owned proof hosts alive until SIGTERM/SIGINT/SIGHUP or npm parent death, then stop all of them.
 * @throws AggregateError if any bounded host cleanup fails. */
// @ref LLP 3000.011.003.000.000#15-wave-26-proof-ergonomics-dx9 — a pending promise alone cannot keep probe:serve alive.
export async function serveUntilSignal(hosts: readonly Pick<ProofHost, "stop">[]): Promise<void> {
  if (!Array.isArray(hosts) || hosts.length === 0 || hosts.some(host => typeof host?.stop !== "function")) throw Error("E_PROOF_USAGE: serveUntilSignal requires at least one owned host");
  console.error(probeAdvice);
  const guard = currentProbeGuard(); guard?.ready();
  let finish!: () => void;
  const signalled = new Promise<void>(resolve => { finish = resolve; });
  const hold = setInterval(() => {
    if (guard?.idle()) { console.error(`E_PROBE_IDLE: no requests in 60 seconds; ${probeAdvice}. Deliberate service: npm run probe:serve -- --hold (or SNAPBACK4_PROBE_HOLD=1)`); process.exitCode = 1; finish(); }
  }, 1000);
  const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
  for (const signal of signals) process.on(signal, finish);
  const unwatch = watchParent(finish);
  try { await signalled; }
  finally {
    clearInterval(hold);
    try { await cleanup(...[...hosts].reverse().map(host => () => host.stop())); }
    finally { unwatch(); guard?.close(); for (const signal of signals) process.removeListener(signal, finish); }
  }
}
const substringLocators = new WeakMap<Locator, { locator: Locator; scoped: boolean }>();
/** Match the smallest reachable element whose composed descendant text matches; scroll a unique candidate into view when observed.
 * Strings normalize whitespace and match substrings by default; regexes keep their
 * own semantics. Editable values never count. Independent matches remain
 * ambiguous, including repeated rows. */
/** @throws None at construction; locator observation can refuse ambiguous or invalid selectors. */
// @ref LLP 3000.011.003.000.000#15-wave-26-proof-ergonomics-dx9 — substrings retain strict ambiguity and explicit exactness.
export function renderedText(page: Page, text: string | RegExp, options: { within?: Locator; exact?: boolean } | null = {}): Locator {
  const normalized = options ?? {};
  const root = normalized.within ?? page;
  const match = (exact: boolean) => registeredLocator(root.locator(`${renderedSelector}=${JSON.stringify({
    source: typeof text === "string" ? text : text.source,
    flags: typeof text === "string" ? "" : text.flags,
    regex: typeof text !== "string", exact,
  })}`));
  const locator = match(normalized.exact ?? false);
  if (normalized.within) scopedLocators.add(locator);
  if (typeof text === "string" && normalized.exact === true) substringLocators.set(locator, { locator: match(false), scoped: normalized.within !== undefined });
  return locator;
}

/** Locate a labelled form control by role and name, excluding option/value text
 * from wrapping labels. Exact names are the default; duplicate controls remain
 * ambiguous. Prefer explicit aria-label or label/htmlFor in the application. */
/** @throws Locator observations preserve Playwright's strict ambiguity and visibility rules. */
export function labelledControl(page: Page, role: "textbox" | "combobox" | "checkbox" | "radio" | "spinbutton" | "slider" | "switch", name: string | RegExp, options: { within?: Locator; exact?: boolean } = {}): Locator {
  const root = options.within ?? page, exact = options.exact ?? true;
  const named = root.getByRole(role, { name, exact });
  const labelled = root.locator(`${renderedSelector}=${JSON.stringify({
    control: true, source: typeof name === "string" ? name : name.source,
    flags: typeof name === "string" ? "" : name.flags, regex: typeof name !== "string", exact,
  })}`).and(root.getByRole(role));
  const locator = registeredLocator(named.or(labelled));
  if (options.within) scopedLocators.add(locator);
  return locator;
}

export interface ExhaustPagesOptions {
  /** Refuse rather than loop forever when a backend returns bad continuations. */
  maxPages?: number;
  /** Names the read in a refusal without exposing its rows or cursor. */
  label?: string;
}
type ProofPage<Row> =
  | { readonly data: readonly Row[]; readonly next?: Cursor | null; readonly complete: boolean; readonly cut: ReadCut; readonly existence?: "present" | "absent" | "partial" }
  | { readonly denied: Refusal }
  | { readonly loading: true };
/** Read every page by passing each opaque `next` back unchanged. The callback
 * receives null first. Refusals, loading, malformed/repeated cursors and a
 * capped or incomplete page fail instead of returning a partial snapshot. */
/** @throws E_PROOF_PAGE for a refused, loading, malformed, repeated, incomplete or over-limit traversal; callback errors propagate. */
// @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — proof traversal must never promote capped or partial reads to complete evidence.
export async function exhaustPages<Row>(readPage: (cursor: Cursor | null) => Promise<ProofPage<Row>>, options: ExhaustPagesOptions = {}): Promise<Row[]> {
  const maxPages = options.maxPages ?? 1_000, label = options.label ?? "paged read";
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error(`E_PROOF_PAGE: ${label}: maxPages must be a positive safe integer`);
  const rows: Row[] = [], seen = new Set<string>();
  let cursor: Cursor | null = null;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const page = await readPage(cursor);
    if (!page || typeof page !== "object") throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} returned no read envelope`);
    if ("denied" in page) throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} refused ${page.denied.code}: ${page.denied.message}`);
    if ("loading" in page) throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} is still loading`);
    if (!Array.isArray(page.data)) throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} data is not an array`);
    if (page.cut !== null) throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} is incomplete (${page.cut === undefined ? "missing" : page.cut} cut)`);
    if (page.complete !== true) throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} is incomplete (complete must be true)`);
    if (page.existence === "partial") throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} has partial existence`);
    rows.push(...page.data);
    const next = page.next ?? null;
    if (next === null) return rows;
    if (typeof next !== "string" || next.length === 0) throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} returned a malformed cursor`);
    if (seen.has(next)) throw new Error(`E_PROOF_PAGE: ${label}: page ${pageNumber} returned a repeated cursor`);
    seen.add(next);
    cursor = next as Cursor;
  }
  throw new Error(`E_PROOF_PAGE: ${label}: exceeded maxPages ${maxPages}`);
}
/** Administrative snapshot of every active row; bypasses application read rules.
 * The CLI reads adopted schema and rows in one transaction; ephemeral tables refuse.
 * @throws E_PROOF_SNAPSHOT for CLI refusal or malformed/incomplete inspection output. */
export async function snapshotAll<Row = Record<string, unknown>>(table: string, options: ProofOptions & { release?: string } = {}): Promise<Row[]> {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(table)) throw Error("E_PROOF_SNAPSHOT: supply one table name");
  const result = await cli(["data", table, "--all", "--json", ...(options.release ? ["--release", options.release] : [])], options);
  if (result.code !== 0) throw Error(`E_PROOF_SNAPSHOT: ${result.stderr.trim()}`);
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw Error("E_PROOF_SNAPSHOT: inspection returned invalid JSON"); }
  if (!Array.isArray(value.rows) || value.more !== false || value.limit !== null) throw Error("E_PROOF_SNAPSHOT: inspection did not certify all rows");
  return value.rows as Row[];
}
/** Activate before taking a screenshot, particularly on loaded shared hosts. */
/** @throws page closed or browser activation failed. */
export async function frontPage(page: Page): Promise<Page> { await page.bringToFront(); return page; }
export { logsDir } from "./proof-process.ts";
/** Returns normalized visible nonempty text after it differs from previous. Hidden and editable descendants do not confer freshness. */
/** @throws observation deadline with scoped locator, last text and visible headings; selector ambiguity is propagated. */
export async function waitForFresh(locator: Locator, previous: string | null, options: number | { within?: Locator; timeoutMs?: number; trigger?: () => unknown | Promise<unknown> } = 30_000): Promise<string> {
  const timeoutMs = deadline(typeof options === "number" ? options : options.timeoutMs, 30_000);
  let substring = substringLocators.get(locator);
  locator = registeredLocator(locator);
  if (typeof options !== "number" && options.within) {
    if (scopedLocators.has(locator)) throw Error("E_PROOF_USAGE: within was supplied twice; scope renderedText or waitForFresh once");
    locator = registeredLocator(options.within.locator(locator));
    if (substring) substring = { locator: options.within.locator(substring.locator), scoped: true };
  }
  if (typeof options !== "number" && options.trigger) {
    // A stable locator is resolved and a browser observer is armed before action.
    // Transient text can disappear before the action promise settles.
    const observer = await armFreshText(locator, previous, timeoutMs);
    try {
      const end = performance.now() + timeoutMs;
      await bounded(Promise.resolve().then(options.trigger), Math.max(1, end - performance.now()), "fresh-text trigger");
      while (performance.now() < end) {
        try {
          const text = await bounded(observer.evaluate(state => state.text), Math.max(1, end - performance.now()), "fresh-text observation");
          if (text) return text;
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("fresh-text observation timed out")) break;
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw Error(`no fresh signal after ${timeoutMs} ms: ${String(locator)}; observe a stable button/status container before the trigger`);
    } finally {
      await bounded(observer.evaluate(state => state.stop()), 1000, "fresh-text observer cleanup").catch(() => {});
      await bounded(observer.dispose(), 1000, "fresh-text handle cleanup").catch(() => {});
    }
  }
  const end = performance.now() + timeoutMs;
  let count = 0, text: string | null = null, detail = "";
  while (performance.now() < end) {
    try {
      count = await bounded(locator.count(), Math.max(1, end - performance.now()), "locator count");
      if (count > 1) throw Error(`E_PROOF_AMBIGUOUS: strict mode violation: ${count} rendered matches; use a narrower within or exact: true: ${String(locator)}`);
      text = count ? await bounded(visibleText(locator, Math.max(1, Math.min(1000, end - performance.now()))), Math.max(1, end - performance.now()), "locator text") : null;
      if (text && text !== previous) return text;
    } catch (error) {
      detail = error instanceof Error && (error.name === "TimeoutError" || /timed out after/.test(error.message))
        ? "locator observation exceeded the remaining proof deadline" : String(error);
      // A strictness/selector error needs its original repair, not a timeout.
      if (error instanceof Error && error.name !== "TimeoutError" && !/timed out after/.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, end - performance.now()))));
  }
  const hint = count === 0 && substring?.scoped && await bounded(substring.locator.count(), 1000, "substring count").catch(() => 0)
    ? "; a substring match exists; pass a RegExp or `exact: false`" : "";
  const headings = await bounded(Promise.resolve().then(() => locator.page().locator('h1:visible, h2:visible, [role="heading"]:visible').allTextContents()), 1000, "visible headings").catch(() => []);
  const heading = headings.map(text => text.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3).join(" | ").slice(0, 300);
  throw Error(`no fresh signal after ${timeoutMs} ms: ${String(locator)}; last count=${count}, text=${JSON.stringify(text)}; ${count ? "present but unchanged" : "absent"}; previous=${JSON.stringify(previous)}; visible heading=${JSON.stringify(heading || "(none)")}${hint}${detail ? `; ${detail}` : ""}`);
}
/** Poll authoritative server truth after a receipt; a pending prediction is not a commit. */
/** @throws deadline naming label and last value; read or predicate errors propagate. */
export async function waitForServer<T>(read: () => Promise<T>, accepts: (value: T) => boolean, options: { timeoutMs?: number; label?: string } = {}): Promise<T> {
  const timeoutMs = deadline(options.timeoutMs, 30_000), end = performance.now() + timeoutMs;
  let last: T | undefined;
  while (performance.now() < end) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([Promise.resolve().then(read), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error(`${options.label ?? "server truth"} timed out after ${timeoutMs} ms; last=${JSON.stringify(last)}`)), Math.max(1, end - performance.now()));
      })]);
      last = value;
      if (accepts(value)) return value;
    } finally { clearTimeout(timer); }
    await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, end - performance.now()))));
  }
  throw Error(`${options.label ?? "server truth"} timed out after ${timeoutMs} ms; last=${JSON.stringify(last)}`);
}
/** Wait until the page's own client has sampled an advanced server clock. Does not advance or replace that clock. */
/** @throws E_PROOF_USAGE for invalid advanced time; missing/disabled witness, signed-out client, page error or page-clock deadline. */
export async function waitForClock(page: Page, advancedNow: number, options: { timeoutMs?: number } = {}): Promise<number> {
  if (!Number.isSafeInteger(advancedNow) || advancedNow < 0) throw Error("E_PROOF_USAGE: waitForClock requires the clock advance reply's now");
  return waitForServer(() => page.evaluate(() => {
    const witness = (window as unknown as { __snapback4Witness?: { clock(): number } }).__snapback4Witness;
    if (!witness?.clock) throw Error("E_WITNESS_DISABLED: registerWebWitness and use witness=web before waitForClock");
    return witness.clock();
  }), now => now >= advancedNow, { ...options, label: "page client clock" });
}
/** @throws locator ambiguity, disabled/closed control, or Playwright deadline. */
export async function fillRN(locator: Locator, value: string | Parameters<Locator["setInputFiles"]>[0]): Promise<void> {
  const type = await locator.evaluate(element => element instanceof HTMLInputElement ? element.type : "text");
  if (type === "file") { await locator.setInputFiles(value); return; }
  if (typeof value !== "string") throw Error("E_PROOF_USAGE: file paths/payloads require a file input");
  if (["date", "datetime-local", "time", "month", "week"].includes(type)) { await locator.fill(value); return; }
  await locator.focus(); await locator.press("ControlOrMeta+A"); await locator.press("Backspace");
  await locator.pressSequentially(value);
}
/** @throws None at construction; ambiguous text is refused when observed. */
export function statusText(page: Page, text: string | RegExp = /^(?:Ready|pending|sent|failed)$/): Locator { return renderedText(page, text); }
/** @throws locator ambiguity, unavailable option or Playwright deadline. */
export async function selectByValue(locator: Locator, value: string): Promise<void> { await locator.selectOption({ value }); }

export { serveCheck, withServeScript, type ServeScriptReady, type ServeCheckOptions, type ServeCheckReport } from "./proof-serve-check.ts";
