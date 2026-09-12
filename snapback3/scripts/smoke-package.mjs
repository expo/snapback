#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
if (process.argv.length !== 3) throw new Error("Usage: node scripts/smoke-package.mjs <tarball.tgz>");
const archive = resolve(process.argv[2]);
await access(archive);
const app = await mkdtemp(join(tmpdir(), "snapback3-installed-"));
const environment = { ...process.env };
delete environment.SNAPBACK3_WORKER;
delete environment.NODE_PATH;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let server;
let stderr = "";
let passed = false;
let phase = "install";
try {
  await mkdir(join(app, "snapback"));
  await writeFile(join(app, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: {
    snapback3: `file:${archive}`, react: "19.3.0", "@types/react": "19.3.0", "@types/node": "22.20.2",
  } }));
  await execute(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--registry=https://registry.npmjs.org"], {
    cwd: app, env: environment, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  const installed = join(app, "node_modules/snapback3");
  const metadata = JSON.parse(await readFile(join(installed, "dist/package-build.json"), "utf8"));
  assert.equal(metadata.host, `${process.platform}-${process.arch}`);
  await access(join(installed, "LICENSE"));
  await writeFile(join(app, "snapback/schema.q"), `use identity\n\ntable notes:\n  owner: principal\n  body: text 1..120\n  by byOwner: owner, id\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- deny\n  delete <- deny\n`);
  await writeFile(join(app, "snapback/notes.q"), `query list():\n  return notes[viewer] first 10 by byOwner\n\nmutation add(body: text 1..120):\n  note = insert notes { owner: viewer, body }\n  return { id: note.id }\n`);
  await writeFile(join(app, "snapback/seed.ts"), `import { seed } from "snapback3";\nexport default seed({ personas: ["alice"], rows: { notes: [{ id: "first", owner: "dev:alice", body: "Installed tarball seed" }] } });\n`);
  const cli = join(installed, "dist/cli.mjs");
  phase = "installed CLI certification";
  process.stderr.write(`snapback3 smoke: ${phase} in ${app}\n`);
  const check = JSON.parse((await execute(npm, ["exec", "--offline", "--", "snapback3", "check", ".", "--json"], {
    cwd: app, env: environment, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  })).stdout);
  assert.equal(check.ok, true);
  assert.equal(check.operations, 2);
  phase = "TypeScript imports";
  await writeFile(join(app, "imports.tsx"), `import { seed, decimal, type Principal } from "snapback3";
import { api, createClient, type ResultOf } from "snapback3/client";
import { compileProject, lowerSeed } from "snapback3/compiler";
import { SnapbackProvider, useQuery } from "snapback3/react";
const client = createClient({ url: "http://127.0.0.1:1", storage: false });
const cents: number = decimal(2, 2);
const localSeed = seed({ personas: ["alice"], rows: {} });
const compiler: typeof compileProject = compileProject;
const seeder: typeof lowerSeed = lowerSeed;
const owner: Principal | undefined = undefined;
const notes = client.watch(api.notes.list, {});
type Notes = ResultOf<typeof api.notes.list>;
const typed: Notes | undefined = notes.getSnapshot().data;
client.mutate(api.notes.add, { body: "Typed write" });
// @ts-expect-error Generated operation arguments reject the wrong body type.
client.mutate(api.notes.add, { body: 12 });
function Notes() { const resource = useQuery(api.notes.list, {}); return <p>{resource.data?.[0]?.body}</p>; }
const view = <SnapbackProvider client={client}><Notes /></SnapbackProvider>;
`);
  await writeFile(join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", strict: true,
    noEmit: true, skipLibCheck: false, types: ["node", "react"], lib: ["ES2022", "DOM", "DOM.Iterable"],
  }, include: ["imports.tsx", ".snapback3/build/api.d.ts"] }));
  await node([join(app, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"]);
  phase = "development server";
  server = spawn(process.execPath, [cli, "dev", ".", "--port", "0"], { cwd: app, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8192); });
  const url = await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Installed dev server timed out. ${stderr}`)), 15_000);
    let stdout = "";
    server.stdout.on("data", chunk => {
      stdout += chunk;
      const match = /SNAPBACK_URL=(http:\/\/[^\s]+)/.exec(stdout);
      if (match) { clearTimeout(timeout); done(match[1]); }
    });
    server.once("error", error => { clearTimeout(timeout); reject(error); });
    server.once("exit", code => { clearTimeout(timeout); reject(new Error(`Installed dev server exited ${code}. ${stderr}`)); });
  });
  const health = await (await fetch(`${url}/api/health`)).json();
  assert.equal(health.ok, true);
  await writeFile(join(app, "exercise.mjs"), `import assert from "node:assert/strict";
import { createClient } from "snapback3/client";
const client = createClient({ url: process.argv[2], storage: false, live: false });
try {
  await client.ready;
  await client.auth.persona("alice");
  const initial = await client.query("notes.list");
  assert.equal(initial.length, 1);
  assert.equal(initial[0].body, "Installed tarball seed");
  const operation = client.mutate("notes.add", { body: "Installed tarball write" });
  await operation.durable;
  assert.equal((await operation.settled).state, "committed");
  assert.equal((await client.query("notes.list")).some(note => note.body === "Installed tarball write"), true);
} finally { client.close(); }
`);
  phase = "SDK seeded query and settled mutation";
  await node([join(app, "exercise.mjs"), url]);
  passed = true;
  console.log(JSON.stringify({ ok: true, host: metadata.host, node: process.version,
    freshExternalInstall: true, workerOverride: false, certifiedOperations: check.operations,
    strictTypeImports: ["snapback3", "snapback3/client", "snapback3/react", "snapback3/compiler"],
    devHealth: true, seededQuery: true, settledMutation: true }));
} catch (error) {
  process.stderr.write(`snapback3 smoke failed during ${phase}; retained app: ${app}\n`);
  throw error;
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "close");
    server.kill("SIGTERM");
    const force = setTimeout(() => server.kill("SIGKILL"), 3000);
    try { await stopped; } finally { clearTimeout(force); }
  }
  if (passed) await rm(app, { recursive: true, force: true });
}

async function node(args) {
  return execute(process.execPath, args, { cwd: app, env: environment, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
}
