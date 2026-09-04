// @ref LLP 1012#6-reads-offline — the twin is the client: with the backend
// unreachable the certified program runs here over `coverage()`; a read inside
// coverage is exact, a read outside is `partial` at that site with its reason.
// @ref LLP 1012#7-writes-offline — on enqueue the twin runs the mutation over
// held rows, writes the prediction overlay, and records the trace the server
// validates at commit: every point read with its digest, every rule verdict.
import { EvalError } from "../../evaluator/src/errors.js";
import { queryState } from "../../evaluator/src/runner.js";
import { ClientStore } from "../../evaluator/src/store.js";
import { wireJson } from "../../evaluator/src/value-runtime.js";
import type { Context, Trace } from "../../evaluator/src/types.js";
import { tagWireRow, type WireValue } from "./offline-protocol.js";
import { emptyTrace } from "./store/outbox.js";
import type { Coverage, HeldProgram, OutboxEntry, OutboxTrace, OverlayRow } from "./store/range-store.js";
import { closureFromCoverage, partialReasons, tagArguments, type PartialSite } from "./twin-hydrate.js";

export interface TwinSources {
  /** The certified program held for this partition, if any. */
  program(): HeldProgram | undefined;
  coverage(): Promise<Coverage | undefined>;
  overlay(): Promise<Record<string, OverlayRow[]>>;
  /** Every durable intent, FIFO; overlays are layered in this order. */
  entries(): Promise<OutboxEntry[]>;
  principal(): string | undefined;
  now(): number;
  seq(): number;
}

/** A query the twin answered locally, in the wire's shape plus its offline facts. */
export interface LocalAnswer {
  state: "complete" | "capped" | "partial" | "denied";
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

interface Hydrated {
  program: HeldProgram;
  coverage: Coverage;
  store: ClientStore;
  predicted: string[];
}

export class Twin {
  constructor(private readonly sources: TwinSources) {}

