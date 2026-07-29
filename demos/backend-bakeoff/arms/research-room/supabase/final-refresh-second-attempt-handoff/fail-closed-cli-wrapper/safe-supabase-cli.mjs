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
import { fileURLToPath } from "node:url";

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const COMMAND_CLASSES = new Set([
  "target-start",
  "target-stop",
  "target-status",
  "synthetic-success",
  "synthetic-current-start-pretty",
  "synthetic-unexpected-key",
  "synthetic-failure",
  "synthetic-parser-crash",
  "synthetic-malformed-manifest",
]);
const PARSING_CLASSES = new Set([
  "target-start",
  "synthetic-success",
  "synthetic-current-start-pretty",
  "synthetic-unexpected-key",
  "synthetic-parser-crash",
  "synthetic-malformed-manifest",
]);
const KEY_NAMES = [
  "api_url",
  "anon_key",
  "publishable_key",
  "service_role_key",
  "secret_key",
  "s3_access_key_id",
  "s3_access_key_secret",
];

function blankStatus() {
  return {
    schema_version: 1,
    command_class: "invalid",
    wrapper_exit_code: 70,
    child_exit_code: null,
    parser_exit_code: null,
    byte_counts: {
      child_stdout: 0,
      child_stderr: 0,
      parser_stdout: 0,
      parser_stderr: 0,
    },
    sha256: {
      child_stdout: EMPTY_SHA256,
      child_stderr: EMPTY_SHA256,
      parser_stdout: EMPTY_SHA256,
      parser_stderr: EMPTY_SHA256,
    },
    checks: {
      state_parent_mode_0700: false,
      state_parent_owned_by_process: false,
      state_parent_not_symlink: false,
      state_root_mode_0700: false,
      raw_files_initial_mode_0600: false,
      parser_streams_initial_mode_0600: false,
      parse_attempted: false,
      parse_succeeded: false,
      unexpected_parser_key: false,
      required_keys_present: false,
      carrier_files_mode_0600: false,
      carrier_entries_exact: false,
      raw_files_destroyed: false,
      parser_streams_destroyed: false,
      child_signaled: false,
    },
    key_presence: Object.fromEntries(KEY_NAMES.map((key) => [key, false])),
  };
}

