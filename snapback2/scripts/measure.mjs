#!/usr/bin/env node
// Measure the loop, every time. Appends one JSON line per run to metrics/loop.jsonl.
// `--check` fails when a measured number exceeds the budget in rules/RULES.md.
// `--cold` also measures a cold build (cargo clean first) — slow, opt-in.
import { packDevelopmentConsumer, receiptVerdict as testVerdict } from "./consumer-smoke.mjs";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  appendFileSync, cpSync, existsSync, linkSync, mkdtempSync, readFileSync,
  renameSync, rmSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";

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

const failedSummary = (failedSteps) => `failed steps: ${[...failedSteps].join(", ")}`;

const byteFields = ["client_gzip_bytes", "react_gzip_bytes", "expo_gzip_bytes", "runtime_gzip_bytes"];
const byteToolchain = { node: "v24.18.0", esbuild: "0.25.9", gzipLevel: 9 };
const byteFormat = "packaged-esm-closure-gzip-v1";
const comparableToolchain = toolchain => Object.entries(byteToolchain).every(([key, value]) => toolchain?.[key] === value);
const validByteValues = record => byteFields.every(field => Number.isSafeInteger(record[field]) && record[field] > 0);
const comparableBytes = record => comparableToolchain(record.byte_toolchain) && record.byte_format === byteFormat;

function publishByteMeasurements(record, values, toolchain, ok) {
  // Keep rejected evidence separate from the fields that comparisons may trust.
  record.byte_measurement = { values, toolchain, format: byteFormat, ok };
  if (!comparableToolchain(toolchain)) {
    throw new Error(`byte measurements require Node 24.18.0 / esbuild 0.25.9 / gzip 9: ${JSON.stringify(toolchain)}`);
  }
  if (!ok) return;
  assert(validByteValues(values), "all four byte measurements must be positive integers");
  Object.assign(record, values, { byte_toolchain: toolchain, byte_format: byteFormat });
}

function packagedEntryBytes(directory, entry) {
  const ts = createRequire(resolve(directory, "../package.json"))("typescript");
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return 0;
    seen.add(path);
    const source = readFileSync(path, "utf8");
    let bytes = gzipSync(source, { level: 9 }).length;
    for (const statement of ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).statements) {
      const specifier = statement.moduleSpecifier?.text;
      if (specifier?.startsWith(".")) bytes += visit(resolve(dirname(path), specifier));
      else if (specifier?.startsWith("snapback2/")) bytes += visit(resolve(directory, `${specifier.slice(10)}.mjs`));
    }
    return bytes;
  }
  return visit(resolve(directory, `${entry}.mjs`));
}

function scoreBytes(record, history, failedSteps, report = console.log, refuse = fail) {
  const previous = history.findLast(row => row.byte_baseline_accepted === true && comparableBytes(row)
    && row.steps?.package_build_s?.ok === true && row.steps?.package_bytes_s?.ok === true && validByteValues(row));
  for (const field of byteFields) {
    const value = record[field];
    if (!Number.isSafeInteger(value) || value <= 0) {
      failedSteps.add(field);
      refuse(`${field}: missing measurement`);
      continue;
    }
    if (!comparableBytes(record) || record.steps?.package_bytes_s?.ok !== true || record.steps?.package_build_s?.ok !== true) {
      failedSteps.add(field);
      refuse(`${field}: measurement failed or is not comparable`);
      continue;
    }
    if (previous === undefined) report(`ok ${field}: ${value} bytes (first accepted comparable record)`);
    else if (value > previous[field] * 1.01) {
      failedSteps.add(field);
      refuse(`${field}: ${value} bytes exceeds ${previous[field]} by more than 1%`);
    } else report(`ok ${field}: ${value} bytes ≤ ${previous[field]} + 1%`);
  }
}

