// The CLI embeds this checker. Resolve the application's installed compiler;
// never download a package or execute the application's TypeScript to check it.
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(process.argv[1]);
const entry = resolve(process.argv[2]);
const require = createRequire(resolve(root, "package.json"));
let ts;
try { ts = require("typescript"); }
catch {
  console.error("E_SERVER_TOOLCHAIN: install TypeScript in this application (bun add --dev typescript @types/node), then run snapback4 check again");
  process.exit(1);
}
const config = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
let options = {};
let errors = [];
if (config) {
  const loaded = ts.readConfigFile(config, ts.sys.readFile);
  if (loaded.error) errors.push(loaded.error);
  else {
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
    options = parsed.options;
    errors.push(...parsed.errors.filter(error => error.code !== 18003));
  }
}
// Check only the server entry and its import graph; a broken UI is not a
// handler diagnostic. Strictness and noEmit cannot be disabled by tsconfig.
const program = ts.createProgram([entry], {
  ...options,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  allowJs: true,
  checkJs: true,
  skipLibCheck: true,
  composite: false,
  incremental: false,
});
errors.push(...ts.getPreEmitDiagnostics(program));
if (errors.length) {
  console.error("E_SERVER_TYPECHECK: generated server handlers do not typecheck\n" + ts.formatDiagnostics(errors.slice(0, 50), {
    getCanonicalFileName: path => path,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }));
  process.exit(1);
}
