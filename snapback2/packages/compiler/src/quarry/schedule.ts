import { basename } from "node:path";
import type { Document, Expr, ProgramDecl, ScalarType, ScheduleDecl, TableCatalog } from "./ast";
import { QuarryError } from "./diagnostics";
import { validateScheduleExpressions } from "./program";

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — binding programs are built ahead; firing only evaluates certified IR over current row values.
export function prepareSchedules(documents: Document[], catalog: TableCatalog) {
  const operations = documents.flatMap(document => document.programs.map(program => ({
    document, program, name: `${basename(document.file, ".q")}.${program.name}`,
  })));
  const names = new Set<string>();
  const result: Array<{ name: string; trigger: ScheduleDecl["trigger"]; target: string; bindingName: string; site: string }> = [];
  for (const document of documents) for (const schedule of document.schedules) {
    const fail = (message: string, code: "E_SCHEDULE_TARGET" | "E_SCHEDULE_COLUMN" = "E_SCHEDULE_TARGET", rewrite?: string): never => {
      throw new QuarryError(schedule.site, message, code, rewrite ?? (code === "E_SCHEDULE_COLUMN"
        ? "declare the deadline column as time ?" : "target a declared mutation or job with matching row arguments; every targets take no arguments"), "schedule");
    };
    // The unique-name rewrite belongs to this path alone; every other E_SCHEDULE_TARGET names the target.
    if (names.has(schedule.name)) fail(`duplicate schedule ${schedule.name}`, "E_SCHEDULE_TARGET", "give each schedule a unique name");
    names.add(schedule.name);
    const row = "row" in schedule.trigger ? schedule.trigger.row : undefined;
    const table = row && catalog.get(row.table);
    if (row && (!table || table.columns.get(row.column)?.kind !== "time" || !table.columns.get(row.column)?.optional)) {
      fail(`schedule ${schedule.name} requires ${row.table}.${row.column} to be time ?`, "E_SCHEDULE_COLUMN");
    }
    const localName = `${basename(document.file, ".q")}.${schedule.target}`;
    const candidates = operations.filter(op => op.name === schedule.target || op.name === localName);
    const matches = candidates.length ? candidates : operations.filter(op => op.program.name === schedule.target);
    const target = matches.length === 1 ? matches[0]! : fail(`schedule target ${schedule.target} is not an unambiguous mutation or job`);
    if (target.program.kind === "query") fail(`schedule target ${schedule.target} is a query`);
    if ((!row && (schedule.args.length || target.program.args.length)) || schedule.args.length !== target.program.args.length) fail(`schedule target ${schedule.target} has incompatible arguments`);
    // The binding is pure row computation; no reads, writes, ambient identities, or allocation.
    // Only the row fields it names become its arguments, so asset columns never travel.
    const referenced = new Set<string>();
    const pure = (expr: Expr, field = false): boolean => {
      if (expr.kind === "literal") return true;
      if (expr.kind === "focal") return !!row && field;
      if (expr.kind === "member") {
        if (expr.base.kind === "focal") referenced.add(expr.name);
        return pure(expr.base, true);
      }
      if (expr.kind === "binary") return pure(expr.left) && pure(expr.right);
      if (expr.kind === "unary" || expr.kind === "assert") return pure(expr.value);
      if (expr.kind === "object") return expr.fields.every(field => !!field.value && pure(field.value));
      if (expr.kind === "call") return ["min", "max", "count"].includes(expr.name) && expr.args.every(arg => pure(arg));
      return false;
    };
    if (!schedule.args.every(arg => pure(arg)) || (schedule.predicate && !pure(schedule.predicate))) fail("schedule bindings are pure expressions over the row's fields");
    const site = schedule.site;
    const columns = table
      ? [...referenced].map((name) => {
        if (name === "id") return { name, type: { kind: "ref", table: row!.table, optional: false } as ScalarType, site };
        const type = table.columns.get(name) ?? fail(`schedule ${schedule.name} names unknown column ${row!.table}.${name}`);
        if (type.kind === "image" || type.kind === "video") fail(`schedule ${schedule.name} cannot pass asset column ${row!.table}.${name}`);
        return { name, type, site };
      })
      : [];
    const binding: ProgramDecl = {
      kind: "query", name: `_timerBinding_${schedule.name}`, site, focalTable: row?.table,
      args: columns,
      body: [{ kind: "return", site, value: { kind: "object", site, fields: [
        { name: "enabled", site, value: schedule.predicate ?? { kind: "literal", value: true, site } },
        { name: "args", site, value: { kind: "object", site, fields: target.program.args.map((arg, i) => ({ name: arg.name, value: schedule.args[i]!, site })) } },
      ] } }],
    };
    try { validateScheduleExpressions(binding, catalog, schedule.args, target.program.args.map(arg => arg.type), schedule.predicate); }
    catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    const carrier = basename(document.file) === "schema.q" ? target.document : document;
    if (carrier.programs.some(p => p.name === binding.name)) fail(`reserved binding name ${binding.name}`);
    carrier.programs.push(binding);
    result.push({ name: schedule.name, trigger: schedule.trigger, target: target.name,
      bindingName: `${basename(carrier.file, ".q")}.${binding.name}`, site: `${site.file}:${site.line}:${site.col}` });
  }
  return result;
}
