// Query publication procedure (LLP 3000.016 §2.2):
// 1. Check session/incarnation after every await and before publication.
// 2. Run locally first; a known complete answer wins, regardless of `runs`.
// 3. Only engine unavailability (or inability to run) withholds: offline,
//    intersecting prediction, or held => loading; otherwise try original args.
// 4. Available unknown results remain partial data, including predictions.
// 5. Recheck session and P ∩ S before any external answer lands. S is static
//    (opaque programs read everything), narrowed only by a known local outcome.
import type { Cursor, Link, Query, Read, ReadCut, Refusal } from "./contract.ts";
import { operationTables, type BackendJson } from "./backend.ts";
import { predictedTables, type LocalWatch as Watch } from "./local-reads.ts";
import type { Queued } from "./local-types.ts";

type Result<R> = { read: Read<R>; tables: Set<string>; nextExpiry: number | null };
type Candidate<R> = { result: Result<R>; external: boolean };
type Coverage = { complete?: boolean; unknown?: boolean; retained?: boolean; denied?: Refusal };
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
}

export async function evaluateLocal<R>(env: QueryEnvironment, op: Query<unknown, R>, args: unknown, revision: number, authority: number, watch?: Watch): Promise<Result<R>> {
  const program = env.backend.programs.find(p => p.name === op.name);
  const tables = program ? operationTables(program, env.backend.schema) : new Set<string>();
  const staticTables = new Set(tables);
  const held = env.backend.schema.operations?.[op.name]?.held ?? program?.held ?? op.held ?? false;
  // @ref LLP 3000.016#2.2 — unknown branches keep the static reads of expanded helpers; native dependencies remain opaque.
  let possible = program && !program.native ? new Set(staticTables) : null;
  const loading: Result<R> = { read: { loading: true }, tables, nextExpiry: null };
  let latest: { outcome: Outcome; result: Result<R> } | undefined;
  const fallback = () => latest?.result ?? loading;
  const localCandidate = (): Candidate<R> => ({ result: fallback(), external: false });
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
  const blocked = async () => {
    checkpoint();
    if (env.link !== "online") return true;
    const fenced = await pending(); checkpoint();
    return env.link !== "online" || fenced || held;
  };
  const local = async () => {
    checkpoint();
    const answer = await env.call({ op: "query", name: op.name, viewer: env.principal, args, now: Date.now() }); checkpoint();
    const outcome = (answer.ok ?? {}) as Outcome;
    for (const table of outcome.tables ?? []) tables.add(table);
    if (program && !program.native) possible = outcome.unknown === false
      ? new Set(outcome.tables ?? []) : new Set([...staticTables, ...outcome.tables ?? []]);
    const fresh = env.link === "online" && env.caughtUp && env.identityChecked;
    const nextExpiry = typeof outcome.nextExpiry === "number" && Number.isFinite(outcome.nextExpiry) ? outcome.nextExpiry : null;
    const denied = (answer.denied as Refusal | undefined) ?? outcome.denied;
    // Rule 3: these device preflight refusals mean execution never began.
    // They certify neither branches nor dependencies in an unacquired partition.
    if (outcome.unknown && ["E_PREDICT", "E_NATIVE"].includes(denied?.code ?? "")) {
      possible = null;
      latest = { outcome: { loading: true, unknown: true }, result: loading };
      return latest;
    }
    // Rules 3/4. `loading` is the engine's unavailable bit; unknown alone is data.
    const read: Read<R> = denied ? { denied } : outcome.loading || !("data" in outcome) ? { loading: true }
      : { data: outcome.data as R, complete: !outcome.unknown && outcome.complete !== false, cut: outcome.cut ?? null, fresh, next: (outcome.next as Cursor | null | undefined) ?? null, ...(fresh || !env.lastSyncAt ? {} : { since: env.lastSyncAt }) };
    latest = { outcome, result: { read, tables, nextExpiry } };
    return latest;
  };
  const server = async (): Promise<Candidate<R>> => {
    const stopped = await blocked(); checkpoint();
    if (stopped) return localCandidate();
    const fetch = async (): Promise<Candidate<R>> => {
      while (true) {
        checkpoint();
        const credentials = env.credentialRevision;
        const response = await env.post(`/q/${op.name}`, { args }); checkpoint();
        // Rule 5: admission can happen while the transport is in flight.
        const stopped = await blocked(); checkpoint();
        if (stopped || !response.ok) return localCandidate();
        if (response.obsoleteAuth || credentials !== env.credentialRevision) {
          if (env.refreshing) { try { await env.refreshing; } catch {} checkpoint(); }
          continue;
        }
        const json = response.json;
        for (const table of (json.tables as string[] | undefined) ?? []) tables.add(table);
        const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
        const read: Read<R> = json.denied ? { denied: json.denied as Refusal } : json.loading || !("data" in json) ? { loading: true }
          : { data: json.data as R, complete: json.complete !== false, cut: (json.cut ?? null) as ReadCut, fresh: true, next: (json.next as Cursor | null | undefined) ?? null };
        return { result: { read, tables, nextExpiry }, external: true };
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
    if (!withheld && !wantsServer(first.outcome) && !composed) return localCandidate(); // Rule 4: known prefixes/refusals.
    const stopped = await blocked(); checkpoint();
    if (stopped) return localCandidate(); // Rules 3/4: keep available data, otherwise loading.
    const composedSince = env.lastSyncAt;
    const remote = await server(); checkpoint();
    if (!composed || withheld) return remote;
    // @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — reobserve retained fields after the original server query, then publish once.
    const second = await local(); checkpoint();
    if (!second.outcome.unknown && second.outcome.complete === true) return localCandidate(); // Rule 2 again.
    if (!remote.external || !("data" in remote.result.read)) return localCandidate();
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
    return { external: true, result: { read: { data: data as R, complete: remote.result.read.complete && kept.every(([, c]) => c.complete !== false), cut: remote.result.read.cut ?? null, fresh: false, ...(composedSince ? { since: composedSince } : {}), next: null }, tables, nextExpiry: expiries.length ? Math.min(...expiries) : null } };
  };
  try {
    const candidate = await route(); checkpoint();
    // Rules 1/5: the single publication point. No remembered whole-server
    // answer can replace L: failed fallback keeps L (or loading if withheld).
    if (candidate.external) {
      const stopped = await blocked(); checkpoint();
      if (stopped) return fallback();
    }
    checkpoint();
    return candidate.result;
  } catch (error) {
    if (error instanceof Interrupted) return error.result;
    // An await that rejects still crosses a session/incarnation boundary.
    try { checkpoint(); } catch (interruption) { if (interruption instanceof Interrupted) return interruption.result; throw interruption; }
    throw error;
  }
}
