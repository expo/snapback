import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { collectEffectCatalog, lowerEffects, type SourceModule } from "./lower/effects";
import { createProjectProgram, loadCompilerLib, projectTypeDiagnostics } from "./project-program";
import { boundEffectDeclarationSources } from "./quarry/bound-effects-stubs";
import { bindQuarryProject } from "./quarry/bound-project";
import { prepareQuarry, type QuarryInput } from "./quarry/index";
import { assert, type Test } from "./quarry-check-helpers";

export function registerQuarryDirectProjectChecks(test: Test, frontend: string): void {
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
    const project = bindQuarryProject(fixture(resolve(frontend, "fixtures/quarry-schedules")));
    const client = new Set(project.clientPrograms.map((program) => program.name));
    assert(project.schema.schedules?.length === 2
      && project.programs.some((program) => program.name === "admin.digestSweep" && program.kind === "job")
      && project.programs.some((program) => program.name.includes("_timerBinding_"))
      && !client.has("admin.digestSweep") && !client.has("admin.purgeMessage")
      && ![...client].some((name) => name.includes("_timerBinding_")),
    `system programs leaked into the direct client set: ${JSON.stringify([...client])}`);
    assert(Object.values(project.sources).every((site) => site.file.endsWith(".q")),
      `direct source custody escaped authored Quarry: ${JSON.stringify(project.sources)}`);
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
