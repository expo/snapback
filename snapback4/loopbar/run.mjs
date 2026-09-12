#!/usr/bin/env node
// The loop bar (LLP 3000 §3; rules/NOT-DOING.md "The bars"): a fresh agent,
// the published package, the reduced Clique M1–M3, ≤ 1,200 s wall clock,
// ≤ 1 Snapback-attributed correction loop, N ≥ 3. One line per run to
// metrics/loopbar.jsonl. Runs are serial: the clock is wall time.
//   node loopbar/run.mjs [--n 3] [--version 0.0.2] [--model gpt-6-astra] [--effort medium]
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Servers the agent left running from its lane would make a re-run of its
 * acceptance script hit a store that is not fresh: stop the ones whose
 * working directory is inside the lane (never anything else). */
function stopLaneServers(lane) {
  const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout ?? "";
  for (const line of ps.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m || !/snapback4 (dev|serve)|vite|node .*(acceptance|server)/.test(m[2])) continue;
    const cwd = spawnSync("lsof", ["-a", "-p", m[1], "-d", "cwd", "-Fn"], { encoding: "utf8" }).stdout ?? "";
    if (cwd.split("\n").some((l) => l.startsWith("n") && l.slice(1).startsWith(lane))) { try { process.kill(Number(m[1]), "SIGTERM"); } catch { /* gone */ } }
  }
}

/** Dev stores under the lane (`.snapback4/`), so the acceptance script's
 * own seed starts from nothing, as it did for the agent the first time. */
function dropLaneStores(lane) {
  const walk = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.name === ".snapback4") rmSync(path, { recursive: true, force: true });
      else if (depth < 4) walk(path, depth + 1);
    }
  };
  walk(lane, 0);
}

function verifyLane(lane) {
  stopLaneServers(lane);
  const node24 = join(process.env.HOME, ".volta/tools/image/node/24.18.0/bin");
  const env = { ...process.env, PATH: `${node24}:${process.env.PATH}` };
  const sh = (cmd, a) => { const r = spawnSync(cmd, a, { cwd: lane, env, encoding: "utf8", timeout: 300_000 }); return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }; };
  const shape = (r, ok) => ({ ok, tail: r.out.slice(-400) });
  const check = sh("npx", ["snapback4", "check"]);
  // A program's own `require` refusing a derived argument is not a failure
  // (0.0.11's `test` says so itself; earlier pins exit 1 on it).
  const fixture = existsSync(join(lane, "fixtures")) ? sh("npx", ["snapback4", "test", "--fixture", "fixtures"]) : { status: 1, out: "no fixtures/" };
  const fixtureOk = fixture.status === 0 || (fixture.out.includes("test:") && !fixture.out.split("\n").some((l) => /denied E_/.test(l)) && !/error|panicked/i.test(fixture.out));
  dropLaneStores(lane);
  const acceptance = sh("npm", ["run", "acceptance"]);
  stopLaneServers(lane);
  return { check: shape(check, check.status === 0), fixture: shape(fixture, fixtureOk), acceptance: shape(acceptance, acceptance.status === 0) };
}
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
if (args.reverify) {
  // Verify one finished lane again (after a leftover server spoiled the first
  // verification, say) and record the result beside the run's line.
  const lane = resolve(args.reverify);
  const verify = verifyLane(lane);
  const runLog = existsSync(join(lane, "run-log.md")) ? readFileSync(join(lane, "run-log.md"), "utf8") : "";
  const out = { at: new Date().toISOString(), reverify: lane, verify, green: !!runLog.match(/^green=\d+/m) && verify.check.ok && verify.fixture.ok && verify.acceptance.ok };
  console.log(JSON.stringify({ ...out, verify: Object.fromEntries(Object.entries(verify).map(([k, v]) => [k, v.ok])) }));
  appendFileSync(join(root, "metrics/loopbar.jsonl"), JSON.stringify(out) + "\n");
  process.exit(out.green ? 0 : 1);
}
const n = Number(args.n ?? 3);
const version = args.version ?? JSON.parse(readFileSync(join(root, "packages/snapback4/package.json"), "utf8")).version;
const model = args.model ?? "gpt-6-astra";
const effort = args.effort ?? "medium";
const runsRoot = resolve(args.root ?? join(process.env.HOME, `loopbar-sb4-${new Date().toISOString().slice(0, 10)}`));
const node24 = join(process.env.HOME, ".volta/tools/image/node/24.18.0/bin");
mkdirSync(runsRoot, { recursive: true });
const brief = readFileSync(join(root, "loopbar/brief.md"), "utf8").replaceAll("{VERSION}", version);

for (let run = 1; run <= n; run++) {
  const lane = join(runsRoot, `run-${run}`);
  if (existsSync(lane)) { console.log(`skip ${lane}: exists`); continue; }
  mkdirSync(lane, { recursive: true });
  writeFileSync(join(lane, "brief.md"), brief);
  const t0 = Date.now();
  const log = join(lane, "codex.ndjson");
  const out = { at: new Date().toISOString(), run, version, model, effort, lane };
  const child = spawn(join(process.env.HOME, ".volta/bin/codex"), ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--json", "--color", "never", "-m", model, "-c", `model_reasoning_effort=${effort}`, "-C", lane, "-o", join(lane, "FINAL.md"), "-"], {
    cwd: lane, env: { ...process.env, PATH: `${node24}:${process.env.PATH}`, CI: undefined }, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(brief);
  const fd = [];
  child.stdout.on("data", (d) => fd.push(d));
  child.stderr.on("data", (d) => fd.push(d));
  // A stuck agent ends the run at the safety limit; the bar is 1,200 s.
  const limitMs = Number(args.limit ?? 2_700) * 1000;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, limitMs);
  const code = await new Promise((r) => child.on("exit", r));
  clearTimeout(timer);
  out.timedOut = timedOut;
  writeFileSync(log, Buffer.concat(fd));
  out.exitCode = code;
  out.wallSeconds = +((Date.now() - t0) / 1000).toFixed(0);
  // The agent's own clock, from run-log.md.
  const runLog = existsSync(join(lane, "run-log.md")) ? readFileSync(join(lane, "run-log.md"), "utf8") : "";
  const start = Number(runLog.match(/^start=(\d+)/m)?.[1]);
  const green = Number(runLog.match(/^green=(\d+)/m)?.[1]);
  out.agentSeconds = start && green ? green - start : null;
  // An attribution the agent itself retracted later in the log does not count.
  const lines = runLog.split("\n").filter((l) => !/retract/i.test(l));
  const count = (re) => lines.filter((l) => re.test(l)).length;
  out.correctionLoops = { snapback4: count(/snapback4-defect/), docs: count(/docs-gap/), agent: count(/agent-error/), environment: count(/environment/) };
  // Independent verification of the proof: check, the fixture test, the
  // acceptance script — with nothing the agent left running.
  out.verify = verifyLane(lane);
  out.green = !!out.agentSeconds && out.verify.check.ok && out.verify.fixture.ok && out.verify.acceptance.ok;
  out.bar = out.green && out.wallSeconds <= 1200 && out.correctionLoops.snapback4 <= 1;
  console.log(JSON.stringify({ ...out, verify: Object.fromEntries(Object.entries(out.verify).map(([k, v]) => [k, v.ok])) }));
  appendFileSync(join(root, "metrics/loopbar.jsonl"), JSON.stringify(out) + "\n");
}
