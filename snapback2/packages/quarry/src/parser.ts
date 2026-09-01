import type {
  ArgDecl,
  ChannelDecl,
  ColumnDecl,
  Document,
  Expr,
  IndexDecl,
  KeyPart,
  ObjectField,
  ProgramDecl,
  RuleDecl,
  ScalarType,
  ShapeField,
  Site,
  Stmt,
  TableDecl,
} from "./ast";
import { refuse } from "./diagnostics";
import { lex, type Token, type TokenKind } from "./lexer";

const COMPARISONS = new Set(["=", "!=", "<", "<=", ">", ">="]);
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

export function parseDocument(file: string, source: string): Document {
  return new Parser(lex(file, source), file).document();
}

class Parser {
  private position = 0;
  private readonly tables: TableDecl[] = [];
  private readonly channels: ChannelDecl[] = [];
  private readonly programs: ProgramDecl[] = [];
  private identity = false;

  constructor(private readonly tokens: Token[], private readonly file: string) {}

  document(): Document {
    while (!this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("eof")) break;
      const token = this.peek();
      if (this.at("maintain")) refuse(token, "maintain declarations are outside the Quarry v0.2 Snapback 2 subset; maintained aggregates are not available");
      if (this.at("#")) refuse(token, "#agg[...] reads are outside the Quarry v0.2 Snapback 2 subset; restructure without maintained aggregates");
      if (this.at("use")) this.parseUse();
      else if (this.at("table")) this.tables.push(this.parseTable());
      else if (this.at("channel")) this.channels.push(this.parseChannel());
      else if (this.at("query") || this.at("mutation")) this.programs.push(this.parseProgram());
      else if (this.at("effect") || this.at("effects")) refuse(token, "effects are outside the Quarry v0.2 Snapback 2 subset");
      else if (this.at("schedule")) refuse(token, "schedules are not part of this provisional Quarry front end");
      else if (this.at("index") || this.at("unique")) refuse(token, "top-level index declarations are not in this subset; place by/unique inside the table block");
      else if (this.at("device") || this.at("oblivious")) refuse(token, "device/oblivious constructs are outside the Quarry v0.2 Snapback 2 subset");
      else refuse(token, `unexpected top-level ${JSON.stringify(token.value)}`);
    }
    return { file: this.file, identity: this.identity, tables: this.tables, channels: this.channels, programs: this.programs };
  }

  private parseUse(): void {
    const site = this.take("use");
    const kind = this.word();
    if (kind.value === "assets") refuse(kind, "use assets and asset columns are outside this subset; Snapback 2 has no Quarry asset lowering");
    if (kind.value !== "identity") refuse(kind, `unsupported boundary kind ${kind.value}`);
    this.identity = true;
    this.endLine(site);
  }

  private parseTable(): TableDecl {
    const site = this.take("table");
    const name = this.word().value;
    this.take(":");
    this.newline();
    this.takeKind("indent");
    const columns: ColumnDecl[] = [];
    const indexes: IndexDecl[] = [];
    const rules: RuleDecl[] = [];
    let publicSite: Site | undefined;
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      if (this.at("public")) {
        publicSite = this.take("public");
        this.newline();
      } else if (this.at("by")) {
        indexes.push(this.parseIndex(false));
      } else if (this.at("unique")) {
        indexes.push(this.parseIndex(true));
      } else if (["read", "insert", "update", "delete"].includes(this.peek().value)) {
        rules.push(this.parseRule());
      } else {
        columns.push(this.parseColumn());
      }
    }
    this.takeKind("dedent");
    return { name, columns, indexes, rules, publicSite, site };
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
    if (!unique && this.atKind("word") && this.peek(1).value === ":") {
      explicit = this.word().value;
      this.take(":");
    }
    const columns = [this.word().value];
    while (this.maybe(",")) columns.push(this.word().value);
    this.newline();
    const inferred = `by${columns.map(title).join("")}`;
    return { name: explicit ?? inferred, columns, unique, site };
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
    this.take("<-");
    const value = this.expression(0, new Set(["<newline>"]));
    this.newline();
    return { effect, bindings, value, site: effectToken };
  }

  private parseChannel(): ChannelDecl {
    const site = this.take("channel");
    const name = this.word().value;
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
        refuse(key, `unknown channel property ${key.value}`);
      }
      this.newline();
    }
    this.takeKind("dedent");
    if (!publish) refuse(site, `channel ${name} requires publish <- ...`);
    if (!subscribe) refuse(site, `channel ${name} requires subscribe <- ...`);
    if (ttlSeconds === undefined) refuse(site, `channel ${name} requires ttl Ns`);
    return { name, args, publish, subscribe, ttlSeconds, site };
  }

  private parseProgram(): ProgramDecl {
    const kindToken = this.word();
    const kind = kindToken.value as ProgramDecl["kind"];
    const nameToken = this.word();
    if (RESERVED_BINDINGS.has(nameToken.value)) refuse(nameToken, `operation name ${nameToken.value} is reserved and cannot become a generated TypeScript binding`);
    const name = nameToken.value;
    const args = this.parseArgs();
    let result: ScalarType | undefined;
    if (this.maybe("->")) result = this.parseType();
    this.take(":");
    this.newline();
    const body = this.parseBlock();
    if (body.length === 0) refuse(kindToken, `${kind} ${name} has an empty body`);
    return { kind, name, args, result, body, site: kindToken };
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
      if (name.value === "asset") refuse(name, "asset columns and arguments are outside this subset; use assets is not available");
      if (name.value === "text") {
        this.take("<=");
        type = { kind: "text", max: this.number(), optional: false };
      } else if (name.value === "id" || name.value === "int" || name.value === "time" || name.value === "bool") {
        type = { kind: name.value, optional: false };
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
    if (type.kind === "list" && type.item.optional) refuse(site, "list element types cannot be optional in this subset");
    return type;
  }

  private parseBlock(): Stmt[] {
    this.takeKind("indent");
    const body: Stmt[] = [];
    while (!this.atKind("dedent") && !this.atKind("eof")) {
      this.skipNewlines();
      if (this.atKind("dedent")) break;
      body.push(this.parseStatement());
    }
    this.takeKind("dedent");
    return body;
  }

  private parseStatement(): Stmt {
    if (this.at("while")) refuse(this.peek(), "while is not part of Quarry; use a bounded for domain or walk");
    if (this.at("if")) return this.parseIf();
    if (this.at("for")) return this.parseFor();
    if (this.at("match")) return this.parseMatch();
    if (this.at("require")) return this.parseRequire();
    if (this.at("device") || this.at("oblivious")) refuse(this.peek(), "device/oblivious constructs are outside the Quarry v0.2 Snapback 2 subset");

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
    if (read.kind !== "read" || read.range) refuse(read.site, "match requires a point read t[key]");
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
      if (value.kind !== "read" || value.range) refuse(value.site, "exists requires a point/index read t[key]");
      return { kind: "exists", read: value, site: token };
    }
    if (token.value === "walk") return this.parseWalk();
    if (["+", "+~", "~"].includes(token.value) || (token.value === "-" && this.peek(1).kind === "word")) return this.parseWrite();
    if (token.value === "#") refuse(token, "#agg[...] reads are outside this subset; restructure without maintained aggregates");
    if (token.value === "merge") refuse(token, "merge(...) is outside this subset; materialize or name one bounded index scan");
    if (token.value === "device" || token.value === "oblivious") refuse(token, "device/oblivious constructs are outside the Quarry v0.2 Snapback 2 subset");

    let value: Expr;
    if (token.kind === "string") {
      this.position += 1;
      value = { kind: "literal", value: token.value, site: token };
    } else if (token.kind === "number") {
      this.position += 1;
      value = { kind: "literal", value: Number(token.value), site: token };
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
    } else if (token.value === "(") {
      this.position += 1;
      value = this.expression(0, new Set([")"]));
      this.take(")");
    } else if (token.kind === "word") {
      this.position += 1;
      value = { kind: "name", name: token.value, site: token };
    } else {
      refuse(token, `expected expression, got ${JSON.stringify(token.value)}`);
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
      } else if (value.kind === "read" && ["after", "before", "first", "last", "by"].includes(this.peek().value)) {
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
    let index: string | undefined;
    const site = this.peek();
    while (["after", "before", "first", "last", "by"].includes(this.peek().value)) {
      const key = this.word();
      if (key.value === "after" || key.value === "before") {
        if (cursor) refuse(key, "a range read may name only one after/before cursor");
        cursorKind = key.value;
        cursor = this.expression(0, new Set(["first", "last", "by", "<newline>", ":", "{", ",", "}"]));
      } else if (key.value === "first" || key.value === "last") {
        if (take !== undefined) refuse(key, "a range read may name only one first/last bound");
        order = key.value === "first" ? "asc" : "desc";
        take = this.number();
      } else {
        index = this.word().value;
      }
    }
    if (take === undefined || !order) refuse(site, "range reads require first N or last N");
    return { ...read, range: { order, take, cursor, cursorKind, index, site } };
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
    if (read.keys.length !== 1 || read.keys[0]!.column) refuse(read.site, "walk seed must be one positional reference t[seed]");
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
    if (!this.atKind("newline")) refuse(this.peek(), `unexpected token after declaration from line ${site.line}`);
    this.newline();
  }

  private newline(): void { this.takeKind("newline"); }
  private skipNewlines(): void { while (this.atKind("newline")) this.position += 1; }
  private number(): number { return Number(this.takeKind("number").value); }
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
    if (token.value !== value) refuse(token, `expected ${JSON.stringify(value)}, got ${JSON.stringify(token.value)}`);
    this.position += 1;
    return token;
  }
  private takeKind(kind: TokenKind): Token {
    const token = this.peek();
    if (token.kind !== kind) refuse(token, `expected ${kind}, got ${JSON.stringify(token.value)}`);
    this.position += 1;
    return token;
  }
  private peek(offset = 0): Token { return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)]!; }
}

function title(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
