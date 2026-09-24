import type { Query } from "./contract.ts";
import type { BackendJson, SchemaJson } from "./backend.ts";
import { ReadObservation } from "./read-observation.ts";

export interface LocalWatch extends ReadObservation<unknown> {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  subscribers: Set<() => void>;
  running: boolean;
  dirty: boolean;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  incarnation: number;
}

/** These are invalidation hints, never an authorization evaluator. Unknown
 * effects invalidate all answers; only the device/server can authorize anew. */
export class ReadAuthority {
  revision = 0;
  // An inherited private transfer may contain a withdrawal from before open.
  private staged = true;
  private schema: SchemaJson | undefined;
  private columns = new Map<string, Set<string>>();
  private predictions = new Map<string, boolean>();

  clear(watches: Iterable<LocalWatch>, remembered: Map<string, unknown>): void {
    this.revision++;
    remembered.clear();
    for (const watch of watches) {
      watch.reset({ loading: true });
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
    }
  }

  committed(request: Record<string, any>, result: any, backend: BackendJson): boolean {
    this.inspect(backend.schema);
    if (request.op === "apply") {
      const page = request.page;
      for (const id of Object.keys(page.acknowledged ?? {})) this.predictions.delete(id);
      this.staged ||= !!(page.snapshot || page.snapshot_catchup) || (page.events ?? []).some((event: any) => event.kind !== "put" || this.columns.has(event.table));
      if (result?.published === false) return false;
      // Published touches include effects staged by another owner or an earlier page.
      const changed = this.staged || (page.requested_watermark ?? 0) > (page.captured_watermark ?? 0) || (result?.touched ?? []).some((table: string) => this.columns.has(table));
      this.staged = false;
      return changed;
    }
    if (request.op === "admit") {
      const program = backend.programs.find(program => program.name === request.entry.op);
      const changed = !!result?.predicted?.length && (!program || program.native || this.writesAuthority(program.body));
      this.predictions.set(request.entry.id, changed);
      // Older/other-owner settlements conservatively invalidate instead.
      if (this.predictions.size > 256) this.predictions.delete(this.predictions.keys().next().value!);
      return changed;
    }
    if (request.op === "settle") {
      const changed = this.predictions.get(request.id) ?? true;
      this.predictions.delete(request.id);
      return changed;
    }
    return request.op === "clear_rows";
  }

  private inspect(schema: SchemaJson): void {
    if (this.schema === schema) return;
    this.schema = schema;
    // A previously harmless prediction may affect a newly adopted read rule.
    this.predictions.clear();
    this.columns.clear();
    const add = (table: string, column: string) => {
      if (!this.columns.has(table)) this.columns.set(table, new Set());
      this.columns.get(table)!.add(column.split(".")[0]!);
    };
    const walk = (value: any, table: string): void => {
      if (!value || typeof value !== "object") return;
      if (typeof value.Field === "string") add(table, value.Field);
      if (value.Exists) {
        const probe = value.Exists;
        add(probe.table, "id");
        for (const component of schema.tables[probe.table]?.indexes[probe.index]?.components ?? []) if ("Column" in component) add(probe.table, component.Column);
        for (const [column] of probe.equalities ?? []) add(probe.table, column);
      }
      for (const child of Object.values(value)) walk(child, table);
    };
    for (const [name, table] of Object.entries(schema.tables)) walk((table as any).rules?.read, name);
  }

  private writesAuthority(value: any): boolean {
    if (!value || typeof value !== "object") return false;
    for (const [kind, effect] of Object.entries(value) as [string, any][]) {
      const table = effect?.table ?? effect?.target?.table;
      if (kind === "Delete") return true;
      if (["Insert", "InsertIfAbsent", "Upsert", "Update", "WriteTarget"].includes(kind) && this.columns.has(table)) {
        const fields = this.columns.get(table)!;
        const patch = effect.patch?.Object;
        if (kind !== "Update" && !(kind === "WriteTarget" && !effect.upsert)) return true;
        if (!patch || Object.keys(patch).some(column => fields.has(column.split(".")[0]!))) return true;
      }
      if (this.writesAuthority(effect)) return true;
    }
    return false;
  }
}