function preserveUnchangedExecutable(executable, operation, platform = process.platform) {
  if (platform !== "darwin" || !existsSync(executable)) return operation();
  const started = performance.now();
  const suffix = `.measure-${process.pid}-${Date.now()}`;
  const preserved = `${executable}${suffix}-preserved`;
  const replacement = `${executable}${suffix}-replacement`;
  try {
    linkSync(executable, preserved);
  } catch {
    return operation();
  }
  let result;
  try {
    result = operation();
    if (result.status === 0 && existsSync(executable)
      && readFileSync(executable).equals(readFileSync(preserved))) {
      // A no-op Cargo build replaces this path with byte-identical output on
      // macOS. Keep the prior inode so first-exec policy work is not charged to
      // doctor. Changed output keeps Cargo's new inode and its real launch cost.
      renameSync(executable, replacement);
      renameSync(preserved, executable);
      rmSync(replacement, { force: true });
    }
  } finally {
    if (result?.status !== 0 && existsSync(preserved)) {
      rmSync(executable, { force: true });
      renameSync(preserved, executable);
    } else if (!existsSync(executable)) {
      if (existsSync(replacement)) {
        renameSync(replacement, executable);
      } else if (existsSync(preserved)) {
        renameSync(preserved, executable);
      }
    }
    rmSync(preserved, { force: true });
    rmSync(replacement, { force: true });
  }
  return {
    ...result,
    seconds: (performance.now() - started) / 1000,
  };
}

