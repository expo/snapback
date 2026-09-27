import { routeMutations, failedSignal } from "./ephemeral.ts";
import { browserAdmission, failedAdmission } from "./admission.ts";
// @ref LLP 3000.013#6 — public handle fences are independent of private session custody.
import type { ObserveOptions, Client, Observed, Query, Read, Refusal } from "./contract.ts";
import { guardAcquisition } from "./acquisition.ts";
import { mintId } from "./client.ts";
import { observationKey, peekObservation, registerObservationPeek } from "./observe-watch.ts";
import { answerIdentity } from "./read-observation.ts";
import { deferReadNotifications } from "./read-notifications.ts";
import { episodeDeadline } from "./read-episode.ts";
import { ReadApprovals, type ApprovedAnswer } from "./read-approval.ts";
import { residencyError } from "./residency.ts";

/** I4 guards shared epochs; I8 separately revokes each exposed facade forever.
 * The raw client may retain private rotation/logout custody after this fence.
 * I12 preserves dispatched outcomes: a fence cannot turn a commit into failure. */
export function guardClient(raw: Client, check: () => Promise<boolean>, validScope: () => boolean, why: () => Refusal, retireStore?: () => Promise<void> | undefined, admit?: () => Refusal | undefined) {
  let active = true;
  const valid = () => active && validScope();
  const approved = new WeakSet<object>();
  const kept = new ReadApprovals();
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
    async residency() {
      const denied = await refusal();
      if (denied) throw residencyError(denied);
      let result;
      try { result = await raw.residency(); }
      catch (error) {
        const after = await refusal();
        if (after) throw residencyError(after);
        throw error;
      }
      const after = await refusal();
      if (after) throw residencyError(after);
      return result;
    },
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
    observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R> {
      let source: Observed<R> | undefined, stop: (() => void) | undefined, closed = false;
      const loading: Read<R> = { loading: true };
      let snapshot: Read<R> = peekObservation(client, op, args, options) ?? loading;
      let refused: Read<R> | undefined;
      let held: ApprovedAnswer | undefined, refreshVersion = 0;
      let closedDeadline: number | undefined;
      const key = observationKey(op, args, options);
      let announced: Read<unknown> | undefined;
      const denied = (): Read<R> => refused ??= { denied: why() };
      const listeners = new Set<() => void>();
      const emit = () => {
        const next = getSnapshot();
        if (announced === next) return;
        announced = next;
        for (const listener of listeners) notify(listener);
      };
      const attach = (answer: ApprovedAnswer | undefined) => {
        held = answer;
      };
      const initial = peekObservation(raw, op, args, options);
      if (initial) attach(kept.get(initial, key));
      // Notification ownership precedes even the creation of the raw watch.
      const unlisten = kept.listen(key, () => {
        const current = source?.getSnapshot() ?? peekObservation(raw, op, args, options);
        if (current) attach(kept.get(current, key));
        emit();
      });
      const reject = (read: Read<R>) => {
        snapshot = read;
        const current = source?.getSnapshot() ?? peekObservation(raw, op, args, options);
        if (current) { approved.delete(answerIdentity(current)); kept.reject(current, read); }
      };
      // @ref LLP 3000.023#3.4 — detached facades still consult the raw handle's deadline latch.
      const detach = () => { unlisten(); stop?.(); source?.close(); stop = undefined; };
      cleanups.add(detach); invalidations.add(emit);
      const refresh = async () => {
        const version = ++refreshVersion;
        // @ref LLP 3000.019#3.3 — withdrawal cannot wait for storage; only data publication needs authority.
        const read = source?.getSnapshot();
        if (read) attach(kept.get(read, key));
        if (!closed && read && ("loading" in read || "denied" in read)) {
          snapshot = valid() ? read : denied();
          if (held) reject(snapshot);
          // Shared approval delivery may already have announced this exact withdrawal.
          if (announced !== snapshot) emit();
          return;
        }
        if (!closed && read && "data" in snapshot) {
          // @ref LLP 3000.023#3.6 — every retaining watch spans authority under the same episode and row deadlines.
          snapshot = valid() ? (answerIdentity(read) === answerIdentity(snapshot) ? read
            : options?.keep !== false ? (kept.peek(read) as Read<R> | undefined) ?? loading : loading) : denied();
        }
        emit();
        const slot = held, generation = slot?.generation;
        const refused = await refusal();
        // A refusal revokes the shared slot even if this subscriber has closed.
        if (refused) { reject({ denied: refused }); if (!closed) emit(); return; }
        // @ref LLP 3000.023#3.6 — no pre-withdrawal authority completion can restore the shared answer.
        if (closed || version !== refreshVersion || slot?.generation !== generation) return;
        snapshot = !refused && valid() && source ? source.getSnapshot() : { denied: refused ?? why() };
        if ("denied" in snapshot) reject(snapshot);
        if ("data" in snapshot) {
          approved.add(answerIdentity(snapshot));
          attach(kept.approve(snapshot));
        }
        emit();
      };
      const openingGeneration = held?.generation;
      void refusal().then(refused => {
        if (refused) {
          const shared = held?.read();
          // A shared refusal already delivered during opening is this failure's
          // visible result; a newly started check can still report a new denial.
          reject(held?.generation !== openingGeneration && shared && "denied" in shared
            ? shared as Read<R> : { denied: refused });
          if (!closed) emit();
          return;
        }
        if (closed) return;
        if (valid()) {
          source = raw.observe(op, args, options);
          stop = source.subscribe(() => { void refresh().catch(() => {}); });
        }
        return refresh();
      }).catch(() => { reject(denied()); emit(); });
      const getSnapshot = (): Read<R> => {
        if (!valid()) return denied();
        // @ref LLP 3000.023#3.6 — source withdrawals pass through before this facade's subscription callback, for every policy.
        const read = source?.getSnapshot() ?? (closed ? peekObservation(raw, op, args, options) : undefined);
        // @ref LLP 3000.023#3.4 — closed facades keep only their final identity, under its original deadlines.
        if (closed) {
          if ("denied" in snapshot) return snapshot;
          if (read && "denied" in read) return snapshot = read;
          const deadline = episodeDeadline(snapshot);
          if (deadline !== undefined) closedDeadline = Math.min(closedDeadline ?? Infinity, deadline);
          if (!read || !("data" in read) || !("data" in snapshot)
            || answerIdentity(read) !== answerIdentity(snapshot)
            || (closedDeadline !== undefined && Date.now() >= closedDeadline)) snapshot = loading;
          else snapshot = read;
          return snapshot;
        }
        if (read && ("loading" in read || "denied" in read)) {
          snapshot = read;
          if (held && held.snapshot !== read) kept.reject(read, read);
          return read;
        }
        return held ? held.read() as Read<R> : snapshot;
      };
      announced = getSnapshot();
      return {
        getSnapshot,
        subscribe(listener) { if (!closed) listeners.add(listener); return () => { listeners.delete(listener); }; },
        close() {
          if (closed) return;
          listeners.clear();
          snapshot = getSnapshot(); closedDeadline = episodeDeadline(snapshot); closed = true;
          detach(); attach(undefined);
          cleanups.delete(detach); invalidations.delete(emit);
        },
      };
    },
    mutate: routeMutations((op, args) => {
      // Enter the single bounded lane synchronously. The scoped transport
      // checks the session epoch before dispatch, inside that ordered lane.
      return valid() ? raw.mutate(op, args) : Promise.resolve(failedSignal(mintId(), why()));
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
    async pendingWrites() {
      if (await refusal()) return [];
      const entries = await raw.pendingWrites();
      return valid() ? entries : [];
    },
    onPendingWrites: listener => listen(notify => raw.onPendingWrites(() => notify(undefined)), listener, undefined),
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
  // @ref LLP 3000.019#3.3 — remount sees the held approved answer while its replacement awaits authority.
  registerObservationPeek(client, (op, args, options) => {
    if (!valid()) return undefined;
    const read = peekObservation(raw, op, args, options);
    if (read && options?.keep !== false) {
      const held = kept.peek(read);
      if (held) return held;
    }
    return read && (!("data" in read) || approved.has(answerIdentity(read))) ? read : undefined;
  });
  // LocalClient's existing runtime helper also crosses the data boundary.
  const local = raw as Client & { sync?: () => Promise<void> };
  if (local.sync) Object.assign(client, { async sync() { if (!await refusal()) await local.sync!(); } });
  return { client, fence() {
    if (!active) return () => {};
    active = false;
    const deliver = deferReadNotifications(() => kept.close());
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    // The app publishes its new view before notifying retired subscriptions.
    return () => { deliver(); for (const listener of invalidations) notify(listener); invalidations.clear(); };
  } };
}
