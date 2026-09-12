// @ref LLP 1018.008.000#capacity-acquisition — borrow the existing client
// flight and operation-slot lifetime; no second owner or observation graph.
import type { Authority } from "./client-upload.js";
import type { OfflineRuntime } from "./offline.js";
import type { OutboxStatus } from "./types.js";

export interface RecoveryDemand { update(status?: OutboxStatus): void; close(): void }
export interface RecoveryClient {
  offlineRuntime?: OfflineRuntime;
  forcedOffline: boolean;
  closed: boolean;
  resumeFlight?: Promise<void>;
  resumeDemand?: string;
  recoveryRevision: number;
  recoveryReachable: boolean;
  blockedRecovery?: { op: string; demand: RecoveryDemand };
  operationAuthority(wait?: boolean): Promise<Authority>;
  ensureAuthority(authority: Authority): void;
  performResume(authority: Authority, demand?: string): Promise<void>;
}
const available = (host: RecoveryClient) => !host.closed && !host.forcedOffline;

/** Actual transport edges only; a resume's own success cannot reopen its budget. */
export function recoveryConnection(host: RecoveryClient, connected: boolean): void {
  const before = host.recoveryReachable;
  host.recoveryReachable = connected;
  if (connected && !before && !host.resumeFlight && !host.offlineRuntime?.draining) recoveryOpportunity(host);
}
export function recoveryOpportunity(host: RecoveryClient): void {
  const revision = ++host.recoveryRevision, runtime = host.offlineRuntime;
  if (!runtime || !available(host)) return;
  runtime.outbox.notify(); host.blockedRecovery?.demand.update();
  void host.operationAuthority(false).then(async authority => {
    if (revision === host.recoveryRevision && available(host) && !runtime.following
      && runtime.principal && (await runtime.outbox.status()).remaining) await host.performResume(authority);
  }).catch(() => undefined);
}

/** Each existing slot owns one finite deficit key. Invoke only from its owned
 * refresh, before snapshot-equality suppression, never from snapshot reads. */
export function observeRecovery(host: RecoveryClient, op: string): RecoveryDemand {
  let active = true, pending = false, again = false, attempted: string | undefined;
  const demand: RecoveryDemand = { close: () => { active = false; }, update: status => {
    const runtime = host.offlineRuntime, revision = host.recoveryRevision;
    if (!active || !runtime || !available(host) || runtime.following || !runtime.principal) return;
    if (pending) { again = true; return; }
    pending = true;
    void (async () => {
      status ??= await runtime.outbox.status(op);
      if (status.ready || status.reason === "program-missing") return;
      const keyOf = async () => `${revision}:${runtime.programGeneration}:${(await runtime.outbox.grant())?.used}`;
      const key = await keyOf();
      if (attempted === key) return;
      attempted = key;
      const authority = await host.operationAuthority(false);
      if (active && revision === host.recoveryRevision && available(host)) {
        try { await prepareRecovery(host, op, authority, () => active && revision === host.recoveryRevision); }
        // An unusable replacement is our own attempt, not a new opportunity.
        finally { if (active && revision === host.recoveryRevision) attempted = await keyOf(); }
      }
    })().catch(() => undefined).finally(() => {
      pending = false; if (again) { again = false; demand.update(); }
    });
  } };
  return demand;
}

export function blockedRecovery(host: RecoveryClient, op?: string): void {
  if (host.blockedRecovery?.op !== op) {
    host.blockedRecovery?.demand.close();
    host.blockedRecovery = op === undefined ? undefined : { op, demand: observeRecovery(host, op) };
  }
  host.blockedRecovery?.demand.update();
}

/** Explicit admission lends its captured authority: waiting for another
 * auth transition here would deadlock that transition's tracked-write wait. */
export async function prepareRecovery(host: RecoveryClient, op: string, authority: Authority, current?: () => boolean): Promise<void> {
  const runtime = host.offlineRuntime;
  if (!runtime || !available(host) || runtime.following || !runtime.principal) return;
  if ((await runtime.store.outbox.bounds())[op] === undefined) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const status = await runtime.outbox.status(op);
    host.ensureAuthority(authority);
    if (status.ready || status.reason === "program-missing" || !available(host) || current?.() === false) return;
    const joined = !!host.resumeFlight && host.resumeDemand !== op;
    // @ref LLP 1018.008.007.002#foreground-admission-amendment--2026-09-11 — restored capacity can
    // admit behind older intents while the same recovery still owns replay.
    // online() retains that flight's complete verdict and deadline.
    const generation = runtime.outbox.generation;
    let active = true, stop = () => {};
    const ready = new Promise<void>(resolve => {
      const check = () => { void runtime.outbox.status(op).then(next => {
        if (active && next.ready && generation === runtime.outbox.generation && !runtime.resetNeeded
          && !runtime.following && available(host) && current?.() !== false) resolve();
      }, () => undefined); };
      stop = runtime.outbox.subscribe(check);
      check(); // The grant may have changed during the initial status read.
    });
    try { await Promise.race([host.performResume(authority, op), ready]); }
    finally { active = false; stop(); }
    host.ensureAuthority(authority);
    if (!joined) return; // A cheaper flight does not consume this demand's attempt.
  }
}
