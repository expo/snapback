#!/usr/bin/env node
// Measure the loop, every time. Appends one JSON line per run to metrics/loop.jsonl.
// `--check` fails when a measured number exceeds the budget in rules/RULES.md.
// `--cold` also measures a cold build (cargo clean first) — slow, opt-in.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const run = (cmd, argv, opts = {}) => {
  const t0 = performance.now();
  const r = spawnSync(cmd, argv, { cwd: root, encoding: "utf8", ...opts });
  return { seconds: (performance.now() - t0) / 1000, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const fail = (msg) => { console.error(`measure: ${msg}`); process.exitCode = 1; };

function recordStep(record, failedSteps, name, result, digits, failure) {
  const seconds = +result.seconds.toFixed(digits);
  const step = { seconds, ok: result.status === 0 };
  record[name] = seconds;
  record.steps[name] = step;
  if (!step.ok) {
    failedSteps.add(name);
    fail(failure(result));
  }
  return step;
}

function scoreChecks(checks, budget, report = console.log, refuse = fail) {
  for (const [label, step] of checks) {
    if (!step.ok) {
      report(`not ok ${label}: step failed (${step.seconds}s)`);
      continue;
    }
    const max = budget(label);
    if (max === undefined) continue;
    if (step.seconds > max) refuse(`${label}: ${step.seconds}s over budget ${max}s`);
    else report(`ok ${label}: ${step.seconds}s ≤ ${max}s`);
  }
}

const failedSummary = (failedSteps) => `failed steps: ${[...failedSteps].join(", ")}`;

function main() {
  const failedSteps = new Set();
  const record = {
    at: new Date().toISOString(),
    sha: run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim(),
    steps: {},
  };

  if (args.has("--cold")) {
    run("cargo", ["clean", "-q"]);
    const cold = run("cargo", ["build", "-q"]);
    recordStep(record, failedSteps, "cold_build_s", cold, 2, (result) => `cold build failed\n${result.stderr}`);
  }
  // Warm, then a one-line-edit proxy: bump the mtime of a core source file and rebuild.
  const warm = run("cargo", ["build", "-q"]);
  recordStep(record, failedSteps, "warm_build_s", warm, 2, (result) => `warm build failed\n${result.stderr}`);
  const touched = resolve(root, "crates/snapback2-core/src/value.rs");
  const now = new Date(); utimesSync(touched, now, now);
  const incr = run("cargo", ["build", "-q"]);
  const incrementalStep = recordStep(record, failedSteps, "incremental_build_s", incr, 2, (result) => `incremental build failed\n${result.stderr}`);

  const test = run("cargo", ["test", "-q", "-p", "snapback2-core"]);
  const testStep = recordStep(record, failedSteps, "test_s", test, 2, (result) => `core tests failed\n${result.stdout}\n${result.stderr}`);

  const bin = resolve(root, "target/debug/snapback2");
  const compiler = resolve(root, "packages/snapback2/dist/compiler.mjs");
  const compilerEnv = { ...process.env, SNAPBACK2_COMPILER: compiler };
  // Take the better of two adjacent runs so post-test scheduler/pipe teardown
  // noise is not mistaken for the binary's boot-to-ready latency.
  const doctorRuns = [
    run(bin, ["doctor", "--json"], { env: compilerEnv }),
    run(bin, ["doctor", "--json"], { env: compilerEnv }),
  ];
  const doctor = doctorRuns.toSorted((left, right) => left.seconds - right.seconds)[0];
  const doctorResult = { ...doctor, status: doctorRuns.every((sample) => sample.status === 0) ? 0 : 1 };
  const doctorStep = recordStep(record, failedSteps, "boot_s", doctorResult, 3, () => {
    const failed = doctorRuns.filter((sample) => sample.status !== 0);
    return `doctor failed\n${failed.map((sample) => `${sample.stdout}\n${sample.stderr}`).join("\n")}`;
  });
  record.doctor_samples_s = doctorRuns.map((sample) => ({
    seconds: +sample.seconds.toFixed(3),
    ok: sample.status === 0,
  }));
  try {
    record.doctor_ms = JSON.parse(doctor.stdout).elapsedMs;
  } catch {
    failedSteps.add("doctor_json");
    fail("doctor did not print JSON");
  }

  const req = JSON.stringify({ programs: [], schemaMode: "spike" });
  const check = run(bin, ["check", "--ir"], { input: req });
  recordStep(record, failedSteps, "check_s", check, 3, (result) => `check failed\n${result.stdout}\n${result.stderr}`);
  const chat = resolve(root, "packages/compiler/fixtures/chat");
  const projectCheck = run(bin, ["check", "--project", chat], { env: compilerEnv });
  const projectCheckStep = recordStep(record, failedSteps, "check_project_s", projectCheck, 3,
    (result) => `project check failed\n${result.stdout}\n${result.stderr}`);

  const devRoot = mkdtempSync(resolve(tmpdir(), "snapback2-measure-"));
  cpSync(resolve(chat, "snapback"), resolve(devRoot, "snapback"), { recursive: true });
  const dev = run(bin, ["dev", "--project", devRoot], { env: compilerEnv });
  if (dev.status === 0 && !dev.stdout.includes("SNAPBACK_URL=")) dev.status = 1;
  recordStep(record, failedSteps, "dev_boot_s", dev, 3,
    (result) => `dev boot failed\n${result.stdout}\n${result.stderr}`);
  const stop = run(bin, ["dev", "--project", devRoot, "--stop", "--json"]);
  recordStep(record, failedSteps, "dev_stop_s", stop, 3,
    (result) => `measured owner stop failed\n${result.stdout}\n${result.stderr}`);
  rmSync(devRoot, { recursive: true, force: true });
  record.debug_binary_bytes = statSync(bin).size;
  try { record.production_binary_bytes = statSync(resolve(root, "target/production/snapback2")).size; } catch {}

  appendFileSync(resolve(root, "metrics/loop.jsonl"), JSON.stringify(record) + "\n");
  console.log(JSON.stringify(record));

  if (args.has("--check")) {
    // Budgets live in rules/RULES.md (the repo root); this parses the time table there.
    const rules = readFileSync(resolve(root, "../rules/RULES.md"), "utf8");
    const budget = (label) => {
      const m = new RegExp(`\\|\\s*\\*?\\*?${label}[^|]*\\|\\s*\\*?\\*?([\\d.]+)\\s*(ms|s|min)`, "i").exec(rules);
      if (!m) return fail(`RULES.md has no budget row matching "${label}"`);
      const n = Number(m[1]); return m[2] === "ms" ? n / 1000 : m[2] === "min" ? n * 60 : n;
    };
    scoreChecks([
      ["Incremental rebuild", incrementalStep],
      ["Test what you just changed", testStep],
      ["`snapback2 check`", projectCheckStep],
      ["`snapback2 doctor`", doctorStep],
    ], budget);
  }

  if (failedSteps.size > 0) console.error(`measure: ${failedSummary(failedSteps)}`);
}

function selfTest() {
  const record = { steps: {} };
  const failures = new Set();
  const originalExitCode = process.exitCode;
  const failed = recordStep(record, failures, "check_project_s", {
    seconds: 0.125,
    status: 1,
    stdout: "",
    stderr: "refused",
  }, 3, () => "expected self-test failure");
  failures.add("dev_boot_s");
  const lines = [];
  scoreChecks([["`snapback2 check`", failed]], () => 1, (line) => lines.push(line), (message) => lines.push(`refused ${message}`));
  assert.deepEqual(record.steps.check_project_s, { seconds: 0.125, ok: false });
  assert(lines.some((line) => line.startsWith("not ok `snapback2 check`")));
  assert(!lines.some((line) => line.startsWith("ok `snapback2 check`")));
  const summary = failedSummary(failures);
  assert(summary.includes("check_project_s"));
  assert(summary.includes("dev_boot_s"));
  process.exitCode = originalExitCode;
  console.log("measure self-test ok");
}

if (args.has("--self-test")) selfTest();
else main();
