import { requireSyncProtocol } from "./local-sync.ts";
import type { DeviceCore } from "./local-device.ts";
import type { Refusal } from "./contract.ts";
export interface DeviceEngine { format: number; version: string; capabilities: string[] }
export interface DeviceCompatibility { server_version: string; minimum_version: string; capabilities: string[] }
export type DeviceVersionStatus = { state: "compatible"; engine: DeviceEngine } | { state: "incompatible"; why: Refusal };
/** Compatibility refusals are distinguishable without matching error text. */
export class DeviceVersionError extends Error {
  readonly status: Extract<DeviceVersionStatus, { state: "incompatible" }>;
  constructor(readonly why: Refusal) { super(`${why.code}: ${why.message}`); this.name = "DeviceVersionError"; this.status = { state: "incompatible", why }; }
}
export function engineHeaders(engine: DeviceEngine): Record<string, string> { return { "x-snapback-device": JSON.stringify(engine) }; }
export function deviceVersionRefusal(why: Refusal | undefined): DeviceVersionError | undefined {
  return why?.code === "E_DEVICE_VERSION" ? new DeviceVersionError(why) : undefined;
}
export function unknownEngine(): DeviceEngine { return { format: 0, version: "unknown (unstamped)", capabilities: [] }; }

export function validEngine(value: unknown): value is DeviceEngine {
  const d = value as DeviceEngine | null;
  return !!d && typeof d === "object" && d.format === 1 && typeof d.version === "string" && /^\d+\.\d+\.\d+$/.test(d.version)
    && Array.isArray(d.capabilities) && d.capabilities.length <= 256 && d.capabilities.every(c => typeof c === "string" && c.length > 0 && c.length <= 128);
}
export function normalizeEngine(value: unknown): DeviceEngine { return validEngine(value) ? value : unknownEngine(); }

export function deviceVersionState(engine: DeviceEngine, onStatus?: (status: DeviceVersionStatus) => void) {
  let status: DeviceVersionStatus = { state: "compatible", engine };
  let publish: ((why: Refusal) => void) | undefined;
  const reads = new AbortController();
  const refuse = (why: Refusal | undefined) => {
    const error = deviceVersionRefusal(why);
    if (error) { status = error.status; reads.abort(error); publish?.(error.why); onStatus?.(status); }
    return error;
  };
  return {
    status: () => status,
    signal: reads.signal,
    blocked: () => status.state === "incompatible",
    denied: () => status.state === "incompatible" ? status.why : null,
    publish: (fn: (why: Refusal) => void) => { publish = fn; },
    compatible: (engine: DeviceEngine, headers?: Record<string, string>) => { if (headers) Object.assign(headers, engineHeaders(engine)); status = { state: "compatible", engine }; },
    refuse,
    async run<T>(work: () => Promise<T>): Promise<T> {
      try { return await work(); }
      catch (error) { if (error instanceof DeviceVersionError) throw refuse(error.why)!; throw error; }
    },
  };
}

export async function probeDeviceEngine(core: DeviceCore, reported?: DeviceEngine): Promise<DeviceEngine> {
  let actual: unknown;
  try { await requireSyncProtocol(core); actual = (await core.call({ op: "engine_info" })).ok; }
  catch (cause) { throw new DeviceVersionError({ code: "E_DEVICE_VERSION", family: "device-version", message: `device engine ${reported?.version ?? "unknown (unstamped)"} lacks engine-handshake-v1; rebuild the device: bun exact.mjs snapback --rebuild / npx expo run:ios / rebuild the web app; ${String(cause)}` }); }
  if (!validEngine(actual)) throw new DeviceVersionError({ code: "E_DEVICE_VERSION", family: "device-version", message: "device engine unknown (unstamped) lacks engine-handshake-v1; rebuild the device: bun exact.mjs snapback --rebuild / npx expo run:ios / rebuild the web app" });
  return actual;
}
