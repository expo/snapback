import { decorationPaths, withDecorations, valueDeadline, mergeValueDeadlines, type ValueDeadlines } from "./read-decoration.ts";
import { readyRead } from "./read-existence.ts";
import { checkRead } from "./read-work.ts";
import { combinedCursor, ordinarySearch } from "./local-search.ts";
import { EphemeralReads, type EphemeralRequest } from "./ephemeral-reads.ts";
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
//    expiry retries locally once through rules 2–5 (then dirties a watch if
//    still expired). Only expired memory is retired by the expiry decision.
//    Recovery preserves local wakeups; retry transport retires the old value.
//    Memory expires only at its server deadline; an elapsed local wakeup
//    dirties its watch and is consumed without withdrawing valid memory.
//    Future remembered wakeups carry that provenance to the watch timer.
//    Local freshness is decided at publication.
import type { Cursor, Link, Query, Read, ReadCut, Refusal } from "./contract.ts";
import { operationTables, permanentlyUnavailableHeldCount, type BackendJson } from "./backend.ts";
import { mergeReadScopes, queuedPredictions, type ServerAnswer, type ReadScopes, type LocalWatch as Watch } from "./local-reads.ts";
import type { Queued } from "./local-types.ts";
import { hasRetainedRows, keepRetainedRows } from "./local-through.ts";
import type { ColdReadControl } from "./device-control.ts";

type Result<R> = ValueDeadlines & { publicationCurrent?: () => boolean; heldUnavailable?: boolean; scopes?: ReadScopes | undefined; deadlineWithdrawn?: true; existenceTables?: Set<string> | null; transportOffline?: boolean; retryExhausted?: boolean; searchAttempt?: true; serverOnly?: boolean; delivery?: unknown; credential?: number | undefined; ephemeralRequest?: EphemeralRequest; ephemeral?: unknown; ephemeralStale?: boolean; retryExpired?: boolean; read: Read<R>; tables: Set<string>; nextExpiry: number | null; serverExpiry?: number | null; localWakeup?: boolean; rowProvenance?: unknown; refresh?: number | undefined; served?: boolean; seq?: number | undefined };
type Candidate<R> = { result: Result<R>; origin: "local" | "server" | "remembered" | "composed" };
type Coverage = { complete?: boolean; unknown?: boolean; retained?: boolean; speculative?: boolean; denied?: Refusal };
type Outcome = Coverage & { watermark?: number; decorationExpiry?: number | null | undefined; scopes?: ReadScopes; loading?: boolean; data?: unknown; retainedRows?: unknown; cut?: ReadCut; next?: string | null; tables?: string[]; nextExpiry?: number | null; components?: Record<string, Coverage> };
class Interrupted<R> { constructor(readonly result: Result<R>) {} }

