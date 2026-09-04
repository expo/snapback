import { exactByIdAbsence, exactVerdict } from "./authority";
import { canonicalSchemaJson } from "./certificate-identity";
import { EvalError } from "./errors";
import { sha256 } from "./hash";
import { Runner } from "./runner";
import {
  asString,
  canonicalValue,
  canonicalValues,
  clone,
  compareArrays,
  compareCodepoints,
  field,
  fieldOrNull,
  isVariant,
  kindOf,
  materializeOptionalFields,
  scopedRuleHash,
  totalCompare,
  validateInputs,
  validateWriteRow,
  valuesEqual,
} from "./value-runtime";
import type {
  ClosureReceipt,
  Context,
  Execution,
  LocalExecution,
  ReceiptRange,
  Trace,
  TraceRange,
  Value,
} from "./types";

export interface ClientStoreOptions {
  /** Tables whose held rows the twin may read regardless of their read rule (`retain delivered-history`). */
  readable?: Iterable<string>;
}

/** A drained uniform prefix: every row with these column equalities is held (LLP 1012 §6). */
interface DrainedPrefix {
  table: string;
  ruleHash: string;
  columns: string[];
  prefix: Value[];
}

export class ClientStore {
  private tables = new Map<string, Map<string, Value>>();
  private coverage: ClosureReceipt;
  private rangeDeletions = new Map<string, number>();
  private readonly readableTables: Set<string>;
  private drained?: DrainedPrefix[];

  constructor(
    private readonly schema: any,
    receipt: ClosureReceipt,
    private readonly options: ClientStoreOptions = {},
  ) {
    this.readableTables = new Set(options.readable ?? []);
    this.coverage = this.receiptForSchema(receipt);
    this.seedReceipt(receipt);
  }

  readable(table: string): boolean {
    return this.readableTables.has(table);
  }

  applyMutation(program: any, context: Context): LocalExecution {
    validateInputs(this.schema, program, context.args);
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — local prediction adopts the write set only as one atomic mutation.
    const staged = this.fork();
    const before = staged.coveredIndexKeys();
    const runner = new Runner(staged, this.schema, context, null);
    let execution: Execution;
    try {
      execution = runner.execute(program);
    } catch (error) {
      if (runner.coverageMisses().includes("missing-authority")) {
        return { state: "partial", partialSites: ["missing-authority"], execution: { result: "Null", trace: runner.trace, next: null, writes: [] } };
      }
      if (error instanceof EvalError) {
        error.trace = runner.trace;
        error.partialSites = this.uncoveredSites(runner.trace, runner.coverageMisses());
      }
      throw error;
    }
    const partialSites = runner.coverageMisses();
    // Coverage is judged on the state the run read, before its writes land.
    const uncoveredSites = this.uncoveredSites(execution.trace);
    if (partialSites.length > 0) {
      return { state: "partial", partialSites, execution, uncoveredSites, authorityMisses: runner.authorityMisses() };
    }
    const after = staged.coveredIndexKeys();
    for (let offset = 0; offset < before.length; offset += 1) {
      for (const [id, key] of before[offset]) {
        const next = after[offset].get(id);
        if (next === undefined || !valuesEqual(key, next)) {
          const site = staged.coverage.ranges[offset].site;
          staged.rangeDeletions.set(site, (staged.rangeDeletions.get(site) ?? 0) + 1);
        }
      }
    }
    this.tables = staged.tables;
    this.coverage = staged.coverage;
    this.rangeDeletions = staged.rangeDeletions;
    this.drained = undefined;
    return { state: "predicted", partialSites: [], execution, uncoveredSites };
  }

