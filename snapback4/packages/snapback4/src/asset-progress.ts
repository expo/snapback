// @ref LLP 3000.008.002.000#6 — an asset wait names its stage without replaying a possible once view.
import type { AssetRead, Client, Refusal } from "./contract.ts";

export type AssetStage = "scheduled" | "client" | "session" | "media" | "refresh" | "queue" | "headers" | "body" | "backoff" | "retention" | "display";
export type AssetProgress = (stage: AssetStage) => void;
export interface AssetWaiting {
  readonly stage: AssetStage;
  readonly since: number;
  /** Wall-clock time at which the hook adds an E_ASSET_WAIT diagnostic. */
  readonly diagnosticAt: number;
  readonly why?: Refusal;
}
const descriptions: Record<AssetStage, string> = {
  scheduled: "the hook's scheduled dispatch has not run",
  client: "client.asset has not returned an outcome",
  session: "checking the current session in sessionStore",
  media: "reconciling or reading the device media cache",
  refresh: "waiting for the active session refresh",
  queue: "waiting for an asset transfer slot",
  headers: "waiting for fetch to return headers (the host may buffer the body)",
  body: "reading the response body",
  backoff: "waiting for safe retry backoff or Retry-After",
  retention: "checking the asset home and retaining ordinary bytes on the device",
  display: "constructing a display URI from the downloaded bytes",
};
export const assetDiagnosticDelay = 5000;
export function assetWaiting(stage: AssetStage, since: number, now = Date.now()): AssetWaiting {
  const diagnosticAt = since + assetDiagnosticDelay;
  return { stage, since, diagnosticAt, ...(now >= diagnosticAt ? { why: {
    code: "E_ASSET_WAIT", family: "client", site: `useAsset.${stage}`,
    message: `Asset still waiting: ${descriptions[stage]}. No ready handle or refusal has arrived after ${assetDiagnosticDelay} ms.`,
    rewrite: "inspect the named stage, session/link and host network or storage diagnostics; keep this selection mounted to receive its outcome",
    guide: "assets", retryable: false,
  } } : {}) };
}

// Private progress plumbing leaves Client.asset's one-argument contract intact.
// Key by the actual method so custom wrappers cannot inherit misleading stages.
const readers = new WeakMap<Client["asset"], (id: string, progress: AssetProgress) => Promise<AssetRead>>();
export function assetReader(read: (id: string, progress: AssetProgress) => Promise<AssetRead>): Client["asset"] {
  const method: Client["asset"] = id => read(id, () => {});
  readers.set(method, read);
  return method;
}
export function readAsset(client: Pick<Client, "asset">, id: string, progress: AssetProgress): Promise<AssetRead> {
  const read = readers.get(client.asset);
  if (read) return read(id, progress);
  progress("client");
  return client.asset(id);
}
