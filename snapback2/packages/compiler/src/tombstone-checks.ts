import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lowerProject } from "./project";
import { parseDocument } from "./quarry/parser";
import { rustCheck } from "./rust-check";
import { assert, compileInline, withProject, type Test } from "./quarry-check-helpers";

// @ref LLP 1012#5-retention-revocation-and-the-fence — rule 3's word on the log table:
// the grammar, the row-local restriction, the schema encoding, and the Rust boundary agree.

const SCHEMA = `use identity

table conversations:
  title: text <=120
  public

table messages:
  conversationId: conversations
  body: text <=4000 ?
  retain delivered-history
  public

table deliveries:
  recipient: principal
  conversationId: conversations
  messageId: messages
  editOf: messages ?
  kind: enum('message', 'edit', 'removed', 'expired')
  final: bool
  note: text <=20 ?
  at: time
  by byRecipientAt: recipient, at, id
  TOMBSTONES
  read <- .recipient = viewer
  insert <- .recipient = viewer
  update <- deny
  delete <- deny
`;
const LINE = SCHEMA.split("\n").findIndex((line) => line.includes("TOMBSTONES")) + 1;
const READS = "query ready():\n  return true\n";

function schemaWith(...lines: string[]): string {
  return SCHEMA.replace("  TOMBSTONES", lines.map((line) => `  ${line}`).join("\n"));
}

