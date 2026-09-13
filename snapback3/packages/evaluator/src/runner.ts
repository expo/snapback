import { canonicalProgramJson, canonicalSchemaJson } from "./certificate-identity";
import { mergeRemainder, mergeStreams } from "./merge";
import { DeliveryPrediction } from './delivery-prediction';
import coreIrContract from "../../../crates/snapback3-core/ir-contract.json" with { type: "json" };
import { fail, EvalError, requireRowIdentity } from "./errors";
import { cursorSuffix, decodeCursorFor, encodeCursor } from "./cursor";
import { sha256 } from "./hash";
import { splitMentionTokens } from "./text";
import { SearchExecution, normalizationSteps } from "./search-runtime";
import { ordinaryColumns, scalarAtoms, preparePrefix, logicalKey } from "./index-store";
import type { ClientStore } from "./store";
import {
  asArray,
  asBool,
  asInt,
  asObject,
  asString,
  builtinArity,
  canonicalJson,
  canonicalValue,
  canonicalValues,
  clone,
  compareCodepoints,
  field,
  fieldOrNull,
  int,
  isVariant,
  isWordCharacter,
  materializeOptionalFields,
  rowDigest,
  rowValue,
  safeNumber,
  sameValueZero,
  scopedRuleHash,
  startsWith,
  totalCompare,
  validHttpUrl,
  validateWriteRow, validateScanCursor,
  valueText,
  variant, wireJson,
} from "./value-runtime";
import type { Context, Execution, Trace, TraceRange, TraceVerdict, TraceWrite, Value } from "./types";

export const CURRENT_VALUE_MODEL_VERSION = "i53-codepoint-bytes-unicode-search-text-refinements-v5";
export const CURRENT_EVALUATOR = "bounded-spike-rust-search-text-refinements-5";

type Flow =
  | { kind: "next" }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "return"; value: Value };

const NEXT: Flow = { kind: "next" };

