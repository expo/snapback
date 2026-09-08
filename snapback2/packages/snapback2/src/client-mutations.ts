import { mayNeedAssetPlanning } from "./assets.js";
import { submitMutation, type DrainResult } from "./client-outbox.js";
import type { ClientInbox } from "./client-inbox.js";
import type { JsonRequestOptions } from "./client-wire.js";
import { copyRefusal, followerRefusal, isRefusalError, isTerminalSession, RefusalError } from "./client-wire.js";
import { withMutationUploads, type Authority, type UploadHost } from "./client-upload.js";
import { referenceName, type Op } from "./api.js";
import { mutationPresentation } from "./mutation-targets.js";
import type { OfflineRuntime } from "./offline.js";
import type { AssetInput, ClientSnapshot, Manifest, MutationResult, Refusal } from "./types.js";

/** The narrow client seam used by the mutation arm; Client owns every lifecycle transition. */
export interface MutationClient extends UploadHost {
  readonly offlineRuntime?: OfflineRuntime;
  readonly inbox: ClientInbox;
  readonly forcedOffline: boolean;
  operationAuthority(): Promise<Authority>;
  trackWrite<Value>(run: () => Promise<Value>, forwardable?: boolean): Promise<Value>;
  manifestFor(authority: Authority): Promise<Manifest>;
  validated(authority: Authority): void;
  json(path: string, init: RequestInit, authority: Authority, options?: JsonRequestOptions): Promise<unknown>;
  offlineRefusal(error: unknown): RefusalError;
  drainNow(authority?: Authority): Promise<DrainResult>;
  transportFailureState(): ClientSnapshot["connection"];
  patchSnapshot(patch: Partial<ClientSnapshot>): void;
  expireSession(authority: Authority): Promise<unknown>;
  terminalRefusal(authority: Authority, refusal: Refusal, options?: { preserveVerdict?: boolean }): Promise<void>;
}

export async function performMutation<Args, Result>(
  host: MutationClient, ref: Op<Args, Result>, args: AssetInput<Args>,
): Promise<MutationResult<Result>> {
  const op = referenceName(ref), presentation = mutationPresentation(ref);
  const authority = await host.operationAuthority();
  // @ref LLP 1018.004#2-the-inbox — a follower's write is a durable inbox row
  // before this resolves; there is no forwarded command and no unknown verdict.
  if (host.offlineRuntime?.following) {
    if (mayNeedAssetPlanning(args)) throw followerRefusal("client.mutation.upload");
    return host.trackWrite(() => host.inbox.mutation(op, args, presentation), true);
  }
  return host.trackWrite(async () => {
    try {
      const result = await withMutationUploads(host, op, args, authority,
        () => host.manifestFor(authority), async (mutationArgs, onCustody) => {
          const result = await submitMutation<Result>({
            runtime: host.offlineRuntime, offline: host.forcedOffline, op, args: mutationArgs, presentation,
            json: (path, init, onSend) => host.json(path, init, authority, { terminalSession: "after-cleanup", onSend }),
            failure: error => host.offlineRefusal(error), drain: () => host.drainNow(authority), onCustody,
            admitInbox: () => host.inbox.admit(),
          });
          try { host.validated(authority); }
          catch (error) {
            // Supersession suppresses the receipt, while retaining terminal
            // evidence about the captured token without clearing a successor.
            if (result.state === "rejected" && isTerminalSession(result)) await host.expireSession(authority);
            throw error;
          }
          return result;
        });
      if (result.state === "rejected" && isTerminalSession(result)) {
        await host.terminalRefusal(authority, result, { preserveVerdict: true });
      }
      return result;
    } catch (error) {
      if (isRefusalError(error) && isTerminalSession(error.envelope)) {
        await host.terminalRefusal(authority, error.envelope, { preserveVerdict: true });
      }
      if (isRefusalError(error) && error.code === "E_WIRE_SHAPE") {
        const ambiguous = new RefusalError(copyRefusal(error.envelope), true);
        host.patchSnapshot({ connection: host.transportFailureState(), lastRefusal: ambiguous.envelope });
        throw ambiguous;
      }
      throw error;
    }
  });
}
