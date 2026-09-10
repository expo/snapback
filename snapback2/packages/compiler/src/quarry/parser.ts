import { SEARCH_CONTRACT } from "../index-components";
import type { IndexComponent } from "../ir";
import type {
  ArgDecl,
  ChannelDecl,
  ColumnDecl,
  DeliverDecl,
  Document,
  Expr,
  FunctionDecl,
  FunctionImport, ProcDecl, ProcImport,
  IndexDecl,
  KeyPart,
  MaintainDecl,
  MergeExpr,
  MergeLane,
  ObjectField,
  ProgramDecl,
  RuleDecl,
  ScalarType,
  ScheduleDecl,
  ShapeDecl,
  ShapeField,
  ShapeImport,
  Site,
  Stmt,
  TableDecl,
  TombstoneDecl,
} from "./ast";
import type { QuarryDiagnostic } from "./ast";
import { QuarryError, currentRule, refuse, retention, syntax, tombstone, unsupported } from "./diagnostics";
import { lex, type Token, type TokenKind } from "./lexer";
import { quarryExpression } from "./print";

const PRECEDENCE = new Map<string, number>([
  ["??", 1], ["or", 2], ["and", 3],
  ["=", 4], ["!=", 4], ["<", 4], ["<=", 4], [">", 4], [">=", 4],
  ["+", 5], ["-", 5], ["*", 6], ["/", 6], ["%", 6],
]);

export function parseDocument(file: string, source: string): { document: Document; diagnostics: QuarryDiagnostic[] } {
  const lexical = lex(file, source);
  const parser = new Parser(lexical.tokens, file, lexical.diagnostics);
  return { document: parser.document(), diagnostics: parser.diagnostics };
}

class Parser {
  private position = 0;
  private readonly tables: TableDecl[] = [];
  private readonly maintains: MaintainDecl[] = [];
  private readonly channels: ChannelDecl[] = [];
  private readonly effects: Array<{ name: string; module: string; site: Site }> = [];
  private readonly shapes: ShapeDecl[] = [];
  private readonly shapeImports: ShapeImport[] = [];
  private readonly functions: FunctionDecl[] = [];
  private readonly functionImports: FunctionImport[] = [];
  private readonly procs: ProcDecl[] = [];
  private readonly procImports: ProcImport[] = [];
  private readonly programs: ProgramDecl[] = [];
  private readonly schedules: ScheduleDecl[] = [];
  private identity: Document["identity"];

  constructor(
    private readonly tokens: Token[],
    private readonly file: string,
    readonly diagnostics: QuarryDiagnostic[],
  ) {}

