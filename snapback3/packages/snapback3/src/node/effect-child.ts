import "ses";
import { Worker } from "node:worker_threads";
import { createEffectFetch, type EffectFetchLimits } from "./effect-fetch";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface ChildLimits extends EffectFetchLimits {
  memoryBytes: number;
  resultBytes: number;
  logBytes: number;
  logEntries: number;
  timers: number;
  durationMs: number;
}

interface ChildJob {
  type: "run";
  source: string;
  grants: string[];
  payload: Json;
  meta: { id: string; effect: string; attempt: number };
  limits: ChildLimits;
}

interface DispatchAck { type: "dispatch-ack"; token: number }

const EFFECT_GLOBALS = [
  "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean",
  "DataView", "Date", "Error", "EvalError", "Float32Array", "Float64Array",
  "Headers", "Infinity", "Int16Array", "Int32Array", "Int8Array", "Intl",
  "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy",
  "RangeError", "ReferenceError", "Reflect", "RegExp", "Set", "String", "Symbol",
  "SyntaxError", "TextDecoder", "TextEncoder", "TypeError", "URIError", "URL",
  "URLSearchParams", "Uint16Array", "Uint32Array", "Uint8Array", "Uint8ClampedArray",
  "WeakMap", "WeakSet", "atob", "btoa", "decodeURI", "decodeURIComponent",
  "encodeURI", "encodeURIComponent", "escape", "isFinite", "isNaN", "parseFloat",
  "parseInt", "undefined", "unescape",
] as const;

const captured = Object.fromEntries(EFFECT_GLOBALS.map(name => [name, globalThis[name]])) as Record<string, unknown>;
const nativeFetch = globalThis.fetch;
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;

// @ref LLP 1003#3-the-runtime-snapback2-effects — the inherited host gives
// every job fresh hardened globals and no ambient I/O authority.
lockdown({
  errorTaming: "safe",
  errorTrapping: "none",
  evalTaming: "no-eval",
  localeTaming: "unsafe",
  overrideTaming: "severe",
  reporting: "none",
  unhandledRejectionTrapping: "none",
});

const EffectURL = makeEffectURL(captured.URL as typeof URL);

let started = false;
let dispatchToken = 0;
const dispatchAcks = new Map<number, { resolve(): void; reject(error: Error): void }>();

process.on("disconnect", () => process.exit(1));
process.on("message", (message: unknown) => {
  if (isDispatchAck(message)) {
    const pending = dispatchAcks.get(message.token);
    if (pending) { dispatchAcks.delete(message.token); pending.resolve(); }
    return;
  }
  if (started) return;
  started = true;
  void runMessage(message).finally(() => process.exit(0));
});

