#!/usr/bin/env node

import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const MODES = new Set([
  "acceptance",
  "performance",
  "credential-scan",
  "destroy-carriers",
]);
const CARRIER_NAMES = new Set([
  "api_url",
  "anon_key",
  "publishable_key",
  "service_role_key",
  "secret_key",
  "s3_access_key_id",
  "s3_access_key_secret",
]);

function statusTemplate() {
  return {
    schema_version: 1,
    mode: "invalid",
    runner_exit_code: 80,
    child_exit_code: null,
    byte_counts: { child_stdout: 0, child_stderr: 0 },
    sha256: {
      child_stdout: EMPTY_SHA256,
      child_stderr: EMPTY_SHA256,
    },
    checks: {
      state_parent_private_and_owned: false,
      run_root_mode_0700: false,
      carriers_allowlisted_and_mode_0600: false,
      required_carriers_present: false,
      child_streams_initial_mode_0600: false,
      child_streams_destroyed: false,
      evidence_shape_present: false,
      credential_values_absent: false,
      carriers_destroyed: false,
    },
    evidence_file_count: 0,
    scenario_receipt_count: 0,
    scanned_file_count: 0,
    credential_value_hit_count: 0,
    destroyed_carrier_count: 0,
    remaining_carrier_count: 0,
  };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("invalid arguments");
    values.set(flag, value);
  }
  const required = [
    "--mode",
    "--carrier-root",
    "--project-root",
    "--evidence-dir",
    "--run-root",
    "--target-identity",
  ];
  if (!required.every((flag) => values.has(flag))) throw new Error("missing arguments");
  if (!MODES.has(values.get("--mode"))) throw new Error("invalid mode");
  return Object.fromEntries(required.map((flag) => [flag.slice(2), values.get(flag)]));
}

function mode(path) {
  return lstatSync(path).mode & 0o777;
}

function isPrivateDirectory(path) {
  if (!existsSync(path)) return false;
  const value = lstatSync(path);
  return (
    value.isDirectory() &&
    !value.isSymbolicLink() &&
    (value.mode & 0o777) === 0o700 &&
    (typeof process.getuid !== "function" || value.uid === process.getuid())
  );
}

function openPrivate(path) {
  return openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
}

function digest(path) {
  if (!existsSync(path)) return { bytes: 0, sha256: EMPTY_SHA256 };
  const body = readFileSync(path);
  return {
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

function loadCarriers(root) {
  if (!isPrivateDirectory(root)) throw new Error("unsafe carrier root");
  const entries = readdirSync(root).sort();
  if (
    entries.length === 0 ||
    entries.some((entry) => !CARRIER_NAMES.has(entry))
  ) {
    throw new Error("unexpected carrier entry");
  }
  const carriers = new Map();
  for (const entry of entries) {
    const path = join(root, entry);
    const value = lstatSync(path);
    if (
      !value.isFile() ||
      value.isSymbolicLink() ||
      (value.mode & 0o777) !== 0o600
    ) {
      throw new Error("unsafe carrier");
    }
    carriers.set(entry, readFileSync(path, "utf8"));
  }
  return carriers;
}

function required(carriers) {
  const apiUrl = carriers.get("api_url");
  const publicKey =
    carriers.get("publishable_key") ?? carriers.get("anon_key");
  const serviceKey =
    carriers.get("secret_key") ?? carriers.get("service_role_key");
  if (!apiUrl || !publicKey || !serviceKey) throw new Error("missing carrier");
  return { apiUrl, publicKey, serviceKey };
}

function countEvidence(root) {
  let files = 0;
  let scenarios = 0;
  if (!existsSync(root)) return { files, scenarios };
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        files += 1;
        if (dirname(full) === join(root, "scenarios") && entry.name.endsWith(".json")) {
          scenarios += 1;
        }
      }
    }
  };
  walk(root);
  return { files, scenarios };
}

function scanCredentialValues(roots, values) {
  let scanned = 0;
  let hits = 0;
  const skip = new Set(["node_modules", ".git", ".temp"]);
  const needles = [...new Set(values.filter((value) => value.length >= 12))].map(
    (value) => Buffer.from(value),
  );
  const walk = (path) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        scanned += 1;
        const body = readFileSync(full);
        if (needles.some((needle) => body.includes(needle))) hits += 1;
      }
    }
  };
  for (const root of roots) walk(root);
  return { scanned, hits };
}

const status = statusTemplate();
let desiredExit = 80;
let streamPaths = [];

