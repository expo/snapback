import { sha256 } from "./sha256";
export { sha256 } from "./sha256";
import coreIrContract from "../../../crates/snapback2-core/ir-contract.json" with { type: "json" };

export type Value =
  | "Null"
  | { Bool: boolean }
  | { Int: number }
  | { String: string }
  | { Id: string }
  | { Bytes: string }
  | { Row: Record<string, Value> }
  | { Array: Value[] }
  | { Map: Record<string, Value> };

export interface Context {
  viewer: string;
  principal_kind: string;
  auth_epoch: number;
  args: Record<string, Value>;
  now: number | null;
  new_ids: string[];
  read_time: number | null;
}

export interface RowRecord {
  table: string;
  id: string;
  row: Value;
}

export interface ReceiptRange {
  site: string;
  table: string;
  index: string;
  prefix: Value[];
  row_ids: string[];
  stop: "Limit" | "Exhausted";
  absence: boolean;
  halo: RowRecord | null;
  n2_key: Value[] | null;
}

export interface Verdict {
  rule_hash: string;
  pinned_inputs_digest: string;
  principal: string;
  auth_epoch: number;
  result: boolean;
}

export interface ClosureReceipt {
  rows: RowRecord[];
  ranges: ReceiptRange[];
  absences: [string, string, Value[]][];
  verdicts: Verdict[];
}

export interface PreludeStep {
  program: any;
  context: Context;
  expectedState: string;
}

export interface CorpusExpected {
  localResult: Value | null;
  errorCode: string | null;
  localState: string;
  partialSites: string[];
  canonicalResult: string;
  digest: string;
  rangeStops: Record<string, string[]>;
  evictedRows: number | null;
}

export interface CorpusCase {
  corpusVersion: number;
  name: string;
  category: string;
  randomSeed: number | null;
  schema: any;
  program: any;
  certificate: any;
  context: Context;
  receipt: ClosureReceipt;
  prelude: PreludeStep[];
  replacementReceipt: ClosureReceipt | null;
  expected: CorpusExpected;
}

export interface ActualResult extends CorpusExpected {}

export interface HydrationResult {
  planState: "ready" | "replay-mismatch";
  servedResult: Value | null;
  actual: ActualResult;
  diagnostic: string | null;
}

interface TraceRange {
  site: string;
  prefix: Value[];
  stop: "limit" | "exhausted";
}

interface TraceAbsence {
  site: string;
  table: string;
  index: string;
  key: Value[];
}

interface Trace {
  ranges: TraceRange[];
  absences: TraceAbsence[];
  missingAuthority: boolean;
}

interface Execution {
  result: Value;
  trace: Trace;
}

interface LocalExecution {
  state: "fresh" | "predicted" | "partial";
  partialSites: string[];
  execution: Execution;
}

type Flow =
  | { kind: "next" }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "return"; value: Value };

const NEXT: Flow = { kind: "next" };
const I53_MAX = 9_007_199_254_740_991;
const I53_MIN = -I53_MAX;
export const CURRENT_VALUE_MODEL_VERSION = coreIrContract.valueModelVersion;

class EvalError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

export class ClientStore {
  private tables = new Map<string, Map<string, Value>>();
  private coverage: ClosureReceipt;
  private rangeDeletions = new Map<string, number>();

  constructor(
    private readonly schema: any,
    receipt: ClosureReceipt,
  ) {
    this.coverage = clone(receipt);
    this.seedReceipt(receipt);
  }

  applyMutation(program: any, context: Context): LocalExecution {
    const before = this.allIds();
    const snapshot = this.snapshotTables();
    const runner = new Runner(this, this.schema, context);
    let execution: Execution;
    try {
      execution = runner.execute(program);
    } catch (error) {
      // @ref LLP 1001#3-read-and-write-states-no-silent-states — local prediction has the same
      // all-or-nothing mutation boundary as the authoritative transaction.
      this.tables = snapshot;
      if (runner.trace.missingAuthority)
        return { state: "partial", partialSites: ["missing-authority"], execution: { result: "Null", trace: runner.trace } };
      throw error;
    }
    if (execution.trace.missingAuthority) {
      this.tables = snapshot;
      return { state: "partial", partialSites: ["missing-authority"], execution: { result: "Null", trace: execution.trace } };
    }
    const after = this.allIds();
    for (const removed of before) {
      if (after.has(removed)) continue;
      for (const range of this.coverage.ranges) {
        const held =
          range.row_ids.some((id) => `${range.table}:${id}` === removed) ||
          (range.halo !== null &&
            `${range.halo.table}:${range.halo.id}` === removed);
        if (held) {
          this.rangeDeletions.set(
            range.site,
            (this.rangeDeletions.get(range.site) ?? 0) + 1,
          );
        }
      }
    }
    return { state: "predicted", partialSites: [], execution };
  }

