import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient, type SnapbackClient } from "./client.js";

type JourneyContext = {
  as(name: string): SnapbackClient;
  tick(ms: number): Promise<Record<string, unknown>>;
  url: string;
};
type JourneyBody = (context: JourneyContext) => void | Promise<void>;
type RegisteredJourney = { name: string; body: JourneyBody };

const registryKey = Symbol.for("snapback2.journey.registry");
const registered = ((globalThis as Record<PropertyKey, unknown>)[registryKey] ??= []) as RegisteredJourney[];

/** Register one ≤5 s acceptance journey against the fresh owner started by `snapback2 test`. */
export function journey(name?: string, body?: JourneyBody): void {
  if (typeof name !== "string" || !name.trim() || typeof body !== "function") {
    throw new TypeError("journey(name, fn) requires a name and function");
  }
  registered.push({ name, body });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runnerFiles(): string[] {
  const separator = process.argv.indexOf("--");
  return separator >= 0 ? process.argv.slice(separator + 1).map((path) => resolve(path)) : [];
}

async function loadJourneyFile(path: string): Promise<RegisteredJourney[]> {
  registered.length = 0;
  const moduleUrl = `${pathToFileURL(path).href}?run=${Date.now()}-${Math.random()}`;
  await import(moduleUrl);
  if (registered.length === 0) throw new Error("journey file registered zero checks; call journey(name, fn)");
  return [...registered];
}

async function control(url: string, secret: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-snapback-control": secret },
    body: JSON.stringify(body),
  });
  const value = await response.json() as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(String(value.message ?? `control HTTP ${response.status}`)), value);
  return value;
}

async function within<T>(ms: number, body: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      body(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`journey exceeded ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runEntry(): Promise<void> {
  const url = argument("--url");
  const secret = argument("--secret");
  const files = runnerFiles();
  if (!url || !secret || files.length === 0) {
    process.stdout.write(`${JSON.stringify({ name: "journeys", kind: "journey", verdict: "fail", ms: 0, detail: "runner requires --url, --secret, and files" })}\n`);
    process.exitCode = 1;
    return;
  }
  let failed = false;
  for (const file of files) {
    let journeys: RegisteredJourney[];
    try {
      journeys = await loadJourneyFile(file);
    } catch (error) {
      failed = true;
      process.stdout.write(`${JSON.stringify({ name: file, kind: "journey", verdict: "fail", ms: 0, detail: String(error) })}\n`);
      continue;
    }
    for (const check of journeys) {
      const started = performance.now();
      try {
        await within(5_000, async () => check.body({
          as: (name) => createClient({ url, as: name }),
          tick: (ms) => control(url, secret, "/control/clock", { advanceMs: ms }),
          url,
        }));
        process.stdout.write(`${JSON.stringify({ name: check.name, kind: "journey", verdict: "pass", ms: Math.round(performance.now() - started), detail: { file } })}\n`);
      } catch (error) {
        failed = true;
        process.stdout.write(`${JSON.stringify({ name: check.name, kind: "journey", verdict: "fail", ms: Math.round(performance.now() - started), detail: error instanceof Error ? error.message : String(error) })}\n`);
      }
    }
  }
  if (failed) process.exitCode = 1;
}

if (
  basename(process.argv[1] ?? "") === "test-runner.mjs"
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")
) await runEntry();
