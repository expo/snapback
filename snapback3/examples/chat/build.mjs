import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "rolldown";
import ts from "typescript";
import { compileProject } from "snapback3/compiler";
import { writeServiceWorker } from "./build-shell.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const generated = resolve(root, ".snapback3/build");
const compiled = await compileProject(root);
if (!compiled.ok)
  throw new Error(JSON.stringify(compiled.diagnostics, null, 2));
await mkdir(generated, { recursive: true });
await writeFile(resolve(generated, "api.d.ts"), compiled.apiDts);
const config = ts.readConfigFile(
  resolve(root, "tsconfig.json"),
  ts.sys.readFile,
);
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
  );
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
if (process.argv.includes("--check")) {
  console.log("Commonroom: Quarry and inferred application types pass");
} else {
  const output = resolve(root, "dist/public");
  await mkdir(output, { recursive: true });
  const built = await build({
    input: resolve(root, "src/main.tsx"),
    platform: "browser",
    transform: {
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
    },
    output: {
      dir: output,
      format: "esm",
      entryFileNames: "app-[hash].js",
      chunkFileNames: "[name]-[hash].js",
      assetFileNames: "[name]-[hash][extname]",
      sourcemap: true,
      minify: true,
    },
  });
  const entry = built.output.find(file => file.type === 'chunk' && file.isEntry);
  if (!entry) throw new Error('Commonroom did not emit its application entry.');
  const styles = await Promise.all(
    ["style.css", "responsive.css"].map((name) =>
      readFile(resolve(root, "src", name), "utf8"),
    ),
  );
  const css = styles.join("\n");
  const styleName = `app-${createHash('sha256').update(css).digest('hex').slice(0, 20)}.css`;
  await writeFile(resolve(output, styleName), css);
  const html = (await readFile(resolve(root, "index.html"), "utf8"))
    .replace('/app.js', `/${entry.fileName}`).replace('/app.css', `/${styleName}`);
  await writeFile(resolve(output, "index.html"), html);
  const shell = await writeServiceWorker(output, [
    'index.html', styleName, ...built.output.filter(file => /\.(?:js|css)$/.test(file.fileName)).map(file => file.fileName),
  ]);
  console.log(`Commonroom built → dist/public (Rolldown + TypeScript; offline shell ${shell.version.slice(0, 12)})`);
}
