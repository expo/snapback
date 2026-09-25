// Query publication procedure (LLP 3000.016 §2.2):
// 1. Check session/incarnation after every await and before publication.
// 2. Run locally first; a known complete answer wins, regardless of `runs`.
// 3. The engine decides unavailability (or the query could not run): offline,
//    intersecting prediction, or held => loading; otherwise try original args.
// 4. Unknown non-speculative values remain partial data. Speculative values
//    (including refusals) recover unexpired memory or loading/E_OFFLINE, and
//    stay loading while fenced. A speculative component withholds the whole
//    composition: Read<T> cannot express an absent field with loading metadata.
// 5. Recheck session and P ∩ S before any external answer lands. S is static
//    (opaque programs read everything), narrowed only by a known COMPLETE L.
//    Remembered answers share this fence; all data rechecks expiry, and local
//    expiry retries locally once (then dirties a watch if still expired).
//    Local freshness is decided at publication.
import type { Cursor, Link, Query, Read, ReadCut, Refusal } from "./contract.ts";
import { operationTables, type BackendJson } from "./backend.ts";
import { predictedTables, type ServerAnswer, type LocalWatch as Watch } from "./local-reads.ts";
import type { Queued } from "./local-types.ts";

type Result<R> = { read: Read<R>; tables: Set<string>; nextExpiry: number | null };
type Candidate<R> = { result: Result<R>; origin: "local" | "server" | "remembered" | "composed" };
type Coverage = { complete?: boolean; unknown?: boolean; retained?: boolean; speculative?: boolean; denied?: Refusal };
type Outcome = Coverage & { loading?: boolean; data?: unknown; cut?: ReadCut; next?: string | null; tables?: string[]; nextExpiry?: number | null; components?: Record<string, Coverage> };
class Interrupted<R> { constructor(readonly result: Result<R>) {} }