  document(): Document {
    while (!this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("eof")) break;
      try {
        const token = this.peek();
        if (this.at("use")) this.parseUse();
        else if (this.at("table")) this.tables.push(this.parseTable());
        else if (this.at("maintain")) this.maintains.push(this.parseMaintain());
        else if (this.at("channel")) this.channels.push(this.parseChannel());
        else if (this.at("query") || this.at("mutation") || this.at("job")) this.programs.push(this.parseProgram());
        else if (this.at("effect")) this.effects.push(this.parseEffect());
        else if (this.at("shape")) this.parseShapeDeclaration();
        else if (this.at("fn")) this.parseFunctionDeclaration();
        else if (this.at("proc")) this.parseProcDeclaration();
        else if (this.at("cursor")) unsupported(token, token.value, `${token.value} is reserved for a future Quarry form; rename this declaration`);
        else if (this.at("schedule")) this.schedules.push(this.parseSchedule());
        else if (this.at("index") || this.at("unique")) syntax(token, "top-level indexes are invalid; place by/unique inside the table block", "move the index line into its table block");
        else if (this.at("device") || this.at("oblivious")) unsupported(token, token.value, "pass an explicit bounded argument to the operation");
        else syntax(token, `unexpected top-level ${JSON.stringify(token.value)}`);
      } catch (error) {
        this.capture(error);
        this.recoverTopLevel();
      }
    }
    return {
      file: this.file,
      identity: this.identity,
      tables: this.tables,
      maintains: this.maintains,
      channels: this.channels,
      effects: this.effects,
      shapes: this.shapes,
      shapeImports: this.shapeImports,
      functions: this.functions,
      functionImports: this.functionImports,
      procs: this.procs,
      procImports: this.procImports,
      programs: this.programs,
      schedules: this.schedules,
    };
  }

  // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — one kind, row deadlines or whole-minute durations.
  private parseSchedule(): ScheduleDecl {
    const site = this.take("schedule");
    const name = this.bindingName();
    let trigger: ScheduleDecl["trigger"];
    let predicate: Expr | undefined;
    if (this.at("on")) {
      this.take("on");
      const table = this.word().value;
      this.take("at"); this.take(".");
      const column = this.word().value;
      trigger = { row: { table, column } };
      if (this.at("if")) { this.take("if"); predicate = this.expression(0, new Set([":"])); }
    } else {
      const durationError = () => { throw new QuarryError(site, "schedule periods are whole Nm, Nh, or Nd, at least one minute", "E_SCHEDULE_DURATION", "schedule dailyDigest every 24h: digestSweep()", "schedule"); };
      if (!this.at("every")) durationError();
      this.take("every");
      if (!this.atKind("number")) durationError();
      const amount = Number(this.takeKind("number").value);
      const unit = this.peek().value;
      if (!this.atKind("word") || !["m", "h", "d"].includes(unit)) durationError();
      this.word();
      const durationMs = amount * ({ m: 60000, h: 3600000, d: 86400000 }[unit]!);
      if (!Number.isInteger(amount) || amount < 1 || !Number.isSafeInteger(durationMs) || !this.at(":")) durationError();
      trigger = { every: { durationMs } };
    }
    this.take(":");
    // @ref LLP 1019#3-what-writes-it — emit an ordinary private target ahead
    // of binding; the owner keeps its existing schedule transaction.
    if (this.at("delete")) {
      this.take("delete");
      const rewrite = `schedule ${name} on ${"row" in trigger ? trigger.row.table : "messages"} at .${"row" in trigger ? trigger.row.column : "expiresAt"}: delete .`;
      if (!("row" in trigger) || !this.at(".")) throw new QuarryError(site, "schedule delete requires a row trigger and exactly delete .", "E_SCHEDULE_TARGET", rewrite, "schedule");
      this.take(".");
      if (!this.atKind("newline") && !this.atKind("eof")) throw new QuarryError(site, "schedule delete accepts only its trigger row", "E_SCHEDULE_TARGET", rewrite, "schedule");
      this.newline();
      return { name, trigger, target: "delete", args: [], predicate, site };
    }
    let target = this.word().value;
    if (this.at(".")) { this.take("."); target += "." + this.word().value; }
    const args: Expr[] = [];
    this.take("(");
    while (!this.at(")")) {
      args.push(this.expression(0, new Set([",", ")"])));
      if (!this.at(",")) break;
      this.take(",");
    }
    this.take(")");
    this.newline();
    return { name, trigger, target, args, predicate, site };
  }

  private parseUse(): void {
    const site = this.take("use");
    const kind = this.word();
    if (kind.value !== "identity") unsupported(kind, `use ${kind.value}`, "use identity password, use identity guests, or use identity");
    let password = true;
    let guests = true;
    if (this.at("password")) { this.take("password"); guests = false; }
    else if (this.at("guests")) { this.take("guests"); password = false; }
    this.identity = { password, guests };
    this.endLine(site);
  }

  private parseTable(): TableDecl {
    const site = this.take("table");
    const name = this.bindingName();
    this.take(":");
    this.newline();
    this.takeKind("indent");
    const columns: ColumnDecl[] = [];
    const indexes: IndexDecl[] = [];
    const rules: RuleDecl[] = [];
    const immutable: Array<{ columns: string[]; site: Site }> = [];
    const finalExists: TableDecl["finalExists"] = [];
    const caps: TableDecl["caps"] = [];
    const tombstones: TombstoneDecl[] = [];
    let retain: TableDecl["retain"];
    let publicDecl: TableDecl["public"];
    let deliver: TableDecl["deliver"];
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      try {
        if (this.at("public")) {
          const publicSite = this.take("public");
          const reason = this.atKind("string") ? this.takeKind("string").value : `${name} is public in Quarry`;
          publicDecl = { reason, site: publicSite };
          this.newline();
        } else if (this.at("by")) indexes.push(this.parseIndex(false));
        else if (this.at("unique")) indexes.push(this.parseIndex(true));
        else if (this.at("immutable")) immutable.push(this.parseImmutable());
        else if (this.at("cap")) caps.push(this.parseCap());
        else if (this.at("retain")) {
          if (retain) retention(this.peek(), `table ${name} has more than one retain line`);
          retain = this.parseRetention();
        }
        else if (this.at("tombstones")) tombstones.push(this.parseTombstones());
        else if (this.at("deliver")) {
          if (deliver) syntax(this.peek(), `table ${name} has more than one deliver line`, "one deliver line per table");
          deliver = this.parseDeliver();
        }
        else if (this.at("after")) finalExists.push(this.parseFinalExists());
        else if (["read", "insert", "update", "delete"].includes(this.peek().value)) rules.push(this.parseRule());
        else columns.push(this.parseColumn());
      } catch (error) {
        this.capture(error);
        this.recoverLine();
      }
    }
    this.takeKind("dedent");
    return { name, columns, indexes, rules, immutable, caps, finalExists, tombstones, ...(retain ? { retain } : {}), ...(publicDecl ? { public: publicDecl } : {}), ...(deliver ? { deliver } : {}), site };
  }

  // @ref LLP 1019#1-the-declaration — one table-block line names the target
  // range, the principal column, the custody log, and its two options.
  private parseDeliver(): DeliverDecl {
    const site = this.take("deliver");
    const rewrite = "deliver to memberships[.conversationId] as deliveries";
    if (!this.maybe("to") || !this.atKind("word")) syntax(site, "deliver requires a target range: deliver to <table>[.<column>, ...] as <name>", rewrite);
    const target = this.word().value;
    if (!this.at("[")) syntax(site, `deliver to ${target} requires prefix keys over this table: ${target}[.column]`, rewrite);
    this.take("[");
    const prefix: string[] = [];
    do {
      if (!this.at(".") || this.peek(1).kind !== "word") syntax(site, `deliver to ${target}[...] takes .column prefix keys of this table`, rewrite);
      this.take(".");
      prefix.push(this.word().value);
    } while (this.maybe(","));
    this.take("]");
    let by: string | undefined;
    if (this.maybe("by")) {
      if (!this.at(".") || this.peek(1).kind !== "word") syntax(site, "deliver by names the target's principal column as .column", "deliver to memberships[.conversationId] by .principal as deliveries");
      this.take(".");
      by = this.word().value;
    }
    if (!this.maybe("as") || !this.atKind("word")) syntax(site, "deliver requires as <name> for its custody log", rewrite);
    const name = this.word().value;
    let receipts = false;
    let bootstrap = false;
    while (!this.atKind("newline") && !this.atKind("eof")) {
      if (this.maybe("with")) {
        if (!this.maybe("receipts")) syntax(site, "deliver ... with takes receipts", `${rewrite} with receipts`);
        receipts = true;
      } else if (this.maybe("bootstrap")) bootstrap = true;
      else syntax(site, `unexpected ${this.peek().value} after as ${name}; deliver accepts with receipts and bootstrap`, rewrite);
    }
    this.newline();
    return { target, prefix, ...(by === undefined ? {} : { by }), name, receipts, bootstrap, site };
  }

  // @ref LLP 1012#5-retention-revocation-and-the-fence — rule 3's word: a delivered
  // log row names the body the client evicts; the predicate reuses the rule grammar.
  private parseTombstones(): TombstoneDecl {
    const site = this.take("tombstones");
    const rewrite = "tombstones messages[.messageId] if .kind = 'removed'";
    if (!this.atKind("word")) tombstone(site, "tombstones requires a target table: tombstones <table>[.<column>] if <predicate>", rewrite);
    const table = this.word().value;
    if (!this.at("[") || this.peek(1).value !== "." || this.peek(2).kind !== "word" || this.peek(3).value !== "]") {
      tombstone(site, `tombstones ${table} requires the referencing column of this table as [.column]`, rewrite);
    }
    this.take("["); this.take(".");
    const column = this.word().value;
    this.take("]");
    if (!this.at("if")) tombstone(site, `tombstones ${table}[.${column}] requires if <predicate> over this table's enum, bool, or text columns`, rewrite);
    this.take("if");
    const predicate = this.expression(0, new Set(["<newline>"]));
    this.newline();
    return { table, column, predicate: currentRule(predicate), site };
  }

  private parseRetention(): NonNullable<TableDecl["retain"]> {
    const site = this.take("retain");
    if (!this.atKind("word")) retention(site, "retain requires a policy word");
    const policy = this.word();
    if (policy.value !== "until-revoked" && policy.value !== "delivered-history") {
      retention(site, `unknown retention policy ${policy.value}`);
    }
    if (!this.atKind("newline")) retention(site, "retain accepts exactly one policy word");
    this.newline();
    return { policy: policy.value, site };
  }

  private parseCap(): TableDecl["caps"][number] {
    const site = this.take("cap");
    const rewrite = "cap 50 by <cols>";
    const token = this.peek();
    if (token.kind !== "number" || !/^\d+$/.test(token.value)) {
      syntax(site, "cap requires an integer literal from 1 through 4294967295", rewrite);
    }
    const max = Number(this.takeKind("number").value);
    if (max < 1 || max > 0xffff_ffff) syntax(site, "cap requires an integer literal from 1 through 4294967295", rewrite);
    if (!this.maybe("by") || !this.atKind("word")) syntax(site, "cap requires non-empty grouping columns", rewrite);
    const by = [this.word().value];
    while (this.maybe(",")) {
      if (!this.atKind("word")) syntax(site, "cap requires a column after the comma", rewrite);
      by.push(this.word().value);
    }
    this.newline();
    return { max, by, site };
  }

  private parseImmutable(): { columns: string[]; site: Site } {
    const site = this.take("immutable");
    const columns = [this.word().value];
    while (this.maybe(",")) columns.push(this.word().value);
    this.newline();
    return { columns, site };
  }

  private parseFinalExists(): TableDecl["finalExists"][number] {
    const site = this.take("after");
    this.take("insert");
    const value = this.parseFocalRuleValue("after insert", site);
    if (value.kind !== "exists") syntax(value.site, "after insert requires exactly one exists predicate");
    this.newline();
    return { value, site };
  }

  private parseColumn(): ColumnDecl {
    const name = this.word();
    this.take(":");
    const type = this.parseType(true);
    if (type.kind === "cursor") syntax(name, "cursor is an operation argument type, not a table column", "use c: cursor ? on a query");
    this.newline();
    return { name: name.value, type, site: name };
  }

  private parseIndex(unique: boolean): IndexDecl {
    const site = this.take(unique ? "unique" : "by");
    let explicit: string | undefined;
    if (this.atKind("word") && this.peek(1).value === ":") {
      explicit = this.word().value;
      this.take(":");
    }
    const component = (): IndexComponent => {
      const name = this.word();
      if (name.value !== "wordPrefixes" || !this.at("(")) return { Column: name.value };
      this.take("(");
      const fields: string[] = [];
      if (!this.at(")")) {
        fields.push(this.word().value);
        while (this.maybe(",")) fields.push(this.word().value);
      }
      this.take(")");
      return { WordPrefixes: { fields, contract: SEARCH_CONTRACT } };
    };
    const components = [component()];
    while (this.maybe(",")) components.push(component());
    const inferred = `by${components.map(c => "Column" in c ? title(c.Column) : `WordPrefixes${c.WordPrefixes.fields.map(title).join("")}`).join("")}`;
    // @ref LLP 1011#one-spelling — declarations name every index; inference is only a repair.
    if (!explicit) throw new QuarryError(site, "index declarations require an explicit name", "E_QUARRY_SYNTAX",
      `${unique ? "unique" : "by"} ${inferred}: ${components.map(c => "Column" in c ? c.Column : `wordPrefixes(${c.WordPrefixes.fields.join(", ")})`).join(", ")}`, undefined, true);
    this.newline();
    return { name: explicit, components, unique, site };
  }

  private parseMaintain(): MaintainDecl {
    const site = this.take("maintain");
    const name = this.bindingName();
    this.take(":");
    const aggregateToken = this.word();
    if (aggregateToken.value !== "count" && aggregateToken.value !== "sum") {
      unsupported(aggregateToken, `maintain ${aggregateToken.value}`, "use maintain name: count table by columns or maintain name: sum table of intColumn by columns");
    }
    const source = this.word().value;
    let column: string | undefined;
    if (aggregateToken.value === "sum") {
      this.take("of");
      column = this.word().value;
    }
    this.take("by");
    const by = [this.word().value];
    while (this.maybe(",")) by.push(this.word().value);
    this.newline();
    this.takeKind("indent");
    let read: RuleDecl | undefined;
    let readable: RuleDecl | undefined;
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      try {
        const effect = this.word();
        if (effect.value !== "read" && effect.value !== "readable") syntax(effect, `unknown maintain property ${effect.value}`);
        const value = this.parseFocalRuleValue(effect.value, effect);
        this.newline();
        const declaration: RuleDecl = { effect: "read", bindings: [], value, site: effect };
        if (effect.value === "read") read = declaration;
        else readable = declaration;
      } catch (error) {
        this.capture(error);
        this.recoverLine();
      }
    }
    this.takeKind("dedent");
    if (!read) syntax(site, `maintain ${name} requires read <- rule`);
    return { name, aggregate: aggregateToken.value as "count" | "sum", source, ...(column ? { column } : {}), by, read, ...(readable ? { readable } : {}), site };
  }

  private parseEffect(): { name: string; module: string; site: Site } {
    const site = this.take("effect");
    const name = this.bindingName();
    this.take("from");
    const module = this.word().value;
    this.newline();
    return { name, module, site };
  }

  private parseRule(): RuleDecl {
    const effectToken = this.word();
    const effect = effectToken.value as RuleDecl["effect"];
    let bindings: string[] = [];
    let value: Expr;
    if (this.at("(")) {
      this.take("(");
      bindings = [this.bindingName()];
      while (this.maybe(",")) bindings.push(this.bindingName());
      this.take(")");
      if (effect !== "update" || bindings.length !== 2) {
        syntax(effectToken, `${effect} rules use <- for one row; only update (old, next) has named bindings`, `rewrite the ${effect} rule with <- and direct .field terms`);
      }
      this.take("<-");
      value = this.expression(0, new Set(["<newline>"]));
    } else {
      value = this.parseFocalRuleValue(effect, effectToken);
    }
    this.newline();
    return { effect, bindings, value: currentRule(value), site: effectToken };
  }

  private parseFocalRuleValue(label: string, site: Site): Expr {
    if (this.maybe("<-")) return currentRule(this.expression(0, new Set(["<newline>"])));
    const binding = this.word().value;
    this.take("<-");
    const value = this.expression(0, new Set(["<newline>"]));
    syntax(
      site,
      `${label} rules use the focal row . and do not take a named single-row binding`,
      `${label} <- ${quarryExpression(focalizeRuleBinding(value, binding))}`,
    );
  }

  // @ref LLP 1001.000#declaration-and-value — one typed record per connection; repeated declarations never overwrite silently.
  private parseChannel(): ChannelDecl {
    const site = this.take("channel");
    const name = this.bindingName();
    const args = this.parseArgs();
    this.take(":");
    this.newline();
    this.takeKind("indent");
    let publish: Expr | undefined;
    let subscribe: Expr | undefined;
    let value: ArgDecl[] | undefined;
    let ttlSeconds: number | undefined;
    const properties = new Set<string>();
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      try {
        const key = this.word();
        if (properties.has(key.value)) throw new QuarryError(key, `duplicate channel property ${key.value}`,
          "E_QUARRY_SYNTAX", `keep one ${key.value} declaration`, "live-query");
        properties.add(key.value);
        if (key.value === "value") {
          this.take(":");
          this.take("{");
          const fields: ArgDecl[] = [];
          const names = new Set<string>();
          while (!this.at("}")) {
            const field = this.word();
            if (names.has(field.value)) throw new QuarryError(field, `duplicate channel value field ${field.value}`,
              "E_QUARRY_SYNTAX", `keep one ${field.value} field in value`, "live-query");
            names.add(field.value);
            this.take(":");
            fields.push({ name: field.value, type: this.parseType(), site: field });
            if (!this.maybe(",")) break;
          }
          this.take("}");
          if (fields.length === 0) throw new QuarryError(key, "channel value requires a nonempty record declaration",
            "E_QUARRY_SYNTAX", "value: { typing: bool }", "live-query");
          value = fields;
        } else if (key.value === "publish" || key.value === "subscribe") {
          this.take("<-");
          const value = this.expression(0, new Set(["<newline>"]));
          if (key.value === "publish") publish = currentRule(value);
          else subscribe = currentRule(value);
        } else if (key.value === "ttl") {
          const amount = this.number();
          this.take("s");
          if (!Number.isInteger(amount) || amount < 1 || amount > 30) throw new QuarryError(key,
            "channel ttl must be an integer from 1 through 30 seconds", "E_QUARRY_SYNTAX", "ttl 4s", "live-query");
          ttlSeconds = amount;
        } else {
          syntax(key, `unknown channel property ${key.value}`);
        }
        this.newline();
      } catch (error) {
        this.capture(error);
        this.recoverLine();
      }
    }
    this.takeKind("dedent");
    if (!value) throw new QuarryError(site, `channel ${name} requires value: { field: type }`,
      "E_QUARRY_SYNTAX", "value: { typing: bool }", "live-query");
    if (!publish) syntax(site, `channel ${name} requires publish <- ...`);
    if (!subscribe) syntax(site, `channel ${name} requires subscribe <- ...`);
    if (ttlSeconds === undefined) syntax(site, `channel ${name} requires ttl Ns`);
    return { name, args, value, publish, subscribe, ttlSeconds, site };
  }

  private parseProgram(): ProgramDecl {
    const kindToken = this.word();
    const kind = kindToken.value as ProgramDecl["kind"];
    const name = this.bindingName();
    const args = this.parseArgs();
    if (this.at("->")) unsupported(this.peek(), "result annotations", "results are inferred; remove the annotation");
    this.take(":");
    this.newline();
    const body = kind === "job" ? this.parseChunks() : this.parseBlock();
    if (body.length === 0) syntax(kindToken, `${kind} ${name} has an empty body`);
    return { kind, name, args, body, site: kindToken };
  }

  // @ref LLP 1016#d2--a-job-is-a-sequence-of-sweeps — only independent bounded sweeps may appear at job scope.
  private parseChunks(): Stmt[] {
    this.takeKind("indent");
    const chunks: Stmt[] = [];
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      const site = this.take("chunk");
      const name = this.bindingName();
      this.take("in");
      const table = this.word();
      let domain: Expr = this.at("[") ? this.parseRead(table.value, table) : { kind: "read", table: table.value, keys: [], site: table };
      if (!this.at("first")) syntax(this.peek(), "chunk requires first N by index");
      domain = this.parseRange(domain as Extract<Expr, { kind: "read" }>);
      if (domain.kind !== "read" || !domain.index || domain.range?.order !== "asc" || domain.range.cursor) syntax(site, "chunk requires table[prefix] first N by index");
      this.take(":");
      this.newline();
      const body = this.parseBlock();
      if (body.length === 0) syntax(site, "chunk body cannot be empty");
      chunks.push({ kind: "for", name, domain, body, site });
    }
    this.takeKind("dedent");
    return chunks;
  }

  private parseShapeDeclaration(): void {
    const site = this.take("shape");
    const name = this.bindingName();
    if (this.maybe("from")) {
      const module = this.word().value;
      this.newline();
      this.shapeImports.push({ name, module, site });
      return;
    }
    this.take("=");
    this.take("{");
    const fields = this.parseShapeFields();
    this.take("}");
    this.newline();
    this.shapes.push({ name, fields, site });
  }

  private parseFunctionDeclaration(): void {
    const site = this.take("fn");
    const name = this.bindingName();
    if (this.maybe("from")) {
      const module = this.word().value;
      this.newline();
      this.functionImports.push({ name, module, site });
      return;
    }
    const args = this.parseArgs();
    this.take(":");
    const body = this.expression(0, new Set(["<newline>"]));
    this.newline();
    this.functions.push({ name, args, body, site });
  }

  // @ref LLP 1018.005#1-grammar — `proc name(args):` and an indented block, or `proc name from module`.
  private parseProcDeclaration(): void {
    const site = this.take("proc");
    const name = this.bindingName();
    if (this.maybe("from")) {
      const module = this.word().value;
      this.newline();
      this.procImports.push({ name, module, site });
      return;
    }
    const args = this.parseArgs();
    this.take(":");
    this.newline();
    this.procs.push({ name, args, body: this.parseBlock(), site });
  }

  private bindingName(): string {
    const token = this.word();
    if (["until-revoked", "delivered-history"].includes(token.value)) syntax(token, "retention policy words cannot name bindings", "use an identifier without a hyphen");
    return token.value;
  }

  private parseArgs(): ArgDecl[] {
    this.take("(");
    const args: ArgDecl[] = [];
    while (!this.at(")")) {
        const name = this.peek();
        const binding = this.bindingName();
        this.take(":");
        args.push({ name: binding, type: this.parseType(), site: name });
        if (!this.maybe(",")) break;
    }
    this.take(")");
    return args;
  }

  private parseType(column = false): ScalarType {
    const site = this.peek();
    let type: ScalarType;
    if (this.maybe("[")) {
      const item = this.parseType(column);
      this.take("]");
      this.take("<=");
      type = { kind: "list", item, max: this.number(), optional: false };
    } else {
      const name = this.word();
      if (name.value === "text") {
        let min: number | undefined;
        let max: number;
        if (this.maybe("<=")) max = this.number();
        else {
          min = this.number();
          this.take(".");
          this.take(".");
          max = this.number();
        }
        let format: "handle" | "url" | undefined;
        if (this.maybe("format")) {
          const value = this.word();
          if (value.value !== "handle" && value.value !== "url") syntax(value, `unknown text format ${value.value}`,
            `use text ${min === undefined ? `<=${max}` : `${min}..${max}`} format handle or text ${min === undefined ? `<=${max}` : `${min}..${max}`} format url`);
          format = value.value;
        }
        type = { kind: "text", ...(min === undefined ? {} : { min }), max, ...(format ? { format } : {}), optional: false };
      } else if (name.value === "decimal") {
        type = { kind: "decimal", scale: this.scale("decimal 12"), optional: false };
      } else if (name.value === "money") {
        const currency = this.word();
        if (!/^[A-Z]{3}$/.test(currency.value)) {
          syntax(currency, "money currency must be exactly three uppercase letters", "use money USD or money USD 2");
        }
        const explicitScale = this.atKind("number");
        type = {
          kind: "money",
          currency: currency.value,
          scale: explicitScale ? this.scale(`money ${currency.value} 12`) : 2,
          ...(explicitScale ? { explicitScale: true } : {}),
          optional: false,
        };
      } else if (["json", "bytes", "image", "video"].includes(name.value)) {
        this.take("<=");
        type = { kind: name.value as "json" | "bytes" | "image" | "video", max: this.number(), optional: false };
      } else if (["cursor", "id", "principal", "int", "time", "bool"].includes(name.value)) {
        type = { kind: name.value as "cursor" | "id" | "principal" | "int" | "time" | "bool", optional: false };
      } else if (name.value === "enum") {
        this.take("(");
        const variants: string[] = [];
        while (!this.at(")")) {
          variants.push(this.takeKind("string").value);
          if (!this.maybe(",")) break;
        }
        this.take(")");
        type = { kind: "enum", variants, optional: false };
      } else {
        type = { kind: "ref", table: name.value, optional: false };
      }
    }
    if (this.maybe("once")) {
      if (!column) syntax(site, "once is a column modifier, not an argument constraint",
        "remove once from this argument; declare image <=10000000 once on the owning table column");
      if (type.kind === "video") syntax(site, "once is only specified for image columns; video ranges are unspecified",
        "use photo: image <=10000000 once, or remove once from the video column until ranges are specified");
      if (type.kind !== "image") syntax(site, "once is only specified for image columns",
        `remove once from this ${type.kind} column; use image <=10000000 once for one-use images`);
      type = { ...type, once: true };
    }
    if (this.maybe("?")) type = { ...type, optional: true };
    if (type.kind === "list" && type.item.optional) syntax(site, "list element types cannot be optional");
    return type;
  }

  private parseBlock(): Stmt[] {
    this.takeKind("indent");
    const body: Stmt[] = [];
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      try {
        body.push(this.parseStatement());
      } catch (error) {
        this.capture(error);
        this.recoverStatement();
      }
    }
    this.takeKind("dedent");
    return body;
  }

  private parseStatement(): Stmt {
    if (this.at("while")) unsupported(this.peek(), "while", "use a bounded for domain or walk");
    if (this.at("if")) return this.parseIf();
    if (this.at("for")) return this.parseFor();
    if (this.at("require")) return this.parseRequire();
    if (this.at("return")) {
      const site = this.take("return");
      const value = this.expression(0, new Set(["<newline>"]));
      if (value.kind !== "merge") this.newline();
      return { kind: "return", value, site };
    }
    if (this.at("emit")) {
      const site = this.take("emit");
      const effect = this.word().value;
      const payload = this.expression(0, new Set(["<newline>"]));
      this.newline();
      return { kind: "emit", effect, payload, site };
    }
    if (this.at("device") || this.at("oblivious")) unsupported(this.peek(), this.peek().value, "pass an explicit bounded argument to the operation");

    if (this.atKind("word") && this.peek(1).value === "=") {
      const name = this.peek();
      const binding = this.bindingName();
      this.take("=");
      const value = this.expression(0, new Set(["<newline>"]));
      if (value.kind !== "merge") this.newline();
      return { kind: "bind", names: [binding], value, site: name };
    }
    if (this.at("(") && this.tupleBindingAhead()) {
      const site = this.take("(");
      const names = [this.bindingName()];
      while (this.maybe(",")) names.push(this.bindingName());
      this.take(")");
      this.take("=");
      const value = this.expression(0, new Set(["<newline>"]));
      this.newline();
      return { kind: "bind", names, value, site };
    }
    const value = this.expression(0, new Set(["<newline>"]));
    if (value.kind !== "merge") this.newline();
    return { kind: "expr", value, site: value.site };
  }

  private parseIf(): Stmt {
    const site = this.take("if");
    const condition = this.expression(0, new Set([":"]));
    this.take(":");
    this.newline();
    const thenBody = this.parseBlock();
    let elseBody: Stmt[] = [];
    if (this.at("else")) {
      this.take("else");
      this.take(":");
      this.newline();
      elseBody = this.parseBlock();
    }
    return { kind: "if", condition, thenBody, elseBody, site };
  }

  private parseFor(): Stmt {
    const site = this.take("for");
    const name = this.bindingName();
    this.take("in");
    const domain = this.expression(0, new Set([":"]));
    this.take(":");
    this.newline();
    return { kind: "for", name, domain, body: this.parseBlock(), site };
  }

  private parseRequire(): Stmt {
    const site = this.take("require");
    const condition = this.expression(0, new Set(["else"]));
    this.take("else");
    const code = this.word().value;
    this.newline();
    return { kind: "require", condition, code, site };
  }

  private expression(minimum = 0, stops = new Set<string>()): Expr {
    let left = this.prefix(stops);
    for (;;) {
      const token = this.peek();
      if (this.isStop(token, stops)) break;
      const precedence = PRECEDENCE.get(token.value);
      if (precedence === undefined || precedence < minimum) break;
      this.position += 1;
      const right = this.expression(precedence + (token.value === "??" ? 0 : 1), stops);
      left = { kind: "binary", op: token.value, left, right, site: token };
    }
    return left;
  }

  private prefix(stops: Set<string>): Expr {
    const token = this.peek();
    if (token.value === "not") {
      this.position += 1;
      return this.postfix({ kind: "unary", op: "not", value: this.expression(7, stops), site: token }, stops);
    }
    if (token.value === "-" && !(this.peek(1).kind === "word" && this.peek(2).value === "[")) {
      this.position += 1;
      return this.postfix({ kind: "unary", op: "-", value: this.expression(7, stops), site: token }, stops);
    }
    if (token.value === "exists") {
      this.position += 1;
      const value = this.prefix(stops);
      if (value.kind !== "read" || value.range) syntax(value.site, "exists requires an indexed read t[key]");
      return { kind: "exists", read: value, site: token };
    }
    if (token.value === "created") {
      this.position += 1;
      const value = this.prefix(stops);
      if (value.kind !== "read" || value.range) syntax(value.site, "created requires an indexed read t[key]");
      return { kind: "created", read: value, site: token };
    }
    if (token.value === "walk") return this.parseWalk();
    // @ref LLP 1010#a1-words-for-writes — the four writes have one word form;
    // sigils are syntax errors rather than a compatibility lane.
    if (["insert", "update", "upsert", "delete"].includes(token.value)) return this.parseWrite();
    if ((token.value === "+" && (this.peek(1).kind === "word" || this.peek(1).value === "~"))
      || token.value === "~"
      || (token.value === "-" && this.peek(1).kind === "word" && this.peek(2).value === "[")) {
      syntax(token, "write sigils are invalid; use insert, update, upsert, or delete", "use insert, update, upsert, or delete");
    }
    if (token.value === "merge") return this.parseMerge();
    if (token.value === "device" || token.value === "oblivious") unsupported(token, token.value, "pass an explicit bounded argument to the operation");

    let value: Expr;
    if (token.kind === "string") {
      this.position += 1;
      value = { kind: "literal", value: token.value, site: token };
    } else if (token.kind === "number") {
      this.position += 1;
      value = { kind: "literal", value: Number(token.value), numericText: token.value, site: token };
    } else if (token.value === "true" || token.value === "false" || token.value === "null") {
      this.position += 1;
      value = { kind: "literal", value: token.value === "null" ? null : token.value === "true", site: token };
    } else if (token.value === ".") {
      this.position += 1;
      value = { kind: "focal", site: token };
      if (this.atKind("word")) value = { kind: "member", base: value, name: this.word().value, site: token };
    } else if (token.value === "[") {
      this.position += 1;
      const items: Expr[] = [];
      while (!this.at("]")) {
        items.push(this.expression(0, new Set([",", "]"])));
        if (!this.maybe(",")) break;
      }
      this.take("]");
      value = { kind: "array", items, site: token };
    } else if (token.value === "{") {
      value = { kind: "object", fields: this.parseObjectFields(), site: token };
    } else if (token.value === "(") {
      this.position += 1;
      const first = this.expression(0, new Set([",", ")"]));
      if (this.maybe(",")) {
        const items = [first];
        do {
          items.push(this.expression(0, new Set([",", ")"])));
        } while (this.maybe(","));
        value = { kind: "array", items, site: token };
      } else {
        value = first;
      }
      this.take(")");
    } else if (token.kind === "word") {
      this.position += 1;
      value = { kind: "name", name: token.value, site: token };
    } else {
      syntax(token, `expected expression, got ${JSON.stringify(token.value)}`);
    }
    return this.postfix(value, stops);
  }

  private postfix(initial: Expr, stops: Set<string>): Expr {
    let value = initial;
    for (;;) {
      if (this.at(".") && this.peek(1).kind === "word") {
        const site = this.take(".");
        const name = this.word().value;
        value = { kind: "member", base: value, name, site };
      } else if (this.at("(") && value.kind === "name") {
        const site = this.take("(");
        const args: Expr[] = [];
        while (!this.at(")")) {
          args.push(this.expression(0, new Set([",", ")"])));
          if (!this.maybe(",")) break;
        }
        this.take(")");
        value = { kind: "call", name: value.name, args, site };
      } else if (this.at("[") && value.kind === "name") {
        value = this.parseRead(value.name, value.site);
      } else if (value.kind === "read" && this.at("where")) {
        const site = this.take("where");
        const predicate = this.expression(0, new Set(["<newline>", "{", ",", "}"]));
        value = { ...value, range: { ...value.range!, where: { predicate, site } } };
      } else if (value.kind === "read" && this.at("before")) {
        unsupported(this.peek(), "before", "use after c; reverse display order in the client when needed");
      } else if (value.kind === "read" && ["after", "first", "last", "by"].includes(this.peek().value)) {
        value = this.parseRange(value);
      } else if (this.maybe("!")) {
        const assertion = this.tokens[this.position - 1]!;
        if (!this.maybe("else")) throw new QuarryError(assertion, "presence assertions require a refusal code",
          "E_QUARRY_SYNTAX", "! else CODE", undefined, true);
        const code = this.word().value;
        value = { kind: "assert", value, code, site: assertion };
      } else if (this.at("{")) {
        value = this.parseShape(value);
      } else if (this.atKind("word") && !PRECEDENCE.has(this.peek().value)
        && !stops.has(this.peek().value) && !["else", "for", "in"].includes(this.peek().value)) {
        const named = this.word();
        value = { kind: "shapeUse", base: value, name: named.value, site: named };
      } else {
        break;
      }
    }
    return value;
  }

  private parseRead(table: string, site: Site): Extract<Expr, { kind: "read" }> {
    this.take("[");
    const keys: KeyPart[] = [];
    while (!this.at("]")) {
        const keySite = this.peek();
        let column: string | undefined;
        if (this.atKind("word") && this.peek(1).value === "=") {
          column = this.word().value;
          this.take("=");
        }
        const value = this.expression(0, new Set([",", "]"]));
        keys.push({ column, value, site: keySite });
        if (!this.maybe(",")) break;
    }
    this.take("]");
    return { kind: "read", table, keys, site };
  }

  private parseRange(read: Extract<Expr, { kind: "read" }>): Extract<Expr, { kind: "read" }> {
    // @ref LLP 1010#a7-one-modifier-order — retain the first value for each
    // modifier while parsing the whole read so a refusal can paste one canonical form.
    let order: "asc" | "desc" | undefined;
    let take: number | undefined;
    let cursor: Expr | undefined;
    let cursorKind: "after" | undefined;
    const site = this.peek();
    let index = read.index;
    let highestRank = -1;
    const seen = new Set<number>();
    let violation: Token | undefined;
    while (["after", "first", "last", "by"].includes(this.peek().value)) {
      const key = this.word();
      const rank = key.value === "after" ? 0
        : key.value === "first" || key.value === "last" ? 1
          : 2;
      if (!violation && (seen.has(rank) || rank < highestRank)) violation = key;
      seen.add(rank);
      highestRank = Math.max(highestRank, rank);
      if (key.value === "after") {
        const candidate = this.expression(0, new Set(["after", "first", "last", "by", "where", "<newline>", ":", "{", ",", "}"]));
        if (!cursor) {
          cursorKind = key.value;
          cursor = candidate;
        }
      } else if (key.value === "first" || key.value === "last") {
        const candidate = this.number();
        if (take === undefined) {
          order = key.value === "first" ? "asc" : "desc";
          take = candidate;
        }
      } else if (key.value === "by") {
        const candidate = this.word().value;
        if (!index) index = candidate;
      }
    }
    if (take === undefined && !cursor) {
      const point = { ...read, index };
      if (violation) syntax(violation, "read modifiers may appear once and only in canonical order", quarryExpression(point));
      return point;
    }
    if (take === undefined || !order) syntax(site, "range reads require first N or last N");
    const range = { ...read, index, range: { order, take, cursor, cursorKind, site } };
    if (violation) syntax(violation, "read modifiers may appear once and only in canonical order", quarryExpression(range));
    return range;
  }

  private parseMerge(): MergeExpr {
    const site = this.take("merge");
    const table = this.word().value;
    let cursor: Expr | undefined;
    let cursorKind: "after" | undefined;
    if (this.at("before")) unsupported(this.peek(), "before", "use after c in the merge header");
    if (this.at("after")) {
      cursorKind = this.word().value as "after";
      cursor = this.expression(0, new Set(["first", "last", "by", ":"]));
    }
    const bound = this.peek();
    if (!this.at("first") && !this.at("last")) {
      syntax(bound, "merge modifiers use [after cursor] first|last N by index", `merge ${table} first 20 by index:`);
    }
    const order = this.word().value === "first" ? "asc" : "desc";
    const take = this.number();
    if (!this.at("by")) {
      const cursorText = cursor ? ` ${cursorKind} ${this.renderExpr(cursor)}` : "";
      syntax(this.peek(), "merge requires by <index> in its header", `merge ${table}${cursorText} ${order === "asc" ? "first" : "last"} ${take} by index:`);
    }
    this.take("by");
    const index = this.word().value;
    this.take(":");
    this.newline();
    if (!this.atKind("indent")) {
      syntax(this.peek(), "merge requires an indented block with at least one [prefix] lane", `[viewer]`);
    }
    this.takeKind("indent");
    const lanes: MergeLane[] = [];
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      const laneSite = this.peek();
      const keys = this.parseRead(table, laneSite).keys;
      const prefix = keys.map(key => key.value);
      const columns = keys.some(key => key.column !== undefined) ? keys.map(key => key.column) : undefined;
      let loop: MergeLane["loop"];
      if (this.maybe("for")) {
        const name = this.bindingName();
        this.take("in");
        const domain = this.expression(0, new Set(["<newline>"]));
        if (domain.kind !== "read" || !domain.range) {
          syntax(domain.site, "a merge for lane requires a bounded range read", "for row in table[prefix] first 50 by index");
        }
        loop = { name, domain };
      }
      this.newline();
      lanes.push({ prefix, ...(columns ? { columns } : {}), ...(loop ? { loop } : {}), site: laneSite });
    }
    this.takeKind("dedent");
    if (lanes.length === 0) syntax(site, "merge requires at least one lane", `[viewer]`);
    return { kind: "merge", table, index, order, take, cursor, cursorKind, lanes, site };
  }

  private renderExpr(expr: Expr): string {
    return quarryExpression(expr);
  }

  private parseShape(base: Expr): Expr {
    const site = this.take("{");
    const fields = this.parseShapeFields();
    this.take("}");
    return { kind: "shape", base, fields, site };
  }

  private parseShapeFields(): ShapeField[] {
    const fields: ShapeField[] = [];
    while (!this.at("}")) {
        const fieldSite = this.peek();
        if (this.maybe("*")) fields.push({ kind: "spread", site: fieldSite });
        else if (this.at(".") && this.peek(1).value === "." && this.peek(2).value === ".") {
          this.take(".");
          this.take(".");
          this.take(".");
          fields.push({ kind: "namedSpread", name: this.word().value, site: fieldSite });
        }
        else {
          const name = this.word().value;
          if (this.maybe(":")) fields.push({ kind: "field", name, value: this.expression(0, new Set([",", "}"])), site: fieldSite });
          else fields.push({ kind: "bare", name, site: fieldSite });
        }
        if (!this.maybe(",")) break;
    }
    return fields;
  }

  private parseWrite(): Expr {
    const opToken = this.word();
    const table = this.word().value;
    const op = opToken.value as "insert" | "update" | "upsert" | "delete";
    const keys = op === "insert" ? [] : this.parseRead(table, opToken).keys;
    const fields = op === "delete" ? [] : this.parseObjectFields();
    let ifAbsent: boolean | undefined, condition: Expr | undefined;
    if (this.maybe("if")) {
      if (op === "insert") { this.take("absent"); ifAbsent = true; }
      else if (op === "update") condition = this.expression();
      else syntax(opToken, "if follows insert or update", "use insert ... if absent or update ... if condition");
    }
    return { kind: "write", op, table, keys, fields, ifAbsent, condition, site: opToken };
  }

  private parseObjectFields(): ObjectField[] {
    this.take("{");
    const fields: ObjectField[] = [];
    while (!this.at("}")) {
        const name = this.word();
        fields.push({ name: name.value, value: this.maybe(":") ? this.expression(0, new Set([",", "}"])) : undefined, site: name });
        if (!this.maybe(",")) break;
    }
    this.take("}");
    return fields;
  }

  private parseWalk(): Expr {
    const site = this.take("walk");
    const table = this.word().value;
    const read = this.parseRead(table, site);
    if (read.keys.length !== 1 || read.keys[0]!.column) syntax(read.site, "walk seed must be one positional reference t[seed]");
    this.take("up");
    this.take(".");
    const column = this.word().value;
    this.take("depth");
    const depth = this.number();
    return { kind: "walk", table, seed: read.keys[0]!.value, column, depth, site };
  }

  private tupleBindingAhead(): boolean {
    let cursor = this.position + 1;
    if (this.tokens[cursor]?.kind !== "word") return false;
    cursor += 1;
    while (this.tokens[cursor]?.value === ",") {
      cursor += 1;
      if (this.tokens[cursor]?.kind !== "word") return false;
      cursor += 1;
    }
    return this.tokens[cursor]?.value === ")" && this.tokens[cursor + 1]?.value === "=";
  }

  private isStop(token: Token, stops: Set<string>): boolean {
    if (token.kind === "newline" || token.kind === "dedent" || token.kind === "eof") return true;
    return stops.has(token.value) || stops.has(`<${token.kind}>`);
  }

  private endLine(site: Site): void {
    if (!this.atKind("newline")) syntax(this.peek(), `unexpected token after declaration from line ${site.line}`);
    this.newline();
  }

  private newline(): void { this.takeKind("newline"); }
  private skipNewlines(): void { while (this.atKind("newline")) this.position += 1; }
  private number(): number {
    const token = this.takeKind("number");
    if (!/^\d+$/.test(token.value)) syntax(token, "this position takes an integer literal");
    return Number(token.value);
  }
  private scale(rewrite: string): number {
    const token = this.peek();
    const scale = this.number();
    if (scale < 0 || scale > 12) {
      syntax(token, "decimal and money scales must be integers from 0 through 12", `use ${rewrite}`);
    }
    return scale;
  }
  private word(): Token { return this.takeKind("word"); }
  private at(value: string): boolean { return this.peek().value === value; }
  private atKind(kind: TokenKind): boolean { return this.peek().kind === kind; }
  private maybe(value: string): boolean {
    if (!this.at(value)) return false;
    this.position += 1;
    return true;
  }
  private take(value: string): Token {
    const token = this.peek();
    if (token.value !== value) syntax(token, `expected ${JSON.stringify(value)}, got ${JSON.stringify(token.value)}`);
    this.position += 1;
    return token;
  }
  private takeKind(kind: TokenKind): Token {
    const token = this.peek();
    if (token.kind !== kind) syntax(token, `expected ${kind}, got ${JSON.stringify(token.value)}`);
    this.position += 1;
    return token;
  }
  private peek(offset = 0): Token { return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)]!; }

  private capture(error: unknown): void {
    if (error instanceof QuarryError) this.diagnostics.push(error.diagnostic);
    else throw error;
  }

  private recoverLine(): void {
    while (!this.atKind("newline") && !this.atKind("dedent") && !this.atKind("eof")) this.position += 1;
    if (this.atKind("newline")) this.position += 1;
  }

  private recoverStatement(): void {
    this.recoverLine();
  }

  private recoverTopLevel(): void {
    this.recoverLine();
    let depth = 0;
    const declarations = new Set(["use", "table", "maintain", "channel", "query", "mutation", "effect", "shape", "fn", "proc", "cursor", "schedule", "index", "unique", "device", "oblivious"]);
    while (!this.atKind("eof")) {
      if (this.atKind("indent")) { depth += 1; this.position += 1; continue; }
      if (this.atKind("dedent")) { depth = Math.max(0, depth - 1); this.position += 1; continue; }
      if (depth === 0 && this.atKind("word") && declarations.has(this.peek().value)) return;
      this.position += 1;
    }
  }
}

