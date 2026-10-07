// @ref LLP 3000.033#1.8 — server access borrows custody internally, never exports credentials.
import type { Client, Ephemeral, Refusal, Signal } from "./contract.ts";
import { guardClient } from "./app-client.ts";
import { mintId } from "./client.ts";
import { QUERY_LIFETIME } from "./query-settlement.ts";
import { armOperations } from "./online-arm-fence.ts";

/** Server reads, transient signals and actions under the app's current session.
 * Durable mutations belong to app.mutate. Identity and lifetime belong to app.auth. */
export interface Online extends Pick<Client, "query" | "observe" | "act" | "link" | "onLink" | "now" | "viewer" | "readOnly"> {
  mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>;
}

/** Explicit projection: neither runtime enumeration nor types reveal session,
 * headers, assetSource, refresh, logout or the underlying Client. */
export function onlineView(client: Client): Online {
  return {
    query: client.query, observe: client.observe,
    act(op, args, options) {
      if (client.link() === "signed-out") return Promise.resolve({ id: options?.id ?? mintId(),
        denied: { code: "E_AUTH", family: "auth", message: "sign in to continue" } });
      return client.act(op, args, options);
    },
    link: client.link, onLink: client.onLink, now: client.now, viewer: client.viewer,
    readOnly: client.readOnly ?? false,
    mutate(op, args) {
      if (client.link() === "signed-out") return Promise.resolve({ state: "failed", id: mintId(),
        why: { code: "E_AUTH", family: "auth", message: "sign in to continue" } });
      if (!op.ephemeral && !client.readOnly) return Promise.resolve({ state: "failed", id: mintId(),
        why: { code: "E_INPUT", family: "input", message: "use app.mutate for durable writes", guide: "client" } });
      return client.mutate(op, args);
    },
  };
}

export function ownOnline(raw: Client, check: () => Promise<boolean>, valid: () => boolean, why: () => Refusal, closeRaw: boolean, retire: () => void) {
  const guarded = guardClient(raw, check, valid, why);
  const calls = new Set<Promise<unknown>>();
  function track<T>(call: Promise<T>): Promise<T> {
    calls.add(call);
    void call.then(() => calls.delete(call), () => calls.delete(call));
    return call;
  }
  const view = onlineView(guarded.client);
  const bind = armOperations(valid, why);
  const online: Online = { ...view,
    query: (op, args) => track(view.query(bind(op), args)),
    observe: (op, args, options) => view.observe(bind(op), args, options),
    mutate: (op, args) => track(view.mutate(bind(op), args)),
    act: (op, args, options) => track(view.act(bind(op), args, options)),
  };
  let retired = false;
  return { online, fence() {
    if (retired) return () => {};
    retired = true;
    retire();
    // Withdraw reads and prevent new dispatch first. Already dispatched signal
    // and action outcomes settle before close can abort their private transport.
    const notify = guarded.fence();
    if (closeRaw) {
      // A custom transport may never finish an action. Retirement allows the
      // same 30s as a one-shot read, then raw close returns its unknown outcome
      // as pending with the original action ID. No old request may retry.
      const timer = setTimeout(() => { void raw.close(); }, QUERY_LIFETIME);
      (timer as { unref?: () => void }).unref?.();
      void Promise.allSettled([...calls]).then(() => { clearTimeout(timer); return raw.close(); });
    }
    return notify;
  } };
}
