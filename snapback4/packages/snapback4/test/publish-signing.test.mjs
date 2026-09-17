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
function publish(t, scenario = {}, previousRoot) {
  const root = previousRoot ?? mkdtempSync(join(tmpdir(), "snapback4-signing-test-"));
  if (!previousRoot) {
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const dir of ["scripts", "packages/snapback4", `packages/${platform}`, "target/production"]) mkdirSync(join(root, dir), { recursive: true });
    for (const file of ["publish.mjs", "signing.mjs"]) if (existsSync(new URL(file, scripts))) copyFileSync(new URL(file, scripts), join(root, "scripts", file));
    for (const dir of ["snapback4", platform]) writeFileSync(join(root, "packages", dir, "package.json"), JSON.stringify({ version: "0.0.0" }));
    writeFileSync(join(root, "target/production/snapback4"), "unsigned");
    writeFileSync(join(root, "packages", platform, "THIRD-PARTY-NOTICES"), "notices");
  }
  writeFileSync(join(root, "commands.jsonl"), "");
  if (scenario.registry) writeFileSync(join(root, "registry.json"), JSON.stringify(scenario.registry));
  writeFileSync(join(root, "mock.mjs"), `
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const root = ${JSON.stringify(root)}, scenario = ${JSON.stringify(scenario)};
Object.defineProperty(process, "platform", { value: "darwin" });
Object.defineProperty(process, "arch", { value: "arm64" });
const binary = join(root, "target/production/snapback4");
const platform = "snapback4-" + process.platform + "-" + process.arch;
const work = join(root, "pack");
const registryPath = join(root, "registry.json");
mkdirSync(work, { recursive: true });
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
  if (cmd === "npm" && args[0] === "publish") {
    const tarball = args[1];
    if (scenario.failClientPublish && tarball.endsWith("client.tgz")) throw Error("registry unavailable after platform publish");
    const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : {};
    const name = tarball.endsWith("platform.tgz") ? platform : "snapback4";
    registry[name + "@0.0.0"] = "sha512-" + createHash("sha512").update(readFileSync(tarball)).digest("base64");
    writeFileSync(registryPath, JSON.stringify(registry));
    return "published";
  }
  if (args[0] === "--version") return "snapback4 0.0.0";
  if (cmd === "node") return "consumer ok";
  return "";
};
cp.spawnSync = (cmd, args, opts) => {
  if (cmd === "npm" && args[0] === "view") {
    if (scenario.registryError) return { status: 1, stdout: "", stderr: "E500 registry unavailable" };
    const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : {};
    const value = registry[args[1]];
    return value ? { status: 0, stdout: JSON.stringify(value), stderr: "" } : { status: 1, stdout: "", stderr: "npm ERR! code E404" };
  }
  try { return { status: scenario.displayError ? 1 : 0, stdout: "", stderr: cp.execFileSync(cmd, args, opts) }; }
  catch (error) { return { status: 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message }; }
};
syncBuiltinESMExports();
`);
  const env = { ...process.env };
  delete env.SNAPBACK4_SIGN_IDENTITY;
  delete env.SNAPBACK4_NOTARY_PROFILE;
  Object.assign(env, scenario.env);
  const argv = ["--import", join(root, "mock.mjs"), join(root, "scripts/publish.mjs")];
  if (!scenario.real) argv.push("--dry-run");
  if (scenario.resume) argv.push("--resume");
  const result = spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8", env });
  const commands = readFileSync(join(root, "commands.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const metrics = join(root, "metrics/publish.jsonl");
  const records = existsSync(metrics) ? readFileSync(metrics, "utf8").trim().split("\n").filter(Boolean) : [];
  return { ...result, root, commands, record: records.length ? JSON.parse(records.at(-1)) : null };
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

test("publication resumes the exact staged pair after platform success and client failure", t => {
  const first = publish(t, { real: true, failClientPublish: true });
  assert.notEqual(first.status, 0);
  assert.match(first.stderr, /registry unavailable after platform publish/);
  assert.equal(first.commands.filter(c => c.cmd === "npm" && c.args[0] === "publish").length, 2);
  const retry = publish(t, { real: true, resume: true }, first.root);
  assert.equal(retry.status, 0, retry.stderr);
  const publishes = retry.commands.filter(c => c.cmd === "npm" && c.args[0] === "publish");
  assert.equal(publishes.length, 1);
  assert.ok(publishes[0].args[1].endsWith("client.tgz"));
  assert.match(retry.stdout, /snapback4-darwin-arm64@0\.0\.0 already matches staged artifact/);
  assert.ok(!retry.commands.some(c => c.cmd === "cargo"), "resume requalifies exact tarballs without rebuilding different signed bytes");
  assert.ok(retry.commands.some(c => c.cmd.includes("node_modules/.bin/snapback4")), "resume repeats installed-consumer qualification");
});

test("matching registry artifacts converge without republishing", t => {
  const first = publish(t, { real: true });
  assert.equal(first.status, 0, first.stderr);
  const retry = publish(t, { real: true, resume: true }, first.root);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.commands.filter(c => c.cmd === "npm" && c.args[0] === "publish").length, 0);
  assert.match(retry.stdout, /snapback4@0\.0\.0 already matches staged artifact/);
});

test("publication refuses a registry artifact whose integrity differs", t => {
  const staged = publish(t);
  assert.equal(staged.status, 0, staged.stderr);
  const mismatch = publish(t, { real: true, resume: true, registry: { [`${platform}@0.0.0`]: "sha512-wrong" } }, staged.root);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /already exists with integrity sha512-wrong/);
  assert.ok(!mismatch.commands.some(c => c.cmd === "npm" && c.args[0] === "publish"));
});

test("publication fails closed on non-404 registry errors", t => {
  const staged = publish(t);
  assert.equal(staged.status, 0, staged.stderr);
  const failed = publish(t, { real: true, resume: true, registryError: true }, staged.root);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /npm view .* failed.*E500 registry unavailable/s);
  assert.ok(!failed.commands.some(c => c.cmd === "npm" && c.args[0] === "publish"));
});

test("an existing stage requires explicit resume instead of silently publishing stale bytes", t => {
  const staged = publish(t);
  assert.equal(staged.status, 0, staged.stderr);
  const ordinary = publish(t, { real: true }, staged.root);
  assert.notEqual(ordinary.status, 0);
  assert.match(ordinary.stderr, /pass --resume to requalify and converge those exact bytes/);
  assert.ok(!ordinary.commands.some(c => c.cmd === "cargo" || (c.cmd === "npm" && c.args[0] === "publish")));
});
