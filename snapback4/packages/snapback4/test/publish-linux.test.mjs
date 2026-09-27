import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { publish } from "./helpers/publish-fixture.mjs";
import { artifact, digest, json, linuxRustFlags, nodeVersion, sqliteBuildFlags, sri } from "../../../scripts/publication-artifacts.mjs";
const darwin = "snapback4-darwin-arm64", linux = "snapback4-linux-x64";
function prepared(t) {
  const prepared = publish(t, { args: ["--prepare-client"] });
  assert.equal(prepared.status, 0, prepared.stderr);
  const { root } = prepared, client = json(join(root, "target/publication/client-0.0.0/prepare.json")).client;
  const tarball = join(root, `${linux}-0.0.0.tgz`); writeFileSync(tarball, "linux static binary");
  const receipt = {
    format: 1, source: "a".repeat(40), target: "x86_64-unknown-linux-musl", toolchain: { rustc: "rustc test", cc: "musl-gcc test", linker: "musl-gcc" },
    flags: { LIBSQLITE3_FLAGS: sqliteBuildFlags, RUSTFLAGS: linuxRustFlags }, suite: { status: "passed", exitCode: 0, summary: "== 0 failure(s) in 1 s" },
    elf: { status: "passed", machine: "x86_64", interpreter: null, needed: [] }, platform: artifact(tarball, linux, "0.0.0"), binarySha256: digest(tarball), clientIntegrity: client.integrity,
    proofs: ["ubuntu:22.04", "alpine"].map(base => ({ base, runtime: "docker", node: nodeVersion, image: "sha256:qualified-image", status: "passed", clientIntegrity: client.integrity, platformIntegrity: sri(tarball) })),
  };
  const path = join(root, "linux.json"); writeFileSync(path, JSON.stringify(receipt));
  return { root, path, tarball, receipt, prepared, args: ["--linux-receipt", path, "--linux-tarball", tarball] };
}
const publications = r => r.commands.filter(c => c.cmd === "npm" && c.args[0] === "publish");

test("prepare rebuilds wasm then clean client and packs it once, without signing/publishing", t => {
  const { prepared: r } = prepared(t);
  const wasm = r.commands.findIndex(c => c.cmd === "bash" && c.args[0].endsWith("build-wasm.sh"));
  const build = r.commands.findIndex(c => c.cmd === "bun"), pack = r.commands.findIndex(c => c.cmd === "npm" && c.args[0] === "pack");
  assert.ok(wasm >= 0 && wasm < build && build < pack);
  assert.equal(r.commands.filter(c => c.cmd === "npm" && c.args[0] === "pack").length, 1);
  assert.ok(!r.commands.some(c => ["codesign", "security", "xcrun"].includes(c.cmd))); assert.equal(publications(r).length, 0);
});

test("publish imports exact Linux bytes and publishes both platforms before the common client", t => {
  const f = prepared(t), r = publish(t, { args: f.args, real: true }, f.root);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(publications(r).map(c => c.args[1].split("/").at(-1)), ["platform.tgz", `${linux}-0.0.0.tgz`, "client.tgz"]);
  assert.equal(r.commands.filter(c => c.cmd === "npm" && c.args[0] === "pack").length, 1, "only Darwin is packed after prepare");
  assert.equal(r.record.artifacts.length, 3);
  assert.ok(!r.commands.some(c => c.cmd.includes("linux-x64") || c.cmd.includes("musl") || c.cmd === "docker"));
  assert.equal(r.record.artifacts[1].signing, undefined);
  assert.equal(r.record.artifacts[0].proof.clientIntegrity, r.record.artifacts[2].integrity);
});

test("resume rereads Linux receipt, verifies all bytes, reruns only Darwin, and converges missing client", t => {
  const f = prepared(t), first = publish(t, { args: f.args, real: true, failClientPublish: true }, f.root);
  assert.notEqual(first.status, 0); assert.equal(publications(first).length, 3);
  const r = publish(t, { resume: true, real: true, suiteRed: true }, f.root);
  assert.equal(r.status, 0, r.stderr); assert.equal(publications(r).length, 1); assert.match(publications(r)[0].args[1], /client.tgz$/);
  assert.ok(!r.commands.some(c => ["bash", "bun", "cargo", "docker", "podman"].includes(c.cmd) || c.args[0] === "pack"));
  assert.ok(r.commands.some(c => c.cmd === "codesign"));
  assert.ok(!r.commands.some(c => c.cmd.includes("linux-x64")));
});

