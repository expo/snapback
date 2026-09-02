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
const testTemplates = ["todos", "chat"];
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
  if (result?.samples) {
    step.samples = result.samples.map((sample) => ({
      seconds: +sample.seconds.toFixed(digits),
      ok: sample.status === 0,
    }));
  }
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
    let max;
    try {
      max = budget(label);
    } catch (error) {
      failedSteps.add(label);
      refuse(`${label}: ${errorText(error)}`);
      continue;
    }
    const samples = step.samples ?? [step];
    for (const [index, sample] of samples.entries()) {
      const sampleLabel = step.samples ? `${label} sample ${index + 1}` : label;
      if (!sample.ok) {
        failedSteps.add(label);
        report(`not ok ${sampleLabel}: step failed (${sample.seconds}s)`);
        continue;
      }
      if (max === undefined) continue;
      if (sample.seconds > max) {
        failedSteps.add(label);
        refuse(`${sampleLabel}: ${sample.seconds}s over budget ${max}s`);
      } else {
        report(`ok ${sampleLabel}: ${sample.seconds}s ≤ ${max}s`);
      }
    }
  }
}

function testVerdict(result, allowEffectsBlocked) {
  let receipt;
  try {
    receipt = JSON.parse(result.stdout);
  } catch {
    return { accepted: false, verdict: "invalid receipt" };
  }
  if (result.status === 0 && receipt.verdict === "pass") {
    return { accepted: true, verdict: "pass" };
  }
  const effects = Array.isArray(receipt.checks)
    ? receipt.checks.find((check) => check.name === "effects")
    : undefined;
  const onlyEffectsBlocked = Array.isArray(receipt.checks)
    && receipt.checks.every((check) => check === effects
      ? check.verdict === "blocked"
      : check.verdict === "pass");
  if (allowEffectsBlocked && result.status === 1 && receipt.verdict === "blocked"
    && onlyEffectsBlocked && effects?.verdict === "blocked"
    && effects?.detail?.reason === "no engine in this build") {
    return { accepted: true, verdict: "blocked", blocked: "effects" };
  }
  return { accepted: false, verdict: receipt.verdict ?? "missing" };
}

const failedSummary = (failedSteps) => `failed steps: ${[...failedSteps].join(", ")}`;

