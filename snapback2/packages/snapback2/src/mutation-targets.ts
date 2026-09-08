// @ref LLP 1018.003.001#3-semantic-mutation-targets — allocation correspondence is certified, captured at admission, and fenced by actual execution identity.
import { referenceName, referencePath, type Op } from "./api.js";
import type { HeldProgram, OutboxEntry } from "./store/range-store.js";

export type MutationTargetKind = "create" | "update" | "remove";
export type UnresolvedMutationTarget = "conditional" | "repeated" | "ambiguous" | "computed";
export interface MutationProgramIdentity { readonly planHash: string; readonly schemaHash: string }
export interface AdmittedMutationTargets extends MutationProgramIdentity {
  readonly generation: string;
  readonly rows: readonly { table: string; kind: MutationTargetKind; id: string }[];
  readonly unresolved: readonly { table: string; kind: MutationTargetKind; reason: UnresolvedMutationTarget }[];
  /** Whether every direct row effect has an exact address; server-only effects have independent custody. */
  readonly complete: boolean;
}
export interface MutationTargetRef<Args, Kind extends MutationTargetKind = MutationTargetKind, Result = unknown> extends Op<Args, Result> {
  readonly op: string;
  readonly table: string;
  readonly __args?: (args: Args) => void;
  readonly __kind?: Kind;
  /** Exact address, when this entry has matching certified admission/commit custody. */
  id(entry: Readonly<OutboxEntry>): string | undefined;
}

/** Select a compiler-known table; declarations type the choice, durable facts supply the address. */
export function mutationTarget<Args, Result, Targets extends Record<string, MutationTargetKind>, Table extends keyof Targets & string>(
  op: Op<Args, Result, Targets>, table: Table,
): MutationTargetRef<Args, Targets[Table], Result> {
  const name = referenceName(op);
  return Object.freeze({ op: name, [referencePath]: name, table, id: (entry: Readonly<OutboxEntry>) => resolvedMutationTarget(entry, name, table) });
}

/** A target ref submits the same operation while pinning its presentation handoff. */
export function mutationPresentation(ref: Op<any, any>): string | undefined {
  const table = (ref as Partial<MutationTargetRef<any>>).table;
  return typeof table === "string" ? table : undefined;
}

export function resolvedMutationTarget(entry: Readonly<OutboxEntry>, op: string, table: string, kind?: MutationTargetKind): string | undefined {
  if (entry.op !== op || !matchingMutationProgram(entry) || entry.targets!.unresolved.some(row => row.table === table)) return undefined;
  const rows = entry.targets!.rows.filter(row => row.table === table);
  return rows.length === 1 && (kind === undefined || rows[0]!.kind === kind) ? rows[0]!.id : undefined;
}

export function matchingMutationProgram(entry: Readonly<OutboxEntry>): boolean {
  if (!entry.targets) return false;
  if (entry.state !== "committed") return true;
  const program = (entry.response as { program?: MutationProgramIdentity } | undefined)?.program;
  return program?.planHash === entry.targets.planHash && program?.schemaHash === entry.targets.schemaHash;
}

const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
/** Validate and materialize the certified relation in the ledger's admission turn. */
export function admittedMutationTargets(program: HeldProgram | undefined, op: string, args: unknown, ids: readonly string[]): AdmittedMutationTargets | undefined {
  const operation = program?.programs[op];
  if (!program || operation?.kind !== "mutation") return undefined;
  const certificate = operation.certificate;
  const value = object(certificate) ? certificate.mutation_targets : undefined;
  if (!object(value) || !Array.isArray(value.targets) || typeof value.complete !== "boolean") return undefined;
  const seen = new Set<string>();
  const rows: AdmittedMutationTargets["rows"][number][] = [], unresolved: AdmittedMutationTargets["unresolved"][number][] = [];
  for (const target of value.targets) {
    if (!object(target) || typeof target.table !== "string" || !["create", "update", "remove"].includes(target.kind)) return undefined;
    const { table, kind, source } = target, key = `${table}\0${kind}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    let id: unknown;
    if (source !== undefined) {
      if (target.unresolved !== undefined || !object(source) || Object.keys(source).length !== 1) return undefined;
      if ("newId" in source) {
        if (!Number.isSafeInteger(source.newId) || source.newId < 0) return undefined;
        id = ids[source.newId];
      } else if (typeof source.argument === "string") {
        const type = (operation.ir as { args?: Record<string, unknown> }).args?.[source.argument];
        if (type !== "Id" && !(object(type) && object(type.Ref) && typeof type.Ref.table === "string")) return undefined;
        id = object(args) ? args[source.argument] : undefined;
      } else return undefined;
    } else if (!["conditional", "repeated", "ambiguous", "computed"].includes(target.unresolved) || value.complete) return undefined;
    if (typeof id === "string" && id) rows.push({ table, kind, id });
    else unresolved.push({ table, kind, reason: target.unresolved ?? "computed" });
  }
  return { generation: program.generation, planHash: operation.planHash, schemaHash: program.schemaHash,
    rows, unresolved, complete: value.complete && unresolved.length === 0 };
}
