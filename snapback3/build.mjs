import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, VERSION as rolldownVersion } from "rolldown";
import ts from "typescript";
import { generateUnicodeTables } from "./packages/evaluator/unicode-build.mjs";

const workspace = dirname(fileURLToPath(import.meta.url));
const packages = resolve(workspace, "packages");
const sdk = resolve(packages, "snapback3");
const outArgument = process.argv.indexOf("--out-dir");
if (outArgument >= 0 && (!process.argv[outArgument + 1] || process.argv[outArgument + 1].startsWith("--"))) {
  throw new Error("--out-dir needs a path for the built SDK.");
}
const dist = outArgument >= 0 ? resolve(process.argv[outArgument + 1]) : resolve(sdk, "dist");
const compiler = resolve(packages, "compiler");
const effectSources = ["effects", "effect-child", "effect-fetch"].map(name => resolve(sdk, `src/node/${name}.ts`));
const onlyCompiler = process.argv.includes("--compiler-only");
const onlyEvaluator = process.argv.includes("--evaluator-only");

generateUnicodeTables();
if (process.argv.includes("--unicode-only")) process.exit(0);
await mkdir(dist, { recursive: true });

// Each SDK entry participates in one graph, so shared state has one module
// identity. New public arms only need an entry here and a package export.
const sdkEntries = { index: resolve(sdk, "src/index.ts"), "compiler-api": resolve(sdk, "src/compiler.ts") };
if (!onlyCompiler) {
  for (const name of ["client", "react", "expo", "cli"]) {
    const source = ["ts", "tsx"].map(extension => resolve(sdk, `src/${name}.${extension}`)).find(existsSync);
    if (source) sdkEntries[name] = source;
  }
}

if (process.argv.includes("--check")) {
  const config = ts.readConfigFile(resolve(compiler, "tsconfig.json"), ts.sys.readFile);
  if (config.error) failDiagnostics([config.error]);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, compiler);
  if (parsed.errors.length) failDiagnostics(parsed.errors);
  failDiagnostics(ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options)));
  const { expo: expoEntry, ...portableEntries } = sdkEntries;
  emitDeclarations(Object.values(portableEntries), true);
  if (expoEntry) emitDeclarations([expoEntry], true);
  if (!onlyCompiler) emitDeclarations(effectSources, true);
  console.log("snapback3: compiler and SDK TypeScript checks passed");
  process.exit(0);
}

if (!onlyEvaluator) {
  await buildCompilerLibraries();
  // @ref LLP 2000#9-a-parallel-implementation-with-clear-boundaries — the
  // compiled product has a closed local compiler dependency, independent of S2.
  // A fixed leaf preserves the inherited worker's lightweight readiness probe.
  await bundle({ input: resolve(compiler, "src/project.ts"), external: ["typescript"] }, {
    file: resolve(dist, "compiler-core.mjs"), codeSplitting: false,
  });
  await bundle({ input: resolve(compiler, "src/worker.ts"), plugins: [compilerCore()] }, {
    file: resolve(dist, "compiler.mjs"), codeSplitting: false,
  });
  await bundle({ input: sdkEntries, external: externalPackage, plugins: [compilerCore()] }, {
    dir: dist, entryFileNames: "[name].mjs", chunkFileNames: "shared-[hash].mjs",
  });
  if (!onlyCompiler) {
    await bundle({ input: effectSources[0] }, {
      file: resolve(dist, "effect-runner.mjs"), codeSplitting: false,
    });
    // SES is the audited confinement layer. Keep its pinned package external
    // so Rolldown/minification cannot rewrite the security boundary.
    await bundle({ input: effectSources[1], external: ["ses"] }, {
      file: resolve(dist, "effect-child.mjs"), codeSplitting: false,
    });
  }
  const { expo: expoEntry, ...portableEntries } = sdkEntries;
  emitDeclarations(Object.values(portableEntries));
  if (expoEntry) emitDeclarations([expoEntry]);
  for (const [name, source] of Object.entries(sdkEntries)) {
    const stem = source.split("/").at(-1).replace(/\.tsx?$/, "");
    await writeFile(resolve(dist, `${name}.d.ts`), `export * from "./types/snapback3/src/${stem}.js";\n`);
  }
}

