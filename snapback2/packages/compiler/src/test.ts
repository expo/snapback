import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { registerApiShapeChecks } from "./api-shape-checks";
import { runBareUpdateBinderChecks, runBoundSchemaChecks, runUpdateBinderCompatibilityChecks } from "./bound-schema-checks";
import { registerPackageRegressionChecks } from "./package-regression-checks";
import { lowerProject } from "./project";
import { registerQuarryChecks } from "./quarry-checks";
import { registerQuarryFanoutChecks } from "./quarry-fanout-checks";
import { registerQuarryProcChecks } from "./quarry-proc-checks";
import { registerQuarryLanguageChecks } from "./quarry-language-checks";
import { registerQuarryMoneyChecks } from "./quarry-money-checks";
import { registerRetentionChecks } from "./retention-checks";
import { registerDeliveryChecks } from "./delivery-checks";
import { registerEffectLanguageChecks } from "./test-effects";
import { registerFinalGateChecks } from "./test-final-gates";
import { registerPackageGuideChecks } from "./test-package-guide";

const frontend = decodeURIComponent(new URL("../", import.meta.url).pathname);
const crate = decodeURIComponent(new URL("../../../", import.meta.url).pathname);
type Check = { name: string; run: () => void | Promise<void> };
const checks: Check[] = [];
const test = (name: string, run: Check["run"]) => checks.push({ name, run });
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function withProject<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-compiler-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// Build the generated Unicode table before direct compiler and twin checks.
// @ts-ignore — build-only JS implementation is outside the runtime compiler.
const { generateUnicodeTables } = await import("../../evaluator/unicode-build.mjs");
generateUnicodeTables();
const { registerSearchFoundationChecks } = await import("./test-search-foundation");
registerSearchFoundationChecks(test);
test("compiler contract pins the evaluator value model", async () => {
  const compiler = await import('./ir');
  const evaluator = await import('../../evaluator/src/runner');
  assert(compiler.IR_CONTRACT.valueModelVersion === evaluator.CURRENT_VALUE_MODEL_VERSION, 'compiler/evaluator value model skew');
  let refused = false;
  try { compiler.assertValueModelVersion('future-incompatible'); } catch (error) {
    refused = String(error).includes('value model version future-incompatible != compiler');
  }
  assert(refused, 'compiler accepted an incompatible IR contract');
});
test("compiler canonical IR consumes the complete generated corpus", async () => {
  const { canonicalProgramJson, canonicalSchemaJson } = await import('../../evaluator/src/certificate-identity');
  const { sha256 } = await import('../../evaluator/src/hash');
  const cases = JSON.parse(await readFile(new URL('../../../corpus/manifest.json', import.meta.url), 'utf8'));
  for (const c of cases) {
    assert(c.corpusVersion === 1, `${c.name}: unsupported corpus version`);
    if (!c.certificate) continue;
    assert(sha256(canonicalProgramJson(c.program)) === c.certificate.plan_hash, `${c.name}: compiler IR identity`);
    assert(sha256(canonicalSchemaJson(c.schema)) === c.certificate.schema_hash, `${c.name}: compiler schema identity`);
  }
});
test("bound Quarry schema preserves public catalog and refusal contracts", runBoundSchemaChecks);
test("bare update binders refuse at their authored term with a field rewrite", runBareUpdateBinderChecks);
test("update image fields, focal collisions and channel arguments retain their certified meanings", runUpdateBinderCompatibilityChecks);
registerQuarryChecks(test, frontend);
registerQuarryMoneyChecks(test, frontend);
registerQuarryLanguageChecks(test, frontend);
registerApiShapeChecks(test, frontend);
registerRetentionChecks(test);
registerDeliveryChecks(test);
registerQuarryFanoutChecks(test, frontend);
registerQuarryProcChecks(test, frontend);
registerEffectLanguageChecks(test, withProject, frontend);
const packageBuildProof = registerPackageRegressionChecks(test, assert, crate);
registerPackageGuideChecks(test, assert, withProject, crate, packageBuildProof);
registerFinalGateChecks(test);

test("TypeScript data declarations refuse while effect-only modules remain on the production path", async () => {
  await withProject({
    "snapback/schema.q": "table rows:\n  value: int\n  public\n",
    "snapback/rows.q": "query all():\n  return rows[] first 1 by id\n",
    "snapback/legacy.ts": `import { effect, query } from "snapback2";
      export const notify = effect({ grants: ["https://example.com"], run: async () => null });
      export const old = query({}, () => null);`,
  }, async root => {
    const refused = await lowerProject(root);
    assert(!refused.ok && refused.diagnostics.length === 1
      && refused.diagnostics[0]?.code === "E_QUARRY_ONLY"
      && refused.diagnostics[0]?.message.includes("effects only"), JSON.stringify(refused));
  });
});

test("authored require sites survive lowering without inferring a site from the rejection code", async () => {
  await withProject({ "snapback/schema.q": "table rows:\n  value: int\n  public\n", "snapback/rules.q": "mutation fail():\n  require true else conflict\n  require false else conflict\n" }, async root => {
    const result = await lowerProject(root);
    assert(result.ok, JSON.stringify(result));
    const requirements = result.project.programs[0]!.body.filter(stmt => typeof stmt === "object" && "Require" in stmt);
    assert(JSON.stringify(requirements.map(stmt => "Require" in stmt && stmt.Require.site))
      === JSON.stringify(["snapback/rules.q:2:3", "snapback/rules.q:3:3"]), JSON.stringify(requirements));
    const { canonicalProgramJson } = await import("../../evaluator/src/certificate-identity");
    const program = result.project.programs[0]!;
    assert(canonicalProgramJson(program) === JSON.stringify(program), "require sites follow Rust field order");
    const without = { ...program, body: [{ Require: { condition: { Literal: { Bool: false } }, code: "conflict" } }] };
    const nullSite = { ...program, body: [{ Require: { ...without.body[0]!.Require, site: null } }] };
    assert(canonicalProgramJson(without) === canonicalProgramJson(nullSite), "optional require site follows Rust omission");
  });
});

const failures: Array<{ name: string; error: unknown }> = [];
const passes: string[] = [];
for (const check of checks) {
  try {
    await check.run();
    passes.push(check.name);
    console.log(`PASS ${check.name}`);
  } catch (error) {
    failures.push({ name: check.name, error });
    console.error(`FAIL ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
  }
}
console.log(`Compiler checks: ${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
