import ts from "typescript";
import { lowerProject } from "./project";
import { lowerSource } from "./compiler";
import { analyzeOperationTypes } from "./type-analysis";
import { authoredTypeFromColumn } from "./authored-types";
import { contextualNodeKey } from "./syntax";
import { rustCheck } from "./rust-check";
import { assert, withProject, type Test } from "./quarry-check-helpers";

export function registerQuarryWordsChecks(test: Test, libText: string): void {
for (const [label, domain, max, width] of [
  ["direct", "words(body)", 4001, 8000], ["alias", "terms", 4001, 8000], ["column", "words(row.body)", 4001, 8000],
  ["literal", "words('A b')", 7, 12], ["odd", "words('a b c')", 11, 20], ["empty", "words('')", 1, 0],
  ["optional", "words(maybe)", 41, 80], ["optional fallback", "words(maybe ?? '')", 41, 80], ["Unicode scalars", "words('🙂A 🙂b')", 11, 20],
  ["wider column fallback", "words(row.maybe ?? row.body)", 4001, 8000],
  ["narrower column fallback", "words(row.wideMaybe ?? row.narrow)", 4001, 8000],
  ["wider argument-to-column fallback", "words(maybe ?? row.body)", 4001, 8000],
] as const) {
  test(`Quarry words derives a ${max}-item text list and ${label} for domain`, async () => {
    await withProject({
      "snapback/schema.q": `table docs:
  body: text <=2000
  maybe: text <=20 ?
  wideMaybe: text <=2000 ?
  narrow: text <=20
  public
  insert <- allow
`,
      "snapback/probe.q": `mutation probe(body: text <=2000, maybe: text <=20 ?):
  terms = words(body)
  row = insert docs { body, narrow: 'a' }
  for term in ${domain}:
    require term != '' else EMPTY
  return { terms, count: count(words(body)) }
`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(result.ok, JSON.stringify(result));
      const program = result.project.programs[0]!;
      const ir = JSON.stringify(program);
      assert(ir.includes('"builtin":"Words"'), ir);
      const loop = program.body.find((statement) => typeof statement === "object" && "For" in statement);
      assert(loop && typeof loop === "object" && "For" in loop && "DerivedArray" in loop.For.domain && loop.For.domain.DerivedArray.max === max, ir);
      // Inspect the same inferred list type consumed by lowering, including the item width.
      const source = result.quarry.find((m) => m.file === "snapback/probe.q")!.source;
      const sourceFile = ts.createSourceFile("probe.ts", source, ts.ScriptTarget.Latest, true);
      const declaration = sourceFile.statements.find((s) => ts.isVariableStatement(s)
        && s.declarationList.declarations[0]?.name.getText(sourceFile) === "probe") as ts.VariableStatement;
      const call = declaration.declarationList.declarations[0]!.initializer as ts.CallExpression;
      const columns = (result.project.schema.tables as any).docs.columns;
      const plan = analyzeOperationTypes({ source, sourceFile, fileName: "probe.ts", tables: new Map([
        ["docs$table", { name: "docs", private: false, columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, authoredTypeFromColumn(v)])) }],
      ]) }, call);
      const handler = call.arguments[1] as ts.ArrowFunction;
      const domain = (handler.body as ts.Block).statements.find(ts.isForOfStatement)!.expression;
      const type = plan.expressionTypes.get(contextualNodeKey("operation", domain, sourceFile));
      assert(type?.kind === "list" && type.max === max && type.of.kind === "string"
        && type.of.max === width, JSON.stringify(type));
      const checked = rustCheck([program], "synthetic", result.project.schema);
      assert(checked.every((item) => !item.error), JSON.stringify(checked));
    });
  });
}

test("words refuses constructed text at the Quarry boundary with a declared-bound repair", async () => {
  for (const expression of ["a + b", "built", "{ body: a + b }.body", "maybe ?? (a + b)",
    "(a + b) ?? maybe", "built ?? a", "(a + b) ?? ''"]) {
    await withProject({
      "snapback/schema.q": "table docs:\n  body: text <=2000\n  public\n",
      "snapback/probe.q": `query probe(a: text <=4, b: text <=4, maybe: text <=4 ?):\n  built = a + b\n  return words(${expression})\n`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.some((d) => d.code === "E_QUARRY_TYPE"
        && d.site.startsWith("snapback/probe.q:") && d.family === "quarry"
        && d.guide === "quarry/types" && d.rewrite?.includes("body: text <=N")), JSON.stringify(result));
    });
  }
});

test("words refuses equal-max TS plus, aliases and templates with a declared-bound repair", () => {
  for (const expression of ["args.a + args.b", "built", "`${args.a}${args.b}`", "{ body: built }.body", "args.a ?? built",
    "(args.a + args.b) ?? args.maybe", "built ?? args.a", "(args.a + args.b) ?? ''"]) {
    const source = `import { query, t, words } from "snapback2";
    export const probe = query({ a: t.text(4), b: t.text(4), maybe: t.optional(t.text(4)) }, ({ args }) => {
      const built = args.a + args.b;
      return words(${expression});
    });`;
    const result = lowerSource(source, "words.ts", libText);
    assert(!result.ok && result.diagnostics.some((d) => d.code === "E_QUARRY_TYPE"
      && d.site.startsWith("words.ts:") && d.family === "quarry"
      && d.guide === "quarry/types" && d.rewrite?.includes("t.text(N)")), JSON.stringify(result));
  }
});

test("words refuses a wider optional literal fallback rather than deriving the left bound", async () => {
  await withProject({
    "snapback/schema.q": "table docs:\n  body: text <=2000\n  public\n",
    "snapback/probe.q": "query probe(maybe: text <=20 ?):\n  for term in words(maybe ?? 'a b c d e f g h i j k l m n o p q r s t u'):\n    require term != '' else EMPTY\n  return true\n",
  }, async (root) => {
    const result = await lowerProject(root);
    assert(!result.ok && result.diagnostics.some((d) => d.code === "E_ARGS_TYPE"
      && d.message.includes("41 Unicode scalars") && d.site.startsWith("snapback/probe.q:")), JSON.stringify(result));
  });
});
test("Quarry words refuses non-text and wrong arity with a rewrite", async () => {
  for (const call of ["words(n)", "words()", "words('a', 'b')"]) {
    await withProject({
      "snapback/schema.q": "table docs:\n  body: text <=2000\n  public\n",
      "snapback/probe.q": `query probe(n: int, maybe: text <=20 ?):\n  return ${call}\n`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok, `${call} admitted`);
      assert(result.diagnostics.some((d) => d.code === "E_QUARRY_TYPE"
        && d.message.includes("words") && d.rewrite?.includes("words")), JSON.stringify(result));
    });
  }
});

}