  reexecute(program: any, context: Context, certificate: any = null): LocalExecution {
    validateInputs(this.schema, program, context.args);
    const runner = new Runner(this, this.schema, context, certificate);
    let execution: Execution;
    try {
      execution = runner.execute(program);
    } catch (error) {
      // A refusal after an uncovered read is not the server's answer: the
      // caller reads `partialSites` off the error before believing the code.
      if (error instanceof EvalError) {
        error.trace = runner.trace;
        error.partialSites = this.uncoveredSites(runner.trace, runner.coverageMisses());
      }
      throw error;
    }
    const partialSites = this.uncoveredSites(execution.trace, runner.coverageMisses());
    if (partialSites.length > 0) execution.next = null;
    return {
      state: partialSites.length === 0 ? "fresh" : "partial",
      partialSites,
      execution,
    };
  }

  /** The sites a run read outside coverage: uncovered ranges, unheld absences, and the runner's own misses. */
  uncoveredSites(trace: Trace, misses: string[] = []): string[] {
    const partial = new Set(misses);
    for (const range of trace.ranges) {
      const covered = this.coverage.ranges.some(
        (coverage) => rangeCovered(coverage, range),
      ) || this.drainedPrefixCovers(range.table, range.index, range.prefix, range.rule_hash);
      if (!covered || (this.rangeDeletions.get(range.site) ?? 0) > 1)
        partial.add(range.site);
    }
    for (const absence of trace.absences) {
      const held =
        this.coverage.absences.some(
          ([table, index, key]) =>
            table === absence.table &&
            index === absence.index &&
            valuesEqual(key, absence.key),
        ) || this.lookup(absence.table, absence.index, absence.key) !== null;
      if (!held) partial.add(absence.site);
    }
    return Array.from(partial).sort(compareCodepoints);
  }

  rehydrate(receipt: ClosureReceipt): number {
    const before = this.allIds();
    this.tables = new Map();
    this.coverage = this.receiptForSchema(receipt);
    this.rangeDeletions = new Map();
    this.drained = undefined;
    this.seedReceipt(receipt);
    const after = this.allIds();
    let evicted = 0;
    for (const id of before) if (!after.has(id)) evicted += 1;
    return evicted;
  }

  rows(table: string): Value[] {
    return Array.from(this.tables.get(table)?.values() ?? []);
  }

  lookup(table: string, indexName: string, key: Value[]): Value | null {
    const index = this.index(table, indexName);
    if (key.length !== index.columns.length) {
      throw new EvalError(
        "E_TYPE",
        `point read ${table}.${indexName} supplied ${key.length} of ${index.columns.length} key columns`,
      );
    }
    key.forEach((value, offset) => {
      assertIndexableScalar(value, `point read ${table}.${indexName} key component ${offset + 1}`);
    });
    for (const row of this.rows(table)) {
      const values = index.columns.map((column: string) => fieldOrNull(row, column));
      if (valuesEqual(values, key)) return row;
    }
    return null;
  }