  reexecute(program: any, context: Context): LocalExecution {
    const execution = new Runner(this, this.schema, context).execute(program);
    const partial = new Set<string>();
    if (execution.trace.missingAuthority) partial.add("missing-authority");
    for (const range of execution.trace.ranges) {
      const covered = this.coverage.ranges.some(
        (coverage) =>
          coverage.site === range.site && valuesEqual(coverage.prefix, range.prefix),
      );
      if (!covered || (this.rangeDeletions.get(range.site) ?? 0) > 1) {
        partial.add(range.site);
      }
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
    const id = asString(field(row, "id"));
    let rows = this.tables.get(table);
    if (rows === undefined) {
      rows = new Map();
      this.tables.set(table, rows);
    }
    rows.set(id, normalizeRow(row));
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

  private seedReceipt(receipt: ClosureReceipt): void {
    for (const row of receipt.rows) this.put(row.table, clone(row.row));
  }

  private allIds(): Set<string> {
    const ids = new Set<string>();
    for (const [table, rows] of this.tables) {
      for (const id of rows.keys()) ids.add(`${table}:${id}`);
    }
    return ids;
  }

  private snapshotTables(): Map<string, Map<string, Value>> {
    return new Map(
      Array.from(this.tables, ([table, rows]) => [
        table,
        new Map(Array.from(rows, ([id, row]) => [id, clone(row)])),
      ]),
    );
  }

  private index(table: string, indexName: string): any {
    const index = this.schema.tables?.[table]?.indexes?.[indexName];
    if (index === undefined) throw new EvalError("E_SCHEMA", `missing index ${table}.${indexName}`);
    return index;
  }
}

class Runner {
  private readonly env = new Map<string, Value>();
  private readonly consts = new Set<string>();
  private readonly context: Context;
  readonly trace: Trace = { ranges: [], absences: [], missingAuthority: false };
  private readonly ruleMemo = new Map<string, boolean>();
  private authorityMissSerial = 0;
  private readonly createdRows = new Set<string>();
  private readonly insertedRows: Array<{ table: string; row: Value }> = [];
  private createdPoints: Array<{
    table: string;
    index: string;
    key: string;
    rowId: string;
  }> = [];

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
    this.checkFinalConstraints();
    return {
      result: flow.kind === "return" ? flow.value : "Null",
      trace: this.trace,
    };
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
            throw new EvalError(`E_REQUIRE:${data.code}`, "program requirement failed");
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
          this.validateAddressedRowId(data.table, key, row);
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
        const row: Record<string, Value> = {};
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
      case "Builtin":
        return this.builtin(data.builtin, data.args.map((value: any) => this.expr(value)));
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
        if (isVariant(left, "String") && isVariant(right, "String"))
          return { String: left.String + right.String };
        if (isVariant(left, "Id") && isVariant(right, "Id"))
          return { Id: `${left.Id}:${right.Id}` };
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
        for (const token of asString(args[0]).split(/\s+/)) {
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
    if (found === null) {
      this.trace.absences.push({
        site: read.site,
        table: read.table,
        index: read.index,
        key,
      });
      return "Null";
    }
    return this.checkRule(read.table, "read", null, found) ? clone(found) : "Null";
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
    const visible = examined.filter((row) =>
      this.checkRule(scan.table, "read", null, row)
    );
    this.trace.ranges.push({ site: scan.site, prefix, stop });
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
    validateWriteRow(this.schema, table, row);
    if (!this.checkRule(table, "insert", null, row))
      throw new EvalError("E_RULE", `${table} insert`);
    this.checkConstraints(table, null, row, "insert");
    if (this.store.byId(table, asString(field(row, "id"))) !== null)
      throw new EvalError("E_CONSTRAINT", `duplicate id on ${table}`);
    this.store.put(table, row);
    this.rememberCreatedRow(table, row);
    this.insertedRows.push({ table, row: clone(row) });
    this.ruleMemo.clear();
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
    validateWriteRow(this.schema, table, row);
    this.validateAddressedRowId(table, key, row);
    // @ref LLP 1001#9-schema-additions — update authority is one relation
    // evaluated once over the old and next row images.
    if (!this.checkRule(table, "update", old, row))
      throw new EvalError("E_RULE", `${table} update`);
    this.checkConstraints(table, old, row, "update");
    this.store.put(table, row);
    this.refreshCreatedPoints(table, row);
    this.ruleMemo.clear();
    this.maintain(table, old, row);
  }

  private delete(table: string, id: string): void {
    const old = this.store.byId(table, id);
    if (old === null) return;
    if (!this.checkRule(table, "delete", null, old))
      throw new EvalError("E_RULE", `${table} delete`);
    this.checkConstraints(table, old, old, "delete");
    this.store.remove(table, id);
    this.forgetCreatedPoints(table, id);
    this.ruleMemo.clear();
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
    const group = maintain.by.map((name: string) => clone(field(source, name)));
    const idValue = canonicalValues(group);
    const [kind, data] = variant(maintain.kind);
    const delta =
      kind === "Count" ? direction : safeNumber(direction * asInt(field(source, data.of)));
    const existing = this.store.byId(maintain.target, idValue);
    const oldValue = existing === null ? 0 : asInt(field(existing, "value"));
    const object: Record<string, Value> = {
      id: { Id: idValue },
      value: int(oldValue + delta),
    };
    maintain.by.forEach((name: string, index: number) => {
      object[name] = group[index];
    });
    const row = rowValue(object);
    const effect = existing === null ? "insert" : "update";
    // Maintained targets are engine-owned. They bypass authored write rules
    // while retaining the same constraints and created-row provenance as Rust.
    this.checkConstraints(maintain.target, existing, row, effect);
    this.store.put(maintain.target, row);
    if (existing === null) {
      this.rememberCreatedRow(maintain.target, row);
      this.insertedRows.push({ table: maintain.target, row: clone(row) });
    } else this.refreshCreatedPoints(maintain.target, row);
    this.ruleMemo.clear();
  }

  private validateAddressedRowId(table: string, key: Value, row: Value): void {
    const addressed = asString(key);
    const rowId = asString(field(row, "id"));
    if (addressed !== rowId)
      throw new EvalError(
        "E_INPUT",
        `${table} row id ${JSON.stringify(rowId)} does not match addressed key ${JSON.stringify(addressed)}`,
      );
  }

  private rememberCreatedRow(table: string, row: Value): void {
    const id = asString(field(row, "id"));
    this.createdRows.add(`${table}\0${id}`);
    this.refreshCreatedPoints(table, row);
  }

  private refreshCreatedPoints(table: string, row: Value): void {
    const rowId = asString(field(row, "id"));
    if (!this.createdRows.has(`${table}\0${rowId}`)) return;
    this.forgetCreatedPoints(table, rowId);
    for (const [index, definition] of Object.entries<any>(
      this.schema.tables[table]?.indexes ?? {},
    )) {
      this.createdPoints.push({
        table,
        index,
        key: canonicalValues(
          definition.columns.map((column: string) => fieldOrNull(row, column)),
        ),
        rowId,
      });
    }
  }

  private forgetCreatedPoints(table: string, rowId: string): void {
    this.createdPoints = this.createdPoints.filter(
      (point) => point.table !== table || point.rowId !== rowId,
    );
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
      if (kind === "Cap" && effect === "insert") {
        const entry = Object.entries<any>(table.indexes).find(([, index]) =>
          startsWith(index.columns, data.by),
        );
        if (entry === undefined) throw new EvalError("E_SCHEMA", "cap index missing");
        const prefix = data.by.map((name: string) => field(row, name));
        if (
          this.store.scan(tableName, entry[0], prefix, null, null, null, "Asc", data.max)
            .length >= data.max
        )
          throw new EvalError("E_CONSTRAINT", `${tableName} cap reached`);
      }
      if (kind === "Text" && (effect === "insert" || effect === "update")) {
        const value = asObject(row)[data.field];
        if (value !== undefined && value !== "Null") {
          const text = asString(value);
          if (Array.from(text).length < (data.min ?? 0))
            throw new EvalError(
              "E_CONSTRAINT",
              `${tableName}.${data.field} must contain at least ${data.min ?? 0} characters`,
            );
          const valid =
            data.format === undefined ||
            data.format === null ||
            (data.format === "handle" && /^[a-z0-9_]*$/.test(text)) ||
            (data.format === "url" && validHttpUrl(text));
          if (!valid)
            throw new EvalError(
              "E_CONSTRAINT",
              `${tableName}.${data.field} has invalid ${String(data.format)} format`,
            );
        }
      }
    }
    for (const [indexName, index] of Object.entries<any>(table.indexes)) {
      if (index.unique) this.checkUnique(tableName, indexName, old, row);
    }
  }

  private checkFinalConstraints(): void {
    for (const { table: sourceTable, row } of this.insertedRows) {
      for (const constraint of this.schema.tables[sourceTable]?.constraints ?? []) {
        const [kind, data] = variant(constraint);
        if (kind !== "FinalExistsOnInsert") continue;
        const key = data.key.map((term: any) => this.ruleTerm(term, null, row));
        if (this.store.lookup(data.table, data.index, key) === null)
          throw new EvalError(
            "E_CONSTRAINT",
            `${sourceTable} insert requires final row at ${data.table}.${data.index}`,
          );
      }
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
  }

  private checkRule(
    table: string,
    effect: "read" | "insert" | "update" | "delete",
    old: Value | null,
    next: Value,
  ): boolean {
    const rule = this.schema.tables[table].rules[effect];
    const authorityMissSerial = this.authorityMissSerial;
    const allowed = this.evaluateRule(
      rule,
      scopedRuleHash(this.schema, rule),
      old,
      next,
      effect === "insert",
    );
    return allowed && this.authorityMissSerial === authorityMissSerial;
  }

  private evaluateRule(
    rule: any,
    ruleHash: string,
    old: Value | null,
    next: Value,
    createdAllowed: boolean,
  ): boolean {
    const [kind, data] = variant(rule);
    switch (kind) {
      case "Public":
      case "Allow":
        return true;
      case "Deny":
        return false;
      case "Eq":
        return canonicalValue(this.ruleTerm(data[0], old, next)) === canonicalValue(this.ruleTerm(data[1], old, next));
      case "Ne":
        return canonicalValue(this.ruleTerm(data[0], old, next)) !== canonicalValue(this.ruleTerm(data[1], old, next));
      case "And":
        return data.every((child: any) =>
          this.evaluateRule(child, ruleHash, old, next, createdAllowed)
        );
      case "Or":
        return data.some((child: any) =>
          this.evaluateRule(child, ruleHash, old, next, createdAllowed)
        );
      case "Not":
        return !this.evaluateRule(data, ruleHash, old, next, createdAllowed);
      case "Exists": {
        const key = data.key.map((term: any) => this.ruleTerm(term, old, next));
        const pinnedDigest = sha256(JSON.stringify([data.table, data.index, key]));
        const memoKey = `${ruleHash}:${pinnedDigest}`;
        const memoized = this.ruleMemo.get(memoKey);
        if (memoized !== undefined) return memoized;
        if (!this.ruleInputIsReadable(data)) {
          // @ref LLP 1001#2-what-a-commit-records — held rows cannot replace authority-only verdicts.
          const verdict = this.store.verdict(ruleHash, pinnedDigest, this.context);
          if (verdict !== null) {
            this.ruleMemo.set(memoKey, verdict);
            return verdict;
          }
          this.trace.missingAuthority = true;
          this.authorityMissSerial += 1;
          return false;
        }
        const result = this.store.lookup(data.table, data.index, key) !== null;
        this.ruleMemo.set(memoKey, result);
        return result;
      }
      case "Created": {
        if (!createdAllowed)
          throw new EvalError(
            "E_SCHEMA",
            "created-row probe evaluated outside a table insert rule",
          );
        const key = data.key.map((term: any) => this.ruleTerm(term, old, next));
        const encoded = canonicalValues(key);
        return this.createdPoints.some(
          (point) =>
            point.table === data.table &&
            point.index === data.index &&
            point.key === encoded,
        );
      }
      default:
        throw new EvalError("E_OPAQUE", `unsupported rule ${kind}`);
    }
  }

  private ruleInputIsReadable(probe: any): boolean {
    const table = this.schema.tables[probe.table];
    const index = table?.indexes?.[probe.index];
    if (!table || !index) return false;
    const prove = (rule: any): boolean => {
      const [kind, data] = variant(rule);
      if (kind === "Public" || kind === "Allow") return true;
      if (kind === "Eq") {
        const left = substituteRuleTerm(data[0], index.columns, probe.key);
        const right = substituteRuleTerm(data[1], index.columns, probe.key);
        return left !== null && right !== null && canonicalJson(left) === canonicalJson(right);
      }
      if (kind === "And") return data.length > 0 && data.every(prove);
      if (kind === "Or") return data.some(prove);
      if (kind === "Exists" && data.table === probe.table && data.index === probe.index) {
        const key = data.key.map((term: any) => substituteRuleTerm(term, index.columns, probe.key));
        return key.every((term: any) => term !== null) && canonicalJson(key) === canonicalJson(probe.key);
      }
      return false;
    };
    return prove(table.rules.read);
  }

  private ruleTerm(term: any, old: Value | null, next: Value): Value {
    const [kind, data] = variant(term);
    if (kind === "Field") return clone(field(next, data));
    if (kind === "NextField") {
      if (old === null)
        throw new EvalError("E_SCHEMA", "next-row rule term evaluated outside an update rule");
      return clone(field(next, data));
    }
    if (kind === "OldField") {
      if (old === null)
        throw new EvalError("E_SCHEMA", "old-row rule term evaluated outside an update rule");
      return clone(field(old, data));
    }
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

function substituteRuleTerm(term: any, columns: string[], probeKey: any[]): any | null {
  const [kind, data] = variant(term);
  if (kind === "OldField" || kind === "NextField") return null;
  if (kind !== "Field") return clone(term);
  const position = columns.indexOf(data);
  return position < 0 || position >= probeKey.length ? null : clone(probeKey[position]);
}

export function evaluateCase(testCase: CorpusCase): ActualResult {
  if (testCase.certificate?.value_model_version !== CURRENT_VALUE_MODEL_VERSION) {
    throw new EvalError(
      "E_TRACE_SUBSET",
      `value model version ${String(testCase.certificate?.value_model_version)} != current ${CURRENT_VALUE_MODEL_VERSION}`,
    );
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
    const code = error instanceof EvalError ? error.code.split(":")[0] : "E_UNKNOWN";
    const canonicalResult = JSON.stringify({ Error: code });
    return {
      localResult: null,
      errorCode: code,
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
  const mismatch =
    actual.canonicalResult !== testCase.expected.canonicalResult ||
    actual.digest !== testCase.expected.digest;
  if (mismatch) {
    return {
      planState: "replay-mismatch",
      servedResult: clone(testCase.expected.localResult),
      actual,
      diagnostic: `hydration replay mismatch for ${testCase.name}: expected ${testCase.expected.digest}, got ${actual.digest}`,
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
  const result: Record<string, string[]> = {};
  for (const range of ranges) (result[range.site] ??= []).push(range.stop);
  return sortObject(result);
}

function normalizeRow(value: Value): Value {
  if (!isVariant(value, "Row")) return clone(value);
  return rowValue(value.Row);
}

function rowValue(entries: Record<string, Value>): Value {
  const sorted: Record<string, Value> = {};
  for (const key of Object.keys(entries).sort(compareCodepoints)) sorted[key] = clone(entries[key]);
  return { Row: sorted };
}

function field(value: Value, name: string): Value {
  const object = asObject(value);
  if (!(name in object)) throw new EvalError("E_FIELD", `missing field ${name}`);
  return object[name];
}

function fieldOrNull(value: Value, name: string): Value {
  const object = asObject(value);
  return object[name] ?? "Null";
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
  return sha256(JSON.stringify([sha256(JSON.stringify(schema)), rule]));
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

function startsWith<T>(values: T[], prefix: T[]): boolean {
  return prefix.every((value, index) => values[index] === value);
}

function validHttpUrl(value: string): boolean {
  const rest = value.startsWith("https://")
    ? value.slice("https://".length)
    : value.startsWith("http://")
      ? value.slice("http://".length)
      : "";
  return rest.length > 0 && !/[\p{White_Space}\p{Cc}]/u.test(rest);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareCodepoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateWriteRow(schema: any, tableName: string, row: Value): void {
  const columns = schema.tables?.[tableName]?.columns;
  if (columns === undefined) throw new EvalError("E_SCHEMA", `missing table ${tableName}`);
  const object = asObject(row);
  for (const [name, descriptor] of Object.entries<any>(columns)) {
    if (name in object) validateColumnValue(descriptor, object[name], `${tableName}.${name}`);
  }
}

function validateColumnValue(descriptor: any, value: Value, label: string): void {
  if (descriptor?.Bytes) {
    if (!isVariant(value, "Bytes") || !canonicalBytes(value.Bytes))
      throw new EvalError("E_INPUT", `${label} must be bytes`);
    if (value.Bytes.length / 2 > descriptor.Bytes.max)
      throw new EvalError("E_INPUT", `${label} exceeds bytes max ${descriptor.Bytes.max}`);
    return;
  }
  if (descriptor?.Optional !== undefined) {
    if (value !== "Null") validateColumnValue(descriptor.Optional, value, label);
    return;
  }
  if (descriptor?.List && isVariant(value, "Array")) {
    for (const item of value.Array) validateColumnValue(descriptor.List.of, item, label);
  }
}

function canonicalBytes(value: unknown): value is string {
  return typeof value === "string" && /^(?:[0-9a-f]{2})*$/.test(value);
}

function clone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function sortObject<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(value).sort(compareCodepoints)) sorted[key] = value[key];
  return sorted;
}

function isWordCharacter(character: string): boolean {
  return character === "_" || /[\p{L}\p{N}]/u.test(character);
}
