// @ref LLP 3000.011.003.000.000#9-wave-13-saved-version-proofs-day3-2026-10-16 — generated proofs cannot claim success without business evidence or their own build.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cli, command, deploy, rollback, testSource } from "../dist/proof.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
process.env.SNAPBACK4_BIN ??= join(root, "target/debug/snapback4");
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "sb4-day3-proof-"));
  mkdirSync(join(cwd, "node_modules"));
  symlinkSync(join(root, "packages/snapback4"), join(cwd, "node_modules/snapback4"), "dir");
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
test("proof usage guards report actual received values", () => {
  assert.throws(() => deploy("deploy", undefined), /got undefined.*versions\/v1/);
  assert.throws(() => testSource(null), /got null/);
  assert.throws(() => rollback("deploy", {}), /got \{\}/);
});
test("generated day-two proof fails at business placeholder and releases its hosts", async t => {
  const cwd = fixture(t);
  assert.equal((await cli(["init", "--web"], { cwd })).code, 0);
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
  assert.match(pkg.scripts["day2:proof"], /versions\/v1 versions\/v2$/);
  const result = await command(process.execPath, ["scripts/day2-proof.mjs", "versions/v1", "versions/v2"], { cwd, timeoutMs: 60_000 });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /needs a business assertion for v1/);
  assert.doesNotMatch(result.stdout, /day2:proof passed/);
});
test("frontend proof invokes its own build before starting any host", async t => {
  const cwd = fixture(t);
  assert.equal((await cli(["init", "--web"], { cwd })).code, 0);
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
  pkg.scripts.build = "node build.mjs";
  writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
  writeFileSync(join(cwd, "build.mjs"), 'import {mkdirSync,writeFileSync} from "node:fs";mkdirSync("dist");writeFileSync("dist/index.html","fresh build");process.exitCode=17;');
  assert.ok(!existsSync(join(cwd, "dist")));
  const result = await command(process.execPath, ["scripts/frontend-proof.mjs"], { cwd, timeoutMs: 60_000 });
  assert.notEqual(result.code, 0);
  assert.equal(readFileSync(join(cwd, "dist/index.html"), "utf8"), "fresh build");
  assert.match(result.stderr, /frontend:proof build failed/);
});
