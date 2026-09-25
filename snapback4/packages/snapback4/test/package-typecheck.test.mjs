import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, relative, isAbsolute } from "node:path";
import ts from "typescript";

test("package sources typecheck before generated dist declarations exist", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.deepEqual(parsed.errors, []);
  const dist = join(root, "dist");
  const generated = path => {
    const suffix = relative(dist, path);
    return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix));
  };
  // The suite builds dist before running JS tests. Model a fresh package
  // without deleting artifacts used by concurrently running client tests.
  const host = ts.createCompilerHost(parsed.options);
  for (const name of ["fileExists", "readFile", "directoryExists"]) {
    const original = host[name].bind(host);
    host[name] = path => generated(path) ? (name === "readFile" ? undefined : false) : original(path);
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }));
});
