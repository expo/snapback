import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Document, QuarryDiagnostic, Site } from "./ast";
import { buildCatalog } from "./catalog";
import { QuarryError } from "./diagnostics";
import { parseDocument } from "./parser";
import { emitPrograms } from "./program";
import { emitSchema, mark } from "./schema";

export type CompileResult = { ok: true; files: string[] } | { ok: false; diagnostics: QuarryDiagnostic[] };

const GENERATED_MANIFEST = ".quarry-generated.json";
let temporarySequence = 0;

export async function compileApp(appDirectory: string): Promise<CompileResult> {
  let app = resolve(appDirectory);
  try {
    app = await realpath(app);
  } catch {
    // The input-directory diagnostic below remains the public failure.
  }
  const input = join(app, "snapback-quarry");
  let names: string[];
  try {
    names = (await readdir(input)).filter((name) => name.endsWith(".q")).sort();
  } catch {
    return { ok: false, diagnostics: [{ file: "snapback-quarry", line: 1, col: 1, message: "missing snapback-quarry/ directory" }] };
  }
  if (names.length === 0) return { ok: false, diagnostics: [{ file: "snapback-quarry", line: 1, col: 1, message: "no .q files found" }] };

  const diagnostics: QuarryDiagnostic[] = [];
  const documents: Document[] = [];
  for (const name of names) {
    try {
      documents.push(parseDocument(name, await readFile(join(input, name), "utf8")));
    } catch (error) {
      diagnostics.push(error instanceof QuarryError
        ? error.diagnostic
        : { file: name, line: 1, col: 1, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  try {
    validatePlacement(documents);
    const catalog = buildCatalog(documents);
    const output = join(app, "snapback");
    const plans: Array<{ path: string; source: string; site: Site }> = [];
    const schemaDocument = documents.find((document) => document.file === "schema.q")!;
    plans.push({ path: join(output, "schema.ts"), source: emitSchema(documents, catalog, "schema.q"), site: schemaDocument.tables[0]?.site ?? site("schema.q") });
    for (const document of documents) {
      const stem = document.file.slice(0, -2);
      if (document.file !== "schema.q") {
        const source = emitPrograms(document.programs, catalog, document.file);
        plans.push({ path: join(output, `${stem}.ts`), source, site: document.programs[0]?.site ?? site(document.file) });
        plans.push({ path: join(output, `${stem}.q.ts`), source, site: site(document.file) });
      } else {
        plans.push({ path: join(output, `${stem}.q.ts`), source: schemaProvenanceModule(emitSchema(documents, catalog, "schema.q")), site: site(document.file) });
      }
    }
    const outputRoot = await prepareOutputRoot(app, output, schemaDocument.tables[0]?.site ?? site("schema.q"));
    const previous = await readGeneratedManifest(output, outputRoot, site("schema.q"));
    const next = plans.map((plan) => basename(plan.path)).sort();
    const stale = [...previous].filter((name) => !next.includes(name)).sort();
    for (const plan of plans) await refuseHandwrittenCollision(plan.path, outputRoot, plan.site);
    for (const name of stale) await refuseStaleCollision(join(output, name), outputRoot, site("schema.q"));
    await publishPlans(output, outputRoot, plans, previous, next, stale, site("schema.q"));
    return { ok: true, files: plans.map((plan) => plan.path) };
  } catch (error) {
    return { ok: false, diagnostics: [error instanceof QuarryError
      ? error.diagnostic
      : { file: "snapback-quarry", line: 1, col: 1, message: error instanceof Error ? error.message : String(error) }] };
  }
}

function validatePlacement(documents: Document[]): void {
  const schemas = documents.filter((document) => document.tables.length > 0 || document.channels.length > 0 || document.identity);
  const schema = documents.find((document) => document.file === "schema.q");
  if (!schema) throw new QuarryError(site(documents[0]?.file ?? "schema.q"), "schema declarations must live in snapback-quarry/schema.q so the packaged checker can load snapback/schema.ts");
  if (schemas.some((document) => document.file !== "schema.q")) {
    const misplaced = schemas.find((document) => document.file !== "schema.q")!;
    throw new QuarryError(misplaced.tables[0]?.site ?? misplaced.channels[0]?.site ?? site(misplaced.file), "tables, channels, and use identity must live in schema.q");
  }
  if (schema.programs.length > 0) throw new QuarryError(schema.programs[0]!.site, "query/mutation declarations must live outside schema.q so they retain their module namespace");
  if (schema.tables.length === 0) throw new QuarryError(site("schema.q"), "schema.q must declare at least one table");
  for (const document of documents) {
    const stem = document.file.slice(0, -2);
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(stem)) throw new QuarryError(site(document.file), `file stem ${stem} cannot become a Snapback operation module`);
    if (document.file !== "schema.q" && document.programs.length === 0) throw new QuarryError(site(document.file), `${document.file} declares no query or mutation`);
  }
}

async function prepareOutputRoot(app: string, output: string, sourceSite: Site): Promise<string> {
  let metadata;
  try {
    metadata = await lstat(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(output);
    metadata = await lstat(output);
  }
  if (metadata.isSymbolicLink()) throw new QuarryError(sourceSite, "refusing to generate through symbolic link snapback/");
  if (!metadata.isDirectory()) throw new QuarryError(sourceSite, "generated output snapback/ must be a directory");
  const root = await realpath(output);
  const fromApp = relative(app, root);
  if (fromApp === "" || fromApp === ".." || fromApp.startsWith(`..${sep}`) || isAbsolute(fromApp)) {
    throw new QuarryError(sourceSite, "generated output snapback/ resolves outside the application root");
  }
  return root;
}

async function refuseHandwrittenCollision(path: string, outputRoot: string, sourceSite: Site): Promise<void> {
  const current = await readOutputFile(path, outputRoot, sourceSite);
  if (current !== undefined && !current.startsWith("// GENERATED by quarryc from snapback-quarry/")) {
    throw new QuarryError(sourceSite, `refusing to overwrite hand-written snapback/${basename(path)}; rename the Quarry module or remove the collision`);
  }
}

async function refuseStaleCollision(path: string, outputRoot: string, sourceSite: Site): Promise<void> {
  const current = await readOutputFile(path, outputRoot, sourceSite);
  if (current !== undefined && !current.startsWith("// GENERATED by quarryc from snapback-quarry/")) {
    throw new QuarryError(sourceSite, `refusing to remove snapback/${basename(path)} because it no longer has a quarryc generated header`);
  }
}

async function readGeneratedManifest(output: string, outputRoot: string, sourceSite: Site): Promise<Set<string>> {
  const source = await readOutputFile(join(output, GENERATED_MANIFEST), outputRoot, sourceSite);
  if (source === undefined) return new Set();
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new QuarryError(sourceSite, `refusing to overwrite invalid snapback/${GENERATED_MANIFEST}`);
  }
  const record = value as { version?: unknown; files?: unknown };
  if (record?.version !== 1 || !Array.isArray(record.files)
    || record.files.some((name) => typeof name !== "string" || !isGeneratedBasename(name))
    || new Set(record.files).size !== record.files.length) {
    throw new QuarryError(sourceSite, `refusing to overwrite invalid snapback/${GENERATED_MANIFEST}`);
  }
  return new Set(record.files as string[]);
}

async function readOutputFile(path: string, outputRoot: string, sourceSite: Site): Promise<string | undefined> {
  await assertOutputParent(path, outputRoot, sourceSite);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new QuarryError(sourceSite, `refusing to generate through symbolic link snapback/${basename(path)}`);
  if (!metadata.isFile()) throw new QuarryError(sourceSite, `generated target snapback/${basename(path)} must be a regular file`);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    return await handle.readFile("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new QuarryError(sourceSite, `refusing to generate through symbolic link snapback/${basename(path)}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function publishPlans(
  output: string,
  outputRoot: string,
  plans: Array<{ path: string; source: string; site: Site }>,
  previous: Set<string>,
  next: string[],
  stale: string[],
  sourceSite: Site,
): Promise<void> {
  const staged: string[] = [];
  try {
    const stagedPlans: Array<{ staged: string; target: string }> = [];
    for (const plan of plans) {
      const stagedPath = await stageOutput(output, outputRoot, plan.source, plan.site);
      staged.push(stagedPath);
      stagedPlans.push({ staged: stagedPath, target: plan.path });
    }
    const union = [...new Set([...previous, ...next])].sort();
    const stagedUnion = await stageOutput(output, outputRoot, manifestSource(union), sourceSite);
    const stagedExact = await stageOutput(output, outputRoot, manifestSource(next), sourceSite);
    staged.push(stagedUnion, stagedExact);

    await publishOutput(stagedUnion, join(output, GENERATED_MANIFEST), outputRoot, sourceSite);
    for (const plan of stagedPlans) await publishOutput(plan.staged, plan.target, outputRoot, sourceSite);
    for (const name of stale) {
      const path = join(output, name);
      await refuseStaleCollision(path, outputRoot, sourceSite);
      await rm(path, { force: true });
    }
    await publishOutput(stagedExact, join(output, GENERATED_MANIFEST), outputRoot, sourceSite);
  } finally {
    for (const path of staged) await rm(path, { force: true });
  }
}

async function stageOutput(output: string, outputRoot: string, source: string, sourceSite: Site): Promise<string> {
  await assertOutputParent(join(output, "stage"), outputRoot, sourceSite);
  for (;;) {
    const path = join(output, `.quarry-${process.pid}-${Date.now()}-${temporarySequence += 1}.tmp`);
    let handle;
    try {
      handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(source, "utf8");
      await handle.close();
      return path;
    } catch (error) {
      await handle?.close();
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
}

async function publishOutput(staged: string, target: string, outputRoot: string, sourceSite: Site): Promise<void> {
  await assertOutputParent(target, outputRoot, sourceSite);
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (metadata?.isSymbolicLink()) throw new QuarryError(sourceSite, `refusing to generate through symbolic link snapback/${basename(target)}`);
  await rename(staged, target);
}

async function assertOutputParent(path: string, outputRoot: string, sourceSite: Site): Promise<void> {
  const parent = await realpath(dirname(path));
  if (parent !== outputRoot) throw new QuarryError(sourceSite, `generated target snapback/${basename(path)} resolves outside snapback/`);
  const metadata = await lstat(parent);
  if (metadata.isSymbolicLink()) throw new QuarryError(sourceSite, "refusing to generate through symbolic link snapback/");
}

function manifestSource(files: string[]): string {
  return `${JSON.stringify({ version: 1, files }, null, 2)}\n`;
}

function isGeneratedBasename(name: string): boolean {
  return basename(name) === name && /^[A-Za-z_$][A-Za-z0-9_$-]*(?:\.q)?\.ts$/.test(name);
}

function schemaProvenanceModule(schemaSource: string): string {
  return schemaSource
    .replace("import { channel, rule, schema, table, t }", "import { channel, query, rule, schema, table, t }")
    .concat(`\nexport const __quarrySource = query({}, () => null); ${mark("schema.q", 1)}\n`);
}

function site(file: string): Site { return { file, line: 1, col: 1 }; }
