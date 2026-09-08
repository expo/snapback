import { gzipSync } from "node:zlib";
import { cp, link, mkdir, open, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { build, version as esbuildVersion } from "esbuild";
import ts from "typescript";
import { generateUnicodeTables } from "../evaluator/unicode-build.mjs";

generateUnicodeTables();
if (process.argv.includes("--unicode-only")) process.exit(0);

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv.includes("--measure-twin")) {
  const measured = await build({ stdin: { contents: [
    "export * from './src/twin.ts'; export { serverArguments } from './src/local-cursor.ts'; export { reduceQueryState } from './src/types.ts';",
    "export { PersistentRangeStore } from './src/store/range-store.ts';",
    "export { OfflineRuntime, offlineView } from './src/offline.ts';",
    "export * as carrierProjection from './src/store/projection.ts';",
    "export * as receiptProtocol from './src/offline-protocol.ts';",
  ].join("\n"), resolveDir: here, loader: "ts" }, bundle: true, minify: true,
    platform: "neutral", format: "esm", target: "es2022", write: false, metafile: true });
  const bytes = measured.outputFiles[0].contents, gzip = gzipSync(bytes, { level: 9 }).length;
  const required = ["unicode-tables", "index-store", "twin-store", "swap-journal", "carrier-index", "metadata", "projection", "range-store", "offline.ts", "offline-protocol", "local-cursor", "held-program"];
  const inputs = Object.keys(measured.metafile.inputs);
  for (const name of required) if (!inputs.some(p => p.includes(name))) throw new Error(`unmeasured twin implementation: ${name}`);
  console.log(JSON.stringify({ entry: "complete-local-runtime", minified: bytes.length, gzip, ceiling: 84000, target: 80000,
    toolchain: { node: process.version, esbuild: esbuildVersion, gzipLevel: 9 }, inputs }));
  if (gzip > 84000) throw new Error(`twin exceeds 84000 gzip bytes: ${gzip}`);
  process.exit(0);
}
if (process.argv.includes("--self-test")) {
  await runGuideValidationSelfTest();
  process.exit(0);
}
const dist = resolve(here, "dist");
const packageBuildLock = resolve(here, "../../target/b2-package-build.lock");
const packageBuildLockHeld = process.env.SNAPBACK2_PACKAGE_BUILD_LOCK_HELD === "1";
// Test fixtures take this same lock while snapshotting dist as one package unit.
const packageBuildToken = packageBuildLockHeld ? undefined : await acquirePackageBuildLock();
try {
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(here, '../../unicode/17.0.0/LICENSE.txt'), resolve(dist, 'unicode-LICENSE.txt'));

const externalClient = {
  name: "external-client",
  setup(build) {
    build.onResolve({ filter: /(?:^|\/)(?:client|react-core)\.js$/ }, (args) => {
      const target = resolve(dirname(args.importer), args.path);
      if (target === resolve(here, "src/react-core.js")) return { path: "snapback2/react-core", external: true };
      if (target === resolve(here, "src/client.js")) return { path: "snapback2/client", external: true };
    });
  },
};

// All public arms import one private nominal image module. No global brand registry or public export is needed.
const imageModules = new Set(['row-image','range-preparation','errors','unicode'].map(name => resolve(here, `../evaluator/src/${name}`)));
imageModules.add(resolve(here, 'src/query-frame'));
const imageRuntime = (path = './image-runtime.mjs') => ({
  name: 'shared-image-runtime',
  setup(builder) {
    builder.onResolve({ filter: /(?:row-image|range-preparation|errors|unicode|query-frame)(?:\.[jt]s)?$/ }, args => {
      const target = resolve(dirname(args.importer), args.path.replace(/\.[jt]s$/, ''));
      if (imageModules.has(target)) return { path, external: true };
    });
  },
});
await build({ entryPoints: [resolve(here,'src/image-runtime.ts')], outdir: dist, outExtension: { '.js': '.mjs' },
  bundle: true, minify: true, sourcemap: true, platform: 'neutral', format: 'esm', target: 'es2022' });

