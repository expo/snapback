import { routeMutations, failedSignal, ephemeralOffline } from "./ephemeral.ts";
import { browserAdmission, failedAdmission } from "./admission.ts";
// @ref LLP 3000.013#6 — public handle fences are independent of private session custody.
import type { Client, Observed, Query, Read, Refusal } from "./contract.ts";
import { guardAcquisition } from "./acquisition.ts";
import { mintId } from "./client.ts";

/** I4 guards shared epochs; I8 separately revokes each exposed facade forever.
 * The raw client may retain private rotation/logout custody after this fence.
 * I12 preserves dispatched outcomes: a fence cannot turn a commit into failure. */
export function guardClient(raw: Client, check: () => Promise<boolean>, validScope: () => boolean, why: () => Refusal, retireStore?: () => Promise<void> | undefined, admit?: () => Refusal | undefined) {
  let active = true;
  const valid = () => active && validScope();
  const cleanups = new Set<() => void>(), invalidations = new Set<() => void>();
  const notify = (listener: () => void) => { try { listener(); } catch (error) { console.error("snapback4 client listener:", error); } };
  const refusal = async (): Promise<Refusal | undefined> => {
    if (!valid()) return why();
    try { return await check() && valid() ? undefined : why(); }
    catch (error) {
      return { code: "E_CLIENT", family: "client", message: String(error), site: "app.client",
        rewrite: "repair sessionStore, then retry the operation" };
    }
  };
  function listen<T>(subscribe: (listener: (value: T) => void) => () => void, listener: (value: T) => void, ended: T) {
    if (!valid()) return () => {};
    const stop = subscribe(value => { if (valid()) listener(value); });
    const invalidate = () => listener(ended);
    cleanups.add(stop); invalidations.add(invalidate);
    return () => { stop(); cleanups.delete(stop); invalidations.delete(invalidate); };
  }
  const client: Client = {
    ...raw,
    get acquired() { return valid() && raw.acquired; },
    viewer: () => valid() ? raw.viewer() : null,
    session: () => valid() ? raw.session() : null,
    link: () => valid() ? raw.link() : "signed-out",
    onViewer: listener => listen(raw.onViewer, listener, null),
    onSession: listener => listen(raw.onSession, listener, null),
    onLink: listener => listen(raw.onLink, listener, "signed-out"),
    onAcquired: listener => listen(raw.onAcquired, listener, false),
    async refreshSession() {
      const denied = await refusal();
      if (denied) return { ok: false, why: denied };
      return raw.refreshSession();
    },
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
      let refused: Read<R> | undefined;
      const denied = (): Read<R> => refused ??= { denied: why() };
      const listeners = new Set<() => void>();
      const emit = () => { for (const listener of listeners) notify(listener); };
      const detach = () => { stop?.(); source?.close(); source = undefined; stop = undefined; };
      cleanups.add(detach); invalidations.add(emit);
      const refresh = async () => {
        const refused = await refusal();
        if (closed) return;
        snapshot = !refused && valid() && source ? source.getSnapshot() : { denied: refused ?? why() };
        emit();
      };
      void refusal().then(refused => {
        if (closed) return;
        if (refused) { snapshot = { denied: refused }; emit(); return; }
        if (valid()) {
          source = raw.observe(op, args);
          stop = source.subscribe(() => { void refresh().catch(() => {}); });
        }
        return refresh();
      }).catch(() => { snapshot = denied(); emit(); });
      return {
        getSnapshot: () => valid() ? snapshot : denied(),
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        close() { closed = true; detach(); cleanups.delete(detach); invalidations.delete(emit); listeners.clear(); },
      };
    },
    mutate: routeMutations(async (op, args) => {
      // Ephemeral calls never enter browser admission or the intent journal.
      if (!valid()) return failedSignal(mintId(), why());
      if (raw.link() !== "online") return failedSignal(mintId(), ephemeralOffline());
      let snapshot: typeof args;
      try { snapshot = JSON.parse(JSON.stringify(args)); }
      catch { return failedSignal(mintId(), { code: "E_INPUT", family: "input", message: "ephemeral arguments must be JSON-serializable" }); }
      const denied = await refusal();
      return denied ? failedSignal(mintId(), denied) : raw.mutate(op, snapshot);
    }, (op, args, options) => {
      if (browserAdmission() && admit) {
        const id = options?.id ?? mintId();
        const denied = valid() ? admit() : why();
        return denied ? failedAdmission(id, denied) : raw.mutate(op, args, { ...options, id });
      }
      return (async () => {
      const id = options?.id ?? mintId();
      // Preserve admission-time argument custody before the asynchronous lock.
      let snapshot: typeof args;
      try { snapshot = JSON.parse(JSON.stringify(args)); }
      catch { return { state: "failed", id, why: { code: "E_INPUT", family: "input", message: "mutation arguments must be JSON-serializable", guide: "writes" } }; }
      const denied = await refusal();
      if (denied) {
        // A repeated ID can already have durable custody behind this facade.
        // Store retirement must commit before a terminal refusal can escape.
        if (["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(denied.code)) {
          try { await retireStore?.(); }
          catch { return { state: "pending", id, reason: "waiting to persist the terminal receipt" }; }
        }
        return { state: "failed", id, why: denied };
      }
      return raw.mutate(op, snapshot, { ...options, id });
      })();
    }),
    async write(id) {
      if (await refusal()) return undefined;
      return raw.write(id);
    },
    async act(op, args, options) {
      const denied = await refusal();
      if (denied) return { denied, id: options?.id ?? mintId() };
      return raw.act(op, args, options);
    },
    async upload(bytes) {
      const denied = await refusal();
      if (denied) return { ok: false, why: denied };
      return raw.upload(bytes);
    },
    async asset(id) {
      const denied = await refusal();
      if (denied) return { denied };
      const asset = await raw.asset(id);
      if (valid()) return asset;
      if ("url" in asset) asset.revoke();
      return { denied: why() };
    },
    onWrite(listener) {
      if (!valid()) return () => {};
      const stop = raw.onWrite(write => { if (valid()) listener(write); });
      cleanups.add(stop); return () => { cleanups.delete(stop); stop(); };
    },
  };
  guardAcquisition(client, raw, valid);
  // LocalClient's existing runtime helper also crosses the data boundary.
  const local = raw as Client & { sync?: () => Promise<void> };
  if (local.sync) Object.assign(client, { async sync() { if (!await refusal()) await local.sync!(); } });
  return { client, fence() {
    if (!active) return () => {};
    active = false;
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    // The app publishes its new view before notifying retired subscriptions.
    return () => { for (const listener of invalidations) notify(listener); invalidations.clear(); };
  } };
}
