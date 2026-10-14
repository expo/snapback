import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, json, member, sqliteBuildFlags, sri, validateLinux, validateFrontendProofs, validateStarterProofs } from "../../../scripts/publication-artifacts.mjs";
import { runToolchainCommand, starterCases } from "../../../scripts/publication-starters.mjs";
import { containerRuntime } from "../../../scripts/qualify-linux.mjs";
import { fetchPinned, prootCommand, prootEnvironment } from "../../../scripts/qualify-linux-proot.mjs";
import { prootDistributions } from "../../../scripts/linux-proof-inputs.mjs";
import { proofEntrypoint } from "./helpers/linux-proof-harness.mjs";
function audit(range=[30000,30020]) { return {status:"passed",method:"strace-listen",tracerVersion:"strace -- version 6.16",nonReturned:[],samples:1,listeners:[{pid:1,port:range[0]+1}],range}; }
function qualify(t, scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), "snapback4-linux-test-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "packages/snapback4", "packages/snapback4-linux-x64", "target/x86_64-unknown-linux-musl/production"]) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ["qualify-linux.mjs", "qualify-linux-proot.mjs", "linux-proof-inputs.mjs", "check-elf.mjs", "publication-artifacts.mjs", "publication-roundtrip.mjs", "publication-starters.mjs", "publication-frontend-proofs.mjs", "proof-listener-audit.mjs", "test-command-owner.mjs", "test-owned-command.mjs", "test-command-group.mjs", "build-linux-musl.sh"]) copyFileSync(new URL(`../../../scripts/${file}`, import.meta.url), join(root, "scripts", file));
  writeFileSync(join(root, "scripts/proof-listener-audit.mjs"), `export function requireListenerTracer(){ ${scenario.tracerFail ? "throw Error('E_PROOF_LISTENER: strace 6.8 required')" : "return 'strace -- version 6.16'"} }`);
  writeFileSync(join(root, "scripts/publication-frontend-proofs.mjs"), `
    const audit = ${audit.toString()};
    export async function proveGeneratedProofs(client, platform, expo, out) {
      if (${JSON.stringify(scenario.frontendFail ?? false)}) throw Error('deliberately failing generated frontend proof');
      return ${JSON.stringify(starterCases)}.flatMap(s => [1, 2].map(attempt => ({ starter: s.id, kind: s.kind, attempt, status: 'passed', range: [30000, 30020], occupied: 30000, cpuLoadWorkers: 2, listenerAudit: audit(), logs: out + '/logs' })));
    }
  `);
  writeFileSync(join(root, "scripts/publication-roundtrip.mjs"), proofEntrypoint);
  writeFileSync(join(root, "scripts/publication-starters.mjs"), `
    const audit = ${audit.toString()};
    import { appendFileSync } from 'node:fs';
    export const starterCases = ${JSON.stringify(starterCases)};
    export async function proveStarters() {
      if (${JSON.stringify(scenario.startersFail ?? false)}) throw Error('deliberately failing starter toolchain');
      return starterCases.map(s => ({starter:s.id,kind:s.kind,status:'passed',typecheck:'passed',build:'passed',negativeProof:{status:'passed',listenerAudit:audit()},formSubmit:'passed',frontendProofs:[1,2].map(attempt=>({starter:s.id,kind:s.kind,attempt,status:'passed',range:[30000,30020],occupied:30000,cpuLoadWorkers:2,listenerAudit:audit()})),adaptedProofs:[1,2].map(attempt=>({starter:s.id,kind:s.kind,attempt,status:'passed',range:[30000,30020],occupied:30000,cpuLoadWorkers:2,listenerAudit:audit()}))}));
    }
    if (process.argv[1].endsWith('/starters.mjs')) appendFileSync(process.env.PROOF_EVENTS, JSON.stringify({ event: 'starters' }) + '\\n');
    if (process.env.STARTERS_FAIL === '1') throw Error('deliberately failing starter toolchain');
  `);
  if (scenario.proot) {
    copyFileSync(join(root, "scripts/qualify-linux-proot.mjs"), join(root, "scripts/qualify-linux-proot-real.mjs"));
    writeFileSync(join(root, "scripts/qualify-linux-proot.mjs"), `
      import { prootProof as realProof } from './qualify-linux-proot-real.mjs';
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { basename, join } from 'node:path';
      export function prootProof(client, platform, version, _cache, _fetch, expo) {
        // Set these after Node starts: they must be observed as host environment,
        // never interpreted by the test runner's loader or Node startup.
        const sentinels = {
          NODE_OPTIONS: '--host-node-sentinel', LD_PRELOAD: '/host/loader-sentinel.so',
          LD_LIBRARY_PATH: '/host/library-sentinel', SNAPBACK4_BIN: '/host/binary-sentinel',
          NPM_CONFIG__AUTHTOKEN: 'fake-host-token', AWS_SECRET_ACCESS_KEY: 'fake-host-secret',
          LX_HOST_SENTINEL: 'must-not-reach-proot'
        };
        const saved = Object.fromEntries(Object.keys(sentinels).map(key => [key, process.env[key]]));
        Object.assign(process.env, sentinels);
        const cache = ${JSON.stringify(join(root, "cache"))}; mkdirSync(cache);
        try {
          return realProof(client, platform, version, cache, input => {
            const path = join(cache, basename(new URL(input.url).pathname)); writeFileSync(path, 'fixture download'); return path;
          }, expo);
        } finally {
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
          }
        }
      }
    `);
  }
  const version = "0.0.0", client = join(root, "client.tgz");
  const manifest = { name: "snapback4", version, optionalDependencies: { "snapback4-darwin-arm64": version, "snapback4-linux-x64": version } };
  writeFileSync(join(root, "packages/snapback4/package.json"), JSON.stringify(manifest));
  writeFileSync(client, "common client");
  writeFileSync(join(root, "expo.tgz"), "packed Expo");
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
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
const root = ${JSON.stringify(root)}, name = ${JSON.stringify(name)}, args = process.argv.slice(2);
appendFileSync(join(root, 'build-commands.jsonl'), JSON.stringify({ name, args }) + '\\n');
if (name === 'cargo') {
  assert.equal(process.env.LIBSQLITE3_FLAGS, ${JSON.stringify(sqliteBuildFlags)}, 'Cargo must receive the publication SQLite flags');
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
import assert from "node:assert/strict";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProofShell } from ${JSON.stringify(new URL("./helpers/linux-proof-harness.mjs", import.meta.url).pathname)};
import { prootDistributions } from './scripts/linux-proof-inputs.mjs';
const original = cp.execFileSync, root = ${JSON.stringify(root)}, scenario = ${JSON.stringify(scenario)};
os.homedir = () => root;
Object.defineProperty(process, "platform", {value:scenario.platform ?? "linux"}); Object.defineProperty(process,"arch",{value:scenario.arch ?? "x64"});
const log = (cmd,args) => appendFileSync(join(root,"commands.jsonl"), JSON.stringify({cmd,args})+"\\n");
let context, proofIndex = 0;
cp.execFileSync = (cmd,args,opts={}) => {
  log(cmd,args);
  if(cmd === "git") return args[0] === "status" ? "" : "a".repeat(40);
  if(cmd === "tar" && args[1] === ${JSON.stringify(client)}) return JSON.stringify(${JSON.stringify(manifest)});
  if(cmd === "tar" && args[0] === "--extract") {
    mkdirSync(join(args[args.indexOf("--directory") + 1], "etc/apk"), {recursive:true}); return "";
  }
  if(cmd === "tar" && args[1] === join(root, "expo.tgz")) return JSON.stringify({ name: "snapback4-expo", version: "0.0.0" });
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
    assert.deepEqual(opts.env, {
      PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/root', LANG: 'C.UTF-8',
      TMPDIR: '/tmp', PROOT_TMP_DIR: join(opts.cwd, 'tmp'), PROOT_NO_SECCOMP: '1',
      NPM_CONFIG_USERCONFIG: '/tmp/empty-user.npmrc', NPM_CONFIG_GLOBALCONFIG: '/tmp/empty-global.npmrc',
      NPM_CONFIG_CACHE: '/tmp/npm-cache', NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/'
    }, 'actual proot subprocess environment must equal the allowlist');
    appendFileSync(join(root, 'proot-environments.jsonl'), JSON.stringify({cwd: opts.cwd, env: opts.env}) + "\\n");
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
  // Proot mutation failures may print the forwarded environment: only synthetic
  // host values may enter that subprocess, never this runner's credentials.
  const env = scenario.proot ? { PATH: process.env.PATH, HOME: root } : { ...process.env };
  delete env.NPM_TOKEN; delete env.NODE_AUTH_TOKEN; delete env.SNAPBACK4_BIN;
  // Node canonicalizes import.meta.url, including Darwin's /var -> /private/var.
  // Exercise that entrypoint distinction on every host, with the real CLI guard.
  const entry = join(root, "qualify-link.mjs");
  symlinkSync(join(root, "scripts/qualify-linux.mjs"), entry);
  const result = spawnSync(process.execPath, ["--import", join(root, "mock.mjs"), entry, "--client", client, "--expo", join(root, "expo.tgz"), "--out", join(root, "out"), ...(scenario.consumerOnly ? ["--consumer-only"] : [])], { encoding: "utf8", env });
  const receiptPath = join(root, "out/receipt.json");
  return { ...result, root, client, binary, receipt: existsSync(receiptPath) ? json(receiptPath) : null, commands: existsSync(join(root, "commands.jsonl")) ? readFileSync(join(root, "commands.jsonl"), "utf8").trim().split("\n").map(JSON.parse) : [] };
}
for (const [platform, arch] of [["darwin", "arm64"], ["linux", "arm64"]])
  test(`qualification refuses ${platform}-${arch} before invoking tools`, t => {
    const r = qualify(t, { platform, arch });
    assert.notEqual(r.status, 0); assert.equal(r.receipt, null);
    assert.match(r.stderr, /Linux qualification requires a linux-x64 host/);
    assert.deepEqual(r.commands, []);
  });