await build({
  entryPoints: {
    index: resolve(here, "src/index.ts"),
    client: resolve(here, "src/client.ts"),
    react: resolve(here, "src/react.tsx"),
    "react-core": resolve(here, "src/react-core.tsx"),
    expo: resolve(here, "src/expo.ts"),
    "react-native": resolve(here, "src/react-native.tsx"),
    "client-observed-test": resolve(here, "tests/client-observed-exports.ts"),
    "witness-test": resolve(here, "tests/witness-exports.ts"),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  bundle: true,
  format: "esm",
  minify: true,
  platform: "neutral",
  target: "es2022",
  external: ["expo", "react", "react-native", "expo-file-system", "expo/fetch", "expo-video", "expo-sqlite", "expo-secure-store", "snapback2/client", "snapback2/react-core", "snapback2/expo", "snapback2/react-native", "snapback2/expo/witness"],
  plugins: [externalClient, imageRuntime()],
});

// This existing nested entry uses the same module by its relative output location.
await build({ entryPoints: { 'expo/witness': resolve(here,'src/expo/witness.ts') }, outdir: dist,
  outExtension: { '.js': '.mjs' }, sourcemap: true, bundle: true, format: 'esm', minify: true,
  platform: 'neutral', target: 'es2022', external: ['expo','react','react-native','expo-file-system','expo/fetch','expo-video','expo-sqlite','expo-secure-store','snapback2/client','snapback2/react-core','snapback2/expo','snapback2/react-native','snapback2/expo/witness'],
  plugins: [externalClient,imageRuntime('../image-runtime.mjs')] });

await build({
  entryPoints: {
    test: resolve(here, "src/test.ts"),
    "sqlite-test": resolve(here, "tests/sqlite-exports.ts"),
    "test-runner": resolve(here, "src/test.ts"),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["expo-file-system", "expo/fetch"],
  plugins: [imageRuntime()],
});

await build({
  entryPoints: { compiler: resolve(here, "../compiler/src/worker.ts") },
  outdir: dist,
  entryNames: "[name]",
  chunkNames: "compiler-core",
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  bundle: true,
  format: "esm",
  minify: true,
  platform: "node",
  splitting: true,
  target: "node20",
  external: ["typescript"],
});

await cp(resolve(here, "../compiler/lib.d.ts"), resolve(dist, "index.d.ts"));
await cp(resolve(here, "../compiler/lib.d.ts"), resolve(dist, "authoring-lib.d.ts"));
await cp(resolve(here, "../compiler/subset-lib.d.ts"), resolve(dist, "compiler-lib.d.ts"));
// @ref LLP 1003#1-authoring — effect libraries are packaged at build time; check never reads TypeScript's installed lib files.
const effectLibs = new Map();
const tsLibDirectory = dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2020 }));
async function collectEffectLib(name) {
  if (effectLibs.has(name)) return;
  const source = await readFile(resolve(tsLibDirectory, `lib.${name}.d.ts`), "utf8");
  effectLibs.set(name, source.replace(/^\/\/\/\s*<reference[^\n]*\n/gm, ""));
  for (const reference of ts.preProcessFile(source).libReferenceDirectives) await collectEffectLib(reference.fileName);
}
await collectEffectLib("es2020");
await writeFile(resolve(dist, "effects-lib.d.ts"), [
  ...effectLibs.values(),
  await readFile(resolve(here, "../compiler/effects-lib.d.ts"), "utf8"),
].join("\n"));
await cp(resolve(here, "types/test.d.ts"), resolve(dist, "test.d.ts"));

