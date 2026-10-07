// @ref LLP 3000.008.002.000#6 — an asset wait names its stage without replaying a possible once view.
import type { AssetRead, Client, Refusal } from "./contract.ts";

export type AssetStage = "scheduled" | "client" | "session" | "media" | "refresh" | "queue" | "headers" | "body" | "backoff" | "retention" | "display";
export interface AssetProgressDetail {
  readonly received?: number;
  readonly total?: number;
  readonly progress?: "bytes" | "unknown";
}
export type AssetProgress = (stage: AssetStage, detail?: AssetProgressDetail) => void;
export interface AssetWaiting {
  readonly stage: AssetStage;
  /** Wall-clock time of the latest stage change or received bytes. */
  readonly since: number;
  /** Wall-clock time at which the hook adds an E_ASSET_WAIT diagnostic. */
  readonly diagnosticAt: number;
  readonly received?: number;
  readonly total?: number;
  readonly progress?: "bytes" | "unknown";
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
// Publish before the streaming abort even on an empty/restarted body. Opaque
// transfers get a bounded explanation, not a claim that their bytes stalled.
export const assetWaitDelay = (detail: AssetProgressDetail): number => detail.progress === "unknown" ? 15_000
  : detail.progress === "bytes" ? assetDiagnosticDelay - 1 : assetDiagnosticDelay;
export function assetWaiting(stage: AssetStage, since: number, now = Date.now(), detail: AssetProgressDetail = {}): AssetWaiting {
  const delay = assetWaitDelay(detail), diagnosticAt = since + delay;
  return { stage, since, diagnosticAt, ...(detail.progress === undefined ? {} : { progress: detail.progress }), ...(detail.received === undefined ? {} : { received: detail.received }), ...(detail.total === undefined ? {} : { total: detail.total }), ...(now >= diagnosticAt ? { why: {
    code: "E_ASSET_WAIT", family: "client", site: `useAsset.${stage}`,
    message: `Asset still waiting: ${descriptions[stage]}. ${detail.progress === "unknown"
      ? `Progress is unknown; this stage has not changed for ${delay} ms. The transfer keeps its existing allowance.`
      : `No observable progress for ${delay} ms.`}`,
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