test("Linux qualification receipt binds source, toolchain, suite, both container proofs, ELF and both digests", t => {
  const r = qualify(t); assert.equal(r.status, 0, r.stderr);
  const tarball = join(r.root, "out", r.receipt.platform.filename);
  assert.equal(r.receipt.binarySha256, digest(r.binary)); assert.equal(r.receipt.platform.integrity, sri(tarball)); assert.equal(r.receipt.clientIntegrity, sri(r.client));
  assert.deepEqual(r.receipt.frontendProofs.map(p => [p.kind, p.attempt, p.status]), starterCases.flatMap(s => [1,2].map(attempt => [s.kind, attempt, "passed"])));
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
    assert.deepEqual(events.map(e => e.event), ["node-version", "install", "roundtrip", "starters"]);
    assert.deepEqual(events[1].args, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "/proof/client.tgz", "/proof/platform.tgz"]);
    assert.equal(events[1].clientIntegrity, r.receipt.clientIntegrity);
    assert.equal(events[1].platformIntegrity, r.receipt.platform.integrity);
  }
}

test("Cargo receives the SQLite flags and redirected CARGO_TARGET_DIR packs the binary just built", t => {
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

for (const proot of [false, true]) for (const refusal of ["proofFail", "startersFail", "overridePresent", "wrongNode"])
  test(`${proot ? "proot" : "container"} executes the proof guard and propagates ${refusal} without a receipt`, t => {
    const r = qualify(t, { proot, [refusal]: true });
    assert.notEqual(r.status, 0); assert.equal(r.receipt, null);
    if (refusal === "startersFail") assert.match(r.stderr, /deliberately failing starter toolchain/);
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
test("proot invocations use exactly the allowlist despite host sentinels, and bind receipt provenance", t => {
  const r = qualify(t, { proot: true }); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.receipt.route, "proot");
  assert.deepEqual(r.receipt.proofs.map(p => p.rootfs), prootDistributions.map(p => p.rootfs));
  assert.deepEqual(r.receipt.proofs.map(p => p.tools), prootDistributions.map(p => p.tools));
  assertProofsExecuted(r);
  const environments = readFileSync(join(r.root, 'proot-environments.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(environments.length, 3, 'Ubuntu proof, Alpine APK installation and Alpine proof all checked');
  const validate = receipt => validateLinux(receipt, join(r.root, "out", receipt.platform.filename), { version: "0.0.0", integrity: sri(r.client) }, "a".repeat(40));
  validate(r.receipt);
  for (const alter of [r => delete r.route, r => r.route = "docker", r => r.proofs.pop(), r => r.proofs[0].route = "docker",
    r => r.proofs[0].rootfs.sha256 = "0".repeat(64), r => r.proofs[1].rootfs.url += "?changed",
    r => r.proofs[1].tools.pop(), r => r.proofs[0].tools[0].sha256 = "0".repeat(64), r => r.proofs[1].tools[1].url += "?changed",
    r => r.proofs[0].node = "0.0.0", r => r.proofs[1].status = "skipped"]) {
    const modified = structuredClone(r.receipt); alter(modified); assert.throws(() => validate(modified), /successful Ubuntu .* and Alpine proofs/);
  }
});


test("toolchain command custody accepts only zero exits and survives spawn failure", async () => {
  const options = { cwd: process.cwd(), env: process.env, timeout: 5_000 };
  await runToolchainCommand(process.execPath, ["-e", "process.exit(0)"], options);
  await assert.rejects(runToolchainCommand(process.execPath, ["-e", "process.exit(17)"], options), /exited 17/);
  await assert.rejects(runToolchainCommand("/snapback4-no-such-toolchain-command", [], options), /ENOENT/);
});

test("toolchain timeout kills a TERM-ignoring driver and grandchild without a numeric signal from the runner", { timeout: 15_000 }, async t => {
  const cwd = mkdtempSync(join(tmpdir(), "sb4-toolchain-custody-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const pidFile = join(cwd, "grandchild.pid");
  const driver = `
    const {spawn} = require('node:child_process');
    process.on('SIGTERM', () => {});
    spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(()=>{},1000)", process.argv[1]], {stdio:'inherit'});
    setInterval(()=>{},1000);
  `;
  const started = performance.now();
  await assert.rejects(runToolchainCommand(process.execPath, ["-e", driver, pidFile], { cwd, env: process.env, timeout: 500 }), /timed out/);
  assert.ok(performance.now() - started < 10_000, "TERM handling cannot trap the watchdog");
  const pid = Number(readFileSync(pidFile, "utf8"));
  const probe = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8", timeout: 2_000 });
  assert.ok(probe.status === 1 || /^\s*[ZX]/.test(probe.stdout), `grandchild must be gone or dead, not executing: ${probe.stdout}`);
});

test("failed generated frontend proof prevents a Linux qualification receipt", t => {
  const result = qualify(t, { frontendFail: true });
  assert.notEqual(result.status, 0); assert.equal(result.receipt, null);
  assert.match(result.stderr, /deliberately failing generated frontend proof/);
});

test("imported loaded-host proof evidence cannot omit a failed or repeated attempt", () => {
  const evidence = starterCases.flatMap(s => [1, 2].map(attempt => ({ starter: s.id, kind: s.kind, attempt, status: "passed", range: [29040, 29049], occupied: 29040, cpuLoadWorkers: 2, listenerAudit: audit([29040,29049]) })));
  validateFrontendProofs(evidence);
  for (const corrupt of [evidence.map((p,i)=>i===0?{...p,listenerAudit:{...p.listenerAudit,nonReturned:[{pid:1,state:"live",record:"???( <unfinished ...>"}]}}:p), evidence.slice(1), evidence.map((p, i) => i === 3 ? { ...p, attempt: 1 } : p), evidence.map((p, i) => i === 0 ? { ...p, status: "failed" } : p), evidence.map((p,i)=>i===0?{...p,listenerAudit:undefined}:p), evidence.map((p,i)=>i===0?{...p,listenerAudit:{status:"passed",method:"strace-listen",tracerVersion:"strace -- version 6.16",nonReturned:[],samples:1,listeners:[{port:1}]}}:p)]) {
    assert.throws(() => validateFrontendProofs(corrupt), /every generated frontend\/template proof twice/);
  }
});

for (const proot of [false, true]) test(`consumer-only ${proot ? 'proot' : 'container'} proves packed starters without a suite receipt`, t => {
  const r = qualify(t, { consumerOnly: true, proot, suiteFail: true });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.receipt, null);
  const evidence = json(join(r.root, 'out/consumer.json'));
  assert.equal(evidence.publicationQualified, false);
  assert.deepEqual(evidence.suite, { status: 'not-run' });
  validateFrontendProofs(evidence.frontendProofs);
  assert.equal(evidence.proofs.length, 2);
  assert.ok(!r.commands.some(c => c.cmd === 'bash' && c.args.some(a => a.endsWith('/test.sh'))));
  assert.equal(readFileSync(join(r.root, 'executed-proofs.jsonl'), 'utf8').trim().split('\n').length, 2);
});
test('consumer-only refuses a failed packed starter without evidence or receipt', t => {
  const r = qualify(t, { consumerOnly: true, startersFail: true });
  assert.notEqual(r.status, 0); assert.equal(r.receipt, null);
  assert.equal(existsSync(join(r.root, 'out/consumer.json')), false);
});

test('starter toolchain evidence requires the full frontend matrix and adapted Home twice', () => {
  const attempts = s => [1, 2].map(attempt => ({ starter: s.id, kind: s.kind, attempt, status: 'passed', range: [30000, 30020], occupied: 30000, cpuLoadWorkers: 2, listenerAudit: audit() }));
  const evidence = starterCases.map(s => ({starter:s.id,status:'passed',typecheck:'passed',build:'passed',negativeProof:{status:'passed',listenerAudit:audit()},formSubmit:'passed',frontendProofs:attempts(s),adaptedProofs:attempts(s)}));
  validateStarterProofs(evidence);
  for (const corrupt of [evidence.slice(1), evidence.map(s => s.starter === 'expo-chat' ? {...s,frontendProofs:[]} : s), evidence.map(s => s.starter === 'web' ? {...s,adaptedProofs:s.adaptedProofs.slice(1)} : s), evidence.map(s => s.starter === 'expo-social' ? {...s,build:'failed'} : s), evidence.map(s=>s.starter==='web'?{...s,negativeProof:undefined}:s), evidence.map(s=>s.starter==='web'?{...s,formSubmit:'failed'}:s)]) {
    assert.throws(() => validateStarterProofs(corrupt), /proof/);
  }
});

test('listener trace covers short-lived TCP listeners and refuses unresolved, unfinished and out-of-range calls', async t=>{
 const {auditListenerTrace}=await import('../../../scripts/proof-listener-audit.mjs');
 assert.equal(auditListenerTrace('10 listen(4<TCP:[127.0.0.1:30001]>, 511) = 0\n',30000,30020).listeners[0].port,30001);
 assert.throws(()=>auditListenerTrace(`${process.pid} ???( <unfinished ...>\n`,30000,30020),/undecoded live process/);
 assert.throws(()=>auditListenerTrace('10 ???() = 0\n',30000,30020),/unrecognized/);
 assert.equal(auditListenerTrace('99999999 ???( <detached ...>\n10 listen(4<TCP:[127.0.0.1:30001]>, 511) = 0\n',30000,30020).nonReturned[0].state,'absent');
 assert.equal(auditListenerTrace('10 listen(4<TCPv6:[[::1]:30001]>, 511 <unfinished ...>\n10 <... listen resumed>) = 0\n',30000,30020).listeners.length,1);
 for(const trace of ['10 listen(4, 511) = 0\n','10 listen(4<TCP:[127.0.0.1:30001]>, 511 <unfinished ...>\n','10 <... listen resumed>) = 0\n','unrecognized\n','10 listen(4<TCP:[127.0.0.1:40001]>, 511) = 0\n'])assert.throws(()=>auditListenerTrace(trace,30000,30020),/E_PROOF_LISTENER/);
 if(process.platform!=='linux'){t.diagnostic('Actual syscall tracing is Linux-only');return}
 const dir=mkdtempSync(join(tmpdir(),'kit-trace-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const trace=join(dir,'listener.trace');
 const result=spawnSync('strace',['-f','-q','-z','-yy','-e','trace=listen','-e','signal=none','-o',trace,process.execPath,'-e',"const server=require('net').createServer();server.listen(0,'127.0.0.1',()=>server.close())"],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stderr);
 const calls=readFileSync(trace,'utf8');assert.ok(auditListenerTrace(calls,1,65535).listeners.length>0);assert.throws(()=>auditListenerTrace(calls,1,1),/outside/);
});

test('missing supported listener tracer refuses qualification before any build',t=>{
 const result=qualify(t,{consumerOnly:true,tracerFail:true});
 assert.notEqual(result.status,0);assert.match(result.stderr,/strace 6.8/);assert.ok(!result.commands.some(c=>c.cmd==='bash'));
});

test('listener tracer preflight rejects obsolete or malformed decoder versions',async t=>{
 const {requireListenerTracer}=await import('../../../scripts/proof-listener-audit.mjs');
 const dir=mkdtempSync(join(tmpdir(),'kit-tracer-version-')),saved=process.env.PATH;
 t.after(()=>{process.env.PATH=saved;rmSync(dir,{recursive:true,force:true})});process.env.PATH=dir;
 for(const [version,valid] of [['strace -- version 6.7',false],['strace -- version 6.8',true],['not a strace version',false],['strace -- version 6.16',true],['strace -- version 7.0',true]]){
  const binary=join(dir,'strace');writeFileSync(binary,`#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`);chmodSync(binary,0o755);
  if(valid)assert.equal(requireListenerTracer(),version);else assert.throws(requireListenerTracer,/strace 6.8/);
 }
});

test('listener evidence refuses malformed named records and empty or incomplete audits',async()=>{
 const {auditListenerTrace}=await import('../../../scripts/proof-listener-audit.mjs');
 const valid='10 listen(4<TCP:[127.0.0.1:30001]>, 511) = 0\n';
 for(const bad of ['11 listen(4<TCP:[127.0.0.1:30001]>, 511)\n','11 listen(4<TCP:[127.0.0.1:30001]>, 511) = ?\n','11 listen(4<TCP:[127.0.0.1:30001]>, 511 <detached ...>\n','11 listen(4<TCP:[127.0.0.1:30001]>, 511 <unfinished ...>\n11 listen(5<TCP:[127.0.0.1:30001]>, 511 <unfinished ...>\n'])assert.throws(()=>auditListenerTrace(valid+bad,30000,30020),/E_PROOF_LISTENER/);
 const attempts=s=>[1,2].map(attempt=>({starter:s.id,kind:s.kind,attempt,status:'passed',range:[30000,30020],occupied:30000,cpuLoadWorkers:1,listenerAudit:audit()}));
 const evidence=starterCases.map(s=>({starter:s.id,status:'passed',typecheck:'passed',build:'passed',frontendProofs:attempts(s),adaptedProofs:attempts(s),negativeProof:{status:'passed',listenerAudit:audit()},formSubmit:'passed'}));
 validateStarterProofs(evidence);
 for(const change of [a=>({...a,listeners:[]}),a=>({...a,samples:undefined}),a=>({...a,range:[1,2]}),a=>({...a,listeners:[{pid:0,port:30001}]}),a=>({...a,listeners:[{pid:1,port:30001.5}]})]){
  const negative=structuredClone(evidence);negative[0].negativeProof.listenerAudit=change(audit());assert.throws(()=>validateStarterProofs(negative),/proof/);
  const frontend=structuredClone(evidence);frontend[0].frontendProofs[0].listenerAudit=change(audit());assert.throws(()=>validateStarterProofs(frontend),/proof/);
 }
});