export interface QueryEnvironment {
  current?(): boolean;
  /** Captured hard evidence fence; only the whole-server route may use it. */
  serverCurrent?(cut: number): boolean;
  inputsCurrent?(tables: ReadonlySet<string>): boolean;
  retainedCurrent?(watermark: number | undefined): boolean;
  revalidate?: boolean;
  serverDeadlineWithdrawn?(deadline: number | null | undefined): boolean;
  coldRead?: ColdReadControl | undefined;
  backend: BackendJson;
  ephemeralReads: EphemeralReads;
  partitionDenied: Refusal | null;
  credentialRevision: number;
  incarnation: number;
  authority: number;
  refreshing: Promise<unknown> | null;
  link: Link;
  linkRevision?: number;
  caughtUp: boolean;
  identityChecked: boolean;
  lastSyncAt: number;
  principal: string;
  partitionCurrent: boolean;
  nativeReady: boolean;
  signal: AbortSignal;
  unavailable(): Refusal | null;
  queued(): Promise<Queued[]>;
  followingPending?(tables: ReadonlySet<string>): Promise<boolean>;
  pending(tables: Set<string> | null, predictions?: readonly string[] | null): boolean;
  call(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  post(path: string, body: unknown, captured?: undefined, ephemeral?: EphemeralRequest): Promise<{ ok: true; json: Record<string, unknown>; obsoleteAuth: boolean; searchIdentity?: string | undefined } | { ok: false }>;
  searchPost(path: string, body: unknown, decode: (response: Response) => Promise<Record<string, unknown>>): ReturnType<QueryEnvironment["post"]>;
  refreshSearch?(name: string): void;
  installNative(signal?: AbortSignal): Promise<boolean>;
  notify(watch: Watch): void;
  offline(): Refusal;
  deviceNow(): number;
  serverNow(): number;
  serverAnswers: AnswerCache;
}

/** Remembered server answers, which recovery may show (Rule 5), ordered by the
 * server's store cut: `set` and `delete` carry it when the reply names one,
 * `forget` is cleanup of an expired answer, and `renew` starts a new read within
 * an attempt. */
export interface AnswerCache {
  get(key: string): ServerAnswer | undefined;
  set(key: string, answer: ServerAnswer, seq?: number): void;
  delete(key: string, seq?: number): void;
  forget(key: string): void;
  renew(): void;
}

export async function evaluateLocal<R>(env: QueryEnvironment, op: Query<unknown, R>, args: unknown, revision: number, authority: number, watch?: Watch): Promise<Result<R>> {
  const program = env.backend.programs.find(p => p.name === op.name);
  const search = env.backend.schema.operations?.[op.name]?.search;
  let searchAttempt = false;
  if (search && env.link !== "online" && combinedCursor((args as Record<string, unknown>)?.[search.cursor])) {
    args = { ...args as object, [search.cursor]: null }; // the offline observation restarts in its own coverage domain
  }
  const tables = program ? operationTables(program, env.backend.schema) : new Set<string>();
  const staticTables = new Set(tables);
  const held = env.backend.schema.operations?.[op.name]?.held ?? program?.held ?? op.held ?? false;
  // @ref LLP 3000.016#2.2 — unknown branches keep the static reads of expanded helpers; native dependencies remain opaque.
  let possible = program && !program.native ? new Set(staticTables) : null;
  const loading: Result<R> = { read: { loading: true }, tables, nextExpiry: null, valueDevice: null, valueServer: null };
  const key = `${op.name}:${JSON.stringify(args)}`;
  const ephemeralTables = env.backend.schema.operations?.[op.name]?.ephemeralReads ?? program?.ephemeralReads ?? [];
  const ephemeral = ephemeralTables.length > 0;
  let remember = !ephemeral;
  let latest: { outcome: Outcome; result: Result<R> } | undefined;
  let serverCut: number | undefined;
  const serverCurrent = env.serverCurrent;
  const covered = () => serverCut !== undefined && serverCurrent?.(serverCut) === true;
  const inputsCurrent = env.inputsCurrent;
  // Keep static and observed authorization dependencies, including branches
  // not taken. This proof never uses the server cut to validate local rows.
  const unchanged = () => !searchAttempt && !ephemeral && possible !== null && inputsCurrent?.(tables) === true;
  const publicationCurrent = () => covered() || unchanged();
  const retainedRoute = () => !searchAttempt && !!latest && (mayRetain() || latest.outcome.retained
    || Object.values(latest.outcome.components ?? {}).some(c => c.retained) || hasRetainedRows(latest.outcome.retainedRows));
  const routeCurrent = () => !retainedRoute() || env.retainedCurrent?.(latest?.outcome.watermark) !== false;
  let publishingCurrent: (() => boolean) | undefined;
  // The wire omits false provenance, including replies from older devices.
  const placeholder = () => !!latest?.outcome.unknown && !("loading" in latest.result.read)
    && latest.outcome.speculative === true;
  // Rule 4: retained siblings cannot validate a speculative component. The
  // atomic Read<T> contract has no per-component loading word; withhold it all.
  const fallback = (): Result<R> => placeholder() ? loading : latest?.result ?? loading;
  const localCandidate = (): Candidate<R> => { serverCut = undefined; return {
    // Rule 4 can withhold a value without removing its next expiry wakeup.
    result: { ...fallback(), nextExpiry: latest?.result.nextExpiry ?? null }, origin: "local",
  }; };
  // Rule 1. This check also preserves the local-commit invalidation fence.
  const checkpoint = () => {
    const denied = env.unavailable() ?? env.partitionDenied;
    if (denied) throw new Interrupted<R>({ ...loading, read: { denied } });
    checkRead(env.signal);
    if (revision !== env.incarnation) throw new Interrupted<R>(loading);
    if (!routeCurrent()) { if (watch) watch.dirty = true; throw new Interrupted<R>(loading); }
    if ((env.current && !env.current() || authority !== env.authority) && !(publishingCurrent ?? publicationCurrent)()) throw new Interrupted<R>(loading);
    if (env.coldRead && !env.coldRead.current()) throw new Interrupted<R>(loading);
  };
  let pendingResult = false;
  const pending = async () => {
    const predictions = env.coldRead ? undefined : queuedPredictions(await env.queued()); checkpoint();
    return pendingResult = env.pending(possible, predictions);
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
    serverCut = undefined; // Recovery cannot borrow a current server cut.
    if (ephemeral) return { result: { ...loading, transportOffline: env.link === "offline" && !held && !await pending() }, origin: "local" };
    if (!placeholder() || !remember) return localCandidate();
    const stopped = await blocked(true); checkpoint();
    if (stopped) return localCandidate();
    let last = env.serverAnswers.get(key);
    if (last?.nextExpiry != null && last.nextExpiry <= env.serverNow()) {
      env.serverAnswers.forget(key); last = undefined;
    }
    if (last) for (const table of last.tables) tables.add(table);
    const read: Read<R> = last ? readyRead({ ...last.read, data: last.read.data as R, fresh: false, since: Math.min(last.at, Date.now()) })
      : watch ? { loading: true } : { denied: env.offline() };
    // Rules 4/5: recovery still depends on the local branch's next deadline.
    // Its wakeup is separate from the remembered answer's server-clock expiry.
    // Absent memory is an explicit replacement (including an ordered denial),
    // not a transport failure that may retain the previously displayed value.
    return { origin: "remembered", result: { scopes: last?.scopes, transportOffline: !!last && env.link !== "online", read, tables, nextExpiry: latest?.result.nextExpiry ?? null, serverExpiry: last?.nextExpiry ?? null, valueDevice: null, valueServer: last ? valueDeadline(last.decorationExpiry, !!env.backend.schema.operations?.[op.name]?.search_decoration) : null } };
  };
  const local = async (): Promise<{ outcome: Outcome; result: Result<R> }> => {
    serverCut = undefined;
    checkpoint();
    const answer = await env.call({ op: "query", name: op.name, viewer: env.principal, args, now: env.deviceNow() }); checkpoint();
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
      : readyRead({ data: outcome.data as R, complete: !outcome.unknown && outcome.complete !== false, cut: outcome.cut ?? null, fresh: false, next: (outcome.next as Cursor | null | undefined) ?? null });
    latest = { outcome, result: { read, tables, nextExpiry, valueDevice: "data" in read ? valueDeadline(outcome.decorationExpiry, !!env.backend.schema.operations?.[op.name]?.search_decoration) : null, valueServer: null, scopes: outcome.scopes } };
    return latest;
  };
  const server = async (provenance = false, retain = true): Promise<Candidate<R>> => {
    const stopped = await blocked(); checkpoint();
    if (stopped) { const result = await recover(); checkpoint(); return result; }
    const fetch = async (): Promise<Candidate<R>> => {
      while (true) {
        checkpoint();
        const credentials = env.credentialRevision;
        const eph = ephemeral ? env.ephemeralReads.request() : undefined;
        const response = await env.post(`/q/${op.name}`, { args, ...(provenance ? { provenance: true } : {}) }, undefined, eph);
        // @ref LLP 3000.023#10 — repeated evidence may already be covered by
        // this reply. Never promote an old local component or retention route.
        if (response.ok && !provenance && !ephemeral && !held && !searchAttempt && !mayRetain()
          && !latest?.outcome.retained && !Object.values(latest?.outcome.components ?? {}).some(c => c.retained)
          && !hasRetainedRows(latest?.outcome.retainedRows)) {
          serverCut = [response.json.seq, response.json.head].find(value => Number.isSafeInteger(value) && Number(value) >= 0) as number | undefined;
        }
        checkpoint();
        // A refetch within the attempt is a new read for the remembered answers (LLP 3000.018 §3.2).
        if (eph && !env.ephemeralReads.current(eph)) { env.serverAnswers.renew(); continue; }
        // Rule 5: admission can happen while the transport is in flight.
        const stopped = await blocked(); checkpoint();
        if (stopped || !response.ok) { const candidate = await recover(); checkpoint();
          if (!response.ok && (candidate.origin !== "remembered" || "data" in candidate.result.read)) candidate.result.transportOffline = true;
          return candidate; }
        if (response.obsoleteAuth || credentials !== env.credentialRevision) {
          if (env.refreshing) { try { await env.refreshing; } catch {} checkpoint(); }
          env.serverAnswers.renew();
          continue;
        }
        const json = response.json;
        for (const table of (json.tables as string[] | undefined) ?? []) tables.add(table);
        const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
        const read: Read<R> = json.denied ? { denied: json.denied as Refusal } : json.loading || !("data" in json) ? { loading: true }
          : readyRead({ data: json.data as R, complete: json.complete !== false, cut: (json.cut ?? null) as ReadCut, fresh: true, next: (json.next as Cursor | null | undefined) ?? null });
        const cut = [json.seq, json.head].find(value => typeof value === "number" && Number.isFinite(value)) as number | undefined;
        return { result: { scopes: json.scopes as ReadScopes | undefined, read, delivery: json.delivery, credential: credentials, tables, nextExpiry: null, serverExpiry: nextExpiry, valueDevice: null, valueServer: "data" in read ? valueDeadline(json.decorationExpiry, !!env.backend.schema.operations?.[op.name]?.search_decoration) : null, rowProvenance: json.rowProvenance, refresh: typeof json.refresh === "number" && Number.isFinite(json.refresh) ? json.refresh : undefined, served: true, seq: cut, ...(eph ? { ephemeralRequest: eph, ephemeral: json.ephemeral } : {}) }, origin: "server" };
      }
    };
    // The observation may retain a previous answer during transport; only this
    // procedure publishes the returned candidate after its final checks.
    const result = watch ? await watch.fetch(async (): Promise<Candidate<R> & { read: Read<R> }> => { const candidate = await fetch(); checkpoint(); return { ...candidate, read: candidate.result.read }; }, () => env.notify(watch), { publishResult: false, revalidate: env.revalidate ?? true, ...(retain ? {} : { retain: false }) }) : await fetch(); checkpoint();
    return result;
  };
  // @ref LLP 3000.007#20.22.1 — known meter cuts and retained history do not ask the server for the same work.
  const wantsServer = (coverage: Coverage) => !!coverage.unknown && !coverage.retained;
  // Unknown branches keep static dependencies; native reads are opaque. This
  // classifies routing potential only: the device still decides retention.
  const mayRetain = () => [...(possible ?? Object.keys(env.backend.schema.tables))].some(name => {
    const table = env.backend.schema.tables[name];
    return table?.sync && table.leave === "delivered-history";
  });
  // Rules 2–4 apply to every local observation, including an expiry retry.
  const routeLocal = async (first: { outcome: Outcome; result: Result<R> }, retain = true): Promise<Candidate<R>> => {
    if (!first.outcome.unknown && first.outcome.complete === true) return localCandidate(); // Rule 2.
    const withheld = "loading" in first.result.read;
    const components = Object.values(first.outcome.components ?? {});
    const composed = components.some(wantsServer) && components.some(c => c.retained);
    const retainedRows = !!first.outcome.unknown && hasRetainedRows(first.outcome.retainedRows);
    // @ref LLP 3000.018#3.2 — a composed read remembers no whole answer, and clears nothing before
    // its reply: only that reply names the server's cut, and so takes its place in the order.
    if (composed || retainedRows) remember = false;
    if (!withheld && !wantsServer(first.outcome) && !composed && !retainedRows) return localCandidate(); // Rule 4: known prefixes/refusals.
    const stopped = await blocked(); checkpoint();
    if (stopped) { const result = await recover(); checkpoint(); return result; } // Rules 3/4.
    const composedSince = env.lastSyncAt;
    const remote = await server(retainedRows, retain); checkpoint();
    // Rule 5 applies to refusals and loading too. An authoritative refusal of
    // the original query must not be concealed by a second local observation.
    if (remote.origin === "server" && !("data" in remote.result.read)) return remote;
    // @ref LLP 3000.028#3.2 — a current server page cannot replace history
    // before the device can observe the same cut's current/retained routing.
    // Only the cut read in the evaluation transaction can certify this route.
    // A different process may commit without changing our authority revision.
    const retentionRoute = remote.origin === "server" && mayRetain()
      && (!Number.isSafeInteger(first.outcome.watermark) || first.outcome.watermark! < 0 || remote.result.seq === undefined || remote.result.seq > first.outcome.watermark!);
    const pendingRoute = async (observed?: Outcome): Promise<Candidate<R> | null> => {
      const state = await env.call({ op: "state" }); checkpoint();
      const watermark = (state.ok as { watermark?: number } | undefined)?.watermark;
      if (remote.result.seq === undefined || !Number.isSafeInteger(watermark) || watermark! < 0 || remote.result.seq > watermark!
        // A shared owner can commit after the second evaluation too. A later
        // state read cannot certify that earlier current/retained decision.
        || observed && (!Number.isSafeInteger(observed.watermark) || observed.watermark! < 0 || remote.result.seq > observed.watermark!)) {
        remember = false;
        let provisional = localCandidate().result;
        // Positive server pages remain useful before acquisition. They certify
        // neither completeness nor the device's retention route. Empty pages
        // and structured answers keep the local value until routing is known.
        if ("data" in remote.result.read && Array.isArray(remote.result.read.data) && remote.result.read.data.length > 0) {
          provisional = { ...provisional, read: remote.result.read, scopes: remote.result.scopes,
            serverExpiry: remote.result.serverExpiry ?? null, valueDevice: null, valueServer: remote.result.valueServer };
        }
        // No catch-up wait or polling loop. Sync wakes served observations;
        // existing change/scope/expiry fences may withhold this older value.
        // A stalled one-shot gets partial data, or its bounded loading retry.
        return { origin: "composed", result: { ...provisional,
          read: "data" in provisional.read ? readyRead({ ...provisional.read, complete: false, fresh: false }) : provisional.read,
          served: true, seq: remote.result.seq, credential: remote.result.credential,
        } };
      }
      return null;
    };
    // Known retained compositions already publish stale and keep device history.
    // They need this fence only if reobservation instead selects a whole reply.
    const wholeFallback = (!composed && !retainedRows) || withheld;
    if (wholeFallback) {
      if (!retentionRoute) return remote;
      const provisional = await pendingRoute(); checkpoint();
      if (provisional) return provisional;
    }
    // @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — reobserve retained fields after the original server query, then publish once.
    const second = await local(); checkpoint();
    if (!second.outcome.unknown && second.outcome.complete === true) return localCandidate(); // Rule 2 again.
    if (remote.origin !== "server" || !("data" in remote.result.read)) return localCandidate();
    const stoppedAfterObservation = await blocked(); checkpoint();
    if (stoppedAfterObservation) return localCandidate(); // Rules 3/5.
    if ("loading" in second.result.read) {
      if (retentionRoute && !wholeFallback) {
        const provisional = await pendingRoute(second.outcome); checkpoint();
        if (provisional) return provisional;
      }
      return remote; // Rule 3: successful original fallback.
    }
    if (!("data" in second.result.read)) return localCandidate();
    const secondComponents = Object.values(second.outcome.components ?? {});
    const secondComposed = secondComponents.some(wantsServer) && secondComponents.some(c => c.retained);
    const secondRetainedRows = !!second.outcome.unknown && hasRetainedRows(second.outcome.retainedRows);
    if (!wantsServer(second.outcome) && !secondComposed && !secondRetainedRows) return localCandidate();
    if (secondRetainedRows) {
      remember = false;
      // Retention appeared in flight: this reply did not request the engine's
      // pairing envelope. Keep the permitted local value without inventing IDs.
      if (!retainedRows) return localCandidate();
      // @ref LLP 3000.014#5 — only engine source identities pair retained rows
      // with the current server page; routing and publication use Rules 1–5.
      return { origin: "composed", result: {
        ...mergeValueDeadlines(second.result, remote.result), scopes: mergeReadScopes(second.result.scopes, remote.result.scopes),
        read: readyRead<R>({ ...remote.result.read, data: keepRetainedRows(remote.result.read.data, second.outcome.data, second.outcome.retainedRows, remote.result.rowProvenance) as R, fresh: false, complete: false }),
        tables, nextExpiry: second.result.nextExpiry, serverExpiry: remote.result.serverExpiry ?? null, refresh: remote.result.refresh, served: true, seq: remote.result.seq, credential: remote.result.credential,
      } };
    }
    const coverage = Object.entries(second.outcome.components ?? {});
    if (!coverage.some(([, c]) => c.retained)) {
      if (retentionRoute && !wholeFallback) {
        const provisional = await pendingRoute(second.outcome); checkpoint();
        if (provisional) return provisional;
      }
      return remote;
    }
    if (!coverage.some(([, c]) => wantsServer(c))) return localCandidate();
    remember = false;
    const kept = coverage.filter(([, c]) => !wantsServer(c));
    const data = { ...remote.result.read.data as Record<string, unknown> };
    for (const [field] of kept) data[field] = (second.outcome.data as Record<string, unknown>)[field];
    // A retained sibling cannot certify an empty current sibling while that
    // sibling's leave is pending. Preserve its permitted device rows too.
    const ahead = retentionRoute && (!Number.isSafeInteger(second.outcome.watermark)
      || remote.result.seq === undefined || remote.result.seq > second.outcome.watermark!);
    let provisionalField = false;
    if (ahead) for (const [field, coverage] of Object.entries(second.outcome.components ?? {})) {
      const localValue = (second.outcome.data as Record<string, unknown>)[field];
      if (wantsServer(coverage) && Array.isArray(data[field]) && data[field].length === 0
        && Array.isArray(localValue) && localValue.length > 0) {
        if (coverage.speculative) return { origin: "composed", result: { ...loading, served: true, seq: remote.result.seq, credential: remote.result.credential } };
        data[field] = localValue; provisionalField = true;
      }
    }
    return { origin: "composed", result: { ...mergeValueDeadlines(second.result, remote.result), scopes: mergeReadScopes(second.result.scopes, remote.result.scopes), read: readyRead({ data: data as R, complete: !provisionalField && remote.result.read.complete && kept.every(([, c]) => c.complete !== false), cut: remote.result.read.cut ?? null, fresh: false, ...(composedSince ? { since: Math.min(composedSince, Date.now()) } : {}), next: null }), tables, nextExpiry: second.result.nextExpiry, serverExpiry: remote.result.serverExpiry ?? null, refresh: remote.result.refresh, served: true, seq: remote.result.seq, credential: remote.result.credential } };
  };
  const route = async (): Promise<Candidate<R>> => {
    checkpoint();
    // @ref LLP 3000.016#2.2 — only an already server-answered cold watch may
    // bypass the busy VM. No held read, local composition or remembered fallback.
    if (env.coldRead) return held ? { result: loading, origin: "local" } : server();
    // LLP 3000.017 §2.3 makes ephemeral reads whole-server queries; they have
    // no device current/retained routing. Durable history belongs in its own read.
    if (ephemeral) return server();
    // Rule 2: run every query locally when possible, even `runs: server`.
    if (env.partitionCurrent && program?.native && !env.nativeReady && env.link === "online") {
      const installed = await env.installNative(env.signal); checkpoint();
      env.nativeReady = installed;
    }
    if (!program || !env.partitionCurrent || (program.native && !env.nativeReady)) {
      possible = null; // No local execution can certify this partition/guest.
      const result = await server(); checkpoint(); return result; // Rule 3.
    }
    if (search && env.link === "online" && /[\p{L}\p{N}]/u.test(String((args as Record<string, unknown>)?.[search.needle] ?? "")) && !await blocked()) {
      checkpoint();
      searchAttempt = true;
      remember = false;
      const result = await ordinarySearch(env, op.name, args, search, checkpoint, blocked); checkpoint();
      return { origin: "composed", result: { ...result, read: result.read as Read<R>, tables } };
    }
    const first = await local(); checkpoint();
    const result = await routeLocal(first); checkpoint(); return result;
  };
  const publish = async (initial: Candidate<R>): Promise<Result<R>> => {
    let candidate = initial;
    // A device footprint proves only local inputs. Every external component
    // also needs its own covering cut; recovery cannot renew an old cache ticket.
    publishingCurrent = () => routeCurrent() && (candidate.origin === "server" && covered() || unchanged()
      && (candidate.origin === "local" || (candidate.origin === "server" || candidate.origin === "composed")
        && candidate.result.seq !== undefined && serverCurrent?.(candidate.result.seq) === true));
    for (let attempt = 0; ; attempt++) {
      checkpoint();
      // Rules 1/5: the same delivery fence applies after retry routing, including
      // server, composed and remembered answers (and E_OFFLINE).
      if (candidate.origin !== "local") {
        const stopped = await blocked(candidate.origin === "remembered"); checkpoint();
        if (stopped) {
          const fallback = localCandidate();
          // A failed search request can change the link during this attempt.
          // Preserve that failure when the final gate has no replacement;
          // completed local data and explicit denials still decide the answer.
          if (candidate.result.transportOffline && "loading" in fallback.result.read) fallback.result.transportOffline = true;
          candidate = fallback;
        }
      }
      const { result, origin } = candidate;
      // @ref LLP 3000.031#1.1 — reuse the external-answer pending predicate,
      // including complete-local dependency narrowing, at final publication.
      const empty = "data" in result.read && (result.read.data === null || Array.isArray(result.read.data) && result.read.data.length === 0);
      const pendingHere = origin === "local" && empty ? await pending() : pendingResult;
      checkpoint();
      result.existenceTables = possible;
      if ("data" in result.read) result.read = readyRead<R>(result.read, pendingHere);
      if (result.ephemeralRequest && !env.ephemeralReads.accept(result.ephemeralRequest, result.ephemeral, watch)) {
        return { ...loading, ephemeralStale: true };
      }
      // @ref LLP 3000.016#own-edge-publication — sent is not observed. Neither
      // local nor fallback data may certify the reader's unresolved feed input.
      const followingPending = "data" in result.read && await env.followingPending?.(tables);
      checkpoint();
      // Rules 1/5: no await between this deadline check and publication.
      const localDue = result.nextExpiry !== null && result.nextExpiry <= env.deviceNow();
      if (origin === "remembered" && localDue) {
        // Rule 5: this is a local branch wakeup, not memory's validity limit.
        // Consume it so scheduleExpiry cannot immediately erase this page.
        if (watch) watch.dirty = true;
        result.nextExpiry = null;
      }
      if ((attempt > 0 || "data" in result.read) && ((origin !== "remembered" && localDue)
        || (result.serverExpiry != null && result.serverExpiry <= env.serverNow()))) {
        if (origin === "local" && attempt === 0) {
          // note_expiry records only deadlines after the evaluation's now.
          // Reobserve once, then run the same fallback/composition/recovery.
          const refreshed = await local(); checkpoint();
          // Rule 5: an expired watch value cannot survive a server round trip.
          // A purely local retry publishes directly, without a loading reset.
          env.serverAnswers.renew();
          candidate = await routeLocal(refreshed, false); checkpoint();
          continue;
        }
        // A second deadline crossed in flight: keep the watch runnable when
        // its expired timer is cleared by the loading publication.
        if (attempt > 0 && watch) watch.dirty = true;
        if (origin === "remembered") {
          const last = env.serverAnswers.get(key);
          if (last?.nextExpiry != null && last.nextExpiry <= env.serverNow()) env.serverAnswers.forget(key);
        }
        // Recovery still needs any future local branch wakeup after memory
        // expires; only the expired server deadline is retired here.
        // @ref LLP 3000.019#3.3 — withdrawing an expired answer must leave its live watch runnable.
        // A server reply can cross expiry on the first attempt too, including
        // when our time estimate reaches the deadline just before the server.
        return origin === "remembered" ? { ...loading, read: watch ? { loading: true } : { denied: env.offline() }, tables, nextExpiry: result.nextExpiry, localWakeup: true }
          : { ...loading, retryExpired: !!watch && (origin === "server" || origin === "composed") };
      }
      if ("data" in result.read && env.serverDeadlineWithdrawn?.(result.serverExpiry)) return { ...loading, deadlineWithdrawn: true };
      if (result.credential !== undefined && result.credential !== env.credentialRevision) return loading;
      // Rule 5: only accepted server answers enter the lifetime cache. Expiry
      // of a local/server candidate does not invalidate independent memory.
      if (origin === "server" || origin === "composed") {
        checkpoint();
        // @ref LLP 3000.018#3.2 — a composed read's reply, which is not remembered, still takes its place in the order.
        if (remember && "data" in result.read) env.serverAnswers.set(key, { read: result.read, scopes: result.scopes, at: Date.now(), nextExpiry: result.serverExpiry ?? null, decorationExpiry: result.valueServer, tables: new Set(tables) }, result.seq);
        else env.serverAnswers.delete(key, result.seq);
      }
      if (followingPending && "data" in result.read) result.read = readyRead<R>({ ...result.read, complete: false }, pendingHere);
      // @ref LLP 3000.023#11 — only a static permanence proof permits a
      // terminal held refusal. Actual read tables alone cannot rule out a
      // changing time/argument/coverage/membership branch. Observations keep loading.
      if (held && origin === "local" && "loading" in result.read && env.partitionCurrent && env.caughtUp && !pendingResult)
        result.heldUnavailable = permanentlyUnavailableHeldCount(program, env.backend.schema);
      if (origin !== "local" || !("data" in result.read)) return { ...result, serverOnly: origin === "server", localWakeup: origin === "remembered" };
      const fresh = env.link === "online" && env.caughtUp && env.identityChecked;
      return { ...result, read: readyRead<R>({ ...result.read, fresh, ...(fresh || !env.lastSyncAt ? {} : { since: Math.min(env.lastSyncAt, Date.now()) }) }, pendingHere) };
    }
  };
  try {
    const candidate = await route(); checkpoint();
    const result = await publish(candidate); checkpoint();
    withDecorations(result.read, env.backend.schema.operations?.[op.name]?.search_decoration ? decorationPaths(program) : [],
      result.valueDevice, result.valueServer, env.deviceNow, env.serverNow);
    return { ...result, ...((serverCurrent || inputsCurrent) && publishingCurrent ? { publicationCurrent: publishingCurrent } : {}), ...(searchAttempt ? { searchAttempt: true } : {}) };
  } catch (error) {
    if (error instanceof Interrupted) return { ...error.result as Result<R>, ...(searchAttempt ? { searchAttempt: true } : {}) };
    // An await that rejects still crosses a session/incarnation boundary.
    try { checkpoint(); } catch (interruption) { if (interruption instanceof Interrupted) return { ...interruption.result as Result<R>, ...(searchAttempt ? { searchAttempt: true } : {}) }; throw interruption; }
    throw error;
  }
}
