import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const checker = readFileSync(new URL("../../../crates/snapback4/src/server_check.mjs", import.meta.url), "utf8");

// Interpose at the compiler's filesystem boundary, not at a timing-dependent
// timeout: recover the missing dependency after the lookup returns false but
// before the checker can record that observation.
for (const boundary of ["directoryExists", "fileExists", "readFile"]) {
  test(`checker retains the actual absent ${boundary} observation during concurrent recovery`, t => {
    const root = mkdtempSync(join(tmpdir(), "sb4-check-race-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const directory = join(root, "late"), source = join(directory, "helper.ts");
    mkdirSync(join(root, "snapback"));
    if (boundary !== "directoryExists") mkdirSync(directory);
    mkdirSync(join(root, "node_modules/typescript"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(root, "node_modules/typescript/package.json"), JSON.stringify({ main: "index.cjs" }));
    writeFileSync(join(root, "node_modules/typescript/index.cjs"), `
const ts = require(${JSON.stringify(require.resolve("typescript"))});
const fs = require("node:fs");
const target = ${JSON.stringify(boundary === "directoryExists" ? directory : source)};
const boundary = ${JSON.stringify(boundary)};
let recovered = false;
function wrap(host) {
  const operation = host[boundary].bind(host);
  host[boundary] = (path, ...args) => {
    const result = operation(path, ...args);
    if (path === target && !result && !recovered) {
      recovered = true;
      fs.mkdirSync(${JSON.stringify(directory)}, { recursive: true });
      fs.writeFileSync(${JSON.stringify(source)}, "export const value = 1;\\n");
    }
    return result;
  };
  return host;
}
module.exports = { ...ts, sys: wrap({ ...ts.sys }), createCompilerHost: (...args) => wrap(ts.createCompilerHost(...args)) };
`);
    // readFile needs a resolvable source: make its first read report absence
    // even though fileExists just saw the file, then replace its contents.
    if (boundary === "readFile") {
      writeFileSync(source, "export const value = 0;\n");
      const shim = join(root, "node_modules/typescript/index.cjs");
      writeFileSync(shim, readFileSync(shim, "utf8").replace(
        "const result = operation(path, ...args);",
        "const result = path === target && !recovered ? undefined : operation(path, ...args);"));
    }
    const entry = join(root, "snapback/server.ts");
    writeFileSync(entry, 'import { value } from "../late/helper.js"; export default value;\n');
    const check = () => spawnSync(process.execPath, ["--input-type=module", "-e", checker, root, entry], { encoding: "utf8", timeout: 30_000 });
    const first = check();
    assert.equal(first.status, 1, first.stderr);
    assert.match(first.stderr, /E_SERVER_TYPECHECK/);
    const observations = new Map(JSON.parse(readFileSync(join(root, "snapback/generated/server-watch.json"), "utf8")));
    if (boundary === "readFile") {
      const actual = statSync(source, { bigint: true });
      assert.notDeepEqual(observations.get(source), [String(actual.mtimeNs), String(actual.size)]);
    } else assert.equal(observations.get(boundary === "directoryExists" ? directory : source), null);
    // The next unchanged tick observes the recovered file/directory and can
    // successfully check; the first failed check must not swallow recovery.
    if (boundary === "readFile") {
      writeFileSync(join(root, "node_modules/typescript/index.cjs"), `module.exports = require(${JSON.stringify(require.resolve("typescript"))});`);
    }
    const second = check();
    assert.equal(second.status, 0, second.stderr);
  });
}
