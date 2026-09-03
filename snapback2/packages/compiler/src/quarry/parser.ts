import type {
  ArgDecl,
  ChannelDecl,
  ColumnDecl,
  Document,
  Expr,
  IndexDecl,
  KeyPart,
  MaintainDecl,
  ObjectField,
  ProgramDecl,
  RuleDecl,
  ScalarType,
  ShapeField,
  Site,
  Stmt,
  TableDecl,
} from "./ast";
import type { QuarryDiagnostic } from "./ast";
import { QuarryError, refuse, syntax, unsupported } from "./diagnostics";
import { lex, type Token, type TokenKind } from "./lexer";

const RESERVED_BINDINGS = new Set([
  "arguments", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "eval", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import",
  "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public", "return", "static",
  "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);
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
  private readonly programs: ProgramDecl[] = [];
  private identity: Document["identity"];

  constructor(private readonly tokens: Token[], private readonly file: string, readonly diagnostics: QuarryDiagnostic[]) {}

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
        else if (this.at("query") || this.at("mutation")) this.programs.push(this.parseProgram());
        else if (this.at("effect")) this.effects.push(this.parseEffect());
        else if (this.at("schedule")) unsupported(token, "schedule", "perform the bounded work in a named mutation invoked by the caller");
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
      programs: this.programs,
    };
  }

  private parseUse(): void {
    const site = this.take("use");
    const kind = this.word();
    if (kind.value === "assets") unsupported(kind, "use assets", "store an explicit bounded URL in a text <=N format url column");
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
    const name = this.generatedBinding("table");
    this.take(":");
    this.newline();
    this.takeKind("indent");
    const columns: ColumnDecl[] = [];
    const indexes: IndexDecl[] = [];
    const rules: RuleDecl[] = [];
    const immutable: Array<{ columns: string[]; site: Site }> = [];
    const finalExists: TableDecl["finalExists"] = [];
    let publicDecl: TableDecl["public"];
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
        else if (this.at("after")) finalExists.push(this.parseFinalExists());
        else if (["read", "insert", "update", "delete"].includes(this.peek().value)) rules.push(this.parseRule());
        else columns.push(this.parseColumn());
      } catch (error) {
        this.capture(error);
        this.recoverLine();
      }
    }
    this.takeKind("dedent");
    return { name, columns, indexes, rules, immutable, finalExists, ...(publicDecl ? { public: publicDecl } : {}), site };
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
    const binding = this.word().value;
    this.take("<-");
    const value = this.expression(0, new Set(["<newline>"]));
    if (value.kind !== "exists") syntax(value.site, "after insert requires exactly one exists predicate");
    this.newline();
    return { binding, value, site };
  }

  private parseColumn(): ColumnDecl {
    const name = this.word();
    this.take(":");
    const type = this.parseType();
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
    const columns = [this.word().value];
    while (this.maybe(",")) columns.push(this.word().value);
    this.newline();
    const inferred = `by${columns.map(title).join("")}`;
    return { name: explicit ?? inferred, columns, unique, site };
  }

  private parseMaintain(): MaintainDecl {
    const site = this.take("maintain");
    const name = this.word().value;
    this.take("=");
    const aggregateToken = this.word();
    if (aggregateToken.value !== "count" && aggregateToken.value !== "sum") {
      unsupported(aggregateToken, `maintain ${aggregateToken.value}`, "use maintain name = count table by columns or maintain name = sum table of intColumn by columns");
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
    this.take(":");
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
        const binding = effect.value === "readable" && this.at("<-") ? "r" : this.word().value;
        this.take("<-");
        const value = this.expression(0, new Set(["<newline>"]));
        this.newline();
        const declaration: RuleDecl = { effect: "read", bindings: [binding], value, site: effect };
        if (effect.value === "read") read = declaration;
        else readable = declaration;
      } catch (error) {
        this.capture(error);
        this.recoverLine();
      }
    }
    this.takeKind("dedent");
    if (!read) syntax(site, `maintain ${name} requires read row <- rule`);
    return { name, aggregate: aggregateToken.value as "count" | "sum", source, ...(column ? { column } : {}), by, read, ...(readable ? { readable } : {}), site };
  }

  private parseEffect(): { name: string; module: string; site: Site } {
    const site = this.take("effect");
    const name = this.generatedBinding("effect");
    this.take("from");
    const module = this.word().value;
    this.newline();
    return { name, module, site };
  }

  private parseRule(): RuleDecl {
    const effectToken = this.word();
    const effect = effectToken.value as RuleDecl["effect"];
    const bindings: string[] = [];
    if (this.maybe("(")) {
      bindings.push(this.word().value);
      while (this.maybe(",")) bindings.push(this.word().value);
      this.take(")");
    } else {
      bindings.push(this.word().value);
    }
    const valid = effect === "update"
      ? bindings.length === 1 || bindings.length === 2
      : bindings.length === 1;
    if (!valid) {
      const expected = effect === "update" ? "one candidate binding or (old, next)" : "exactly one row binding";
      syntax(effectToken, `${effect} rules require ${expected}`, `rewrite the ${effect} rule with ${expected}`);
    }
    this.take("<-");
    const value = this.expression(0, new Set(["<newline>"]));
    this.newline();
    return { effect, bindings, value, site: effectToken };
  }

  private parseChannel(): ChannelDecl {
    const site = this.take("channel");
    const name = this.generatedBinding("channel");
    const args = this.parseArgs();
    this.take(":");
    this.newline();
    this.takeKind("indent");
    let publish: Expr | undefined;
    let subscribe: Expr | undefined;
    let ttlSeconds: number | undefined;
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      try {
        const key = this.word();
        if (key.value === "publish" || key.value === "subscribe") {
          this.take("<-");
          const value = this.expression(0, new Set(["<newline>"]));
          if (key.value === "publish") publish = value;
          else subscribe = value;
        } else if (key.value === "ttl") {
          const amount = this.number();
          if (this.at("s")) this.take("s");
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
    if (!publish) syntax(site, `channel ${name} requires publish <- ...`);
    if (!subscribe) syntax(site, `channel ${name} requires subscribe <- ...`);
    if (ttlSeconds === undefined) syntax(site, `channel ${name} requires ttl Ns`);
    return { name, args, publish, subscribe, ttlSeconds, site };
  }

  private parseProgram(): ProgramDecl {
    const kindToken = this.word();
    const kind = kindToken.value as ProgramDecl["kind"];
    const name = this.generatedBinding("operation");
    const args = this.parseArgs();
    if (this.at("->")) unsupported(this.peek(), "result annotations", "results are inferred; remove the annotation");
    this.take(":");
    this.newline();
    const body = this.parseBlock();
    if (body.length === 0) syntax(kindToken, `${kind} ${name} has an empty body`);
    return { kind, name, args, body, site: kindToken };
  }

  private generatedBinding(kind: "table" | "channel" | "effect" | "operation"): string {
    const token = this.word();
    if (RESERVED_BINDINGS.has(token.value)) {
      refuse(
        token,
        `${kind} name ${token.value} is reserved and cannot become a generated TypeScript binding`,
        `rename the ${kind} ${token.value} to an identifier that is not reserved by JavaScript`,
      );
    }
    return token.value;
  }

  private parseArgs(): ArgDecl[] {
    this.take("(");
    const args: ArgDecl[] = [];
    while (!this.at(")")) {
        const name = this.word();
        this.take(":");
        args.push({ name: name.value, type: this.parseType(), site: name });
        if (!this.maybe(",")) break;
    }
    this.take(")");
    return args;
  }

  private parseType(): ScalarType {
    const site = this.peek();
    let type: ScalarType;
    if (this.maybe("[")) {
      const item = this.parseType();
      this.take("]");
      this.take("<=");
      type = { kind: "list", item, max: this.number(), optional: false };
    } else {
      const name = this.word();
      if (name.value === "asset") unsupported(name, "asset", "store an explicit bounded URL in a text <=N format url column");
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
          if (value.value !== "handle" && value.value !== "url") syntax(value, `unknown text format ${value.value}`);
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
      } else if (name.value === "json" || name.value === "bytes") {
        this.take("<=");
        type = { kind: name.value, max: this.number(), optional: false };
      } else if (["id", "principal", "int", "time", "bool"].includes(name.value)) {
        type = { kind: name.value as "id" | "principal" | "int" | "time" | "bool", optional: false };
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
    if (this.at("match")) return this.parseMatch();
    if (this.at("require")) return this.parseRequire();
    if (this.at("return")) {
      const site = this.take("return");
      const value = this.expression(0, new Set(["<newline>"]));
      this.newline();
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
      const name = this.word();
      this.take("=");
      const value = this.expression(0, new Set(["<newline>"]));
      this.newline();
      return { kind: "bind", names: [name.value], value, site: name };
    }
    if (this.at("(") && this.tupleBindingAhead()) {
      const site = this.take("(");
      const names = [this.word().value];
      while (this.maybe(",")) names.push(this.word().value);
      this.take(")");
      this.take("=");
      const value = this.expression(0, new Set(["<newline>"]));
      this.newline();
      return { kind: "bind", names, value, site };
    }
    const value = this.expression(0, new Set(["<newline>"]));
    this.newline();
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
    const name = this.word().value;
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

  private parseMatch(): Stmt {
    const site = this.take("match");
    const read = this.expression(0, new Set([":"]));
    if (read.kind !== "read" || read.range) syntax(read.site, "match requires a point read t[key]");
    this.take(":");
    this.newline();
    this.takeKind("indent");
    this.take("some");
    const someName = this.word().value;
    this.take(":");
    this.newline();
    const someBody = this.parseBlock();
    this.take("none");
    this.take(":");
    this.newline();
    const noneBody = this.parseBlock();
    this.takeKind("dedent");
    return { kind: "match", read, someName, someBody, noneBody, site };
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
    if (["+", "+~", "~"].includes(token.value) || (token.value === "-" && this.peek(1).kind === "word")) return this.parseWrite();
    if (token.value === "#") {
      this.position += 1;
      const table = this.word();
      const read = this.parseRead(table.value, table);
      return { kind: "aggregate", table: table.value, keys: read.keys, site: token };
    }
    if (token.value === "merge") unsupported(token, "merge", "name one bounded index scan or maintain a feed table");
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
      } else if (value.kind === "read" && this.at("by")) {
        this.take("by");
        value = { ...value, index: this.word().value };
      } else if (value.kind === "read" && ["after", "before", "first", "last", "where"].includes(this.peek().value)) {
        value = this.parseRange(value);
      } else if (this.maybe("!")) {
        const assertion = this.tokens[this.position - 1]!;
        let code = "NOT_FOUND";
        if (this.maybe("else")) code = this.word().value;
        value = { kind: "assert", value, code, site: assertion };
      } else if (this.at("{")) {
        value = this.parseShape(value);
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
    let order: "asc" | "desc" | undefined;
    let take: number | undefined;
    let cursor: Expr | undefined;
    let cursorKind: "after" | "before" | undefined;
    const site = this.peek();
    let where: Expr | undefined;
    let index = read.index;
    while (["after", "before", "first", "last", "by", "where"].includes(this.peek().value)) {
      const key = this.word();
      if (key.value === "after" || key.value === "before") {
        if (cursor) syntax(key, "a range read may name only one after/before cursor");
        cursorKind = key.value;
        cursor = this.expression(0, new Set(["first", "last", "by", "where", "<newline>", ":", "{", ",", "}"]));
      } else if (key.value === "first" || key.value === "last") {
        if (take !== undefined) syntax(key, "a range read may name only one first/last bound");
        order = key.value === "first" ? "asc" : "desc";
        take = this.number();
      } else if (key.value === "by") {
        index = this.word().value;
      } else {
        if (where) syntax(key, "a range read may name only one where predicate");
        where = this.expression(0, new Set(["<newline>", ":", "{", ",", "}"]));
      }
    }
    if (take === undefined || !order) syntax(site, "range reads require first N or last N");
    return { ...read, index, range: { order, take, cursor, cursorKind, where, site } };
  }

  private parseShape(base: Expr): Expr {
    const site = this.take("{");
    const fields: ShapeField[] = [];
    while (!this.at("}")) {
        const fieldSite = this.peek();
        if (this.maybe("*")) fields.push({ kind: "spread", site: fieldSite });
        else {
          const name = this.word().value;
          if (this.maybe(":")) fields.push({ kind: "field", name, value: this.expression(0, new Set([",", "}"])), site: fieldSite });
          else fields.push({ kind: "bare", name, site: fieldSite });
        }
        if (!this.maybe(",")) break;
    }
    this.take("}");
    return { kind: "shape", base, fields, site };
  }

  private parseWrite(): Expr {
    const opToken = this.peek();
    this.position += 1;
    const table = this.word().value;
    const op = opToken.value === "+" ? "insert" : opToken.value === "+~" ? "upsert" : opToken.value === "~" ? "update" : "delete";
    const keys = op === "insert" ? [] : this.parseRead(table, opToken).keys;
    const fields = op === "delete" ? [] : this.parseObjectFields();
    return { kind: "write", op, table, keys, fields, site: opToken };
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
    const declarations = new Set(["use", "table", "maintain", "channel", "query", "mutation", "effect", "schedule", "index", "unique", "device", "oblivious"]);
    while (!this.atKind("eof")) {
      if (this.atKind("indent")) { depth += 1; this.position += 1; continue; }
      if (this.atKind("dedent")) { depth = Math.max(0, depth - 1); this.position += 1; continue; }
      if (depth === 0 && this.atKind("word") && declarations.has(this.peek().value)) return;
      this.position += 1;
    }
  }
}

function title(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
