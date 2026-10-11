// Every public subpath loads from a CommonJS script (Node 24's require(esm)),
// the way `npm init -y` acceptance and seed scripts load it, and
// `snapback4/bin-path` names the binary the CLI shim runs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("every subpath requires from CommonJS, including bin-path", t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-require-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(root, join(dir, "node_modules/snapback4"), "dir");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "cjs-consumer", type: "commonjs" }));
  writeFileSync(join(dir, "probe.js"), `const out = {};
for (const key of ${JSON.stringify(Object.keys(pkg.exports))}) {
  const spec = "snapback4" + key.slice(1);
  try { out[spec] = Object.keys(require(spec)).sort(); } catch (error) { out[spec] = "FAILED " + (error.code ?? "") + " " + error.message; }
}
out.binary = require("snapback4/bin-path").resolveBinary();
process.stdout.write(JSON.stringify(out));`);
  // React is an optional peer; it is installed here, so ./react is included too.
  const out = JSON.parse(execFileSync(process.execPath, ["probe.js"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_NO_WARNINGS: "1" } }));
  const failed = Object.entries(out).filter(([, value]) => typeof value === "string" && value.startsWith("FAILED"));
  assert.deepEqual(failed, []);
  assert.ok(out["snapback4/client"].includes("createClient"));
  assert.deepEqual(out["snapback4/bin-path"], ["resolveBinary"]);
  assert.ok(existsSync(out.binary), out.binary);
  assert.match(execFileSync(out.binary, ["--version"], { encoding: "utf8" }), /snapback4/);
});
