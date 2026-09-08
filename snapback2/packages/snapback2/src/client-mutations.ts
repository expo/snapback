import { mayNeedAssetPlanning } from "./assets.js";
import { submitMutation, type DrainResult } from "./client-outbox.js";
import type { ClientForwarding } from "./client-forwarding.js";
import type { JsonRequestOptions } from "./client-wire.js";
import { copyRefusal, followerRefusal, isSnapbackRefusal, isTerminalSession, SnapbackRefusal } from "./client-wire.js";
import { withMutationUploads, type Authority, type UploadHost } from "./client-upload.js";
import { referenceName, type Op } from "./api.js";
import type { OfflineRuntime } from "./offline.js";
import type { AssetInput, ClientSnapshot, Manifest, MutationResult, RefusalEnvelope } from "./types.js";

/** The narrow client seam used by the mutation arm; Client owns every lifecycle transition. */
export interface MutationClient extends UploadHost {
  readonly offlineRuntime?: OfflineRuntime;
  readonly forwarding: ClientForwarding;
  readonly forcedOffline: boolean;
  operationAuthority(): Promise<Authority>;
  trackWrite<Value>(run: () => Promise<Value>, forwardable?: boolean): Promise<Value>;
  manifestFor(authority: Authority): Promise<Manifest>;
  validated(authority: Authority): void;
  json(path: string, init: RequestInit, authority: Authority, options?: JsonRequestOptions): Promise<unknown>;
  offlineRefusal(error: unknown): SnapbackRefusal;
  drainNow(authority?: Authority): Promise<DrainResult>;
  transportFailureState(): ClientSnapshot["connection"];
  patchSnapshot(patch: Partial<ClientSnapshot>): void;
  expireSession(authority: Authority): Promise<unknown>;
  terminalRefusal(authority: Authority, refusal: RefusalEnvelope, options?: { preserveOutcome?: boolean }): Promise<void>;
}

export async function performMutation<Args, Result>(
  host: MutationClient, ref: Op<Args, Result>, args: AssetInput<Args>,
): Promise<MutationResult<Result>> {
  const authority = await host.operationAuthority();
  const op = referenceName(ref);
  if (host.offlineRuntime?.following) {
    if (mayNeedAssetPlanning(args)) throw followerRefusal("client.mutation.upload");
    return host.trackWrite(() => host.forwarding.mutation(op, args), true);
  }
  return host.trackWrite(async () => {
    try {
      const result = await withMutationUploads(host, op, args, authority,
        () => host.manifestFor(authority), async (mutationArgs, onCustody) => {
          const result = await submitMutation<Result>({
            runtime: host.offlineRuntime, offline: host.forcedOffline, op, args: mutationArgs,
            json: (path, init, onSend) => host.json(path, init, authority, { terminalSession: "after-cleanup", onSend }),
            failure: error => host.offlineRefusal(error), drain: () => host.drainNow(authority), onCustody,
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
        await host.terminalRefusal(authority, result, { preserveOutcome: true });
      }
      return result;
    } catch (error) {
      if (isSnapbackRefusal(error) && isTerminalSession(error.envelope)) {
        await host.terminalRefusal(authority, error.envelope, { preserveOutcome: true });
      }
      if (isSnapbackRefusal(error) && error.code === "E_WIRE_SHAPE") {
        const ambiguous = new SnapbackRefusal(copyRefusal(error.envelope), true);
        host.patchSnapshot({ connection: host.transportFailureState(), lastRefusal: ambiguous.envelope });
        throw ambiguous;
      }
      throw error;
    }
  });
}
