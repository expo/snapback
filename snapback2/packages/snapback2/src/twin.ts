import { nullOnceMedia } from "./store/asset-policy.js";
// @ref LLP 1012#6-reads-offline — the twin is the client: with the backend
// unreachable the certified program runs here over incremental carrier snapshots; a read inside
// coverage is exact, a read outside is `partial` at that site with its reason.
// @ref LLP 1012#7-writes-offline — on enqueue the twin runs the mutation over
// held rows, writes the prediction overlay, and records the trace the server
// validates at commit: every point read with its digest, every rule verdict.
import { wireJson } from "../../evaluator/src/value-runtime.js";
import { cursorArgument, isLocalCursor, localBinding, decodeLocalCursor, encodeLocalCursor, StaleLocalPage, type LocalFence } from "./local-cursor.js";
import { EvalError } from "../../evaluator/src/errors.js";
import { queryClock } from './held-program.js';
import { queryState } from "../../evaluator/src/runner.js";
import { ClientStore } from "../../evaluator/src/store.js";
import { SearchExecution } from "../../evaluator/src/search-runtime.js";
import { TwinStore, type TwinStoreSources } from "./twin-store.js";
import { emptyTrace } from "./store/outbox.js";
import { partialReasons, tagArguments, type PartialSite } from "./twin-hydrate.js";
import type { Context, Trace } from "../../evaluator/src/types.js";
import type { OutboxTrace, OverlayRow } from "./store/range-store.js";

export interface TwinSources extends TwinStoreSources {
  seq(): number;
}

/** A query the twin answered locally, in the wire's shape plus its offline facts. */
export interface LocalAnswer {
  state: "complete" | "capped" | "held" | "partial" | "denied";
  data?: unknown;
  next?: string | null;
  seq: number;
  reason?: string;
  rule?: string;
  /** The first uncovered site (`partial`). */
  site?: string;
  /** Every uncovered site with its reason (`partial`). */
  sites?: PartialSite[];
  /** Queued intents whose predicted rows are visible in `data`, in order. */
  predicted?: string[];
  /** The newest delivery the answer was computed from. */
  since?: number;
}

export interface Prediction {
  predicted: boolean;
  overlay: OverlayRow[];
  trace: OutboxTrace;
  /** Range reads evaluated over held rows only; ranges re-execute fresh at commit and are never validated. */
  partialRanges: string[];
  /** The point reads or rule inputs outside coverage that stopped the prediction. */
  uncovered: PartialSite[];
  /**
   * Engine-owned aggregate targets (`maintain … count`) this write updates on the
   * server but the overlay omits, because the store does not hold them: named so
   * a reader can tell an intentionally omitted aggregate from a lost write.
   */
  omitted: string[];
}

type Hydrated = TwinStore;

/** Debug seam for the witness: why the twin last declined to evaluate (never part of a result). */
export function twinLastDecline(): string | undefined { return (globalThis as { __snapbackTwinLast?: string }).__snapbackTwinLast; }
function decline(reason: string): undefined { (globalThis as { __snapbackTwinLast?: string }).__snapbackTwinLast = reason; return undefined; }

export class Twin {
  private readonly indexed: TwinStore;
  constructor(private readonly sources: TwinSources) { this.indexed = new TwinStore(sources); }

