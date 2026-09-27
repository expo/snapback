import type { Refusal } from "./contract.ts";
import type { BackendJson } from "./backend.ts";

export class BackendAuthError extends Error {
  constructor(readonly denied: Refusal) {
    super(`${denied.code}: ${denied.message}`);
  }
}

export async function loadBackend(doFetch: typeof fetch, base: string, headers: Record<string, string>, signal?: AbortSignal): Promise<BackendJson> {
  const response = await doFetch(`${base}/schema`, { headers, ...(signal ? { signal } : {}) });
  let json: BackendJson & { denied?: Refusal };
  try { json = (await response.json()) as BackendJson & { denied?: Refusal }; }
  catch (error) {
    if (response.status === 401) throw new BackendAuthError({ code: "E_AUTH", family: "auth", message: "the server refused this session" });
    throw error;
  }
  if (response.status === 401 || (json.denied?.code === "E_AUTH" && !json.denied.retryable)) throw new BackendAuthError(json.denied ?? { code: "E_AUTH", family: "auth", message: "the server refused this session" });
  if (json.denied) throw new Error(`schema: ${json.denied.code}: ${json.denied.message}`);
  if (!response.ok) throw new Error(`schema: HTTP ${response.status}`);
  return json;
}