if (!onlyCompiler) {
  const evaluator = resolve(packages, "evaluator");
  await bundle({ input: resolve(evaluator, "src/evaluator.ts"), platform: "neutral" }, {
    file: resolve(evaluator, "dist/evaluator.mjs"), codeSplitting: false,
  });
  await bundle({ input: resolve(evaluator, "src/run-corpus.ts"), platform: "neutral" }, {
    file: resolve(evaluator, "dist/corpus-runner.js"), codeSplitting: false, format: "iife",
  });
}
console.log(`snapback3: built with Rolldown ${rolldownVersion} and TypeScript ${ts.version}`);

async function bundle(input, output) {
  return build({
    platform: "node",
    transform: { target: "es2022" },
    ...input,
    plugins: [jsonData(), ...(input.plugins ?? [])],
    output: { format: "esm", sourcemap: true, minify: true, ...output },
    onwarn(warning) { throw new Error(warning.message); },
  });
}

function jsonData() {
  return {
    name: "json-data-properties",
    async load(id) {
      if (!id.endsWith(".json")) return;
      // Rolldown 1.2.8 emits nested JSON __proto__ keys as object setters.
      // Keep JSON's own-data-property semantics, including in the corpus and
      // schema hash inputs. The optional-null maintained-group cases catch it.
      const source = JSON.stringify(JSON.parse(await readFile(id, "utf8")));
      return { code: `export default JSON.parse(${JSON.stringify(source)});`, moduleType: "js" };
    },
  };
}

function compilerCore() {
  const project = resolve(compiler, "src/project");
  return {
    name: "fixed-compiler-core",
    resolveId(id, importer) {
      if (importer && id.startsWith(".") && resolve(dirname(importer), id).replace(/\.[cm]?[jt]s$/, "") === project) {
        return { id: "./compiler-core.mjs", external: true };
      }
    },
  };
}

function externalPackage(id) {
  return !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0");
}

async function buildCompilerLibraries() {
  await cp(resolve(compiler, "lib.d.ts"), resolve(dist, "authoring-lib.d.ts"));
  await cp(resolve(compiler, "subset-lib.d.ts"), resolve(dist, "compiler-lib.d.ts"));
  await cp(resolve(workspace, "unicode/17.0.0/LICENSE.txt"), resolve(dist, "unicode-LICENSE.txt"));
  const libraries = new Map();
  const directory = dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2020 }));
  await cp(resolve(directory, "../LICENSE.txt"), resolve(dist, "typescript-LICENSE.txt"));
  async function collect(name) {
    if (libraries.has(name)) return;
    const source = await readFile(resolve(directory, `lib.${name}.d.ts`), "utf8");
    libraries.set(name, source.replace(/^\/\/\/\s*<reference[^\n]*\n/gm, ""));
    for (const reference of ts.preProcessFile(source).libReferenceDirectives) await collect(reference.fileName);
  }
  await collect("es2020");
  await writeFile(resolve(dist, "effects-lib.d.ts"), [
    ...libraries.values(), await readFile(resolve(compiler, "effects-lib.d.ts"), "utf8"),
  ].join("\n"));
}

function emitDeclarations(rootNames, checkOnly = false) {
  const program = ts.createProgram({ rootNames, options: {
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: checkOnly,
    noEmitOnError: true,
    rootDir: packages,
    outDir: resolve(dist, "types"),
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    resolveJsonModule: true,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    types: ["node"],
  } });
  failDiagnostics(ts.getPreEmitDiagnostics(program));
  if (!checkOnly) {
    const emitted = program.emit();
    failDiagnostics(emitted.diagnostics);
    if (emitted.emitSkipped) throw new Error("TypeScript skipped declaration emission");
  }
}

function failDiagnostics(diagnostics) {
  if (diagnostics.length === 0) return;
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => workspace, getNewLine: () => "\n",
  }));
}
