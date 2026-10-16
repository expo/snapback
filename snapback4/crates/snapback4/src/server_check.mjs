// The CLI embeds this checker. Resolve the application's installed compiler;
// never download a package or execute the application's TypeScript to check it.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep, isAbsolute } from "node:path";

const root = resolve(process.argv[1]);
const entry = resolve(process.argv[2]);
const require = createRequire(resolve(root, "package.json"));
let ts;
try { ts = require("typescript"); }
catch {
  console.error("E_SERVER_TOOLCHAIN: install TypeScript in this application (bun add --dev typescript@5.9.3 @types/node@24), then run snapback4 check again");
  process.exit(1);
}
// TypeScript 7 is the native compiler: its package exports only `version`,
// not the compiler API this checker drives. Name the version, not a crash.
const major = Number(String(ts?.version ?? "").split(".")[0]);
if (!(major >= 5 && major < 7) || typeof ts.createProgram !== "function" || !ts.sys) {
  console.error(`E_SERVER_TOOLCHAIN: this application's TypeScript ${ts?.version ?? "(unknown version)"} has no compiler API that check can load; check needs TypeScript 5 or 6 (TypeScript 7 is the native compiler). Install a supported one (bun add --dev typescript@5.9.3 @types/node@24), then run snapback4 check again`);
  process.exit(1);
}
// Persist the checker's actual graph, not every UI file under the app root.
// Failed file lookups (and absent directories that short-circuit lookups) are
// dependencies too: creating a previously missing import must recover dev.
const generated = resolve(root, "snapback/generated");
const dependencies = new Map();
function observe(path, missing = false) {
  const absolute = resolve(path);
  if (absolute === generated || absolute.startsWith(generated + sep) || dependencies.has(absolute)) return;
  let state = null;
  if (!missing) {
    try { const stat = statSync(absolute, { bigint: true }); state = [String(stat.mtimeNs), String(stat.size)]; } catch {}
  }
  dependencies.set(absolute, state);
}
function observed(host) {
  const result = { ...host };
  for (const method of ["readFile", "fileExists"]) {
    const operation = host[method].bind(host);
    result[method] = (path, ...args) => { observe(path); return operation(path, ...args); };
  }
  if (host.directoryExists) {
    const directoryExists = host.directoryExists.bind(host);
    result.directoryExists = path => {
      const exists = directoryExists(path);
      // Record the absence the compiler actually saw. A directory created
      // after this lookup must not be acknowledged by a later stat instead.
      if (!exists) observe(path, true);
      return exists;
    };
  }
  return result;
}
const system = observed(ts.sys);
const config = ts.findConfigFile(root, system.fileExists, "tsconfig.json");
let options = {};
let errors = [];
if (config) {
  const loaded = ts.readConfigFile(config, system.readFile);
  if (loaded.error) errors.push(loaded.error);
  else {
    const parsed = ts.parseJsonConfigFileContent(loaded.config, system, dirname(config), undefined, config);
    options = parsed.options;
    errors.push(...parsed.errors.filter(error => error.code !== 18003));
  }
}
// Check only the server entry and its import graph; a broken UI is not a
// handler diagnostic. Strictness and noEmit cannot be disabled by tsconfig.
const compilerOptions = {
  ...options,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  // Explicit per-flag false settings override `strict: true` in TypeScript.
  // A project's UI configuration must not weaken the generated contract.
  noCheck: false,
  noImplicitAny: true,
  noImplicitThis: true,
  strictNullChecks: true,
  strictFunctionTypes: true,
  strictBindCallApply: true,
  strictPropertyInitialization: true,
  strictBuiltinIteratorReturn: true,
  alwaysStrict: true,
  useUnknownInCatchVariables: true,
  noEmit: true,
  noEmitOnError: true,
  erasableSyntaxOnly: true,
  allowImportingTsExtensions: true,
  allowJs: true,
  checkJs: true,
  skipLibCheck: true,
  composite: false,
  incremental: false,
};
const host = ts.createCompilerHost(compilerOptions);
// Mutate this host: getSourceFile closes over its readFile property.
Object.assign(host, observed(host));
const program = ts.createProgram([entry], compilerOptions, host);
errors.push(...ts.getPreEmitDiagnostics(program));
// Source imports must survive private preparation and relocation. Packages and
// builtins are host dependencies; local modules belong to this project.
const projectRoot = realpathSync(root);
const sourceQueue = [...program.getSourceFiles()], inspected = new Set();
for (let index = 0; index < sourceQueue.length; index++) {
  const source = sourceQueue[index];
  if (inspected.has(source.fileName)) continue;
  inspected.add(source.fileName);
  if (!source.fileName.startsWith(root + sep) || source.fileName.split(sep).includes("node_modules")) continue;
  function visit(node) {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
      : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") ? node.arguments[0] : undefined;
    if (specifier && ts.isStringLiteralLike(specifier)) {
      const spec = specifier.text;
      let problem;
      if (isAbsolute(spec) || spec.startsWith("file:")) problem = "use a project-relative import instead of an absolute/file URL import; deploy captures project source";
      else if (spec.startsWith(".")) {
        const module = ts.resolveModuleName(spec, source.fileName, compilerOptions, host).resolvedModule;
        // A .d.ts can satisfy TypeScript without loading the JavaScript that
        // Node executes. Observe and walk that implementation graph too.
        const declarationRuntime = module?.resolvedFileName.replace(/\.d\.(ts|mts|cts)$/, (_, kind) => kind === "mts" ? ".mjs" : kind === "cts" ? ".cjs" : ".js");
        const literal = resolve(dirname(source.fileName), spec);
        const runtime = [literal, declarationRuntime].find(path => path && /\.(?:[cm]?[jt]s|json)$/.test(path) && !/\.d\.[cm]?ts$/.test(path) && system.fileExists(path));
        if (runtime && !runtime.split(sep).includes("node_modules")) {
          const actual = realpathSync(runtime);
          if (!actual.startsWith(projectRoot + sep)) problem = "local server implementations must remain inside the project; install external code as a package";
          else if (!inspected.has(runtime) && !runtime.endsWith(".json")) {
            const text = system.readFile(runtime);
            if (text !== undefined) sourceQueue.push(ts.createSourceFile(runtime, text, ts.ScriptTarget.Latest, true));
          }
        }
        if (module && !module.resolvedFileName.split(sep).includes("node_modules")) {
          const actual = realpathSync(module.resolvedFileName);
          if (!actual.startsWith(projectRoot + sep)) problem = "local server imports must remain inside the project; move the module into the app or install it as a package";
        }
      }
      if (problem) errors.push({category:ts.DiagnosticCategory.Error,code:0,file:source,start:specifier.getStart(source),length:specifier.getWidth(source),messageText:problem});
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

// Publish even on a failed check, atomically, so the watcher can observe a fix
// without adopting the invalid generation. Ignore metadata's own mtime.
const watchFile = resolve(generated, "server-watch.json");
const snapshot = JSON.stringify([...dependencies].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) + "\n";
let previous;
try { previous = readFileSync(watchFile, "utf8"); } catch {}
if (previous !== snapshot) {
  mkdirSync(generated, { recursive: true });
  const temporary = `${watchFile}.${process.pid}.tmp`;
  writeFileSync(temporary, snapshot);
  renameSync(temporary, watchFile);
}
if (errors.length) {
  console.error("E_SERVER_TYPECHECK: generated server handlers do not typecheck\n" + ts.formatDiagnostics(errors.slice(0, 50), {
    getCanonicalFileName: path => path,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }));
  process.exit(1);
}
