import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { IR_CONTRACT } from "./ir";
import { lowerProject } from "./project";
import { lex } from "./quarry/lexer";
import { parseDocument } from "./quarry/parser";

type Test = (name: string, run: () => void | Promise<void>) => void;

export function registerRetentionChecks(test: Test): void {
  test("Quarry retention policies are single tokens and parse with an omitted default", () => {
    const source = `table defaultRows:
  label: text <=20
  public

table revokedRows:
  label: text <=20
  retain until-revoked
  public

table historyRows:
  label: text <=20
  retain delivered-history
  public
`;
    const lexical = lex("snapback/schema.q", source);
    assert(lexical.diagnostics.length === 0, `retention spellings did not lex: ${JSON.stringify(lexical.diagnostics)}`);
    for (const policy of IR_CONTRACT.retentionPolicies) {
      assert(lexical.tokens.filter((token) => token.value === policy).length === 1, `${policy} was not one lexer token`);
    }
    const parsed = parseDocument("snapback/schema.q", source);
    assert(parsed.diagnostics.length === 0, `retention declarations did not parse: ${JSON.stringify(parsed.diagnostics)}`);
    const [omitted, revoked, history] = parsed.document.tables;
    assert(omitted?.retain === undefined, "omitted retention acquired an authored declaration");
    assert(revoked?.retain?.policy === "until-revoked", "explicit until-revoked policy was lost");
    assert(history?.retain?.policy === "delivered-history", "delivered-history policy was lost");
  });

  test("Quarry retention refusals are sited and rewrite to both valid spellings", () => {
    for (const [name, source, line] of [
      ["bad", "table rows:\n  label: text <=20\n  retain forever\n", 3],
      ["bare", "table rows:\n  label: text <=20\n  retain\n", 3],
      ["quoted", "table rows:\n  label: text <=20\n  retain \"until-revoked\"\n", 3],
      ["trailing", "table rows:\n  label: text <=20\n  retain delivered-history forever\n", 3],
      ["duplicate", "table rows:\n  label: text <=20\n  retain until-revoked\n  retain delivered-history\n", 4],
    ] as const) {
      const parsed = parseDocument(`snapback/${name}.q`, source);
      const refusal = parsed.diagnostics.find((item) => item.code === "E_QUARRY_RETAIN");
      assert(refusal?.line === line && refusal.col === 3, `${name} retention refusal lost its line site: ${JSON.stringify(parsed.diagnostics)}`);
      assert(refusal.rewrite.includes("retain until-revoked") && refusal.rewrite.includes("retain delivered-history"),
        `${name} retention refusal lost the two-spelling rewrite: ${refusal.rewrite}`);
      assert(refusal.guide === "quarry/grammar", `${name} retention refusal lost its guide page`);
    }
  });

  test("Quarry retention words are contextual and subtraction keeps its token shape", () => {
    for (const [name, source] of [
      ["table-policy-name", "table until-revoked:\n  value: int\n  public\n"],
      ["binding-policy-name", "query invalid(a: int, history: int):\n  delivered-history = a-history\n  return delivered-history\n"],
    ] as const) {
      const parsed = parseDocument(`snapback/${name}.q`, source);
      assert(parsed.diagnostics.some((item) => item.code === "E_QUARRY_SYNTAX"),
        `${name} did not refuse cleanly: ${JSON.stringify(parsed.diagnostics)}`);
    }

    const subtraction = "query subtract(a: int, b: int):\n  return a-b\n";
    const lexical = lex("snapback/subtract.q", subtraction);
    assert(lexical.diagnostics.length === 0, `subtraction did not lex: ${JSON.stringify(lexical.diagnostics)}`);
    assert(lexical.tokens.some((token, index, tokens) => token.value === "-"
      && tokens[index - 1]?.value === "a" && tokens[index + 1]?.value === "b"),
    `a-b did not retain its word/minus/word tokens: ${JSON.stringify(lexical.tokens)}`);
    const parsed = parseDocument("snapback/subtract.q", subtraction);
    assert(parsed.diagnostics.length === 0, `subtraction did not parse: ${JSON.stringify(parsed.diagnostics)}`);
  });

  test("Quarry retention lowers into every project JSON table", async () => {
    await withProject({
      "snapback/schema.q": `table defaultRows:
  label: text <=20
  public

table revokedRows:
  label: text <=20
  retain until-revoked
  public

table historyRows:
  label: text <=20
  retain delivered-history
  public
`,
      "snapback/reads.q": "query ready():\n  return true\n",
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `retention project refused: ${lowered.ok ? "" : JSON.stringify(lowered.diagnostics)}`);
      assert(lowered.project.schema.tables.defaultRows?.retain === "until-revoked", "omission did not lower to until-revoked");
      assert(lowered.project.schema.tables.revokedRows?.retain === "until-revoked", "explicit until-revoked did not lower");
      assert(lowered.project.schema.tables.historyRows?.retain === "delivered-history", "delivered-history did not lower");
    });
  });
}

async function withProject(files: Record<string, string>, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-retention-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
