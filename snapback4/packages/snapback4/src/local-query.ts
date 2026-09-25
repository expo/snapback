import type { Cursor, Link, Query, Read, ReadCut, Refusal } from "./contract.ts";
import { operationTables, type BackendJson } from "./backend.ts";
import { followingReads, routeWithheld, runsOnServer, predictedTables, type LocalWatch as Watch } from "./local-reads.ts";
import type { Queued } from "./local-types.ts";

type Result<R> = { read: Read<R>; tables: Set<string>; nextExpiry: number | null; transportOffline?: boolean; localKnown?: boolean };
type Coverage = { complete?: boolean; unknown?: boolean; retained?: boolean; denied?: Refusal };
type Outcome = Coverage & { loading?: boolean; data?: unknown; cut?: ReadCut; next?: string | null; tables?: string[]; nextExpiry?: number | null; components?: Record<string, Coverage> };

export interface QueryEnvironment {
  backend: BackendJson;
  partitionDenied: Refusal | null;
  credentialRevision: number;
  incarnation: number;
  authority: number;
  sessionDead: boolean;
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
  serverAnswers: Map<string, { read: Extract<Read<unknown>, { data: unknown }>; at: number; tables: Set<string> }>;
}

export async function evaluateLocal<R>(env: QueryEnvironment, op: Query<unknown, R>, args: unknown, revision: number, authority: number, watch?: Watch): Promise<Result<R>> {
  const { unavailable, queued, call, post, installNative, notify, offline, serverAnswers } = env;
  const refused = unavailable();
  if (refused) return { read: { denied: refused }, tables: new Set(), nextExpiry: null };
  const schema = env.backend.schema;
  const program = env.backend.programs.find((p) => p.name === op.name);
  const tables = program && schema ? operationTables(program, schema) : new Set<string>();
  if (env.partitionDenied) return { read: { denied: env.partitionDenied }, tables, nextExpiry: null };
  const held = schema.operations?.[op.name]?.held ?? program?.held ?? op.held ?? false;
  const following = () => followingReads(schema, tables);
  // @ref LLP 3000.016#2.2 — an unknown branch cannot erase its possible reads.
  // Helpers are expanded in the compiled Quarry body. Before execution, and
  // for opaque native programs, every table remains a possible dependency.
  const staticTables = new Set(tables);
  let possible: Set<string> | null = null;
  const pending = async () => (await queued()).some(entry => {
    if (entry.observed_seq != null || entry.predictable !== true) return false;
    const written = predictedTables(entry.predicted ?? []);
    // Older hosts may omit the prediction footprint; absence is not proof
    // that the write was independent of this query.
    return possible === null || (!written.size && possible.size > 0)
      || [...written].some(table => possible!.has(table));
  });
  const loading: Result<R> = { read: { loading: true }, tables, nextExpiry: null };
  // All non-local publications pass here, including composed and remembered
  // answers and E_OFFLINE. A local commit also retires this entire evaluation.
  const stale = () => revision !== env.incarnation || authority !== env.authority;
  const publish = async (result: Result<R>): Promise<Result<R>> => {
    if ("denied" in result.read && ["E_AUTH", "E_CLOSED", "E_STORE_RESTORE"].includes(result.read.denied.code)) return result;
    const fenced = !result.localKnown && await pending();
    return fenced || stale() ? loading : result;
  };
  const key = `${op.name}:${JSON.stringify(args)}`;
  const remembered = () => {
    if (watch) return { read: { loading: true } as Read<R>, tables, nextExpiry: null };
    const last = serverAnswers.get(key);
    if (last) for (const table of last.tables) tables.add(table);
    return { read: last ? { ...last.read, fresh: false, since: last.at } as Read<R> : { denied: offline() } as Read<R>, tables, nextExpiry: null, transportOffline: !last };
  };
  const server = async (failure: () => { read: Read<R>; tables: Set<string>; nextExpiry: number | null; transportOffline?: boolean } = remembered, remember = true, retain = false) => {
    if (await pending() || stale()) return loading;
    const fetch = async () => {
      // A held query must not turn missing local coverage into a server scan, even during reset.
      if (held) return { read: { denied: offline() } as Read<R>, tables, nextExpiry: null, transportOffline: true };
      while (true) {
        const credentials = env.credentialRevision;
        const result = await post(`/q/${op.name}`, { args });
        if (revision !== env.incarnation || authority !== env.authority) return { read: { loading: true } as Read<R>, tables, nextExpiry: null };
        if (env.sessionDead) return { read: { denied: { code: "E_AUTH", family: "auth", message: "sign in to read" } } as Read<R>, tables, nextExpiry: null };
        if (await pending() || stale()) return loading;
        if (!result.ok) return failure();
        if (result.obsoleteAuth || (!remember && credentials !== env.credentialRevision)) {
          const rotation = env.refreshing;
          if (rotation) try { await rotation; } catch {}
          const unavailableWhy = unavailable();
          if (unavailableWhy) return { read: { denied: unavailableWhy } as Read<R>, tables, nextExpiry: null };
          continue;
        }
        const json = result.json;
        for (const table of (json.tables as string[] | undefined) ?? []) tables.add(table);
        if (json.denied) { serverAnswers.delete(key); return { read: { denied: json.denied as Refusal } as Read<R>, tables, nextExpiry: null }; }
        const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
        if (json.loading || !("data" in json)) {
          serverAnswers.delete(key);
          return { read: { loading: true } as Read<R>, tables, nextExpiry };
        }
        const next = (json.next as Cursor | null | undefined) ?? null;
        const read = { data: json.data as R, complete: json.complete !== false, cut: (json.cut ?? null) as ReadCut, fresh: true, next };
        if (remember) serverAnswers.set(key, { read, at: Date.now(), tables: new Set(tables) });
        return { read, tables, nextExpiry };
      }
    };
    return watch ? watch.fetch(fetch, () => notify(watch), { publishResult: false, retain }) : fetch();
  };
  // Keep whole-query and component routing on the same coverage rule.
  // @ref LLP 3000.007#20.22.1 — ask the server only for facts the device cannot establish (a missing fact, presence), not cuts the server would repeat; the same rule routes a composed component.
  const wantsServer = (coverage: Coverage) => !held && !coverage.retained && !!coverage.unknown;
  const local = async () => {
    const before = unavailable();
    if (before) return { outcome: {} as Outcome, result: { read: { denied: before } as Read<R>, tables, nextExpiry: null }, terminal: true };
    const answer = await call({ op: "query", name: op.name, viewer: env.principal, args, now: Date.now() });
    const unavailableWhy = unavailable();
    const outcome = (answer.ok ?? {}) as Outcome;
    for (const table of outcome.tables ?? []) tables.add(table);
    if (program && !program.native) {
      possible = !outcome.unknown && outcome.complete === true
        ? new Set(outcome.tables ?? []) : new Set([...staticTables, ...outcome.tables ?? []]);
    }
    const fresh = env.link === "online" && env.caughtUp && env.identityChecked;
    const nextExpiry = typeof outcome.nextExpiry === "number" && Number.isFinite(outcome.nextExpiry) ? outcome.nextExpiry : null;
    const denied = unavailableWhy ?? (answer.denied as Refusal | undefined) ?? outcome.denied;
    const read: Read<R> = denied ? { denied } : outcome.loading || !("data" in outcome) ? { loading: true } : { data: outcome.data as R, complete: outcome.complete !== false, cut: outcome.cut ?? null, fresh, next: (outcome.next as Cursor | null | undefined) ?? null, ...(fresh || !env.lastSyncAt ? {} : { since: env.lastSyncAt }) };
    return { outcome, result: { read, tables, nextExpiry, localKnown: !outcome.unknown }, terminal: !!(unavailableWhy || answer.denied) };
  };
  const withheld = (fallback = () => server(() => loading, false)) => routeWithheld(env.link === "online", held, pending, loading, fallback);
  // Executed card misses withhold; a known untaken branch does not.
  // The publication fence separately covers unknown branch conditions.
  const isWithheld = (outcome: Outcome) => outcome.loading && outcome.unknown && followingReads(schema, new Set(outcome.tables));
  const route = async (): Promise<Result<R>> => {
    let first = following() && env.partitionCurrent && (!program?.native || env.nativeReady) ? await local() : undefined;
    if (first?.terminal) return first.result;
    if (first && isWithheld(first.outcome)) return withheld();
    // A reset cannot certify old rows; preserve the normal routing of other queries.
    if (!env.partitionCurrent) return following() || program?.native ? withheld() : env.link === "online" ? server() : { read: { denied: offline() }, tables, nextExpiry: null, transportOffline: true };
    if (program?.native && !env.nativeReady) {
      if (env.link === "online") env.nativeReady = await installNative(env.signal);
      if (!env.nativeReady) return withheld();
    }
    if (!held && runsOnServer(env.backend, op, env.nativeReady)) return env.link === "online" ? server() : remembered();
    first ??= await local();
    if (first.terminal) return first.result;
    if (isWithheld(first.outcome)) return withheld();
    if ("loading" in first.result.read) return !held && env.link === "online"
      ? server(() => first!.result, true, true) : first.result;
    const { outcome } = first;
    // @ref LLP 3000.007#18.2 — a left group answers from delivered rows, online and offline, including watch reruns.
    if (outcome.denied) return wantsServer(outcome) ? env.link === "online" ? server(remembered, true, true) : { read: { denied: offline() }, tables, nextExpiry: null, transportOffline: true } : first.result;
    const components = Object.values(outcome.components ?? {});
    // @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — one original server query, then a second local observation and one publication of independent fields.
    if (!held && env.link === "online" && components.some(wantsServer) && components.some((c) => c.retained) && !await pending()) {
      // A composed operation must never recover a remembered whole server answer.
      serverAnswers.delete(key);
      let failed = false;
      const composedSince = env.lastSyncAt;
      const remote = await server(() => { failed = true; return first.result; }, false, true);
      if (!("data" in remote.read)) return remote;
      const second = await local();
      if (revision !== env.incarnation) return { read: { loading: true }, tables, nextExpiry: null };
      if (second.terminal) return second.result;
      if (isWithheld(second.outcome)) return withheld(async () => failed ? loading : remote);
      if (!failed && "loading" in second.result.read && env.link === "online") return remote;
      if (!("data" in second.result.read) || failed || env.link !== "online" || await pending()) return second.result;
      const coverage = Object.entries(second.outcome.components ?? {});
      const retained = coverage.filter(([, c]) => c.retained);
      if (!retained.length) return remote;
      if (!coverage.some(([, c]) => wantsServer(c))) return second.result;
      const kept = coverage.filter(([, c]) => !wantsServer(c));
      const data = { ...remote.read.data as Record<string, unknown> };
      for (const [field] of kept) data[field] = (second.outcome.data as Record<string, unknown>)[field];
      const expiries = [remote.nextExpiry, second.result.nextExpiry].filter((expiry): expiry is number => expiry !== null);
      return { read: { data: data as R, complete: remote.read.complete && kept.every(([, c]) => c.complete !== false), cut: remote.read.cut ?? null, fresh: false, ...(composedSince ? { since: composedSince } : {}), next: null }, tables, nextExpiry: expiries.length ? Math.min(...expiries) : null };
    }
    if (wantsServer(outcome) && env.link === "online" && !await pending()) return server(remembered, true, true);
    return first.result;
  };
  return publish(await route());
}

