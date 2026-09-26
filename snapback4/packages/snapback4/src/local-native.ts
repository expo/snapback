import type { Link, Refusal } from "./contract.ts";
import type { BackendJson } from "./backend.ts";
import { loadBackend } from "./local-backend.ts";

type State = { backend: BackendJson | null; generation: number; link: Link; closed: boolean };

/** The native-module installation closure, shared by startup and later reads. */
export function nativeInstaller(state: () => State, setBackend: (backend: BackendJson) => void,
  call: (request: Record<string, unknown>) => Promise<{ ok?: unknown; denied?: Refusal }>,
  doFetch: typeof fetch, base: string, requestCredentials: () => { headers: Record<string, string> }) {
  // The app's native module (LLP 3000.005 §9): fetched once per digest and
  // installed on the device, which keeps it; offline, the device answers
  // native reads with the module it kept, or says it has none.
  let nativeInstall: { generation: number; promise: Promise<boolean> } | null = null;
  const installNativeAttempt = async (signal?: AbortSignal): Promise<boolean> => {
    const deviceState = await call({ op: "state" });
    if (deviceState.denied) return false;
    const have = deviceState.ok as { native?: string | null } | undefined;
    let wanted = state().backend?.native?.digest;
    if (!wanted) {
      if (!state().backend?.programs.some((program) => program.native)) return true;
      // A backend restored by the device predates the server-only native
      // descriptor. Its loaded cache is usable; a rejected cache is repaired
      // from `/schema` once the link returns.
      if (typeof have?.native === "string" && have.native.length > 0) return true;
      if (state().link !== "online") return false;
      try {
        const refreshed = await loadBackend(doFetch, base, requestCredentials().headers, signal);
        if (Number(refreshed.generation ?? 0) !== state().generation) return false;
        setBackend(refreshed);
        wanted = refreshed.native?.digest;
      } catch {
        return false;
      }
    }
    if (!wanted) return false;
    if (have?.native === wanted) return true;
    const targetGeneration = state().generation;
    try {
      const request = requestCredentials();
      const response = await doFetch(`${base}/native.wasm`, { headers: request.headers, ...(signal ? { signal } : {}) });
      if (!response.ok) return false;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let hex = "";
      for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
      const installed = await call({ op: "install_native", wasm: hex, digest: wanted, generation: targetGeneration });
      return !installed.denied && !state().closed && state().generation === targetGeneration && state().backend?.native?.digest === wanted;
    } catch {
      return false;
    }
  };
  const installNative = (signal?: AbortSignal): Promise<boolean> => {
    if (nativeInstall?.generation === state().generation) return nativeInstall.promise;
    const attempt = installNativeAttempt(signal);
    const installing = { generation: state().generation, promise: attempt };
    nativeInstall = installing;
    void attempt.finally(() => { if (nativeInstall === installing) nativeInstall = null; }).catch(() => {});
    return attempt;
  };
  return installNative;
}
