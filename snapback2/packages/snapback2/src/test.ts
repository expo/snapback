import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createClient,
  stableSerialize,
  type OfflineClientOptions,
  type SnapbackClient,
} from "./client.js";
import { fileRangeStore } from "./store/file.js";

export { fileRangeStore };

type TransportFault = { path: string; status: number };
type JourneyDevice = SnapbackClient & {
  failNextResponse(path: string, status: number): void;
  settled(): ReturnType<SnapbackClient["outbox"]["settled"]>;
};
type JourneyContext = {
  as(name: string, options?: {
    store?: "file";
  }): JourneyDevice;
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

// Identity covers the registered name and compiled function source, not captured state.
function registrationIdentity(journeys: RegisteredJourney[]): string {
  return createHash("sha256")
    .update(JSON.stringify(journeys.map((check) => [check.name, Function.prototype.toString.call(check.body)])))
    .digest("hex");
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
  const storeRoot = argument("--store-root");
  if (!url || !secret || files.length === 0) {
    process.stdout.write(`${JSON.stringify({ name: "journeys", kind: "journey", verdict: "fail", ms: 0, detail: "runner requires --url, --secret, and files" })}\n`);
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--list")) {
    for (const file of files) {
      try {
        const journeys = await loadJourneyFile(file);
        process.stdout.write(`${JSON.stringify({ runner: "list", file, journeys: journeys.map((check) => check.name), registrationId: process.argv.includes("--identify") ? registrationIdentity(journeys) : undefined })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ name: file, kind: "journey", verdict: "fail", ms: 0, detail: String(error) })}\n`);
        process.exitCode = 1;
      }
    }
    return;
  }
  const selected = argument("--journey-index");
  if (selected !== undefined) {
    const index = Number(selected);
    if (files.length !== 1 || !Number.isSafeInteger(index) || index < 0) {
      process.stdout.write(`${JSON.stringify({ name: "journey runner", kind: "journey", verdict: "fail", ms: 0, detail: "--journey-index requires one file and a non-negative integer" })}\n`);
      process.exitCode = 1;
      return;
    }
    try {
      const journeys = await loadJourneyFile(files[0]!);
      // @ref LLP 1002#7-test-and-the-receipt — reject registration drift before a focused body can run.
      const expectedIdentity = argument("--expected-journeys");
      if (expectedIdentity !== undefined && expectedIdentity !== registrationIdentity(journeys)) {
        throw new Error("journey registrations changed between discovery and execution; keep names, body source and order stable");
      }
      const check = journeys[index];
      if (!check) throw new Error(`journey index ${index} is out of range`);
      if (!await runCheck(check, files[0]!, url, secret, storeRoot)) process.exitCode = 1;
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ name: files[0], kind: "journey", verdict: "fail", ms: 0, detail: String(error) })}\n`);
      process.exitCode = 1;
    }
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
      if (!await runCheck(check, file, url, secret, storeRoot)) failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

type QueryRecord = { ref: any; args: unknown; expected: unknown };
type Device = {
  client: SnapbackClient;
  records: Map<string, QueryRecord>;
  durable: boolean;
  faults: TransportFault[];
};

function queryBytes(value: unknown): string {
  return stableSerialize(value);
}

/**
 * The device's transport. A registered fault lets the request reach the owner
 * (so a commit happens), then discards the response and answers the status
 * instead: LLP 1012 §10's "503 after the commit", injected without touching
 * the owner.
 */
function faultingFetch(faults: TransportFault[]): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await globalThis.fetch(input, init);
    const path = new URL(String(input)).pathname;
    const index = faults.findIndex((fault) => fault.path === path);
    if (index < 0) return response;
    const [fault] = faults.splice(index, 1);
    await response.arrayBuffer().catch(() => undefined);
    return new Response(JSON.stringify({ message: `injected HTTP ${fault!.status}` }), {
      status: fault!.status,
      headers: { "content-type": "application/json" },
    });
  };
}

function wrapDevice(device: Device, clients: Set<SnapbackClient>): JourneyDevice {
  return new Proxy(device.client, {
    get(target, property) {
      if (property === "restart") return async () => {
        const restarted = await target.restart();
        device.client = restarted;
        clients.add(restarted);
        return wrapDevice(device, clients);
      };
      if (property === "failNextResponse") return (path: string, status: number) => {
        device.faults.push({ path, status });
      };
      if (property === "settled") return () => device.client.outbox.settled();
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as JourneyDevice;
}

async function runOfflineDerived(devices: Set<Device>): Promise<number> {
  const started = performance.now();
  let checked = 0;
  const durable = [...devices].filter((device) => device.durable);
  if (durable.length === 0) return 0;
  for (const device of durable) {
    if (device.records.size === 0) continue;
    // @ref LLP 1012#6-reads-offline — the twin evaluates over the coverage the
    // device holds now, which the drain's tail and later pages may have grown
    // since a query was first recorded; the expectation is the last online
    // answer, so each recorded query is read online once more before the
    // transport is cut, and the offline replay must match it byte for byte.
    if (device.client.snapshot.connection !== "offline") {
      for (const { ref, args } of [...device.records.values()]) {
        await device.client.query(ref, args as never).catch(() => undefined);
      }
    }
    await device.client.offline();
    for (const { ref, args, expected } of device.records.values()) {
      const replayed = await device.client.query(ref, args as never);
      if (queryBytes(replayed) !== queryBytes(expected)) {
        throw new Error(`offline replay changed bytes: ${queryBytes(expected)} != ${queryBytes(replayed)}`);
      }
      checked += 1;
    }
  }
  if (checked === 0) throw new Error("offline derived check observed no online durable query");
  process.stdout.write(`${JSON.stringify({ name: "offline", kind: "derived", verdict: "pass", ms: Math.round(performance.now() - started), detail: { queries: checked } })}\n`);
  return checked;
}

async function runCheck(
  check: RegisteredJourney,
  file: string,
  url: string,
  secret: string,
  storeRoot?: string,
): Promise<boolean> {
  const started = performance.now();
  const clients = new Set<SnapbackClient>();
  const devices = new Set<Device>();
  process.stdout.write(`${JSON.stringify({ runner: "start", name: check.name })}\n`);
  try {
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true });
    await within(5_000, async () => check.body({
      persona: (name, options = {}) => {
        if (options.store !== undefined && options.store !== "file") {
          throw new TypeError("journey as(...).store must be 'file'");
        }
        if (options.store === "file" && !storeRoot) throw new Error("file journey store root was not supplied");
        const records = new Map<string, QueryRecord>();
        const faults: TransportFault[] = [];
        const fetch = faultingFetch(faults);
        const client = createClient(options.store === "file"
          ? {
              url,
              persona: name,
              fetch,
              offline: {
                store: fileRangeStore(join(storeRoot!, name)),
              },
              // Test-only custody observer: unlike the public proxy, this sees
              // drain pages issued by the client's internal query path too.
              offlineReadObserver: (ref: any, args: unknown, expected: unknown) => {
                const key = `${String(ref?.op ?? ref)}:${stableSerialize(args)}`;
                records.set(key, { ref, args, expected });
              },
            } as Parameters<typeof createClient>[0]
          : { url, persona: name, fetch });
        clients.add(client);
        const device = { client, records, durable: options.store === "file", faults };
        devices.add(device);
        return wrapDevice(device, clients);
      },
      tick: (ms) => control(url, secret, "/control/clock", { advanceMs: ms }),
      url,
    }));
    await within(5_000, () => runOfflineDerived(devices));
    process.stdout.write(`${JSON.stringify({ name: check.name, kind: "journey", verdict: "pass", ms: Math.round(performance.now() - started), detail: { file } })}\n`);
    return true;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ name: check.name, kind: "journey", verdict: "fail", ms: Math.round(performance.now() - started), detail: error instanceof Error ? error.message : String(error) })}\n`);
    return false;
  } finally {
    for (const client of clients) client.close();
    if (storeRoot) await rm(storeRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

if (
  basename(process.argv[1] ?? "") === "test-runner.mjs"
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")
) await runEntry();
