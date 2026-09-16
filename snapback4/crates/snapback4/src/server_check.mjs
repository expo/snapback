// The CLI embeds this checker. Resolve the application's installed compiler;
// never download a package or execute the application's TypeScript to check it.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const root = resolve(process.argv[1]);
const entry = resolve(process.argv[2]);
const require = createRequire(resolve(root, "package.json"));
let ts;
try { ts = require("typescript"); }
catch {
  console.error("E_SERVER_TOOLCHAIN: install TypeScript in this application (bun add --dev typescript @types/node), then run snapback4 check again");
  process.exit(1);
}
// Persist the checker's actual graph, not every UI file under the app root.
// Failed file lookups (and absent directories that short-circuit lookups) are
// dependencies too: creating a previously missing import must recover dev.
const generated = resolve(root, "snapback/generated");
const dependencies = new Map();
function observe(path) {
  const absolute = resolve(path);
  if (absolute === generated || absolute.startsWith(generated + sep) || dependencies.has(absolute)) return;
  let state = null;
  try { const stat = statSync(absolute, { bigint: true }); state = [String(stat.mtimeNs), String(stat.size)]; } catch {}
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
      if (!exists) observe(path);
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
