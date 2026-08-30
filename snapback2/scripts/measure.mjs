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

const errorText = (error) => error instanceof Error ? error.message : String(error);

function recordStep(record, failedSteps, name, operation, digits, failure) {
  const started = performance.now();
  let result;
  let caught;
  try {
    result = operation();
  } catch (error) {
    caught = errorText(error);
  }
  const elapsed = (performance.now() - started) / 1000;
  const seconds = +(result?.seconds ?? elapsed).toFixed(digits);
  const ok = caught === undefined && result?.status === 0;
  const error = caught ?? (ok ? undefined : failure(result ?? {}));
  const step = { seconds, ok };
  if (error !== undefined) step.error = error;
  record[name] = seconds;
  record.steps[name] = step;
  if (!step.ok) {
    failedSteps.add(name);
    fail(error);
  }
  return { step, result };
}

function scoreChecks(checks, budget, failedSteps, report = console.log, refuse = fail) {
  for (const [label, step] of checks) {
    if (!step.ok) {
      failedSteps.add(label);
      report(`not ok ${label}: step failed (${step.seconds}s)`);
      continue;
    }
    let max;
    try {
      max = budget(label);
    } catch (error) {
      failedSteps.add(label);
      refuse(`${label}: ${errorText(error)}`);
      continue;
    }
    if (max === undefined) continue;
    if (step.seconds > max) {
      failedSteps.add(label);
      refuse(`${label}: ${step.seconds}s over budget ${max}s`);
    }
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
    recordStep(record, failedSteps, "cold_build_s", () => {
      const clean = run("cargo", ["clean", "-q"]);
      if (clean.status !== 0) return clean;
      return run("cargo", ["build", "-q"]);
    }, 2, (result) => `cold clean/build failed\n${result.stderr ?? ""}`);
  }
  // Warm, then a one-line-edit proxy: bump the mtime of a core source file and rebuild.
  recordStep(record, failedSteps, "warm_build_s", () => run("cargo", ["build", "-q"]), 2,
    (result) => `warm build failed\n${result.stderr ?? ""}`);
  const touched = resolve(root, "crates/snapback2-core/src/value.rs");
  const incremental = recordStep(record, failedSteps, "incremental_build_s", () => {
    const now = new Date();
    utimesSync(touched, now, now);
    return run("cargo", ["build", "-q"]);
  }, 2, (result) => `incremental build failed\n${result.stderr ?? ""}`);

  const test = recordStep(record, failedSteps, "test_s",
    () => run("cargo", ["test", "-q", "-p", "snapback2-core"]), 2,
    (result) => `core tests failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);

  const bin = resolve(root, "target/debug/snapback2");
  const compiler = resolve(root, "packages/snapback2/dist/compiler.mjs");
  const compilerEnv = { ...process.env, SNAPBACK2_COMPILER: compiler };
  // Take the better of two adjacent runs so post-test scheduler/pipe teardown
  // noise is not mistaken for the binary's boot-to-ready latency.
  const doctor = recordStep(record, failedSteps, "boot_s", () => {
    const samples = [
      run(bin, ["doctor", "--json"], { env: compilerEnv }),
      run(bin, ["doctor", "--json"], { env: compilerEnv }),
    ];
    const best = samples.toSorted((left, right) => left.seconds - right.seconds)[0];
    const parsed = JSON.parse(best.stdout);
    return {
      ...best,
      status: samples.every((sample) => sample.status === 0) ? 0 : 1,
      samples,
      doctorMs: parsed.elapsedMs,
    };
  }, 3, (result) => {
    const failed = result.samples?.filter((sample) => sample.status !== 0) ?? [];
    return `doctor failed\n${failed.map((sample) => `${sample.stdout}\n${sample.stderr}`).join("\n")}`;
  });
  if (doctor.result?.samples) {
    record.doctor_samples_s = doctor.result.samples.map((sample) => ({
      seconds: +sample.seconds.toFixed(3),
      ok: sample.status === 0,
    }));
    record.doctor_ms = doctor.result.doctorMs;
  }

  const req = JSON.stringify({ programs: [], schemaMode: "spike" });
  recordStep(record, failedSteps, "check_s", () => run(bin, ["check", "--ir"], { input: req }), 3,
    (result) => `check failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const chat = resolve(root, "packages/compiler/fixtures/chat");
  const projectCheck = recordStep(record, failedSteps, "check_project_s",
    () => run(bin, ["check", "--project", chat], { env: compilerEnv }), 3,
    (result) => `project check failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);

  let devRoot;
  recordStep(record, failedSteps, "dev_boot_s", () => {
    devRoot = mkdtempSync(resolve(tmpdir(), "snapback2-measure-"));
    cpSync(resolve(chat, "snapback"), resolve(devRoot, "snapback"), { recursive: true });
    const result = run(bin, ["dev", "--project", devRoot], { env: compilerEnv });
    if (result.status === 0 && !result.stdout.includes("SNAPBACK_URL=")) result.status = 1;
    return result;
  }, 3, (result) => `dev boot failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  recordStep(record, failedSteps, "dev_stop_s", () => {
    if (!devRoot) throw new Error("dev root setup failed");
    return run(bin, ["dev", "--project", devRoot, "--stop", "--json"]);
  }, 3, (result) => `measured owner stop failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  recordStep(record, failedSteps, "dev_cleanup_s", () => {
    if (devRoot) rmSync(devRoot, { recursive: true, force: true });
    return { status: 0 };
  }, 3, () => "measured owner cleanup failed");
  recordStep(record, failedSteps, "debug_binary_stat_s", () => {
    record.debug_binary_bytes = statSync(bin).size;
    return { status: 0 };
  }, 3, () => "cannot stat debug binary");
  try { record.production_binary_bytes = statSync(resolve(root, "target/production/snapback2")).size; } catch {}

  try {
    appendFileSync(resolve(root, "metrics/loop.jsonl"), JSON.stringify(record) + "\n");
  } catch (error) {
    const message = errorText(error);
    record.steps.metrics_append = { ok: false, error: message };
    failedSteps.add("metrics_append");
    fail(message);
  }
  console.log(JSON.stringify(record));

  if (args.has("--check")) {
    // Budgets live in rules/RULES.md (the repo root); this parses the time table there.
    let rules = "";
    try {
      rules = readFileSync(resolve(root, "../rules/RULES.md"), "utf8");
    } catch (error) {
      failedSteps.add("rules_read");
      fail(`cannot read RULES.md: ${errorText(error)}`);
    }
    const budget = (label) => {
      const m = new RegExp(`\\|\\s*\\*?\\*?${label}[^|]*\\|\\s*\\*?\\*?([\\d.]+)\\s*(ms|s|min)`, "i").exec(rules);
      if (!m) throw new Error(`RULES.md has no budget row matching "${label}"`);
      const n = Number(m[1]); return m[2] === "ms" ? n / 1000 : m[2] === "min" ? n * 60 : n;
    };
    scoreChecks([
      ["Incremental rebuild", incremental.step],
      ["Test what you just changed", test.step],
      ["`snapback2 check`", projectCheck.step],
      ["`snapback2 doctor`", doctor.step],
    ], budget, failedSteps);
  }

  if (failedSteps.size > 0) console.error(`measure: ${failedSummary(failedSteps)}`);
}

function selfTest() {
  const record = { steps: {} };
  const failures = new Set();
  const originalExitCode = process.exitCode;
  const failed = recordStep(record, failures, "check_project_s", () => ({
    seconds: 0.125,
    status: 1,
    stdout: "",
    stderr: "refused",
  }), 3, () => "expected self-test failure");
  recordStep(record, failures, "incremental_build_s", () => {
    throw new Error("simulated utimesSync EPERM");
  }, 3, () => "unreachable");
  recordStep(record, failures, "later_step_s", () => ({ seconds: 0.25, status: 0 }), 3,
    () => "unreachable");
  failures.add("dev_boot_s");
  const lines = [];
  scoreChecks([["`snapback2 check`", failed.step]], () => 1, failures,
    (line) => lines.push(line), (message) => lines.push(`refused ${message}`));
  assert.deepEqual(record.steps.check_project_s, {
    seconds: 0.125,
    ok: false,
    error: "expected self-test failure",
  });
  assert.equal(record.steps.incremental_build_s.ok, false);
  assert.match(record.steps.incremental_build_s.error, /EPERM/);
  assert.deepEqual(record.steps.later_step_s, { seconds: 0.25, ok: true });
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
