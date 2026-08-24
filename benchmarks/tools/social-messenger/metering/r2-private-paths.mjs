import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

function inside(root, path) {
  const logical = relative(resolve(root), resolve(path));
  return logical === ""
    || (logical !== ".." && !logical.startsWith(`..${sep}`) && !isAbsolute(logical));
}

function assertNoSymlinkComponents(path, label, { allowMissingTail = false } = {}) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = relative(root, absolute).split(sep).filter(Boolean);
  let cursor = root;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) {
      if (allowMissingTail) return;
      throw new Error(`R2_PRIVATE_PATH: ${label} is missing at ${cursor}`);
    }
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`R2_PRIVATE_PATH: ${label} has a symbolic-link component at ${cursor}`);
    }
  }
}

function canonicalDirectory(path, label) {
  const absolute = resolve(path);
  assertNoSymlinkComponents(absolute, label);
  if (realpathSync(absolute) !== absolute || !statSync(absolute).isDirectory()) {
    throw new Error(`R2_PRIVATE_PATH: ${label} must be one canonical directory`);
  }
  return absolute;
}

export function canonicalPrivateExecutionRoot(harnessConfig) {
  const privateRoot = resolve(harnessConfig.paths?.privateExecutionRoot ?? "");
  return canonicalDirectory(privateRoot, "campaign private execution root");
}

export function ensureCanonicalDirectoryUnderRoot(root, path, label) {
  const canonicalRoot = canonicalDirectory(root, "campaign private execution root");
  const target = resolve(path);
  if (!inside(canonicalRoot, target) || target === canonicalRoot) {
    throw new Error(`R2_PRIVATE_PATH: ${label} must be a narrow child of the campaign private root`);
  }
  let cursor = canonicalRoot;
  for (const segment of relative(canonicalRoot, target).split(sep)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) mkdirSync(cursor);
    canonicalDirectory(cursor, label);
  }
  return target;
}

export function inspectPrivateCellPath({ harnessConfig, cellId, requireCells = false, requireCell = false }) {
  const privateRoot = canonicalPrivateExecutionRoot(harnessConfig);
  const cellsRoot = resolve(privateRoot, "cells");
  if (existsSync(cellsRoot)) canonicalDirectory(cellsRoot, "campaign private cells directory");
  else if (requireCells || requireCell) {
    throw new Error("R2_PRIVATE_PATH: campaign private cells directory is missing");
  }
  const cellRoot = resolve(cellsRoot, cellId);
  if (!inside(privateRoot, cellRoot) || dirname(cellRoot) !== cellsRoot) {
    throw new Error("R2_PRIVATE_PATH: private cell must be an exact direct child of the cells directory");
  }
  if (existsSync(cellRoot)) canonicalDirectory(cellRoot, `private cell ${cellId}`);
  else if (requireCell) throw new Error(`R2_PRIVATE_PATH: private cell ${cellId} is missing`);
  return { privateRoot, cellsRoot, cellRoot };
}

export function ensurePrivateCellTransactionParent({ harnessConfig, cellId, configDirectory }) {
  const inspected = inspectPrivateCellPath({ harnessConfig, cellId });
  if (resolve(configDirectory) !== inspected.cellRoot) {
    throw new Error("R2_PRIVATE_PATH: attempt directory differs from the exact registered private cell");
  }
  if (!existsSync(inspected.cellsRoot)) {
    ensureCanonicalDirectoryUnderRoot(
      inspected.privateRoot,
      inspected.cellsRoot,
      "campaign private cells directory",
    );
  }
  const rechecked = inspectPrivateCellPath({ harnessConfig, cellId, requireCells: true });
  if (existsSync(rechecked.cellRoot)) {
    throw new Error(`R2_PRIVATE_PATH: private cell ${cellId} already exists`);
  }
  return rechecked;
}

export function configuredPrivateLockPath(harnessConfig, { ensureParent = false, requireLock = false } = {}) {
  const privateRoot = canonicalPrivateExecutionRoot(harnessConfig);
  const lockPath = resolve(harnessConfig.execution?.exclusiveHostLock?.path ?? "");
  if (!inside(privateRoot, lockPath) || lockPath === privateRoot) {
    throw new Error("R2_ADMISSION_LOCK: exclusive host lock must be a narrow path under the campaign private root");
  }
  const lockParent = dirname(lockPath);
  if (ensureParent) {
    ensureCanonicalDirectoryUnderRoot(privateRoot, lockParent, "exclusive host-lock parent");
  } else if (existsSync(lockParent)) {
    canonicalDirectory(lockParent, "exclusive host-lock parent");
  } else {
    throw new Error("R2_PRIVATE_PATH: exclusive host-lock parent is missing");
  }
  if (existsSync(lockPath)) canonicalDirectory(lockPath, "exclusive host lock");
  else if (requireLock) throw new Error("R2_PRIVATE_PATH: exclusive host lock is missing");
  return { privateRoot, lockParent, lockPath };
}
