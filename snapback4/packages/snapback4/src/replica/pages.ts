// A continuation belongs to the returned page. Keep this analysis aligned
// with core/engine/pages.rs; aliases and one-to-one collectors preserve it.
// @ref LLP 3000.003#implementation-follow-up — returned-page cursor provenance
import type { ProgramJson } from "./interpreter.ts";

type Origin =
  | { kind: "empty" }
  | { kind: "page"; site: string; cursor: string | null }
  | { kind: "record"; fields: Map<string, Origin> }
  | { kind: "cursor"; name: string };
type Bindings = Map<string, Origin>;
const empty: Origin = { kind: "empty" };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const variant = (value: unknown): [string, unknown] => typeof value === "string" ? [value, null] : Object.entries(object(value))[0] ?? ["", null];

function equal(a: Origin, b: Origin | undefined): boolean {
  if (!b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case "empty": return true;
    case "page": return b.kind === "page" && a.site === b.site && a.cursor === b.cursor;
    case "cursor": return b.kind === "cursor" && a.name === b.name;
    case "record": return b.kind === "record" && a.fields.size === b.fields.size && [...a.fields].every(([name, value]) => equal(value, b.fields.get(name)));
  }
}

function resultPage(origin: Origin): string | null {
  if (origin.kind === "page") return origin.site;
  const pages = new Map<string, string>();
  function collect(value: Origin): boolean {
    if (value.kind === "page") {
      if (value.cursor === null) return false;
      pages.set(JSON.stringify([value.site, value.cursor]), value.site);
    } else if (value.kind === "record") {
      return [...value.fields.values()].every(collect);
    }
    return true;
  }
  return collect(origin) && pages.size === 1 ? pages.values().next().value ?? null : null;
}

function scanCursor(scan: Record<string, unknown>, bindings: Bindings): string | null {
  const origin = expressionOrigin(scan.after, bindings);
  return origin?.kind === "cursor" && scan.before == null ? origin.name : null;
}

function expressionOrigin(value: unknown, bindings: Bindings): Origin | undefined {
  const [tag, raw] = variant(value), fields = object(raw);
  switch (tag) {
    case "Scan": return fields.opaque_cursor === true ? { kind: "page", site: text(fields.site), cursor: scanCursor(fields, bindings) } : undefined;
    case "Merge": {
      const lanes = list(fields.lanes).map(object);
      if (!lanes.every(lane => object(lane.scan).opaque_cursor === true)) return undefined;
      let cursor: string | null = null;
      for (const lane of lanes) {
        const local = new Map(bindings);
        if (lane.source != null) local.delete(text(lane.binding));
        origins(list(lane.setup), "", local, new Map());
        const next = scanCursor(object(lane.scan), local);
        if (next === null || (cursor !== null && next !== cursor)) return { kind: "page", site: text(fields.site), cursor: null };
        cursor = next;
      }
      return { kind: "page", site: text(fields.site), cursor };
    }
    case "Variable": return bindings.get(text(raw));
    case "Object": {
      const record = new Map<string, Origin>();
      for (const [name, expression] of Object.entries(fields)) {
        const origin = expressionOrigin(expression, bindings);
        if (origin) record.set(name, origin);
      }
      return { kind: "record", fields: record };
    }
    case "Field": {
      const origin = expressionOrigin(fields.base, bindings);
      return origin?.kind === "record" ? origin.fields.get(text(fields.name)) : undefined;
    }
    case "Array": return Array.isArray(raw) && raw.length === 0 ? empty : undefined;
    case "Literal": return Array.isArray(fields.Array) && fields.Array.length === 0 ? empty : undefined;
    default: return undefined;
  }
}

function domainOrigin(domain: unknown, bindings: Bindings): Origin | undefined {
  const [tag, raw] = variant(domain), fields = object(raw);
  if (tag === "Page" && fields.opaque_cursor === true) return { kind: "page", site: text(fields.site), cursor: scanCursor(fields, bindings) };
  return tag === "DerivedArray" ? expressionOrigin(fields.value, bindings) : undefined;
}

function writes(body: unknown[], counts: Map<string, number>): boolean {
  let exits = false;
  const add = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const statement of body) {
    const [tag, raw] = variant(statement), fields = object(raw);
    switch (tag) {
      case "Const": case "Let": case "Assign": add(text(fields.name)); break;
      case "Push": add(text(fields.target)); break;
      case "If": {
        const yes = writes(list(fields.then_body), counts), no = writes(list(fields.else_body), counts);
        exits = exits || yes || no;
        break;
      }
      case "For": add(text(fields.binding)); exits = writes(list(fields.body), counts) || exits; break;
      case "Return": case "Break": case "Continue": exits = true; break;
    }
  }
  return exits;
}

function origins(body: unknown[], prefix: string, bindings: Bindings, returns: Map<string, Origin>): boolean {
  for (const [index, statement] of body.entries()) {
    const path = `${prefix}:${index + 1}`, [tag, raw] = variant(statement), fields = object(raw);
    switch (tag) {
      case "Const": case "Let": case "Assign": {
        const origin = expressionOrigin(fields.value, bindings), name = text(fields.name);
        if (origin) bindings.set(name, origin); else bindings.delete(name);
        break;
      }
      case "Push": bindings.delete(text(fields.target)); break;
      case "Return": returns.set(path, expressionOrigin(raw, bindings) ?? empty); return false;
      case "If": {
        const yes = new Map(bindings), no = new Map(bindings);
        const yesLive = origins(list(fields.then_body), `${path}:then`, yes, returns);
        const noLive = origins(list(fields.else_body), `${path}:else`, no, returns);
        if (!yesLive && !noLive) return false;
        const joined = yesLive && noLive ? new Map([...yes].filter(([name, value]) => equal(value, no.get(name)))) : yesLive ? yes : no;
        bindings.clear();
        for (const [name, value] of joined) bindings.set(name, value);
        break;
      }
      case "For": {
        const origin = domainOrigin(fields.domain, bindings), binding = text(fields.binding), loopBody = list(fields.body);
        const local = new Map(bindings), nested = new Map<string, Origin>();
        local.delete(binding);
        origins(loopBody, path, local, nested);
        for (const path of nested.keys()) returns.set(path, empty);
        const changed = new Map<string, number>(), exits = writes(loopBody, changed);
        changed.set(binding, (changed.get(binding) ?? 0) + 1);
        const targets = loopBody.flatMap(statement => {
          const [tag, raw] = variant(statement), target = text(object(raw).target);
          return tag === "Push" && !exits && changed.get(target) === 1 && bindings.get(target)?.kind === "empty" ? [target] : [];
        });
        for (const name of changed.keys()) bindings.delete(name);
        if (origin?.kind === "page") for (const target of targets) bindings.set(target, origin);
        break;
      }
      case "Break": case "Continue": return false;
    }
  }
  return true;
}

/** Return statement address -> the one page that may provide its cursor. */
export function pagePlan(program: ProgramJson): Map<string, string> {
  if (program.kind !== "Query") return new Map();
  const bindings: Bindings = new Map();
  for (const [name, kind] of Object.entries(program.args)) {
    if (kind === "Cursor" || object(kind).Optional === "Cursor") bindings.set(name, { kind: "cursor", name });
  }
  const returns = new Map<string, Origin>();
  if (origins(program.body, program.name, bindings, returns)) returns.set("fallthrough", empty);
  const plan = new Map<string, string>();
  for (const [path, origin] of returns) {
    const site = resultPage(origin);
    if (site !== null) plan.set(path, site);
  }
  return plan;
}