async function runMessage(message: unknown): Promise<void> {
  let job: ChildJob;
  try { job = parseJob(message); }
  catch (error) {
    await sendJson({ type: "result", ok: false, error: childError(error, "E_EFFECT_PROTOCOL") });
    return;
  }

  const memory = await createMemoryGuard(job.limits.memoryBytes);
  let fatalReject!: (error: Error) => void;
  const fatal = new Promise<never>((_resolve, reject) => { fatalReject = reject; });
  const uncaught = (error: unknown) => fatalReject(asError(error));
  const unhandled = (reason: unknown) => fatalReject(asError(reason));
  process.once("uncaughtException", uncaught);
  process.once("unhandledRejection", unhandled);

  const logs = createLogCapture(job.limits);
  const timers = createTimers(job.limits, fatalReject);
  const fetches = createEffectFetch(job.grants, job.limits, {
    nativeFetch,
    Headers: captured.Headers as typeof Headers,
    URL: EffectURL,
    TextDecoder: captured.TextDecoder as typeof TextDecoder,
    TextEncoder: captured.TextEncoder as typeof TextEncoder,
    harden,
    beforeDispatch,
  });
  try {
    const meta = harden({ ...job.meta });
    const endowments: Record<string, unknown> = Object.fromEntries([
      "Date", "Math", "Intl", "Headers", "TextDecoder", "TextEncoder", "URL", "URLSearchParams",
      "atob", "btoa", "escape", "unescape",
    ].map(name => [name, captured[name]]));
    endowments.URL = EffectURL;
    for (const value of Object.values(endowments)) {
      if ((typeof value === "object" && value !== null) || typeof value === "function") harden(value);
    }
    Object.assign(endowments, {
      console: logs.console,
      fetch: fetches.fetch,
      meta,
      setTimeout: timers.setTimeout,
      // These evaluators/host helpers are not in the compiler's declared effect
      // global contract. Explicitly shadow them in addition to SES taming.
      Function: undefined,
      eval: undefined,
      Compartment: undefined,
      harden: undefined,
      assert: undefined,
      process: undefined,
      require: undefined,
      Buffer: undefined,
    });
    const compartment = new Compartment({ globals: endowments, __options__: true });
    harden(compartment.globalThis);
    let run: unknown;
    try { run = compartment.evaluate(`(${job.source}\n)`); }
    catch (error) { throw codedError("E_EFFECT_SOURCE", safeErrorMessage(error)); }
    if (typeof run !== "function") throw codedError("E_EFFECT_SOURCE", "effect source did not evaluate to a function");
    const payloadText = JSON.stringify(job.payload);
    const payload = compartment.evaluate(`JSON.parse(${JSON.stringify(payloadText)})`);
    const tools = harden({ fetch: fetches.fetch, meta });
    const result = await Promise.race([Promise.resolve(Reflect.apply(run, undefined, [payload, tools])), fatal]);
    memory.assertWithinLimit();
    const json = normalizeJson(result, job.limits.resultBytes);
    const fetchState = fetches.close();
    const timerState = timers.close();
    await sendJson({
      type: "result", ok: true, result: json, logs: logs.snapshot(),
      stray: { fetches: fetchState.active, timers: timerState.active },
    });
  } catch (error) {
    const fetchState = fetches.close();
    const timerState = timers.close();
    await sendJson({
      type: "result", ok: false, error: childError(error), logs: logs.snapshot(),
      stray: { fetches: fetchState.active, timers: timerState.active },
    });
  } finally {
    await memory.close();
    process.removeListener("uncaughtException", uncaught);
    process.removeListener("unhandledRejection", unhandled);
    for (const pending of dispatchAcks.values()) pending.reject(codedError("E_EFFECT_CANCELLED", "effect child closed"));
    dispatchAcks.clear();
    try { process.disconnect(); } catch { /* parent may already be gone */ }
  }
}

async function createMemoryGuard(maxBytes: number) {
  const source = `
    const { parentPort, workerData } = require("node:worker_threads");
    const check = () => {
      if (process.memoryUsage().rss > workerData.maxBytes) process.kill(process.pid, "SIGKILL");
    };
    check();
    const timer = setInterval(check, 10);
    parentPort.postMessage("ready");
    parentPort.once("message", () => { clearInterval(timer); process.exit(0); });
  `;
  const worker = new Worker(source, { eval: true, workerData: { maxBytes } });
  await new Promise<void>((resolve, reject) => {
    worker.once("message", value => value === "ready" ? resolve() : reject(new Error("memory guard protocol failed")));
    worker.once("error", reject);
    worker.once("exit", code => { if (code !== 0) reject(new Error(`memory guard stopped (${code})`)); });
  });
  return {
    assertWithinLimit() {
      if (process.memoryUsage().rss > maxBytes) throw codedError("E_EFFECT_MEMORY_LIMIT", "effect exceeded its memory bound");
    },
    async close() {
      worker.postMessage("close");
      await worker.terminate();
    },
  };
}

