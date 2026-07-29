#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = join(here, "safe-supabase-cli.mjs");
const child = join(here, "synthetic-child.mjs");
const canaryFragments = [
  "CANARY_",
  "sb_secret_",
  "sb_publishable_",
  "eyJhbGci",
  "SUPABASE_",
  "diagnostic",
  "failed with",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function mode(path) {
  return lstatSync(path).mode & 0o777;
}

function runCase(parent, name, scenario, commandClass, expected) {
  const stateRoot = join(parent, name);
  const result = spawnSync(
    process.execPath,
    [
      wrapper,
      "--command-class",
      commandClass,
      "--state-root",
      stateRoot,
      "--",
      process.execPath,
      child,
      scenario,
    ],
    { encoding: "utf8", shell: false },
  );

  assert(result.stderr === "", `${name}: wrapper stderr was not empty`);
  assert(
    canaryFragments.every((fragment) => !result.stdout.includes(fragment)),
    `${name}: wrapper stdout contained a forbidden fragment`,
  );
  assert(
    canaryFragments.every((fragment) => !result.stderr.includes(fragment)),
    `${name}: wrapper stderr contained a forbidden fragment`,
  );
  const status = JSON.parse(result.stdout);
  assert(status.wrapper_exit_code === expected.wrapperExit, `${name}: wrapper exit`);
  assert(result.status === expected.wrapperExit, `${name}: process exit`);
  assert(status.child_exit_code === expected.childExit, `${name}: child exit`);
  assert(status.checks.state_parent_mode_0700, `${name}: state parent mode status`);
  assert(
    status.checks.state_parent_owned_by_process,
    `${name}: state parent ownership status`,
  );
  assert(status.checks.state_parent_not_symlink, `${name}: state parent symlink status`);
  assert(status.checks.state_root_mode_0700, `${name}: state root status`);
  assert(mode(parent) === 0o700, `${name}: state parent mode`);
  if (typeof process.getuid === "function") {
    assert(lstatSync(parent).uid === process.getuid(), `${name}: state parent owner`);
  }
  assert(mode(stateRoot) === 0o700, `${name}: state root mode`);
  assert(status.checks.raw_files_initial_mode_0600, `${name}: raw file modes`);
  assert(status.checks.raw_files_destroyed, `${name}: raw destruction status`);
  assert(status.checks.parser_streams_destroyed, `${name}: parser destruction status`);
  assert(
    !existsSync(join(stateRoot, "child.stdout.raw")) &&
      !existsSync(join(stateRoot, "child.stderr.raw")) &&
      !existsSync(join(stateRoot, "parser.stdout.raw")) &&
      !existsSync(join(stateRoot, "parser.stderr.raw")) &&
      !existsSync(join(stateRoot, "parser-result.json")),
    `${name}: raw artifacts remain`,
  );

  const carrierRoot = join(stateRoot, "carriers");
  const carriers = readdirSync(carrierRoot);
  if (expected.parseSuccess) {
    assert(status.checks.parse_succeeded, `${name}: parse did not succeed`);
    assert(status.checks.carrier_files_mode_0600, `${name}: carrier status`);
    assert(status.checks.carrier_entries_exact, `${name}: carrier entry status`);
    const expectedCarrierCount = Object.values(status.key_presence).filter(
      Boolean,
    ).length;
    assert(carriers.length === expectedCarrierCount, `${name}: carrier count`);
    assert(
      carriers.every((entry) => mode(join(carrierRoot, entry)) === 0o600),
      `${name}: carrier mode`,
    );
  } else {
    assert(!status.checks.parse_succeeded, `${name}: parse unexpectedly succeeded`);
    assert(carriers.length === 0, `${name}: carrier was retained`);
  }
  if (expected.unexpectedKey) {
    assert(status.checks.unexpected_parser_key, `${name}: unexpected key not recorded`);
  }

  return {
    name,
    passed: true,
    wrapper_exit_code: status.wrapper_exit_code,
    child_exit_code: status.child_exit_code,
    wrapper_stdout_sha256: sha256(result.stdout),
    wrapper_stderr_sha256: sha256(result.stderr),
    state_root_mode_0700: mode(stateRoot) === 0o700,
    state_parent_mode_0700: mode(parent) === 0o700,
    state_parent_owned_by_process:
      typeof process.getuid !== "function" ||
      lstatSync(parent).uid === process.getuid(),
    raw_files_destroyed: status.checks.raw_files_destroyed,
    parser_streams_destroyed: status.checks.parser_streams_destroyed,
    carriers_mode_0600:
      carriers.length > 0 &&
      carriers.every((entry) => mode(join(carrierRoot, entry)) === 0o600),
    carrier_entries_exact:
      expected.parseSuccess ? status.checks.carrier_entries_exact : carriers.length === 0,
    no_forbidden_fragments_in_wrapper_streams: true,
    unexpected_parser_key_failed_closed:
      expected.unexpectedKey ? !status.checks.parse_succeeded : null,
  };
}

const parent = mkdtempSync(join(tmpdir(), "llp0102-supabase-wrapper-test-"));
chmodSync(parent, 0o700);

function runRefusal(name, stateRoot, expectedParentSafe, preservedPath) {
  const result = spawnSync(
    process.execPath,
    [
      wrapper,
      "--command-class",
      "synthetic-failure",
      "--state-root",
      stateRoot,
      "--",
      process.execPath,
      child,
      "failure",
    ],
    { encoding: "utf8", shell: false },
  );
  assert(result.stderr === "", `${name}: wrapper stderr was not empty`);
  assert(
    canaryFragments.every(
      (fragment) =>
        !result.stdout.includes(fragment) && !result.stderr.includes(fragment),
    ),
    `${name}: wrapper stream contained a forbidden fragment`,
  );
  const status = JSON.parse(result.stdout);
  assert(result.status === 70, `${name}: process exit`);
  assert(status.wrapper_exit_code === 70, `${name}: wrapper exit`);
  assert(status.child_exit_code === null, `${name}: child unexpectedly ran`);
  assert(
    status.checks.state_parent_mode_0700 === expectedParentSafe,
    `${name}: parent mode classification`,
  );
  assert(existsSync(preservedPath), `${name}: protected path was removed`);
  return {
    name,
    passed: true,
    wrapper_exit_code: status.wrapper_exit_code,
    child_not_started: status.child_exit_code === null,
    protected_path_preserved: true,
    no_forbidden_fragments_in_wrapper_streams: true,
    wrapper_stdout_sha256: sha256(result.stdout),
    wrapper_stderr_sha256: sha256(result.stderr),
  };
}

try {
  const cases = [
    runCase(parent, "success", "success", "synthetic-success", {
      wrapperExit: 0,
      childExit: 0,
      parseSuccess: true,
      unexpectedKey: false,
    }),
    runCase(
      parent,
      "current-start-pretty",
      "current-start-pretty",
      "synthetic-current-start-pretty",
      {
        wrapperExit: 0,
        childExit: 0,
        parseSuccess: true,
        unexpectedKey: false,
      },
    ),
    runCase(
      parent,
      "unexpected",
      "unexpected",
      "synthetic-unexpected-key",
      {
        wrapperExit: 72,
        childExit: 0,
        parseSuccess: false,
        unexpectedKey: true,
      },
    ),
    runCase(parent, "failure", "failure", "synthetic-failure", {
      wrapperExit: 71,
      childExit: 42,
      parseSuccess: false,
      unexpectedKey: false,
    }),
    runCase(parent, "parser-crash", "success", "synthetic-parser-crash", {
      wrapperExit: 72,
      childExit: 0,
      parseSuccess: false,
      unexpectedKey: false,
    }),
    runCase(
      parent,
      "malformed-manifest",
      "success",
      "synthetic-malformed-manifest",
      {
        wrapperExit: 70,
        childExit: 0,
        parseSuccess: false,
        unexpectedKey: false,
      },
    ),
  ];
  const preexistingRoot = join(parent, "preexisting-root");
  mkdirSync(preexistingRoot, { mode: 0o700 });
  const preexistingSentinel = join(preexistingRoot, "sentinel");
  writeFileSync(preexistingSentinel, "preserve", { mode: 0o600 });
  cases.push(
    runRefusal(
      "preexisting-root-refusal",
      preexistingRoot,
      true,
      preexistingSentinel,
    ),
  );

  const outsideTarget = join(parent, "outside-target");
  mkdirSync(outsideTarget, { mode: 0o700 });
  const outsideSentinel = join(outsideTarget, "sentinel");
  writeFileSync(outsideSentinel, "preserve", { mode: 0o600 });
  const symlinkRoot = join(parent, "symlink-root");
  symlinkSync(outsideTarget, symlinkRoot);
  cases.push(
    runRefusal("symlink-root-refusal", symlinkRoot, true, outsideSentinel),
  );

  const insecureParent = join(parent, "insecure-parent");
  mkdirSync(insecureParent, { mode: 0o755 });
  chmodSync(insecureParent, 0o755);
  const insecureSentinel = join(insecureParent, "sentinel");
  writeFileSync(insecureSentinel, "preserve", { mode: 0o600 });
  cases.push(
    runRefusal(
      "insecure-parent-refusal",
      join(insecureParent, "state"),
      false,
      insecureSentinel,
    ),
  );
  process.stdout.write(
    `${JSON.stringify({
      schema_version: 1,
      test_class: "synthetic-negative-containment",
      passed: cases.every((entry) => entry.passed),
      cases,
      tested_facts: {
        exact_v2_110_0_env_field_set: true,
        exact_v2_110_0_start_pretty_field_set: true,
        ansi_table_cells: true,
        env_assignments: true,
        jwt_like_strings: true,
        supabase_secret_prefixes: true,
        failure_output: true,
        wrapper_streams_allowlisted: true,
        state_roots_mode_0700: true,
        state_parents_mode_0700_and_process_owned: true,
        preexisting_state_root_refused: true,
        symlink_state_root_refused_without_target_removal: true,
        insecure_state_parent_refused: true,
        carriers_mode_0600: true,
        carrier_entries_exact: true,
        unexpected_keys_fail_closed: true,
        parser_crash_leaves_zero_carriers_or_raw_files: true,
        malformed_manifest_leaves_zero_carriers_or_raw_files: true,
        raw_files_destroyed_after_extraction: true,
      },
    })}\n`,
  );
} catch {
  process.stdout.write(
    `${JSON.stringify({
      schema_version: 1,
      test_class: "synthetic-negative-containment",
      passed: false,
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  rmSync(parent, { recursive: true, force: true });
}