try {
  const args = parseArguments(process.argv.slice(2));
  status.mode = args.mode;
  const stateParent = dirname(args["run-root"]);
  status.checks.state_parent_private_and_owned = isPrivateDirectory(stateParent);
  if (!status.checks.state_parent_private_and_owned || existsSync(args["run-root"])) {
    throw new Error("unsafe run root");
  }
  mkdirSync(args["run-root"], { mode: 0o700 });
  chmodSync(args["run-root"], 0o700);
  status.checks.run_root_mode_0700 = isPrivateDirectory(args["run-root"]);

  const carriers = loadCarriers(args["carrier-root"]);
  status.checks.carriers_allowlisted_and_mode_0600 = true;
  const credentials = required(carriers);
  status.checks.required_carriers_present = true;

  if (args.mode === "credential-scan") {
    const scan = scanCredentialValues(
      [args["project-root"], args["evidence-dir"]],
      [...carriers.values()],
    );
    status.scanned_file_count = scan.scanned;
    status.credential_value_hit_count = scan.hits;
    status.checks.credential_values_absent = scan.hits === 0;
    desiredExit = scan.hits === 0 ? 0 : 83;
  } else if (args.mode === "destroy-carriers") {
    const entries = readdirSync(args["carrier-root"]);
    for (const entry of entries) {
      rmSync(join(args["carrier-root"], entry), { force: true });
    }
    status.destroyed_carrier_count = entries.length;
    status.remaining_carrier_count = readdirSync(args["carrier-root"]).length;
    status.checks.carriers_destroyed = status.remaining_carrier_count === 0;
    desiredExit = status.checks.carriers_destroyed ? 0 : 84;
  } else {
    const stdoutPath = join(args["run-root"], "child.stdout.raw");
    const stderrPath = join(args["run-root"], "child.stderr.raw");
    streamPaths = [stdoutPath, stderrPath];
    const stdoutFd = openPrivate(stdoutPath);
    const stderrFd = openPrivate(stderrPath);
    status.checks.child_streams_initial_mode_0600 =
      mode(stdoutPath) === 0o600 && mode(stderrPath) === 0o600;
    const script =
      args.mode === "acceptance"
        ? join(args["project-root"], "work", "acceptance.ts")
        : join(args["project-root"], "work", "performance.ts");
    const tsx = join(
      args["project-root"],
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs",
    );
    let child;
    try {
      child = spawnSync(process.execPath, [tsx, script], {
        cwd: args["project-root"],
        shell: false,
        stdio: ["ignore", stdoutFd, stderrFd],
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? "",
          XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? "",
          npm_config_cache: process.env.npm_config_cache ?? "",
          NODE_NO_WARNINGS: "1",
          SUPABASE_URL: credentials.apiUrl,
          SUPABASE_PUBLISHABLE_KEY: credentials.publicKey,
          SUPABASE_SERVICE_ROLE_KEY: credentials.serviceKey,
          EVIDENCE_DIR: args["evidence-dir"],
          TARGET_IDENTITY: args["target-identity"],
          EXTENSION_RUN: "true",
        },
      });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    status.child_exit_code = Number.isInteger(child.status) ? child.status : null;
    const stdoutDigest = digest(stdoutPath);
    const stderrDigest = digest(stderrPath);
    status.byte_counts.child_stdout = stdoutDigest.bytes;
    status.byte_counts.child_stderr = stderrDigest.bytes;
    status.sha256.child_stdout = stdoutDigest.sha256;
    status.sha256.child_stderr = stderrDigest.sha256;
    const evidence = countEvidence(args["evidence-dir"]);
    status.evidence_file_count = evidence.files;
    status.scenario_receipt_count = evidence.scenarios;
    status.checks.evidence_shape_present =
      args.mode === "acceptance"
        ? existsSync(join(args["evidence-dir"], "acceptance-results.partial.json")) &&
          evidence.scenarios >= 13
        : existsSync(join(args["evidence-dir"], "performance.json")) &&
          existsSync(
            join(
              args["evidence-dir"],
              "scenarios",
              "RESEARCH-14-PERFORMANCE.json",
            ),
          );
    desiredExit =
      !child.error && child.status === 0 && status.checks.evidence_shape_present
        ? 0
        : 82;
  }
} catch {
  desiredExit = 80;
} finally {
  for (const path of streamPaths) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
  status.checks.child_streams_destroyed =
    streamPaths.length === 0 || streamPaths.every((path) => !existsSync(path));
  status.runner_exit_code = desiredExit;
  process.stdout.write(`${JSON.stringify(status)}\n`);
  process.exitCode = desiredExit;
}
