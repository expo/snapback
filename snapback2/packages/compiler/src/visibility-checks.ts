import { lowerSource, type TableInfo } from "./compiler";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, diagnosticsText, withProject, type Test } from "./quarry-check-helpers";

const selfProbe = { Exists: { table: "memberships", index: "byConversationPrincipal",
  key: [{ Field: "conversationId" }, "Viewer"], provenance: "Shape" } };
const viewerEq = { Eq: [{ Field: "principal" }, "Viewer"] };
const varyingEq = { Eq: [{ Field: "conversationId" }, { Literal: { Id: "c1" } }] };
const ownLiteral = { Eq: [{ Field: "principal" }, { Literal: { Id: "alice" } }] };

function table(rule: unknown): TableInfo {
  return { name: "memberships", private: true,
    columns: { id: { kind: "string", id: true }, conversationId: { kind: "string", id: true }, principal: { kind: "principal" } },
    indexes: {
      byPrincipalConversation: { columns: ["principal", "conversationId"], types: [{ kind: "principal" }, { kind: "string", id: true }] },
      byConversationPrincipal: { columns: ["conversationId", "principal"], types: [{ kind: "string", id: true }, { kind: "principal" }], unique: true },
    }, readRule: rule,
  };
}

const schema = `use identity password
table conversations:
  title: text 1..50
  read <- exists memberships[.id, viewer]
  insert <- allow
  update <- deny
  delete <- deny
table memberships:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId
  cap 100 by principal
  read <- exists memberships[.conversationId, viewer]
  insert <- allow
  update <- deny
  delete <- deny
table words:
  conversationId: conversations
  term: text 1..64
  at: time
  by byConversationTermTime: conversationId, term, at, id
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer]
  update <- deny
  delete <- deny
`;

