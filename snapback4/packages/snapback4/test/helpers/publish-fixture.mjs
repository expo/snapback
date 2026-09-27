import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scripts = new URL("../../../../scripts/", import.meta.url);
const authority = "Developer ID Application: Charles Cheever (UD2ZVW5WU5)";
const platform = "snapback4-darwin-arm64";

// Run the real publisher in a disposable package tree. Tool responses replace
// Cargo, npm and Apple's services; signature bytes must still survive packing.
export function publish(t, scenario = {}, previousRoot) {
  const root = previousRoot ?? mkdtempSync(join(tmpdir(), "snapback4-signing-test-"));
  if (!previousRoot) {
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const dir of ["scripts", "packages/snapback4", `packages/${platform}`, "target/production"]) mkdirSync(join(root, dir), { recursive: true });
    for (const file of ["publish.mjs", "signing.mjs", "publication-artifacts.mjs", "linux-proof-inputs.mjs", "check-elf.mjs", "publication-consumer.mjs", "publication-roundtrip.mjs", "publication-registry.mjs", "prepare-client.mjs"]) if (existsSync(new URL(file, scripts))) copyFileSync(new URL(file, scripts), join(root, "scripts", file));
    for (const dir of ["snapback4", platform]) writeFileSync(join(root, "packages", dir, "package.json"), JSON.stringify({ name: dir, version: "0.0.0", ...(dir === "snapback4" ? { optionalDependencies: { "snapback4-darwin-arm64": "0.0.0", "snapback4-linux-x64": "0.0.0" } } : {}) }));
    writeFileSync(join(root, "target/production/snapback4"), "unsigned");
    writeFileSync(join(root, "packages", platform, "THIRD-PARTY-NOTICES"), "notices");
  }
  writeFileSync(join(root, "commands.jsonl"), "");
  if (scenario.registry) writeFileSync(join(root, "registry.json"), JSON.stringify(scenario.registry));
  writeFileSync(join(root, "mock.mjs"), `
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  if (cmd === "git") return args[0] === "status" ? (scenario.dirty ? " M changed" : "") : (scenario.source ?? "a".repeat(40));
  if (cmd === "tar") {
    if (args[2] === "package/snapback4") return readFileSync(args[1]);
    const name = args[1].includes("client.tgz") ? "snapback4" : args[1].includes("linux") ? "snapback4-linux-x64" : platform;
    if (name === "snapback4") return JSON.stringify({ ...JSON.parse(readFileSync(args[1], "utf8")), ...(scenario.deps ? { optionalDependencies: scenario.deps } : {}) });
    return JSON.stringify({ name, version: "0.0.0", ...(name.endsWith("linux-x64") ? { os: ["linux"], cpu: ["x64"] } : {}) });
  }
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
    writeFileSync(join(args.at(-1), filename), readFileSync(join(opts.cwd, filename === "platform.tgz" ? "snapback4" : "package.json")));
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
    if (scenario.requireSnapshot && (!tarball.includes("snapback4-publish-snapshot-") || (statSync(tarball).mode & 0o222))) throw Error("publish needs a private read-only snapshot");
    if (scenario.failClientPublish && tarball.endsWith("client.tgz")) throw Error("registry unavailable after platform publish");
    const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : {};
    const name = tarball.includes("linux-x64") ? "snapback4-linux-x64" : tarball.endsWith("platform.tgz") ? platform : "snapback4";
    registry[name + "@0.0.0"] = "sha512-" + createHash("sha512").update(readFileSync(tarball)).digest("base64");
    writeFileSync(registryPath, JSON.stringify(registry));
    return "published";
  }
  if (args[0] === "--version") return "snapback4 0.0.0";
  if (cmd === "node") {
    if (args[0] === "roundtrip.mjs" && scenario.swapAfterProof) writeFileSync(join(root, "target/publication", platform + "-0.0.0", scenario.swapAfterProof), "swapped after consumer proof");
    return "consumer ok";
  }
  return "";
};
cp.spawnSync = (cmd, args, opts) => {
  if (cmd === "npm" && args[0] === "view") {
    if (scenario.swapOnView) {
      writeFileSync(join(root, "target/publication", platform + "-0.0.0", scenario.swapOnView), "swapped during registry check");
      delete scenario.swapOnView;
    }
    if (scenario.swapSnapshotOnView) {
      const snapshot = readdirSync(work).find(name => name.startsWith("snapback4-publish-snapshot-"));
      if (snapshot) {
        const path = join(work, snapshot, "platform.tgz"); chmodSync(path, 0o600); writeFileSync(path, "swapped snapshot");
      }
      delete scenario.swapSnapshotOnView;
    }
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
  argv.push(...(scenario.args ?? []));
  const result = spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8", env });
  const commands = readFileSync(join(root, "commands.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const metrics = join(root, "metrics/publish.jsonl");
  const records = existsSync(metrics) ? readFileSync(metrics, "utf8").trim().split("\n").filter(Boolean) : [];
  return { ...result, root, commands, record: records.length ? JSON.parse(records.at(-1)) : null };
}
