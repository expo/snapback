#!/usr/bin/env node
// Build, pack, prove from an installed consumer, publish. `--dry-run` does
// everything but `npm publish`. One script, one state machine, a recorded
// number (LLP 0329.016 P11; LLP 3000 §4 "Publication").
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signForPublication } from "./signing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "packages/snapback4");
const dry = process.argv.includes("--dry-run");
const t0 = Date.now();
// The packaged CLI uses independent SQLite page-cache recycling groups.
// @ref LLP 3000#7-decisions-during-execution — qualified packaged SQLite build policy
const sqliteBuildFlags = "-USQLITE_ENABLE_MEMORY_MANAGEMENT";
const buildEnv = { ...process.env, LIBSQLITE3_FLAGS: sqliteBuildFlags };
// HTTP and native-device tests must use this suite's freshly built CLI.
delete buildEnv.SNAPBACK4_BIN;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;

// The suite first, and a red suite is a refusal: nothing publishes over a
// failing test (0.1.10 went out on a red suite through a chained shell
// command; this gate is the durable answer).
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
// The binary rides in a platform package the client package depends on
// optionally; this machine builds darwin-arm64.
const platformPkg = join(root, `packages/snapback4-${process.platform}-${process.arch}`);
const platformVersion = JSON.parse(readFileSync(join(platformPkg, "package.json"), "utf8")).version;
if (platformVersion !== version) throw new Error(`snapback4-${process.platform}-${process.arch} is ${platformVersion}; the client is ${version}`);
console.log(`== build the binary → ${platformPkg}`);
const binaryProfile = "production";
const built = run("cargo", ["build", "--profile", binaryProfile, "--quiet", "--message-format=json-render-diagnostics", "-p", "snapback4"], { cwd: root, env: buildEnv });
const artifact = built.trim().split("\n").map((line) => JSON.parse(line)).find((message) => message.reason === "compiler-artifact" && message.target?.name === "snapback4" && message.target.kind.includes("bin") && message.executable);
if (!artifact) throw new Error("cargo did not report the production snapback4 binary");
// Use Cargo's reported path, including CARGO_TARGET_DIR, rather than finding
// an old release binary beside the one that was actually built.
const sourceBinary = artifact.executable;
// @ref LLP 3000.007#20.8 — sign and verify the shipped darwin bytes, including dry runs
console.log("== sign the production darwin binary");
let signing;
try {
  if (process.platform !== "darwin") throw new Error("Developer ID publication requires macOS");
  signing = signForPublication(sourceBinary, version);
} catch (error) {
  console.error(`publish: ${error.message}; snapback4@${version} is not published`);
  process.exit(1);
}
const expectedVersion = `snapback4 ${version}`;
const binaryVersion = run(sourceBinary, ["--version"]).trim();
if (binaryVersion !== expectedVersion) throw new Error(`built binary is ${binaryVersion}; expected ${expectedVersion}`);
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const binarySha256 = digest(sourceBinary);
copyFileSync(sourceBinary, join(platformPkg, "snapback4"));

const work = mkdtempSync(join(tmpdir(), "snapback4-publish-"));
console.log(`== pack → ${work}`);
const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: pkg }));
const tarball = join(work, packed.filename);
const tarballBytes = statSync(tarball).size;
const [packedPlatform] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: platformPkg }));
const platformTarball = join(work, packedPlatform.filename);
const platformTarballBytes = statSync(platformTarball).size;

console.log("== installed-consumer proof");
const consumer = join(work, "consumer");
mkdirSync(consumer);
writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", platformTarball, tarball, "react@19.3.0", "react-dom@19.3.0", "@types/react@19.3.0", "typescript@5.9.3"], { cwd: consumer });
const installedBinary = join(consumer, `node_modules/snapback4-${process.platform}-${process.arch}/snapback4`);
if (digest(installedBinary) !== binarySha256) throw new Error("packed/installed platform binary differs from the production artifact");
const installedVersion = run(join(consumer, "node_modules/.bin/snapback4"), ["--version"], { cwd: consumer }).trim();
if (installedVersion !== expectedVersion) throw new Error(`installed CLI is ${installedVersion}; expected ${expectedVersion}`);
// This is the binary unpacked from the platform tarball, not an unrelated
// output in target/. The source artifact's hash and selected profile bind the
// recorded shipped-size figure to the installed-consumer proof.
const binaryBytes = statSync(installedBinary).size;
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

if (dry) {
  console.log("== dry run: not publishing");
} else {
  console.log(`== npm publish ${packedPlatform.filename}`);
  run("npm", ["publish", platformTarball, "--access", "public"], { cwd: platformPkg });
  console.log(`== npm publish ${packed.filename}`);
  run("npm", ["publish", tarball, "--access", "public"], { cwd: pkg });
}
const record = { at: new Date().toISOString(), version, tarballBytes, platformTarballBytes, files: packed.entryCount, binaryBytes, binarySha256, binaryVersion, binaryProfile, sqliteBuildFlags, cargoProfile: artifact.profile, ...signing, platform: `${process.platform}-${process.arch}`, publish_s: +((Date.now() - t0) / 1000).toFixed(1), dry };
mkdirSync(join(root, "metrics"), { recursive: true });
appendFileSync(join(root, "metrics/publish.jsonl"), JSON.stringify(record) + "\n");
console.log(JSON.stringify(record));