  scan(
    table: string,
    indexName: string,
    prefix: Value[],
    after: Value | null,
    before: Value | null,
    range: any | null,
    order: "Asc" | "Desc",
    limit: number,
  ): Value[] {
    const index = this.index(table, indexName);
    if (prefix.length > index.columns.length) {
      throw new EvalError("E_TYPE", `scan ${table}.${indexName} prefix has too many columns`);
    }
    prefix.forEach((value, offset) => {
      assertIndexableScalar(value, `scan ${table}.${indexName} prefix component ${offset + 1}`);
    });
    for (const [name, value] of Object.entries<Value | null | undefined>(range ?? {})) {
      if (value !== null && value !== undefined) {
        assertIndexableScalar(value, `scan ${table}.${indexName} range.${name}`);
      }
    }
    const rangeColumn = prefix.length;
    const remaining = index.columns.length - rangeColumn;
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — a cursor must
    // move a scan; a fully named index has no post-prefix position to compare.
    if (remaining === 0 && (after !== null || before !== null)) {
      throw new EvalError(
        "E_TYPE",
        `scan ${table}.${indexName} prefix names every index column, so a cursor has no position to compare; remove after/before or shorten the prefix`,
      );
    }
    const cursorTuple = (cursor: Value): Value[] => {
      let values: Value[];
      if (isVariant(cursor, "Array")) {
        if (cursor.Array.length !== remaining) {
          throw new EvalError("E_TYPE", `cursor supplied ${cursor.Array.length} of ${remaining} remaining index columns`);
        }
        values = cursor.Array;
      } else if (remaining === 1) {
        values = [cursor];
      } else {
        throw new EvalError("E_TYPE", `cursor for ${remaining} remaining index columns must be an array`);
      }
      values.forEach((value, offset) => {
        const column = index.columns[rangeColumn + offset]!;
        validateCursorComponent(this.schema, table, indexName, column, value);
      });
      return values;
    };
    const afterTuple = after === null ? null : cursorTuple(after);
    const beforeTuple = before === null ? null : cursorTuple(before);
    const selected = this.rows(table).filter((row) => {
      const values = index.columns.map((column: string) => fieldOrNull(row, column));
      if (!valuesEqual(values.slice(0, prefix.length), prefix)) return false;
      if (rangeColumn >= values.length) return true;
      const value = values[rangeColumn];
      const position = values.slice(rangeColumn);
      if (afterTuple !== null && compareArrays(position, afterTuple) * (order === "Asc" ? 1 : -1) <= 0) return false;
      if (beforeTuple !== null && compareArrays(position, beforeTuple) * (order === "Asc" ? 1 : -1) >= 0) return false;
      if (range?.gt !== null && range?.gt !== undefined && totalCompare(value, range.gt) <= 0)
        return false;
      if (range?.gte !== null && range?.gte !== undefined && totalCompare(value, range.gte) < 0)
        return false;
      if (range?.lt !== null && range?.lt !== undefined && totalCompare(value, range.lt) >= 0)
        return false;
      if (range?.lte !== null && range?.lte !== undefined && totalCompare(value, range.lte) > 0)
        return false;
      return true;
    });
    const direction = order === "Asc" ? 1 : -1;
    selected.sort((left, right) => {
      for (const column of index.columns) {
        const compared = totalCompare(fieldOrNull(left, column), fieldOrNull(right, column));
        if (compared !== 0) return compared * direction;
      }
      return (
        compareCodepoints(asString(field(left, "id")), asString(field(right, "id"))) *
        direction
      );
    });
    return selected.slice(0, limit);
  }

  put(table: string, row: Value): void {
    const normalized = materializeOptionalFields(this.schema, table, row);
    validateWriteRow(this.schema, table, normalized);
    for (const [indexName, index] of Object.entries<any>(
      this.schema.tables?.[table]?.indexes ?? {},
    )) {
      for (const column of index.columns) {
        assertIndexableScalar(
          fieldOrNull(normalized, column),
          `indexed column ${table}.${indexName}.${column}`,
        );
      }
    }
    const id = asString(field(normalized, "id"));
    let rows = this.tables.get(table);
    if (rows === undefined) {
      rows = new Map();
      this.tables.set(table, rows);
    }
    rows.set(id, normalized);
  }

  remove(table: string, id: string): Value | null {
    const rows = this.tables.get(table);
    const old = rows?.get(id) ?? null;
    rows?.delete(id);
    return old;
  }

  byId(table: string, id: string): Value | null {
    return this.tables.get(table)?.get(id) ?? null;
  }

  verdict(ruleHash: string, pinnedDigest: string, context: Context): boolean | null {
    return exactVerdict(this.coverage.verdicts, ruleHash, pinnedDigest, context.viewer, context.auth_epoch);
  }

  authorityAbsence(table: string, id: string): boolean { return exactByIdAbsence(this.coverage.absences, table, id, valuesEqual); }

  hasAbsence(table: string, index: string, key: Value[]): boolean {
    return this.coverage.absences.some(
      ([heldTable, heldIndex, heldKey]) =>
        heldTable === table && heldIndex === index && valuesEqual(heldKey, key),
    );
  }