function main() {
  const failedSteps = new Set();
  const record = {
    at: new Date().toISOString(),
    sha: run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim(),
    steps: {},
  };
  const buildArgs = ["build", "-q", "--release"];

  if (args.has("--cold")) {
    recordStep(record, failedSteps, "cold_build_s", () => {
      const clean = run("cargo", ["clean", "-q"]);
      if (clean.status !== 0) return clean;
      return run("cargo", buildArgs);
    }, 2, (result) => `cold clean/build failed\n${result.stderr ?? ""}`);
  }
  // Warm, then a one-line-edit proxy: bump the mtime of a core source file and rebuild.
  recordStep(record, failedSteps, "warm_build_s", () => run("cargo", buildArgs), 2,
    (result) => `warm build failed\n${result.stderr ?? ""}`);

  const bin = resolve(root, "target/release/snapback2");
  const compiler = resolve(root, "packages/snapback2/dist/compiler.mjs");
  recordStep(record, failedSteps, "package_build_s",
    () => run("node", ["build.mjs"], { cwd: resolve(root, "packages/snapback2") }), 3,
    (result) => `package build failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const packageDist = resolve(root, "packages/snapback2/dist");
  const compilerEnv = {
    ...process.env,
    SNAPBACK2_COMPILER: compiler,
    SNAPBACK2_GUIDE: resolve(packageDist, "guide"),
    SNAPBACK2_TEMPLATES: resolve(packageDist, "templates"),
    SNAPBACK2_TEST_RUNNER: resolve(packageDist, "test-runner.mjs"),
  };
  // Measure before the incremental relink and the CPU-heavy core tests. Both
  // adjacent samples still have to pass; unrelated teardown cannot hide one.
  const doctor = recordStep(record, failedSteps, "boot_s", () => {
    const samples = [
      run(bin, ["doctor", "--json"], { env: compilerEnv }),
      run(bin, ["doctor", "--json"], { env: compilerEnv }),
    ];
    const slowest = samples.toSorted((left, right) => right.seconds - left.seconds)[0];
    const reports = samples.map((sample) => JSON.parse(sample.stdout));
    return {
      ...slowest,
      status: samples.every((sample) => sample.status === 0) ? 0 : 1,
      samples,
      doctorMs: Math.max(...reports.map((report) => report.elapsedMs)),
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

  const touched = resolve(root, "crates/snapback2-core/src/value.rs");
  const incremental = recordStep(record, failedSteps, "incremental_build_s", () => {
    const now = new Date();
    utimesSync(touched, now, now);
    return run("cargo", buildArgs);
  }, 2, (result) => `incremental build failed\n${result.stderr ?? ""}`);

  const coreTest = recordStep(record, failedSteps, "core_test_s",
    () => run("cargo", ["test", "-q", "-p", "snapback2-core"]), 2,
    (result) => `core tests failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);

  const req = JSON.stringify({ programs: [], schemaMode: "spike" });
  recordStep(record, failedSteps, "check_s", () => run(bin, ["check", "--ir"], { input: req }), 3,
    (result) => `check failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const chat = resolve(root, "packages/compiler/fixtures/quarry-chat");
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
    record.debug_binary_bytes = statSync(resolve(root, "target/debug/snapback2")).size;
    record.release_binary_bytes = statSync(bin).size;
    return { status: 0 };
  }, 3, () => "cannot stat debug binary");

  let initRoot;
  const initToDev = recordStep(record, failedSteps, "init_to_dev_s", () => {
    initRoot = mkdtempSync(resolve(tmpdir(), "snapback2-init-measure-"));
    const started = performance.now();
    const initialized = run(bin, ["init", initRoot, "--template", "chat", "--client", "none", "--json"], { env: compilerEnv });
    const initializedDev = run(bin, ["dev", "--project", initRoot], { env: compilerEnv });
    if (initializedDev.status === 0 && !initializedDev.stdout.includes("SNAPBACK_URL=")) initializedDev.status = 1;
    return {
      seconds: (performance.now() - started) / 1000,
      status: initialized.status === 0 && initializedDev.status === 0 ? 0 : 1,
      stdout: `${initialized.stdout}\n${initializedDev.stdout}`,
      stderr: `${initialized.stderr}\n${initializedDev.stderr}`,
    };
  }, 3, (result) => `init to dev failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  recordStep(record, failedSteps, "init_dev_stop_s", () => {
    if (!initRoot) throw new Error("init root setup failed");
    return run(bin, ["dev", "--project", initRoot, "--stop", "--json"]);
  }, 3, (result) => `initialized owner stop failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  recordStep(record, failedSteps, "init_cleanup_s", () => {
    if (initRoot) rmSync(initRoot, { recursive: true, force: true });
    return { status: 0 };
  }, 3, () => "initialized owner cleanup failed");

  const productTestSteps = [];
  for (const template of testTemplates) {
    let productTestRoot;
    const initialized = recordStep(record, failedSteps, `test_${template}_init_s`, () => {
      productTestRoot = mkdtempSync(resolve(tmpdir(), `snapback2-test-${template}-measure-`));
      return run(bin, ["init", productTestRoot, "--template", template, "--client", "none", "--json"], { env: compilerEnv });
    }, 3, (result) => `${template} init failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    let verdict = { accepted: false, verdict: "not run" };
    const measured = recordStep(record, failedSteps, `test_${template}_s`, () => {
      if (!productTestRoot) throw new Error(`${template} test root setup failed`);
      const result = run(bin, ["test", "--project", productTestRoot, "--json"], { env: compilerEnv });
      verdict = testVerdict(result, template === "chat");
      return {
        ...result,
        status: initialized.step.ok && verdict.accepted ? 0 : 1,
      };
    }, 3, (result) => `${template} template test verdict ${verdict.verdict} was not acceptable\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    measured.step.verdict = verdict.verdict;
    if (verdict.blocked) measured.step.blocked = verdict.blocked;
    record[`test_${template}_verdict`] = verdict.verdict;
    productTestSteps.push([`snapback2 test (${template})`, measured.step]);
    recordStep(record, failedSteps, `test_${template}_cleanup_s`, () => {
      if (productTestRoot) rmSync(productTestRoot, { recursive: true, force: true });
      return { status: 0 };
    }, 3, () => `${template} template cleanup failed`);
  }
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
      ["Test what you just changed", coreTest.step],
      ["`snapback2 check`", projectCheck.step],
      ["`snapback2 doctor`", doctor.step],
    ], budget, failedSteps);
    scoreChecks([
      ["init → dev", initToDev.step],
      ...productTestSteps,
    ], (label) => label === "init → dev" ? 10 : 30, failedSteps);
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
  const sampled = recordStep(record, failures, "boot_s", () => ({
    seconds: 0.4,
    status: 0,
    samples: [
      { seconds: 0.4, status: 0 },
      { seconds: 0.6, status: 0 },
    ],
  }), 3, () => "unreachable");
  failures.add("dev_boot_s");
  const lines = [];
  scoreChecks([
    ["`snapback2 check`", failed.step],
    ["`snapback2 doctor`", sampled.step],
  ], (label) => label.includes("doctor") ? 0.5 : 1, failures,
    (line) => lines.push(line), (message) => lines.push(`refused ${message}`));
  assert.deepEqual(record.steps.check_project_s, {
    seconds: 0.125,
    ok: false,
    error: "expected self-test failure",
  });
  assert.equal(record.steps.incremental_build_s.ok, false);
  assert.match(record.steps.incremental_build_s.error, /EPERM/);
  assert.deepEqual(record.steps.later_step_s, { seconds: 0.25, ok: true });
  assert.deepEqual(record.steps.boot_s.samples, [
    { seconds: 0.4, ok: true },
    { seconds: 0.6, ok: true },
  ]);
  assert(lines.some((line) => line.startsWith("not ok `snapback2 check`")));
  assert(!lines.some((line) => line.startsWith("ok `snapback2 check`")));
  assert(lines.some((line) => line.includes("`snapback2 doctor` sample 2: 0.6s over budget 0.5s")));
  const summary = failedSummary(failures);
  assert(summary.includes("check_project_s"));
  assert(summary.includes("dev_boot_s"));
  assert.deepEqual(testTemplates, ["todos", "chat"]);
  assert.deepEqual(
    testVerdict({ status: 0, stdout: JSON.stringify({ verdict: "pass", checks: [] }) }, false),
    { accepted: true, verdict: "pass" },
  );
  assert.deepEqual(
    testVerdict({
      status: 1,
      stdout: JSON.stringify({
        verdict: "blocked",
        checks: [{ name: "effects", verdict: "blocked", detail: { reason: "no engine in this build" } }],
      }),
    }, true),
    { accepted: true, verdict: "blocked", blocked: "effects" },
  );
  assert.equal(testVerdict({ status: 1, stdout: "{}" }, true).accepted, false);
  process.exitCode = originalExitCode;
  console.log("measure self-test ok");
}

if (args.has("--self-test")) selfTest();
else main();
