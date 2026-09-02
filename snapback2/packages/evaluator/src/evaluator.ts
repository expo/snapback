import coreIrContract from "../../../crates/snapback2-core/ir-contract.json" with { type: "json" };
import { canonicalProgramJson, canonicalSchemaJson } from "./certificate-identity";
import { EvalError, requireRowIdentity } from "./errors";
import { sha256, utf8Length } from "./hash";
import { splitMentionTokens } from "./text";
import type {
  ActualResult,
  ClosureReceipt,
  Context,
  CorpusCase,
  CorpusExpected,
  Execution,
  HydrationResult,
  LocalExecution,
  ReceiptRange,
  Trace,
  TraceRange,
  Value,
} from "./types";

export { sha256 } from "./hash";
export type {
  ActualResult,
  ClosureReceipt,
  Context,
  CorpusCase,
  CorpusExpected,
  HydrationResult,
  PreludeStep,
  ReceiptRange,
  RowRecord,
  Value,
  Verdict,
} from "./types";

type Flow =
  | { kind: "next" }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "return"; value: Value };

const NEXT: Flow = { kind: "next" };
const I53_MAX = 9_007_199_254_740_991;
const I53_MIN = -I53_MAX;
export const CURRENT_VALUE_MODEL_VERSION = coreIrContract.valueModelVersion;

export class ClientStore {
  private tables = new Map<string, Map<string, Value>>();
  private coverage: ClosureReceipt;
  private rangeDeletions = new Map<string, number>();
  private taintedTables = new Set<string>();

  constructor(
    private readonly schema: any,
    receipt: ClosureReceipt,
  ) {
    this.coverage = clone(receipt);
    this.seedReceipt(receipt);
  }