function main() {
  const failedSteps = new Set();
  const record = {
    at: new Date().toISOString(),
    sha: run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim(),
    steps: {},
    ...Object.fromEntries(byteFields.map(field => [field, null])),
  };
  const historyPath = resolve(root, "metrics/loop.jsonl");
  const history = existsSync(historyPath) ? readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  // The chat template's image columns require the sibling media helper at boot.
  const buildArgs = ["build", "-q", "--release", "-p", "snapback2", "-p", "snapback2-media"];
  const bin = resolve(root, "target/release/snapback2");

  if (args.has("--cold")) {
    recordStep(record, failedSteps, "cold_build_s", () => {
      const clean = run("cargo", ["clean", "-q"]);
      if (clean.status !== 0) return clean;
      return run("cargo", buildArgs);
    }, 2, (result) => `cold clean/build failed\n${result.stderr ?? ""}`);
  }
  // Warm, then a one-line-edit proxy: bump the mtime of a core source file and rebuild.
  recordStep(record, failedSteps, "warm_build_s",
    () => preserveUnchangedExecutable(bin, () => run("cargo", buildArgs)), 2,
    (result) => `warm build failed\n${result.stderr ?? ""}`);

  const compiler = resolve(root, "packages/snapback2/dist/compiler.mjs");
  recordStep(record, failedSteps, "package_build_s",
    () => run(process.execPath, ["build.mjs"], { cwd: resolve(root, "packages/snapback2") }), 3,
    (result) => `package build failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const packageDist = resolve(root, "packages/snapback2/dist");
  recordStep(record, failedSteps, "package_bytes_s", () => {
    const values = {};
    for (const entry of ["client", "react", "expo"]) {
      values[`${entry}_gzip_bytes`] = packagedEntryBytes(packageDist, entry);
    }
    const measured = run(process.execPath, ["build.mjs", "--measure-twin"], { cwd: resolve(root, "packages/snapback2") });
    const runtime = JSON.parse(measured.stdout);
    values.runtime_gzip_bytes = runtime.gzip;
    publishByteMeasurements(record, values, runtime.toolchain, measured.status === 0 && record.steps.package_build_s.ok);
    return measured;
  }, 3, result => `package byte measurement failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
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
    return preserveUnchangedExecutable(bin, () => run("cargo", buildArgs));
  }, 2, (result) => `incremental build failed\n${result.stderr ?? ""}`);

  const consumer = recordStep(record, failedSteps, "consumer_smoke_s",
    () => packDevelopmentConsumer(root, bin), 2,
    (result) => `installed consumer failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (consumer.result?.steps) record.consumer = consumer.result.steps;

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

  try { record.production_binary_bytes = statSync(resolve(root, "target/production/snapback2")).size; } catch {}

  if (args.has("--check")) {
    scoreBytes(record, history, failedSteps);
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
      ["Full build, warm cache", record.steps.warm_build_s],
      ["Incremental rebuild", incremental.step],
      ["Test what you just changed", consumer.step],
      ["`snapback2 check`", projectCheck.step],
      ["`snapback2 doctor`", doctor.step],
    ], budget, failedSteps);
    scoreChecks([
      ["init → dev", initToDev.step],
    ], (label) => label === "init → dev" ? 10 : 30, failedSteps);
  }

  // Score before appending: a rejected regression can never approve its own retry.
  record.byte_baseline_accepted = args.has("--check") && failedSteps.size === 0;
  try {
    appendFileSync(historyPath, JSON.stringify(record) + "\n");
  } catch (error) {
    const message = errorText(error);
    record.steps.metrics_append = { ok: false, error: message };
    failedSteps.add("metrics_append");
    fail(message);
  }
  console.log(JSON.stringify(record));
  if (failedSteps.size > 0) console.error(`measure: ${failedSummary(failedSteps)}`);
}

function selfTest() {
  const byteLines = [];
  const values = n => Object.fromEntries(byteFields.map(field => [field, n]));
  const candidate = n => ({ ...values(n), byte_toolchain: byteToolchain, byte_format: byteFormat,
    steps: { package_build_s: { ok: true }, package_bytes_s: { ok: true } } });
  const accepted = n => ({ ...candidate(n), byte_baseline_accepted: true });
  const score = (record, history) => {
    const failures = new Set();
    scoreBytes(record, history, failures, line => byteLines.push(line), line => byteLines.push(line));
    record.byte_baseline_accepted = failures.size === 0;
    return [...failures];
  };
  const baseline = accepted(100);
  assert.deepEqual(score(candidate(101), [baseline]), [], "exactly 1% growth passes");
  const rejected = candidate(102);
  assert.deepEqual(score(rejected, [baseline]), byteFields, "all four regressions report");
  assert.deepEqual(score(candidate(102), [baseline, rejected]), byteFields, "an unchanged retry still fails");
  assert.deepEqual(score(candidate(103), [baseline, accepted(102)]), [], "latest accepted comparable baseline wins");
  for (const amount of [90, 110]) {
    const incompatible = { steps: { package_build_s: { ok: true }, package_bytes_s: { ok: false } } };
    const toolchain = { ...byteToolchain, node: "v26.7.0" };
    assert.throws(() => publishByteMeasurements(incompatible, values(amount), toolchain, true), /require Node 24/);
    assert(byteFields.every(field => incompatible[field] === undefined), "incompatible values are never published as trusted fields");
    assert.deepEqual(incompatible.byte_measurement.values, values(amount), "rejected evidence is retained");
    // Even a historical writer that published incompatible values and marked them accepted is excluded.
    const poisoned = { ...accepted(amount), byte_toolchain: toolchain };
    assert.deepEqual(score(candidate(102), [baseline, incompatible, poisoned]), byteFields, "incompatible high history cannot hide regression");
    assert.deepEqual(score(candidate(100), [baseline, incompatible, poisoned]), [], "incompatible low history cannot invent regression");
  }
  for (const step of ["package_build_s", "package_bytes_s"]) {
    const failed = accepted(110);
    failed.steps[step].ok = false;
    assert.deepEqual(score(candidate(102), [baseline, failed]), byteFields, "failed measurement/build is not a baseline");
    assert.deepEqual(score(failed, [baseline]), byteFields, "failed current measurement cannot pass");
  }
  const ceilingFailure = {};
  publishByteMeasurements(ceilingFailure, { ...values(100), runtime_gzip_bytes: 84080 }, byteToolchain, false);
  assert.equal(ceilingFailure.runtime_gzip_bytes, undefined, "a ceiling refusal publishes no trusted values");
  assert.equal(ceilingFailure.byte_measurement.values.runtime_gzip_bytes, 84080, "a ceiling refusal retains raw evidence");
  assert.deepEqual(score(candidate(102), [baseline, ceilingFailure]), byteFields);
  const legacy = { ...values(110), byte_toolchain: byteToolchain, steps: { package_bytes_s: { ok: false } } };
  assert.deepEqual(score(candidate(102), [baseline, legacy, {}, { ...accepted(110), client_gzip_bytes: null },
    { ...accepted(110), byte_format: "leaf-gzip" }]), byteFields, "legacy, incomplete and differently scoped records are not baselines");
  assert.deepEqual(score({ ...candidate(100), client_gzip_bytes: null }, [baseline]), ["client_gzip_bytes"]);
  assert.deepEqual(score(candidate(100), [legacy]), [], "first comparable run ignores failed parent-SHA evidence");
  assert.equal(byteLines.filter(line => line.includes("first accepted comparable record")).length, 4);
  const published = { steps: { package_build_s: { ok: true }, package_bytes_s: { ok: true } } };
  publishByteMeasurements(published, values(100), byteToolchain, true);
  assert.deepEqual(score(published, [baseline]), [], "valid measurement is published and scored");
  console.log("byte baseline self-test ok: boundary, regression, retry, accepted, incompatible high/low, failed build/measurement, ceiling, legacy, missing, scope and publication");
  const artifactRoot = mkdtempSync(resolve(tmpdir(), "snapback2-measure-artifact-"));
  const artifact = resolve(artifactRoot, "snapback2");
  writeFileSync(artifact, "same bytes");
  const stableInode = statSync(artifact).ino;
  const replaceArtifact = (contents) => {
    rmSync(artifact);
    writeFileSync(artifact, contents);
    return { status: 0, stdout: "", stderr: "" };
  };
  preserveUnchangedExecutable(artifact, () => replaceArtifact("same bytes"), "darwin");
  assert.equal(statSync(artifact).ino, stableInode, "byte-identical build keeps its inode");
  preserveUnchangedExecutable(artifact, () => replaceArtifact("changed bytes"), "darwin");
  assert.notEqual(statSync(artifact).ino, stableInode, "changed build keeps its new inode");
  const recoverableInode = statSync(artifact).ino;
  const failedBuild = preserveUnchangedExecutable(artifact, () => {
    rmSync(artifact);
    writeFileSync(artifact, "failed output");
    return { status: 1, stdout: "", stderr: "build failed" };
  }, "darwin");
  assert.equal(failedBuild.status, 1);
  assert.equal(statSync(artifact).ino, recoverableInode, "failed build restores the prior artifact");
  assert.throws(() => preserveUnchangedExecutable(artifact, () => {
    rmSync(artifact);
    throw new Error("build threw");
  }, "darwin"), /build threw/);
  assert.equal(statSync(artifact).ino, recoverableInode, "thrown build restores the prior artifact");
  rmSync(artifactRoot, { recursive: true, force: true });

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
    ["Full build, warm cache", { seconds: 301, ok: true }],
    ["`snapback2 check`", failed.step],
    ["`snapback2 doctor`", sampled.step],
  ], (label) => label === "Full build, warm cache" ? 300 : label.includes("doctor") ? 0.5 : 1, failures,
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
  assert(lines.some((line) => line.includes("Full build, warm cache: 301s over budget 300s")));
  assert(failures.has("Full build, warm cache"));
  assert(lines.some((line) => line.includes("`snapback2 doctor` sample 2: 0.6s over budget 0.5s")));
  const summary = failedSummary(failures);
  assert(summary.includes("check_project_s"));
  assert(summary.includes("dev_boot_s"));
  assert.equal(testVerdict({ status: 0, stdout: JSON.stringify({ verdict: "pass", checks: [] }) }).accepted, false);
  assert.deepEqual(
    testVerdict({ status: 0, stdout: JSON.stringify({ verdict: "pass", checks: [{ name: "certify", verdict: "pass" }] }) }, false),
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
  assert.deepEqual(
    testVerdict({
      status: 1,
      stdout: JSON.stringify({
        verdict: "blocked",
        checks: [
          { name: "invalidation", verdict: "blocked", detail: { blocked: [
            { mutation: "messages.sendPhoto" }, { mutation: "messages.sendClip" },
          ] } },
          { name: "replay", verdict: "blocked", detail: { blocked: [
            { op: "messages.sendPhoto" }, { op: "messages.sendClip" },
          ] } },
        ],
      }),
    }, true),
    { accepted: false, verdict: "blocked" },
  );
  assert.equal(testVerdict({
    status: 1,
    stdout: JSON.stringify({
      verdict: "blocked",
      checks: [{ name: "messages.send", verdict: "blocked", detail: {} }],
    }),
  }, true).accepted, false);
  assert.equal(testVerdict({ status: 1, stdout: "{}" }, true).accepted, false);
  process.exitCode = originalExitCode;
  console.log("measure self-test ok");
}

if (args.has("--self-test")) selfTest();
else main();
