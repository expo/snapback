// Labelled mock: table lifetimes are supplied as fixture metadata; no Quarry interpreter.
import type { Ephemeral, Link, Principal, Refusal, Signal } from "./contract.ts";
import type { MockOptions, Tables, Row } from "./mock.ts";
import { ephemeralLane } from "./ephemeral.ts";

export function mockSignals(options: MockOptions, tables: Tables, viewer: () => Principal | null,
  link: () => Link, mint: () => string, bump: () => void) {
  const lifetime = new AbortController();
  const lives = new Map(Object.entries(options.ephemeral ?? {}));
  const deadlines = new Map<string, Map<string, number>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  for (const [table, life] of lives) {
    if (!Number.isFinite(life) || life < 1000 || life > 60000) throw new RangeError(`ephemeral life for ${table} must be 1000–60000 ms`);
    tables[table] = new Map([...tables[table] ?? []].map(([id, row]) => [id, structuredClone(row)]));
    deadlines.set(table, new Map([...tables[table].keys()].map(id => [id, Date.now() + life])));
  }
  function sweep() {
    let removed = false;
    for (const [table, rows] of deadlines) for (const [id, at] of rows) if (at <= Date.now()) {
      rows.delete(id); tables[table]?.delete(id); removed = true;
    }
    return removed;
  }
  function schedule() {
    clearTimeout(timer);
    const at = Math.min(...[...deadlines.values()].flatMap(rows => [...rows.values()]));
    if (!Number.isFinite(at) || lifetime.signal.aborted) return;
    timer = setTimeout(() => { if (sweep()) bump(); schedule(); }, Math.max(0, at - Date.now()));
    (timer as { unref?: () => void }).unref?.();
  }
  const execute = (name: string, args: unknown): unknown => {
    sweep();
    const fn = options.ops.signals?.[name] ?? options.ops.mutations[name];
    if (!fn) return { code: "E_OP", family: "op", message: `unknown ephemeral mutation ${name}` };
    const draft: Tables = Object.create(null), touched = new Map<string, Set<string>>();
    for (const [table, rows] of Object.entries(tables)) {
      const copy = new Map([...rows].map(([id, row]) => [id, structuredClone(row)]));
      draft[table] = new Proxy(copy, { get(target, key) {
        if (key === "set") return (id: string, row: Row) => { const ids = touched.get(table) ?? new Set(); ids.add(id); touched.set(table, ids); target.set(id, row); return draft[table]; };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    }
    let result: unknown;
    try { result = fn(draft, args as never, viewer(), mint); }
    catch (error) { return { code: "E_CLIENT", family: "client", message: String(error) }; }
    if (result && typeof result === "object" && "code" in result && "family" in result) return result;
    for (const [table, rows] of Object.entries(draft)) {
      const changed = JSON.stringify([...rows]) !== JSON.stringify([...tables[table]!]);
      if ((changed || touched.has(table)) && !lives.has(table)) return { code: "E_QUARRY_EPHEMERAL", family: "schema", message: `the mock needs an ephemeral life for ${table}; ephemeral writes cannot change durable rows` };
    }
    const at = Date.now();
    for (const [table, life] of lives) {
      const rows = draft[table]!;
      const times = deadlines.get(table) ?? new Map<string, number>();
      for (const id of times.keys()) if (!rows.has(id)) times.delete(id);
      for (const [id, row] of rows) {
        if (touched.get(table)?.has(id) || JSON.stringify(row) !== JSON.stringify(tables[table]!.get(id))) times.set(id, at + life);
        delete row.pending;
      }
      tables[table] = new Map(rows); deadlines.set(table, times);
    }
    schedule(); bump();
    return { result: result ?? null };
  };
  const lane = ephemeralLane({ url: "mock://ephemeral", headers: () => ({}), link, mint,
    signal: lifetime.signal, offline() {},
    fetch: async (url, init) => {
      const { args } = JSON.parse(init!.body as string);
      const result = execute(String(url).split('/m/')[1]!, args) as { result: unknown } | Refusal;
      return Response.json("code" in result ? { state: "failed", why: result } : { state: "sent", result: result.result });
    },
  });
  schedule();
  return {
    mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>> {
      // Match the mock's existing table.verb convention when no table
      // metadata was supplied. Multiple tables need explicit fixture lives.
      const table = op.name.split(".")[0]!;
      if (!lives.has(table) && tables[table] && !options.ephemeral) {
        lives.set(table, op.renewMs * 4); deadlines.set(table, new Map());
      }
      return lane.mutate(op, args);
    },
    sweep, linkChanged: lane.linkChanged,
    close() { lifetime.abort(); clearTimeout(timer); for (const table of lives.keys()) tables[table]?.clear(); },
  };
}
