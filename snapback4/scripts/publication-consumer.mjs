import { mkdirSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { run, digest } from "./publication-artifacts.mjs";
import { verifyDeveloperId } from "./signing.mjs";
// @ref LLP 3000.021#3.3 — only Darwin is executed and signature-checked by the publisher
export function proveDarwin(staged, work) {
const platform = staged.platforms.find(p => p.name === "snapback4-darwin-arm64");
const consumer = join(work, "consumer");
mkdirSync(consumer);
writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
const env = { ...process.env }; delete env.SNAPBACK4_BIN;
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", platform.tarball, staged.client.tarball, "react@19.3.0", "react-dom@19.3.0", "@types/react@19.3.0", "typescript@5.9.3"], { cwd: consumer, env });
const installedBinary = join(consumer, "node_modules/snapback4-darwin-arm64/snapback4");
if (digest(installedBinary) !== platform.binarySha256) throw new Error("packed/installed platform binary differs from the production artifact");
const signature = verifyDeveloperId(installedBinary);
if (signature.signingAuthority !== platform.signing.signingAuthority || signature.signingTeamId !== platform.signing.signingTeamId) throw new Error("installed binary signature differs from the staged signature");
const installedVersion = run(join(consumer, "node_modules/.bin/snapback4"), ["--version"], { cwd: consumer, env }).trim();
if (installedVersion !== `snapback4 ${staged.version}`) throw new Error(`installed CLI is ${installedVersion}`);
if (statSync(installedBinary).size !== platform.binaryBytes) throw new Error("installed binary size differs from qualified size");
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

copyFileSync(new URL("./publication-roundtrip.mjs", import.meta.url), join(consumer, "roundtrip.mjs"));
run("node", ["roundtrip.mjs", staged.version], { cwd: consumer, env, timeout: 90_000 });
return { status: "passed", clientIntegrity: staged.client.integrity, platformIntegrity: platform.integrity };
}
