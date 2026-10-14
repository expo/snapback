#!/usr/bin/env node
import { checkVerbHelp } from "./check-verb-help.mjs";
import { lintPackagedDocs } from "./packaged-docs.mjs";
// @ref LLP 3000.021#3.3 — a publication is one client and a qualified artifact per platform
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { signForPublication } from "./signing.mjs";
import { artifact, cleanSource, clientManifest, digest, json, manifest, platforms, run, save, sqliteBuildFlags, sri, validateLinux, verifyArtifact } from "./publication-artifacts.mjs";
import { prepareClient, loadPrepared } from "./prepare-client.mjs";
import { proveDarwin } from "./publication-consumer.mjs";
import { converge, registryIntegrity, withPublicationSnapshot } from "./publication-registry.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
lintPackagedDocs(root);
const pkg = join(root, "packages/snapback4"), version = json(join(pkg, "package.json")).version;
const flags = new Set(["--dry-run", "--resume", "--prepare-client"]), values = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (flags.has(arg)) { values.set(arg, true); continue; }
  if (!["--linux-receipt", "--linux-tarball"].includes(arg) || !process.argv[i + 1] || process.argv[i + 1].startsWith("--")) throw new Error(`unknown or incomplete option ${arg}`);
  values.set(arg, resolve(process.argv[++i]));
}
const dry = values.has("--dry-run"), resume = values.has("--resume"), preparing = values.has("--prepare-client");
if (preparing && (resume || values.has("--linux-receipt") || values.has("--linux-tarball"))) throw new Error("--prepare-client cannot resume or import Linux artifacts");
if (values.has("--linux-receipt") !== values.has("--linux-tarball")) throw new Error("provide both --linux-receipt and --linux-tarball");
if (resume && values.has("--linux-receipt")) throw new Error("--resume uses the durable imported Linux receipt; do not replace it");
const preparedDirectory = join(root, "target/publication", `client-${version}`);
if (preparing) {
  const prepared = prepareClient(root, version, preparedDirectory);
  console.log(JSON.stringify(prepared, null, 2));
  process.exit(0);
}
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("publication requires darwin-arm64; on Linux run qualify-linux.mjs with the prepared client");
const platformName = platforms[0], platformPkg = join(root, "packages", platformName);
const stateDirectory = join(root, "target/publication", `${platformName}-${version}`), receiptPath = join(stateDirectory, "resume.json");
const t0 = Date.now(), buildEnv = { ...process.env, LIBSQLITE3_FLAGS: sqliteBuildFlags };
delete buildEnv.SNAPBACK4_BIN;
function loadStage() {
  let r = json(receiptPath);
  // Format-2 layout is readable; every resumable stage must retain Expo proof bytes.
  const legacy = r.format === 2;
  if (legacy) r = { ...r, format: 3, platforms: [{ ...r.platformArtifact, binaryProfile: r.binaryProfile, binarySha256: r.binarySha256, binaryVersion: r.binaryVersion, binaryBytes: r.binaryBytes, signing: r.signing, cargoProfile: r.cargoProfile }] };
  if (r.format !== 3 || r.version !== version || r.client?.name !== "snapback4" || !Array.isArray(r.platforms) || ![1, 2].includes(r.platforms.length) || r.platforms.some((p, i) => p.name !== platforms[i])) throw new Error("publication resume does not describe the client and ordered platform artifact set");
  if (r.qualification?.suite !== "passed") throw new Error("publication resume does not carry a recorded successful source-suite qualification");
  if (!r.expo) throw new Error("publication stage predates starter qualification and lacks its packed Expo proof input; artifacts are preserved, but prepare a new release version instead of reusing its old qualification");
  r.expo = verifyArtifact(r.expo, stateDirectory, version);
  manifest(r.expo.tarball, "snapback4-expo", version);
  r.client = verifyArtifact(r.client, stateDirectory, version);
  r.platforms = r.platforms.map(p => verifyArtifact(p, stateDirectory, version));
  clientManifest(r.client.tarball, version, r.platforms.map(p => p.name));
  const darwin = r.platforms[0];
  manifest(darwin.tarball, platformName, version);
  if (!/^[a-f0-9]{64}$/.test(darwin.binarySha256 ?? "") || darwin.binaryVersion !== `snapback4 ${version}` || !darwin.signing?.signingAuthority || !darwin.signing?.signingTeamId) throw new Error("publication resume has incomplete Darwin binary qualification");
  const linux = r.platforms[1];
  if (linux) {
    if (linux.receiptFile !== "linux-receipt.json" || sri(join(stateDirectory, linux.receiptFile)) !== linux.receiptIntegrity) throw new Error("imported Linux receipt does not match durable integrity");
    const receipt = validateLinux(json(join(stateDirectory, linux.receiptFile)), linux.tarball, { ...r.client, expoIntegrity: r.expo.integrity }, r.source);
    if (linux.binarySha256 !== receipt.binarySha256) throw new Error("Linux artifact binary sha256 differs from its receipt");
  }
  return r;
}
let staged;
if (existsSync(receiptPath)) {
  if (!resume) throw new Error(`publication stage already exists at ${receiptPath}; pass --resume to requalify and converge those exact bytes, or bump the version`);
  staged = loadStage();
} else {
  if (resume) throw new Error(`--resume needs an existing publication stage at ${receiptPath}`);
  if (json(join(platformPkg, "package.json")).version !== version) throw new Error("Darwin package version differs from the client");
  const source = cleanSource(root);
  console.log("== the suite");
  try { run("bash", [join(root, "scripts/test.sh")], { cwd: root, env: buildEnv, stdio: "inherit" }); }
  catch { throw new Error(`publish: the suite is red; snapback4@${version} is not published`); }
  const selectedPlatforms = values.has("--linux-receipt") ? platforms : [platformName];
  const prepared = existsSync(join(preparedDirectory, "prepare.json")) ? loadPrepared(preparedDirectory, version, selectedPlatforms) : prepareClient(root, version, preparedDirectory, selectedPlatforms);
  if (prepared.source !== source) throw new Error("prepared client source differs from release source; prepare at the same commit");
  let linuxReceipt;
  if (values.has("--linux-receipt")) linuxReceipt = validateLinux(json(values.get("--linux-receipt")), values.get("--linux-tarball"), { ...prepared.client, expoIntegrity: prepared.expo.integrity }, source);
  const work = mkdtempSync(join(tmpdir(), "snapback4-publish-"));
  try {
    const built = run("cargo", ["build", "--locked", "--profile", "production", "--quiet", "--message-format=json-render-diagnostics", "-p", "snapback4"], { cwd: root, env: buildEnv });
    const cargo = built.trim().split("\n").map(JSON.parse).find(m => m.reason === "compiler-artifact" && m.target?.name === "snapback4" && m.target.kind.includes("bin") && m.executable);
    if (!cargo) throw new Error("cargo did not report the production snapback4 binary");
    const stagePkg = join(work, platformName); mkdirSync(stagePkg);
    for (const name of ["package.json", "THIRD-PARTY-NOTICES"]) copyFileSync(join(platformPkg, name), join(stagePkg, name));
    const binary = join(stagePkg, "snapback4"); copyFileSync(cargo.executable, binary);
  checkVerbHelp(binary);
    const signing = signForPublication(binary, version);
    const binaryVersion = run(binary, ["--version"]).trim();
    if (binaryVersion !== `snapback4 ${version}`) throw new Error(`built binary is ${binaryVersion}`);
    const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: stagePkg }));
    const tarball = join(work, packed.filename);
    if (cleanSource(root) !== source) throw new Error("release source changed during staging");
    mkdirSync(stateDirectory, { recursive: true });
    copyFileSync(prepared.expo.tarball, join(stateDirectory, prepared.expo.filename));
    copyFileSync(prepared.client.tarball, join(stateDirectory, prepared.client.filename));
    copyFileSync(tarball, join(stateDirectory, packed.filename));
    const { tarball: _, ...client } = prepared.client;
    const { tarball: _expo, ...expo } = prepared.expo;
    staged = { format: 3, source, version, qualification: { suite: "passed" }, client, expo, platforms: [artifact(tarball, platformName, version, { binaryProfile: "production", binarySha256: digest(binary), binaryVersion, binaryBytes: statSync(binary).size, cargoProfile: cargo.profile, sqliteBuildFlags, signing })] };
    if (linuxReceipt) {
      const linuxFile = `snapback4-linux-x64-${version}.tgz`, receiptFile = "linux-receipt.json";
      copyFileSync(values.get("--linux-tarball"), join(stateDirectory, linuxFile));
      copyFileSync(values.get("--linux-receipt"), join(stateDirectory, receiptFile));
      staged.platforms.push(artifact(join(stateDirectory, linuxFile), platforms[1], version, { binarySha256: linuxReceipt.binarySha256, receiptFile, receiptIntegrity: sri(join(stateDirectory, receiptFile)) }));
    }
    save(receiptPath, staged);
    staged = loadStage();
  } finally { rmSync(work, { recursive: true, force: true }); }
}
const work = mkdtempSync(join(tmpdir(), "snapback4-publish-consumer-"));
try { staged.platforms[0].proof = await proveDarwin(staged, work); }
finally { rmSync(work, { recursive: true, force: true }); }
// Verify every registry artifact before the first upload, even if a later one conflicts.
const artifacts = [...staged.platforms, staged.client];
if (!dry) {
  withPublicationSnapshot(artifacts, snapshot => {
    for (const a of snapshot) {
      const published = registryIntegrity(a.name, a.version);
      if (published !== undefined && published !== a.integrity) throw new Error(`${a.name}@${a.version} already exists with integrity ${published}; staged artifact is ${a.integrity}`);
    }
    for (const a of snapshot) converge(a, root);
  });
}
const darwin = staged.platforms[0];
const compatibility = { tarballBytes: staged.client.bytes, platformTarballBytes: darwin.bytes, tarballIntegrity: staged.client.integrity, platformTarballIntegrity: darwin.integrity, files: staged.client.files, binaryVersion: darwin.binaryVersion, binaryProfile: darwin.binaryProfile, sqliteBuildFlags, cargoProfile: darwin.cargoProfile, platform: "darwin-arm64" };
const record = { ...compatibility, at: new Date().toISOString(), version, source: staged.source, artifacts: artifacts.map(({ tarball, ...a }) => a), resume: receiptPath, ...darwin.signing, binaryBytes: darwin.binaryBytes, binarySha256: darwin.binarySha256, publish_s: +((Date.now() - t0) / 1000).toFixed(1), dry };
mkdirSync(join(root, "metrics"), { recursive: true });
appendFileSync(join(root, "metrics/publish.jsonl"), JSON.stringify(record) + "\n");
console.log(JSON.stringify(record));
