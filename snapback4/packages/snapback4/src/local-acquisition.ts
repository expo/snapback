import type { BackendJson } from "./backend.ts";
import type { DeviceCompatibility } from "./device-version.ts";
import type { SyncPage } from "./local-sync.ts";

export interface AcquisitionGroup { table: string; group: unknown[] }
export interface ProgressiveState {
  acquired: boolean;
  acquisition_cursor: string | null;
  acquisition_exhausted: boolean;
  acquired_tables: string[];
  floored_groups: number;
  replacement_required: boolean;
  adoption_capture?: Record<string, string | null>;
}
export interface AcquisitionPage {
  /** The first cold unit adopts images_at; subsequent drains use sync_state.watermark. */
  pinned?: boolean;
  unit: { tier: number; table: string; group?: unknown[] } | null;
  units?: { tier: number; table: string; group?: unknown[] }[];
  cursor: string | null;
  exhausted: boolean;
  whole_tables: string[];
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const key = (group: AcquisitionGroup) => JSON.stringify([group.table, group.group]);

export function progressiveState(value: unknown): ProgressiveState | undefined {
  const state = object(value);
  return typeof state.acquired === "boolean" && Object.hasOwn(state, "acquisition_cursor")
    && (state.acquisition_cursor === null || typeof state.acquisition_cursor === "string")
    && typeof state.acquisition_exhausted === "boolean" && typeof state.replacement_required === "boolean"
    && Array.isArray(state.acquired_tables) && state.acquired_tables.every(t => typeof t === "string")
    && Number.isSafeInteger(state.floored_groups) && Number(state.floored_groups) >= 0 ? state as unknown as ProgressiveState : undefined;
}

// @ref LLP 3000.001.001#41-keep-the-existing-declaration-and-query — inspect the bound page/index/prefix; never interpret a query or infer coverage from its rows.
export function foregroundHint(backend: BackendJson | null, name: string, args: unknown): AcquisitionGroup | undefined {
  const program = backend?.programs.find(p => p.name === name);
  if (!program || program.native || program.kind !== "Query" || program.held || program.search) return;
  const bindings = new Map<string, unknown>();
  let returned: unknown;
  for (const statement of program.body) {
    const s = object(statement), binding = object(s.Let);
    if (typeof binding.name === "string") bindings.set(binding.name, binding.value);
    else if (Object.hasOwn(s, "Return")) returned = s.Return;
    else return; // Branches, loops, counts and other derived shapes have no hint.
  }
  const resolve = (value: unknown): Record<string, unknown> => {
    const seen = new Set<string>();
    let expr = object(value);
    while (typeof expr.Variable === "string" && bindings.has(expr.Variable) && !seen.has(expr.Variable)) {
      seen.add(expr.Variable); expr = object(bindings.get(expr.Variable));
    }
    return expr;
  };
  const scan = object(resolve(returned).Scan);
  if (typeof scan.table !== "string" || scan.order !== "Desc" || scan.existence || !Array.isArray(scan.prefix)) return;
  const table = backend!.schema.tables[scan.table], sync = table?.sync;
  if (!sync?.horizon || scan.index !== sync.horizon.by) return;
  const audience = object(sync.audience), target = object(audience.Target);
  const columns = Array.isArray(target.prefix) ? target.prefix : typeof audience.Column === "string" ? [audience.Column] : undefined;
  if (!columns?.length) return;
  const components = table!.indexes[sync.horizon.by]?.components;
  const group: unknown[] = [];
  for (let i = 0; i < columns.length; i++) {
    if (object(components?.[i]).Column !== columns[i]) return;
    const scalar = object(object(scan.prefix[i]).Scalar);
    let value: unknown;
    if (typeof scalar.Variable === "string" && Object.hasOwn(program.args, scalar.Variable)) {
      const supplied = object(args), alias = Object.entries(program.arg_aliases ?? {}).find(([, canonical]) => canonical === scalar.Variable)?.[0];
      value = supplied[scalar.Variable] ?? (alias ? supplied[alias] : undefined);
    } else {
      const literal = object(scalar.Literal);
      value = literal.Id ?? literal.String ?? literal.Int;
    }
    if (!(typeof value === "string" || typeof value === "number" && Number.isSafeInteger(value))) return;
    group.push(value);
  }
  return { table: scan.table, group };
}

/** Scheduling only. The durable cursor and coverage always belong to the device. */
export class LocalAcquisition {
  pending = false;
  private streamDue = false;
  private drainPages = 0;
  private started = false;
  private readonly served = new Map<string, AcquisitionGroup>();
  private oneTurn: AcquisitionGroup | undefined;
  reset() { this.pending = false; this.streamDue = false; this.drainPages = 0; this.started = false; this.served.clear(); this.oneTurn = undefined; }
  hintOnce(hint: AcquisitionGroup | undefined) { if (hint) this.oneTurn = hint; }
  // @ref LLP 3000.001.001#62-the-walk-its-cursor-and-completion — explicit sync retains full-acquisition readiness while background rounds publish one unit at a time.
  async sync(afterCall: () => Promise<boolean>, once: () => Promise<boolean>, active: () => boolean): Promise<void> {
    if (!active() || !await afterCall()) return;
    // Release the network owner between units so queued writes and observation
    // hints can run. A refused/offline round ends this call without claiming ready.
    while (this.pending && active()) if (!await once()) return;
  }
  replacement(compatibility: DeviceCompatibility | undefined, value: unknown): boolean {
    const state = progressiveState(value);
    // A partly walked store cannot finish via an old server's terminal ordinary
    // page. Reuse the staged replacement if the resumed peer lacks the protocol.
    return !!state && (state.replacement_required || !state.acquired
      && (state.acquisition_cursor !== null || state.acquisition_exhausted)
      && !compatibility?.advertised?.includes("progressive-acquisition-v1"));
  }
  // @ref LLP 3000.001.001#9-scope-compatibility-and-costs — an old deny_unknown_fields server must never receive acquire.
  request(compatibility: DeviceCompatibility | undefined, value: unknown, hints: Iterable<AcquisitionGroup>, snapshot: boolean): { acquire?: { cursor: string | null; hint?: AcquisitionGroup; skip: AcquisitionGroup[] }; stream?: boolean } | undefined {
    const state = progressiveState(value);
    if (!compatibility?.advertised?.includes("progressive-acquisition-v1") || !state || state.acquired && !this.streamDue || state.replacement_required || snapshot) return;
    // The existing atomic capture exposes slot occupancy even when an acquisition
    // deferred at the same watermark. Comparing transfer > published loses it.
    const deferred = state.adoption_capture?.["device:deferred:cursor"] != null;
    if (deferred || state.acquisition_exhausted || this.streamDue || !this.started && state.acquisition_cursor !== null) {
      this.started = true;
      return { stream: true };
    }
    this.started = true;
    const candidates = new Map<string, AcquisitionGroup>();
    for (const hint of hints) candidates.set(key(hint), hint);
    if (this.oneTurn) candidates.set(key(this.oneTurn), this.oneTurn);
    this.oneTurn = undefined;
    const hint = [...candidates.values()].reverse().find(h => !this.served.has(key(h)));
    return { acquire: { cursor: state.acquisition_cursor, ...(hint ? { hint } : {}), skip: [...this.served.values()] } };
  }
  // @ref LLP 3000.001.001#62-the-walk-its-cursor-and-completion — unpublished replies neither skip units nor advance progress.
  applied(page: SyncPage, published: boolean) {
    this.streamDue = !!page.acquire || !published || page.more === true;
    if (!published) return false;
    for (const event of (page.events ?? []) as { table: string; kind: string }[]) {
      // Forget scheduling skips on authority changes. Coverage remains device-owned.
      if (event.kind === "scope") for (const [id, group] of this.served) if (group.table === event.table) this.served.delete(id);
    }
    const progress = page.acquire as AcquisitionPage | undefined;
    // @ref LLP 3000.001.001#62-the-walk-its-cursor-and-completion — one page may publish several groups; keep the same bounded scheduling skip set.
    for (const unit of progress?.units ?? (progress?.unit ? [progress.unit] : [])) {
      if (unit.tier !== 2 || !unit.group) continue;
      const group = { table: unit.table, group: unit.group };
      this.served.set(key(group), group);
      if (this.served.size > 32) this.served.delete(this.served.keys().next().value!);
    }
    // @ref LLP 3000.001.001#42-two-tiers-then-the-walk — bound ordinary drains under continuous traffic. Only a published page can yield; a deferred publication or replacement still owns its required drain.
    if (page.acquire) { this.drainPages = 0; return false; }
    if (!page.more || ++this.drainPages >= 4) {
      this.drainPages = 0; this.streamDue = false;
      return true;
    }
    return false;
  }
}
