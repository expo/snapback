import type { Client, Observed, Query, Read, Refusal } from "./contract.ts";
import { mintId } from "./client.ts";

/** I4 also covers device-only reads, cached observations and retained media. */
export function guardClient(raw: Client, check: () => Promise<boolean>, valid: () => boolean, why: () => Refusal): Client {
  const refusal = async (): Promise<Refusal | undefined> => {
    try { return await check() ? undefined : why(); }
    catch (error) {
      return { code: "E_CLIENT", family: "client", message: String(error), site: "app.client",
        rewrite: "repair sessionStore, then retry the operation" };
    }
  };
  return {
    ...raw,
    get acquired() { return valid() && raw.acquired; },
    viewer: () => valid() ? raw.viewer() : null,
    assetSource: id => valid() ? raw.assetSource(id) : { uri: "", headers: {} },
    async query(op, args) {
      const denied = await refusal();
      if (denied) return { denied };
      const read = await raw.query(op, args);
      return valid() ? read : { denied: why() };
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      let source: Observed<R> | undefined, stop: (() => void) | undefined, closed = false;
      let snapshot: Read<R> = { loading: true };
      const denied: Read<R> = { denied: why() };
      const listeners = new Set<() => void>();
      const refresh = async () => {
        const refused = await refusal();
        if (closed) return;
        snapshot = !refused && valid() && source ? source.getSnapshot() : { denied: refused ?? why() };
        for (const listener of listeners) listener();
      };
      void refusal().then(refused => {
        if (closed) return;
        if (refused) { snapshot = { denied: refused }; for (const listener of listeners) listener(); return; }
        if (valid()) {
          source = raw.observe(op, args);
          stop = source.subscribe(() => { void refresh().catch(() => {}); });
        }
        return refresh();
      }).catch(() => {
        snapshot = { denied: why() };
        for (const listener of listeners) listener();
      });
      return {
        getSnapshot: () => valid() ? snapshot : denied,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        close() { closed = true; stop?.(); source?.close(); listeners.clear(); },
      };
    },
    async mutate(op, args, options) {
      const id = options?.id ?? mintId();
      // Preserve admission-time argument custody before the asynchronous lock.
      let snapshot: typeof args;
      try { snapshot = JSON.parse(JSON.stringify(args)); }
      catch { return { state: "failed", id, why: { code: "E_INPUT", family: "input", message: "mutation arguments must be JSON-serializable", guide: "writes" } }; }
      const denied = await refusal();
      if (denied) return { state: "failed", id, why: denied };
      return raw.mutate(op, snapshot, { ...options, id });
    },
    async write(id) { return await refusal() ? undefined : raw.write(id); },
    async act(op, args, options) {
      const denied = await refusal();
      return denied ? { denied, id: options?.id ?? mintId() } : raw.act(op, args, options);
    },
    async upload(bytes) {
      const denied = await refusal();
      return denied ? { ok: false, why: denied } : raw.upload(bytes);
    },
    async asset(id) {
      const denied = await refusal();
      if (denied) return { denied };
      const asset = await raw.asset(id);
      if (valid()) return asset;
      if ("url" in asset) asset.revoke();
      return { denied: why() };
    },
    onWrite(listener) { return raw.onWrite(write => { if (valid()) listener(write); }); },
  };
}
