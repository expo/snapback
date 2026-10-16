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
async function nativeHost(verb: "dev" | "serve", prefix: string[], options: ProofOptions): Promise<ProofHost> {
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
    if (verb === "dev") {
      const status = await fetchIdentity(`${url}/dev/status`, timeout);
      if (status.body.pid !== run.child.pid) throw Error("proof dev PID mismatch");
    }
    return { url, pid: run.child.pid!, logs: run.logs, stop: () => stopChild(run.child, deadline(options.stopTimeoutMs, 5000)) };
  } catch (error) { await stopChild(run.child, deadline(options.stopTimeoutMs, 5000)); throw error; }
}
/** The array form preserves the former startDev(args) recipe. */
export function startDev(options: ProofOptions | readonly string[] = {}): Promise<ProofHost> {
  const opts: ProofOptions = Array.isArray(options) ? { args: options } : options as ProofOptions;
  const args = [...(opts.args ?? [])];
  const persistent = args.some(arg => arg === "--store" || arg.startsWith("--store=") || arg === "--no-memory");
  if (persistent && args.includes("--memory")) throw new TypeError("proof startDev: --memory conflicts with --store/--no-memory");
  // --no-memory is a proof option; native dev already persists by default.
  return nativeHost("dev", [], { ...opts, args: [...args.filter(arg => arg !== "--no-memory"), ...(persistent || args.includes("--memory") ? [] : ["--memory"])] });
}
export function startServe(deployDir: string, options: ProofOptions | readonly string[] = {}): Promise<ProofHost> {
  return nativeHost("serve", [resolve(options && !Array.isArray(options) ? (options as ProofOptions).cwd ?? "." : ".", deployDir)],
    Array.isArray(options) ? { args: options } : options as ProofOptions);
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
export function startStatic(dir: string, options: ProofOptions = {}): Promise<ProofHost> { return frontend("static", dir, options); }
export function startVite(dir: string, options: ProofOptions = {}): Promise<ProofHost> { return frontend("vite", dir, options); }

export interface CliResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; logs: ProofHost["logs"] }
/** Waits for close (stdio drained), never merges the two streams. Nonzero is returned for refusal assertions. */
export function cli(args: readonly string[], options: ProofOptions = {}): Promise<CliResult> {
  return command(process.execPath, [fileURLToPath(new URL("../bin/snapback4.js", import.meta.url)), ...args], { ...options, secret: options.secret || args[0] === "token" });
}
/** A bounded directly spawned build/tool command, with the same file logs. */
export async function command(binary: string, args: readonly string[], options: ProofOptions = {}): Promise<CliResult> {
  const run = logged(binary, args, { ...options, env: { ...process.env, ...options.env } });
  try {
    await bounded(run.closed, deadline(options.timeoutMs, 120_000), "proof cli close");
    if (run.error()) throw run.error();
    return { code: run.child.exitCode, signal: run.child.signalCode, stdout: run.stdout(), stderr: logText(run.logs.stderr), logs: run.logs };
  } catch (error) { await stopChild(run.child, deadline(options.stopTimeoutMs, 5000)); throw error; }
}
async function successful(args: string[], options: ProofOptions) {
  const result = await cli(args, options);
  if (result.code !== 0) throw Error(`proof CLI failed (${result.code}): ${result.stderr}; logs: ${result.logs.stderr}`);
  return result;
}
export function deploy(dir: string, schema: string, options: ProofOptions = {}) {
  if (!schema) throw Error("proof deploy requires an explicit saved schema file");
  return successful(["deploy", dir, "--schema", schema, ...(options.args ?? [])], options);
}
export function rollback(dir: string, to: number | "latest", options: ProofOptions = {}) {
  if (to !== "latest" && (!Number.isSafeInteger(to) || to < 1)) throw Error("proof rollback requires an explicit immutable release target");
  return successful(["rollback", dir, "--to", String(to), ...(options.args ?? [])], options);
}
export function testSource(source: string, options: ProofOptions = {}) {
  if (!source) throw Error("proof testSource requires an explicit saved source file");
  return successful(["test", "--source", source, ...(options.args ?? [])], options);
}

export function sandboxUnavailable(error: unknown): boolean {
  return /No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace|SUID sandbox|sandbox.*Operation not permitted|Failed to unshare.*Operation not permitted/i.test(String(error));
}
export async function withBrowser<T>(options: LaunchOptions & Pick<ProofOptions, "cwd" | "logsDir"> & { chromium?: BrowserType }, proof: (context: BrowserContext) => Promise<T>): Promise<T> {
  const directory = logsDir(options); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const err = openSync(join(directory, `${randomUUID()}.browser.stderr.log`), "wx", 0o600);
  const { chromium: suppliedChromium, executablePath, cwd: _cwd, logsDir: _logs, ...other } = options;
  const caller = suppliedChromium ?? (await import("playwright-core")).chromium;
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
  } finally { closeSync(err); }
}
/** Strings match exactly by default; use exact:false or a RegExp for a row with more text. Excludes editable values. */
export function renderedText(page: Page, text: string | RegExp, options: { within?: Locator; exact?: boolean } = {}): Locator {
  return (options.within ?? page).getByText(text, { exact: options.exact ?? true }).and(page.locator(":not(input):not(textarea)"));
}
/** Activate before taking a screenshot, particularly on loaded shared hosts. */
export async function frontPage(page: Page): Promise<Page> { await page.bringToFront(); return page; }
export { logsDir } from "./proof-process.ts";
export async function waitForFresh(locator: Locator, previous: string | null, options: number | { within?: Locator; timeoutMs?: number } = 30_000): Promise<string> {
  const timeoutMs = deadline(typeof options === "number" ? options : options.timeoutMs, 30_000);
  if (typeof options !== "number" && options.within) locator = options.within.locator(locator);
  const end = performance.now() + timeoutMs;
  let count = 0, text: string | null = null, detail = "";
  while (performance.now() < end) {
    try {
      count = await bounded(locator.count(), Math.max(1, end - performance.now()), "locator count");
      text = count ? await bounded(locator.textContent({ timeout: Math.max(1, Math.min(1000, end - performance.now())) }), Math.max(1, end - performance.now()), "locator text") : null;
      if (text && text !== previous) return text;
    } catch (error) {
      detail = String(error);
      // A strictness/selector error needs its original repair, not a timeout.
      if (error instanceof Error && error.name !== "TimeoutError" && !/timed out after/.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, end - performance.now()))));
  }
  throw Error(`no fresh signal after ${timeoutMs} ms: ${String(locator)}; last count=${count}, text=${JSON.stringify(text)}; ${count ? "present but unchanged" : "absent"}; previous=${JSON.stringify(previous)}${detail ? `; ${detail}` : ""}`);
}
/** Poll authoritative server truth after a receipt; a pending prediction is not a commit. */
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
export async function fillRN(locator: Locator, text: string): Promise<void> {
  await locator.focus(); await locator.press("ControlOrMeta+A"); await locator.press("Backspace");
  await locator.pressSequentially(text);
}
export function statusText(page: Page, text: string | RegExp = /^(?:Ready|pending|sent|failed)$/): Locator { return page.getByText(text, { exact: true }); }
export async function selectByValue(locator: Locator, value: string): Promise<void> { await locator.selectOption({ value }); }
