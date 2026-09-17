#!/usr/bin/env node
// Build, pack, prove from an installed consumer, publish. `--dry-run` does
// everything but `npm publish`; `--resume` requalifies and converges the exact
// durable tarballs from an interrupted attempt. One script, one state machine,
// a recorded number (LLP 0329.016 P11; LLP 3000 §4 "Publication").
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signForPublication, verifyDeveloperId } from "./signing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "packages/snapback4");
const dry = process.argv.includes("--dry-run");
const resume = process.argv.includes("--resume");
const t0 = Date.now();
// The packaged CLI uses independent SQLite page-cache recycling groups.
// @ref LLP 3000#7-decisions-during-execution — qualified packaged SQLite build policy
const sqliteBuildFlags = "-USQLITE_ENABLE_MEMORY_MANAGEMENT";
const buildEnv = { ...process.env, LIBSQLITE3_FLAGS: sqliteBuildFlags };
// HTTP and native-device tests must use this suite's freshly built CLI.
delete buildEnv.SNAPBACK4_BIN;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;

// The binary rides in a platform package the client package depends on
// optionally; this machine builds darwin-arm64.
const platformPkg = join(root, `packages/snapback4-${process.platform}-${process.arch}`);
const platformName = `snapback4-${process.platform}-${process.arch}`;
const expectedVersion = `snapback4 ${version}`;
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const sri = (path) => `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;
const stateDirectory = join(root, "target/publication", `${platformName}-${version}`);
const receiptPath = join(stateDirectory, "resume.json");

function loadStage() {
  if (!existsSync(receiptPath)) return null;
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, "utf8")); }
  catch (error) { throw new Error(`cannot read publication resume ${receiptPath}: ${error.message}`); }
  if (receipt.format !== 2 || receipt.version !== version || receipt.platform !== platformName || receipt.client?.name !== "snapback4" || receipt.platformArtifact?.name !== platformName) throw new Error(`publication resume ${receiptPath} does not describe ${platformName} and snapback4 at ${version}`);
  if (receipt.qualification?.suite !== "passed") throw new Error(`publication resume ${receiptPath} does not carry a recorded successful source-suite qualification`);
  for (const artifact of [receipt.platformArtifact, receipt.client]) {
    if (artifact.version !== version || typeof artifact.filename !== "string" || typeof artifact.integrity !== "string") throw new Error(`publication resume has an incomplete ${artifact.name} artifact`);
    artifact.tarball = join(stateDirectory, artifact.filename);
    if (!existsSync(artifact.tarball) || sri(artifact.tarball) !== artifact.integrity) throw new Error(`staged ${artifact.name}@${version} tarball does not match its durable integrity`);
  }
  if (!/^[a-f0-9]{64}$/.test(receipt.binarySha256 ?? "") || receipt.binaryVersion !== expectedVersion || !receipt.signing?.signingAuthority || !receipt.signing?.signingTeamId) throw new Error(`publication resume has incomplete binary qualification`);
  return receipt;
}

let staged = loadStage();
if (staged && !resume) throw new Error(`publication stage already exists at ${receiptPath}; pass --resume to requalify and converge those exact bytes, or bump the version and build a fresh stage`);
if (!staged && resume) throw new Error(`--resume needs an existing publication stage at ${receiptPath}`);
if (staged) {
  console.log(`== resume exact qualified tarballs from ${receiptPath}`);
} else {
  const platformVersion = JSON.parse(readFileSync(join(platformPkg, "package.json"), "utf8")).version;
  if (platformVersion !== version) throw new Error(`snapback4-${process.platform}-${process.arch} is ${platformVersion}; the client is ${version}`);
  // A new stage must qualify its source before producing any durable bytes.
  // A resume instead requalifies the already qualified staged bytes below;
  // unrelated current-checkout failures cannot strand a partial publication.
  console.log(`== the suite`);
  try {
    execFileSync("bash", [join(root, "scripts/test.sh")], { stdio: "inherit", cwd: root, env: buildEnv });
  } catch {
    console.error(`publish: the suite is red; snapback4@${version} is not published`);
    process.exit(1);
  }
  console.log(`== build snapback4@${version}`);
  rmSync(join(pkg, "dist"), { recursive: true, force: true });
  run("bun", ["run", "--cwd", pkg, "build"]);
  console.log(`== build the binary → ${platformPkg}`);
  const binaryProfile = "production";
  const built = run("cargo", ["build", "--profile", binaryProfile, "--quiet", "--message-format=json-render-diagnostics", "-p", "snapback4"], { cwd: root, env: buildEnv });
  const artifact = built.trim().split("\n").map((line) => JSON.parse(line)).find((message) => message.reason === "compiler-artifact" && message.target?.name === "snapback4" && message.target.kind.includes("bin") && message.executable);
  if (!artifact) throw new Error("cargo did not report the production snapback4 binary");
  const work = mkdtempSync(join(tmpdir(), "snapback4-publish-"));
  const stagedPlatform = join(work, platformName);
  mkdirSync(stagedPlatform);
  for (const file of ["package.json", "THIRD-PARTY-NOTICES"]) copyFileSync(join(platformPkg, file), join(stagedPlatform, file));
  const sourceBinary = join(stagedPlatform, "snapback4");
  copyFileSync(artifact.executable, sourceBinary);
  console.log("== sign the production darwin binary");
  let signing;
  try {
    if (process.platform !== "darwin") throw new Error("Developer ID publication requires macOS");
    signing = signForPublication(sourceBinary, version);
  } catch (error) {
    console.error(`publish: ${error.message}; snapback4@${version} is not published`);
    process.exit(1);
  }
  const binaryVersion = run(sourceBinary, ["--version"]).trim();
  if (binaryVersion !== expectedVersion) throw new Error(`built binary is ${binaryVersion}; expected ${expectedVersion}`);
  const binarySha256 = digest(sourceBinary);
  console.log(`== pack → ${work}`);
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: pkg }));
  const [packedPlatform] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: stagedPlatform }));
  rmSync(stateDirectory, { recursive: true, force: true });
  mkdirSync(stateDirectory, { recursive: true });
  const tarball = join(stateDirectory, packed.filename), platformTarball = join(stateDirectory, packedPlatform.filename);
  copyFileSync(join(work, packed.filename), tarball);
  copyFileSync(join(work, packedPlatform.filename), platformTarball);
  staged = { format: 2, version, platform: platformName, qualification: { suite: "passed" }, binaryProfile, binarySha256, binaryVersion, binaryBytes: statSync(sourceBinary).size, cargoProfile: artifact.profile, sqliteBuildFlags, signing,
    client: { name: "snapback4", version, filename: packed.filename, integrity: sri(tarball), bytes: statSync(tarball).size, files: packed.entryCount },
    platformArtifact: { name: platformName, version, filename: packedPlatform.filename, integrity: sri(platformTarball), bytes: statSync(platformTarball).size, files: packedPlatform.entryCount } };
  const temporaryReceipt = `${receiptPath}.tmp-${process.pid}`;
  writeFileSync(temporaryReceipt, `${JSON.stringify(staged, null, 2)}\n`);
  renameSync(temporaryReceipt, receiptPath);
  staged = loadStage();
}
const tarball = staged.client.tarball, platformTarball = staged.platformArtifact.tarball;
const tarballBytes = staged.client.bytes, platformTarballBytes = staged.platformArtifact.bytes;
const binaryProfile = staged.binaryProfile, binarySha256 = staged.binarySha256, binaryVersion = staged.binaryVersion;
const signing = staged.signing;
const work = mkdtempSync(join(tmpdir(), "snapback4-publish-consumer-"));

console.log("== installed-consumer proof");
const consumer = join(work, "consumer");
mkdirSync(consumer);
writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", platformTarball, tarball, "react@19.3.0", "react-dom@19.3.0", "@types/react@19.3.0", "typescript@5.9.3"], { cwd: consumer });
const installedBinary = join(consumer, `node_modules/snapback4-${process.platform}-${process.arch}/snapback4`);
if (digest(installedBinary) !== binarySha256) throw new Error("packed/installed platform binary differs from the production artifact");
const installedSignature = verifyDeveloperId(installedBinary);
if (installedSignature.signingAuthority !== signing.signingAuthority || installedSignature.signingTeamId !== signing.signingTeamId) throw new Error("installed binary signature differs from the staged signature");
const installedVersion = run(join(consumer, "node_modules/.bin/snapback4"), ["--version"], { cwd: consumer }).trim();
if (installedVersion !== expectedVersion) throw new Error(`installed CLI is ${installedVersion}; expected ${expectedVersion}`);
// This is the binary unpacked from the platform tarball, not an unrelated
// output in target/. The source artifact's hash and selected profile bind the
// recorded shipped-size figure to the installed-consumer proof.
const binaryBytes = statSync(installedBinary).size;
if (binaryBytes !== staged.binaryBytes) throw new Error(`installed binary size ${binaryBytes} differs from qualified size ${staged.binaryBytes}`);
console.log(`${installedVersion}; ${binaryProfile}; ${binaryBytes} packed binary bytes; sha256 ${binarySha256}`);
writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, jsx: "react-jsx", noEmit: true, skipLibCheck: true, types: ["react"] }, include: ["check.tsx"] }));
writeFileSync(join(consumer, "check.tsx"), `
import { isReady, type Read, type Write, type Query } from "snapback4/contract";
import { createMockClient, page } from "snapback4/mock";
import { SnapbackProvider, useQuery, useMutation, useLink } from "snapback4/react";
const q: Query<{ c?: null }, string[]> = { kind: "query", name: "t.list" };
const client = createMockClient({ viewer: null, tables: {}, ops: { queries: { "t.list": () => page(["a"], null) }, mutations: {} } });
export function Screen() { const r = useQuery(q, {}); const link = useLink(); const m = useMutation({ kind: "mutation", name: "t.add" }); return <SnapbackProvider client={client}>{isReady(r) ? r.data.join() : link}{String(m.inFlight)}</SnapbackProvider>; }
const w: Write = { state: "pending", id: "x" }; const rd: Read<number> = { loading: true }; void w; void rd;
`);
run(join(consumer, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], { cwd: consumer });
writeFileSync(join(consumer, "run.mjs"), `
import { createMockClient, page } from "snapback4/mock";
import { isReady } from "snapback4/contract";
const c = createMockClient({ viewer: "p1", tables: {}, ops: { queries: { "t.list": () => page([1, 2, 3], null) }, mutations: { "t.add": (t, a, v, mint) => { const id = mint(); (t.t ??= new Map()).set(id, { id, n: a.n }); return [id]; } } }, commitDelayMs: 1 });
const r = await c.query({ kind: "query", name: "t.list" }, {});
if (!isReady(r) || r.data.length !== 3 || !r.fresh) throw new Error("mock query broken: " + JSON.stringify(r));
const w = await c.mutate({ kind: "mutation", name: "t.add" }, { n: 1 });
if (w.state !== "sent") throw new Error("mock mutate broken: " + JSON.stringify(w));
c.setLink("offline");
const w2 = await c.mutate({ kind: "mutation", name: "t.add" }, { n: 2 });
if (w2.state !== "pending") throw new Error("offline admission broken: " + JSON.stringify(w2));
console.log("consumer ok: query complete+fresh, online write sent, offline write pending");
`);
console.log(run("node", ["run.mjs"], { cwd: consumer }).trim());

function registryIntegrity(name, selectedVersion) {
  const result = spawnSync("npm", ["view", `${name}@${selectedVersion}`, "dist.integrity", "--json"], { cwd: root, encoding: "utf8", env: process.env });
  if (result.status === 0) {
    let value;
    try { value = JSON.parse(result.stdout || "null"); }
    catch { throw new Error(`npm view ${name}@${selectedVersion} returned malformed integrity JSON`); }
    if (typeof value !== "string" || !value.startsWith("sha512-")) throw new Error(`npm view ${name}@${selectedVersion} returned no unambiguous dist.integrity`);
    return value;
  }
  const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/(?:E404|404 Not Found|is not in this registry)/i.test(detail)) return undefined;
  throw new Error(`npm view ${name}@${selectedVersion} failed\n${detail.trim()}`);
}

function converge(artifact, directory) {
  const published = registryIntegrity(artifact.name, artifact.version);
  if (published === artifact.integrity) {
    console.log(`publish: ${artifact.name}@${artifact.version} already matches staged artifact`);
    return;
  }
  if (published !== undefined) throw new Error(`${artifact.name}@${artifact.version} already exists with integrity ${published}; staged artifact is ${artifact.integrity}`);
  console.log(`== npm publish ${artifact.filename}`);
  run("npm", ["publish", artifact.tarball, "--access", "public"], { cwd: directory });
  // npm answers "your package is being processed"; dist.integrity is not readable
  // for a minute or two after a successful upload. Reading it immediately failed
  // two 0.2.27 attempts on packages that had in fact published, so wait for the
  // registry rather than calling an accepted upload a failure. Observed
  // propagation on 2026-09-17: 60 s, 90 s and 120 s for the three packages.
  const deadline = Date.now() + 10 * 60 * 1000;
  let after = registryIntegrity(artifact.name, artifact.version);
  while (after === undefined && Date.now() < deadline) {
    process.stdout.write(`publish: waiting for ${artifact.name}@${artifact.version} to become readable\n`);
    spawnSync("sleep", ["15"]);
    after = registryIntegrity(artifact.name, artifact.version);
  }
  if (after !== artifact.integrity) throw new Error(`npm published ${artifact.name}@${artifact.version}, but registry integrity is ${after ?? "absent after waiting 10 minutes"}; expected ${artifact.integrity}`);
}

if (dry) {
  console.log("== dry run: not publishing");
} else {
  converge(staged.platformArtifact, platformPkg);
  converge(staged.client, pkg);
}
const record = { at: new Date().toISOString(), version, tarballBytes, platformTarballBytes, tarballIntegrity: staged.client.integrity, platformTarballIntegrity: staged.platformArtifact.integrity, resume: receiptPath, files: staged.client.files, binaryBytes, binarySha256, binaryVersion, binaryProfile, sqliteBuildFlags, cargoProfile: staged.cargoProfile, ...signing, platform: `${process.platform}-${process.arch}`, publish_s: +((Date.now() - t0) / 1000).toFixed(1), dry };
mkdirSync(join(root, "metrics"), { recursive: true });
appendFileSync(join(root, "metrics/publish.jsonl"), JSON.stringify(record) + "\n");
console.log(JSON.stringify(record));