  /**
   * The certified program run over coverage. `undefined` when no program is
   * held, when the coverage was delivered under another generation or schema
   * (the successor fence: a predecessor's program never evaluates into current
   * state), or when the operation is not a query the program knows.
   */
  async evaluate(op: string, args: unknown): Promise<LocalAnswer | undefined> {
    if (this.sources.program()?.programs[op]?.kind !== "query") return decline("unknown-op");
    if (readsConnected(this.sources.program()?.programs[op])) return decline("connected");
    const hydrated = await this.hydrate();
    if (!hydrated) return decline("hydrate");
    const operation = hydrated.program.programs[op];
    if (!operation || operation.kind !== "query") return decline("unknown-op");
    const ir = operation.ir as { args?: unknown };
    const cursor = cursorArgument(operation), fence: LocalFence = {
      partition: this.sources.principal()!, operation: op, program: operation.planHash, schema: hydrated.program.schemaHash,
      generation: hydrated.program.generation, incarnation: `${hydrated.revision!.incarnation}:${hydrated.incarnation}`,
      revisions: [hydrated.rowsRevision, hydrated.authorityRevision, hydrated.overlayRevision],
      timed: queryClock(operation),
    };
    const searchWork = new SearchExecution(), binding = localBinding(operation, args, searchWork);
    const token = cursor && (args as any)?.[cursor];
    if (cursor && isLocalCursor(token)) {
      try { args = { ...(args as any), [cursor]: decodeLocalCursor(token, fence, binding, Object.values((operation.certificate as any)?.result_pages ?? {})) }; }
      catch (error) {
        if (!(error instanceof StaleLocalPage)) throw error;
        // One local restart; this call never recurses or forwards the token to transport.
        args = { ...(args as any), [cursor]: null };
      }
    }
    const context = this.context(hydrated, ir, args, [], true, fence.readTime);
    if (!context) return decline("context");
    if (fence.timed) fence.readTime = context.read_time!;
    const since = hydrated.deliveredAt;
    const base = {
      seq: this.sources.seq(),
      ...(since === undefined ? {} : { since }),
      ...(hydrated.predicted.length ? { predicted: hydrated.predicted } : {}),
    };
    const partial = (sites: string[], trace: Trace, data?: unknown): LocalAnswer => {
      const reasons = partialReasons(sites, trace, hydrated);
      return {
        state: "partial",
        ...(data === undefined ? {} : { data }),
        reason: reasons[0]?.reason ?? "never-held",
        ...(reasons[0] === undefined ? {} : { site: reasons[0].site }),
        sites: reasons,
        ...base,
      };
    };
    try {
      const local = hydrated.store.reexecute(ir, context, operation.certificate, searchWork);
      const page = local.execution.page;
      const suffix = page?.merge
        ? local.execution.trace.merges.slice().reverse().find(m => m.site === page.site)?.last_returned_suffix
        : local.execution.trace.ranges.slice().reverse().find(r => r.site === page?.site)?.lastReturnedSuffix;
      const next = page && suffix && queryState(operation.certificate, local.execution.trace, context.viewer) === 'capped'
        ? encodeLocalCursor(fence, binding, { table: page.table, index: page.index, order: page.order, suffix: page.suffix, values: suffix }) : null;
      const result = local.execution.result;
      const data = result === "Null" && local.state !== "fresh" ? undefined : nullOnceMedia(wireJson(result), hydrated.onceAssets);
      const ranges = new Set(local.execution.trace.ranges.map(r => r.site));
      const search = local.execution.held || local.execution.trace.ranges.some(r => r.prefix.some(p => 'WordPrefix' in p));
      const trustworthy = !local.partialSites.some(site => !ranges.has(site)) && !local.execution.trace.absences.some(a => local.partialSites.includes(a.site));
      if (search && trustworthy && (local.state !== 'fresh' || local.execution.held)) {
        return { state: queryState(operation.certificate, local.execution.trace, context.viewer) === 'capped' ? 'capped' : 'held', data, next, ...base };
      }
      if (local.state === "fresh") {
        return { state: queryState(operation.certificate, local.execution.trace, context.viewer), data, next: search || fence.timed ? next : local.execution.next, ...base };
      }
      return partial(local.partialSites, local.execution.trace, local.partialSites.includes("missing-authority") ? undefined : data);
    } catch (error) {
      if (!(error instanceof EvalError)) throw error;
      if (error.trace && error.partialSites?.length) return partial(error.partialSites, error.trace);
      if (error.code === "E_REQUIRE") return { state: "denied", rule: error.authoredCode ?? error.code, ...base };
      // A covered execution failure is not missing coverage.
      throw error;
    }
  }

