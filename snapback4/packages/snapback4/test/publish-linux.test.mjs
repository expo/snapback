import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { publish } from "./helpers/publish-fixture.mjs";
import { elf } from "./helpers/elf-fixture.mjs";
import { artifact, digest, json, linuxRustFlags, nodeVersion, sqliteBuildFlags, sri } from "../../../scripts/publication-artifacts.mjs";
const darwin = "snapback4-darwin-arm64", linux = "snapback4-linux-x64";
function prepared(t) {
  const prepared = publish(t, { args: ["--prepare-client"] });
  assert.equal(prepared.status, 0, prepared.stderr);
  const { root } = prepared, client = json(join(root, "target/publication/client-0.0.0/prepare.json")).client;
  const tarball = join(root, `${linux}-0.0.0.tgz`); writeFileSync(tarball, elf());
  const receipt = {
    format: 1, source: "a".repeat(40), target: "x86_64-unknown-linux-musl", toolchain: { rustc: "rustc test", cc: "musl-gcc test", linker: "musl-gcc" },
    flags: { LIBSQLITE3_FLAGS: sqliteBuildFlags, RUSTFLAGS: linuxRustFlags }, suite: { status: "passed", exitCode: 0, summary: "== 0 failure(s) in 1 s" },
    elf: { status: "passed", machine: "x86_64", interpreter: null, needed: [] }, platform: artifact(tarball, linux, "0.0.0"), binarySha256: digest(tarball), clientIntegrity: client.integrity,
    proofs: ["ubuntu:22.04", "alpine"].map(base => ({ base, runtime: "docker", node: nodeVersion, image: "sha256:qualified-image", status: "passed", clientIntegrity: client.integrity, platformIntegrity: sri(tarball) })),
  };
  receipt.expo = json(join(root, "target/publication/client-0.0.0/prepare.json")).expo;
  for (const proof of receipt.proofs) { proof.expoIntegrity = receipt.expo.integrity; proof.starters = { web: "passed", expo: "passed", adapted: "passed", templates: "passed" }; }
  const path = join(root, "linux.json"); writeFileSync(path, JSON.stringify(receipt));
  return { root, path, tarball, receipt, prepared, args: ["--linux-receipt", path, "--linux-tarball", tarball] };
}
const publications = r => r.commands.filter(c => c.cmd === "npm" && c.args[0] === "publish");

test("a new Darwin-only publication packs only its staged dependency and resumes", t => {
  const r = publish(t, { real: true }); assert.equal(r.status, 0, r.stderr);
  const dir = join(r.root, `target/publication/${darwin}-0.0.0`);
  assert.deepEqual(json(join(dir, "client.tgz")).optionalDependencies, { [darwin]: "0.0.0" });
  assert.deepEqual(Object.keys(json(join(r.root, "registry.json"))).sort(), ["snapback4@0.0.0", `${darwin}@0.0.0`].sort());
  assert.deepEqual(json(join(r.root, "packages/snapback4/package.json")).optionalDependencies, { [darwin]: "0.0.0", [linux]: "0.0.0" }, "source manifest stays unchanged");
  const resumed = publish(t, { resume: true, real: true }, r.root);
  assert.equal(resumed.status, 0, resumed.stderr); assert.equal(publications(resumed).length, 0);
});

test("a prepared two-platform client cannot enter a Darwin-only publication", t => {
  const f = prepared(t), r = publish(t, { real: true }, f.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /optionalDependencies must be exactly/);
  assert.equal(publications(r).length, 0);
});

test("resume refuses a client advertising a platform outside its staged set", t => {
  const first = publish(t); assert.equal(first.status, 0, first.stderr);
  const dir = join(first.root, `target/publication/${darwin}-0.0.0`), path = join(dir, "client.tgz");
  const m = json(path); m.optionalDependencies[linux] = "0.0.0"; writeFileSync(path, JSON.stringify(m));
  const stage = json(join(dir, "resume.json")); stage.client = artifact(path, "snapback4", "0.0.0"); writeFileSync(join(dir, "resume.json"), JSON.stringify(stage));
  const r = publish(t, { resume: true, real: true }, first.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /optionalDependencies must be exactly/); assert.equal(publications(r).length, 0);
});

