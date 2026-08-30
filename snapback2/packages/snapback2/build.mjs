import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    index: resolve(here, "src/index.ts"),
    client: resolve(here, "src/client.ts"),
    react: resolve(here, "src/react.tsx"),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  minify: true,
  platform: "neutral",
  target: "es2022",
  external: ["react"],
});

await build({
  entryPoints: {
    test: resolve(here, "src/test.ts"),
    "test-runner": resolve(here, "src/test.ts"),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
});

await build({
  entryPoints: [resolve(here, "../compiler/src/worker.ts")],
  outfile: resolve(dist, "compiler.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["typescript"],
});

await cp(resolve(here, "../compiler/lib.d.ts"), resolve(dist, "index.d.ts"));
await cp(resolve(here, "../compiler/subset-lib.d.ts"), resolve(dist, "compiler-lib.d.ts"));
await cp(resolve(here, "types/test.d.ts"), resolve(dist, "test.d.ts"));
await cp(resolve(here, "types/placeholder.d.ts"), resolve(dist, "placeholder.d.ts"));

const declarationProgram = ts.createProgram({
  rootNames: [
    resolve(here, "src/api.ts"),
    resolve(here, "src/client.ts"),
    resolve(here, "src/react.tsx"),
    resolve(here, "src/sse.ts"),
    resolve(here, "src/types.ts"),
  ],
  options: {
    declaration: true,
    emitDeclarationOnly: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    outDir: dist,
    rootDir: resolve(here, "src"),
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  },
});
const diagnostics = ts.getPreEmitDiagnostics(declarationProgram);
if (diagnostics.length > 0) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => here,
    getNewLine: () => "\n",
  }));
}
const emitted = declarationProgram.emit();
if (emitted.emitSkipped) throw new Error("TypeScript skipped client declaration emit");

const guideSource = resolve(here, "guide");
const guide = resolve(dist, "guide");
await cp(guideSource, guide, { recursive: true });
const families = JSON.parse(await readFile(resolve(guideSource, "families.source.json"), "utf8"));
if (!Array.isArray(families) || new Set(families.map((entry) => entry.family)).size !== families.length
  || families.some((entry) => !entry.family || !entry.code || !entry.wrong || !entry.right)) {
  throw new Error("guide/families.source.json must contain one complete wrong/right pair per family");
}
await writeFile(resolve(guide, "families.json"), `${JSON.stringify(families, null, 2)}\n`);
await rm(resolve(guide, "families.source.json"));

const fixtures = resolve(here, "../compiler/fixtures");
const templateDist = resolve(dist, "templates");
for (const name of ["todos", "chat"]) {
  const target = resolve(templateDist, name, "snapback");
  await cp(resolve(fixtures, name, "snapback"), target, { recursive: true });
  await cp(resolve(here, "templates", name, "snapback"), target, { recursive: true, force: true });
}
await cp(resolve(here, "templates/react"), resolve(templateDist, "react"), { recursive: true });

const fixtureText = (await Promise.all((await fixtureFiles(fixtures)).map((path) => readFile(path, "utf8")))).join("\n");
const guidePages = await Promise.all(
  ["grammar", "auth", "live-query", "effects", "personas", "testing"].map(async (name) => ({
    name,
    markdown: await readFile(resolve(guideSource, `${name}.md`), "utf8"),
    limit: name === "grammar" ? 2048 : 4096,
  })),
);
const guideErrors = guideFailures(guidePages, fixtureText);
if (guideErrors.length > 0) {
  throw new Error(`guide validation failed:\n${guideErrors.join("\n")}`);
}

if (process.argv.includes("--self-test")) {
  const failures = guideFailures([
    { name: "oversized", markdown: "x".repeat(5), limit: 4 },
    { name: "stale", markdown: "```ts\nmissing()\n```", limit: 100 },
    { name: "valid", markdown: "```ts\npresent()\n```", limit: 100 },
  ], "present()");
  if (failures.length !== 2 || !failures.some((item) => item.includes("oversized")) || !failures.some((item) => item.includes("stale"))) {
    throw new Error(`guide validation self-test lost failures: ${JSON.stringify(failures)}`);
  }
  console.log(`guide validation self-test ok: ${failures.join(" | ")}`);
}

function guideFailures(pages, fixturesText) {
  const failures = [];
  for (const { name, markdown, limit } of pages) {
    const reasons = [];
    if (Buffer.byteLength(markdown) > limit) reasons.push(`exceeds ${limit} bytes`);
    const staleSnippets = [...markdown.matchAll(/```ts\n([\s\S]*?)\n```/g)]
      .filter((match) => !fixturesText.includes(match[1])).length;
    if (staleSnippets > 0) reasons.push(`${staleSnippets} snippet(s) not present in the compiler fixtures`);
    if (reasons.length > 0) failures.push(`guide/${name}.md: ${reasons.join("; ")}`);
  }
  return failures;
}

async function fixtureFiles(root) {
  const output = [];
  for (const name of ["todos", "chat"]) {
    const directory = resolve(root, name, "snapback");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".ts")) output.push(resolve(directory, entry.name));
    }
  }
  return output;
}
