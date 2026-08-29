#!/usr/bin/env node
// Measure the loop, every time. Appends one JSON line per run to metrics/loop.jsonl.
// `--check` fails when a measured number exceeds the budget in rules/RULES.md.
// `--cold` also measures a cold build (cargo clean first) — slow, opt-in.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, statSync, utimesSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const run = (cmd, argv, opts = {}) => {
  const t0 = performance.now();
  const r = spawnSync(cmd, argv, { cwd: root, encoding: "utf8", ...opts });
  return { seconds: (performance.now() - t0) / 1000, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const fail = (msg) => { console.error(`measure: ${msg}`); process.exitCode = 1; };
const record = { at: new Date().toISOString(), sha: run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim() };

if (args.has("--cold")) {
  run("cargo", ["clean", "-q"]);
  const cold = run("cargo", ["build", "-q"]);
  if (cold.status !== 0) fail(`cold build failed\n${cold.stderr}`);
  record.cold_build_s = +cold.seconds.toFixed(2);
}
// Warm, then a one-line-edit proxy: bump the mtime of a core source file and rebuild.
let warm = run("cargo", ["build", "-q"]);
if (warm.status !== 0) fail(`warm build failed\n${warm.stderr}`);
record.warm_build_s = +warm.seconds.toFixed(2);
const touched = resolve(root, "crates/snapback2-core/src/value.rs");
const now = new Date(); utimesSync(touched, now, now);
const incr = run("cargo", ["build", "-q"]);
if (incr.status !== 0) fail(`incremental build failed\n${incr.stderr}`);
record.incremental_build_s = +incr.seconds.toFixed(2);

const test = run("cargo", ["test", "-q", "-p", "snapback2-core"]);
if (test.status !== 0) fail(`core tests failed\n${test.stdout}\n${test.stderr}`);
record.test_s = +test.seconds.toFixed(2);

const bin = resolve(root, "target/debug/snapback2");
const doctor = run(bin, ["doctor", "--json"]);
if (doctor.status !== 0) fail(`doctor failed\n${doctor.stderr}`);
record.boot_s = +doctor.seconds.toFixed(3);
try { record.doctor_ms = JSON.parse(doctor.stdout).elapsedMs; } catch { fail("doctor did not print JSON"); }

const req = JSON.stringify({ programs: [], schemaMode: "spike" });
const check = run(bin, ["check"], { input: req });
if (check.status !== 0) fail(`check failed\n${check.stderr}`);
record.check_s = +check.seconds.toFixed(3);
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
  const checks = [
    ["Incremental rebuild", record.incremental_build_s],
    ["Test what you just changed", record.test_s],
    ["`snapback2 check`", record.check_s],
    ["`snapback2 doctor`", record.boot_s],
  ];
  for (const [label, value] of checks) {
    const max = budget(label);
    if (max === undefined) continue;
    if (value > max) fail(`${label}: ${value}s over budget ${max}s`);
    else console.log(`ok ${label}: ${value}s ≤ ${max}s`);
  }
}
