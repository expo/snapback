import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkElf } from "../../../scripts/check-elf.mjs";
import { refuseCredentials, sqliteBuildFlags } from "../../../scripts/publication-artifacts.mjs";
import { elf } from "./helpers/elf-fixture.mjs";

test("the musl shell and publication receipts pin the same SQLite flags", () => {
  const script = readFileSync(new URL("../../../scripts/build-linux-musl.sh", import.meta.url), "utf8");
  assert.equal(script.match(/^export LIBSQLITE3_FLAGS=(.+)$/m)?.[1], sqliteBuildFlags);
});
test("ELF requires executable x64 and rejects interpreter, NEEDED and malformed headers", () => {
  assert.deepEqual(checkElf(elf()), { status: "passed", machine: "x86_64", interpreter: null, needed: [] });
  assert.equal(checkElf(elf([1, 2])).status, "passed", "static PIE dynamic section is allowed");
  assert.throws(() => checkElf(elf([1, 3])), /PT_INTERP/);
  const needed = elf([1, 2]); needed.writeBigUInt64LE(1n, needed.length - 32);
  assert.throws(() => checkElf(needed), /DT_NEEDED/);
  const bad = elf(); bad.writeUInt16LE(183, 18); assert.throws(() => checkElf(bad), /x86_64/);
  assert.throws(() => checkElf(Buffer.alloc(10)), /truncated/);
  const range = elf(); range.writeBigUInt64LE(10000n, 32); assert.throws(() => checkElf(range), /truncated/);
  assert.throws(() => checkElf(elf([0])), /no loadable segment/);
  if (process.platform === "linux") assert.throws(() => checkElf(readFileSync(process.execPath)), /PT_INTERP|DT_NEEDED/);
});

test("Linux package versions and target metadata match the client and Darwin", () => {
  const pkg = (name) => JSON.parse(readFileSync(new URL(`../../${name}/package.json`, import.meta.url)));
  const client = pkg("snapback4"), linux = pkg("snapback4-linux-x64");
  assert.equal(linux.version, client.version); assert.equal(pkg("snapback4-darwin-arm64").version, client.version);
  assert.deepEqual(linux.os, ["linux"]); assert.deepEqual(linux.cpu, ["x64"]);
  assert.deepEqual(client.optionalDependencies, { "snapback4-darwin-arm64": client.version, "snapback4-linux-x64": client.version });
});

test("resolveBinary selects installed linux-x64, then checkout; override still wins", t => {
  const root = mkdtempSync(join(tmpdir(), "snapback4-resolver-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, "packages/snapback4/src"); mkdirSync(pkg, { recursive: true });
  copyFileSync(new URL("../src/resolve-binary.ts", import.meta.url), join(pkg, "resolve-binary.ts"));
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const module = join(pkg, "resolve-binary.ts"), env = { ...process.env }; delete env.SNAPBACK4_BIN;
  const resolve = (arch = "x64", override) => spawnSync(process.execPath, ["--input-type=module", "-e", `Object.defineProperty(process,"platform",{value:"linux"});Object.defineProperty(process,"arch",{value:${JSON.stringify(arch)}}); const {resolveBinary}=await import(${JSON.stringify(module)}); console.log(resolveBinary());`], { encoding: "utf8", env: { ...env, ...(override ? { SNAPBACK4_BIN: override } : {}) } });
  assert.match(resolve().stderr, /darwin-arm64 and linux-x64/);
  const debug = join(root, "target/debug"); mkdirSync(debug, { recursive: true }); writeFileSync(join(debug, "snapback4"), "checkout");
  assert.equal(realpathSync(resolve().stdout.trim()), realpathSync(join(debug, "snapback4")));
  const installed = join(root, "node_modules/snapback4-linux-x64"); mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, "package.json"), '{"name":"snapback4-linux-x64"}'); writeFileSync(join(installed, "snapback4"), "installed");
  assert.equal(realpathSync(resolve().stdout.trim()), realpathSync(join(installed, "snapback4")));
  assert.equal(realpathSync(resolve("x64", join(debug, "snapback4")).stdout.trim()), realpathSync(join(debug, "snapback4")));
});

test("qualification refuses even empty credentials before doing any work", () => {
  for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN"]) for (const value of ["", "dummy"]) {
    assert.throws(() => refuseCredentials({ [key]: value }), new RegExp(key));
    const env = { ...process.env, [key]: value }; delete env.SNAPBACK4_BIN;
    const result = spawnSync(process.execPath, [new URL("../../../scripts/qualify-linux.mjs", import.meta.url).pathname], { encoding: "utf8", env });
    assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(`refuses ${key}`));
    assert.doesNotMatch(result.stderr, /usage:/);
  }
});
