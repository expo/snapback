import { loadBackend } from "./local-backend.ts";
import type { BackendJson } from "./backend.ts";
import type { Link, Refusal } from "./contract.ts";

export function nativeInstaller(host: {
  call(request: Record<string, unknown>): Promise<{ ok?: unknown; denied?: Refusal }>;
  backend(): BackendJson | null | undefined;
  setBackend(backend: BackendJson): void;
  generation(): number;
  link(): Link;
  closed(): boolean;
  credentials(): { headers: Record<string, string> };
  fetch: typeof fetch;
  base: string;
}) {
  // The app's native module (LLP 3000.005 §9): fetched once per digest and
  // installed on the device, which keeps it; offline, the device answers
  // native reads with the module it kept, or says it has none.
  let nativeInstall: { generation: number; promise: Promise<boolean> } | null = null;
  const installNativeAttempt = async (signal?: AbortSignal): Promise<boolean> => {
    const state = await host.call({ op: "state" });
    if (state.denied) return false;
    const have = state.ok as { native?: string | null } | undefined;
    let wanted = host.backend()?.native?.digest;
    if (!wanted) {
      if (!host.backend()?.programs.some((program) => program.native)) return true;
      // A backend restored by the device predates the server-only native
      // descriptor. Its loaded cache is usable; a rejected cache is repaired
      // from `/schema` once the link returns.
      if (typeof have?.native === "string" && have.native.length > 0) return true;
      if (host.link() !== "online") return false;
      try {
        const refreshed = await loadBackend(host.fetch, host.base, host.credentials().headers, signal);
        if (Number(refreshed.generation ?? 0) !== host.generation()) return false;
        host.setBackend(refreshed);
        wanted = refreshed.native?.digest;
      } catch {
        return false;
      }
    }
    if (!wanted) return false;
    if (have?.native === wanted) return true;
    const targetGeneration = host.generation();
    try {
      const request = host.credentials();
      const response = await host.fetch(`${host.base}/native.wasm`, { headers: request.headers, ...(signal ? { signal } : {}) });
      if (!response.ok) return false;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let hex = "";
      for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
      const installed = await host.call({ op: "install_native", wasm: hex, digest: wanted, generation: targetGeneration });
      return !installed.denied && !host.closed() && host.generation() === targetGeneration && host.backend()?.native?.digest === wanted;
    } catch {
      return false;
    }
  };
  return (signal?: AbortSignal): Promise<boolean> => {
    if (nativeInstall?.generation === host.generation()) return nativeInstall.promise;
    const attempt = installNativeAttempt(signal);
    const installing = { generation: host.generation(), promise: attempt };
    nativeInstall = installing;
    void attempt.finally(() => { if (nativeInstall === installing) nativeInstall = null; }).catch(() => {});
    return attempt;
  };
}
