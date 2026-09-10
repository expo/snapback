import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert";
import { lowerProject } from "./project";
import { parseDocument } from "./quarry/parser";
import { rustCheck } from "./rust-check";
import { assert, compileInline, withProject, type Test } from "./quarry-check-helpers";

// @ref LLP 1019#1-the-declaration — the `deliver` line: its grammar, the exact
// generated shapes the engine holds every generation to, and each refusal's
// family, site, rewrite, and page.

const SCHEMA = `use identity

table conversations:
  title: text <=120
  public

table memberships:
  conversationId: conversations
  principal: principal
  MEMBER
  by byConversationPrincipal: conversationId, principal
  CAP
  read <- exists memberships[.conversationId, viewer]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  DELIVER
  retain delivered-history
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer
  update <- .authorId = viewer
  delete <- .authorId = viewer
`;
const LINE = SCHEMA.split("\n").findIndex((line) => line.includes("DELIVER")) + 1;
const OPS = "query ping():\n  return null\n";

function schemaWith(deliver: string, cap = "cap 50 by conversationId", member = ""): string {
  return SCHEMA.replace("  DELIVER", deliver ? `  ${deliver}` : "").replace("  CAP", cap ? `  ${cap}` : "").replace("  MEMBER", member ? `  ${member}` : "")
    .replace(/\n\n\n+/g, "\n\n");
}

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const column = (name: string) => ({ Column: name });
const index = (columns: string[], unique = false) => ({ components: columns.map(column), unique });

