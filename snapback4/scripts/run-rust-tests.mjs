#!/usr/bin/env node
// Build the complete Cargo test inventory once, then run its independent test
// binaries concurrently. `cargo test --workspace` serializes those binaries,
// while starting one Cargo frontend per target makes them contend for Cargo's
// build lock. The artifact stream is Cargo's authoritative inventory, so a new
// target is included automatically rather than maintained in a parallel list.

import { availableParallelism } from "node:os";
import { spawn } from "node:child_process";

const requested = Number.parseInt(process.env.SNAPBACK4_RUST_TEST_PROCESSES ?? "", 10);
const processLimit = Number.isFinite(requested) && requested > 0
  ? requested
  : Math.min(24, Math.max(4, availableParallelism()));
const active = new Set();
let interrupted = null;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted ??= signal === "SIGINT" ? 130 : 143;
    for (const child of active) child.kill(signal);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    active.add(child);
    child.on("error", (error) => resolve({ code: 1, error }));
    child.on("close", (code, signal) => {
      active.delete(child);
      resolve({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
}

async function cargoArtifacts() {
  const artifacts = [];
  const child = spawn("cargo", ["test", "--workspace", "--no-run", "--message-format=json-render-diagnostics"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  active.add(child);
  child.stderr.pipe(process.stderr);
  let pending = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) inspectArtifactLine(line, artifacts);
  });
  const result = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: 1, error }));
    child.on("close", (code, signal) => {
      active.delete(child);
      resolve({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
  if (pending) inspectArtifactLine(pending, artifacts);
  return { ...result, artifacts: [...new Map(artifacts.map((artifact) => [artifact.executable, artifact])).values()] };
}

function inspectArtifactLine(line, artifacts) {
  try {
    const message = JSON.parse(line);
    if (message.reason === "compiler-message" && message.message?.rendered) {
      process.stderr.write(message.message.rendered);
    }
    if (message.reason === "compiler-artifact" && message.executable && message.profile?.test) {
      artifacts.push({
        executable: message.executable,
        packageId: message.package_id,
        target: message.target.name,
      });
    }
  } catch {
    if (line) process.stdout.write(`${line}\n`);
  }
}

function packageName(packageId) {
  const pathMatch = packageId.match(/\/crates\/([^/#]+)#/);
  return pathMatch?.[1] ?? packageId.split(" ")[0];
}

function testThreads(artifact) {
  const packageNameValue = packageName(artifact.packageId);
  if (packageNameValue === "snapback4-sim") return 4;
  if (packageNameValue === "snapback4-device") return artifact.target === "device" ? 8 : 2;
  if (packageNameValue === "snapback4") return ["lifecycle", "snapback4", "witness"].includes(artifact.target) ? 1 : 2;
  if (packageNameValue === "snapback4-lang" && artifact.target === "lowering") return 8;
  return 4;
}

async function listedTests(artifact) {
  const chunks = [];
  const errors = [];
  const child = spawn(artifact.executable, ["--list", "--format=terse"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  active.add(child);
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const result = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: 1, error }));
    child.on("close", (code, signal) => {
      active.delete(child);
      resolve({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
  if (result.code !== 0) {
    throw new Error(`could not list ${packageName(artifact.packageId)}::${artifact.target}: ${Buffer.concat(errors).toString("utf8")}`);
  }
  return Buffer.concat(chunks).toString("utf8").split("\n").filter((line) => line.endsWith(": test")).map((line) => line.slice(0, -6));
}

async function runArtifact(artifact) {
  const label = `${packageName(artifact.packageId)}::${artifact.target}${artifact.labelSuffix ?? ""}`;
  const started = Date.now();
  const chunks = [];
  const env = { ...process.env };
  if (packageName(artifact.packageId) === "snapback4-device") env.RUST_MIN_STACK = "33554432";
  const args = ["--quiet", `--test-threads=${testThreads(artifact)}`];
  if (artifact.filter) args.push(artifact.filter);
  if (artifact.exact) args.push("--exact");
  const child = spawn(artifact.executable, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  active.add(child);
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  const result = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: 1, error }));
    child.on("close", (code, signal) => {
      active.delete(child);
      resolve({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
  const output = Buffer.concat(chunks).toString("utf8");
  const summary = [...output.matchAll(/test result: [^\n]+/g)].at(-1)?.[0] ?? "no test summary";
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (result.code === 0) {
    console.log(`-- rust target: ${label} (${elapsed} s): ${summary}`);
  } else {
    console.error(`-- FAIL rust target: ${label} (${elapsed} s)`);
    process.stderr.write(output);
  }
  return { ...result, label };
}

async function runPool(artifacts) {
  const results = new Array(artifacts.length);
  let next = 0;
  async function worker() {
    while (interrupted === null && next < artifacts.length) {
      const index = next++;
      results[index] = await runArtifact(artifacts[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(processLimit, artifacts.length) }, worker));
  return results;
}

const build = await cargoArtifacts();
let failed = build.code !== 0 && interrupted === null;
if (interrupted !== null) {
  // The signal handler has already forwarded cancellation to every tracked
  // child. Do not schedule another artifact or overwrite the signal status.
} else if (failed) {
  console.error("-- FAIL: Cargo test artifact build");
} else {
  build.artifacts.sort((left, right) => `${left.packageId}/${left.target}`.localeCompare(`${right.packageId}/${right.target}`));
  const executions = [];
  for (const artifact of build.artifacts) {
    const key = `${packageName(artifact.packageId)}::${artifact.target}`;
    // These targets contain independent scale tests whose aggregate harness
    // otherwise owns the critical path. Exact-filter processes are bounded by
    // the same pool and keep each test's descriptors, globals, and stack local.
    if (!["snapback4-lang::lowering", "snapback4-device::device", "snapback4-sim::clique", "snapback4-sim::maintains"].includes(key)) {
      executions.push(artifact);
      continue;
    }
    try {
      for (const test of await listedTests(artifact)) {
        executions.push({ ...artifact, filter: test, exact: true, labelSuffix: `::${test}` });
      }
    } catch (error) {
      if (interrupted !== null) break;
      failed = true;
      console.error(`-- FAIL rust inventory: ${key} --list`);
      console.error(error instanceof Error ? error.message : error);
    }
  }
  if (interrupted !== null) executions.length = 0;
  console.log(`-- rust inventory: ${build.artifacts.length} test binaries, ${executions.length} executions; at most ${processLimit} concurrent processes`);
  // The macOS witness target owns simctl and simulator lifecycle. Keep it out
  // of the shared pool so host load cannot turn tool contention into a false
  // product timeout; its own assertions still run one at a time.
  const exclusive = executions.filter((artifact) => packageName(artifact.packageId) === "snapback4" && artifact.target === "witness");
  const regular = executions.filter((artifact) => !exclusive.includes(artifact));
  const results = await runPool(regular);
  for (const artifact of exclusive) {
    if (interrupted !== null) break;
    results.push(await runArtifact(artifact));
  }
  failed ||= results.some((result) => result && result.code !== 0);
}

// Cargo does not emit doctest executables in the no-run artifact stream.
// Run that inventory explicitly even if an ordinary test binary failed.
if (interrupted === null) {
  const docsStarted = Date.now();
  const docs = await run("cargo", ["test", "--workspace", "--doc", "--no-fail-fast", "--quiet"], { stdio: "inherit" });
  console.log(`-- rust target: workspace doctests (${((Date.now() - docsStarted) / 1000).toFixed(1)} s)`);
  failed ||= docs.code !== 0;
}

process.exitCode = interrupted ?? (failed ? 1 : 0);