export function registerVisibilityChecks(test: Test): void {
  test("compiler and Rust distinguish lowered viewer identity from a shadowed ctx", async () => {
    const fixture = await Bun.file(new URL("../../../corpus/self-probe-enriched-membership-page.json", import.meta.url)).json();
    for (const shadowed of [false, true]) {
      const source = `import { query, principal } from "snapback2";
        export const count = query({ owner: principal() }, ({ db, ctx, args }) => {
          { ${shadowed ? "const ctx = { viewer: args.owner };" : ""}
            return db.scan(memberships.byPrincipalConversation, [ctx.viewer], { take: 100 }).count();
          }
        });`;
      // Disable only the mirror to get the identical lowered program to the Rust checker.
      const unchecked = lowerSource(source, "visibility.ts", undefined, { tables: new Map([
        ["memberships", { ...table(selfProbe), private: false }],
      ]) });
      assert(unchecked.ok, JSON.stringify(unchecked));
      const checked = rustCheck(unchecked.programs, "synthetic", fixture.schema);
      assert(shadowed ? checked.some((c) => c.error?.code === "E_STRUCTURAL_COUNT")
        : checked.every((c) => !c.error), JSON.stringify(checked));
      const mirrored = lowerSource(source, "visibility.ts", undefined, { tables: new Map([["memberships", table(selfProbe)]]) });
      assert(mirrored.ok === !shadowed, JSON.stringify(mirrored));
      if (!mirrored.ok) assert(mirrored.diagnostics.some((d) => d.code === "E_STRUCTURAL_COUNT"), diagnosticsText(mirrored.diagnostics));
    }
  });

  test("compiler uniformity mirror decides self probes and Or arms from actual prefix values", () => {
    const cases: Array<[string, unknown, string, string, boolean]> = [
      ["self", selfProbe, "byPrincipalConversation", "ctx.viewer", true],
      ["other principal", selfProbe, "byPrincipalConversation", '"bob"', false],
      ["argument is not viewer", selfProbe, "byPrincipalConversation", "args.owner", false],
      ["pinned rule input", selfProbe, "byConversationPrincipal", '"c1"', true],
      ["viewer Or self", { Or: [viewerEq, selfProbe] }, "byPrincipalConversation", "ctx.viewer", true],
      ["conversation Or", { Or: [viewerEq, selfProbe] }, "byConversationPrincipal", '"c1"', false],
      ["viewer decides", { Or: [varyingEq, viewerEq] }, "byPrincipalConversation", "ctx.viewer", true],
      ["mere pinnedness", { Or: [viewerEq, varyingEq] }, "byPrincipalConversation", '"bob"', false],
      ["literal decides", { Or: [ownLiteral, varyingEq] }, "byPrincipalConversation", '"alice"', true],
      ["viewer is not literal", { Or: [ownLiteral, varyingEq] }, "byPrincipalConversation", "ctx.viewer", false],
      ["all pinned", { Or: [viewerEq, varyingEq] }, "byPrincipalConversation", '"bob", "c2"', true],
      ["public", { Or: [varyingEq, { Public: { reason: "public" } }] }, "byPrincipalConversation", "ctx.viewer", true],
      ["allow", { Or: ["Allow", varyingEq] }, "byPrincipalConversation", "ctx.viewer", true],
      ["self disjunct", { Or: [varyingEq, selfProbe] }, "byPrincipalConversation", "ctx.viewer", true],
      ["conjunction", { And: [viewerEq, varyingEq] }, "byPrincipalConversation", "ctx.viewer", false],
    ];
    for (const [name, rule, index, prefix, admitted] of cases) {
      const source = `import { query } from "snapback2";
        export const count = query({ owner: scalar() }, ({ db, ctx, args }) =>
          db.scan(memberships.${index}, [${prefix}], { take: 100 }).count());`;
      const result = lowerSource(source, "visibility.ts", undefined, { tables: new Map([["memberships", table(rule)]]) });
      assert(result.ok === admitted, `${name}: ${JSON.stringify(result)}`);
      if (!result.ok) assert(result.diagnostics.some((d) => d.code === "E_STRUCTURAL_COUNT"), diagnosticsText(result.diagnostics));
    }
  });

  test("compiler self probe requires the complete nonoptional unique key on the same table", () => {
    for (const change of ["optional", "nonunique", "partial", "other table", "wrong field"] as const) {
      const info = table(structuredClone(selfProbe));
      const probe = (info.readRule as typeof selfProbe).Exists;
      if (change === "optional") info.columns!.conversationId = { kind: "optional", of: { kind: "string", id: true } };
      if (change === "nonunique") info.indexes!.byConversationPrincipal!.unique = false;
      if (change === "partial") probe.key.pop();
      if (change === "other table") probe.table = "other";
      if (change === "wrong field") probe.key[0] = { Field: "id" };
      const source = `import { query } from "snapback2";
        export const count = query({}, ({ db, ctx }) =>
          db.scan(memberships.byPrincipalConversation, [ctx.viewer], { take: 100 }).count());`;
      const result = lowerSource(source, "visibility.ts", undefined, { tables: new Map([["memberships", info]]) });
      assert(!result.ok && result.diagnostics.some((d) => d.code === "E_STRUCTURAL_COUNT"), `${change}: ${JSON.stringify(result)}`);
    }
  });

  test("compiler literal truth uses column scaling instead of the numeric source spelling", () => {
    const info = table({ Or: [{ Eq: [{ Field: "principal" }, { Literal: { Int: 250 } }] }, varyingEq] });
    info.columns!.principal = { kind: "decimal", scale: 2 };
    info.indexes!.byPrincipalConversation!.types[0] = { kind: "decimal", scale: 2 };
    info.indexes!.byConversationPrincipal!.types[1] = { kind: "decimal", scale: 2 };
    for (const [prefix, admitted] of [["2.5", true], ["250", false]] as const) {
      const source = `import { query } from "snapback2";
        export const count = query({}, ({ db }) =>
          db.scan(memberships.byPrincipalConversation, [${prefix}], { take: 100 }).count());`;
      const result = lowerSource(source, "visibility.ts", undefined, { tables: new Map([["memberships", info]]) });
      assert(result.ok === admitted, `${prefix}: ${JSON.stringify(result)}`);
    }
  });

  for (const [name, source, refused] of [
    ["enriched page", `query list():
  return memberships[viewer] first 100 by byPrincipalConversation { conversationId, conversation: conversations[.conversationId] { title } }
`, false],
    ["enriched merge", `query all(term: text 1..64, c: cursor ?):
  page = merge words after c last 20 by byConversationTermTime:
    [seat.conversationId, term] for seat in memberships[viewer] first 100 by byPrincipalConversation
  return page { id, conversation: conversations[.conversationId] { title } }
`, false],
    ["covering fanout", `mutation fanout(term: text 1..64):
  for seat in memberships[viewer] first 100 by byPrincipalConversation:
    insert words { conversationId: seat.conversationId, term, at: now }
  return true
`, false],
    ["short fanout", `mutation fanout(term: text 1..64):
  for seat in memberships[viewer] first 50 by byPrincipalConversation:
    insert words { conversationId: seat.conversationId, term, at: now }
  return true
`, true],
  ] as const) {
    test(`Quarry membership self-probe ${name}`, async () => {
      await withProject({ "snapback/schema.q": schema, "snapback/search.q": source }, async (root) => {
        const lowered = await lowerProject(root);
        assert(lowered.ok, lowered.ok ? "" : diagnosticsText(lowered.diagnostics));
        const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
        if (refused) assert(checked.some((c) => c.error?.code === "E_STRUCTURAL_FANOUT" && c.error.message.includes("below cap 100")), JSON.stringify(checked));
        else {
          assert(checked.every((c) => !c.error), JSON.stringify(checked));
          const sites = (checked[0]!.certificate as any).read_sites;
          assert(sites.some((s: any) => s.table === "memberships" && s.hoist && s.decided_true && s.rule_probes_per_candidate === 0), JSON.stringify(sites));
        }
      });
    });
  }
}