for (const [name, change, message] of [
  ["source", r => r.source = "b".repeat(40), /source\/version\/platform/],
  ["version", r => r.platform.version = "0.0.1", /source\/version\/platform/],
  ["target", r => r.target = "x86_64-unknown-linux-gnu", /target\/toolchain/],
  ["compiler", r => delete r.toolchain.cc, /target\/toolchain/],
  ["static CRT flags", r => r.flags.RUSTFLAGS = "", /target\/toolchain/],
  ["SQLite flags", r => r.flags.LIBSQLITE3_FLAGS = "", /SQLite flags/],
  ["suite", r => r.suite.status = "failed", /successful suite/],
  ["suite exit", r => r.suite.exitCode = 1, /successful suite/],
  ["suite summary", r => r.suite.summary = "== 1 failure(s) in 1 s", /successful suite/],
  ["client SRI", r => r.clientIntegrity = "sha512-other", /different client SRI/],
  ["platform SRI", r => r.platform.integrity = "sha512-other", /receipt SRI/],
  ["Ubuntu proof", r => r.proofs[0].status = "failed", /Ubuntu 22.04 and Alpine/],
  ["Alpine proof", r => r.proofs.pop(), /Ubuntu 22.04 and Alpine/],
  ["Node pin", r => r.proofs[1].node = "latest", /pinned Node/],
  ["proof client", r => r.proofs[1].clientIntegrity = "wrong", /bound to both artifacts/],
  ["proof platform", r => r.proofs[0].platformIntegrity = "wrong", /bound to both artifacts/],
  ["ELF interpreter", r => r.elf.interpreter = "/lib/ld.so", /no interpreter/],
  ["ELF NEEDED", r => r.elf.needed.push("libc.so"), /no NEEDED/],
  ["binary sha256", r => r.binarySha256 = "0".repeat(64), /binary.*sha256/],
]) test(`staging refuses mismatched Linux ${name} before signing or registry writes`, t => {
  const f = prepared(t); change(f.receipt); writeFileSync(f.path, JSON.stringify(f.receipt));
  const r = publish(t, { args: f.args, real: true }, f.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, message);
  assert.equal(publications(r).length, 0); assert.ok(!r.commands.some(c => c.cmd === "codesign"));
});

for (const name of ["platform.tgz", `${linux}-0.0.0.tgz`, "client.tgz", "linux-receipt.json"]) test(`resume refuses tampered ${name}`, t => {
  const f = prepared(t), first = publish(t, { args: f.args }, f.root); assert.equal(first.status, 0, first.stderr);
  appendFileSync(join(f.root, `target/publication/${darwin}-0.0.0`, name), "tampered");
  const r = publish(t, { resume: true, real: true }, f.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /integrity/); assert.equal(publications(r).length, 0);
});

test("resume validates Linux qualification even when receipt integrity is updated", t => {
  const f = prepared(t); assert.equal(publish(t, { args: f.args }, f.root).status, 0);
  const dir = join(f.root, `target/publication/${darwin}-0.0.0`), path = join(dir, "linux-receipt.json"), receipt = json(path);
  receipt.proofs[1].status = "failed"; writeFileSync(path, JSON.stringify(receipt));
  const stage = json(join(dir, "resume.json")); stage.platforms[1].receiptIntegrity = sri(path); writeFileSync(join(dir, "resume.json"), JSON.stringify(stage));
  const r = publish(t, { resume: true, real: true }, f.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /Ubuntu 22.04 and Alpine/); assert.equal(publications(r).length, 0);
});

for (const name of [linux, "snapback4"]) test(`registry conflict on ${name} refuses before publishing either platform`, t => {
  const f = prepared(t), r = publish(t, { args: f.args, real: true, registry: { [`${name}@0.0.0`]: "sha512-conflict" } }, f.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /already exists with integrity/); assert.equal(publications(r).length, 0);
});

for (const deps of [{ [darwin]: "0.0.0" }, { [darwin]: "0.0.0", [linux]: "0.0.1" }, { [darwin]: "0.0.0", [linux]: "0.0.0", "snapback4-linux-arm64": "0.0.0" }])
  test(`packed optionalDependencies refuse ${JSON.stringify(deps)}`, t => {
    const r = publish(t, { args: ["--prepare-client"], deps }); assert.notEqual(r.status, 0); assert.match(r.stderr, /optionalDependencies must be exactly/);
  });

test("new stage refuses dirty source and a prepared client from another commit", t => {
  const dirty = publish(t, { dirty: true }); assert.notEqual(dirty.status, 0); assert.match(dirty.stderr, /source is dirty/);
  const f = prepared(t), r = publish(t, { args: f.args, source: "b".repeat(40) }, f.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /prepared client source differs/);
});

test("format-2 Darwin-only stages still resume without a Linux receipt", t => {
  const first = publish(t); assert.equal(first.status, 0, first.stderr);
  const path = join(first.root, `target/publication/${darwin}-0.0.0/resume.json`), stage = json(path), platform = stage.platforms[0];
  writeFileSync(path, JSON.stringify({ ...stage, ...platform, version: stage.version, platform: darwin, format: 2, platformArtifact: platform }));
  const r = publish(t, { resume: true, deps: { [darwin]: "0.0.0" } }, first.root);
  assert.equal(r.status, 0, r.stderr);
});
