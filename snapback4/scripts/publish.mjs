#!/usr/bin/env node
// Build, pack, prove from an installed consumer, publish. `--dry-run` does
// everything but `npm publish`. One script, one state machine, a recorded
// number (LLP 0329.016 P11; LLP 3000 §4 "Publication").
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "packages/snapback4");
const dry = process.argv.includes("--dry-run");
const t0 = Date.now();
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;

// The suite first, and a red suite is a refusal: nothing publishes over a
// failing test (0.1.10 went out on a red suite through a chained shell
// command; this gate is the durable answer).
console.log(`== the suite`);
try {
  execFileSync("bash", [join(root, "scripts/test.sh")], { stdio: "inherit", cwd: root });
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
run("cargo", ["build", "--release", "--quiet", "-p", "snapback4"], { cwd: root });
const { copyFileSync } = await import("node:fs");
copyFileSync(join(root, "target/release/snapback4"), join(platformPkg, "snapback4"));
const binaryBytes = statSync(join(platformPkg, "snapback4")).size;

const work = mkdtempSync(join(tmpdir(), "snapback4-publish-"));
console.log(`== pack → ${work}`);
const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: pkg }));
const tarball = join(work, packed.filename);
const tarballBytes = statSync(tarball).size;
const [packedPlatform] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], { cwd: platformPkg }));
const platformTarball = join(work, packedPlatform.filename);

console.log("== installed-consumer proof");
const consumer = join(work, "consumer");
mkdirSync(consumer);
writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", platformTarball, tarball, "react@19.3.0", "react-dom@19.3.0", "@types/react@19.3.0", "typescript@5.9.3"], { cwd: consumer });
console.log(run(join(consumer, "node_modules/.bin/snapback4"), ["--version"], { cwd: consumer }).trim());
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
const record = { at: new Date().toISOString(), version, tarballBytes, files: packed.entryCount, binaryBytes, platform: `${process.platform}-${process.arch}`, publish_s: +((Date.now() - t0) / 1000).toFixed(1), dry };
mkdirSync(join(root, "metrics"), { recursive: true });
appendFileSync(join(root, "metrics/publish.jsonl"), JSON.stringify(record) + "\n");
console.log(JSON.stringify(record));
