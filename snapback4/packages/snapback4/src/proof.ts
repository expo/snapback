// @ref LLP 3000.011.003.000.000#1 — the packaged proof kit owns hosts; builders own assertions.
import { mkdirSync, openSync, closeSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium, type BrowserContext, type BrowserServer, type LaunchOptions, type Locator, type Page } from "playwright-core";
import { resolveBinary } from "./bin-path.ts";
import { bounded, deadline, logged, logText, portRange, ready, register, stopChild, type ProofHost, type ProofOptions } from "./proof-process.ts";
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
  return nativeHost("dev", [], { ...opts, args: opts.args ?? ["--memory"] });
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
  return command(resolveBinary(), args, options);
}
/** A bounded directly spawned build/tool command, with the same file logs. */
export async function command(binary: string, args: readonly string[], options: ProofOptions = {}): Promise<CliResult> {
  const run = logged(binary, args, { ...options, env: { ...process.env, ...options.env } });
  try {
    await bounded(run.closed, deadline(options.timeoutMs, 120_000), "proof cli close");
    if (run.error()) throw run.error();
    return { code: run.child.exitCode, signal: run.child.signalCode, stdout: logText(run.logs.stdout), stderr: logText(run.logs.stderr), logs: run.logs };
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
export async function withBrowser<T>(options: LaunchOptions & Pick<ProofOptions, "cwd" | "logsDir">, proof: (context: BrowserContext) => Promise<T>): Promise<T> {
  const directory = resolve(options.cwd ?? ".", options.logsDir ?? "logs"); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const logId = randomUUID();
  const out = openSync(join(directory, `${logId}.browser.stdout.log`), "wx", 0o600);
  const err = openSync(join(directory, `${logId}.browser.stderr.log`), "wx", 0o600);
  const { executablePath, ...other } = options;
  const launch = { ...other, ...(executablePath === undefined ? {} : { executablePath }), timeout: deadline(options.timeout, 30_000), logger: {
    isEnabled: () => true,
    log: (name: string, severity: string, message: string | Error) => { writeSync(err, `${name} ${severity}: ${String(message)}\n`); },
  } };
  const args = [...(options.args ?? [])];
  if (process.getuid?.() === 0 && !args.includes("--no-sandbox")) args.push("--no-sandbox");
  let server: BrowserServer;
  try { server = await chromium.launchServer({ ...launch, args, chromiumSandbox: !args.includes("--no-sandbox") }); }
  catch (error) {
    if (args.includes("--no-sandbox") || !sandboxUnavailable(error)) { closeSync(out); closeSync(err); throw error; }
    try { server = await chromium.launchServer({ ...launch, args: [...args, "--no-sandbox"], chromiumSandbox: false }); }
    catch (retry) { closeSync(out); closeSync(err); throw retry; }
  }
  const browserChild = server.process(); register(browserChild);
  const stdout = (chunk: Buffer) => writeSync(out, chunk), stderr = (chunk: Buffer) => writeSync(err, chunk);
  browserChild.stdout?.on("data", stdout); browserChild.stderr?.on("data", stderr);
  let context: BrowserContext | undefined;
  try {
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: launch.timeout });
    context = await browser.newContext();
    context.setDefaultTimeout(30_000); context.setDefaultNavigationTimeout(30_000);
    return await proof(context);
  } finally {
    // Killing the retained browser child also bounds a hung close; do not let
    // an earlier cleanup failure skip the process stop.
    try { if (context) await bounded(context.close(), 5000, "browser context close"); }
    finally {
      try { await bounded(server.close(), 5000, "browser close"); }
      finally {
        try { await stopChild(browserChild, 1000); }
        finally {
          browserChild.stdout?.removeListener("data", stdout); browserChild.stderr?.removeListener("data", stderr);
          closeSync(out); closeSync(err);
        }
      }
    }
  }
}
export async function waitForFresh(locator: Locator, previous: string | null, timeoutMs = 30_000): Promise<string> {
  const end = performance.now() + deadline(timeoutMs, 30_000);
  while (performance.now() < end) {
    if (await bounded(locator.count(), Math.max(1, end - performance.now()), "no fresh signal (locator count)")) {
      try {
        const text = await bounded(locator.textContent({ timeout: Math.max(1, Math.min(1000, end - performance.now())) }), Math.max(1, end - performance.now()), "no fresh signal (text)");
        if (text && text !== previous) return text;
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error(`no fresh signal after ${timeoutMs} ms (previous: ${JSON.stringify(previous)})`);
}
export async function fillRN(locator: Locator, text: string): Promise<void> {
  await locator.focus(); await locator.press("ControlOrMeta+A"); await locator.press("Backspace");
  await locator.pressSequentially(text);
}
export function statusText(page: Page, text: string | RegExp = /^(?:Ready|pending|sent|failed)$/): Locator { return page.getByText(text, { exact: true }); }
export async function selectByValue(locator: Locator, value: string): Promise<void> { await locator.selectOption({ value }); }