function focalizeRuleBinding(expr: Expr, binding: string): Expr {
  if (expr.kind === "name") return expr.name === binding ? { kind: "focal", site: expr.site } : expr;
  if (expr.kind === "unary") return { ...expr, value: focalizeRuleBinding(expr.value, binding) };
  if (expr.kind === "binary") return { ...expr, left: focalizeRuleBinding(expr.left, binding), right: focalizeRuleBinding(expr.right, binding) };
  if (expr.kind === "member") return { ...expr, base: focalizeRuleBinding(expr.base, binding) };
  if (expr.kind === "call") return { ...expr, args: expr.args.map((item) => focalizeRuleBinding(item, binding)) };
  if (expr.kind === "array") return { ...expr, items: expr.items.map((item) => focalizeRuleBinding(item, binding)) };
  if (expr.kind === "object") return { ...expr, fields: expr.fields.map((field) => ({ ...field, value: field.value && focalizeRuleBinding(field.value, binding) })) };
  if (expr.kind === "read") return {
    ...expr,
    keys: expr.keys.map((part) => ({ ...part, value: focalizeRuleBinding(part.value, binding) })),
    range: expr.range && {
      ...expr.range,
      cursor: expr.range.cursor && focalizeRuleBinding(expr.range.cursor, binding),
      where: expr.range.where && {
        ...expr.range.where,
        predicate: focalizeRuleBinding(expr.range.where.predicate, binding),
      },
    },
  };
  if (expr.kind === "exists" || expr.kind === "created") return { ...expr, read: focalizeRuleBinding(expr.read, binding) as Extract<Expr, { kind: "read" }> };
  if (expr.kind === "assert") return { ...expr, value: focalizeRuleBinding(expr.value, binding) };
  if (expr.kind === "shapeUse") return { ...expr, base: focalizeRuleBinding(expr.base, binding) };
  if (expr.kind === "shape") return {
    ...expr,
    base: focalizeRuleBinding(expr.base, binding),
    fields: expr.fields.map((field) => field.kind === "field" ? { ...field, value: focalizeRuleBinding(field.value, binding) } : field),
  };
  if (expr.kind === "walk") return { ...expr, seed: focalizeRuleBinding(expr.seed, binding) };
  if (expr.kind === "write") return {
    ...expr,
    keys: expr.keys.map((part) => ({ ...part, value: focalizeRuleBinding(part.value, binding) })),
    fields: expr.fields.map((field) => ({ ...field, value: field.value && focalizeRuleBinding(field.value, binding) })),
  };
  return expr;
}

function title(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
