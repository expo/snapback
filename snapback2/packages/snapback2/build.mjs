import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const externalClient = {
  name: "external-client",
  setup(build) {
    build.onResolve({ filter: /^\.\/client\.js$/ }, (args) =>
      args.importer === resolve(here, "src/react.tsx")
        ? { path: "snapback2/client", external: true }
        : undefined);
  },
};

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
  external: ["react", "snapback2/client"],
  plugins: [externalClient],
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
let families = [];
const familyErrors = [];
try {
  families = JSON.parse(await readFile(resolve(guideSource, "families.source.json"), "utf8"));
  familyErrors.push(...familyFailures(families));
} catch (error) {
  familyErrors.push(`guide/families.source.json: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}
if (familyErrors.length === 0) {
  await writeFile(resolve(guide, "families.json"), `${JSON.stringify(families, null, 2)}\n`);
}
await rm(resolve(guide, "families.source.json"));

const fixtures = resolve(here, "../compiler/fixtures");
const templateDist = resolve(dist, "templates");
const chatTarget = resolve(templateDist, "chat", "snapback");
await cp(resolve(here, "templates/chat/snapback"), chatTarget, { recursive: true });
await cp(
  resolve(here, "templates/todos/snapback"),
  resolve(templateDist, "todos", "snapback"),
  { recursive: true },
);
await cp(resolve(here, "templates/react"), resolve(templateDist, "react"), { recursive: true });

const fixtureText = (await Promise.all((await fixtureFiles(fixtures)).map((path) => readFile(path, "utf8")))).join("\n");
const guidePages = await Promise.all(
  ["grammar", "auth", "live-query", "effects", "personas", "testing"].map(async (name) => ({
    name,
    markdown: await readFile(resolve(guideSource, `${name}.md`), "utf8"),
    limit: name === "grammar" ? 2048 : 4096,
  })),
);
const guideErrors = [...familyErrors, ...guideFailures(guidePages, fixtureText)];
if (guideErrors.length > 0) {
  throw new Error(`guide validation failed:\n${guideErrors.join("\n")}`);
}

if (process.argv.includes("--self-test")) {
  const failures = [
    ...familyFailures([
      { family: "duplicate", code: "E_ONE", wrong: "wrong", right: "right" },
      { family: "duplicate", code: "", wrong: "", right: "" },
    ]),
    ...guideFailures([
    { name: "oversized", markdown: "x".repeat(5), limit: 4 },
    { name: "stale", markdown: "```ts\nmissing()\n```", limit: 100 },
    { name: "valid", markdown: "```ts\npresent()\n```", limit: 100 },
    ], "present()"),
  ];
  if (!failures.some((item) => item.includes("families.source.json[1]"))
    || !failures.some((item) => item.includes("duplicate family"))
    || !failures.some((item) => item.includes("oversized"))
    || !failures.some((item) => item.includes("stale"))) {
    throw new Error(`guide validation self-test lost failures: ${JSON.stringify(failures)}`);
  }
  console.log(`guide validation self-test ok: ${failures.join(" | ")}`);
}

function familyFailures(value) {
  if (!Array.isArray(value)) {
    return ["guide/families.source.json: expected an array of family records"];
  }
  const failures = [];
  const familyCounts = new Map();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      failures.push(`guide/families.source.json[${index}]: expected an object`);
      continue;
    }
    const missing = ["family", "code", "wrong", "right"]
      .filter((field) => typeof entry[field] !== "string" || entry[field].length === 0);
    if (missing.length > 0) {
      failures.push(`guide/families.source.json[${index}]: missing ${missing.join(", ")}`);
    }
    if (typeof entry.family === "string" && entry.family.length > 0) {
      familyCounts.set(entry.family, (familyCounts.get(entry.family) ?? 0) + 1);
    }
  }
  for (const [family, count] of familyCounts) {
    if (count > 1) failures.push(`guide/families.source.json: duplicate family ${family}`);
  }
  return failures;
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
