// @ref LLP 1018.003.001#3-semantic-mutation-targets — allocation correspondence is certified, captured at admission, and fenced by actual execution identity.
import { referenceName, type Op } from "./api.js";
import type { HeldOperation, HeldProgram, OutboxEntry } from "./store/range-store.js";

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
interface CertifiedTarget {
  table: string;
  kind: MutationTargetKind;
  source?: { newId: number } | { argument: string };
  unresolved?: UnresolvedMutationTarget;
}
export interface MutationTargetRef<Args, Kind extends MutationTargetKind = MutationTargetKind> {
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
): MutationTargetRef<Args, Targets[Table]> {
  const name = referenceName(op);
  return Object.freeze({ op: name, table, id: (entry: Readonly<OutboxEntry>) => resolvedMutationTarget(entry, name, table) });
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
/** Unknown/malformed descriptors never establish correspondence. */
export function certifiedMutationTargets(operation: HeldOperation): { targets: CertifiedTarget[]; complete: boolean } | undefined {
  const certificate = operation.certificate;
  const value = object(certificate) ? certificate.mutation_targets : undefined;
  if (!object(value) || !Array.isArray(value.targets) || typeof value.complete !== "boolean") return undefined;
  const seen = new Set<string>();
  for (const target of value.targets) {
    if (!object(target) || typeof target.table !== "string" || !["create", "update", "remove"].includes(target.kind)) return undefined;
    const key = `${target.table}\0${target.kind}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    if (target.source !== undefined) {
      if (target.unresolved !== undefined || !object(target.source) || Object.keys(target.source).length !== 1) return undefined;
      if ("newId" in target.source) {
        if (!Number.isSafeInteger(target.source.newId) || target.source.newId < 0) return undefined;
      } else if (typeof target.source.argument === "string") {
        const kind = (operation.ir as { args?: Record<string, unknown> }).args?.[target.source.argument];
        if (kind !== "Id" && !(object(kind) && object(kind.Ref) && typeof kind.Ref.table === "string")) return undefined;
      } else return undefined;
    } else if (!["conditional", "repeated", "ambiguous", "computed"].includes(target.unresolved) || value.complete) return undefined;
  }
  return value as { targets: CertifiedTarget[]; complete: boolean };
}

/** Called inside the ledger's admission turn, after reserving IDs, before the existing atomic swap. */
export function admittedMutationTargets(program: HeldProgram | undefined, op: string, args: unknown, ids: readonly string[]): AdmittedMutationTargets | undefined {
  const operation = program?.programs[op];
  if (!program || operation?.kind !== "mutation") return undefined;
  const contract = certifiedMutationTargets(operation);
  if (!contract) return undefined;
  const rows: AdmittedMutationTargets["rows"][number][] = [], unresolved: AdmittedMutationTargets["unresolved"][number][] = [];
  for (const target of contract.targets) {
    const { table, kind, source } = target;
    const id = source && ("newId" in source ? ids[source.newId] : object(args) ? args[source.argument] : undefined);
    if (typeof id === "string" && id) rows.push({ table, kind, id });
    else unresolved.push({ table, kind, reason: target.unresolved ?? "computed" });
  }
  return { generation: program.generation, planHash: operation.planHash, schemaHash: program.schemaHash,
    rows, unresolved, complete: contract.complete && unresolved.length === 0 };
}
