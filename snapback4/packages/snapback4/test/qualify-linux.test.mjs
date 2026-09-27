import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, json, member, sri, validateLinux } from "../../../scripts/publication-artifacts.mjs";
import { containerRuntime } from "../../../scripts/qualify-linux.mjs";
import { fetchPinned, prootCommand, prootEnvironment } from "../../../scripts/qualify-linux-proot.mjs";
import { prootDistributions } from "../../../scripts/linux-proof-inputs.mjs";
import { proofEntrypoint } from "./helpers/linux-proof-harness.mjs";
function qualify(t, scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), "snapback4-linux-test-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "packages/snapback4", "packages/snapback4-linux-x64", "target/x86_64-unknown-linux-musl/production"]) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ["qualify-linux.mjs", "qualify-linux-proot.mjs", "linux-proof-inputs.mjs", "check-elf.mjs", "publication-artifacts.mjs", "publication-roundtrip.mjs", "build-linux-musl.sh"]) copyFileSync(new URL(`../../../scripts/${file}`, import.meta.url), join(root, "scripts", file));
  writeFileSync(join(root, "scripts/publication-roundtrip.mjs"), proofEntrypoint);
  if (scenario.proot) {
    copyFileSync(join(root, "scripts/qualify-linux-proot.mjs"), join(root, "scripts/qualify-linux-proot-real.mjs"));
    writeFileSync(join(root, "scripts/qualify-linux-proot.mjs"), `
      import { prootProof as realProof } from './qualify-linux-proot-real.mjs';
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { basename, join } from 'node:path';
      export function prootProof(client, platform, version) {
        const cache = ${JSON.stringify(join(root, "cache"))}; mkdirSync(cache);
        return realProof(client, platform, version, cache, input => {
          const path = join(cache, basename(new URL(input.url).pathname)); writeFileSync(path, 'fixture download'); return path;
        });
      }
    `);
  }
  const version = "0.0.0", client = join(root, "client.tgz");
  const manifest = { name: "snapback4", version, optionalDependencies: { "snapback4-darwin-arm64": version, "snapback4-linux-x64": version } };
  writeFileSync(join(root, "packages/snapback4/package.json"), JSON.stringify(manifest));
  writeFileSync(client, "common client");
  writeFileSync(join(root, "packages/snapback4-linux-x64/package.json"), JSON.stringify({ name: "snapback4-linux-x64", version, os: ["linux"], cpu: ["x64"] }));
  writeFileSync(join(root, "packages/snapback4-linux-x64/THIRD-PARTY-NOTICES"), "notices");
  const binary = join(root, "target/x86_64-unknown-linux-musl/production/snapback4"), b = Buffer.alloc(120);
  Buffer.from([127, 69, 76, 70, 2, 1, 1]).copy(b); b.writeUInt16LE(2, 16); b.writeUInt16LE(62, 18); b.writeBigUInt64LE(64n, 32); b.writeUInt16LE(56, 54); b.writeUInt16LE(1, 56); b.writeUInt32LE(scenario.interpreter ? 3 : 1, 64); writeFileSync(binary, b);
  if (scenario.redirectedTarget) {
    const bin = join(root, ".local/bin"); mkdirSync(bin, { recursive: true });
    writeFileSync(join(root, "fresh-binary"), Buffer.concat([b, Buffer.from("built in this invocation")]));
    for (const name of ["cargo", "rustup", "musl-gcc", "node"]) {
      const path = join(bin, name);
      writeFileSync(path, `#!${process.execPath}
import { appendFileSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
const root = ${JSON.stringify(root)}, name = ${JSON.stringify(name)}, args = process.argv.slice(2);
appendFileSync(join(root, 'build-commands.jsonl'), JSON.stringify({ name, args }) + '\\n');
if (name === 'cargo') {
  const index = args.indexOf('--target-dir');
  const target = index < 0 ? process.env.CARGO_TARGET_DIR : args[index + 1];
  const output = join(target, 'x86_64-unknown-linux-musl/production/snapback4');
  mkdirSync(dirname(output), { recursive: true }); copyFileSync(join(root, 'fresh-binary'), output);
}
if (name === 'node') {
  if (args[0].endsWith('check-elf.mjs')) copyFileSync(args[1], join(root, 'inspected-binary'));
  process.stdout.write(execFileSync(${JSON.stringify(process.execPath)}, args));
}
`);
      chmodSync(path, 0o755);
    }
  }
  writeFileSync(join(root, "mock.mjs"), `
import cp from "node:child_process";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProofShell } from ${JSON.stringify(new URL("./helpers/linux-proof-harness.mjs", import.meta.url).pathname)};
import { prootDistributions } from './scripts/linux-proof-inputs.mjs';
const original = cp.execFileSync, root = ${JSON.stringify(root)}, scenario = ${JSON.stringify(scenario)};
os.homedir = () => root;
Object.defineProperty(process, "platform", {value:"linux"}); Object.defineProperty(process,"arch",{value:"x64"});
const log = (cmd,args) => appendFileSync(join(root,"commands.jsonl"), JSON.stringify({cmd,args})+"\\n");
let context, proofIndex = 0;
cp.execFileSync = (cmd,args,opts={}) => {
  log(cmd,args);
  if(cmd === "git") return args[0] === "status" ? "" : "a".repeat(40);
  if(cmd === "tar" && args[1] === ${JSON.stringify(client)}) return JSON.stringify(${JSON.stringify(manifest)});
  if(cmd === "tar" && args[0] === "--extract") {
    mkdirSync(join(args[args.indexOf("--directory") + 1], "etc/apk"), {recursive:true}); return "";
  }
  if(cmd === "tar") return original(cmd,args,opts);
  if(cmd === "bash") return scenario.redirectedTarget ? original(cmd,args,{...opts, env: {...opts.env, HOME: root, CARGO_TARGET_DIR: join(root,"redirected"), SNAPBACK4_MUSL_CC: join(root,".local/bin/musl-gcc")}}) : "";
  if(cmd === "curl") { writeFileSync(args[args.indexOf("--output") + 1], "wrong pinned bytes"); return ""; }
  if(cmd === "npm" && args[0] === "pack") {
    const filename = "snapback4-linux-x64-0.0.0.tgz";
    // Real tar bytes; no registry or package manager is contacted by this fake npm.
    cpSync(opts.cwd, join(root,"package"), {recursive:true});
    original("tar", ["-czf",join(args.at(-1),filename),"-C",root,"package"]);
    return JSON.stringify([{filename}]);
  }
  if(cmd === "docker" || cmd === "podman") {
    if(args[0] === "build") {
      context = args.at(-1);
      const dockerfile = readFileSync(join(args.at(-1), "Dockerfile"), "utf8");
      const configs = [...dockerfile.matchAll(/NPM_CONFIG_(?:USER|GLOBAL)CONFIG=(\\S+)/g)].map(m => m[1]);
      if(configs.length !== 2 || configs[0] === configs[1]) throw Error("npm cannot double-load one config path");
    }
    if(args[0] === "run") {
      const cwd = join(root, "consumer-" + proofIndex++); mkdirSync(cwd);
      runProofShell(original, args.at(-1), {root, cwd, inputs: context, node: "24.13.1", scenario});
    }
    if(args[0] === "image") return "sha256:test-image";
    return "";
  }
  if(cmd.endsWith("/proot")) {
    if(args.at(-1).startsWith("apk add")) return "";
    const bound = target => args.find(a => a.endsWith(':' + target)).split(':')[0];
    runProofShell(original, args.at(-1), {root, cwd: bound('/consumer'), inputs: bound('/proof'), node: prootDistributions[proofIndex++].node, scenario});
    return "";
  }
  if(args[0] === "--version" && cmd.endsWith("/snapback4")) return "snapback4 0.0.0";
  return "toolchain test";
};
cp.spawnSync = (cmd,args,opts={}) => {
  log(cmd,args);
  if(cmd === "bash") { writeFileSync(opts.stdio[1], "== " + (scenario.suiteFail ? 1 : 0) + " failure(s) in 2 s\\n"); return {status: scenario.suiteFail ? 1 : 0}; }
  return {status: scenario.noRuntime || scenario.proot ? 1 : 0};
};
syncBuiltinESMExports();
`);
  const env = { ...process.env }; delete env.NPM_TOKEN; delete env.NODE_AUTH_TOKEN; delete env.SNAPBACK4_BIN;
  const result = spawnSync(process.execPath, ["--import", join(root, "mock.mjs"), join(root, "scripts/qualify-linux.mjs"), "--client", client, "--out", join(root, "out")], { encoding: "utf8", env });
  const receiptPath = join(root, "out/receipt.json");
  return { ...result, root, client, binary, receipt: existsSync(receiptPath) ? json(receiptPath) : null, commands: existsSync(join(root, "commands.jsonl")) ? readFileSync(join(root, "commands.jsonl"), "utf8").trim().split("\n").map(JSON.parse) : [] };
}
test("Linux qualification receipt binds source, toolchain, suite, both container proofs, ELF and both digests", t => {
  const r = qualify(t); assert.equal(r.status, 0, r.stderr);
  const tarball = join(r.root, "out", r.receipt.platform.filename);
  assert.equal(r.receipt.binarySha256, digest(r.binary)); assert.equal(r.receipt.platform.integrity, sri(tarball)); assert.equal(r.receipt.clientIntegrity, sri(r.client));
  validateLinux(r.receipt, tarball, { version: "0.0.0", integrity: sri(r.client) }, "a".repeat(40));
  assert.deepEqual(r.receipt.proofs.map(p => p.base), ["ubuntu:22.04", "alpine"]);
  assert.equal(r.receipt.suite.summary, "== 0 failure(s) in 2 s");
  assert.equal(r.receipt.route, "docker");
  assert.ok(r.receipt.proofs.every(p => p.route === "docker"));
  const packs = r.commands.filter(c => c.cmd === "npm"); assert.equal(packs.length, 1); assert.equal(packs[0].args[0], "pack");
  assert.ok(!r.commands.some(c => ["codesign", "security", "xcrun"].includes(c.cmd)));
  const containers = r.commands.filter(c => c.cmd === "docker" && c.args[0] === "run"); assert.equal(containers.length, 2);
  assert.ok(containers.every(c => !c.args.includes("--volume") && !c.args.includes("-v") && !c.args.includes("--env-file")));
  assertProofsExecuted(r);
});

