import { basename } from "node:path";
import type { Program, QuarryGenerated, SchemaJson, SourceSite } from "../ir";
import type { OperationSignature } from "../lower/effects";
import { bindQuarrySchemaArtifact, type BoundQuarrySchemaArtifact } from "./bound-schema";
import { bindQuarryProgram, type BoundQuarryProgram } from "./bound";
import { lowerBoundQuarryArtifact } from "./direct";
import type { QuarryDiagnostic } from "./ast";
import { QuarryError } from "./diagnostics";
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

export type BoundQuarryProjectResult =
  | { ok: true; project: BoundQuarryProject }
  | { ok: false; diagnostics: QuarryDiagnostic[] };

/** Build the complete Quarry data plane from typed bound declarations. */
export function bindQuarryProject(prepared: PreparedQuarry): BoundQuarryProject {
  const schema = bindQuarrySchemaArtifact(prepared.documents, prepared.catalog);
  const boundPrograms = prepared.documents.flatMap((document) => document.programs.map((program) =>
    bindQuarryProgram(program, prepared.catalog, prepared.documents)));
  return assembleBoundQuarryProject(prepared, schema, boundPrograms);
}

/** Production aggregation binds every operation so one bad declaration does
 * not hide independent authored refusals in later modules. */
export function tryBindQuarryProject(prepared: PreparedQuarry): BoundQuarryProjectResult {
  const diagnostics: QuarryDiagnostic[] = [];
  let schema: BoundQuarrySchemaArtifact | undefined;
  try { schema = bindQuarrySchemaArtifact(prepared.documents, prepared.catalog); } catch (error) {
    if (!(error instanceof QuarryError)) throw error;
    diagnostics.push(error.diagnostic);
  }
  const boundPrograms: BoundQuarryProgram[] = [];
  for (const document of prepared.documents) for (const program of document.programs) {
    try { boundPrograms.push(bindQuarryProgram(program, prepared.catalog, prepared.documents)); } catch (error) {
      if (!(error instanceof QuarryError)) throw error;
      diagnostics.push(error.diagnostic);
    }
  }
  if (!schema || diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, project: assembleBoundQuarryProject(prepared, schema, boundPrograms) };
}

function assembleBoundQuarryProject(
  prepared: PreparedQuarry,
  schemaArtifact: BoundQuarrySchemaArtifact,
  boundPrograms: BoundQuarryProgram[],
): BoundQuarryProject {
  const { schema } = schemaArtifact;
  if (prepared.schedules.length > 0) schema.schedules = prepared.schedules.map(({ bindingName, ...schedule }) => ({
    ...schedule, binding: bindingName,
  }));
  const artifacts = boundPrograms.map(lowerBoundQuarryArtifact);
  const programs = artifacts.map((artifact) => artifact.program).sort((left, right) => left.name.localeCompare(right.name));
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
  const sourceEntries: Array<[string, SourceSite]> = [
    ...schemaArtifact.sources,
    ...artifacts.flatMap((artifact) => artifact.sources),
    ...boundPrograms.map((program): [string, SourceSite] => [program.name, program.source.definition]),
  ];
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
