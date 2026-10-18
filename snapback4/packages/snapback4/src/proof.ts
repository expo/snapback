export { loadFixtures, type FixtureRow, type LoadFixturesOptions } from "./proof-fixtures.ts";
import { seedAccounts, type SeedAccountsOptions, type StagingSessions } from "./proof-accounts.ts";
export { seedAccounts, type SeedAccountsOptions, type StagingAccount, type StagingSessions } from "./proof-accounts.ts";
// @ref LLP 3000.011.003.000.000#1 — the packaged proof kit owns hosts; builders own assertions.
import { mkdirSync, openSync, closeSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { BrowserContext, BrowserType, LaunchOptions, Locator, Page } from "playwright-core";
import { resolveBinary } from "./bin-path.ts";
import { bounded, deadline, logged, logText, portRange, ready, stopChild, type ProofHost, type ProofOptions, logsDir } from "./proof-process.ts";
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
  const run = logged(resolveBinary(), [verb, ...prefix, ...args], { ...options, env: { ...env, SNAPBACK4_PROOF_ID: id, SNAPBACK4_SUPERVISOR_PID: String(process.pid) } });
  try {
    const url = await ready(run, line => {
      const match = line.match(/^SNAPBACK4_READY verb=(dev|serve) generation=\d+ url=(http:\/\/[^ ]+) pid=(\d+)(?: |$)/);
      if (!match) return;
      if (match[1] !== verb || Number(match[3]) !== run.child.pid) throw Error("proof ready identity mismatch");
      return match[2];
    }, timeout);
    const { response, body } = await fetchIdentity(`${url}/auth/config`, timeout);
    if (!response.ok || body.proof_id !== id) throw Error("proof served identity mismatch");
    let personas: string[] = [];
    if (verb === "dev" && body.devDoors !== false) {
      const status = await fetchIdentity(`${url}/dev/status`, timeout);
      if (status.body.pid !== run.child.pid) throw Error("proof dev PID mismatch");
      if (!Array.isArray(status.body.personas) || !status.body.personas.every(name => typeof name === "string")) throw Error("proof dev personas missing");
      personas = status.body.personas;
    }
    return { url, ...(verb === "dev" ? { personas } : {}), pid: run.child.pid!, logs: run.logs, stop: () => stopChild(run.child, deadline(options.stopTimeoutMs, 5000)) };
  } catch (error) { await stopChild(run.child, deadline(options.stopTimeoutMs, 5000)); throw error; }
}
export interface DevHost extends ProofHost {
  personas: string[];
  /** Read the current authoritative development time, including all clock advances. */
  now(): Promise<number>;
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
  return host.then(host => ({ ...host, personas: host.personas!, now: async () => {
    const { response, body } = await fetchIdentity(`${host.url}/dev/status`, deadline(opts.timeoutMs, 10_000));
    if (!response.ok || typeof body.now !== "number") throw Error("proof dev clock unavailable; password-only dev requires explicit --unsafe-dev-doors for clock/fixture tools; use serve staging for real users");
    return body.now;
  } }));
}
export interface ServeHost extends ProofHost {
  operatorToken(service?: string, days?: number): Promise<string>;
  seedAccounts(options: SeedAccountsOptions): Promise<StagingSessions>;
  sessions?: StagingSessions;
}
export interface ServeOptions extends ProofOptions { seedUsers?: SeedAccountsOptions }
// @ref LLP 3000.000.000.001#2-real-staging-accounts — operator authority stays in the existing local store proof; bulk setup refuses production.
/** @throws E_PROOF_USAGE for missing deployment directory; child exit, readiness deadline or served identity mismatch. */
export async function startServe(deployDir: string, options: ServeOptions | readonly string[] = {}): Promise<ServeHost> {
  if (typeof deployDir !== "string" || !deployDir.trim()) throw Object.assign(new TypeError("E_PROOF_USAGE: startServe(deployDir, options) requires a deployment directory as its first argument"), { code: "E_PROOF_USAGE" });
  const opts: ServeOptions = Array.isArray(options) ? { args: options } : options as ServeOptions;
  const directory = resolve(opts.cwd ?? ".", deployDir);
  const host = await nativeHost("serve", [directory], opts);
  const served: ServeHost = { ...host,
    operatorToken: async (service = "operator", days = 1) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(service) || !Number.isSafeInteger(days) || days < 1 || days > 3650) throw Error("proof operatorToken: invalid service or days (1..3650)");
      const result = await cli(["token", "--service", service, "--days", String(days), "--release", directory, "--quiet"], opts);
      if (result.code !== 0) throw Error(`proof operator token refused: ${result.stderr}`);
      const token = result.stdout.trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error("proof operator token malformed");
      return token;
    },
    seedAccounts: accountOptions => seedAccounts(served, accountOptions),
  };
  try { if (opts.seedUsers) served.sessions = await served.seedAccounts(opts.seedUsers); return served; }
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
  const run = logged(binary, args, { ...options, env: { ...process.env, ...options.env } });
  try {
    await bounded(run.closed, deadline(options.timeoutMs, 120_000), "proof cli close");
    if (run.error()) throw run.error();
    return { code: run.child.exitCode, signal: run.child.signalCode, stdout: run.stdout(), stderr: logText(run.logs.stderr), logs: run.logs };
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
  if (!caller) {
    for (const peer of ["playwright-core", "@playwright/test", "playwright"]) {
      let path: string;
      try { path = requireCaller.resolve(peer); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") continue; throw error; }
      const peerModule = await import(path);
      caller = (peerModule.chromium ?? peerModule.default?.chromium) as BrowserType;
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
      context.setDefaultTimeout(30_000); context.setDefaultNavigationTimeout(30_000);
      return await proof(context);
    } finally {
      try { if (context) await bounded(context.close(), 5000, "browser context close"); }
      finally { await bounded(browser.close(), 5000, "browser close"); }
    }
  } finally { closeSync(err); closeSync(diagnostic); }
}
const substringLocators = new WeakMap<Locator, { locator: Locator; scoped: boolean }>();
/** Strings match exactly by default; use exact:false or a RegExp for a row with more text. Excludes editable values. */
/** @throws None at construction; locator observation can refuse ambiguous or invalid selectors. */
export function renderedText(page: Page, text: string | RegExp, options: { within?: Locator; exact?: boolean } = {}): Locator {
  const root = options.within ?? page, rendered = page.locator(":not(input):not(textarea)");
  const locator = root.getByText(text, { exact: options.exact ?? true }).and(rendered);
  if (typeof text === "string" && options.exact !== false) substringLocators.set(locator, { locator: root.getByText(text, { exact: false }).and(rendered), scoped: options.within !== undefined });
  return locator;
}
/** Activate before taking a screenshot, particularly on loaded shared hosts. */
/** @throws page closed or browser activation failed. */
export async function frontPage(page: Page): Promise<Page> { await page.bringToFront(); return page; }
export { logsDir } from "./proof-process.ts";
/** Returns the fresh nonempty text as a string, after it differs from previous. */
/** @throws observation deadline with scoped locator, last text and visible headings; selector ambiguity is propagated. */
export async function waitForFresh(locator: Locator, previous: string | null, options: number | { within?: Locator; timeoutMs?: number } = 30_000): Promise<string> {
  const timeoutMs = deadline(typeof options === "number" ? options : options.timeoutMs, 30_000);
  let substring = substringLocators.get(locator);
  if (typeof options !== "number" && options.within) {
    locator = options.within.locator(locator);
    if (substring) substring = { locator: options.within.locator(substring.locator), scoped: true };
  }
  const end = performance.now() + timeoutMs;
  let count = 0, text: string | null = null, detail = "";
  while (performance.now() < end) {
    try {
      count = await bounded(locator.count(), Math.max(1, end - performance.now()), "locator count");
      text = count ? await bounded(locator.textContent({ timeout: Math.max(1, Math.min(1000, end - performance.now())) }), Math.max(1, end - performance.now()), "locator text") : null;
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
export async function fillRN(locator: Locator, text: string): Promise<void> {
  await locator.focus(); await locator.press("ControlOrMeta+A"); await locator.press("Backspace");
  await locator.pressSequentially(text);
}
/** @throws None at construction; ambiguous text is refused when observed. */
export function statusText(page: Page, text: string | RegExp = /^(?:Ready|pending|sent|failed)$/): Locator { return page.getByText(text, { exact: true }); }
/** @throws locator ambiguity, unavailable option or Playwright deadline. */
export async function selectByValue(locator: Locator, value: string): Promise<void> { await locator.selectOption({ value }); }