function createTimers(limits: ChildLimits, fail: (error: Error) => void) {
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  let nextId = 0;
  let total = 0;
  let closed = false;
  function boundedSetTimeout(callback: (...args: unknown[]) => void, delay = 0, ...args: unknown[]): number {
    if (closed || typeof callback !== "function") throw codedError("E_EFFECT_TIMER", "effect timer callback is invalid");
    if (total >= limits.timers) throw codedError("E_EFFECT_TIMER_LIMIT", "effect timer count exceeds its bound");
    total++;
    const id = ++nextId;
    const milliseconds = Number.isFinite(delay) ? Math.max(0, Math.min(Math.floor(delay), limits.durationMs)) : 0;
    const handle = nativeSetTimeout(() => {
      handles.delete(id);
      try { Reflect.apply(callback, undefined, args); }
      catch (error) { fail(asError(error)); }
    }, milliseconds);
    handles.set(id, handle);
    return id;
  }
  return {
    setTimeout: harden(boundedSetTimeout),
    close() {
      closed = true;
      const active = handles.size;
      for (const handle of handles.values()) nativeClearTimeout(handle);
      handles.clear();
      return { active, total };
    },
  };
}

function makeEffectURL(NativeURL: typeof URL): typeof URL {
  const state = new WeakMap<object, URL>();
  const input = (value: string | URL | undefined): string | URL | undefined =>
    value instanceof EffectURL ? state.get(value)! : value;
  class EffectURL {
    constructor(value: string | URL, base?: string | URL) {
      state.set(this, new NativeURL(input(value)!, input(base)));
    }
    get href() { return state.get(this)!.href; }
    set href(value: string) { state.get(this)!.href = value; }
    get origin() { return state.get(this)!.origin; }
    get protocol() { return state.get(this)!.protocol; }
    set protocol(value: string) { state.get(this)!.protocol = value; }
    get username() { return state.get(this)!.username; }
    set username(value: string) { state.get(this)!.username = value; }
    get password() { return state.get(this)!.password; }
    set password(value: string) { state.get(this)!.password = value; }
    get host() { return state.get(this)!.host; }
    set host(value: string) { state.get(this)!.host = value; }
    get hostname() { return state.get(this)!.hostname; }
    set hostname(value: string) { state.get(this)!.hostname = value; }
    get port() { return state.get(this)!.port; }
    set port(value: string) { state.get(this)!.port = value; }
    get pathname() { return state.get(this)!.pathname; }
    set pathname(value: string) { state.get(this)!.pathname = value; }
    get search() { return state.get(this)!.search; }
    set search(value: string) { state.get(this)!.search = value; }
    get hash() { return state.get(this)!.hash; }
    set hash(value: string) { state.get(this)!.hash = value; }
    get searchParams() { return state.get(this)!.searchParams; }
    toString() { return state.get(this)!.toString(); }
    toJSON() { return state.get(this)!.toJSON(); }
    static canParse(value: string | URL, base?: string | URL): boolean {
      return NativeURL.canParse(input(value)!, input(base));
    }
    static parse(value: string | URL, base?: string | URL): URL | null {
      return EffectURL.canParse(value, base) ? new EffectURL(value, base) as unknown as URL : null;
    }
  }
  return harden(EffectURL) as unknown as typeof URL;
}

function createLogCapture(limits: ChildLimits) {
  const entries: Array<{ level: string; values: Json[] }> = [];
  let bytes = 0;
  let truncated = false;
  function record(level: string, values: unknown[]): void {
    if (entries.length >= limits.logEntries || truncated) { truncated = true; return; }
    const entry = { level, values: values.map(summarizeLogValue) };
    const size = byteLength(JSON.stringify(entry));
    if (bytes + size > limits.logBytes) { truncated = true; return; }
    bytes += size;
    entries.push(entry);
  }
  const console = harden(Object.fromEntries(["log", "info", "debug", "warn", "error"].map(level => [
    level, harden((...values: unknown[]) => record(level, values)),
  ])));
  return { console, snapshot: () => ({ entries, bytes, truncated }) };
}

function summarizeLogValue(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return typeof value === "string" ? `[string ${byteLength(value)} bytes]` : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function" || value === undefined) {
    return `[${typeof value}]`;
  }
  if (value instanceof Error) return { name: "Error", message: "[redacted]" };
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  return "[Object]";
}