  hasCompleteRange(table: string, index: string, prefix: Value[]): boolean {
    const readRule = this.schema.tables?.[table]?.rules?.read;
    if (readRule !== undefined
      && this.drainedPrefixCovers(table, index, prefix, scopedRuleHash(this.schema, readRule))) return true;
    return this.coverage.ranges.some(
      (range) =>
        range.table === table &&
        range.index === index &&
        valuesEqual(range.prefix, prefix) &&
        range.order === "Asc" &&
        range.after === null &&
        range.before === null &&
        range.gt === null &&
        range.gte === null &&
        range.lt === null &&
        range.lte === null &&
        range.stop === "Exhausted",
    );
  }

  // @ref LLP 1012#6-reads-offline — a certified-uniform prefix drained to
  // `next: null` is the viewer's whole partition for that prefix, so it covers
  // every named query over that prefix on any index of the same table: the
  // thread reads the log on another index than the drain and still replays.
  private drainedPrefixCovers(table: string, indexName: string, prefix: Value[], ruleHash: string): boolean {
    const columns: string[] | undefined = this.schema.tables?.[table]?.indexes?.[indexName]?.columns;
    if (!columns) return false;
    return this.drainedPrefixes().some((drained) =>
      drained.table === table
      && drained.ruleHash === ruleHash
      && drained.columns.every((column, at) => {
        const position = columns.indexOf(column);
        return position >= 0 && position < prefix.length && valuesEqual([prefix[position]!], [drained.prefix[at]!]);
      }));
  }

  /** The drained prefixes: for each (table, index, prefix, rule) a chain of held pages from `after: null` to `Exhausted`. */
  private drainedPrefixes(): DrainedPrefix[] {
    if (this.drained) return this.drained;
    const groups = new Map<string, ReceiptRange[]>();
    for (const range of this.coverage.ranges) {
      if (range.before !== null || range.gt !== null || range.gte !== null || range.lt !== null || range.lte !== null) continue;
      const key = [range.table, range.index, range.order, range.rule_hash, canonicalValues(range.prefix)].join("\0");
      let pages = groups.get(key);
      if (!pages) groups.set(key, pages = []);
      pages.push(range);
    }
    const drained: DrainedPrefix[] = [];
    for (const pages of groups.values()) {
      const first = pages.find((page) => page.after === null);
      if (!first) continue;
      const index = this.schema.tables?.[first.table]?.indexes?.[first.index];
      if (!index) continue;
      const suffixColumns: string[] = index.columns.slice(first.prefix.length);
      const byAfter = new Map<string, ReceiptRange>();
      for (const page of pages) if (page.after !== null) byAfter.set(canonicalValue(page.after), page);
      const seen = new Set<ReceiptRange>();
      let page = first;
      while (page.stop !== "Exhausted" && !seen.has(page)) {
        seen.add(page);
        const lastId = page.row_ids[page.row_ids.length - 1];
        const row = lastId === undefined ? null : this.byId(page.table, lastId);
        if (row === null) break;
        const suffix = suffixColumns.map((column) => fieldOrNull(row, column));
        const next = byAfter.get(canonicalValue({ Array: suffix }))
          ?? (suffix.length === 1 ? byAfter.get(canonicalValue(suffix[0]!)) : undefined);
        if (!next) break;
        page = next;
      }
      if (page.stop !== "Exhausted") continue;
      drained.push({
        table: first.table,
        ruleHash: first.rule_hash,
        columns: index.columns.slice(0, first.prefix.length),
        prefix: first.prefix,
      });
    }
    this.drained = drained;
    return drained;
  }

  private seedReceipt(receipt: ClosureReceipt): void {
    for (const row of receipt.rows) this.put(row.table, row.row);
  }

  private receiptForSchema(receipt: ClosureReceipt): ClosureReceipt {
    const coverage = clone(receipt);
    if (coverage.schema_hash !== sha256(canonicalSchemaJson(this.schema))) {
      // @ref LLP 1001#2-what-a-commit-records — authority-only absence
      // facts cannot cross a predecessor/successor schema boundary.
      coverage.absences = [];
    }
    return coverage;
  }

