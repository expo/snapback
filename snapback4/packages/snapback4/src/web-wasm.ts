import { normalizeEngine, unknownEngine, DeviceVersionError, type DeviceEngine } from "./device-version.ts";
import init from "./wasm/snapback4_device.js";
import type { Persistence } from "./web.ts";

export type WasmSource = URL | string | Response | BufferSource | WebAssembly.Module;
let runtime: { identity: string | WebAssembly.Module; initialized: unknown; engine: DeviceEngine } | undefined;
let initialization: Promise<unknown> = Promise.resolve();
let compilation: { identity: string | WebAssembly.Module; module: Promise<WebAssembly.Module> } | undefined;
export const wasmMemoryBytes = () => (runtime!.initialized as { memory: WebAssembly.Memory }).memory.buffer.byteLength;

// @ref LLP 3000.007#8 — a cold offline open owns its wasm bytes, keyed by SHA-256
export interface PreparedWasm { source: BufferSource | WebAssembly.Module; url: string | null; engine: DeviceEngine }
export async function prepareWasm(source: WasmSource | Promise<WasmSource>, persist: Persistence): Promise<PreparedWasm> {
  let pinned!: { source: BufferSource | WebAssembly.Module; url: string | null };
  const engine = await cachedWasm(source, persist, true, (source, url) => { pinned = { source, url }; }) as DeviceEngine;
  return { ...pinned, engine };
}
export async function initializePreparedWasm(prepared: PreparedWasm, persist: Persistence): Promise<unknown> {
  return cachedWasm(prepared.source, persist, false, undefined, prepared.url);
}
export async function cachedWasm(source: WasmSource | Promise<WasmSource>, persist: Persistence, stampOnly = false,
  capture?: (source: BufferSource | WebAssembly.Module, url: string | null) => void, originalUrl?: string | null): Promise<unknown> {
  const resolved = await source;
  if (resolved instanceof WebAssembly.Module) { capture?.(resolved, originalUrl ?? null); return initializeWasm(resolved, resolved, stampOnly); }
  const isUrl = typeof resolved === "string" || resolved instanceof URL;
  const url = originalUrl ?? (isUrl ? String(resolved) : null);
  const name = "snapback4-wasm";
  const saved = isUrl && url ? await persist.load(name) : [];
  const pointer = saved.find((c) => c.s === "url" && c.k === url)?.v;
  const hex = pointer && saved.find((c) => c.s === "sha256" && c.k === pointer)?.v;
  const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex) {
    const bytes = unhex(hex);
    if (bytes && pointer && await digest(bytes) === pointer) {
      try { const result = await initializeWasm(bytes, pointer, stampOnly); capture?.(bytes, url); return result; } catch {
        // A cache from an interrupted/older installer may be unusable even
        // when its content hash matches. An online fetch can repair it.
      }
    }
  }
  const fetched = isUrl ? await fetch(resolved as string | URL) : resolved;
  if (fetched instanceof Response && !fetched.ok) throw new Error(`wasm: HTTP ${fetched.status}`);
  const bytes = (fetched instanceof Response ? new Uint8Array(await fetched.arrayBuffer())
    : ArrayBuffer.isView(fetched) ? new Uint8Array(fetched.buffer, fetched.byteOffset, fetched.byteLength) : new Uint8Array(fetched as ArrayBuffer)).slice();
  const hash = await digest(bytes);
  capture?.(bytes, url);
  // Initialization must succeed before these bytes become the offline entry.
  // The content and URL pointer are then installed in one atomic host save.
  const initialized = await initializeWasm(bytes, hash, stampOnly);
  if (!stampOnly) await persist.save(name, [
    { s: "sha256", k: hash, v: hexBytes(bytes) },
    ...(url ? [{ s: "url", k: url, v: hash }] : []),
  ]);
  return initialized;
}

async function initializeWasm(source: BufferSource | WebAssembly.Module, identity: string | WebAssembly.Module, stampOnly = false): Promise<unknown> {
  // The content hash was checked on this call. Reuse preflight's compiled
  // module without trusting an unchecked URL or retaining a second VM.
  // @ref LLP 3000.002#browser-startup-loading — reuse validated preparation and bound cache conversion allocations.
  if (!(source instanceof WebAssembly.Module) && compilation?.identity !== identity) {
    const pending = { identity, module: WebAssembly.compile(source) };
    compilation = pending;
    void pending.module.catch(() => { if (compilation === pending) compilation = undefined; });
  }
  const module = source instanceof WebAssembly.Module ? source : await compilation!.module;
  const sections = WebAssembly.Module.customSections(module, "snapback4.engine");
  let stamp = unknownEngine();
  if (sections.length === 1) { try { stamp = normalizeEngine(JSON.parse(new TextDecoder().decode(sections[0]))); } catch {} }
  if (stampOnly) return stamp;
  const work = initialization.then(async () => {
  // wasm-bindgen retains the initialized instance even if the later cache
  // save fails. Its shortcut cannot validate another module's linking: only
  // the exact initialized content may retry installation in this realm.
  if (runtime) {
    if (runtime.identity !== identity) throw new DeviceVersionError({ code: "E_DEVICE_VERSION", family: "device-version", guide: "wire",
      message: `device engine ${runtime.engine.version} cannot open requested engine ${stamp.version}: missing device-runtime-identity; reload this page before installing different runtime bytes, and rebuild the web device` });
    return runtime.initialized;
  }
  const exports = new Map(WebAssembly.Module.exports(module).map(e => [e.name, e.kind]));
  if (exports.get("memory") !== "memory" || ["webdevice_new", "webdevice_call", "webdevice_drain", "webdevice_drain_chunk", "__wbg_webdevice_free"].some(name => exports.get(name) !== "function")) {
    throw new Error("wasm: the module does not export the Snapback device runtime; use the wasm shipped with this package");
  }
  const initialized = await init({ module_or_path: module });
  runtime = { identity, initialized, engine: stamp };
  return initialized;
  });
  initialization = work.catch(() => {});
  return work;
}

// Keep the persisted format: cached bytes and their URL pointer still install
// atomically. Avoid an array of millions of per-byte strings during startup.
function hexBytes(bytes: Uint8Array): string {
  const table = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0")), chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 8192) {
    const end = Math.min(bytes.length, at + 8192), parts: string[] = [];
    for (let i = at; i < end; i++) parts.push(table[bytes[i]!]!);
    chunks.push(parts.join(""));
  }
  return chunks.join("");
}

function unhex(hex: string): Uint8Array | undefined {
  if (hex.length % 2) return;
  const bytes = new Uint8Array(hex.length / 2);
  const digit = (c: number) => c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
  for (let i = 0; i < bytes.length; i++) {
    const high = digit(hex.charCodeAt(2 * i)), low = digit(hex.charCodeAt(2 * i + 1));
    if (high < 0 || low < 0) return;
    bytes[i] = high * 16 + low;
  }
  return bytes;
}