async function beforeDispatch(): Promise<void> {
  const token = ++dispatchToken;
  const acknowledged = new Promise<void>((resolve, reject) => dispatchAcks.set(token, { resolve, reject }));
  await sendJson({ type: "dispatch", token });
  await acknowledged;
}

function normalizeJson(value: unknown, maxBytes: number): Json {
  const seen = new WeakSet<object>();
  function visit(current: unknown): Json {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw codedError("E_EFFECT_RESULT", "effect result contains a non-finite number");
      return current;
    }
    if (typeof current !== "object") throw codedError("E_EFFECT_RESULT", `effect result contains ${typeof current}`);
    if (seen.has(current)) throw codedError("E_EFFECT_RESULT", "effect result contains a cycle");
    seen.add(current);
    const symbols = Reflect.ownKeys(current).filter(key => typeof key === "symbol");
    if (symbols.length) throw codedError("E_EFFECT_RESULT", "effect result contains a symbol key");
    if (Array.isArray(current)) {
      const array = current.map(visit);
      seen.delete(current);
      return array;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw codedError("E_EFFECT_RESULT", "effect result must contain only JSON objects and arrays");
    }
    const output: { [key: string]: Json } = Object.create(null);
    for (const key of Object.keys(current)) output[key] = visit((current as Record<string, unknown>)[key]);
    seen.delete(current);
    return output;
  }
  const result = visit(value);
  if (byteLength(JSON.stringify(result)) > maxBytes) {
    throw codedError("E_EFFECT_RESULT", `effect result exceeds ${maxBytes} bytes`);
  }
  return result;
}

function childError(error: unknown, fallbackCode = "E_EFFECT_RUN") {
  const code = typeof (error as { code?: unknown } | null)?.code === "string"
    ? (error as { code: string }).code.slice(0, 128) : fallbackCode;
  return { code, message: safeErrorMessage(error), retry: !TERMINAL_CODES.has(code) };
}

const TERMINAL_CODES = new Set([
  "E_EFFECT_GRANT", "E_EFFECT_RESULT", "E_EFFECT_SOURCE", "E_EFFECT_FETCH_LIMIT",
  "E_EFFECT_REQUEST_TOO_LARGE", "E_EFFECT_RESPONSE_TOO_LARGE", "E_EFFECT_REDIRECT",
  "E_EFFECT_TIMER_LIMIT", "E_EFFECT_PROTOCOL",
]);

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return harden(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(typeof error === "string" ? error : "effect failed");
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 2_048) : "effect failed";
}

function isDispatchAck(value: unknown): value is DispatchAck {
  return !!value && typeof value === "object" && (value as DispatchAck).type === "dispatch-ack"
    && Number.isSafeInteger((value as DispatchAck).token);
}

function parseJob(value: unknown): ChildJob {
  if (!value || typeof value !== "object") throw new TypeError("effect child expected a JSON job");
  const job = value as Partial<ChildJob>;
  if (job.type !== "run" || typeof job.source !== "string" || !Array.isArray(job.grants)
    || !job.grants.every(grant => typeof grant === "string") || !job.meta || typeof job.meta.id !== "string"
    || typeof job.meta.effect !== "string" || !Number.isSafeInteger(job.meta.attempt) || !job.limits) {
    throw new TypeError("effect child received an invalid job");
  }
  return job as ChildJob;
}

function sendJson(value: Json | { [key: string]: unknown }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send || !process.connected) { reject(new Error("effect parent disconnected")); return; }
    let encoded: string;
    try { encoded = JSON.stringify(value); }
    catch { reject(new Error("effect child response is not JSON")); return; }
    process.send(JSON.parse(encoded), error => error ? reject(error) : resolve());
  });
}

function byteLength(value: string): number {
  return new (captured.TextEncoder as typeof TextEncoder)().encode(value).byteLength;
}