function assertProofsExecuted(r) {
  const executions = readFileSync(join(r.root, "executed-proofs.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(executions.length, 2);
  for (const events of executions) {
    assert.deepEqual(events.map(e => e.event), ["node-version", "install", "roundtrip"]);
    assert.equal(events[1].clientIntegrity, r.receipt.clientIntegrity);
    assert.equal(events[1].platformIntegrity, r.receipt.platform.integrity);
  }
}

test("redirected CARGO_TARGET_DIR inspects, proves and packs the binary just built", t => {
  const r = qualify(t, { redirectedTarget: true }); assert.equal(r.status, 0, r.stderr);
  const fresh = readFileSync(join(r.root, "fresh-binary"));
  assert.deepEqual(readFileSync(join(r.root, "inspected-binary")), fresh, "the shell ELF check inspected this build");
  assert.deepEqual(member(join(r.root, "out", r.receipt.platform.filename), "snapback4"), fresh, "qualification packed this build");
  assert.equal(r.receipt.binarySha256, digest(join(r.root, "fresh-binary")));
  assert.ok(r.receipt.proofs.every(p => p.platformIntegrity === r.receipt.platform.integrity));
  assertProofsExecuted(r);
  assert.equal(existsSync(join(r.root, "redirected/x86_64-unknown-linux-musl/production/snapback4")), false);
});
for (const scenario of [{ suiteFail: true }, { proofFail: true }, { interpreter: true }, { noRuntime: true }, { proot: true, proofFail: true }, { proot: true, suiteFail: true }])
  test(`qualification never writes a success receipt on ${JSON.stringify(scenario)}`, t => {
    const r = qualify(t, scenario); assert.notEqual(r.status, 0); assert.equal(r.receipt, null);
    assert.ok(!r.commands.some(c => c.cmd === "npm" && c.args[0] === "publish"));
  });

for (const proot of [false, true]) for (const refusal of ["proofFail", "overridePresent", "wrongNode"])
  test(`${proot ? "proot" : "container"} executes the proof guard and propagates ${refusal} without a receipt`, t => {
    const r = qualify(t, { proot, [refusal]: true });
    assert.notEqual(r.status, 0); assert.equal(r.receipt, null);
    if (refusal === "proofFail") assert.match(r.stderr, /deliberately failing consumer entrypoint/);
  });

test("runtime selection prefers working Docker then Podman and falls back to proot", () => {
  for (const [working, expected, calls] of [["docker", "docker", ["docker"]], ["podman", "podman", ["docker", "podman"]], [null, "proot", ["docker", "podman"]]]) {
    const seen = [];
    assert.equal(containerRuntime(name => { seen.push(name); return { status: name === working ? 0 : null }; }), expected);
    assert.deepEqual(seen, calls);
  }
});
test("pinned download and cached bytes refuse mismatch, with no network", t => {
  const cache = mkdtempSync(join(tmpdir(), "snapback4-pins-")); t.after(() => rmSync(cache, { recursive: true, force: true }));
  const original = join(cache, "original"); writeFileSync(original, "verified archive");
  const input = { url: "https://example.invalid/root.tar.gz", sha256: digest(original) };
  assert.throws(() => fetchPinned(input, cache, (_url, path) => writeFileSync(path, "wrong")), /SHA-256 mismatch/);
  const path = fetchPinned(input, cache, (_url, path) => copyFileSync(original, path));
  assert.equal(digest(path), input.sha256);
  const noDownload = () => assert.fail("must not download cached input");
  assert.equal(fetchPinned(input, cache, noDownload), path);
  writeFileSync(path, "corrupt cache");
  assert.throws(() => fetchPinned(input, cache, noDownload), /SHA-256 mismatch/);
});
test("proot binds only disposable inputs, scratch and three devices, with an allowlisted environment", () => {
  const args = prootCommand("/cache/root", "/cache/scratch", "/cache/inputs");
  assert.ok(args.includes("-r") && !args.includes("-R") && !args.includes("-S"));
  assert.deepEqual(args.flatMap((arg, i) => arg === "-b" ? [args[i + 1]] : []),
    ["/cache/scratch:/consumer", "/cache/inputs:/proof", "/dev/null", "/dev/urandom", "/dev/random"]);
  const keys = ["SNAPBACK4_BIN", "NPM_TOKEN", "NODE_AUTH_TOKEN", "NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH", "NPM_CONFIG__AUTHTOKEN"];
  const saved = keys.map(key => [key, process.env[key]]);
  let env;
  try {
    for (const key of keys) process.env[key] = "host-value-that-must-not-enter-the-consumer";
    env = prootEnvironment("/cache/tmp");
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  assert.equal(env.HOME, "/root"); assert.equal(env.PATH, "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  for (const key of keys) assert.ok(!Object.hasOwn(env, key));
  assert.notEqual(env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG);
});
test("proot receipt binds its route, both root filesystems and every pinned tool", t => {
  const r = qualify(t, { proot: true }); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.receipt.route, "proot");
  assert.deepEqual(r.receipt.proofs.map(p => p.rootfs), prootDistributions.map(p => p.rootfs));
  assert.deepEqual(r.receipt.proofs.map(p => p.tools), prootDistributions.map(p => p.tools));
  assertProofsExecuted(r);
  const validate = receipt => validateLinux(receipt, join(r.root, "out", receipt.platform.filename), { version: "0.0.0", integrity: sri(r.client) }, "a".repeat(40));
  validate(r.receipt);
  for (const alter of [r => delete r.route, r => r.route = "docker", r => r.proofs.pop(), r => r.proofs[0].route = "docker",
    r => r.proofs[0].rootfs.sha256 = "0".repeat(64), r => r.proofs[1].rootfs.url += "?changed",
    r => r.proofs[1].tools.pop(), r => r.proofs[0].tools[0].sha256 = "0".repeat(64), r => r.proofs[1].tools[1].url += "?changed",
    r => r.proofs[0].node = "0.0.0", r => r.proofs[1].status = "skipped"]) {
    const modified = structuredClone(r.receipt); alter(modified); assert.throws(() => validate(modified), /successful Ubuntu .* and Alpine proofs/);
  }
});
