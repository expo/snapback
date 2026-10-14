// @ref LLP 3000.011.003.000#10 — packed starters must pass their real web toolchains
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { Worker } from "node:worker_threads";
import { loadavg } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// The live keeper alone signals its own group. Closing its private pipe also
// cleans up if this runner dies; no cached PID ever authorizes a signal.
export async function runToolchainCommand(command, args, { cwd, env, timeout }) {
  const owner = fileURLToPath(new URL("./test-command-owner.mjs", import.meta.url));
  const keeper = spawn(process.execPath, [owner, "100", command, ...args], { cwd, env, detached: true, stdio: ["pipe", "inherit", "inherit", "ipc"] });
  let released = false, completed = false, failure, status;
  const release = mode => { if (!released) { released = true; keeper.stdin.end(mode); } };
  const fail = error => { failure ??= error; release("TERM"); };
  const timer = setTimeout(() => fail(Error(`${command}: toolchain command timed out`)), timeout);
  keeper.stdin.on("error", error => { failure ??= error; });
  keeper.on("message", message => {
    if (message.error) fail(Error(message.error));
    if (message.exited) { completed = true; status = message.status; release("KILL"); }
  });
  await new Promise(done => {
    keeper.once("error", error => { failure ??= error; });
    keeper.once("close", done);
  });
  clearTimeout(timer);
  if (!released || !completed) failure ??= Error(`${command}: command owner exited without a result`);
  // This read-only group-existence probe needs no /proc mount in the clean
  // userspace. Refuse on lingering members or ambiguous/permission errors.
  // Two empty observations also protect against a transient inspection result.
  const deadline = performance.now() + 5_000;
  let empty = 0;
  if (keeper.pid) while (empty < 2) {
    try { process.kill(-keeper.pid, 0); empty = 0; }
    catch (error) { if (error.code === "ESRCH") empty++; else { failure ??= error; break; } }
    if (empty === 2) break;
    if (performance.now() >= deadline) { failure ??= Error(`${command}: toolchain process group did not drain`); break; }
    await sleep(50);
  }
  if (failure) throw failure;
  if (status !== 0) throw Error(`${command}: toolchain command exited ${status}`);
}

// Every supported frontend/template pair; schema-only init has no frontend proof.
export const starterCases = [
  { id: "web", kind: "web", flags: ["--web"] },
  { id: "web-online", kind: "web", flags: ["--web", "--online"] },
  { id: "expo", kind: "expo", flags: ["--expo"] },
  { id: "web-chat", kind: "web", template: "chat", flags: ["--web", "--template", "chat"] },
  { id: "expo-chat", kind: "expo", template: "chat", flags: ["--expo", "--template", "chat"] },
  { id: "expo-social", kind: "expo", template: "social", flags: ["--template", "social"] },
];
async function boundedStop(work, label) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + " timed out")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
export async function proveFrontendTwice(run, cwd, starter) {
  const results = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const occupied = createServer();
    const low = await new Promise((resolve, reject) => { occupied.once("error", reject); occupied.listen(0, "127.0.0.1", () => resolve(occupied.address().port)); });
    const high = Math.min(65535, low + 20);
    const workers = Array.from({ length: 2 }, () => new Worker(`setInterval(() => { const until = performance.now() + 25; while (performance.now() < until) {} }, 50);`, { eval: true }));
    const started = Date.now(), load = loadavg();
    try {
      await run("npm", ["run", "frontend:proof"], cwd, { PORT_LO: String(low), PORT_HI: String(high) });
      results.push({ starter: starter.id, kind: starter.kind, attempt, status: "passed", elapsedMs: Date.now() - started, range: [low, high], occupied: low, cpuLoadWorkers: workers.length, loadavg: load, logs: join(cwd, "logs") });
    } finally {
      const stopped = await Promise.allSettled([...workers.map(worker => boundedStop(worker.terminate(), "CPU worker stop")), boundedStop(new Promise(resolve => occupied.close(resolve)), "occupied listener close")]);
      const failures = stopped.filter(result => result.status === "rejected").map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, "loaded-host proof cleanup failed");
    }
  }
  return results;
}

// Runs outside a checkout, using only packed release artifacts. Registry access
// is needed for Expo/Vite dependencies; npm prefers cached downloads when present.
export async function proveStarters(client, platform, expo, directory, browserProofs = true) {
  const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN;
  const deadline = performance.now() + 1_200_000;
  const run = (cmd, args, cwd, overrides = {}) => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) throw Error("starter qualification exceeded its twenty-minute guard");
    return runToolchainCommand(cmd, args, { cwd, env: { ...env, ...overrides }, timeout: Math.min(300_000, remaining) });
  };
  const artifacts = [client, platform, expo].map(path => resolve(path));
  const results = [];
  for (const starter of starterCases) {
    const { kind, template, id, flags } = starter;
    const cwd = join(directory, `starter-${id}`); mkdirSync(cwd);
    writeFileSync(join(cwd, "package.json"), '{"private":true}');
    // Install the CLI first so init and all later package scripts resolve the
    // packed binary. Pin native JS in init's manifest before dependency install.
    await run("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", ...artifacts.slice(0, 2)], cwd);
    const cli = join(cwd, "node_modules/.bin/snapback4");
    await run(cli, ["init", ...flags], cwd);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json")));
    pkg.dependencies.snapback4 = `file:${artifacts[0]}`;
    pkg.optionalDependencies = { [`snapback4-${process.platform}-${process.arch}`]: `file:${artifacts[1]}` };
    if (kind === "expo") pkg.dependencies["snapback4-expo"] = `file:${artifacts[2]}`;
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));
    // Lifecycle scripts are enabled: esbuild and the other real tools need them.
    await run("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund"], cwd);
    const build = async () => {
      await run(cli, ["check"], cwd);
      await run("npm", ["run", "typecheck"], cwd);
      if (kind === "expo") await run(join(cwd, "node_modules/.bin/expo"), ["export", "-p", "web", "--max-workers", "2"], cwd);
      await run("npm", ["run", kind === "expo" ? "build:web" : "build"], cwd);
      assert.ok(existsSync(join(cwd, "dist/index.html")), `${kind} produced a web page`);
    };
    await build();
    const frontendProofs = browserProofs ? await proveFrontendTwice(run, cwd, starter) : [];
    if (template || id === "web-online") {
      results.push({ starter: id, kind, template, status: "passed", typecheck: "passed", build: "passed", frontendProofs });
      continue;
    }
    // Exercise init-first adaptation with a different online-only schema: Home,
    // generated API, identity, README and the no-wasm journal must build together.
    writeFileSync(join(cwd, "snapback/schema.q"), `use identity guests\ntable notes:\n  owner: principal\n  title: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nquery mine():\n  return notes where .owner = viewer first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { owner: viewer, title }\n`);
    await run(cli, ["init", "--adapt"], cwd);
    await build();
    const adaptedProofs = browserProofs ? await proveFrontendTwice(run, cwd, starter) : [];
    results.push({ starter: id, kind, status: "passed", adapted: "passed", typecheck: "passed", build: "passed", frontendProofs, adaptedProofs });
  }
  return results;
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [client, platform, expo, mode] = process.argv.slice(2);
  if (!client || !platform || !expo) throw Error("usage: publication-starters.mjs client.tgz platform.tgz expo.tgz");
  const results = await proveStarters(client, platform, expo, process.cwd(), mode !== "--build-only");
  console.log(JSON.stringify({ starters: results, dependencies: "npm registry (prefer-offline), Expo network checks disabled" }));
}