  applyMutation(program: any, context: Context): LocalExecution {
    validateInputs(program, context.args);
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — local prediction adopts the write set only as one atomic mutation.
    const staged = this.fork();
    const before = staged.coveredIndexKeys();
    const runner = new Runner(staged, this.schema, context);
    const execution = runner.execute(program);
    const partialSites = runner.coverageMisses();
    if (partialSites.length > 0) {
      return { state: "partial", partialSites, execution };
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
    this.taintedTables = staged.taintedTables;
    return { state: "predicted", partialSites: [], execution };
  }

  reexecute(program: any, context: Context): LocalExecution {
    validateInputs(program, context.args);
    const runner = new Runner(this, this.schema, context);
    const execution = runner.execute(program);
    const partial = new Set(runner.coverageMisses());
    for (const range of execution.trace.ranges) {
      const covered = this.coverage.ranges.some(
        (coverage) => rangeCovered(coverage, range),
      );
      if (!covered || (this.rangeDeletions.get(range.site) ?? 0) > 1 || this.taintedTables.has(range.table))
        partial.add(range.site);
    }
    for (const point of execution.trace.points) {
      if (this.taintedTables.has(point.table)) partial.add(point.site);
    }
    for (const absence of execution.trace.absences) {
      const held =
        this.coverage.absences.some(
          ([table, index, key]) =>
            table === absence.table &&
            index === absence.index &&
            valuesEqual(key, absence.key),
        ) || this.lookup(absence.table, absence.index, absence.key) !== null;
      if (!held) partial.add(absence.site);
    }
    const partialSites = Array.from(partial).sort(compareCodepoints);
    return {
      state: partialSites.length === 0 ? "fresh" : "partial",
      partialSites,
      execution,
    };
  }

  rehydrate(receipt: ClosureReceipt): number {
    const before = this.allIds();
    this.tables = new Map();
    this.coverage = clone(receipt);
    this.rangeDeletions = new Map();
    this.taintedTables = new Set();
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
    const rangeColumn = prefix.length;
    const selected = this.rows(table).filter((row) => {
      const values = index.columns.map((column: string) => fieldOrNull(row, column));
      if (!valuesEqual(values.slice(0, prefix.length), prefix)) return false;
      if (rangeColumn >= values.length) return true;
      const value = values[rangeColumn];
      if (after !== null && totalCompare(value, after) <= 0) return false;
      if (before !== null && totalCompare(value, before) >= 0) return false;
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
    const verdict = this.coverage.verdicts.find(
      (candidate) =>
        candidate.rule_hash === ruleHash &&
        candidate.pinned_inputs_digest === pinnedDigest &&
        candidate.principal === context.viewer &&
        candidate.auth_epoch === context.auth_epoch,
    );
    return verdict?.result ?? null;
  }

  hasAbsence(table: string, index: string, key: Value[]): boolean {
    return this.coverage.absences.some(
      ([heldTable, heldIndex, heldKey]) =>
        heldTable === table && heldIndex === index && valuesEqual(heldKey, key),
    );
  }

  hasCompleteRange(table: string, index: string, prefix: Value[]): boolean {
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

  taintMaintainedTargets(source: string): void {
    for (const maintain of this.schema.maintains ?? []) {
      if (maintain.source === source) this.taintedTables.add(maintain.target);
    }
  }

  isTainted(table: string): boolean {
    return this.taintedTables.has(table);
  }

  private seedReceipt(receipt: ClosureReceipt): void {
    for (const row of receipt.rows) this.put(row.table, row.row);
  }

  private fork(): ClientStore {
    const fork = new ClientStore(this.schema, { rows: [], ranges: [], absences: [], verdicts: [] });
    fork.tables = new Map(
      Array.from(this.tables, ([table, rows]) => [
        table,
        new Map(Array.from(rows, ([id, row]) => [id, clone(row)])),
      ]),
    );
    fork.coverage = clone(this.coverage);
    fork.rangeDeletions = new Map(this.rangeDeletions);
    fork.taintedTables = new Set(this.taintedTables);
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

class Runner {
  private readonly env = new Map<string, Value>();
  private readonly consts = new Set<string>();
  private readonly context: Context;
  private readonly trace: Trace = { ranges: [], absences: [], points: [] };
  private readonly ruleMemo = new Map<string, boolean>();
  private readonly partial = new Set<string>();

  constructor(
    private readonly store: ClientStore,
    private readonly schema: any,
    context: Context,
  ) {
    this.context = clone(context);
    for (const [name, value] of Object.entries(context.args)) {
      this.env.set(name, clone(value));
    }
  }

  execute(program: any): Execution {
    const flow = this.statements(program.body);
    return {
      result: this.partial.size === 0 && flow.kind === "return" ? flow.value : "Null",
      trace: this.trace,
    };
  }

  coverageMisses(): string[] {
    return Array.from(this.partial).sort(compareCodepoints);
  }

  private statements(statements: any[]): Flow {
    for (const statement of statements) {
      const [kind, data] = variant(statement);
      let flow: Flow = NEXT;
      switch (kind) {
        case "Const":
          this.env.set(data.name, this.expr(data.value));
          this.consts.add(data.name);
          break;
        case "Let":
          this.env.set(data.name, this.expr(data.value));
          break;
        case "Assign":
          if (this.consts.has(data.name))
            throw new EvalError("E_INPUT", `cannot assign to const binding ${data.name}`);
          this.env.set(data.name, this.expr(data.value));
          break;
        case "Push": {
          const target = this.env.get(data.target);
          if (target === undefined || !isVariant(target, "Array"))
            throw new EvalError("E_TYPE", "push target is not an array");
          target.Array.push(this.expr(data.value));
          break;
        }
        case "If":
          flow = this.statements(
            asBool(this.expr(data.condition)) ? data.then_body : data.else_body,
          );
          break;
        case "For": {
          for (const value of this.domain(data.domain)) {
            this.env.set(data.binding, value);
            const bodyFlow = this.statements(data.body);
            if (bodyFlow.kind === "continue" || bodyFlow.kind === "next") continue;
            if (bodyFlow.kind === "break") break;
            flow = bodyFlow;
            break;
          }
          break;
        }
        case "Require":
          if (!asBool(this.expr(data.condition)))
            throw new EvalError("E_REQUIRE", "program requirement failed", data.code);
          break;
        case "Insert":
          this.insert(data.table, this.expr(data.row));
          break;
        case "Update":
          this.update(data.table, this.expr(data.key), this.expr(data.patch));
          break;
        case "Upsert": {
          const key = this.expr(data.key);
          const row = this.expr(data.row);
          requireRowIdentity(data.table, "upsert", asString(key), asString(field(row, "id")));
          if (this.store.byId(data.table, asString(key)) === null) this.insert(data.table, row);
          else this.replace(data.table, key, row);
          break;
        }
        case "Delete":
          this.delete(data.table, asString(this.expr(data.key)));
          break;
        // @ref LLP 1001#8-emit-and-the-outbox — the twin does not run effects, but it must consume the authoritative outbox id.
        case "Emit":
          this.expr(data.payload);
          if (this.context.new_ids.shift() === undefined)
            throw new EvalError("E_INPUT", "newId envelope exhausted");
          break;
        case "Return":
          flow = { kind: "return", value: this.expr(data) };
          break;
        case "Break":
          flow = { kind: "break" };
          break;
        case "Continue":
          flow = { kind: "continue" };
          break;
        default:
          throw new EvalError("E_OPAQUE", `unsupported statement ${kind}`);
      }
      if (flow.kind !== "next") return flow;
    }
    return NEXT;
  }

  private domain(domain: any): Value[] {
    const [kind, data] = variant(domain);
    switch (kind) {
      case "Page":
        return asArray(this.scan(data));
      case "LiteralRange": {
        const values: Value[] = [];
        for (let value = data.start; value < data.end_exclusive; value += 1) {
          values.push(int(value));
        }
        return values;
      }
      case "ArgList": {
        const values = asArray(this.requiredEnv(data.name));
        if (values.length > data.max) throw new EvalError("E_FANOUT", "argument list bound");
        return values;
      }
      case "DerivedArray": {
        const values = asArray(this.expr(data.value));
        if (values.length > data.max) throw new EvalError("E_FANOUT", "derived array bound");
        return values;
      }
      case "Recurse":
        return this.recurse(data);
      default:
        throw new EvalError("E_OPAQUE", `unsupported loop domain ${kind}`);
    }
  }

  private recurse(recurse: any): Value[] {
    const queue: [Value, number][] = [[this.expr(recurse.seed), 0]];
    const visited = new Set<string>();
    const rows: Value[] = [];
    while (queue.length > 0) {
      const [key, depth] = queue.shift()!;
      const canonical = canonicalValue(key);
      if (depth > recurse.depth || visited.has(canonical)) continue;
      visited.add(canonical);
      const row = this.get({
        site: recurse.site,
        table: recurse.table,
        index: recurse.index,
        key: [{ Literal: key }],
        provenance: recurse.provenance,
      });
      if (row === "Null") continue;
      const next = field(row, recurse.next_field);
      rows.push(row);
      if (next === "Null") continue;
      const successors = isVariant(next, "Array") ? next.Array : [next];
      if (successors.length > recurse.fanout)
        throw new EvalError("E_FANOUT", "recursive fanout exceeded");
      for (const successor of successors) queue.push([successor, depth + 1]);
    }
    return rows;
  }

  private expr(expression: any): Value {
    const [kind, data] = variant(expression);
    switch (kind) {
      case "Literal":
        return clone(data);
      case "Variable":
        return clone(this.requiredEnv(data));
      case "Input":
        return this.input(data);
      case "Field":
        return clone(field(this.expr(data.base), data.name));
      case "Array":
        return { Array: data.map((value: any) => this.expr(value)) };
      case "Object": {
        const row: Record<string, Value> = Object.create(null);
        for (const key of Object.keys(data).sort(compareCodepoints)) row[key] = this.expr(data[key]);
        return { Row: row };
      }
      case "Binary":
        return this.binary(data);
      case "Unary": {
        const value = this.expr(data.value);
        if (data.op === "Not") return { Bool: !asBool(value) };
        if (data.op === "Neg") return int(-asInt(value));
        throw new EvalError("E_OPAQUE", `unsupported unary ${data.op}`);
      }
      case "Builtin": {
        const builtinKind = variant(data.builtin)[0];
        const expected = builtinArity(builtinKind);
        if (data.args.length !== expected) {
          throw new EvalError("E_INPUT", `${builtinKind} requires ${expected} arguments, received ${data.args.length}`);
        }
        return this.builtin(data.builtin, data.args.map((value: any) => this.expr(value)));
      }
      case "Get":
        return this.get(data);
      case "Exists":
        return { Bool: this.get(data) !== "Null" };
      case "Scan":
        return this.scan(data);
      default:
        throw new EvalError("E_OPAQUE", `unsupported expression ${kind}`);
    }
  }

  private input(input: string): Value {
    switch (input) {
      case "Viewer":
        return { Id: this.context.viewer };
      case "Now":
        if (this.context.now === null) throw new EvalError("E_INPUT", "now was not pinned");
        return int(this.context.now);
      case "NewId": {
        const next = this.context.new_ids.shift();
        if (next === undefined) throw new EvalError("E_INPUT", "newId envelope exhausted");
        return { Id: next };
      }
      case "ReadTime":
        if (this.context.read_time === null)
          throw new EvalError("E_INPUT", "readTime was not pinned");
        return int(this.context.read_time);
      default:
        throw new EvalError("E_INPUT", `unknown modeled input ${input}`);
    }
  }

  private binary(data: any): Value {
    const left = this.expr(data.left);
    if (data.op === "And" && !asBool(left)) return { Bool: false };
    if (data.op === "Or" && asBool(left)) return { Bool: true };
    const right = this.expr(data.right);
    switch (data.op) {
      case "Eq":
        return { Bool: canonicalValue(left) === canonicalValue(right) };
      case "Ne":
        return { Bool: canonicalValue(left) !== canonicalValue(right) };
      case "SameValueZero":
        return { Bool: sameValueZero(left, right) };
      case "Lt":
        return { Bool: totalCompare(left, right) < 0 };
      case "Lte":
        return { Bool: totalCompare(left, right) <= 0 };
      case "Gt":
        return { Bool: totalCompare(left, right) > 0 };
      case "Gte":
        return { Bool: totalCompare(left, right) >= 0 };
      case "Add":
        return int(asInt(left) + asInt(right));
      case "Sub":
        return int(asInt(left) - asInt(right));
      case "Mul":
        return int(asInt(left) * asInt(right));
      case "And":
        return { Bool: asBool(left) && asBool(right) };
      case "Or":
        return { Bool: asBool(left) || asBool(right) };
      default:
        throw new EvalError("E_OPAQUE", `unsupported binary ${data.op}`);
    }
  }

  private builtin(builtin: any, args: Value[]): Value {
    const [kind, data] = variant(builtin);
    switch (kind) {
      case "Len": {
        const value = args[0];
        if (isVariant(value, "String")) return int(Array.from(value.String).length);
        if (isVariant(value, "Id")) return int(Array.from(value.Id).length);
        if (isVariant(value, "Array")) return int(value.Array.length);
        if (isVariant(value, "Row")) return int(Object.keys(value.Row).length);
        if (isVariant(value, "Map")) return int(Object.keys(value.Map).length);
        throw new EvalError("E_TYPE", "len expects string, array, or map");
      }
      case "Slice": {
        const start = Math.max(0, asInt(args[1]));
        const end = Math.max(0, asInt(args[2]));
        if (isVariant(args[0], "Array")) return { Array: args[0].Array.slice(start, end) };
        if (isVariant(args[0], "String"))
          return { String: Array.from(args[0].String).slice(start, end).join("") };
        throw new EvalError("E_TYPE", "slice expects array or string");
      }
      case "Concat": {
        const [left, right] = args;
        if (isVariant(left, "String") || isVariant(right, "String"))
          return { String: valueText(left) + valueText(right) };
        if (isVariant(left, "Id") && isVariant(right, "Id"))
          return { Id: canonicalValues([left, right]) };
        if (isVariant(left, "Array") && isVariant(right, "Array"))
          return { Array: left.Array.concat(right.Array) };
        throw new EvalError("E_TYPE", "concat operands differ");
      }
      case "Min":
        return totalCompare(args[0], args[1]) <= 0 ? args[0] : args[1];
      case "Max":
        return totalCompare(args[0], args[1]) >= 0 ? args[0] : args[1];
      case "Divmod": {
        const numerator = asInt(args[0]);
        const denominator = asInt(args[1]);
        if (denominator === 0) throw new EvalError("E_DIV_ZERO", "division by zero");
        let quotient = Math.trunc(numerator / denominator);
        let remainder = numerator - quotient * denominator;
        if (remainder < 0) {
          if (denominator > 0) {
            quotient -= 1;
            remainder += denominator;
          } else {
            quotient += 1;
            remainder -= denominator;
          }
        }
        return rowValue({
          quotient: int(quotient),
          remainder: int(remainder),
          sink: { String: data.remainder_sink },
        });
      }
      case "Sort": {
        const values = asArray(args[0]).slice();
        for (const value of values) {
          for (const key of data.keys) field(value, key.field);
        }
        return {
          Array: stableSort(values, (left, right) => {
            for (const key of data.keys) {
              let compared = totalCompare(field(left, key.field), field(right, key.field));
              if (key.order === "Desc") compared = -compared;
              if (compared !== 0) return compared;
            }
            return 0;
          }),
        };
      }
      case "MentionTokens": {
        const seen = new Set<string>();
        const mentions: Value[] = [];
        for (const token of splitMentionTokens(asString(args[0]))) {
          if (!token.startsWith("@")) continue;
          const characters = Array.from(token.slice(1));
          while (characters.length > 0 && !isWordCharacter(characters[0])) characters.shift();
          while (
            characters.length > 0 &&
            !isWordCharacter(characters[characters.length - 1])
          )
            characters.pop();
          const mention = characters.join("");
          if (mention.length > 0 && !seen.has(mention)) {
            seen.add(mention);
            mentions.push({ String: mention });
          }
        }
        return { Array: mentions };
      }
      case "DeterministicShare": {
        const amount = asInt(args[0]);
        const recipients = stableSort(asArray(args[1]).slice(), totalCompare);
        if (recipients.length === 0) throw new EvalError("E_DIV_ZERO", "no recipients");
        if (new Set(recipients.map(canonicalValue)).size !== recipients.length)
          throw new EvalError("E_INPUT", "share recipients must be unique");
        const recipient = args[2];
        const position = recipients.findIndex(
          (candidate) => canonicalValue(candidate) === canonicalValue(recipient),
        );
        if (position < 0) throw new EvalError("E_INPUT", "recipient missing from shares");
        const base = Math.floor(amount / recipients.length);
        const remainder = amount - base * recipients.length;
        return int(base + (position < remainder ? 1 : 0));
      }
      case "Count":
      case "CountCapped":
        return int(asArray(args[0]).length);
      case "Sum": {
        let sum = 0;
        for (const value of asArray(args[0])) sum = safeNumber(sum + asInt(value));
        return int(sum);
      }
      default:
        throw new EvalError("E_OPAQUE", `unsupported builtin ${kind}`);
    }
  }

  private get(read: any): Value {
    const key = read.key.map((value: any) => this.expr(value));
    const found = this.store.lookup(read.table, read.index, key);
    this.trace.points.push({ site: read.site, table: read.table });
    if (found === null) {
      this.trace.absences.push({
        site: read.site,
        table: read.table,
        index: read.index,
        key,
      });
      return "Null";
    }
    return this.checkRule(read.table, "read", found) ? clone(found) : "Null";
  }

  private scan(scan: any): Value {
    const prefix = scan.prefix.map((value: any) => this.expr(value));
    const after = scan.after === null ? null : this.expr(scan.after);
    const before = scan.before === null ? null : this.expr(scan.before);
    const evaluatedRange = scan.range === null ? null : this.evaluateRange(scan.range);
    const [boundKind, boundData] = variant(scan.take);
    const take =
      boundKind === "Literal"
        ? boundData
        : asInt(this.context.args[boundData.name] ?? this.requiredEnv(boundData.name));
    if (!Number.isInteger(take) || take < 0 || (boundKind === "Arg" && take > boundData.max))
      throw new EvalError("E_FANOUT", "scan take exceeded");
    const examined = this.store.scan(
      scan.table,
      scan.index,
      prefix,
      after,
      before,
      evaluatedRange,
      scan.order,
      take + 2,
    );
    const stop = examined.length > take ? "limit" : "exhausted";
    const visible = examined.filter((row) => this.checkRule(scan.table, "read", row));
    this.trace.ranges.push({
      site: scan.site,
      table: scan.table,
      index: scan.index,
      prefix,
      order: scan.order,
      take,
      after,
      before,
      gt: evaluatedRange?.gt ?? null,
      gte: evaluatedRange?.gte ?? null,
      lt: evaluatedRange?.lt ?? null,
      lte: evaluatedRange?.lte ?? null,
      rule_hash: scopedRuleHash(this.schema, this.schema.tables[scan.table].rules.read),
      stop,
    });
    return { Array: visible.slice(0, take).map(clone) };
  }

  private evaluateRange(range: any): any {
    return {
      gt: range.gt === null ? null : this.expr(range.gt),
      gte: range.gte === null ? null : this.expr(range.gte),
      lt: range.lt === null ? null : this.expr(range.lt),
      lte: range.lte === null ? null : this.expr(range.lte),
    };
  }

  private insert(table: string, row: Value): void {
    row = materializeOptionalFields(this.schema, table, row);
    validateWriteRow(this.schema, table, row);
    if (!this.checkRule(table, "insert", row)) throw new EvalError("E_RULE", `${table} insert`);
    this.checkConstraints(table, null, row, "insert");
    if (this.store.byId(table, asString(field(row, "id"))) !== null)
      throw new EvalError("E_CONSTRAINT", `duplicate id on ${table}`);
    this.store.put(table, row);
    this.maintain(table, null, row);
  }

  private update(table: string, key: Value, patch: Value): void {
    const old = this.store.byId(table, asString(key));
    if (old === null) throw new EvalError("E_INPUT", `missing ${table} row`);
    const object = { ...asObject(old), ...asObject(patch) };
    this.replace(table, key, rowValue(object));
  }

  private replace(table: string, key: Value, row: Value): void {
    const old = this.store.byId(table, asString(key));
    if (old === null) throw new EvalError("E_INPUT", `missing ${table} row`);
    requireRowIdentity(table, "replacement", asString(key), asString(field(row, "id")));
    row = materializeOptionalFields(this.schema, table, row);
    validateWriteRow(this.schema, table, row);
    if (!this.checkRule(table, "update", old) || !this.checkRule(table, "update", row))
      throw new EvalError("E_RULE", `${table} update`);
    this.checkConstraints(table, old, row, "update");
    this.store.put(table, row);
    this.maintain(table, old, row);
  }

  private delete(table: string, id: string): void {
    const old = this.store.byId(table, id);
    if (old === null) {
      this.store.taintMaintainedTargets(table);
      return;
    }
    if (!this.checkRule(table, "delete", old)) throw new EvalError("E_RULE", `${table} delete`);
    this.checkConstraints(table, old, old, "delete");
    this.store.remove(table, id);
    this.maintain(table, old, null);
  }

  private maintain(source: string, old: Value | null, next: Value | null): void {
    for (const maintain of this.schema.maintains ?? []) {
      if (maintain.source !== source) continue;
      if (old !== null) this.applyAggregate(maintain, old, -1);
      if (next !== null) this.applyAggregate(maintain, next, 1);
    }
  }

  private applyAggregate(maintain: any, source: Value, direction: number): void {
    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — maintained targets are engine-owned but still validated.
    source = materializeOptionalFields(this.schema, maintain.source, source);
    const group = maintain.by.map((name: string) => clone(field(source, name)));
    const idValue = canonicalValues(group);
    const [kind, data] = variant(maintain.kind);
    const delta =
      kind === "Count" ? direction : safeNumber(direction * asInt(field(source, data.of)));
    const existing = this.store.byId(maintain.target, idValue);
    if (existing === null) {
      this.partial.add(`${maintain.target}.byId`);
      return;
    }
    const oldValue = existing === null ? 0 : asInt(field(existing, "value"));
    const object: Record<string, Value> = Object.assign(Object.create(null), {
      id: { Id: idValue },
      value: int(oldValue + delta),
    });
    maintain.by.forEach((name: string, index: number) => {
      object[name] = group[index];
    });
    const row = materializeOptionalFields(this.schema, maintain.target, rowValue(object));
    const effect = existing === null ? "insert" : "update";
    validateWriteRow(this.schema, maintain.target, row);
    this.checkConstraints(maintain.target, existing, row, effect);
    this.store.put(maintain.target, row);
  }

  private checkConstraints(
    tableName: string,
    old: Value | null,
    row: Value,
    effect: "insert" | "update" | "delete",
  ): void {
    const table = this.schema.tables[tableName];
    for (const constraint of table.constraints ?? []) {
      const [kind, data] = variant(constraint);
      if (kind === "AppendOnly" && effect !== "insert")
        throw new EvalError("E_CONSTRAINT", `${tableName} is appendOnly`);
      if (
        kind === "Immutable" &&
        effect === "update" &&
        data.fields.some(
          (name: string) => canonicalValue(field(old!, name)) !== canonicalValue(field(row, name)),
        )
      )
        throw new EvalError("E_CONSTRAINT", `${tableName} immutable fields changed`);
      if (kind === "Unique") this.checkUnique(tableName, data.index, old, row);
      if (kind === "Cap") {
        const entersGroup =
          effect === "insert" ||
          (effect === "update" && data.by.some((name: string) =>
            canonicalValue(field(old!, name)) !== canonicalValue(field(row, name))));
        if (!entersGroup) continue;
        const entry = Object.entries<any>(table.indexes).find(([, index]) =>
          startsWith(index.columns, data.by),
        );
        if (entry === undefined) throw new EvalError("E_SCHEMA", "cap index missing");
        const prefix = data.by.map((name: string) => field(row, name));
        const existing = this.store.scan(
          tableName,
          entry[0],
          prefix,
          null,
          null,
          null,
          "Asc",
          data.max,
        );
        if (existing.length >= data.max)
          throw new EvalError("E_CONSTRAINT", `${tableName} cap reached`);
        if (!this.store.hasCompleteRange(tableName, entry[0], prefix)) {
          this.partial.add(`${tableName}.${entry[0]}`);
        }
      }
    }
    for (const [indexName, index] of Object.entries<any>(table.indexes)) {
      if (index.unique) this.checkUnique(tableName, indexName, old, row);
    }
  }

  private checkUnique(table: string, indexName: string, old: Value | null, row: Value): void {
    const index = this.schema.tables[table].indexes[indexName];
    const key = index.columns.map((name: string) => fieldOrNull(row, name));
    const found = this.store.lookup(table, indexName, key);
    if (
      found !== null &&
      (old === null || asString(field(found, "id")) !== asString(field(old, "id")))
    )
      throw new EvalError("E_CONSTRAINT", `sealed unique conflict on ${table}.${indexName}`);
    if (
      indexName !== "byId" &&
      found === null &&
      !this.store.hasAbsence(table, indexName, key) &&
      !this.store.hasCompleteRange(table, indexName, key)
    ) {
      this.partial.add(`${table}.${indexName}`);
    }
  }

  private checkRule(
    table: string,
    effect: "read" | "insert" | "update" | "delete",
    row: Value,
  ): boolean {
    const rule = this.schema.tables[table].rules[effect];
    return this.evaluateRule(rule, scopedRuleHash(this.schema, rule), row);
  }

  private evaluateRule(rule: any, ruleHash: string, row: Value): boolean {
    const [kind, data] = variant(rule);
    switch (kind) {
      case "Public":
      case "Allow":
        return true;
      case "Deny":
        return false;
      case "Eq":
        return canonicalValue(this.ruleTerm(data[0], row)) === canonicalValue(this.ruleTerm(data[1], row));
      case "Ne":
        return canonicalValue(this.ruleTerm(data[0], row)) !== canonicalValue(this.ruleTerm(data[1], row));
      case "And":
        return data.every((child: any) => this.evaluateRule(child, ruleHash, row));
      case "Or":
        return data.some((child: any) => this.evaluateRule(child, ruleHash, row));
      case "Not":
        return !this.evaluateRule(data, ruleHash, row);
      case "Exists": {
        // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — absence and authorization are authority-only.
        const key = data.key.map((term: any) => this.ruleTerm(term, row));
        const pinnedDigest = sha256(JSON.stringify([data.table, data.index, key]));
        const memoKey = `${ruleHash}:${pinnedDigest}`;
        const memoized = this.ruleMemo.get(memoKey);
        if (memoized !== undefined) return memoized;
        // Hidden probes arrive as scoped verdicts; readable probes arrive as
        // rows or absences. The server derives that choice from the target
        // table's read policy, so the client has no author-controlled flag.
        const verdict = this.store.verdict(ruleHash, pinnedDigest, this.context);
        if (verdict !== null) {
          this.ruleMemo.set(memoKey, verdict);
          return verdict;
        }
        const found = this.store.lookup(data.table, data.index, key);
        if (found === null && !this.store.hasAbsence(data.table, data.index, key)) {
          this.partial.add(`${data.table}.${data.index}`);
          this.ruleMemo.set(memoKey, false);
          return false;
        }
        const result = found !== null;
        this.ruleMemo.set(memoKey, result);
        return result;
      }
      default:
        throw new EvalError("E_OPAQUE", `unsupported rule ${kind}`);
    }
  }

  private ruleTerm(term: any, row: Value): Value {
    const [kind, data] = variant(term);
    if (kind === "Field") return clone(field(row, data));
    if (kind === "Viewer") return { Id: this.context.viewer };
    if (kind === "Literal") return clone(data);
    throw new EvalError("E_OPAQUE", `unsupported rule term ${kind}`);
  }

  private requiredEnv(name: string): Value {
    const value = this.env.get(name);
    if (value === undefined) throw new EvalError("E_INPUT", `unknown variable ${name}`);
    return value;
  }
}

export function evaluateCase(testCase: CorpusCase): ActualResult {
  if (testCase.certificate?.value_model_version !== CURRENT_VALUE_MODEL_VERSION) {
    throw new EvalError(
      "E_TRACE_SUBSET",
      `value model version ${String(testCase.certificate?.value_model_version)} != current ${CURRENT_VALUE_MODEL_VERSION}`,
    );
  }
  if (testCase.certificate?.plan_hash !== sha256(canonicalProgramJson(testCase.program))) {
    throw new EvalError("E_TRACE_SUBSET", "plan hash mismatch");
  }
  if (testCase.certificate?.schema_hash !== sha256(canonicalSchemaJson(testCase.schema))) {
    throw new EvalError("E_TRACE_SUBSET", "schema hash mismatch");
  }
  const store = new ClientStore(testCase.schema, testCase.receipt);
  for (const step of testCase.prelude) {
    const prelude = store.applyMutation(step.program, step.context);
    if (prelude.state !== step.expectedState)
      throw new EvalError("E_CORPUS", `prelude state ${prelude.state} != ${step.expectedState}`);
  }
  const evictedRows =
    testCase.replacementReceipt === null ? null : store.rehydrate(testCase.replacementReceipt);
  try {
    const local =
      testCase.program.kind === "Mutation"
        ? store.applyMutation(testCase.program, testCase.context)
        : store.reexecute(testCase.program, testCase.context);
    const canonicalResult = canonicalValue(local.execution.result);
    return {
      localResult: local.execution.result,
      errorCode: null,
      localState: local.state,
      partialSites: local.partialSites,
      canonicalResult,
      digest: sha256(canonicalResult),
      rangeStops: rangeStops(local.execution.trace.ranges),
      evictedRows,
    };
  } catch (error) {
    const internalCode = error instanceof EvalError ? error.code : "E_UNKNOWN";
    const code = internalCode;
    const authoredCode = error instanceof EvalError ? error.authoredCode : null;
    const typedState =
      code === "E_REQUIRE"
        ? testCase.program.kind === "Mutation"
          ? "rejected"
          : "denied"
        : "refused";
    const publicCode = authoredCode ?? code;
    if (typedState !== "refused") {
      const canonicalResult = canonicalValue("Null");
      return {
        localResult: "Null",
        errorCode: publicCode,
        localState: typedState,
        partialSites: [],
        canonicalResult,
        digest: sha256(canonicalResult),
        rangeStops: {},
        evictedRows,
      };
    }
    const canonicalResult = JSON.stringify({ Error: code });
    return {
      localResult: null,
      errorCode: publicCode,
      localState: "refused",
      partialSites: [],
      canonicalResult,
      digest: sha256(canonicalResult),
      rangeStops: {},
      evictedRows,
    };
  }
}

export function hydrateCase(testCase: CorpusCase): HydrationResult {
  const actual = evaluateCase(testCase);
  const differences = compareExpected(actual, testCase.expected);
  if (differences.length > 0) {
    return {
      planState: "replay-mismatch",
      servedResult: clone(testCase.expected.localResult),
      actual,
      diagnostic: `hydration replay mismatch for ${testCase.name}: ${differences.join("; ")}`,
    };
  }
  return {
    planState: "ready",
    servedResult: clone(actual.localResult),
    actual,
    diagnostic: null,
  };
}

export function compareExpected(actual: ActualResult, expected: CorpusExpected): string[] {
  const differences: string[] = [];
  for (const key of [
    "canonicalResult",
    "digest",
    "errorCode",
    "localState",
    "evictedRows",
  ] as const) {
    if (actual[key] !== expected[key])
      differences.push(`${key}: ${String(actual[key])} != ${String(expected[key])}`);
  }
  if (JSON.stringify(actual.partialSites) !== JSON.stringify(expected.partialSites))
    differences.push(
      `partialSites: ${JSON.stringify(actual.partialSites)} != ${JSON.stringify(expected.partialSites)}`,
    );
  if (JSON.stringify(actual.rangeStops) !== JSON.stringify(expected.rangeStops))
    differences.push(
      `rangeStops: ${JSON.stringify(actual.rangeStops)} != ${JSON.stringify(expected.rangeStops)}`,
    );
  return differences;
}

export function canonicalValue(value: Value): string {
  if (value === "Null") return '"Null"';
  const kind = kindOf(value);
  const data = (value as any)[kind];
  if (kind === "Bool" || kind === "Int") return `{"${kind}":${JSON.stringify(data)}}`;
  if (kind === "String" || kind === "Id") return `{"${kind}":${JSON.stringify(data)}}`;
  if (kind === "Bytes") {
    if (!canonicalBytes(data)) throw new EvalError("E_INPUT", "Bytes is not canonical lowercase base16");
    return `{"Bytes":${JSON.stringify(data)}}`;
  }
  if (kind === "Array") return `{"Array":${canonicalValues(data)}}`;
  const entries = Object.keys(data)
    .sort(compareCodepoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(data[key])}`)
    .join(",");
  return `{"${kind}":{${entries}}}`;
}

function canonicalValues(values: Value[]): string {
  return `[${values.map(canonicalValue).join(",")}]`;
}

function rangeStops(ranges: TraceRange[]): Record<string, string[]> {
  const result: Record<string, string[]> = Object.create(null);
  for (const range of ranges) (result[range.site] ??= []).push(range.stop);
  return sortObject(result);
}

function materializeOptionalFields(schema: any, tableName: string, value: Value): Value {
  if (!isVariant(value, "Row")) return clone(value);
  const entries = { ...value.Row };
  for (const [name, descriptor] of Object.entries<any>(
    schema.tables?.[tableName]?.columns ?? {},
  )) {
    if (descriptor?.Optional !== undefined && !hasOwn(entries, name)) {
      entries[name] = "Null";
    }
  }
  return rowValue(entries);
}

function rowValue(entries: Record<string, Value>): Value {
  const sorted: Record<string, Value> = Object.create(null);
  for (const key of Object.keys(entries).sort(compareCodepoints)) sorted[key] = clone(entries[key]);
  return { Row: sorted };
}

function field(value: Value, name: string): Value {
  const object = asObject(value);
  if (!hasOwn(object, name)) throw new EvalError("E_FIELD", `missing field ${name}`);
  return object[name];
}

function fieldOrNull(value: Value, name: string): Value {
  const object = asObject(value);
  return hasOwn(object, name) ? object[name] : "Null";
}

function asObject(value: Value): Record<string, Value> {
  if (isVariant(value, "Row")) return value.Row;
  if (isVariant(value, "Map")) return value.Map;
  throw new EvalError("E_TYPE", "expected row or map");
}

function asArray(value: Value): Value[] {
  if (!isVariant(value, "Array")) throw new EvalError("E_TYPE", "expected array");
  return value.Array;
}

function asString(value: Value): string {
  if (isVariant(value, "String")) return value.String;
  if (isVariant(value, "Id")) return value.Id;
  throw new EvalError("E_TYPE", "expected string or id");
}

function asInt(value: Value): number {
  if (!isVariant(value, "Int")) throw new EvalError("E_TYPE", "expected int");
  return value.Int;
}

function asBool(value: Value): boolean {
  if (!isVariant(value, "Bool")) throw new EvalError("E_TYPE", "expected bool");
  return value.Bool;
}

function int(value: number): Value {
  return { Int: safeNumber(value) };
}

function safeNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < I53_MIN || value > I53_MAX)
    throw new EvalError("E_OVERFLOW", `${value} is outside the i53 value model`);
  return value;
}

function totalCompare(left: Value, right: Value): number {
  const order = ["Null", "Bool", "Int", "String", "Id", "Bytes", "Row", "Array", "Map"];
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);
  const tag = order.indexOf(leftKind) - order.indexOf(rightKind);
  if (tag !== 0) return Math.sign(tag);
  if (leftKind === "Null") return 0;
  const leftData = (left as any)[leftKind];
  const rightData = (right as any)[rightKind];
  if (leftKind === "Bool" || leftKind === "Int") return comparePrimitive(leftData, rightData);
  if (leftKind === "String" || leftKind === "Id") return compareCodepoints(leftData, rightData);
  if (leftKind === "Bytes") {
    if (!canonicalBytes(leftData) || !canonicalBytes(rightData))
      throw new EvalError("E_INPUT", "Bytes is not canonical lowercase base16");
    return compareCodepoints(leftData, rightData);
  }
  if (leftKind === "Array") return compareArrays(leftData, rightData);
  const leftEntries = Object.keys(leftData).sort(compareCodepoints);
  const rightEntries = Object.keys(rightData).sort(compareCodepoints);
  const length = comparePrimitive(leftEntries.length, rightEntries.length);
  if (length !== 0) return length;
  for (let index = 0; index < leftEntries.length; index += 1) {
    const key = compareCodepoints(leftEntries[index], rightEntries[index]);
    if (key !== 0) return key;
    const value = totalCompare(leftData[leftEntries[index]], rightData[rightEntries[index]]);
    if (value !== 0) return value;
  }
  return 0;
}

function compareArrays(left: Value[], right: Value[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const compared = totalCompare(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return comparePrimitive(left.length, right.length);
}

function compareCodepoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const compared = comparePrimitive(leftPoints[index], rightPoints[index]);
    if (compared !== 0) return compared;
  }
  return comparePrimitive(leftPoints.length, rightPoints.length);
}

function comparePrimitive(left: number | boolean, right: number | boolean): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableSort<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  if (values.length <= 1) return values;
  const middle = Math.floor(values.length / 2);
  const left = stableSort(values.slice(0, middle), compare);
  const right = stableSort(values.slice(middle), compare);
  const result: T[] = [];
  while (left.length > 0 && right.length > 0) {
    result.push(compare(left[0], right[0]) <= 0 ? left.shift()! : right.shift()!);
  }
  return result.concat(left, right);
}

function variant(value: any): [string, any] {
  if (typeof value === "string") return [value, null];
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new EvalError("E_CORPUS", "invalid externally tagged variant");
  return [keys[0], value[keys[0]]];
}

export function scopedRuleHash(schema: any, rule: any): string {
  return sha256(JSON.stringify([sha256(canonicalSchemaJson(schema)), rule]));
}

function kindOf(value: Value): string {
  if (value === "Null") return "Null";
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new EvalError("E_INPUT", "invalid externally tagged value");
  return keys[0];
}

function isVariant<K extends Exclude<ReturnType<typeof kindOf>, "Null">>(
  value: Value,
  kind: K,
): value is Extract<Value, Record<K, unknown>> {
  return value !== "Null" && kindOf(value) === kind;
}

function valuesEqual(left: Value[], right: Value[]): boolean {
  return canonicalValues(left) === canonicalValues(right);
}

function sameValueZero(left: Value, right: Value): boolean {
  // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Keep the client twin on the compiler's primitive collection identity contract.
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);
  if (["Bytes", "Row", "Array", "Map"].includes(leftKind)) {
    throw new EvalError("E_TYPE", `SameValueZero expects primitive operands, got ${leftKind}`);
  }
  if (["Bytes", "Row", "Array", "Map"].includes(rightKind)) {
    throw new EvalError("E_TYPE", `SameValueZero expects primitive operands, got ${rightKind}`);
  }
  if ((leftKind === "String" || leftKind === "Id") && (rightKind === "String" || rightKind === "Id")) {
    const leftText = isVariant(left, "String") ? left.String : (left as { Id: string }).Id;
    const rightText = isVariant(right, "String") ? right.String : (right as { Id: string }).Id;
    return leftText === rightText;
  }
  return canonicalValue(left) === canonicalValue(right);
}

function startsWith<T>(values: T[], prefix: T[]): boolean {
  return prefix.every((value, index) => values[index] === value);
}

function validateWriteRow(schema: any, tableName: string, row: Value): void {
  const columns = schema.tables?.[tableName]?.columns;
  if (columns === undefined) throw new EvalError("E_SCHEMA", `missing table ${tableName}`);
  const object = asObject(row);
  if (!hasOwn(object, "id")) throw new EvalError("E_SCHEMA", `${tableName} row lacks id`);
  const unknown = Object.keys(object).find((name) => !hasOwn(columns, name));
  if (unknown !== undefined)
    throw new EvalError("E_INPUT", `${tableName} row contains undeclared field ${unknown}`);
  for (const [name, descriptor] of Object.entries<any>(columns)) {
    const value = hasOwn(object, name) ? object[name] : undefined;
    if (value === undefined && descriptor?.Optional === undefined)
      throw new EvalError("E_INPUT", `${tableName}.${name} is required`);
    if (value !== undefined) validateTypedValue(descriptor, value, `${tableName}.${name}`, false);
  }
}

function validateInputs(program: any, inputs: Record<string, Value>): void {
  for (const [name, descriptor] of Object.entries<any>(program.args ?? {})) {
    const value = inputs[name];
    if (value === undefined) throw new EvalError("E_INPUT", `missing arg ${name}`);
    validateTypedValue(descriptor, value, `arg ${name}`, true);
  }
}

function validateTypedValue(
  descriptor: any,
  value: Value,
  label: string,
  fanoutForLongList: boolean,
): void {
  assertValue(value, label);
  if (valueContainsReservedPrincipal(value))
    throw new EvalError("E_INPUT", `${label} cannot carry the reserved system principal`);
  if (descriptor?.Optional !== undefined) {
    if (value !== "Null") validateTypedValue(descriptor.Optional, value, label, fanoutForLongList);
    return;
  }
  if (descriptor?.List !== undefined) {
    if (!isVariant(value, "Array")) throw new EvalError("E_INPUT", `${label} must be a list`);
    if (value.Array.length > descriptor.List.max)
      throw new EvalError(fanoutForLongList ? "E_FANOUT" : "E_INPUT", `${label} exceeds list max ${descriptor.List.max}`);
    if (descriptor.List.of !== null && descriptor.List.of !== undefined) {
      for (const item of value.Array)
        validateTypedValue(descriptor.List.of, item, label, fanoutForLongList);
    }
    return;
  }
  if (descriptor === "Scalar") return;
  if (descriptor === "Id" || descriptor?.Ref !== undefined) {
    if (!isVariant(value, "Id")) throw new EvalError("E_INPUT", `${label} must be an id`);
    return;
  }
  if (descriptor?.Text !== undefined) {
    if (!isVariant(value, "String")) throw new EvalError("E_INPUT", `${label} must be text`);
    if (Array.from(value.String).length > descriptor.Text.max)
      throw new EvalError("E_INPUT", `${label} exceeds text max ${descriptor.Text.max}`);
    return;
  }
  if (descriptor?.Bytes !== undefined) {
    if (!isVariant(value, "Bytes") || !canonicalBytes(value.Bytes))
      throw new EvalError("E_INPUT", `${label} must be bytes`);
    if (value.Bytes.length / 2 > descriptor.Bytes.max)
      throw new EvalError("E_INPUT", `${label} exceeds bytes max ${descriptor.Bytes.max}`);
    return;
  }
  if (["Int", "Time"].includes(descriptor) || descriptor?.Decimal !== undefined || descriptor?.Money !== undefined) {
    if (!isVariant(value, "Int") || !Number.isSafeInteger(value.Int))
      throw new EvalError("E_INPUT", `${label} must be an i53 integer`);
    return;
  }
  if (descriptor === "Bool") {
    if (!isVariant(value, "Bool")) throw new EvalError("E_INPUT", `${label} must be a boolean`);
    return;
  }
  if (descriptor?.Json !== undefined) {
    if (utf8Length(canonicalValue(value)) > descriptor.Json.max_bytes)
      throw new EvalError("E_INPUT", `${label} exceeds JSON max ${descriptor.Json.max_bytes} bytes`);
    return;
  }
  if (descriptor?.Enum !== undefined) {
    if (!isVariant(value, "String") || !descriptor.Enum.variants.includes(value.String))
      throw new EvalError("E_INPUT", `${label} is not a declared enum value`);
    return;
  }
  throw new EvalError("E_SCHEMA", `unsupported type for ${label}`);
}

function assertValue(value: Value, label: string): void {
  if (value === "Null") return;
  const kind = kindOf(value);
  const data = (value as any)[kind];
  if (kind === "Bool" && typeof data === "boolean") return;
  if (kind === "Int" && Number.isSafeInteger(data)) return;
  if ((kind === "String" || kind === "Id") && typeof data === "string") return;
  if (kind === "Bytes" && canonicalBytes(data)) return;
  if (kind === "Array" && Array.isArray(data)) {
    for (const item of data) assertValue(item, label);
    return;
  }
  if ((kind === "Row" || kind === "Map") && data !== null && typeof data === "object" && !Array.isArray(data)) {
    for (const item of Object.values(data)) assertValue(item as Value, label);
    return;
  }
  throw new EvalError("E_INPUT", `${label} is not a valid value`);
}

function valueContainsReservedPrincipal(value: Value): boolean {
  if (isVariant(value, "Id")) return value.Id === coreIrContract.systemPrincipalId;
  if (isVariant(value, "Array")) return value.Array.some(valueContainsReservedPrincipal);
  if (isVariant(value, "Row")) return Object.values(value.Row).some(valueContainsReservedPrincipal);
  if (isVariant(value, "Map")) return Object.values(value.Map).some(valueContainsReservedPrincipal);
  return false;
}

function canonicalBytes(value: unknown): value is string {
  return typeof value === "string" && /^(?:[0-9a-f]{2})*$/.test(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function clone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function sortObject<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = Object.create(null);
  for (const key of Object.keys(value).sort(compareCodepoints)) sorted[key] = value[key];
  return sorted;
}

function builtinArity(kind: string): number {
  switch (kind) {
    case "Len": case "Sort": case "MentionTokens": case "Count": case "CountCapped": case "Sum": return 1;
    case "Concat": case "Min": case "Max": case "Divmod": return 2;
    case "Slice": case "DeterministicShare": return 3;
    default: throw new EvalError("E_OPAQUE", `unsupported builtin ${kind}`);
  }
}

function valueText(value: Value): string {
  if (value === "Null") return "null";
  if (isVariant(value, "Bool")) return String(value.Bool);
  if (isVariant(value, "Int")) return String(value.Int);
  if (isVariant(value, "String")) return value.String;
  if (isVariant(value, "Id")) return value.Id;
  if (isVariant(value, "Bytes")) return value.Bytes;
  if (isVariant(value, "Array")) return value.Array.map(valueText).join(",");
  return "[object Object]";
}

function isWordCharacter(character: string): boolean {
  return character === "_" || /[\p{L}\p{N}]/u.test(character);
}