export function registerDeliveryChecks(test: Test): void {
  test("the incarnation refusal publishes an executable fresh-insert repair", async () => {
    const cards = JSON.parse(readFileSync(new URL("../../snapback2/guide/families.source.json", import.meta.url), "utf8"));
    const card = cards.find((c: any) => c.code === "E_DELIVER_INCARNATION");
    assert(card.family === "rule" && card.guide === "offline", JSON.stringify(card));
    for (const side of ["wrong", "right"]) {
      const files: Record<string, string> = {}; let path = "";
      for (const line of card[side].split("\n")) {
        const marker = /^-- (snapback\/.*\.q)$/.exec(line);
        if (marker) { path = marker[1]!; files[path] = ""; }
        else if (path && !line.startsWith("```")) files[path] += line + "\n";
      }
      await withProject(files, async root => {
        const lowered = await lowerProject(root);
        assert(lowered.ok, JSON.stringify(lowered));
        assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every(r => !r.error), side);
      });
    }
    assert(card.right.includes("insert messages { conversationId, authorId: viewer, body }"), card.right);
  });
  test("schedule delete lowers to a private mutation with its existing admission and source", async () => {
    for (const file of ["schema", "expiry"]) {
      const line = "schedule expireMessage on messages at .expiresAt: delete .\n";
      const schema = schemaWith("deliver to memberships[.conversationId] as deliveries", "cap 3 by conversationId").replace("  authorId:", "  expiresAt: time ?\n  authorId:");
      const compiled = compileInline([{ fileName: "snapback/schema.q", source: schema + (file === "schema" ? line : "") },
        { fileName: "snapback/expiry.q", source: OPS + (file === "expiry" ? line : "") }]);
      assert(compiled.ok, JSON.stringify(compiled));
      const schedule = compiled.project.schema.schedules![0]!;
      const target = compiled.project.programs.find(p => p.name === schedule.target)!;
      assert(target.kind === "Mutation", JSON.stringify(target));
      assert(target.body.some(s => typeof s === "object" && "Delete" in s), JSON.stringify(target));
      assert(!compiled.project.clientPrograms.some(p => p.name === target.name), "private target entered client map");
      assert(compiled.project.sources[`${target.name}/body/0`]?.file === `snapback/${file}.q`, "write source missing");
      const checked = rustCheck(compiled.project.programs, "synthetic", compiled.project.schema as unknown as Record<string, unknown>);
      assert(checked.every(r => !r.error), JSON.stringify(checked));
    }
  });
  test("schedule delete refuses periods, other rows, extra fields, and non-time columns", () => {
    const schema = schemaWith("deliver to memberships[.conversationId] as deliveries").replace("  authorId:", "  expiresAt: time ?\n  authorId:");
    for (const spelling of ["schedule x every 1m: delete .", "schedule x on messages at .expiresAt: delete messages[.id]", "schedule x on messages at .expiresAt: delete .id", "schedule x on messages at .body: delete ."]) {
      const compiled = compileInline([{ fileName: "snapback/schema.q", source: schema }, { fileName: "snapback/expiry.q", source: spelling + "\n" }]);
      assert(!compiled.ok, spelling);
      assert(compiled.diagnostics.some(d => d.code === "E_SCHEDULE_TARGET" || d.code === "E_SCHEDULE_COLUMN"), JSON.stringify(compiled));
      assert(compiled.diagnostics.every(d => d.site && d.rewrite), JSON.stringify(compiled));
    }
  });
  test("Quarry deliver parses its options into one sited declaration", () => {
    const parsed = parseDocument("snapback/schema.q", schemaWith("deliver to memberships[.conversationId] by .principal as deliveries with receipts bootstrap"));
    assert(parsed.diagnostics.length === 0, `deliver did not parse: ${JSON.stringify(parsed.diagnostics)}`);
    const messages = parsed.document.tables.find((table) => table.name === "messages")!;
    const { site, ...declared } = messages.deliver!;
    deepStrictEqual(declared, { target: "memberships", prefix: ["conversationId"], by: "principal", name: "deliveries", receipts: true, bootstrap: true });
    assert(site.file === "snapback/schema.q" && site.line === LINE && site.col === 3, `deliver lost its site: ${JSON.stringify(site)}`);
    const bare = parseDocument("snapback/schema.q", schemaWith("deliver to memberships[.conversationId] as deliveries"));
    const decl = bare.document.tables.find((table) => table.name === "messages")!.deliver!;
    assert(decl.by === undefined && !decl.receipts && !decl.bootstrap, JSON.stringify(decl));
    assert(parsed.document.tables.every((table) => table.name === "messages" || table.deliver === undefined), "undeclared tables acquired deliver");
  });

  test("Quarry deliver lowers the descriptor and the exact generated tables, certifies in Rust, and names the rows in api.d.ts", async () => {
    await withProject({
      "snapback/schema.q": schemaWith("deliver to memberships[.conversationId] as deliveries with receipts"),
      "snapback/ops.q": OPS,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `deliver project refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      const tables = lowered.project.schema.tables;
      deepStrictEqual(plain(tables.messages?.deliver), {
        target: "memberships", prefix: ["conversationId"], principal: "principal", log: "deliveries", receipts: true,
      }, "the audience bound is the engine's fact, never emitted");
      deepStrictEqual(plain(tables.deliveries), {
        columns: {
          id: "Id", recipient: "Principal", row: { Ref: { table: "messages" } }, incarnation: "Int",
          conversationId: { Ref: { table: "conversations" } },
          kind: { Enum: { variants: ["delivered", "changed", "removed"] } }, audience: "Int", seq: "Int", at: "Time",
        },
        indexes: {
          byId: index(["id"], true),
          byRecipient: index(["recipient", "seq", "id"]),
          byRecipientGroup: index(["recipient", "conversationId", "kind", "seq", "id"]),
          byRow: index(["row", "kind", "recipient"]),
        },
        rules: { read: { Eq: [{ Field: "recipient" }, "Viewer"] }, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [{ Immutable: { fields: ["at", "audience", "conversationId", "incarnation", "kind", "recipient", "row", "seq"] } }],
        retain: "until-revoked",
        tombstones: [{ table: "messages", column: "row", when: { Eq: [{ Field: "kind" }, { Literal: { String: "removed" } }] } }],
      });
      deepStrictEqual(plain(tables.deliveriesReceipts), {
        columns: {
          id: "Id", row: { Ref: { table: "messages" } }, recipient: "Principal", received: "Bool", seq: "Int",
          conversationId: { Ref: { table: "conversations" } },
        },
        indexes: { byId: index(["id"], true), byRow: index(["row", "recipient"], true) },
        rules: {
          read: { Exists: { table: "memberships", index: "byConversationPrincipal", key: [{ Field: "conversationId" }, "Viewer"], provenance: "Shape" } },
          insert: "Deny", update: "Deny", delete: "Deny",
        },
        constraints: [{ Unique: { index: "byRow" } }, { Immutable: { fields: ["recipient", "row"] } }],
        retain: "until-revoked",
      });
      for (const name of ["deliveries", "deliveriesReceipts", "memberships"]) {
        assert(!Object.hasOwn(tables[name]!, "deliver"), `${name} carries a deliver key without a declaration`);
      }
      const source = lowered.sources["schema.tables.messages.deliver"];
      assert(source?.file === "snapback/schema.q" && source.line === LINE && source.col === 3, `deliver lost its authored site: ${JSON.stringify(source)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, undefined, lowered.project.effects);
      assert(checked.every((item) => !item.error), `Rust refused the generated shapes: ${JSON.stringify(checked.filter((item) => item.error))}`);
      for (const alias of ["type DeliveriesRow = {", "type DeliveriesReceiptsRow = {", "  received: boolean;", "  audience: number;"]) {
        assert(lowered.apiDts.includes(alias), `api.d.ts lost ${alias}`);
      }
    });
  });

  test("Quarry deliver refusals are sited, coded, rewritten, and paged", () => {
    const line = "deliver to memberships[.conversationId] as deliveries";
    const cases: Array<{ name: string; deliver: string; cap?: string; member?: string; code: string; family: string; guide: string; message: string; rewrite: RegExp }> = [
      { name: "uncapped target", deliver: line, cap: "", code: "E_DELIVER_UNBOUNDED", family: "bound", guide: "offline/deliver",
        message: "pins no capped group", rewrite: /^cap 50 by conversationId$/ },
      { name: "cap arity", deliver: line, cap: "cap 50 by conversationId, principal", code: "E_DELIVER_UNBOUNDED", family: "bound", guide: "offline/deliver",
        message: "memberships has no cap N by conversationId", rewrite: /^cap 50 by conversationId$/ },
      { name: "cap by another column", deliver: line, cap: "cap 50 by principal", member: "by byPrincipal: principal", code: "E_DELIVER_UNBOUNDED", family: "bound", guide: "offline/deliver",
        message: "memberships has no cap N by conversationId", rewrite: /^cap 50 by conversationId$/ },
      { name: "two principals", deliver: line, member: "invitedBy: principal", code: "E_DELIVER_PRINCIPAL", family: "schema", guide: "offline/deliver",
        message: "has 2 principal columns (principal, invitedBy)", rewrite: /^deliver to memberships\[\.conversationId\] by \.principal as deliveries$/ },
      { name: "by names text", deliver: "deliver to memberships[.conversationId] by .role as deliveries", member: "role: text <=10", code: "E_DELIVER_PRINCIPAL", family: "schema", guide: "offline/deliver",
        message: "memberships.role is text, not principal", rewrite: /^deliver to memberships\[\.conversationId\] by \.principal as deliveries$/ },
      { name: "by names nothing", deliver: "deliver to memberships[.conversationId] by .who as deliveries", code: "E_DELIVER_PRINCIPAL", family: "schema", guide: "offline/deliver",
        message: "memberships has no such column", rewrite: /^deliver to .* by \.principal as deliveries$/ },
      { name: "as collides", deliver: "deliver to memberships[.conversationId] as memberships", code: "E_QUARRY_UNKNOWN", family: "quarry", guide: "quarry/names",
        message: "memberships is already declared", rewrite: /^deliver to memberships\[\.conversationId\] by \.principal as membershipsLog$/ },
      { name: "unknown target", deliver: "deliver to rooms[.conversationId] as deliveries", code: "E_QUARRY_UNKNOWN", family: "quarry", guide: "quarry/names",
        message: "unknown table rooms", rewrite: /^-- / },
      { name: "unknown prefix column", deliver: "deliver to memberships[.threadId] as deliveries", code: "E_QUARRY_UNKNOWN", family: "quarry", guide: "quarry/names",
        message: "prefix key .threadId is not a column of messages", rewrite: /^-- / },
      { name: "missing to", deliver: "deliver memberships[.conversationId] as deliveries", code: "E_QUARRY_SYNTAX", family: "quarry", guide: "quarry/grammar",
        message: "requires a target range", rewrite: /^-- deliver to memberships/ },
      { name: "missing as", deliver: "deliver to memberships[.conversationId]", code: "E_QUARRY_SYNTAX", family: "quarry", guide: "quarry/grammar",
        message: "requires as <name>", rewrite: /^-- deliver to memberships/ },
      { name: "with takes receipts", deliver: "deliver to memberships[.conversationId] as deliveries with seen", code: "E_QUARRY_SYNTAX", family: "quarry", guide: "quarry/grammar",
        message: "with takes receipts", rewrite: /with receipts$/ },
      { name: "two lines", deliver: `${line}\n  deliver to memberships[.conversationId] as custody`, code: "E_QUARRY_SYNTAX", family: "quarry", guide: "quarry/grammar",
        message: "more than one deliver line", rewrite: /^-- one deliver line per table$/ },
    ];
    for (const item of cases) {
      const compiled = compileInline([{ fileName: "snapback/schema.q", source: schemaWith(item.deliver, item.cap, item.member) }]);
      assert(!compiled.ok, `${item.name} was accepted`);
      const refusal = compiled.diagnostics.find((diagnostic) => diagnostic.code === item.code);
      assert(refusal, `${item.name} did not refuse with ${item.code}: ${JSON.stringify(compiled.diagnostics)}`);
      assert(refusal.message.includes(item.message), `${item.name} message changed: ${refusal.message}`);
      assert(refusal.family === item.family && refusal.guide === item.guide, `${item.name} lost its family or page: ${JSON.stringify(refusal)}`);
      assert(item.rewrite.test(refusal.rewrite), `${item.name} rewrite changed: ${refusal.rewrite}`);
      const expectedLine = item.name === "two lines" ? LINE + 1 : LINE;
      assert(refusal.site === `snapback/schema.q:${expectedLine}:3`, `${item.name} lost its authored site: ${refusal.site}`);
    }
    const mismatch = compileInline([{ fileName: "snapback/schema.q",
      source: schemaWith(line).replace("table messages:\n  conversationId: conversations", "table messages:\n  conversationId: text <=40") }]);
    assert(!mismatch.ok && mismatch.diagnostics[0]?.code === "E_QUARRY_TYPE"
      && mismatch.diagnostics[0].message.includes("does not match memberships.conversationId"), JSON.stringify(mismatch));
    // The cap needs its enforcement index before Rust sees the schema: the same refusal and rewrite the engine gives.
    const indexless = compileInline([{ fileName: "snapback/schema.q", source: schemaWith(line)
      .replace("by byConversationPrincipal: conversationId, principal", "by byPrincipalConversation: principal, conversationId")
      .replace(/memberships\[\.conversationId, viewer\]/g, "memberships[viewer, .conversationId]") }]);
    assert(!indexless.ok, "a cap without an index led by its columns was admitted");
    const unenforced = indexless.diagnostics.find((diagnostic) => diagnostic.code === "E_DELIVER_UNBOUNDED");
    assert(unenforced?.message.includes("cap 50 by conversationId on memberships has no index whose leading columns are conversationId")
      && unenforced.rewrite === "by byGroup: conversationId, principal" && unenforced.family === "bound" && unenforced.guide === "offline/deliver"
      && unenforced.site === `snapback/schema.q:${LINE}:3`, JSON.stringify(indexless.diagnostics));
  });

  // @ref LLP 1019#1-the-declaration — the pinned group is the cap whose `by` equals the prefix, never the first same-arity cap.
  test("Quarry deliver binds the cap whose by equals the prefix, past same-arity caps of either type", async () => {
    const cases = [
      { name: "another type first", cap: "cap 1 by principal\n  cap 50 by conversationId", member: "by byPrincipal: principal" },
      { name: "the same stored type first", cap: "cap 8 by teamId\n  cap 50 by conversationId", member: "teamId: conversations\n  by byTeam: teamId" },
    ];
    for (const item of cases) {
      const compiled = compileInline([{ fileName: "snapback/schema.q", source: schemaWith("deliver to memberships[.conversationId] as deliveries", item.cap, item.member) }]);
      assert(compiled.ok, `${item.name}: ${compiled.ok ? "" : JSON.stringify(compiled.diagnostics)}`);
      deepStrictEqual(plain(compiled.project.schema.tables.messages?.deliver), { target: "memberships", prefix: ["conversationId"], principal: "principal", log: "deliveries" }, item.name);
      const checked = rustCheck([], "synthetic", compiled.project.schema, undefined, compiled.project.effects);
      assert(checked.every((result) => !result.error), `${item.name}: Rust refused the generated shapes: ${JSON.stringify(checked.filter((result) => result.error))}`);
    }
  });

  // @ref LLP 1019#2-the-custody-log — the log is an ordinary row table, so a maintain may count it.
  test("Quarry maintains count a custody log", () => {
    const compiled = compileInline([{ fileName: "snapback/schema.q",
      source: `${schemaWith("deliver to memberships[.conversationId] as deliveries")}\nmaintain unread: count deliveries by recipient\n  read <- .recipient = viewer\n` }]);
    assert(compiled.ok, `a maintain over the log refused: ${compiled.ok ? "" : JSON.stringify(compiled.diagnostics)}`);
    const unread = compiled.project.schema.maintains.find((maintain) => (maintain as { target?: string }).target === "unread");
    assert(unread && (unread as { source?: string }).source === "deliveries", JSON.stringify(compiled.project.schema.maintains));
    assert(Object.hasOwn(compiled.project.schema.tables, "unread") && Object.hasOwn(compiled.project.schema.tables, "deliveries"), Object.keys(compiled.project.schema.tables).join(","));
  });

  test("programs read a generated custody table and never write it", async () => {
    const write = compileInline([
      { fileName: "snapback/schema.q", source: schemaWith("deliver to memberships[.conversationId] as deliveries") },
      { fileName: "snapback/ops.q", source: "mutation fake(messageId: messages):\n  insert deliveries { recipient: viewer, row: messageId, incarnation: 1, conversationId: messageId, kind: 'delivered', audience: 1, seq: 1, at: now }\n  return null\n" },
    ]);
    assert(!write.ok, "a program wrote the generated log");
    const refusal = write.diagnostics.find((item) => item.code === "E_QUARRY_UNSUPPORTED");
    assert(refusal?.message.includes("writing deliveries") && refusal.rewrite.includes("write messages"), JSON.stringify(write.diagnostics));
    await withProject({
      "snapback/schema.q": schemaWith("deliver to memberships[.conversationId] as deliveries"),
      "snapback/ops.q": "query inbox(c: cursor ?):\n  return deliveries[viewer] after c first 50 by byRecipient { *, message: messages[.row] }\n",
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `reading the log refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, undefined, lowered.project.effects);
      assert(checked.every((item) => !item.error), `Rust refused the inbox read: ${JSON.stringify(checked)}`);
      const forged: typeof lowered.project.programs[number] = { name: "ops.forge", kind: "Mutation", args: {}, read_time_granularity_ms: null,
        body: [{ Insert: { table: "deliveries", row: { Object: { id: { Input: "NewId" } } } } }, { Return: { Literal: "Null" } }] };
      const refused = rustCheck([forged], "synthetic", lowered.project.schema, undefined, lowered.project.effects);
      assert(refused[0]?.error?.code === "E_SCHEMA_DELIVER" && refused[0].error.message.includes("engine-owned table deliveries")
        && refused[0].error.family === "schema" && refused[0].error.guide === "offline",
        `raw IR wrote the log: ${JSON.stringify(refused)}`);
      // A raw-schema refusal leaves check --ir as itself: code, family, page, and the declaration's site.
      const uncapped = structuredClone(lowered.project.schema) as typeof lowered.project.schema & { tables: Record<string, { constraints?: unknown[] }> };
      uncapped.tables.memberships!.constraints = [];
      const [schemaResult] = rustCheck([], "synthetic", uncapped, undefined, lowered.project.effects);
      deepStrictEqual(
        schemaResult && { program: schemaResult.program, ...schemaResult.error },
        { program: "<schema>", code: "E_DELIVER_UNBOUNDED", family: "bound", guide: "offline/deliver", site: "schema.tables.messages.deliver",
          message: "deliver to memberships[.conversationId] pins no capped group: memberships has no cap N by conversationId", rewrite: "cap 50 by conversationId" },
        `check --ir relabeled the raw refusal: ${JSON.stringify(schemaResult)}`);
    });
  });
}
