#!/usr/bin/env node
// The loop bar (LLP 3000 §3; rules/NOT-DOING.md "The bars"): a fresh agent,
// the published package, the reduced Clique M1–M3, ≤ 1,200 s wall clock,
// ≤ 1 Snapback-attributed correction loop, N ≥ 3. One line per run to
// metrics/loopbar.jsonl. Runs are serial: the clock is wall time.
//   node loopbar/run.mjs [--n 3] [--version 0.0.2] [--model gpt-6-astra] [--effort medium]
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function containsPath(directory, path) {
  const name = relative(resolve(directory), resolve(path));
  return name === "" || (name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name));
}

/** Reverification owns a new directory, never the agent's live stores or
 * processes. Dependencies are reused without copying them. Keep the copy for
 * diagnosis: even a failed acceptance script might have left a process using
 * it, and only the script that recorded that PID at launch may stop it. */
export function prepareVerificationLane(lane) {
  lane = realpathSync(lane);
  const directory = mkdtempSync(join(tmpdir(), "snapback4-loopbar-verify-"));
  const dependencies = [];
  cpSync(lane, directory, { recursive: true, dereference: true, filter(source) {
    if (!containsPath(lane, source)) throw new Error(`verification source is outside its lane: ${source}`);
    const path = relative(lane, source);
    const parts = path.split(sep);
    if (parts.includes(".snapback4") || parts.includes(".git")) return false;
    if (parts.at(-1) === "node_modules") {
      dependencies.push({ source: realpathSync(source), destination: join(directory, path) });
      return false;
    }
    return true;
  } });
  for (const { source, destination } of dependencies) symlinkSync(source, destination, "dir");
  return directory;
}

function verifyLane(lane) {
  const directory = prepareVerificationLane(lane);
  const node24 = dirname(process.execPath);
  const env = { ...process.env, PATH: `${node24}:${process.env.PATH}` };
  const sh = (cmd, a, cwd = directory) => { const r = spawnSync(cmd, a, { cwd, env, encoding: "utf8", timeout: 300_000 }); return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error?.message ?? ""}` }; };
  const shape = (r, ok) => ({ ok, tail: r.out.slice(-400) });
  const check = sh("npx", ["snapback4", "check"]);
  // A program's own `require` refusing a derived argument is not a failure
  // (0.0.11's `test` says so itself; earlier pins exit 1 on it).
  const fixture = existsSync(join(directory, "fixtures")) ? sh("npx", ["snapback4", "test", "--fixture", "fixtures"]) : { status: 1, out: "no fixtures/" };
  const fixtureOk = fixture.status === 0 || (fixture.out.includes("test:") && !fixture.out.split("\n").some((l) => /denied E_/.test(l)) && !/error|panicked/i.test(fixture.out));
  // Older published pins wrote fixture tests to their dev store. Acceptance
  // receives its own fresh copy even for those pins, without deleting data.
  const acceptanceDirectory = prepareVerificationLane(lane);
  const acceptance = sh("npm", ["run", "acceptance"], acceptanceDirectory);
  return { directory, acceptanceDirectory, check: shape(check, check.status === 0), fixture: shape(fixture, fixtureOk), acceptance: shape(acceptance, acceptance.status === 0) };
}
const verdicts = ({ directory, acceptanceDirectory, check, fixture, acceptance }) => ({ directory, acceptanceDirectory, check: check.ok, fixture: fixture.ok, acceptance: acceptance.ok });

async function main(argv) {
  const args = Object.fromEntries(argv.map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
  if (args.reverify) {
    // Verify one finished lane again (after a leftover server spoiled the first
    // verification, say) and record the result beside the run's line.
    const lane = resolve(args.reverify);
    const verify = verifyLane(lane);
    const runLog = existsSync(join(lane, "run-log.md")) ? readFileSync(join(lane, "run-log.md"), "utf8") : "";
    const out = { at: new Date().toISOString(), reverify: lane, verify, green: !!runLog.match(/^green=\d+/m) && verify.check.ok && verify.fixture.ok && verify.acceptance.ok };
    console.log(JSON.stringify({ ...out, verify: verdicts(verify) }));
    appendFileSync(join(root, "metrics/loopbar.jsonl"), JSON.stringify(out) + "\n");
    process.exit(out.green ? 0 : 1);
  }
  const n = Number(args.n ?? 3);
  const version = args.version ?? JSON.parse(readFileSync(join(root, "packages/snapback4/package.json"), "utf8")).version;
  const model = args.model ?? "gpt-6-astra";
  const effort = args.effort ?? "medium";
  const runsRoot = resolve(args.root ?? join(process.env.HOME, `loopbar-sb4-${new Date().toISOString().slice(0, 10)}`));
  const node24 = dirname(process.execPath);
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
    // acceptance script — in its own directory and fresh store. The agent and
    // its acceptance script own cleanup of the children they launched; a port
    // conflict is a reported failure, never grounds to kill an inferred owner.
    out.verify = verifyLane(lane);
    out.green = !!out.agentSeconds && out.verify.check.ok && out.verify.fixture.ok && out.verify.acceptance.ok;
    out.bar = out.green && out.wallSeconds <= 1200 && out.correctionLoops.snapback4 <= 1;
    console.log(JSON.stringify({ ...out, verify: verdicts(out.verify) }));
    appendFileSync(join(root, "metrics/loopbar.jsonl"), JSON.stringify(out) + "\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