  /**
   * The certified program run over coverage. `undefined` when no program is
   * held, when the coverage was delivered under another generation or schema
   * (the successor fence: a predecessor's program never evaluates into current
   * state), or when the operation is not a query the program knows.
   */
  async evaluate(op: string, args: unknown): Promise<LocalAnswer | undefined> {
    const hydrated = await this.hydrate();
    if (!hydrated) return undefined;
    const operation = hydrated.program.programs[op];
    if (!operation || operation.kind !== "query") return undefined;
    const ir = operation.ir as { args?: unknown };
    let context: Context;
    try {
      context = this.context(hydrated, ir, args, []);
    } catch {
      return undefined;
    }
    const since = hydrated.coverage.deliveredAt;
    const base = {
      seq: this.sources.seq(),
      ...(since === undefined ? {} : { since }),
      ...(hydrated.predicted.length === 0 ? {} : { predicted: hydrated.predicted }),
    };
    const partial = (sites: string[], trace: Trace, data?: unknown): LocalAnswer => {
      const reasons = partialReasons(sites, trace, hydrated.coverage);
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
      const local = hydrated.store.reexecute(ir, context, operation.certificate);
      const result = local.execution.result;
      const data = result === "Null" && local.state !== "fresh" ? undefined : wireJson(result);
      if (local.state === "fresh") {
        return { state: queryState(operation.certificate, local.execution.trace), data, next: local.execution.next, ...base };
      }
      return partial(local.partialSites, local.execution.trace, data);
    } catch (error) {
      if (!(error instanceof EvalError)) throw error;
      if (error.trace && error.partialSites && error.partialSites.length > 0) return partial(error.partialSites, error.trace);
      if (error.code === "E_REQUIRE") return { state: "denied", rule: error.authoredCode ?? error.code, ...base };
      return undefined;
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
    const hydrated = await this.hydrate();
    if (!hydrated) return none;
    const operation = hydrated.program.programs[op];
    if (!operation || operation.kind !== "mutation") return none;
    const ir = operation.ir as { args?: unknown };
    let context: Context;
    try {
      context = this.context(hydrated, ir, args, ids);
    } catch {
      return none;
    }
    let local: ReturnType<ClientStore["applyMutation"]>;
    try {
      local = hydrated.store.applyMutation(ir, context);
    } catch (error) {
      if (!(error instanceof EvalError)) throw error;
      return {
        ...none,
        uncovered: error.trace && error.partialSites ? partialReasons(error.partialSites, error.trace, hydrated.coverage) : [],
      };
    }
    const trace = local.execution.trace;
    // An engine-owned aggregate target the store does not hold (`maintain …
    // count`) is the server's to update: it is no read of the program's and
    // nothing the viewer renders from this write, so it does not block the
    // prediction; the overlay simply carries no count row, and names the
    // target under `omitted`. Every other `missing-authority` (a rule input,
    // a write row) does block.
    const onlyMaintainTargets = local.state === "partial"
      && local.partialSites.every((site) => site === "missing-authority")
      && local.authorityMisses !== undefined && local.authorityMisses.other === 0 && local.authorityMisses.maintainTargets.length > 0;
    if (local.state !== "predicted" && !onlyMaintainTargets) return { ...none, uncovered: partialReasons(local.partialSites, trace, hydrated.coverage) };
    const rangeSites = new Set(trace.ranges.map((range) => range.site));
    const uncovered = local.uncoveredSites ?? [];
    const blocking = uncovered.filter((site) => !rangeSites.has(site) || trace.absences.some((absence) => absence.site === site));
    if (blocking.length > 0) return { ...none, uncovered: partialReasons(blocking, trace, hydrated.coverage) };
    return {
      predicted: true,
      overlay: local.execution.writes.map((write) => write.row === null
        ? { table: write.table, id: write.id, row: {}, removed: true as const }
        : { table: write.table, id: write.id, row: wireJson(write.row) as Record<string, unknown> }),
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
      partialRanges: uncovered.filter((site) => rangeSites.has(site)),
      uncovered: [],
      omitted: [...new Set(local.authorityMisses?.maintainTargets ?? [])],
    };
  }

  private context(hydrated: Hydrated, ir: { args?: unknown }, args: unknown, ids: string[]): Context {
    const principal = this.sources.principal();
    if (principal === undefined) throw new TypeError("no partition is open");
    return {
      viewer: principal,
      principal_kind: "user",
      // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — the auth-epoch fence:
      // a verdict minted under another epoch never matches, so it cannot vouch here.
      auth_epoch: hydrated.coverage.facts?.authEpoch ?? 0,
      args: tagArguments(ir.args, args),
      now: this.sources.now(),
      new_ids: [...ids],
      read_time: null,
    };
  }

  private async hydrate(): Promise<Hydrated | undefined> {
    const program = this.sources.program();
    if (!program) return undefined;
    const coverage = await this.sources.coverage();
    if (!coverage) return undefined;
    if (coverage.facts
      && (coverage.facts.generation !== program.generation || coverage.facts.schemaHash !== program.schemaHash)) {
      return undefined;
    }
    // @ref LLP 1012#5-retention-revocation-and-the-fence — rule 4's twin-side
    // meaning: a held row of a `retain delivered-history` table is readable.
    const readable = Object.entries(program.schema.tables ?? {})
      .filter(([, table]) => table?.retain === "delivered-history")
      .map(([name]) => name);
    const overlay = await this.sources.overlay();
    const entries = await this.sources.entries();
    const predicted: string[] = [];
    try {
      const store = new ClientStore(program.schema, closureFromCoverage(coverage, program.schema, program.schemaHash), { readable });
      for (const entry of entries) {
        const rows = overlay[entry.intent];
        if (!rows) continue;
        for (const row of rows) {
          if (row.removed) store.remove(row.table, row.id);
          else store.put(row.table, tagWireRow(program.schema, row.table, row.row as Record<string, WireValue>));
        }
        predicted.push(entry.intent);
      }
      return { program, coverage, store, predicted };
    } catch (error) {
      // Coverage the held schema cannot tag, a schema the hasher refuses (an
      // unseen shape) or hashes unlike the program's, or an overlay row the
      // schema rejects: not delivered under this program, so the held answers
      // stand and the read is `hydrating`.
      if (error instanceof Error) return undefined;
      throw error;
    }
  }
}
