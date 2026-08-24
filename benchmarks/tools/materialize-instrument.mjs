#!/usr/bin/env node

import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveInstrumentArtifacts } from "./lane-setup.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SOURCE = join(REPOSITORY_ROOT, "benchmarks");

function inside(root, path) {
  const logical = relative(resolve(root), resolve(path));
  return logical === ""
    || (logical !== ".." && !logical.startsWith(`..${sep}`) && !isAbsolute(logical));
}

function readOnlyTree(path) {
  const status = lstatSync(path);
  if (status.isSymbolicLink()) throw new Error(`materialized snapshot contains forbidden symlink: ${path}`);
  if (status.isDirectory()) {
    for (const entry of readdirSync(path)) readOnlyTree(join(path, entry));
    chmodSync(path, 0o555);
  } else if (status.isFile()) {
    chmodSync(path, 0o444);
  } else {
    throw new Error(`materialized snapshot contains unsupported entry: ${path}`);
  }
}

function writableTree(path) {
  if (!existsSync(path)) return;
  const status = lstatSync(path);
  if (status.isDirectory()) {
    chmodSync(path, 0o755);
    for (const entry of readdirSync(path)) writableTree(join(path, entry));
  } else if (status.isFile()) {
    chmodSync(path, 0o644);
  }
}

function copyTreeContents(source, destination) {
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(destination, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
}

function copySnapshot(sourceRoot, temporaryRoot, manifest) {
  const directories = Object.values(manifest.artifacts)
    .filter((artifact) => artifact.kind === "directory")
    .map((artifact) => artifact.path)
    .sort();
  for (const logical of directories) {
    const source = resolve(sourceRoot, logical);
    const destination = resolve(temporaryRoot, logical);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
  }
  const covered = (logical) => directories.some((directory) => (
    logical === directory || logical.startsWith(`${directory}/`)
  ));
  for (const artifact of Object.values(manifest.artifacts)) {
    if (artifact.kind !== "file" || covered(artifact.path)) continue;
    const source = resolve(sourceRoot, artifact.path);
    const destination = resolve(temporaryRoot, artifact.path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { force: false, errorOnExist: true });
  }
  cpSync(
    resolve(sourceRoot, "instrument.manifest.json"),
    resolve(temporaryRoot, "instrument.manifest.json"),
    { force: false, errorOnExist: true },
  );
}

// @ref LLP 0295#r2-load-isolated-calibration-rerun — continuation uses a
// distinct immutable instrument root; retained cell-1 snapshots are never
// replaced in place to make a later admission pass.
export function materializeInstrumentSnapshot({ sourceRoot = DEFAULT_SOURCE, outPath }) {
  const source = resolve(sourceRoot);
  const destination = resolve(outPath);
  if (destination === source || inside(source, destination) || existsSync(destination)) {
    throw new Error(`R2_INSTRUMENT_MATERIALIZE_REFUSAL: destination must be a new path outside the source snapshot: ${destination}`);
  }
  const sourceSnapshot = resolveInstrumentArtifacts({
    instrumentRoot: source,
    instrumentPin: JSON.parse(readFileSync(join(source, "instrument.manifest.json"), "utf8")).instrumentPin,
  });
  mkdirSync(dirname(destination), { recursive: true });
  let temporary = null;
  let destinationReserved = false;
  try {
    mkdirSync(destination);
    destinationReserved = true;
    temporary = mkdtempSync(join(dirname(destination), `.${destination.split(sep).at(-1)}.tmp-`));
    const manifest = JSON.parse(readFileSync(sourceSnapshot.manifest.path, "utf8"));
    copySnapshot(source, temporary, manifest);
    const prepared = resolveInstrumentArtifacts({
      instrumentRoot: temporary,
      instrumentPin: sourceSnapshot.manifest.instrumentPin,
    });
    if (prepared.manifest.sha256 !== sourceSnapshot.manifest.sha256) {
      throw new Error("materialized manifest bytes differ from the current repository snapshot");
    }
    copyTreeContents(temporary, destination);
    const materialized = resolveInstrumentArtifacts({
      instrumentRoot: destination,
      instrumentPin: sourceSnapshot.manifest.instrumentPin,
    });
    readOnlyTree(destination);
    rmSync(temporary, { recursive: true });
    return {
      ok: true,
      source,
      outPath: destination,
      instrumentPin: materialized.manifest.instrumentPin,
      manifestSha256: materialized.manifest.sha256,
    };
  } catch (error) {
    if (temporary !== null && existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    if (destinationReserved && existsSync(destination)) {
      writableTree(destination);
      rmSync(destination, { recursive: true, force: true });
    }
    if (error.code === "EEXIST") {
      throw new Error(`R2_INSTRUMENT_MATERIALIZE_REFUSAL: cannot reserve new destination ${destination}: ${error.message}`);
    }
    throw error;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    index += 1;
    if (index >= argv.length) throw new Error(`${arg} requires a value`);
    if (arg === "--source") options.sourceRoot = argv[index];
    else if (arg === "--out") options.outPath = argv[index];
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

const USAGE = "node benchmarks/tools/materialize-instrument.mjs --out <new-empty-path> [--source benchmarks]";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(`${USAGE}\n`);
  else {
    try {
      if (!options.outPath) throw new Error(USAGE);
      process.stdout.write(`${JSON.stringify(materializeInstrumentSnapshot(options))}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
    }
  }
}
