import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { deepStrictEqual } from "node:assert";
import ts from "typescript";
import { collectEffectCatalog, lowerEffects, type SourceModule } from "./lower/effects";
import { createProjectProgram, loadCompilerLib, projectTypeDiagnostics } from "./project-program";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { boundEffectDeclarationSources } from "./quarry/bound-effects-stubs";
import { bindQuarryProject } from "./quarry/bound-project";
import { prepareQuarry, type QuarryInput } from "./quarry/index";
import { assert, type Test, withProject } from "./quarry-check-helpers";

export function registerQuarryDirectProjectChecks(test: Test, frontend: string): void {
  test("production Quarry project uses the bound data plane and aggregates authored refusals", async () => {
    const root = resolve(frontend, "fixtures/quarry-chat");
    const prepared = fixture(root);
    const expected = bindQuarryProject(prepared);
    const production = await lowerProject(root);
    assert(production.ok, `production direct Quarry project refused: ${production.ok ? "" : JSON.stringify(production.diagnostics)}`);
    deepStrictEqual(production.project.programs, expected.programs);
    const failures = rustCheck(production.project.programs, "synthetic", production.project.schema, undefined, production.project.effects)
      .filter((checked) => checked.error);
    assert(failures.length === 0, `production direct Quarry programs did not certify: ${JSON.stringify(failures)}`);
    assert(production.project.effects.some((effect) => effect.name === "delivery.notify")
      && production.quarry.every((item) => item.generated.endsWith(".ir.json") && !item.source.includes("GENERATED"))
      && Object.values(production.sources).every((site) => site.file.endsWith(".q"))
      && production.apiDts.includes("interface Api"),
    `production assembly retained generated TypeScript custody: ${JSON.stringify(production.quarry)}`);

    await withProject({
      "snapback/schema.q": "table rows:\n  public\n",
      "snapback/a.q": "query first():\n  return missing\n",
      "snapback/b.q": "query second():\n  return alsoMissing\n",
    }, async (invalidRoot) => {
      const invalid = await lowerProject(invalidRoot);
      assert(!invalid.ok && invalid.diagnostics.length === 2
        && invalid.diagnostics.every((item) => item.code === "E_QUARRY_UNKNOWN")
        && invalid.diagnostics.some((item) => item.site === "snapback/a.q:2:10")
        && invalid.diagnostics.some((item) => item.site === "snapback/b.q:2:10"),
      `production direct diagnostics did not aggregate authored sites: ${JSON.stringify(invalid)}`);
    });
  });

  test("direct Quarry project exposes executable IR and declaration-only effect signatures", () => {
    const root = resolve(frontend, "fixtures/quarry-chat");
    const prepared = fixture(root);
    const project = bindQuarryProject(prepared);
    const declarations = boundEffectDeclarationSources(prepared.catalog, project.boundPrograms);
    const schemaPath = join(root, declarations.schema.fileName);
    const moduleSources: Array<readonly [string, string]> = declarations.modules.map((module) =>
      [join(root, module.fileName), module.source]);
    const deliveryPath = join(root, "snapback/delivery.ts");
    const deliverySource = readFileSync(deliveryPath, "utf8");
    moduleSources.push([deliveryPath, deliverySource]);
    const checked = createProjectProgram(schemaPath, declarations.schema.source, moduleSources,
      loadCompilerLib(true), ts.ScriptTarget.ES2020);
    const diagnostics = projectTypeDiagnostics(checked.program, root);
    assert(diagnostics.length === 0, `bound effect declarations did not check: ${JSON.stringify(diagnostics)}`);
    const delivery: SourceModule = {
      moduleName: "delivery", fileName: "snapback/delivery.ts", source: deliverySource,
      sourceFile: checked.program.getSourceFile(deliveryPath)!,
    };
    const effects = lowerEffects(collectEffectCatalog([delivery]), project.operationSignatures);
    assert(effects.diagnostics.length === 0 && effects.effects.length === 1
      && effects.effects[0]!.then === "notifications.recordNotified",
    `bound operation signature did not link the effect then target: ${JSON.stringify(effects)}`);
    assert(project.effects.some((effect) => effect.name === "delivery.notify")
      && project.programs.some((program) => program.name === "messages.send")
      && project.inspection.every((item) => item.generated.endsWith(".ir.json") && !item.source.includes("GENERATED")),
    `bound project lost effects, programs, or executable inspection: ${JSON.stringify(project.inspection)}`);
  });

  test("direct Quarry project keeps jobs and schedule bindings out of the client operation set", () => {
    const prepared = fixture(resolve(frontend, "fixtures/quarry-schedules"));
    const project = bindQuarryProject(prepared);
    const client = new Set(project.clientPrograms.map((program) => program.name));
    const effectDeclarations = boundEffectDeclarationSources(prepared.catalog, project.boundPrograms);
    const admin = effectDeclarations.modules.find((module) => module.fileName === "snapback/admin.ts")?.source ?? "";
    assert(project.schema.schedules?.length === 2
      && project.programs.some((program) => program.name === "admin.digestSweep" && program.kind === "job")
      && project.programs.some((program) => program.name.includes("_timerBinding_"))
      && !client.has("admin.digestSweep") && !client.has("admin.purgeMessage")
      && ![...client].some((name) => name.includes("_timerBinding_"))
      && admin.includes(" as purgeMessage }") && !admin.includes("digestSweep") && !admin.includes("_timerBinding_"),
    `system programs leaked into the direct client set: ${JSON.stringify([...client])}`);
    assert(Object.values(project.sources).every((site) => site.file.endsWith(".q")),
      `direct source custody escaped authored Quarry: ${JSON.stringify(project.sources)}`);
  });

  test("direct-only Quarry projects skip effect declarations and still assemble", async () => {
    await withProject({
      "snapback/schema.q": "table rows:\n  public\n",
      "snapback/rows.q": "query list():\n  return rows[] first 2 by byId\n",
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok && lowered.project.effects.length === 0
        && lowered.project.programs.length === 1 && lowered.quarry.every((item) => item.generated.endsWith(".ir.json")),
      `direct-only project did not assemble without the effect checker: ${JSON.stringify(lowered)}`);
    });
  });

  test("bound effect declarations share API types and export legal reserved and colliding names", () => {
    const result = prepareQuarry([
      { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: `table foo_bar:
  public

table fooBar:
  public

table class:
  public
` },
      { path: "/virtual/snapback/names.q", fileName: "snapback/names.q", source: `query class(
  default: int,
  maybe: int ?,
  mode: enum('on', 'off')
):
  return { chosen: mode, maybe, literal: 2 }
` },
    ]);
    assert(result.ok, `direct declaration-name fixture did not prepare: ${JSON.stringify(result.ok ? [] : result.diagnostics)}`);
    const project = bindQuarryProject(result.prepared);
    const declarations = boundEffectDeclarationSources(result.prepared.catalog, project.clientPrograms);
    const module = declarations.modules.find((item) => item.fileName === "snapback/names.ts")!;
    assert(declarations.schema.source.includes(" as class }") && module.source.includes(" as class }")
      && !module.source.includes("unknown") && module.source.includes(`mode: "on" | "off"`)
      && module.source.includes("maybe?: number | null") && module.source.includes("literal: number"),
    `bound declaration printer lost reserved exports or shared types: ${JSON.stringify(declarations)}`);
    const aliases = [...declarations.schema.source.matchAll(/export type (FooBarRow\S*)/g)].map((match) => match[1]);
    assert(aliases.length === 2 && new Set(aliases).size === 2,
      `colliding table names reused an effect declaration alias: ${JSON.stringify(aliases)}`);
    const schemaPath = "/virtual/snapback/schema.ts";
    const consumerPath = "/virtual/snapback/consumer.ts";
    const checked = createProjectProgram(schemaPath, declarations.schema.source, [
      ...declarations.modules.map((item) => [`/virtual/${item.fileName}`, item.source] as const),
      [consumerPath, `import type { Operation, Table } from 'snapback2';
import { class as classTable, foo_bar, fooBar } from './schema';
import { class as classOperation } from './names';
const operation: Operation<
  { default: number; maybe?: number | null; mode: 'on' | 'off' },
  { chosen: 'on' | 'off'; maybe: number | null; literal: number },
  'query'
> = classOperation;
const tables: Array<Table<Record<string, unknown>>> = [classTable, foo_bar, fooBar];
void [operation, tables];
`] as const,
    ], loadCompilerLib(true), ts.ScriptTarget.ES2020);
    const diagnostics = projectTypeDiagnostics(checked.program, "/virtual");
    assert(diagnostics.length === 0, `reserved/colliding bound declaration consumer failed: ${JSON.stringify(diagnostics)}`);
  });
}

function fixture(root: string) {
  const directory = join(root, "snapback");
  const inputs: QuarryInput[] = readdirSync(directory).filter((name) => name.endsWith(".q")).map((name) => ({
    path: join(directory, name), fileName: `snapback/${name}`, source: readFileSync(join(directory, name), "utf8"),
  }));
  const prepared = prepareQuarry(inputs);
  if (!prepared.ok) throw new Error(`direct project fixture did not prepare: ${JSON.stringify(prepared.diagnostics)}`);
  return prepared.prepared;
}