const declarations = resolve(dist, ".declarations");
const declarationProgram = ts.createProgram({
  rootNames: [
    resolve(here, "src/api.ts"),
    resolve(here, "src/expo.ts"),
    resolve(here, "src/expo/witness.ts"),
    resolve(here, "src/assets.ts"),
    resolve(here, "src/client.ts"),
    resolve(here, "src/react-native.tsx"),
    resolve(here, "src/offline-protocol.ts"),
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
    outDir: declarations,
    // The twin imports the evaluator's sources (one evaluator locus, LLP 1002 §9),
    // so declarations root at `packages/` and this package's own are moved into dist.
    rootDir: resolve(here, ".."),
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    types: [],
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
await cp(resolve(declarations, "snapback2/src"), dist, { recursive: true });
await cp(resolve(declarations, "evaluator"), resolve(dist, "evaluator"), { recursive: true });
await cp(resolve(declarations, "compiler"), resolve(dist, "compiler"), { recursive: true });
await rewriteEvaluatorDeclarationImports(dist);
await writeRootPackageDeclarations();
await rm(declarations, { recursive: true, force: true });

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
for (const name of ["todos", "chat"]) {
  await cp(resolve(here, `templates/${name}/snapback`), resolve(templateDist, name, "snapback"), { recursive: true });
  // @ref LLP 1018.003#5-the-certified-thread-projection — the chat template ships no
  // shared reducer module: each arm's screens read the snapshot record directly.
  for (const arm of ["react", "expo"]) {
    const source = resolve(here, `templates/${name}/${arm}`);
    if (existsSync(source)) await cp(source, resolve(templateDist, name, arm), { recursive: true, dereference: true });
  }
}
await cp(resolve(here, "templates/react"), resolve(templateDist, "react"), { recursive: true });

const fixturePaths = await fixtureFiles(fixtures);
const tsFixtureText = (await Promise.all(fixturePaths.filter((path) => path.endsWith(".ts")).map((path) => readFile(path, "utf8")))).join("\n");
const templateQuarryPaths = await quarryTemplateFiles(resolve(here, "templates"));
const quarryFixtureText = (await Promise.all([...fixturePaths, ...templateQuarryPaths]
  .filter((path) => path.endsWith(".q")).map((path) => readFile(path, "utf8")))).join("\n");
const parseDocument = await loadQuarryParser();
const guidePages = await Promise.all(
  ["grammar", "quarry", "auth", "live-query", "effects", "personas", "testing", "offline", "job", "schedule"].map(async (name) => ({
    name,
    markdown: await readFile(resolve(guideSource, `${name}.md`), "utf8"),
    // LLP 1017 adds cap invariants and complete mutation loops to the reference.
    limit: name === "grammar" ? 3584 : name === "quarry" ? 15872 : name === "live-query" ? 5632 : name === "offline" ? 4864 : 4096,
  })),
);
const guideErrors = [...familyErrors, ...quarryFamilyFailures(families, parseDocument), ...guideFailures(guidePages, tsFixtureText, quarryFixtureText, parseDocument)];
if (guideErrors.length > 0) {
  throw new Error(`guide validation failed:\n${guideErrors.join("\n")}`);
}
await writeFile(resolve(guide, "keywords.json"), `${JSON.stringify(guideKeywords(guidePages, await readFile(resolve(here, "README.md"), "utf8")), null, 2)}\n`);

const snapshot = process.env.SNAPBACK2_PACKAGE_BUILD_SNAPSHOT;
if (snapshot) {
  const workspace = resolve(here, "../..");
  const snapshotPath = resolve(snapshot);
  const workspaceRelative = relative(workspace, snapshotPath);
  if (!workspaceRelative
    || workspaceRelative === ".."
    || workspaceRelative.startsWith(`..${sep}`)
    || isAbsolute(workspaceRelative)) {
    throw new Error("SNAPBACK2_PACKAGE_BUILD_SNAPSHOT must stay inside the snapback2 workspace");
  }
  await rm(snapshotPath, { recursive: true, force: true });
  await mkdir(snapshotPath, { recursive: true });
  await cp(resolve(here, "package.json"), resolve(snapshotPath, "package.json"));
  await cp(resolve(here, "README.md"), resolve(snapshotPath, "README.md"));
  await cp(resolve(here, "bin"), resolve(snapshotPath, "bin"), { recursive: true });
  await cp(dist, resolve(snapshotPath, "dist"), { recursive: true });
  for (const file of ["ios", "android/build.gradle", "android/src", "expo-module.config.json"]) {
    await mkdir(dirname(resolve(snapshotPath, file)), { recursive: true });
    await cp(resolve(here, file), resolve(snapshotPath, file), { recursive: true });
  }
}

} finally {
  if (packageBuildToken) await releasePackageBuildLock(packageBuildToken);
}

async function runGuideValidationSelfTest() {
  const parseDocument = await loadQuarryParser();
  const keywordFixture = guideKeywords([
    { name: "grammar", markdown: "- `spark`: `spark value`\n- `sparks`: an alias" },
    { name: "quarry", markdown: "# Quarry\n\n```q\n`spark value` is ignored.\n```\n\n## Spark\n\n`spark value` defines a signal.\n\n## Elsewhere\n\nUnrelated prose." },
  ]);
  if (!keywordFixture.spark.includes("`spark value` defines a signal.")
    || !keywordFixture.sparks.includes("## quarry: Spark")
    || keywordFixture.spark.includes("ignored") || keywordFixture.spark.includes("Unrelated")) {
    throw new Error("guide keyword extraction lost the defining paragraph");
  }
  let missingDefinition = false;
  try { guideKeywords([{ name: "grammar", markdown: "- `spark`: `spark value`" }]); }
  catch (error) { missingDefinition = error.message.includes("spark has no defining paragraph"); }
  if (!missingDefinition) throw new Error("guide keyword extraction admitted an undefined construct");
  const topicPages = [
    { name: "grammar", markdown: "- `spark`: `spark value`" },
    { name: "quarry", markdown: "# Spark\n\n`spark value` defines a signal." },
  ];
  const topics = guideKeywords(topicPages, [
    "# Package", "", "## Spark", "", "Must not replace the construct.", "",
    "## Upload & Storage!", "", "First defining paragraph", "keeps its line break.", "",
    "Later paragraph is not the definition.", "", "### Native detail", "", "Not a topic.", "",
    "## Upload / Storage", "", "Must not replace the first topic.", "",
    "## Empty", "", "### Child", "", "Must not become the parent definition.", "",
    "~~~md", "## Fenced heading", "", "Not a topic.", "~~~~", "",
    "## After Example", "", "```sh", "example", "```", "",
    "- A list is not the defining paragraph.", "  Nor its continuation.", "",
    "Actual definition after the example.", "", "## !!!", "", "No usable key.",
  ].join("\n"));
  if (topics.spark !== guideKeywords(topicPages).spark
    || Object.keys(topics).join(",") !== "spark,upload-storage,after-example"
    || topics["upload-storage"] !== '# `upload-storage`\n\nFirst defining paragraph\nkeeps its line break.\n\nSee the packaged [README.md](../../README.md), section "Upload & Storage!", for the full documentation.\n'
    || !topics["after-example"].includes("Actual definition after the example.")) {
    throw new Error("README topics lost normalization, first-paragraph boundaries, or collision priority");
  }
  const failures = [
    ...quarryFamilyFailures([{ family: "bound", language: "q", code: "E_BAD_CAP", right: "cap 50 by conversationId // invalid" }], parseDocument),
    ...familyFailures([
      { family: "first", code: "E_ONE", wrong: "wrong", right: "right" },
      { family: "second", code: "E_ONE", wrong: "", right: "" },
    ]),
    ...guideFailures([
    { name: "oversized", markdown: "x".repeat(5), limit: 4 },
    { name: "stale", markdown: "```ts\nmissing()\n```", limit: 100 },
    { name: "valid", markdown: "```ts\npresent()\n```", limit: 100 },
    { name: "valid-quarry", markdown: "```q\nquery okay():\n  return null\n```", limit: 100 },
    { name: "invalid-quarry", markdown: "```q\nquery broken():\n```", limit: 100 },
    ], "present()", "query okay():\n  return null\nquery broken():", parseDocument),
  ];
  if (!failures.some((item) => item.includes("E_BAD_CAP"))
    || !failures.some((item) => item.includes("families.source.json[1]"))
    || !failures.some((item) => item.includes("duplicate code"))
    || !failures.some((item) => item.includes("oversized"))
    || !failures.some((item) => item.includes("stale"))
    || !failures.some((item) => item.includes("invalid-quarry") && item.includes("do not parse"))) {
    throw new Error(`guide validation self-test lost failures: ${JSON.stringify(failures)}`);
  }
  console.log(`guide validation self-test ok: ${failures.join(" | ")}`);
}

async function writeRootPackageDeclarations() {
  const indexPath = resolve(dist, "index.d.ts");
  const [ambientDeclarations, source] = await Promise.all([
    readFile(resolve(here, "../compiler/lib.d.ts"), "utf8"),
    readFile(resolve(here, "src/index.ts"), "utf8"),
  ]);
  const prefix = 'declare module "snapback2" {\n';
  const trimmed = ambientDeclarations.trimEnd();
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith("\n}")) {
    throw new Error("compiler/lib.d.ts lost its ambient snapback2 module");
  }
  const body = trimmed.slice(prefix.length, -2).replace(/^  /gm, "");
  const sourceFile = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const reexports = sourceFile.statements
    .filter((statement) => ts.isExportDeclaration(statement))
    .map((statement) => statement.getText(sourceFile));
  if (reexports.length === 0) throw new Error("src/index.ts lost its public module re-exports");
  // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — the virtual compiler ambient and shipped package root have distinct module roles.
  await writeFile(indexPath, `${body}\n\n${reexports.join("\n")}\n`);
}

async function rewriteEvaluatorDeclarationImports(root) {
  const evaluatorRoot = resolve(root, "evaluator/src");
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (path !== resolve(root, "evaluator")) await visit(path);
        continue;
      }
      if (!entry.name.endsWith(".d.ts")) continue;
      const evaluatorRelative = relative(dirname(path), evaluatorRoot).split(sep).join("/");
      const evaluatorSpecifier = evaluatorRelative.startsWith(".") ? evaluatorRelative : `./${evaluatorRelative}`;
      const source = await readFile(path, "utf8");
      const rewritten = source.replace(/(["'])(?:\.\.\/)+evaluator\/src\//g, `$1${evaluatorSpecifier}/`);
      if (rewritten !== source) await writeFile(path, rewritten);
    }
  }
  await visit(root);
}

async function acquirePackageBuildLock() {
  await mkdir(dirname(packageBuildLock), { recursive: true });
  const started = Date.now();
  const token = randomUUID();
  for (;;) {
    try {
      await writeFile(packageBuildLock, `${JSON.stringify({ pid: process.pid, token })}\n`, { flag: "wx" });
      return token;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await reclaimStalePackageBuildLock()) continue;
      if (Date.now() - started >= 30_000) {
        throw new Error(`timed out waiting for package build lock ${packageBuildLock}`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  }
}

async function reclaimStalePackageBuildLock() {
  let handle;
  try {
    handle = await open(packageBuildLock, "r");
    const [text, held] = await Promise.all([handle.readFile("utf8"), handle.stat()]);
    const owner = parsePackageBuildOwner(text);
    if (!owner || processAlive(owner.pid)) return false;
    const claim = `${packageBuildLock}.stale-${process.pid}-${randomUUID()}`;
    try {
      await link(packageBuildLock, claim);
      const claimed = await stat(claim);
      if (claimed.dev !== held.dev || claimed.ino !== held.ino) return false;
      const current = await stat(packageBuildLock);
      if (current.dev !== held.dev || current.ino !== held.ino) return false;
      try {
        await unlink(packageBuildLock);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      if (error?.code === "EEXIST") return false;
      throw error;
    } finally {
      await rm(claim, { force: true });
    }
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  } finally {
    await handle?.close();
  }
}

function parsePackageBuildOwner(text) {
  try {
    const value = JSON.parse(text);
    return Number.isSafeInteger(value?.pid) && value.pid > 0
      ? { pid: value.pid, token: typeof value.token === "string" ? value.token : undefined }
      : undefined;
  } catch {
    const pid = Number(text.trim());
    return Number.isSafeInteger(pid) && pid > 0 ? { pid } : undefined;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function releasePackageBuildLock(token) {
  try {
    const owner = parsePackageBuildOwner(await readFile(packageBuildLock, "utf8"));
    if (owner?.pid === process.pid && owner.token === token) await unlink(packageBuildLock);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function familyFailures(value) {
  if (!Array.isArray(value)) {
    return ["guide/families.source.json: expected an array of family records"];
  }
  const failures = [];
  const codeCounts = new Map();
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
    if (typeof entry.code === "string" && entry.code.length > 0) {
      codeCounts.set(entry.code, (codeCounts.get(entry.code) ?? 0) + 1);
    }
  }
  for (const [code, count] of codeCounts) {
    if (count > 1) failures.push(`guide/families.source.json: duplicate code ${code}`);
  }
  return failures;
}

// The same language selection as guide.rs; fragments get only a syntax wrapper.
function quarryFamilyFailures(rows, parseDocument) {
  return rows.flatMap((row) => {
    if (row.family !== "quarry" && row.language !== "q"
      && ![row.wrong, row.right].some((text) => text?.startsWith("```q"))) return [];
    const code = row.right.replace(/^```q\n/, "").replace(/\n```$/, "");
    let fragment = code;
    if (/^(cap |by |unique |immutable |read <-|retain )/.test(code)) {
      fragment = `table example:\n  ${code.split("\n").join("\n  ")}\n`;
    } else if (!/^(?:--[^\n]*\n)*(table |query |mutation |maintain |use |channel |schedule |job )/.test(code)) {
      fragment = `mutation example():\n  ${code.split("\n").join("\n  ")}\n`;
      if (code.trimEnd().endsWith(":")) fragment += "    return null\n";
    }
    return parseDocument(`guide/${row.code}.q`, fragment).diagnostics.length
      ? [`guide/${row.code}: Quarry right example does not parse`] : [];
  });
}

function guideFailures(pages, tsFixturesText, quarryFixturesText, parseDocument) {
  const failures = [];
  for (const { name, markdown, limit } of pages) {
    const reasons = [];
    if (Buffer.byteLength(markdown) > limit) reasons.push(`exceeds ${limit} bytes`);
    const staleSnippets = [...markdown.matchAll(/```ts\n([\s\S]*?)\n```/g)]
      .filter((match) => !tsFixturesText.includes(match[1])).length;
    const quarrySnippets = [...markdown.matchAll(/```q\n([\s\S]*?)\n```/g)];
    const staleQuarrySnippets = quarrySnippets
      .filter((match) => !quarryFixturesText.includes(match[1])).length;
    const invalidQuarryModules = quarrySnippets
      .filter((match) => /^(?:table|maintain|channel|query|mutation|job|schedule|effect|use)\b/.test(match[1].trimStart()))
      .filter((match) => parseDocument(`guide/${name}.q`, match[1]).diagnostics.length > 0).length;
    if (staleSnippets > 0) reasons.push(`${staleSnippets} TypeScript snippet(s) not present in the compiler fixtures`);
    if (staleQuarrySnippets > 0) reasons.push(`${staleQuarrySnippets} Quarry snippet(s) not present in the compiler fixtures or templates`);
    if (invalidQuarryModules > 0) reasons.push(`${invalidQuarryModules} top-level Quarry module snippet(s) do not parse`);
    if (reasons.length > 0) failures.push(`guide/${name}.md: ${reasons.join("; ")}`);
  }
  return failures;
}

// @ref LLP 1002#8-why-trace-guide — derive keyword help from shipped prose at build time.
function guideKeywords(pages, readme = "") {
  const grammar = pages.find((page) => page.name === "grammar")?.markdown ?? "";
  const definitions = [];
  for (const { name, markdown } of pages) {
    if (!["quarry", "schedule", "job", "effects", "live-query"].includes(name)) continue;
    let heading = name;
    for (const block of markdown.replace(/```[^\n]*\n[\s\S]*?\n```/g, "").split(/\n\s*\n/)) {
      const paragraph = block.trim();
      const title = /^#{1,6} (.+)$/.exec(paragraph);
      if (title) heading = title[1];
      else if (paragraph) definitions.push({ name, heading, paragraph });
    }
  }
  const keywords = Object.create(null);
  for (const line of grammar.split("\n")) {
    const entry = /^- `([a-z][a-z0-9-]*)`: /.exec(line);
    if (!entry) continue;
    const keyword = entry[1];
    const starts = new RegExp("^`" + keyword + "(?=[`(\\s])");
    const sentence = new RegExp("(?:^|[.!?;]\\s+)`" + keyword + "(?=[`(\\s])");
    const definition = definitions.map((definition) => {
      const words = definition.heading.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [];
      const headingMatch = words.some((word) => word === keyword || word === `${keyword}s` || `${word}s` === keyword);
      return { ...definition, score: starts.test(definition.paragraph) ? 3 : sentence.test(definition.paragraph) ? 2 : headingMatch ? 1 : 0 };
    }).filter((definition) => definition.score > 0).sort((a, b) => b.score - a.score)[0];
    if (!definition) throw new Error(`guide/grammar.md: ${keyword} has no defining paragraph; define it on its guide page`);
    if (Object.hasOwn(keywords, keyword)) throw new Error(`guide/grammar.md: duplicate construct ${keyword}`);
    keywords[keyword] = `# \`${keyword}\`\n\n${line.slice(2)}\n\n## ${definition.name}: ${definition.heading}\n\n${definition.paragraph}\n`;
  }
  if (Object.keys(keywords).length === 0) throw new Error("guide/grammar.md: no construct lines");
  // README H2 topics are fallback entries; constructs and earlier topics win collisions.
  let heading, key, fence, skipBlock = false;
  let paragraph = [];
  const finishParagraph = () => {
    if (key && paragraph.length && !Object.hasOwn(keywords, key)) {
      keywords[key] = `# \`${key}\`\n\n${paragraph.join("\n")}\n\nSee the packaged [README.md](../../README.md), section "${heading}", for the full documentation.\n`;
    }
    paragraph = [];
    skipBlock = false;
  };
  for (const line of `${readme}\n`.split("\n")) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(line)) fence = undefined;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) { finishParagraph(); fence = opening[1]; continue; }
    const title = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (title) {
      finishParagraph();
      heading = title[2];
      key = title[1] === "##" ? heading.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") : undefined;
    } else if (!line.trim()) {
      finishParagraph();
    } else if (key && !Object.hasOwn(keywords, key)) {
      if (!paragraph.length && /^(?: {4}|\t| {0,3}(?:[-+*]\s|\d+[.)]\s|>|<!--|[-*_]{3,}\s*$))/.test(line)) skipBlock = true;
      if (!skipBlock) paragraph.push(line);
    }
  }
  return keywords;
}

async function loadQuarryParser() {
  const bundled = await build({
    entryPoints: [resolve(here, "../compiler/src/quarry/parser.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
  });
  const source = bundled.outputFiles[0].text;
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).parseDocument;
}

async function fixtureFiles(root) {
  const output = [];
  for (const name of ["quarry-todos", "quarry-chat", "quarry-surface", "quarry-assets", "quarry-jobs", "quarry-schedules"]) {
    const directory = resolve(root, name, "snapback");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".q"))) output.push(resolve(directory, entry.name));
    }
  }
  return output;
}

async function quarryTemplateFiles(root) {
  const output = [];
  for (const template of await readdir(root, { withFileTypes: true })) {
    if (!template.isDirectory()) continue;
    const directory = resolve(root, template.name, "snapback");
    if (!existsSync(directory)) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".q")) output.push(resolve(directory, entry.name));
    }
  }
  return output;
}
