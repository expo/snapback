import { basename } from "node:path";
import type { Program, QuarryGenerated, SchemaJson, SourceSite } from "../ir";
import type { OperationSignature } from "../lower/effects";
import { bindQuarrySchema } from "./bound-schema";
import { bindQuarryProgram, type BoundQuarryProgram } from "./bound";
import { lowerBoundQuarryProgram } from "./direct";
import type { PreparedQuarry } from "./index";

export type BoundEffectReference = {
  name: string;
  localName: string;
  moduleName: string;
  source: SourceSite;
};

export type BoundQuarryProject = {
  prepared: PreparedQuarry;
  schema: SchemaJson;
  boundPrograms: BoundQuarryProgram[];
  programs: Program[];
  clientPrograms: BoundQuarryProgram[];
  effects: BoundEffectReference[];
  operationSignatures: Map<string, OperationSignature>;
  sources: Record<string, SourceSite>;
  inspection: QuarryGenerated[];
};

/** Build the complete Quarry data plane from typed bound declarations. */
export function bindQuarryProject(prepared: PreparedQuarry): BoundQuarryProject {
  const schema = bindQuarrySchema(prepared.documents, prepared.catalog);
  if (prepared.schedules.length > 0) schema.schedules = prepared.schedules.map(({ bindingName, ...schedule }) => ({
    ...schedule, binding: bindingName,
  }));
  const boundPrograms = prepared.documents.flatMap((document) => document.programs.map((program) =>
    bindQuarryProgram(program, prepared.catalog, prepared.documents)));
  const programs = boundPrograms.map(lowerBoundQuarryProgram).sort((left, right) => left.name.localeCompare(right.name));
  const scheduleTargets = new Set(prepared.schedules.map((schedule) => schedule.target));
  const scheduleBindings = new Set(prepared.schedules.map((schedule) => schedule.bindingName));
  const clientPrograms = boundPrograms.filter((program) => program.kind !== "job"
    && !scheduleTargets.has(program.name) && !scheduleBindings.has(program.name));
  const effects = prepared.documents.flatMap((document) => document.effects.map((effect): BoundEffectReference => ({
    name: `${effect.module}.${effect.name}`,
    localName: effect.name,
    moduleName: effect.module,
    source: effect.site,
  })));
  const operationSignatures = new Map(boundPrograms.filter((program) => !scheduleBindings.has(program.name))
    .map((program): [string, OperationSignature] => [program.name, {
    name: program.name,
    moduleName: program.name.split(".")[0]!,
    exportName: program.name.split(".").at(-1)!,
    kind: program.kind,
    boundArgs: program.args.map((argument) => ({ name: argument.name, type: argument.type })),
  }]));
  const sourceEntries: Array<[string, SourceSite]> = boundPrograms.map((program) => [program.name, program.source.definition]);
  const sources = Object.fromEntries(sourceEntries
    .sort(([left], [right]) => left.localeCompare(right)));
  const inspection = prepared.documents.flatMap((document): QuarryGenerated[] => {
    const filePrograms = programs.filter((program) => boundPrograms.find((bound) =>
      bound.name === program.name)?.source.definition.file === document.file);
    if (basename(document.file) === "schema.q") return [{
      file: document.file, generated: "schema.ir.json", source: JSON.stringify(schema, null, 2),
    }];
    return filePrograms.length === 0 ? [] : [{
      file: document.file,
      generated: `${basename(document.file, ".q")}.ir.json`,
      source: JSON.stringify(filePrograms, null, 2),
    }];
  });
  return { prepared, schema, boundPrograms, programs, clientPrograms, effects, operationSignatures, sources, inspection };
}