export function registerTombstoneChecks(test: Test): void {
  test("Quarry tombstones parse as a union of sited declarations reusing the rule grammar", () => {
    const parsed = parseDocument("snapback/schema.q", schemaWith(
      "tombstones messages[.messageId] if .kind = 'removed' or .kind = 'expired'",
      "tombstones messages[.editOf] if not (.kind = 'edit') and .final = true",
    ));
    assert(parsed.diagnostics.length === 0, `tombstones did not parse: ${JSON.stringify(parsed.diagnostics)}`);
    const deliveries = parsed.document.tables.find((table) => table.name === "deliveries")!;
    assert(deliveries.tombstones.length === 2, "both tombstones lines were not kept");
    const [first, second] = deliveries.tombstones;
    assert(first!.table === "messages" && first!.column === "messageId" && first!.site.line === LINE && first!.site.col === 3, JSON.stringify(first));
    assert(first!.predicate.kind === "binary" && first!.predicate.op === "or", "the predicate is the rule expression tree");
    assert(second!.column === "editOf" && second!.site.line === LINE + 1, JSON.stringify(second));
    assert(parsed.document.tables.every((table) => table.name === "deliveries" || table.tombstones.length === 0), "undeclared tables acquired tombstones");
  });

  test("Quarry tombstones lower into the schema JSON in the rule encoding and certify in Rust", async () => {
    await withProject({
      "snapback/schema.q": schemaWith("tombstones messages[.messageId] if .kind = 'removed' or .kind = 'expired'", "tombstones messages[.editOf] if .final = true"),
      "snapback/reads.q": READS,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `tombstones project refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      const tables = lowered.project.schema.tables;
      const expected = [
        { table: "messages", column: "messageId", when: { Or: [
          { Eq: [{ Field: "kind" }, { Literal: { String: "removed" } }] },
          { Eq: [{ Field: "kind" }, { Literal: { String: "expired" } }] },
        ] } },
        { table: "messages", column: "editOf", when: { Eq: [{ Field: "final" }, { Literal: { Bool: true } }] } },
      ];
      assert(JSON.stringify(tables.deliveries?.tombstones) === JSON.stringify(expected), `tombstones lowered as ${JSON.stringify(tables.deliveries?.tombstones)}`);
      for (const name of ["messages", "conversations"]) {
        assert(!Object.hasOwn(tables[name]!, "tombstones"), `${name} carries a tombstones key without a declaration`);
      }
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, undefined, lowered.project.effects);
      assert(checked.every((item) => !item.error), `Rust refused the tombstones schema: ${JSON.stringify(checked)}`);
    });
  });

  test("Quarry tombstones refusals are sited, coded, rewritten, and paged", () => {
    const cases: Array<[string, string, string, number?]> = [
      ["missing column", "tombstones messages if .kind = 'removed'", "requires the referencing column"],
      ["missing if", "tombstones messages[.messageId]", "requires if <predicate>"],
      ["unknown table", "tombstones bodies[.messageId] if .kind = 'removed'", "names unknown table bodies"],
      ["unknown column", "tombstones messages[.bodyId] if .kind = 'removed'", "names unknown column deliveries.bodyId"],
      ["principal column", "tombstones messages[.recipient] if .kind = 'removed'", "column deliveries.recipient is principal, not a reference to messages"],
      ["reference to another table", "tombstones messages[.conversationId] if .kind = 'removed'", "column deliveries.conversationId is ref, not a reference to messages"],
      ["viewer", "tombstones messages[.messageId] if .kind = viewer", "cannot mention viewer", 46],
      ["exists", "tombstones messages[.messageId] if exists messages[.messageId]", "cannot probe other tables with exists", 38],
      ["unknown predicate column", "tombstones messages[.messageId] if .state = 'removed'", "names unknown column deliveries.state", 38],
      ["time column", "tombstones messages[.messageId] if .at = 'never'", "column .at is time; only enum, bool, and text columns", 38],
      ["id column", "tombstones messages[.messageId] if .id = 'm1'", "column .id is id; only enum, bool, and text columns", 38],
      ["int literal", "tombstones messages[.messageId] if .kind = 1", "literal 1 must be a string or bool", 46],
      ["bool against text", "tombstones messages[.messageId] if .final = 'yes'", "compares a bool with text", 45],
      ["enum variant", "tombstones messages[.messageId] if .kind = 'gone'", "which is not one of message|edit|removed|expired", 46],
      ["argument name", "tombstones messages[.messageId] if kind = 'removed'", "cannot read kind", 38],
    ];
    for (const [name, line, message, col] of cases) {
      const compiled = compileInline([{ fileName: "snapback/schema.q", source: schemaWith(line) }]);
      assert(!compiled.ok, `${name} was accepted`);
      const refusal = compiled.diagnostics.find((item) => item.code === "E_QUARRY_TOMBSTONE");
      assert(refusal, `${name} did not refuse with E_QUARRY_TOMBSTONE: ${JSON.stringify(compiled.diagnostics)}`);
      assert(refusal.message.includes(message), `${name} message changed: ${refusal.message}`);
      assert(refusal.site === `snapback/schema.q:${LINE}:${col ?? 3}`, `${name} lost its authored site: ${refusal.site}`);
      assert(refusal.family === "quarry" && refusal.guide === "quarry/grammar", `${name} lost its family or page: ${JSON.stringify(refusal)}`);
      assert(/^(?:-- )?tombstones .* if /.test(refusal.rewrite), `${name} rewrite is not a tombstones line: ${refusal.rewrite}`);
    }
    const family = compileInline([{ fileName: "snapback/schema.q", source: "table deliveries:\n  recipient: principal\n  messageId: messages\n  kind: enum('message', 'removed')\n  tombstones messages[.recipient] if .kind = 'removed'\n\ntable messages:\n  body: text <=10\n  public\n" }]);
    const wrong = family.ok ? undefined : family.diagnostics[0];
    assert(wrong?.code === "E_QUARRY_TOMBSTONE", `the family's wrong example is not refused by its code: ${JSON.stringify(wrong)}`);
  });

  test("the chat template's deliveries log tombstones removed and expired messages", async () => {
    const template = decodeURIComponent(new URL("../../snapback2/templates/chat", import.meta.url).pathname);
    const source = readFileSync(resolve(template, "snapback/schema.q"), "utf8");
    assert(source.includes("\n  tombstones messages[.messageId] if .kind = 'removed' or .kind = 'expired'\n"), "the template lost its tombstones line");
    const lowered = await lowerProject(template);
    assert(lowered.ok, `chat template refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
    const tombstones = lowered.project.schema.tables.deliveries?.tombstones ?? [];
    assert(tombstones.length === 1 && tombstones[0]!.table === "messages" && tombstones[0]!.column === "messageId", JSON.stringify(tombstones));
    assert(JSON.stringify(tombstones[0]!.when).includes('{"Field":"kind"}'), "the template predicate does not read .kind");
  });
}
