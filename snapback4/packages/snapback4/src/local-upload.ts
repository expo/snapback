// Immediate connected upload stays distinct from durable upload-and-place.
import type { UploadOptions, Uploaded, Refusal, Link } from "./contract.ts";
import type { DeviceCore } from "./local-device.ts";
import { uploadAsset, type Bytes } from "./assets.ts";
import { waitForCaller } from "./request-wait.ts";
import { transportRefusal as offline } from "./http-response.ts";
interface Environment {
  readonly refreshing: Promise<unknown> | null;
  unavailable(): Refusal | null;
  readonly partitionDenied: Refusal | null;
  readonly link: Link;
  base: string;
  requestCredentials(): { headers: Record<string, string> };
  headers: Record<string, string>;
  doFetch: typeof fetch;
  aborter: AbortController;
  active: Set<Promise<unknown>>;
  core: DeviceCore;
  principal: string;
  refusedSession(why: Refusal, revision: number): Promise<unknown>;
  readonly credentialRevision: number;
  setLink(link: Link): void;
}
export function immediateUpload(env: Environment) {
  return async function upload(bytes: Bytes, options?: UploadOptions): Promise<Uploaded> {
      if (env.refreshing) await env.refreshing;
      const unavailableWhy = env.unavailable() ?? (env.partitionDenied?.code === "E_STORE_RESTORE" ? env.partitionDenied : null);
      if (unavailableWhy) return { ok: false as const, why: unavailableWhy };
      if (env.link !== "online") return { ok: false as const, why: offline() };
      const request = env.requestCredentials();
      const sameSession = () => !env.refreshing && request.headers.authorization === env.headers.authorization;
      const uploaded = await waitForCaller(uploadAsset(env.base, request.headers, env.doFetch, bytes,
        () => !env.unavailable() && env.link === "online" && sameSession(), options), env.aborter.signal);
      const interrupted = (): Refusal | null => env.unavailable() ?? (!sameSession()
        ? { code: "E_AUTH", family: "auth", message: "the session changed during upload; start the upload again" } : null);
      let why = interrupted();
      if (!uploaded || why) return { ok: false, why: why! };
      if (uploaded.ok) {
        let finish!: () => void;
        const keeping = new Promise<void>(resolve => { finish = resolve; });
        env.active.add(keeping); // Close must wait for receipt cleanup as well as its write.
        try {
          const stored = await env.core.call({ op: "upload_facts", viewer: env.principal, asset: uploaded.asset }) as { denied?: Refusal };
          // No helper-promise gap between this check and settling upload().
          why = interrupted();
          if (why) {
            // A cleanup refusal cannot replace the upload's session refusal.
            await env.core.call({ op: "forget_upload_facts", viewer: env.principal, id: uploaded.asset.id });
            return { ok: false, why };
          }
          return stored.denied ? { ok: false, why: stored.denied } : uploaded;
        } finally { env.active.delete(keeping); finish(); }
      }
      await env.refusedSession(uploaded.why, env.credentialRevision);
      why = interrupted();
      if (why) return { ok: false, why };
      if (!uploaded.ok && uploaded.why.code === "E_OFFLINE") env.setLink("offline");
      return uploaded;
    };
}
