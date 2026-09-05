import { cp, link, mkdir, open, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { build } from "esbuild";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const packageBuildLock = resolve(here, "../../target/b2-package-build.lock");
const packageBuildLockHeld = process.env.SNAPBACK2_PACKAGE_BUILD_LOCK_HELD === "1";
// Test fixtures take this same lock while snapshotting dist as one package unit.
const packageBuildToken = packageBuildLockHeld ? undefined : await acquirePackageBuildLock();
try {
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

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

await build({
  entryPoints: {
    index: resolve(here, "src/index.ts"),
    client: resolve(here, "src/client.ts"),
    react: resolve(here, "src/react.tsx"),
    "react-core": resolve(here, "src/react-core.tsx"),
    expo: resolve(here, "src/expo.ts"),
    "expo/witness": resolve(here, "src/expo/witness.ts"),
    "react-native": resolve(here, "src/react-native.tsx"),
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
  external: ["react", "react-native", "expo-file-system", "expo/fetch", "expo-video", "expo-sqlite", "expo-secure-store", "snapback2/client", "snapback2/react-core", "snapback2/expo", "snapback2/react-native", "snapback2/expo/witness"],
  plugins: [externalClient],
});

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
await cp(resolve(here, "../compiler/subset-lib.d.ts"), resolve(dist, "compiler-lib.d.ts"));
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
await rm(declarations, { recursive: true, force: true });
await mergeOfflineProtocolDeclarations();

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
  for (const arm of ["react", "expo", "shared"]) {
    const source = resolve(here, `templates/${name}/${arm}`);
    if (existsSync(source)) await cp(source, resolve(templateDist, name, arm), { recursive: true, dereference: true });
  }
  if (name === "chat") {
    // Metro 54 does not resolve an explicit .js import to its .ts source. Build
    // the shared reducers ahead; ship their TS beside JS for generated-API types.
    // shared/ is flattened by init; react/shared and expo/shared are the
    // dereferenced template arms used directly by previews and qualification.
    // All three need the JS leaves: Metro does not resolve .js imports to .ts.
    for (const directory of ["shared", "react/shared", "expo/shared"]) await build({
      entryPoints: [resolve(here, "templates/chat/shared/log.ts"), resolve(here, "templates/chat/shared/offline.ts")],
      outdir: resolve(templateDist, name, directory), format: "esm", platform: "neutral", target: "es2022",
    });
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
  ["grammar", "quarry", "auth", "live-query", "effects", "personas", "testing", "offline"].map(async (name) => ({
    name,
    markdown: await readFile(resolve(guideSource, `${name}.md`), "utf8"),
    // LLP 1010 A5 expands Quarry with merge; LLP 1006 adds the two asset types.
    limit: name === "grammar" ? 2304 : name === "quarry" ? 14336 : 4096,
  })),
);
const guideErrors = [...familyErrors, ...guideFailures(guidePages, tsFixtureText, quarryFixtureText, parseDocument)];
if (guideErrors.length > 0) {
  throw new Error(`guide validation failed:\n${guideErrors.join("\n")}`);
}

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
  await cp(resolve(here, "bin"), resolve(snapshotPath, "bin"), { recursive: true });
  await cp(dist, resolve(snapshotPath, "dist"), { recursive: true });
}

if (process.argv.includes("--self-test")) {
  const failures = [
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
  if (!failures.some((item) => item.includes("families.source.json[1]"))
    || !failures.some((item) => item.includes("duplicate code"))
    || !failures.some((item) => item.includes("oversized"))
    || !failures.some((item) => item.includes("stale"))
    || !failures.some((item) => item.includes("invalid-quarry") && item.includes("do not parse"))) {
    throw new Error(`guide validation self-test lost failures: ${JSON.stringify(failures)}`);
  }
  console.log(`guide validation self-test ok: ${failures.join(" | ")}`);
}
} finally {
  if (packageBuildToken) await releasePackageBuildLock(packageBuildToken);
}

async function mergeOfflineProtocolDeclarations() {
  const indexPath = resolve(dist, "index.d.ts");
  const offlinePath = resolve(dist, "offline-protocol.d.ts");
  const [indexDeclarations, offlineDeclarations] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(offlinePath, "utf8"),
  ]);
  const closingBrace = indexDeclarations.lastIndexOf("\n}");
  if (closingBrace < 0) throw new Error("compiler/lib.d.ts lost its ambient snapback2 module");
  await writeFile(
    indexPath,
    `${indexDeclarations.slice(0, closingBrace)}\n\n${offlineDeclarations.trim()}\n${indexDeclarations.slice(closingBrace)}`,
  );
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
      .filter((match) => /^(?:table|maintain|channel|query|mutation|effect|use)\b/.test(match[1].trimStart()))
      .filter((match) => parseDocument(`guide/${name}.q`, match[1]).diagnostics.length > 0).length;
    if (staleSnippets > 0) reasons.push(`${staleSnippets} TypeScript snippet(s) not present in the compiler fixtures`);
    if (staleQuarrySnippets > 0) reasons.push(`${staleQuarrySnippets} Quarry snippet(s) not present in the compiler fixtures or templates`);
    if (invalidQuarryModules > 0) reasons.push(`${invalidQuarryModules} top-level Quarry module snippet(s) do not parse`);
    if (reasons.length > 0) failures.push(`guide/${name}.md: ${reasons.join("; ")}`);
  }
  return failures;
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
  for (const name of ["todos", "chat", "quarry-todos", "quarry-chat", "quarry-surface", "quarry-assets"]) {
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