  private fork(): ClientStore {
    const fork = new ClientStore(this.schema, { rows: [], ranges: [], absences: [], verdicts: [] }, this.options);
    fork.tables = new Map(
      Array.from(this.tables, ([table, rows]) => [
        table,
        new Map(Array.from(rows, ([id, row]) => [id, clone(row)])),
      ]),
    );
    fork.coverage = clone(this.coverage);
    fork.rangeDeletions = new Map(this.rangeDeletions);
    return fork;
  }

  private coveredIndexKeys(): Array<Map<string, Value[]>> {
    return this.coverage.ranges.map((range) => {
      const retained = new Set(range.row_ids);
      if (range.halo !== null) retained.add(range.halo.id);
      const index = this.index(range.table, range.index);
      const keys = new Map<string, Value[]>();
      for (const row of this.rows(range.table)) {
        const id = asString(field(row, "id"));
        if (retained.has(id)) {
          keys.set(id, index.columns.map((column: string) => clone(fieldOrNull(row, column))));
        }
      }
      return keys;
    });
  }

  private allIds(): Set<string> {
    const ids = new Set<string>();
    for (const [table, rows] of this.tables) {
      for (const id of rows.keys()) ids.add(`${table}:${id}`);
    }
    return ids;
  }

  private index(table: string, indexName: string): any {
    const index = this.schema.tables?.[table]?.indexes?.[indexName];
    if (index === undefined) throw new EvalError("E_SCHEMA", `missing index ${table}.${indexName}`);
    return index;
  }
}


function nullableValueEqual(left: Value | null, right: Value | null): boolean {
  return left === null ? right === null : right !== null && valuesEqual([left], [right]);
}

function rangeCovered(coverage: ReceiptRange, range: TraceRange): boolean {
  return coverage.site === range.site
    && coverage.table === range.table
    && coverage.index === range.index
    && valuesEqual(coverage.prefix, range.prefix)
    && coverage.order === range.order
    && coverage.take === range.take
    && nullableValueEqual(coverage.after, range.after)
    && nullableValueEqual(coverage.before, range.before)
    && nullableValueEqual(coverage.gt, range.gt)
    && nullableValueEqual(coverage.gte, range.gte)
    && nullableValueEqual(coverage.lt, range.lt)
    && nullableValueEqual(coverage.lte, range.lte)
    && coverage.rule_hash === range.rule_hash;
}

function validateCursorComponent(
  schema: any,
  table: string,
  index: string,
  column: string,
  value: Value,
): void {
  assertIndexableScalar(value, `cursor component for ${table}.${index} column ${column}`);
  const actual = kindOf(value);
  // @ref LLP 1001#3-read-and-write-states-no-silent-states — Null is the
  // universal pre-first cursor sentinel, independent of stored nullability.
  if (actual === "Null") return;
  const descriptor = schema.tables?.[table]?.columns?.[column];
  const expected = cursorColumnKind(descriptor);
  const matches = expected === "scalar" || expected === actual;
  if (!matches) {
    throw new EvalError(
      "E_TYPE",
      `cursor component for ${table}.${index} column ${column} must be ${expected}, got ${actual.toLowerCase()}`,
    );
  }
}

function assertIndexableScalar(value: Value, what: string): void {
  const actual = kindOf(value);
  if (!["Null", "Bool", "Int", "String", "Id", "Bytes"].includes(actual)) {
    throw new EvalError("E_TYPE", `${actual.toLowerCase()} is not an indexable scalar (${what})`);
  }
}

function cursorColumnKind(descriptor: any): "Id" | "String" | "Int" | "Bool" | "Bytes" | "scalar" {
  if (descriptor?.Optional !== undefined) return cursorColumnKind(descriptor.Optional);
  if (descriptor === "Id" || descriptor === "Principal" || descriptor?.Ref !== undefined) return "Id";
  if (descriptor?.Text !== undefined || descriptor?.Enum !== undefined) return "String";
  if (["Int", "Time"].includes(descriptor) || descriptor?.Decimal !== undefined || descriptor?.Money !== undefined) return "Int";
  if (descriptor === "Bool") return "Bool";
  if (descriptor?.Bytes !== undefined) return "Bytes";
  return "scalar";
}