function emit(status) {
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

function parseArguments(argv) {
  let commandClass;
  let stateRoot;
  let cursor = 0;
  while (cursor < argv.length && argv[cursor] !== "--") {
    const flag = argv[cursor];
    const value = argv[cursor + 1];
    if (flag === "--command-class" && value) {
      commandClass = value;
      cursor += 2;
    } else if (flag === "--state-root" && value) {
      stateRoot = value;
      cursor += 2;
    } else {
      throw new Error("invalid arguments");
    }
  }
  if (argv[cursor] !== "--") throw new Error("missing command separator");
  const command = argv.slice(cursor + 1);
  if (!COMMAND_CLASSES.has(commandClass)) throw new Error("invalid command class");
  if (!stateRoot || !stateRoot.startsWith("/")) throw new Error("invalid state root");
  if (command.length === 0) throw new Error("missing child command");
  return { commandClass, stateRoot, command };
}

function mode(path) {
  return lstatSync(path).mode & 0o777;
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

function unlinkIfPresent(path) {
  if (existsSync(path)) rmSync(path, { force: true });
}

function cleanCarriers(carrierRoot) {
  if (!existsSync(carrierRoot)) return;
  for (const entry of readdirSync(carrierRoot)) {
    unlinkIfPresent(join(carrierRoot, entry));
  }
}

function inspectCarriers(carrierRoot, keyPresence) {
  const expected = Object.entries(keyPresence)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .sort();
  const actual = readdirSync(carrierRoot).sort();
  const entriesExact =
    expected.length === actual.length &&
    expected.every((key, index) => key === actual[index]);
  const modesPrivate =
    expected.length > 0 &&
    entriesExact &&
    expected.every((key) => {
      const path = join(carrierRoot, key);
      return existsSync(path) && mode(path) === 0o600 && !lstatSync(path).isSymbolicLink();
    });
  return { entriesExact, modesPrivate };
}

const status = blankStatus();
let rawPaths = [];
let parserPaths = [];
let carrierRootPath;
let desiredExit = 70;

try {
  const { commandClass, stateRoot, command } = parseArguments(process.argv.slice(2));
  status.command_class = commandClass;

  const stateParent = dirname(stateRoot);
  if (!existsSync(stateParent)) throw new Error("state parent does not exist");
  const parentStat = lstatSync(stateParent);
  status.checks.state_parent_mode_0700 = (parentStat.mode & 0o777) === 0o700;
  status.checks.state_parent_owned_by_process =
    typeof process.getuid !== "function" || parentStat.uid === process.getuid();
  status.checks.state_parent_not_symlink =
    parentStat.isDirectory() && !parentStat.isSymbolicLink();
  if (
    !status.checks.state_parent_mode_0700 ||
    !status.checks.state_parent_owned_by_process ||
    !status.checks.state_parent_not_symlink
  ) {
    throw new Error("unsafe state parent");
  }
  if (existsSync(stateRoot)) throw new Error("state root already exists");
  mkdirSync(stateRoot, { mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  status.checks.state_root_mode_0700 =
    mode(stateRoot) === 0o700 && !lstatSync(stateRoot).isSymbolicLink();

  const carrierRoot = join(stateRoot, "carriers");
  carrierRootPath = carrierRoot;
  mkdirSync(carrierRoot, { mode: 0o700 });
  chmodSync(carrierRoot, 0o700);

  const childStdout = join(stateRoot, "child.stdout.raw");
  const childStderr = join(stateRoot, "child.stderr.raw");
  rawPaths = [childStdout, childStderr];
  const childOutFd = openPrivate(childStdout);
  const childErrFd = openPrivate(childStderr);
  status.checks.raw_files_initial_mode_0600 =
    mode(childStdout) === 0o600 && mode(childStderr) === 0o600;

  let child;
  try {
    child = spawnSync(command[0], command.slice(1), {
      shell: false,
      stdio: ["ignore", childOutFd, childErrFd],
      env: process.env,
    });
  } finally {
    closeSync(childOutFd);
    closeSync(childErrFd);
  }

  status.child_exit_code = Number.isInteger(child.status) ? child.status : null;
  status.checks.child_signaled = child.signal !== null;
  const childOutDigest = digest(childStdout);
  const childErrDigest = digest(childStderr);
  status.byte_counts.child_stdout = childOutDigest.bytes;
  status.byte_counts.child_stderr = childErrDigest.bytes;
  status.sha256.child_stdout = childOutDigest.sha256;
  status.sha256.child_stderr = childErrDigest.sha256;

  if (child.error || child.status !== 0) {
    desiredExit = 71;
  } else if (PARSING_CLASSES.has(commandClass)) {
    status.checks.parse_attempted = true;
    const parserStdout = join(stateRoot, "parser.stdout.raw");
    const parserStderr = join(stateRoot, "parser.stderr.raw");
    const parserManifest = join(stateRoot, "parser-result.json");
    parserPaths = [parserStdout, parserStderr, parserManifest];
    const parserOutFd = openPrivate(parserStdout);
    const parserErrFd = openPrivate(parserStderr);
    status.checks.parser_streams_initial_mode_0600 =
      mode(parserStdout) === 0o600 && mode(parserStderr) === 0o600;

    const parserPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "extract-supabase-credentials.mjs",
    );
    const syntheticMode =
      commandClass === "synthetic-parser-crash"
        ? "crash"
        : commandClass === "synthetic-malformed-manifest"
          ? "malformed"
          : "none";
    let parser;
    try {
      parser = spawnSync(
        process.execPath,
        [
          parserPath,
          "--raw-stdout",
          childStdout,
          "--raw-stderr",
          childStderr,
          "--carrier-root",
          carrierRoot,
          "--manifest",
          parserManifest,
          "--synthetic-mode",
          syntheticMode,
        ],
        {
          shell: false,
          stdio: ["ignore", parserOutFd, parserErrFd],
          env: { PATH: process.env.PATH ?? "" },
        },
      );
    } finally {
      closeSync(parserOutFd);
      closeSync(parserErrFd);
    }

    status.parser_exit_code = Number.isInteger(parser.status) ? parser.status : null;
    const parserOutDigest = digest(parserStdout);
    const parserErrDigest = digest(parserStderr);
    status.byte_counts.parser_stdout = parserOutDigest.bytes;
    status.byte_counts.parser_stderr = parserErrDigest.bytes;
    status.sha256.parser_stdout = parserOutDigest.sha256;
    status.sha256.parser_stderr = parserErrDigest.sha256;

    if (!parser.error && existsSync(parserManifest)) {
      const result = JSON.parse(readFileSync(parserManifest, "utf8"));
      const resultKeys = Object.keys(result.key_presence ?? {});
      const exactKeys =
        resultKeys.length === KEY_NAMES.length &&
        resultKeys.every((key) => KEY_NAMES.includes(key));
      const booleanValues =
        exactKeys &&
        resultKeys.every((key) => typeof result.key_presence[key] === "boolean");
      if (!exactKeys || !booleanValues) throw new Error("invalid parser manifest");

      status.key_presence = result.key_presence;
      status.checks.unexpected_parser_key =
        result.unexpected_parser_key === true;
      status.checks.required_keys_present =
        result.required_keys_present === true;
      const carrierInspection = inspectCarriers(
        carrierRoot,
        status.key_presence,
      );
      status.checks.carrier_files_mode_0600 = carrierInspection.modesPrivate;
      status.checks.carrier_entries_exact = carrierInspection.entriesExact;
      status.checks.parse_succeeded =
        parser.status === 0 &&
        result.ok === true &&
        !status.checks.unexpected_parser_key &&
        status.checks.required_keys_present &&
        status.checks.carrier_files_mode_0600 &&
        status.checks.carrier_entries_exact;
    }

    if (status.checks.parse_succeeded) {
      desiredExit = 0;
    } else {
      cleanCarriers(carrierRoot);
      desiredExit = 72;
    }
  } else {
    desiredExit = 0;
  }
} catch {
  desiredExit = 70;
} finally {
  if (desiredExit !== 0 && carrierRootPath) cleanCarriers(carrierRootPath);
  for (const path of rawPaths) unlinkIfPresent(path);
  for (const path of parserPaths) unlinkIfPresent(path);
  status.checks.raw_files_destroyed =
    rawPaths.length > 0 && rawPaths.every((path) => !existsSync(path));
  status.checks.parser_streams_destroyed =
    parserPaths.length === 0 || parserPaths.every((path) => !existsSync(path));
  status.wrapper_exit_code = desiredExit;
  emit(status);
  process.exitCode = desiredExit;
}
