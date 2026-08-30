import { cp, mkdir, rm } from "node:fs/promises";
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
    test: resolve(here, "src/test.ts"),
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
