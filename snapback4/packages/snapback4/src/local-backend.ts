import type { Refusal } from "./contract.ts";
import type { BackendJson } from "./backend.ts";
import type { DeviceOpener } from "./local-device.ts";
import { readWithAdmissionRetry, refusal, transportRefusal } from "./http-response.ts";

export class BackendRefusalError extends Error {
  constructor(readonly denied: Refusal) {
    super(`${denied.code}: ${denied.message}`);
  }
}
export class BackendAuthError extends BackendRefusalError {}

// @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — open kept evidence before conditionally installing a backend.
export function openLocalDevice(device: DeviceOpener, name: string, backend: BackendJson | null, startupRefusal?: BackendRefusalError) {
  return device.open(name, null).catch(error => {
    // Only never-synced permits first install; corruption/ownership cannot fall back.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("E_AUTH") || !message.includes("this device has never synced: the server must be reachable once to open")) throw error;
    if (!backend) throw startupRefusal ?? error;
    return device.open(name, { initial_backend: backend });
  });
}

export async function loadBackend(doFetch: typeof fetch, base: string, headers: Record<string, string>, signal?: AbortSignal): Promise<BackendJson> {
  const { response, json } = await readWithAdmissionRetry(() => doFetch(`${base}/schema`, { headers, ...(signal ? { signal } : {}) }), () => !signal?.aborted, signal)
    .catch(error => { throw new BackendRefusalError(transportRefusal(error)); });
  const why = refusal(json.denied);
  if (response.status === 401 && why?.code === "E_HTTP_RESPONSE") throw new BackendAuthError({ code: "E_AUTH", family: "auth", message: "the server refused this session" });
  if (why?.code === "E_AUTH" && (response.status === 401 || !why.retryable)) throw new BackendAuthError(why);
  if (why) throw new BackendRefusalError(why);
  return json as unknown as BackendJson;
}
