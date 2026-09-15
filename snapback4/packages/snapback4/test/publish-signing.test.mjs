import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scripts = new URL("../../../scripts/", import.meta.url);
const authority = "Developer ID Application: Charles Cheever (UD2ZVW5WU5)";
const platform = "snapback4-darwin-arm64";

// Run the real publisher in a disposable package tree. Tool responses replace
// Cargo, npm and Apple's services; signature bytes must still survive packing.
function publish(t, scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), "snapback4-signing-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "packages/snapback4", `packages/${platform}`, "target/production"])
    mkdirSync(join(root, dir), { recursive: true });
  for (const file of ["publish.mjs", "signing.mjs"]) {
    if (existsSync(new URL(file, scripts))) copyFileSync(new URL(file, scripts), join(root, "scripts", file));
  }
  for (const dir of ["snapback4", platform])
    writeFileSync(join(root, "packages", dir, "package.json"), JSON.stringify({ version: "0.0.0" }));
  writeFileSync(join(root, "target/production/snapback4"), "unsigned");
  writeFileSync(join(root, "packages", platform, "THIRD-PARTY-NOTICES"), "notices");
  writeFileSync(join(root, "mock.mjs"), `
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = ${JSON.stringify(root)}, scenario = ${JSON.stringify(scenario)};
Object.defineProperty(process, "platform", { value: "darwin" });
Object.defineProperty(process, "arch", { value: "arm64" });
const binary = join(root, "target/production/snapback4");
const platform = "snapback4-" + process.platform + "-" + process.arch;
const work = join(root, "pack");
mkdirSync(work);
// Keep publisher scratch files inside the fixture, including its tarballs.
import os from "node:os";
os.tmpdir = () => work;
cp.execFileSync = (cmd, args, opts = {}) => {
  appendFileSync(join(root, "commands.jsonl"), JSON.stringify({ cmd, args }) + "\\n");
  if (cmd === "bash") { if (scenario.suiteRed) throw Error("suite red"); return ""; }
  if (cmd === "cargo") return JSON.stringify({ reason: "compiler-artifact", target: { name: "snapback4", kind: ["bin"] }, executable: binary, profile: {} });
  if (cmd === "security") {
    if (scenario.keychainError) throw Error("keychain unavailable");
    return scenario.identities ?? '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "${authority}"\\n  1 valid identities found';
  }
  if (cmd === "codesign") {
    if (args.includes("--sign")) {
      if (scenario.signError) throw Error("timestamp server unavailable");
      appendFileSync(args.at(-1), "-signed");
    }
    if (args.includes("--verify") && (scenario.verifyError || (scenario.installedVerifyError && args.at(-1).includes("node_modules/")))) throw Error("invalid signature");
    if (args.includes("--display") && scenario.replaceArtifact) writeFileSync(binary, "replacement-unsigned");
    if (args.includes("--display")) return scenario.signature ?? "Authority=${authority}\\nTeamIdentifier=UD2ZVW5WU5\\n";
    return "";
  }
  if (cmd === "ditto") { writeFileSync(args.at(-1), "zip"); return ""; }
  if (cmd === "xcrun") {
    const result = JSON.stringify({ id: "submission-123", status: scenario.notaryStatus ?? "Accepted" });
    if (scenario.notaryError) throw Object.assign(Error("notarytool failed"), { stdout: result });
    return scenario.notaryOutput ?? result;
  }
  if (cmd === "npm" && args[0] === "pack") {
    const filename = opts.cwd.includes(platform) ? "platform.tgz" : "client.tgz";
    writeFileSync(join(args.at(-1), filename), filename === "platform.tgz" ? readFileSync(join(opts.cwd, "snapback4")) : "package");
    return JSON.stringify([{ filename, entryCount: 1 }]);
  }
  if (cmd === "npm" && args[0] === "install") {
    const dir = join(opts.cwd, "node_modules", platform);
    mkdirSync(dir, { recursive: true });
    copyFileSync(args[4], join(dir, "snapback4"));
    if (scenario.tamper) appendFileSync(join(dir, "snapback4"), "-tampered");
  }
  if (args[0] === "--version") return "snapback4 0.0.0";
  if (cmd === "node") return "consumer ok";
  return "";
};
cp.spawnSync = (cmd, args, opts) => ({ status: scenario.displayError ? 1 : 0, stdout: "", stderr: cp.execFileSync(cmd, args, opts) });
syncBuiltinESMExports();
`);
  const env = { ...process.env };
  delete env.SNAPBACK4_SIGN_IDENTITY;
  delete env.SNAPBACK4_NOTARY_PROFILE;
  Object.assign(env, scenario.env);
  const result = spawnSync(process.execPath, ["--import", join(root, "mock.mjs"), join(root, "scripts/publish.mjs"), "--dry-run"], { cwd: root, encoding: "utf8", env });
  const commands = readFileSync(join(root, "commands.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const metrics = join(root, "metrics/publish.jsonl");
  return { ...result, commands, record: existsSync(metrics) ? JSON.parse(readFileSync(metrics, "utf8").trim()) : null };
}

test("dry-run signs before packing and proves the installed signed bytes", (t) => {
  const r = publish(t);
  assert.equal(r.status, 0, r.stderr);
  const sign = r.commands.findIndex(c => c.cmd === "codesign" && c.args.includes("--sign"));
  const verify = r.commands.findIndex(c => c.cmd === "codesign" && c.args.includes("--verify"));
  const pack = r.commands.findIndex(c => c.cmd === "npm" && c.args[0] === "pack");
  assert.ok(sign >= 0 && verify > sign && pack > verify, "sign and verify before packing");
  assert.deepEqual(r.commands[sign].args.slice(0, -1), ["--force", "--sign", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--options", "runtime", "--timestamp"]);
  assert.deepEqual(r.commands[verify].args.slice(0, -1), ["--verify", "--strict", "--verbose=2"]);
  assert.equal(r.record.signingAuthority, authority);
  assert.equal(r.record.signingTeamId, "UD2ZVW5WU5");
  assert.equal(r.record.notarized, false);
  assert.equal(r.record.notarySubmissionId, null);
  assert.equal(r.record.binaryBytes, Buffer.byteLength("unsigned-signed"));
  assert.match(r.stdout, /^publish: snapback4 0.0.0 is signed but NOT notarized \(set SNAPBACK4_NOTARY_PROFILE\)$/m);
  assert.ok(r.commands.some(c => c.cmd.includes("node_modules/.bin/snapback4") && c.args[0] === "--version"));
  assert.ok(!r.commands.some(c => c.cmd === "npm" && c.args[0] === "publish"));
});

test("explicit signing identity resolves an ambiguous keychain without discovery", (t) => {
  const r = publish(t, { keychainError: true, env: { SNAPBACK4_SIGN_IDENTITY: authority } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.commands.find(c => c.cmd === "codesign" && c.args.includes("--sign"))?.args[2], authority);
  assert.ok(!r.commands.some(c => c.cmd === "security"));
});

for (const [name, scenario, message] of [
  ["missing identity", { identities: "0 valid identities found" }, /no Developer ID Application identity/],
  ["ambiguous identities", { identities: `1) ${"A".repeat(40)} "${authority}"\n2) ${"B".repeat(40)} "Developer ID Application: Another (OTHER)"` }, /multiple Developer ID Application identities/],
  ["keychain failure", { keychainError: true }, /keychain unavailable/],
  ["signing failure", { signError: true }, /timestamp server unavailable/],
  ["verification failure", { verifyError: true }, /invalid signature/],
  ["signature inspection failure", { displayError: true }, /codesign display failed/],
  ["non Developer ID signature", { signature: "Signature=adhoc\nTeamIdentifier=not set\n" }, /Developer ID Application authority and team id/],
]) test(`publish refuses ${name} before packing`, (t) => {
  const r = publish(t, scenario);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, message);
  assert.ok(!r.commands.some(c => c.cmd === "npm"));
  assert.equal(r.record, null);
});

test("Accepted notarization records the submission and precedes packing", (t) => {
  const r = publish(t, { env: { SNAPBACK4_NOTARY_PROFILE: "publisher" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.record.notarized, true);
  assert.equal(r.record.notarySubmissionId, "submission-123");
  const submit = r.commands.findIndex(c => c.cmd === "xcrun");
  assert.ok(submit >= 0 && submit < r.commands.findIndex(c => c.cmd === "npm"));
  assert.deepEqual(r.commands[submit].args.slice(0, 2), ["notarytool", "submit"]);
  assert.deepEqual(r.commands[submit].args.slice(3), ["--keychain-profile", "publisher", "--wait", "--output-format", "json"]);
  assert.doesNotMatch(r.stdout, /NOT notarized/);
});

for (const scenario of [{ notaryStatus: "Invalid" }, { notaryStatus: "In Progress" }, { notaryError: true, notaryStatus: "Invalid" }])
  test(`notarization refuses ${JSON.stringify(scenario)} with the log id`, (t) => {
    const r = publish(t, { ...scenario, env: { SNAPBACK4_NOTARY_PROFILE: "publisher" } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /submission-123/);
    assert.ok(!r.commands.some(c => c.cmd === "npm"));
    assert.equal(r.record, null);
  });

test("notarization refuses malformed responses and acceptance without a submission id", (t) => {
  for (const notaryOutput of ["not JSON", '{"status":"Accepted"}']) {
    const r = publish(t, { notaryOutput, env: { SNAPBACK4_NOTARY_PROFILE: "publisher" } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /notarization refused:.*log id unavailable/);
    assert.ok(!r.commands.some(c => c.cmd === "npm"));
  }
});

test("a red suite still refuses before signing", (t) => {
  const r = publish(t, { suiteRed: true });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the suite is red/);
  assert.deepEqual(r.commands.map(c => c.cmd), ["bash"]);
});

test("the installed digest still refuses tampering after signing", (t) => {
  const r = publish(t, { tamper: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /packed\/installed platform binary differs/);
  assert.equal(r.record, null);
});

test("replacing Cargo output after verification cannot replace packed signed bytes", t => {
  const r = publish(t, { replaceArtifact: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.record.binaryBytes, Buffer.byteLength("unsigned-signed"));
  assert.equal(r.record.binarySha256, createHash("sha256").update("unsigned-signed").digest("hex"));
  const verifies = r.commands.filter(c => c.cmd === "codesign" && c.args.includes("--verify"));
  assert.ok(verifies.some(c => c.args.at(-1).includes("node_modules/")), "verify the installed signature");
  assert.ok(verifies.every(c => !c.args.at(-1).includes("target/production")), "verify private staged bytes");
});

test("the installed consumer signature must verify even with a matching digest", t => {
  const r = publish(t, { installedVerifyError: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /invalid signature/);
  assert.equal(r.record, null);
});