  /**
   * The mutation run over held rows with the intent's pinned ids as its `new`
   * envelope, so the prediction and the commit mint the same ids. Predicted
   * when every point read and rule input was covered; a range the store does
   * not hold whole is evaluated over the rows it has and named in
   * `partialRanges` — ranges re-execute at commit and are never validated. An
   * uncovered point or rule input, or a local refusal, leaves the intent
   * queued without a prediction and with an empty trace: the server judges.
   */
  async predict(op: string, args: unknown, ids: string[]): Promise<Prediction> {
    const none: Prediction = { predicted: false, overlay: [], trace: emptyTrace(), partialRanges: [], uncovered: [], omitted: [] };
    if (this.sources.program()?.programs[op]?.kind !== "mutation" || readsConnected(this.sources.program()?.programs[op])) return none;
    const hydrated = await this.hydrate();
    if (!hydrated) return none;
    const operation = hydrated.program.programs[op];
    if (!operation || operation.kind !== "mutation") return none;
    const ir = operation.ir as { args?: unknown };
    let context: Context | undefined;
    try { context = this.context(hydrated, ir, args, ids); }
    catch (error) { if (!(error instanceof EvalError)) throw error; return none; }
    if (!context) return none;
    let local: ReturnType<ClientStore["applyMutation"]>;
    try {
      local = hydrated.store.applyMutation(ir, context, true, operation.certificate);
    } catch (error) {
      // A typed local mutation refusal (including an unsupported local IR or
      // schema) does not reject the intent: the server still judges it (§7).
      // Unexpected JS errors propagate; they cannot enqueue an empty trace.
      if (!(error instanceof EvalError)) throw error;
      return {
        ...none,
        uncovered: error.trace && error.partialSites ? partialReasons(error.partialSites, error.trace, hydrated) : [],
      };
    }
    const trace = local.execution.trace;
    // An engine-owned aggregate target the store does not hold (`maintain …
    // count`) is the server's to update: it is no read of the program's and
    // nothing the viewer renders from this write, so it does not block the
    // prediction; the overlay simply carries no count row, and names the
    // target under `omitted`. Every other `missing-authority` (a rule input,
    // a write row) does block.
    const misses = local.authorityMisses;
    const onlyMaintainTargets = local.state === "partial"
      && local.partialSites.every((site) => site === "missing-authority")
      && misses?.other === 0 && misses.maintainTargets.length;
    if (local.state !== "predicted" && !onlyMaintainTargets) return { ...none, uncovered: partialReasons(local.partialSites, trace, hydrated) };
    const rangeSites = new Set(trace.ranges.map((range) => range.site));
    const uncovered = local.uncoveredSites ?? [];
    const blocking = uncovered.filter((site) => !rangeSites.has(site) || trace.absences.some((absence) => absence.site === site));
    if (blocking.length) return { ...none, uncovered: partialReasons(blocking, trace, hydrated) };
    return {
      predicted: true,
      // Keep typed writes for replay; hydrate collects their once IDs and evaluate nulls their media.
      overlay: local.execution.writes.map((write) => write.row === null
        ? { table: write.table, id: write.id, row: {}, removed: true as const }
        : { table: write.table, id: write.id, row: wireJson(write.row) as Record<string, unknown>, ...(write.fields ? { fields: write.fields } : {}) }),
      trace: {
        points: trace.points.map((point) => ({
          table: point.table,
          index: point.index,
          key: point.key.map(wireJson),
          digest: point.digest,
        })),
        verdicts: trace.verdicts.map((verdict) => ({
          ruleHash: verdict.rule_hash,
          inputsDigest: verdict.inputs_digest,
          result: verdict.result,
        })),
      },
      partialRanges: uncovered,
      uncovered: [],
      omitted: [...new Set(misses?.maintainTargets ?? [])],
    };
  }

  private context(hydrated: Hydrated, ir: { args?: unknown; read_time_granularity_ms?: number }, args: unknown, ids: string[], query = false, pinnedClock?: number): Context | undefined {
    const principal = this.sources.principal();
    if (principal === undefined) throw new TypeError("no partition is open");
    let localArgs: Context["args"];
    try { localArgs = tagArguments(ir.args, args); }
    catch (error) { if (error instanceof TypeError) throw new EvalError("E_INPUT", error.message); throw error; }
    const now = pinnedClock ?? this.sources.now();
    return localArgs && {
      viewer: principal,
      principal_kind: "user",
      // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — the auth-epoch fence:
      // a verdict minted under another epoch never matches, so it cannot vouch here.
      auth_epoch: hydrated.facts?.authEpoch ?? 0,
      args: localArgs,
      now,
      new_ids: [...ids],
      read_time: query && ir.read_time_granularity_ms != null ? now : null,
    };
  }

  private async hydrate(): Promise<Hydrated | undefined> {
    return await this.indexed.sync() ? this.indexed : undefined;
  }

}

// @ref LLP 1001#51-connected — even an unexecuted branch is server-only; no held count authorizes prediction.
export function readsConnected(operation: { certificate?: unknown } | undefined): boolean {
  const certificate = operation?.certificate as { read_sites?: Array<{ table: string }> } | undefined;
  return certificate?.read_sites?.some(site => site.table === "_connected") ?? false;
}
