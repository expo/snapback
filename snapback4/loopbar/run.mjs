#!/usr/bin/env node
// The loop bar (LLP 3000 §3; rules/NOT-DOING.md "The bars"): a fresh agent,
// the published package, the reduced Clique M1–M3, ≤ 1,200 s wall clock,
// ≤ 1 Snapback-attributed correction loop, N ≥ 3. One line per run to
// metrics/loopbar.jsonl. Runs are serial: the clock is wall time.
//   node loopbar/run.mjs [--n 3] [--version 0.0.2] [--model gpt-6-astra] [--effort medium]
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
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
  out.correctionLoops = { snapback4: (runLog.match(/snapback4-defect/g) ?? []).length, docs: (runLog.match(/docs-gap/g) ?? []).length, agent: (runLog.match(/agent-error/g) ?? []).length, environment: (runLog.match(/environment/g) ?? []).length };
  // Independent verification of the proof: check, the fixture test, the acceptance script.
  const env = { ...process.env, PATH: `${node24}:${process.env.PATH}` };
  const sh = (cmd, a) => { const r = spawnSync(cmd, a, { cwd: lane, env, encoding: "utf8", timeout: 300_000 }); return { ok: r.status === 0, tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-400) }; };
  out.verify = {
    check: sh("npx", ["snapback4", "check"]),
    fixture: existsSync(join(lane, "fixtures")) ? sh("npx", ["snapback4", "test", "--fixture", "fixtures"]) : { ok: false, tail: "no fixtures/" },
    acceptance: sh("npm", ["run", "acceptance"]),
  };
  out.green = !!out.agentSeconds && out.verify.check.ok && out.verify.fixture.ok && out.verify.acceptance.ok;
  out.bar = out.green && out.wallSeconds <= 1200 && out.correctionLoops.snapback4 <= 1;
  console.log(JSON.stringify({ ...out, verify: Object.fromEntries(Object.entries(out.verify).map(([k, v]) => [k, v.ok])) }));
  appendFileSync(join(root, "metrics/loopbar.jsonl"), JSON.stringify(out) + "\n");
}