test("prepare rebuilds wasm then clean client and packs it once, without signing/publishing", t => {
  const { prepared: r } = prepared(t);
  const wasm = r.commands.findIndex(c => c.cmd === "bash" && c.args[0].endsWith("build-wasm.sh"));
  const build = r.commands.findIndex(c => c.cmd === "bun"), pack = r.commands.findIndex(c => c.cmd === "npm" && c.args[0] === "pack");
  assert.ok(wasm >= 0 && wasm < build && build < pack);
  assert.equal(r.commands.filter(c => c.cmd === "npm" && c.args[0] === "pack").length, 2);
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

for (const filename of ["platform.tgz", `${linux}-0.0.0.tgz`, "client.tgz"]) for (const resume of [false, true])
  test(`a ${resume ? "resumed" : "fresh"} stage swapped after proof refuses before any upload: ${filename}`, t => {
    const f = prepared(t);
    if (resume) assert.equal(publish(t, { args: f.args }, f.root).status, 0);
    const r = publish(t, { args: resume ? [] : f.args, resume, real: true, swapAfterProof: filename }, f.root);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /integrity/); assert.equal(publications(r).length, 0);
  });

test("registry-time stage replacement cannot change the private uploaded snapshot", t => {
  const f = prepared(t), r = publish(t, { args: f.args, real: true, requireSnapshot: true, swapOnView: `${linux}-0.0.0.tgz` }, f.root);
  assert.equal(r.status, 0, r.stderr);
  const registry = json(join(f.root, "registry.json"));
  for (const a of r.record.artifacts) assert.equal(registry[`${a.name}@${a.version}`], a.integrity);
  assert.ok(publications(r).every(c => c.args[1].includes("snapback4-publish-snapshot-")));
});

test("snapshot bytes are checked again after registry checks and before upload", t => {
  const f = prepared(t), r = publish(t, { args: f.args, real: true, swapSnapshotOnView: true }, f.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /integrity/); assert.equal(publications(r).length, 0);
});

for (const kind of ["not ELF", "interpreter", "NEEDED"]) test(`import re-derives ${kind} from packed bytes despite a matching receipt claiming static ELF`, t => {
  const f = prepared(t);
  const bytes = kind === "not ELF" ? Buffer.from("linux static binary") : elf([1, kind === "interpreter" ? 3 : 2]);
  if (kind === "NEEDED") bytes.writeBigUInt64LE(1n, bytes.length - 32);
  writeFileSync(f.tarball, bytes);
  f.receipt.platform = artifact(f.tarball, linux, "0.0.0"); f.receipt.binarySha256 = digest(f.tarball);
  for (const proof of f.receipt.proofs) proof.platformIntegrity = f.receipt.platform.integrity;
  writeFileSync(f.path, JSON.stringify(f.receipt));
  const r = publish(t, { args: f.args, real: true }, f.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /ELF qualification/); assert.equal(publications(r).length, 0);
  assert.ok(!r.commands.some(c => c.cmd === "codesign" || c.cmd.includes("linux-x64")));
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
  ["missing Expo artifact", r => delete r.expo, /packed Expo proof artifact/],
  ["Expo SRI", r => r.expo.integrity = "sha512-" + "A".repeat(86) + "==", /different Expo SRI/],
  ["missing starter proof", r => delete r.proofs[0].starters, /Ubuntu 22.04 and Alpine/],
  ["Expo export", r => r.proofs[1].starters.expo = "failed", /Ubuntu 22.04 and Alpine/],
  ["web build", r => r.proofs[0].starters.web = "failed", /Ubuntu 22.04 and Alpine/],
  ["adapted build", r => r.proofs[1].starters.adapted = "failed", /Ubuntu 22.04 and Alpine/],
  ["template builds", r => r.proofs[0].starters.templates = "failed", /Ubuntu 22.04 and Alpine/],
  ["proof Expo", r => r.proofs[0].expoIntegrity = "wrong", /Ubuntu 22.04 and Alpine/],
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

test("format-2 layout with retained Expo proof bytes resumes without a Linux receipt", t => {
  const first = publish(t); assert.equal(first.status, 0, first.stderr);
  const path = join(first.root, `target/publication/${darwin}-0.0.0/resume.json`), stage = json(path), platform = stage.platforms[0];
  writeFileSync(path, JSON.stringify({ ...stage, ...platform, version: stage.version, platform: darwin, format: 2, platformArtifact: platform }));
  const r = publish(t, { resume: true, deps: { [darwin]: "0.0.0" } }, first.root);
  assert.equal(r.status, 0, r.stderr);
});


test("historical stages without Expo proof bytes refuse without deleting artifacts or uploading", t => {
  const first = publish(t); assert.equal(first.status, 0, first.stderr);
  const directory = join(first.root, `target/publication/${darwin}-0.0.0`);
  const path = join(directory, "resume.json"), stage = json(path), platform = stage.platforms[0];
  delete stage.expo;
  writeFileSync(path, JSON.stringify({ ...stage, ...platform, version: stage.version, platform: darwin, format: 2, platformArtifact: platform }));
  const before = readFileSync(join(directory, "platform.tgz"));
  const r = publish(t, { resume: true }, first.root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /stage predates starter qualification/);
  assert.equal(publications(r).length, 0);
  assert.deepEqual(readFileSync(join(directory, "platform.tgz")), before);
});

test('publication refuses an announced flag missing from verb help before any upload', t => {
  const r=publish(t,{real:true,omitSchemaHelp:true});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/deploy --help omits announced --schema/);
  assert.equal(publications(r).length,0);
});

test('resume checks installed help against the installed changelog before uploads', t => {
  const first=publish(t);
  assert.equal(first.status,0,first.stderr);
  const resumed=publish(t,{resume:true,real:true,omitSchemaHelp:true},first.root);
  assert.notEqual(resumed.status,0);
  assert.match(resumed.stderr,/deploy --help omits announced --schema/);
  assert.equal(publications(resumed).length,0);
});