export interface QueryEnvironment {
  backend: BackendJson;
  partitionDenied: Refusal | null;
  credentialRevision: number;
  incarnation: number;
  authority: number;
  refreshing: Promise<unknown> | null;
  link: Link;
  caughtUp: boolean;
  identityChecked: boolean;
  lastSyncAt: number;
  principal: string;
  partitionCurrent: boolean;
  nativeReady: boolean;
  signal: AbortSignal;
  unavailable(): Refusal | null;
  queued(): Promise<Queued[]>;
  call(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  post(path: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown>; obsoleteAuth: boolean } | { ok: false }>;
  installNative(signal?: AbortSignal): Promise<boolean>;
  notify(watch: Watch): void;
  offline(): Refusal;
  serverAnswers: Map<string, ServerAnswer>;
}

export async function evaluateLocal<R>(env: QueryEnvironment, op: Query<unknown, R>, args: unknown, revision: number, authority: number, watch?: Watch): Promise<Result<R>> {
  const program = env.backend.programs.find(p => p.name === op.name);
  const tables = program ? operationTables(program, env.backend.schema) : new Set<string>();
  const staticTables = new Set(tables);
  const held = env.backend.schema.operations?.[op.name]?.held ?? program?.held ?? op.held ?? false;
  // @ref LLP 3000.016#2.2 — unknown branches keep the static reads of expanded helpers; native dependencies remain opaque.
  let possible = program && !program.native ? new Set(staticTables) : null;
  const loading: Result<R> = { read: { loading: true }, tables, nextExpiry: null };
  const key = `${op.name}:${JSON.stringify(args)}`;
  let remember = true;
  let latest: { outcome: Outcome; result: Result<R> } | undefined;
  // Missing provenance from an older device is conservatively speculative.
  const placeholder = () => !!latest?.outcome.unknown && !("loading" in latest.result.read)
    && latest.outcome.speculative !== false;
  // Rule 4: retained siblings cannot validate a speculative component. The
  // atomic Read<T> contract has no per-component loading word; withhold it all.
  const fallback = () => placeholder() ? loading : latest?.result ?? loading;
  const localCandidate = (): Candidate<R> => ({ result: fallback(), origin: "local" });
  // Rule 1. This check also preserves the local-commit invalidation fence.
  const checkpoint = () => {
    const denied = env.unavailable() ?? env.partitionDenied;
    if (denied) throw new Interrupted<R>({ read: { denied }, tables, nextExpiry: null });
    if (revision !== env.incarnation || authority !== env.authority) throw new Interrupted<R>(loading);
  };
  const pending = async () => {
    const entries = await env.queued(); checkpoint();
    return entries.some(entry => {
      if (entry.observed_seq != null || entry.predictable !== true) return false;
      if (!entry.predicted) return true; // Legacy missing footprints are unknown.
      return [...predictedTables(entry.predicted)].some(table => possible === null || possible.has(table));
    });
  };
  // Rules 3 and 5 share exactly one external-answer gate, at dispatch and delivery.
  const blocked = async (remembered = false) => {
    checkpoint();
    const fenced = await pending(); checkpoint();
    return (!remembered && env.link !== "online") || fenced || held;
  };
  // @ref LLP 3000.007#6.5 — Rules 4/5: only placeholders recover an old answer.
  // Withheld queries and composed observations never recover a whole page.
  const recover = async (): Promise<Candidate<R>> => {
    if (!placeholder() || !remember) return localCandidate();
    const stopped = await blocked(true); checkpoint();
    if (stopped) return localCandidate();
    let last = env.serverAnswers.get(key);
    if (last?.nextExpiry != null && last.nextExpiry <= Date.now()) {
      env.serverAnswers.delete(key); last = undefined;
    }
    if (last) for (const table of last.tables) tables.add(table);
    const read: Read<R> = last ? { ...last.read, fresh: false, since: last.at } as Read<R>
      : watch ? { loading: true } : { denied: env.offline() };
    return { origin: "remembered", result: { read, tables, nextExpiry: last?.nextExpiry ?? null } };
  };
  const local = async () => {
    checkpoint();
    const answer = await env.call({ op: "query", name: op.name, viewer: env.principal, args, now: Date.now() }); checkpoint();
    const outcome = (answer.ok ?? {}) as Outcome;
    for (const table of outcome.tables ?? []) tables.add(table);
    if (program && !program.native) possible = outcome.unknown === false && outcome.complete === true
      ? new Set(outcome.tables ?? []) : new Set([...staticTables, ...outcome.tables ?? []]);
    const nextExpiry = typeof outcome.nextExpiry === "number" && Number.isFinite(outcome.nextExpiry) ? outcome.nextExpiry : null;
    const denied = (answer.denied as Refusal | undefined) ?? outcome.denied;
    // Rule 3: these device preflight refusals mean execution never began.
    // They certify neither branches nor dependencies in an unacquired partition.
    if (outcome.unknown && ["E_PREDICT", "E_NATIVE"].includes(denied?.code ?? "")) {
      possible = null;
      latest = { outcome: { loading: true, unknown: true }, result: loading };
      return latest;
    }
    // Rules 3/4. `loading` is the engine's unavailable bit; placeholder values
    // are filtered separately. Local freshness is assigned only at publication.
    const read: Read<R> = denied ? { denied } : outcome.loading || !("data" in outcome) ? { loading: true }
      : { data: outcome.data as R, complete: !outcome.unknown && outcome.complete !== false, cut: outcome.cut ?? null, fresh: false, next: (outcome.next as Cursor | null | undefined) ?? null };
    latest = { outcome, result: { read, tables, nextExpiry } };
    return latest;
  };
  const server = async (): Promise<Candidate<R>> => {
    const stopped = await blocked(); checkpoint();
    if (stopped) { const result = await recover(); checkpoint(); return result; }
    const fetch = async (): Promise<Candidate<R>> => {
      while (true) {
        checkpoint();
        const credentials = env.credentialRevision;
        const response = await env.post(`/q/${op.name}`, { args }); checkpoint();
        // Rule 5: admission can happen while the transport is in flight.
        const stopped = await blocked(); checkpoint();
        if (stopped || !response.ok) { const result = await recover(); checkpoint(); return result; }
        if (response.obsoleteAuth || credentials !== env.credentialRevision) {
          if (env.refreshing) { try { await env.refreshing; } catch {} checkpoint(); }
          continue;
        }
        const json = response.json;
        for (const table of (json.tables as string[] | undefined) ?? []) tables.add(table);
        const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
        const read: Read<R> = json.denied ? { denied: json.denied as Refusal } : json.loading || !("data" in json) ? { loading: true }
          : { data: json.data as R, complete: json.complete !== false, cut: (json.cut ?? null) as ReadCut, fresh: true, next: (json.next as Cursor | null | undefined) ?? null };
        return { result: { read, tables, nextExpiry }, origin: "server" };
      }
    };
    // The observation may retain a previous answer during transport; only this
    // procedure publishes the returned candidate after its final checks.
    const result = watch ? await watch.fetch(async () => { const candidate = await fetch(); checkpoint(); return { ...candidate, read: candidate.result.read }; }, () => env.notify(watch), { publishResult: false, retain: true }) : await fetch(); checkpoint();
    return result;
  };
  // @ref LLP 3000.007#20.22.1 — known meter cuts and retained history do not ask the server for the same work.
  const wantsServer = (coverage: Coverage) => !!coverage.unknown && !coverage.retained;
  const route = async (): Promise<Candidate<R>> => {
    checkpoint();
    // Rule 2: run every query locally when possible, even `runs: server`.
    if (env.partitionCurrent && program?.native && !env.nativeReady && env.link === "online") {
      const installed = await env.installNative(env.signal); checkpoint();
      env.nativeReady = installed;
    }
    if (!program || !env.partitionCurrent || (program.native && !env.nativeReady)) {
      possible = null; // No local execution can certify this partition/guest.
      const result = await server(); checkpoint(); return result; // Rule 3.
    }
    const first = await local(); checkpoint();
    if (!first.outcome.unknown && first.outcome.complete === true) return localCandidate(); // Rule 2.
    const withheld = "loading" in first.result.read;
    const components = Object.values(first.outcome.components ?? {});
    const composed = components.some(wantsServer) && components.some(c => c.retained);
    if (composed) { remember = false; env.serverAnswers.delete(key); }
    if (!withheld && !wantsServer(first.outcome) && !composed) return localCandidate(); // Rule 4: known prefixes/refusals.
    const stopped = await blocked(); checkpoint();
    if (stopped) { const result = await recover(); checkpoint(); return result; } // Rules 3/4.
    const composedSince = env.lastSyncAt;
    const remote = await server(); checkpoint();
    if (!composed || withheld) return remote;
    // Rule 5 applies to refusals and loading too. An authoritative refusal of
    // the original query must not be concealed by a second local observation.
    if (remote.origin === "server" && !("data" in remote.result.read)) return remote;
    // @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — reobserve retained fields after the original server query, then publish once.
    const second = await local(); checkpoint();
    if (!second.outcome.unknown && second.outcome.complete === true) return localCandidate(); // Rule 2 again.
    if (remote.origin !== "server" || !("data" in remote.result.read)) return localCandidate();
    const stoppedAfterObservation = await blocked(); checkpoint();
    if (stoppedAfterObservation) return localCandidate(); // Rules 3/5.
    if ("loading" in second.result.read) return remote; // Rule 3: successful original fallback.
    if (!("data" in second.result.read)) return localCandidate();
    const coverage = Object.entries(second.outcome.components ?? {});
    if (!coverage.some(([, c]) => c.retained)) return remote;
    if (!coverage.some(([, c]) => wantsServer(c))) return localCandidate();
    const kept = coverage.filter(([, c]) => !wantsServer(c));
    const data = { ...remote.result.read.data as Record<string, unknown> };
    for (const [field] of kept) data[field] = (second.outcome.data as Record<string, unknown>)[field];
    const expiries = [remote.result.nextExpiry, second.result.nextExpiry].filter((expiry): expiry is number => expiry !== null);
    return { origin: "composed", result: { read: { data: data as R, complete: remote.result.read.complete && kept.every(([, c]) => c.complete !== false), cut: remote.result.read.cut ?? null, fresh: false, ...(composedSince ? { since: composedSince } : {}), next: null }, tables, nextExpiry: expiries.length ? Math.min(...expiries) : null } };
  };
  const publish = async (initial: Candidate<R>): Promise<Result<R>> => {
    let candidate = initial;
    let snapshot = initial.result;
    for (let attempt = 0; ; attempt++) {
      checkpoint(); // Rules 1/5: no await between this check and publication.
      const { result, origin } = candidate;
      // Rules 1/5: an authorization deadline may pass during the final fence.
      if ((attempt > 0 || "data" in result.read) && snapshot.nextExpiry !== null && snapshot.nextExpiry <= Date.now()) {
        env.serverAnswers.delete(key);
        if (origin === "local") {
          if (attempt === 0) {
            // Rule 5: note_expiry only records deadlines after the evaluation's
            // now. Reobserve once; never publish the expired snapshot in between.
            const refreshed = await local(); checkpoint();
            // Rule 4 may withhold the retry's value, but not its expiry fact.
            snapshot = refreshed.result;
            candidate = localCandidate();
            candidate.result = { ...candidate.result, nextExpiry: snapshot.nextExpiry };
            continue;
          }
          // A second deadline crossed in flight: keep the watch runnable when
          // its expired timer is cleared by the loading publication.
          if (watch) watch.dirty = true;
        }
        return origin === "remembered" && !watch ? { read: { denied: env.offline() }, tables, nextExpiry: null } : loading;
      }
      if (origin !== "local" || !("data" in result.read)) return result;
      const fresh = env.link === "online" && env.caughtUp && env.identityChecked;
      return { ...result, read: { ...result.read, fresh, ...(fresh || !env.lastSyncAt ? {} : { since: env.lastSyncAt }) } };
    }
  };
  try {
    let candidate = await route(); checkpoint();
    // Rules 1/5: all external answers, including memory and E_OFFLINE, pass
    // the final fence. Only accepted server answers enter the lifetime cache.
    if (candidate.origin !== "local") {
      const stopped = await blocked(candidate.origin === "remembered"); checkpoint();
      if (stopped) candidate = localCandidate();
      else if (candidate.origin === "server") {
        if (remember && "data" in candidate.result.read) env.serverAnswers.set(key, { read: candidate.result.read, at: Date.now(), nextExpiry: candidate.result.nextExpiry, tables: new Set(tables) });
        else env.serverAnswers.delete(key);
      }
    }
    const result = await publish(candidate); checkpoint();
    return result;
  } catch (error) {
    if (error instanceof Interrupted) return error.result;
    // An await that rejects still crosses a session/incarnation boundary.
    try { checkpoint(); } catch (interruption) { if (interruption instanceof Interrupted) return interruption.result; throw interruption; }
    throw error;
  }
}