export class Runner {
  private delivery?: DeliveryPrediction;
  private acknowledgement?: string;
  private readonly env = new Map<string, Value>();
  private readonly consts = new Set<string>();
  private returnPath: string | null = null;
  private held = false;
  private readonly context: Context;
  readonly trace: Trace = { ranges: [], absences: [], points: [], merges: [], verdicts: [] };
  private readonly ruleMemo = new Map<string, boolean>();
  // @ref LLP 1012#6-reads-offline — schema/rule identity is immutable for one
  // synchronous execution; never carry this canonical-hash memo across Runners.
  private readonly ruleHashes = new Map<unknown, string>();
  /** Verdicts the rule check in progress derived; committed to the trace only when the check discloses the row. */
  private pendingVerdicts: TraceVerdict[] = [];
  private readonly tracedVerdicts = new Set<string>();
  readonly search: SearchExecution;
  private chargeSearch = (stats: import('./unicode').NormalizationStats): void => {
    this.chargeDerived(normalizationSteps(stats), stats.scratchBytes);
  };
  private chargeDerived(steps: number, scratchBytes: number): void {
    this.trace.derived_steps = (this.trace.derived_steps ?? 0) + steps;
    this.trace.derived_scratch_bytes = Math.max(this.trace.derived_scratch_bytes ?? 0, scratchBytes);
    this.step(steps);
    if (this.trace.derived_steps > (this.certificate?.derived_steps ?? Infinity)) fail('E_STEPS', 'certified derived step budget exceeded');
    if (scratchBytes > Math.min(this.certificate?.derived_scratch_bytes ?? Infinity, this.certificate?.max_heap_bytes ?? 8388608, 8388608))
      fail('E_HEAP', 'derived scratch budget exceeded');
  }
  private ruleHash(rule: unknown): string {
    let hash = this.ruleHashes.get(rule);
    if (hash === undefined) { hash = scopedRuleHash(this.schema, rule); this.ruleHashes.set(rule, hash); }
    return hash;
  }
  private readonly pooled = new Set<string>();
  private readonly writes = new Map<string, TraceWrite>();
  private readonly partial = new Set<string>();
  private authorityMissSerial = 0;
  private authorityFields?: string[];
  /** Engine-owned aggregate targets this run could not update because they are not held. */
  private readonly unheldMaintainTargets: string[] = [];
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
    private readonly certificate: any,
    search = new SearchExecution(),
    predictDelivery = false,
  ) {
    if (predictDelivery) this.delivery = new DeliveryPrediction(schema, context.viewer);
    this.search = search;
    search.meter(this.chargeSearch);
    this.context = clone(context);
    for (const [name, value] of Object.entries(context.args)) {
      this.env.set(name, clone(value));
    }
  }

  execute(program: any): Execution {
    validateCertificate(this.schema, program, this.certificate);
    this.acknowledgement = Object.values<any>(this.schema.tables).map(t => t.deliver).find(d =>
      d?.receipts && program.name === `_delivery.${d.log}.ack`)?.log;
    const flow = this.statements(program.body);
    this.checkFinalConstraints();
    return {
      result: this.partial.size === 0 && flow.kind === "return" ? flow.value : "Null",
      trace: this.trace,
      next: mintNext(this.context.viewer, this.certificate, this.trace, this.returnPath),
      writes: [...this.writes.values()],
      page: this.returnPath === null ? undefined : this.certificate.result_pages?.[this.returnPath],
      ...(this.held ? { held: true } : {}),
    };
  }

  coverageMisses(): string[] {
    return Array.from(this.partial).sort(compareCodepoints);
  }

  /** Where `missing-authority` came from: unheld maintained targets versus rule inputs and write rows. */
  authorityMisses(): { maintainTargets: string[]; other: number } {
    return { maintainTargets: [...this.unheldMaintainTargets], other: this.authorityMissSerial - this.unheldMaintainTargets.length };
  }

  private step(count = 1): void {
    this.trace.steps = (this.trace.steps ?? 0) + count;
    if (this.trace.steps > Math.min(this.certificate?.max_steps ?? 1000000, 1000000))
      fail("E_STEPS", "certified step budget exceeded");
  }

  private statements(statements: any[], prefix = ""): Flow {
    for (const [index, statement] of statements.entries()) {
      const path = `${prefix}${index}`;
      this.step();
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
            fail("E_INPUT", `cannot assign to const binding ${data.name}`);
          this.env.set(data.name, this.expr(data.value));
          break;
        case "Push": {
          const target = this.env.get(data.target);
          if (target === undefined || !isVariant(target, "Array"))
            fail("E_TYPE", "push target is not an array");
          target.Array.push(this.expr(data.value));
          break;
        }
        case "If": {
          const arm = asBool(this.expr(data.condition)) ? "then" : "else";
          flow = this.statements(data[`${arm}_body`], `${path}/${arm}/`);
          break;
        }
        case "For": {
          for (const value of this.domain(data.domain)) {
            this.env.set(data.binding, value);
            const bodyFlow = this.statements(data.body, `${path}/body/`);
            if (bodyFlow.kind === "continue" || bodyFlow.kind === "next") continue;
            if (bodyFlow.kind === "break") break;
            flow = bodyFlow;
            break;
          }
          break;
        }
        case "Require": {
          const value = this.expr(data.condition);
          if (!asBool(value))
            fail("E_REQUIRE", "program requirement failed", data.code);
          this.delivery?.require(value);
          break;
        }
        case "Check":
          if (!asBool(this.expr(data.condition))) {
            const { table, index } = data.current, key = data.current.key.map((value: any) => this.expr(value));
            if (this.store.lookup(table, index, key) === null && !this.store.hasAbsence(table, index, key)) this.partial.add("missing-authority");
            fail("E_REQUIRE", "the row no longer matches the update condition", "E_CONFLICT");
          }
          break;
        case "InsertIfAbsent": {
          const row = this.expr(data.row);
          this.env.set(data.result, this.insert(data.table, row, true) ? row : "Null");
          break;
        }
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
          if (this.takeNewId() === undefined)
            fail("E_INPUT", "newId envelope exhausted");
          break;
        case "Return":
          flow = { kind: "return", value: this.expr(data) };
          this.returnPath = path;
          break;
        case "Break":
          flow = { kind: "break" };
          break;
        case "Continue":
          flow = { kind: "continue" };
          break;
        default:
          fail("E_OPAQUE", `unsupported statement ${kind}`);
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
        if (values.length > data.max) fail("E_FANOUT", "argument list bound");
        return values;
      }
      case "DerivedArray": {
        const values = asArray(this.expr(data.value));
        if (values.length > data.max) fail("E_FANOUT", "derived array bound");
        return values;
      }
      case "Recurse":
        return this.recurse(data);
      default:
        fail("E_OPAQUE", `unsupported loop domain ${kind}`);
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
        fail("E_FANOUT", "recursive fanout exceeded");
      for (const successor of successors) queue.push([successor, depth + 1]);
    }
    return rows;
  }

  private expr(expression: any): Value {
    this.step();
    const [kind, data] = variant(expression);
    switch (kind) {
      case "Literal":
        return clone(data);
      case "Variable": {
        const value = this.requiredEnv(data), copy = clone(value);
        return this.delivery?.copy(copy, value) ?? copy;
      }
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
        fail("E_OPAQUE", `unsupported unary ${data.op}`);
      }
      case "Builtin": {
        const builtinKind = variant(data.builtin)[0];
        const expected = builtinArity(builtinKind);
        if (data.args.length !== expected) {
          fail("E_INPUT", `${builtinKind} requires ${expected} arguments, received ${data.args.length}`);
        }
        return this.builtin(data.builtin, data.args.map((value: any) => this.expr(value)));
      }
      case "Get":
        return this.get(data);
      case "Exists": {
        const row = this.get(data), value = { Bool: row !== 'Null' };
        return this.delivery?.point(value, data.table, row) ?? value;
      }
      case "Scan":
        return this.scan(data);
      case "Merge":
        return this.merge(data);
      default:
        fail("E_OPAQUE", `unsupported expression ${kind}`);
    }
  }

  private input(input: string): Value {
    switch (input) {
      case "Viewer":
        return { Id: this.context.viewer };
      case "Now":
        if (this.context.now === null) fail("E_INPUT", "now was not pinned");
        return int(this.context.now);
      case "NewId": {
        const next = this.takeNewId();
        if (next === undefined) fail("E_INPUT", "newId envelope exhausted");
        return { Id: next };
      }
      case "ReadTime":
        if (this.context.read_time === null)
          fail("E_INPUT", "readTime was not pinned");
        return int(this.context.read_time);
      default:
        fail("E_INPUT", `unknown modeled input ${input}`);
    }
  }

  private takeNewId(): string | undefined {
    return this.context.new_ids.shift() ?? this.context.new_id?.();
  }

  private binary(data: any): Value {
    const left = this.expr(data.left);
    if (data.op === "And" && !asBool(left)) return { Bool: false };
    if (data.op === "Or" && asBool(left)) return left;
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
        return this.delivery?.copy({ Bool: asBool(left) && asBool(right) }, left, right) ?? { Bool: asBool(left) && asBool(right) };
      case "Or":
        return this.delivery?.copy({ Bool: asBool(left) || asBool(right) }, asBool(left) ? left : right) ?? { Bool: asBool(left) || asBool(right) };
      default:
        fail("E_OPAQUE", `unsupported binary ${data.op}`);
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
        fail("E_TYPE", "len expects string, array, or map");
      }
      case "Slice": {
        const start = Math.max(0, asInt(args[1]));
        const end = Math.max(0, asInt(args[2]));
        if (isVariant(args[0], "Array")) return { Array: args[0].Array.slice(start, end) };
        if (isVariant(args[0], "String"))
          return { String: Array.from(args[0].String).slice(start, end).join("") };
        fail("E_TYPE", "slice expects array or string");
      }
      case "Concat": {
        const [left, right] = args;
        if (isVariant(left, "String") || isVariant(right, "String"))
          return { String: valueText(left) + valueText(right) };
        if (isVariant(left, "Id") && isVariant(right, "Id"))
          return { Id: canonicalValues([left, right]) };
        if (isVariant(left, "Array") && isVariant(right, "Array"))
          return { Array: left.Array.concat(right.Array) };
        fail("E_TYPE", "concat operands differ");
      }
      case "Min":
        return totalCompare(args[0], args[1]) <= 0 ? args[0] : args[1];
      case "Max":
        return totalCompare(args[0], args[1]) >= 0 ? args[0] : args[1];
      case "Divmod": {
        const numerator = asInt(args[0]);
        const denominator = asInt(args[1]);
        if (denominator === 0) fail("E_DIV_ZERO", "division by zero");
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
        // @ref LLP 1018.008.004#implementation-selection-2026-09-10 — ES2019
        // stable sort operates on an owned copy, never the held argument array.
        const values = asArray(args[0]).slice();
        for (const value of values) {
          for (const key of data.keys) field(value, key.field);
        }
        return {
          Array: values.sort((left, right) => {
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
        const recipients = asArray(args[1]).slice().sort(totalCompare);
        if (recipients.length === 0) fail("E_DIV_ZERO", "no recipients");
        if (new Set(recipients.map(canonicalValue)).size !== recipients.length)
          fail("E_INPUT", "share recipients must be unique");
        const recipient = args[2];
        const position = recipients.findIndex(
          (candidate) => canonicalValue(candidate) === canonicalValue(recipient),
        );
        if (position < 0) fail("E_INPUT", "recipient missing from shares");
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
        fail("E_OPAQUE", `unsupported builtin ${kind}`);
    }
  }

  private get(read: any): Value {
    const key = read.key.map((value: any) => this.expr(value));
    if (read.table === "_connected") {
      this.partial.add("missing-authority");
      this.authorityMissSerial += 1;
      return "Null";
    }
    const found = this.store.lookup(read.table, read.index, key);
    if (found !== null) this.trace.examined = (this.trace.examined ?? 0) + 1;
    const disclosed = found !== null && this.checkRule(read.table, "read", null, found);
    // @ref LLP 1012#7-writes-offline — the point digest is what the program
    // observed: the wire row when disclosed, an absence when missing or hidden.
    this.trace.points.push({
      site: read.site,
      table: read.table,
      index: read.index,
      key: key.map(clone),
      digest: disclosed ? rowDigest(found) : null,
      ...(typeof read.provenance === "string" ? { provenance: read.provenance } : {}),
    });
    if (found === null) {
      this.trace.absences.push({
        site: read.site,
        table: read.table,
        index: read.index,
        key,
        ...(typeof read.provenance === "string" ? { provenance: read.provenance } : {}),
      });
      return "Null";
    }
    if (disclosed) this.pool(read.table, found);
    return disclosed ? clone(found) : "Null";
  }

  private scanInput(scan: any, scope?: Value[]): any {
    validateScanCursor(this.schema, scan, this.env);
    const maxima = scan.prefix.map((key: any) => key.WordPrefix?.source_max);
    const prefix = scan.prefix.map((key: any, at: number) => {
      if (Object.keys(key).length !== 1) fail("E_INPUT", "malformed index key");
      if ("Scalar" in key) return { Scalar: scope?.[at] ?? this.expr(key.Scalar) };
      if (!key.WordPrefix) fail("E_INPUT", "malformed index key");
      const p = key.WordPrefix;
      return { WordPrefix: { contract: p.contract, source: asString(this.expr(p.source)) } };
    });
    const logical = preparePrefix(this.schema, scan.table, scan.index, prefix, maxima, this.search.atom);
    if (this.store.missingSearchAuthority(scan.table, scan.index, logical, this.context)) this.partial.add('missing-authority');
    let after = scan.after === null ? null : this.expr(scan.after);
    const before = scan.before === null ? null : this.expr(scan.before);
    if (scan.opaque_cursor && after === "Null") after = null;
    else if (scan.opaque_cursor && after !== null) {
      if (!isVariant(after, "String")) fail("E_INPUT", "opaque cursor must be a string");
      after = decodeCursorFor(after.String, {
        table: scan.table, index: scan.index, order: scan.order, suffix: cursorSuffix(this.schema, scan),
      }, this.schema);
    }
    const evaluatedRange = scan.range === null ? null : this.evaluateRange(scan.range);
    const [boundKind, boundData] = variant(scan.take);
    const take =
      boundKind === "Literal"
        ? boundData
        : asInt(this.context.args[boundData.name] ?? this.requiredEnv(boundData.name));
    if (!Number.isInteger(take) || take < 0 || (boundKind === "Arg" && take > boundData.max))
      fail("E_FANOUT", "scan take exceeded");
    return { prefix, logical, after, before, evaluatedRange, take };
  }

  private scan(scan: any): Value {
    const input = this.scanInput(scan);
    const { logical, after, before, evaluatedRange, take } = input;
    const examined = this.store.scan(
      scan.table,
      scan.index,
      logical,
      after,
      before,
      evaluatedRange,
      scan.order,
      take + 2,
    );
    this.trace.examined = (this.trace.examined ?? 0) + examined.length;
    // The proof belongs to this scan; point reads still evaluate their row policy.
    const readSite = this.certificate.read_sites?.find((site: any) => site.site === scan.site);
    const publicRule = this.context.viewer === coreIrContract.systemPrincipalId
      || ["Allow", "Public"].includes(variant(this.schema.tables[scan.table].rules.read)[0]);
    const uniform = readSite?.hoist === true || publicRule;
    const decidedTrue = readSite?.hoist === true && readSite.decided_true === true;
    const visible = examined.filter((row) => decidedTrue || this.checkRule(scan.table, "read", null, row));
    const sourceExhausted = examined.length < take + 2;
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — exhausting
    // held candidates cannot prove a non-uniform scan complete when exactly
    // `take` visible rows were returned; unseen hidden/visible rows may follow.
    const stop = ((uniform && visible.length <= take && sourceExhausted)
      || (!uniform && visible.length < take && sourceExhausted)) ? "exhausted" : "limit";
    const returned = visible.slice(0, take);
    const suffix = cursorSuffix(this.schema, scan);
    this.recordRange(scan, input, suffix, visible, returned, visible.slice(take), stop);
    return { Array: returned.map(clone) };
  }

  private merge(merge: any): Value {
    // execute validates certificate identity before any expression can reach a merge.
    const certificate = this.certificate;
    for (const lane of merge.lanes) validateScanCursor(this.schema, lane.scan, this.env);
    const lanes: any[] = [];
    const prefixes = new Set<string>();
    const directory = merge.held_search && this.store.heldDirectory(merge.held_search);
    let heldScopes: Value[][] | undefined;
    if (directory) {
      const d = merge.held_search, bound = d.discovery.scan.take;
      const term = d.term, source = asString(this.expr(term.source));
      // Scope values are not manufactured here: normalize just the declared derived slot.
      this.search.atom(this.store.index(d.table, d.index).parts[d.scope.length], { WordPrefix: { source, contract: term.contract } }, term.source_max);
      const maximum = bound.Literal ?? asInt(this.context.args[bound.Arg.name]);
      if (!Number.isSafeInteger(maximum) || maximum < 0 || (bound.Arg && maximum > bound.Arg.max)) fail("E_FANOUT", "discovery bound exceeded");
      const selected = directory.select(directory.fixed.map((i: number) => this.expr(d.scope[i].value)), maximum);
      this.held = true;
      if (selected.missing) { this.partial.add('missing-authority'); return { Array: [] }; }
      heldScopes = selected.scopes;
      if (selected.overflow) this.trace.merges.push({ site: merge.site, deduplicated_union_len: (d.take.Literal ?? d.take.Arg.max) + 1, last_returned_suffix: null });
    }
    for (const lane of merge.lanes) {
      const source = heldScopes ? heldScopes.map(Array => ({ Array }) as Value) : lane.source ? asArray(this.scan(lane.source)) : ["Null" as Value];
      const previous = this.env.get(lane.binding);
      for (const row of source) {
        if (lane.source && !heldScopes) this.env.set(lane.binding, row);
        const env = lane.setup?.length ? new Map(this.env) : null;
        const consts = lane.setup?.length ? new Set(this.consts) : null;
        this.statements(lane.setup ?? []);
        const input = this.scanInput(lane.scan, heldScopes ? asArray(row) : undefined);
        if (env) { this.env.clear(); for (const [key, value] of env) this.env.set(key, value); }
        if (consts) { this.consts.clear(); for (const key of consts) this.consts.add(key); }
        const r = input.evaluatedRange;
        const key = canonicalJson([logicalKey(input.logical), input.after, input.before,
          r ? [r.gt, r.gte, r.lt, r.lte] : null]);
        if (prefixes.has(key)) continue;
        prefixes.add(key);
        const read = certificate.read_sites.find((s: any) => s.site === lane.scan.site);
        if (!read) fail("E_TRACE_SUBSET", `undeclared merge lane ${lane.scan.site}`);
        const table = this.schema.tables[lane.scan.table];
        const publicRule = this.context.viewer === coreIrContract.systemPrincipalId
          || ["Allow", "Public"].includes(variant(table.rules.read)[0]);
        const values = this.store.seek(lane.scan.table, lane.scan.index, input.logical, input.after,
          input.before, input.evaluatedRange, lane.scan.order);
        lanes.push({ scan: lane.scan, input, values, read,
          uniform: read.hoist || publicRule, allowed: publicRule ? true : undefined,
          exhausted: false, visible: [], returned: [] });
      }
      if (previous !== undefined) this.env.set(lane.binding, previous); else this.env.delete(lane.binding);
    }
    const first = merge.lanes[0].scan;
    // The first distinct lane evaluates the shared bound; certification prices
    // the first static lane's maximum, also used when discovery opens no lanes.
    const take = lanes[0]?.input.take ?? first.take.Literal ?? first.take.Arg.max;
    const step = (): void => this.step();
    const next = lanes.map((lane) => (): Value | null => {
      while (!lane.exhausted && (this.trace.examined ?? 0) < certificate.max_examined) {
        if (lane.allowed === undefined && certificate.max_rule_probes - (this.trace.rule_probes ?? 0)
          < (lane.read.rule_probes_per_candidate ?? 0)) return null;
        step();
        const next = lane.values.next();
        if (next.done) { lane.exhausted = true; return null; }
        this.trace.examined = (this.trace.examined ?? 0) + 1;
        const row = next.value;
        const allowed = lane.allowed ?? this.checkRule(lane.scan.table, "read", null, row);
        if (lane.uniform) lane.allowed = allowed;
        if (!allowed) {
          if (lane.uniform) { lane.exhausted = true; return null; }
          continue;
        }
        lane.visible.push(row);
        return row;
      }
      return null;
    });
    const suffix = cursorSuffix(this.schema, first);
    const result = mergeStreams(next, suffix.map((c) => c.name), first.order, take, step,
      (lane, row) => lanes[lane].returned.push(row));
    for (const lane of lanes) {
      const remaining = mergeRemainder(lane.visible, lane.returned);
      this.recordRange(lane.scan, lane.input, suffix, lane.visible, lane.returned, remaining,
        lane.exhausted && remaining.length === 0 ? 'exhausted' : 'limit');
    }
    const page: any = Object.values(this.certificate.result_pages ?? {}).find((page: any) => page.merge && page.site === merge.site);
    this.trace.merges.push({ site: merge.site, deduplicated_union_len: result.union,
      last_returned_suffix: page?.merge && page.site === merge.site && result.rows.length
        ? suffix.map((c) => clone(field(result.rows.at(-1)!, c.name))) : null });
    return { Array: result.rows.map(clone) };
  }

  /** Scans and merge lanes disclose the same immutable row/halo receipt shape. */
  private recordRange(scan: any, input: any, suffix: ReturnType<typeof cursorSuffix>, visible: Value[],
    returned: Value[], remaining: Value[], stop: 'limit' | 'exhausted'): void {
    const { prefix, take, after, before, evaluatedRange } = input;
    for (const row of visible) this.pool(scan.table, row);
    const range: TraceRange = {
      halo: remaining[0] ? { table: scan.table, id: asString(field(remaining[0], "id")) } : null,
      n2_suffix: remaining[1] ? suffix.map(c => field(remaining[1], c.name)) : null,
      site: scan.site,
      table: scan.table,
      index: scan.index,
      ...(typeof scan.provenance === "string" ? { provenance: scan.provenance } : {}),
      prefix,
      order: scan.order,
      take,
      after,
      before,
      gt: evaluatedRange?.gt ?? null,
      gte: evaluatedRange?.gte ?? null,
      lt: evaluatedRange?.lt ?? null,
      lte: evaluatedRange?.lte ?? null,
      rule_hash: this.ruleHash(this.schema.tables[scan.table].rules.read),
      stop,
      lastReturnedSuffix: returned.length === 0 ? null
        : suffix.map((column) => clone(field(returned[returned.length - 1]!, column.name))),
    };
    range.stop = this.store.rangeStop(range, input.logical);
    this.trace.ranges.push(range);
  }

  private evaluateRange(range: any): any {
    return {
      gt: range.gt === null ? null : this.expr(range.gt),
      gte: range.gte === null ? null : this.expr(range.gte),
      lt: range.lt === null ? null : this.expr(range.lt),
      lte: range.lte === null ? null : this.expr(range.lte),
    };
  }

  private insert(table: string, row: Value, ifAbsent = false): boolean {
    row = materializeOptionalFields(this.schema, table, row);
    validateWriteRow(this.schema, table, row);
    if (!this.checkRule(table, "insert", null, row))
      fail("E_RULE", `${table} insert`);
    if (ifAbsent) {
      const definition = this.schema.tables[table];
      const indexes = new Set<string>(Object.entries(definition.indexes).filter(([, value]: any) => value.unique).map(([name]) => name));
      for (const constraint of definition.constraints ?? []) if (constraint.Unique) indexes.add(constraint.Unique.index);
      let missing = false;
      for (const index of indexes) {
        const key = ordinaryColumns(definition.indexes[index]).map((name: string) => fieldOrNull(row, name));
        if (this.store.lookup(table, index, key) !== null) return false;
        if (!this.store.hasAbsence(table, index, key)) missing = true;
      }
      if (missing) { this.partial.add("missing-authority"); return false; }
    }
    this.checkConstraints(table, null, row, "insert");
    if (this.store.byId(table, asString(field(row, "id"))) !== null)
      fail("E_CONSTRAINT", `duplicate id on ${table}`);
    this.putRow(table, row, true);
    this.insertedRows.push({ table, row: clone(row) });
    this.ruleMemo.clear();
    this.maintain(table, null, row);
    const event = this.delivery?.event(table, row, this.context.now ?? 0);
    if (event) {
      this.putRow(event.table, event.row, true);
      this.maintain(event.table, null, event.row);
    }
    this.delivery?.changed(table);
    return true;
  }

  private update(table: string, key: Value, patch: Value): void {
    // @ref LLP 1019#6-receipts-with-receipts — certified acknowledgements need
    // live private membership authority, which no held receipt can establish.
    if (this.acknowledgement && table === `${this.acknowledgement}Receipts`) {
      this.partial.add('missing-authority'); this.authorityMissSerial++; return;
    }
    const old = this.store.byId(table, asString(key));
    if (old === null) {
      this.missingWriteRow(table, asString(key));
      return;
    }
    const object = { ...asObject(old), ...asObject(patch) };
    this.replace(table, key, rowValue(object), Object.keys(asObject(patch)));
  }

  private replace(table: string, key: Value, row: Value, fields?: string[]): void {
    const old = this.store.byId(table, asString(key));
    if (old === null) fail("E_INPUT", `missing ${table} row`);
    row = materializeOptionalFields(this.schema, table, row);
    validateWriteRow(this.schema, table, row);
    this.validateAddressedRowId(table, key, row);
    // @ref LLP 1001#9-schema-additions — update authority is one relation
    // evaluated once over the old and next row images.
    if (!this.checkRule(table, "update", old, row))
      fail("E_RULE", `${table} update`);
    this.checkConstraints(table, old, row, "update");
    this.putRow(table, row, false, fields);
    this.ruleMemo.clear();
    this.maintain(table, old, row);
    this.delivery?.changed(table);
  }

  private delete(table: string, id: string): void {
    const old = this.store.byId(table, id);
    if (old === null) {
      this.missingWriteRow(table, id);
      return;
    }
    if (!this.checkRule(table, "delete", null, old))
      fail("E_RULE", `${table} delete`);
    this.checkConstraints(table, old, old, "delete");
    this.removeRow(table, id);
    this.maintain(table, old, null);
    this.delivery?.changed(table);
  }

  // @ref LLP 1011#b3-one-missing-row-rule-no-id-in-an-upsert-row — preserve
  // the engine's held/absent/unheld distinction in the receipt-only twin.
  private missingWriteRow(table: string, id: string): void {
    if (!this.store.authorityAbsence(table, id)) {
      this.partial.add("missing-authority");
      this.authorityMissSerial += 1;
      return;
    }
    fail("E_REQUIRE", "program requirement failed", "NOT_FOUND");
  }

  // @ref LLP 1019#7-the-twin — receipt-only replay maintains aggregates only.
  // Delivery audiences/incarnations are authoritative; never derive their writes
  // from held membership rows. Own-event prediction is a separate contract.
  private maintain(source: string, old: Value | null, next: Value | null): void {
    for (const maintain of this.schema.maintains ?? []) {
      if (maintain.source !== source) continue;
      const changes = new Map<string, { group: Value[]; delta: bigint }>();
      const add = (row: Value, direction: number): void => {
        const address = this.maintainedGroup(maintain, row);
        const [kind, data] = variant(maintain.kind);
        const delta = kind === "Count"
          ? BigInt(direction)
          : BigInt(direction) * BigInt(asInt(field(address.source, data.of)));
        const prior = changes.get(address.idValue);
        if (prior) {
          prior.delta += delta;
        } else changes.set(address.idValue, { group: address.group, delta });
      };
      if (old !== null) add(old, -1);
      if (next !== null) add(next, 1);
      for (const [idValue, change] of changes)
        this.applyAggregateChange(maintain, idValue, change.group, change.delta);
    }
  }

  private maintainedGroup(maintain: any, source: Value): {
    source: Value;
    group: Value[];
    idValue: string;
  } {
    source = materializeOptionalFields(this.schema, maintain.source, source);
    const group = maintain.by.map((name: string) => clone(field(source, name)));
    return { source, group, idValue: canonicalValues(group) };
  }

  private applyAggregateChange(
    maintain: any,
    idValue: string,
    group: Value[],
    delta: bigint,
  ): void {
    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — maintained targets are engine-owned but still validated.
    const existing = this.store.byId(maintain.target, idValue);
    if (existing === null && !this.store.authorityAbsence(maintain.target, idValue)) {
      this.partial.add("missing-authority");
      this.authorityMissSerial += 1;
      this.unheldMaintainTargets.push(maintain.target);
      return;
    }
    const oldValue = existing === null ? 0 : asInt(field(existing, "value"));
    const exact = BigInt(oldValue) + delta;
    if (exact < BigInt(Number.MIN_SAFE_INTEGER) || exact > BigInt(Number.MAX_SAFE_INTEGER))
      fail("E_OVERFLOW", "integer overflow");
    const value = Number(exact);
    const empty = value === 0;
    if (empty) {
      if (existing !== null) {
        this.checkConstraints(maintain.target, existing, existing, "delete");
        this.removeRow(maintain.target, idValue);
      }
      return;
    }
    const object: Record<string, Value> = Object.assign(Object.create(null), {
      id: { Id: idValue },
      value: int(value),
    });
    maintain.by.forEach((name: string, index: number) => {
      object[name] = group[index];
    });
    const row = materializeOptionalFields(this.schema, maintain.target, rowValue(object));
    const effect = existing === null ? "insert" : "update";
    // Maintained targets are engine-owned. They bypass authored write rules
    // while retaining the same constraints and created-row provenance as Rust.
    validateWriteRow(this.schema, maintain.target, row);
    this.checkConstraints(maintain.target, existing, row, effect);
    this.putRow(maintain.target, row, existing === null);
    if (existing === null) this.insertedRows.push({ table: maintain.target, row: clone(row) });
    this.ruleMemo.clear();
  }

  private pool(table: string, row: Value): void {
    const id = asString(field(row, 'id')), key = JSON.stringify([table, id]);
    if (!this.pooled.has(key)) { this.pooled.add(key); (this.trace.rows ??= []).push({ table, id, row }); }
  }

  // @ref LLP 1012#7-writes-offline — trace assignments and created-point provenance survive every successful local write.
  /** Validation and authored authority stay with each caller; successful row writes
   * share trace merging and transaction-local created-point maintenance. */
  private putRow(table: string, row: Value, created: boolean, fields?: string[]): void {
    this.store.put(table, row);
    const id = asString(field(row, "id")), key = `${table}\0${id}`, prior = this.writes.get(key);
    // A later patch carries only its assignments. Rejected earlier intents cannot leak through a saved whole image.
    if (prior && !prior.fields) fields = undefined;
    else if (fields && prior?.fields) fields = [...new Set([...prior.fields, ...fields])];
    this.writes.set(key, { table, id, row: clone(row), ...(fields ? { fields } : {}) });
    if (created) this.createdRows.add(key);
    this.refreshCreatedPoints(table, row);
  }

  private removeRow(table: string, id: string): void {
    this.store.remove(table, id);
    this.writes.set(`${table}\0${id}`, { table, id, row: null });
    this.forgetCreatedPoints(table, id);
    this.ruleMemo.clear();
  }

  private validateAddressedRowId(table: string, key: Value, row: Value): void {
    requireRowIdentity(table, "addressed write", asString(key), asString(field(row, "id")));
  }

  private refreshCreatedPoints(table: string, row: Value): void {
    const rowId = asString(field(row, "id"));
    if (!this.createdRows.has(`${table}\0${rowId}`)) return;
    this.forgetCreatedPoints(table, rowId);
    for (const [index, definition] of Object.entries<any>(
      this.schema.tables[table]?.indexes ?? {},
    )) {
      if (definition.components.some((c: any) => "WordPrefixes" in c)) continue;
      this.createdPoints.push({
        table,
        index,
        key: canonicalValues(
          ordinaryColumns(definition).map((column: string) => fieldOrNull(row, column)),
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
        fail("E_CONSTRAINT", `${tableName} is appendOnly`);
      if (
        kind === "Immutable" &&
        effect === "update" &&
        data.fields.some(
          (name: string) => canonicalValue(field(old!, name)) !== canonicalValue(field(row, name)),
        )
      )
        fail("E_CONSTRAINT", `${tableName} immutable fields changed`);
      if (kind === "Unique" && effect !== "delete")
        this.checkUnique(tableName, data.index, old, row);
      if (kind === "Cap") {
        const entersGroup =
          effect === "insert" ||
          (effect === "update" && data.by.some((name: string) =>
            canonicalValue(field(old!, name)) !== canonicalValue(field(row, name))));
        if (!entersGroup) continue;
        const maintain = (this.schema.maintains ?? []).find((candidate: any) =>
          candidate.source === tableName &&
          variant(candidate.kind)[0] === "Count" &&
          candidate.by.length === data.by.length &&
          candidate.by.every((name: string, index: number) => name === data.by[index]),
        );
        if (maintain !== undefined) {
          const group = this.maintainedGroup(maintain, row);
          const countRow = this.store.byId(maintain.target, group.idValue);
          // A held count row, or an authoritatively proven absence (zero), is the
          // one-row probe the engine performs; an unheld, unproven row is not zero.
          const provenAbsent = countRow === null && this.store.authorityAbsence(maintain.target, group.idValue);
          if (countRow !== null || provenAbsent) {
            this.trace.examined = (this.trace.examined ?? 0) + 1;
            const count = countRow === null ? 0 : asInt(field(countRow, "value"));
            if (count >= data.max)
              fail("E_CONSTRAINT", `${tableName} cap ${data.max} reached for group (${data.by.join(", ")}) = ${canonicalValue({ Array: group.group })}`);
            continue;
          }
          // @ref LLP 1017#24-metering — an unheld, unproven maintained row is not
          // zero; retain the source-scan coverage test used before this fast path.
        }
        const entry = Object.entries<any>(table.indexes).find(([, index]) =>
          index.components.every((c: any) => "Column" in c) && startsWith(ordinaryColumns(index), data.by),
        );
        if (entry === undefined) fail("E_SCHEMA", "cap index missing");
        const prefix = data.by.map((name: string) => field(row, name));
        const existing = this.store.scan(
          tableName,
          entry[0],
          scalarAtoms(prefix),
          null,
          null,
          null,
          "Asc",
          data.max,
        );
        if (existing.length >= data.max)
          fail("E_CONSTRAINT", `${tableName} cap ${data.max} reached for group (${data.by.join(", ")}) = ${canonicalValue({ Array: prefix })}`);
        if (!this.store.hasCompleteRange(tableName, entry[0], prefix)) {
          this.partial.add(`${tableName}.${entry[0]}`);
        }
      }
      if (kind === "Text" && (effect === "insert" || effect === "update")) {
        const value = asObject(row)[data.field];
        if (value !== undefined && value !== "Null") {
          const text = asString(value);
          if (Array.from(text).length < (data.min ?? 0))
            fail(
              "E_CONSTRAINT",
              `${tableName}.${data.field} must contain at least ${data.min ?? 0} characters`,
            );
          const valid =
            data.format === undefined ||
            data.format === null ||
            (data.format === "handle" && /^[a-z0-9_]*$/.test(text)) ||
            (data.format === "url" && validHttpUrl(text));
          if (!valid)
            fail(
              "E_CONSTRAINT",
              `${tableName}.${data.field} has invalid ${String(data.format)} format`,
            );
        }
      }
    }
    for (const [indexName, index] of Object.entries<any>(table.indexes)) {
      if (effect !== "delete" && index.unique) this.checkUnique(tableName, indexName, old, row);
    }
  }

  private checkFinalConstraints(): void {
    for (const { table: sourceTable, row } of this.insertedRows) {
      for (const constraint of this.schema.tables[sourceTable]?.constraints ?? []) {
        const [kind, data] = variant(constraint);
        if (kind !== "FinalExistsOnInsert") continue;
        const key = data.key.map((term: any) => this.ruleTerm(term, null, row));
        if (this.store.lookup(data.table, data.index, key) === null)
          fail(
            "E_CONSTRAINT",
            `${sourceTable} insert requires final row at ${data.table}.${data.index}`,
          );
      }
    }
  }

  private checkUnique(table: string, indexName: string, old: Value | null, row: Value): void {
    const index = this.schema.tables[table].indexes[indexName];
    const key = ordinaryColumns(index).map((name: string) => fieldOrNull(row, name));
    const found = this.store.lookup(table, indexName, key);
    if (
      found !== null &&
      (old === null || asString(field(found, "id")) !== asString(field(old, "id")))
    )
      fail("E_CONSTRAINT", `sealed unique conflict on ${table}.${indexName}`);
    if (
      indexName !== "byId" &&
      found === null &&
      !this.store.hasAbsence(table, indexName, key) &&
      !this.store.hasCompleteRange(table, indexName, key)
    ) {
      this.partial.add(`${table}.${indexName}`);
    }
  }

  readAuthority(table: string, row: Value, scopeFields?: string[]): boolean | null {
    const previous = this.authorityFields; this.authorityFields = scopeFields;
    try { const result = this.checkRule(table, 'read', null, row); return this.partial.size ? null : result; }
    finally { this.authorityFields = previous; }
  }

  private checkRule(
    table: string,
    effect: "read" | "insert" | "update" | "delete",
    old: Value | null,
    next: Value,
  ): boolean {
    // @ref LLP 1012#5-retention-revocation-and-the-fence — under `retain
    // delivered-history` a held row is readable to the twin: delivery was the
    // authorization, so the kept row renders under local evaluation too.
    if (effect === "read" && this.store.readable(table)) return true;
    const rule = this.schema.tables[table].rules[effect];
    const authorityMissSerial = this.authorityMissSerial;
    const outer = this.pendingVerdicts;
    this.pendingVerdicts = [];
    const allowed = this.evaluateRule(
      rule,
      this.ruleHash(rule),
      old,
      next,
      effect === "insert",
    ) && this.authorityMissSerial === authorityMissSerial;
    // Only a check that disclosed its row leaves verdicts on the trace: the
    // server discards the rule inputs a hidden candidate minted, so a traced
    // verdict from a failed check would be one nothing at commit derived.
    if (allowed) {
      for (const verdict of this.pendingVerdicts) {
        const key = `${verdict.rule_hash}\0${verdict.inputs_digest}\0${verdict.result}`;
        if (this.tracedVerdicts.has(key)) continue;
        this.tracedVerdicts.add(key);
        this.trace.verdicts.push(verdict);
      }
    }
    this.pendingVerdicts = outer;
    return allowed;
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
        // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — absence and authorization are authority-only.
        const key = data.key.map((term: any) => this.ruleTerm(term, old, next));
        // The verdict's inputs digest as the wire defines it: `sha256(canonical([table, index, key]))` (LLP 1012 §7).
        const pinnedDigest = sha256(canonicalJson([data.table, data.index, key.map(wireJson)]));
        const memoKey = `${ruleHash}:${pinnedDigest}`;
        const memoized = this.ruleMemo.get(memoKey);
        if (memoized !== undefined) {
          this.pendingVerdicts.push({ rule_hash: ruleHash, inputs_digest: pinnedDigest, result: memoized });
          return memoized;
        }
        if (!this.ruleInputIsReadable(data)) {
          // @ref LLP 1001#2-what-a-commit-records — held rows cannot replace authority-only verdicts.
          const verdict = this.store.verdict(ruleHash, pinnedDigest, this.context);
          if (verdict !== null) {
            this.ruleMemo.set(memoKey, verdict);
            this.pendingVerdicts.push({ rule_hash: ruleHash, inputs_digest: pinnedDigest, result: verdict });
            return verdict;
          }
          this.partial.add("missing-authority");
          this.authorityMissSerial += 1;
          return false;
        }
        const found = this.store.lookup(data.table, data.index, key);
        this.trace.rule_probes = (this.trace.rule_probes ?? 0) + 1;
        if (found === null && !this.store.hasAbsence(data.table, data.index, key)) {
          this.partial.add(`${data.table}.${data.index}`);
          this.ruleMemo.set(memoKey, false);
          return false;
        }
        const result = found !== null;
        if (found) this.pool(data.table, found);
        this.ruleMemo.set(memoKey, result);
        this.pendingVerdicts.push({ rule_hash: ruleHash, inputs_digest: pinnedDigest, result });
        return result;
      }
      case "Created": {
        if (!createdAllowed)
          fail(
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
        fail("E_OPAQUE", `unsupported rule ${kind}`);
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
        const left = substituteRuleTerm(data[0], ordinaryColumns(index), probe.key);
        const right = substituteRuleTerm(data[1], ordinaryColumns(index), probe.key);
        return left !== null && right !== null && canonicalJson(left) === canonicalJson(right);
      }
      if (kind === "And") return data.length > 0 && data.every(prove);
      if (kind === "Or") return data.some(prove);
      if (kind === "Exists" && data.table === probe.table && data.index === probe.index) {
        const key = data.key.map((term: any) => substituteRuleTerm(term, ordinaryColumns(index), probe.key));
        return key.every((term: any) => term !== null) && canonicalJson(key) === canonicalJson(probe.key);
      }
      return false;
    };
    return prove(table.rules.read);
  }

  private ruleTerm(term: any, old: Value | null, next: Value): Value {
    const [kind, data] = variant(term);
    if (kind === "Field") {
      // A representative row can authorize its whole search scope only through scope-bound fields.
      if (this.authorityFields && !this.authorityFields.includes(data)) {
        this.partial.add('missing-authority'); this.authorityMissSerial++; return 'Null';
      }
      return clone(field(next, data));
    }
    if (kind === "NextField") {
      if (old === null)
        fail("E_SCHEMA", "next-row rule term evaluated outside an update rule");
      return clone(field(next, data));
    }
    if (kind === "OldField") {
      if (old === null)
        fail("E_SCHEMA", "old-row rule term evaluated outside an update rule");
      return clone(field(old, data));
    }
    if (kind === "Viewer") return { Id: this.context.viewer };
    if (kind === "Literal") return clone(data);
    fail("E_OPAQUE", `unsupported rule term ${kind}`);
  }

  private requiredEnv(name: string): Value {
    const value = this.env.get(name);
    if (value === undefined) fail("E_INPUT", `unknown variable ${name}`);
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

function mintNext(viewer: string, certificate: any, trace: Trace, path: string | null): string | null {
  const page = path === null ? undefined : certificate?.result_pages?.[path];
  if (!page || !queryCapped(certificate, trace, viewer)) return null;
  const values = page.merge
    ? trace.merges.slice().reverse().find((entry) => entry.site === page.site)?.last_returned_suffix
    : trace.ranges.slice().reverse().find((entry) => entry.site === page.site)?.lastReturnedSuffix;
  if (values === null || values === undefined) return null;
  return encodeCursor({
    table: page.table,
    index: page.index,
    order: page.order,
    suffix: page.suffix,
    values,
  });
}

/** The wire state a query run reports: `capped` exactly when the engine's `query_state` says so. */
export function queryState(certificate: any, trace: Trace, viewer: string): "complete" | "capped" {
  return queryCapped(certificate, trace, viewer) ? "capped" : "complete";
}

function queryCapped(certificate: any, trace: Trace, viewer: string): boolean {
  // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — owner reads skip rules; execution and merge bounds still bind.
  const system = viewer === coreIrContract.systemPrincipalId;
  if (!system && certificate.completeness === "Capped") return true;
  if (trace.ranges.some((range) => range.stop === "limit"
      || (!system && !certificate.read_sites?.find((site: any) => site.site === range.site)?.hoist))) return true;
  return (certificate.merge_sites ?? []).some((site: any) => {
    const merge = trace.merges.find((entry) => entry.site === site.site);
    const unionTooLarge = merge !== undefined && merge.deduplicated_union_len > site.take;
    const laneLimited = trace.ranges.some((range) => site.lane_sites.includes(range.site) && range.stop !== "exhausted");
    return unionTooLarge || laneLimited;
  });
}

/** Identity is checked at the direct execution boundary, including prediction. */
export function validateCertificate(schema: any, program: any, certificate: any): void {
  if (!certificate) fail('E_TRACE_SUBSET', 'a bound certificate is required');
  if (certificate.value_model_version !== CURRENT_VALUE_MODEL_VERSION)
    fail('E_TRACE_SUBSET', 'value model version mismatch');
  if (certificate.evaluator_version !== CURRENT_EVALUATOR)
    fail('E_TRACE_SUBSET', 'evaluator version mismatch');
  if (certificate.schema_hash !== sha256(canonicalSchemaJson(schema)))
    fail('E_TRACE_SUBSET', 'schema hash mismatch');
  if (certificate.plan_hash !== sha256(canonicalProgramJson(program)))
    fail('E_TRACE_SUBSET', 'plan hash mismatch');
}
