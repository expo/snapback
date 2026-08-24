import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const R2_HOST_LOCK_VERSION = "snapback.r2-exclusive-host-lock.v1";
const CLAIM_VERSION = "snapback.r2-exclusive-host-lock-claim.v1";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function inside(root, path) {
  const logical = relative(resolve(root), resolve(path));
  return logical === ""
    || (logical !== ".." && !logical.startsWith(`..${sep}`) && !isAbsolute(logical));
}

function configuredLockPath(harnessConfig) {
  const privateRoot = resolve(harnessConfig.paths?.privateExecutionRoot ?? "");
  const path = resolve(harnessConfig.execution?.exclusiveHostLock?.path ?? "");
  if (!inside(privateRoot, path) || path === privateRoot) {
    throw new Error("R2_ADMISSION_LOCK: exclusive host lock must be a narrow path under the campaign private root");
  }
  return path;
}

function readRegular(path, label) {
  if (lstatSync(path).isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link`);
  const canonicalPath = realpathSync(path);
  if (!statSync(canonicalPath).isFile()) throw new Error(`${label} must be a regular file`);
  return readFileSync(canonicalPath);
}

function readJson(path, label) {
  return JSON.parse(readRegular(path, label).toString("utf8"));
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function archivePath(lockPath, owner, nowMs, reason) {
  const historyRoot = join(dirname(lockPath), `${basename(lockPath)}.history`);
  mkdirSync(historyRoot, { recursive: true });
  const stamp = new Date(nowMs).toISOString().replaceAll(":", "-");
  return join(historyRoot, `${stamp}-${owner.token.slice(0, 12)}-${reason}`);
}

function existingLockState(lockPath) {
  const ownerPath = join(lockPath, "owner.json");
  const ownerBytes = readRegular(ownerPath, "host lock owner");
  const owner = JSON.parse(ownerBytes.toString("utf8"));
  const claimPath = join(lockPath, "controller-claim.json");
  const claim = existsSync(claimPath) ? readJson(claimPath, "host lock controller claim") : null;
  return { ownerPath, ownerBytes, owner, claimPath, claim };
}

function lockIsLive({ owner, claim }, nowMs, processAlive) {
  if (claim !== null) return processAlive(claim.pid);
  if (processAlive(owner.pid)) return true;
  return Number.isFinite(Date.parse(owner.awaitingControllerUntil))
    && nowMs <= Date.parse(owner.awaitingControllerUntil);
}

function createOwner({
  harnessConfig,
  cellId,
  purpose,
  reservedBy,
  nowMs,
  pid,
  token,
  awaitingControllerUntil,
}) {
  return {
    version: R2_HOST_LOCK_VERSION,
    runId: harnessConfig.runId,
    cellId,
    purpose,
    token,
    hostname: hostname(),
    reservedBy,
    pid,
    createdAt: new Date(nowMs).toISOString(),
    awaitingControllerUntil: awaitingControllerUntil === null
      ? null
      : new Date(awaitingControllerUntil).toISOString(),
  };
}

export function acquireExclusiveHostLock({
  harnessConfig,
  cellId,
  purpose,
  reservedBy,
  nowMs = Date.now(),
  pid = process.pid,
  token = randomBytes(32).toString("hex"),
  awaitingControllerUntil = null,
  recoverStale = false,
  mayRecoverOwner = () => false,
  processAlive = defaultProcessAlive,
}) {
  if (!new Set(["admission", "finalize-existing"]).has(purpose)) {
    throw new Error("R2_ADMISSION_LOCK: unsupported exclusive lock purpose");
  }
  if (typeof reservedBy !== "string" || reservedBy.length === 0) {
    throw new Error("R2_ADMISSION_LOCK: reservedBy must be a non-empty operator identity");
  }
  const lockPath = configuredLockPath(harnessConfig);
  mkdirSync(dirname(lockPath), { recursive: true });
  const owner = createOwner({
    harnessConfig,
    cellId,
    purpose,
    reservedBy,
    nowMs,
    pid,
    token,
    awaitingControllerUntil,
  });
  const ownerBytes = Buffer.from(`${JSON.stringify(owner, null, 2)}\n`);
  const candidatePath = mkdtempSync(join(dirname(lockPath), `.${basename(lockPath)}.candidate-`));
  try {
    writeFileSync(join(candidatePath, "owner.json"), ownerBytes, { flag: "wx" });
    try {
      renameSync(candidatePath, lockPath);
    } catch (error) {
      if (!existsSync(lockPath)) throw error;
      const existing = existingLockState(lockPath);
      if (!recoverStale) {
        throw new Error(
          `R2_ADMISSION_LOCK_HELD: ${existing.owner.runId}/${existing.owner.cellId} already owns ${lockPath}`,
        );
      }
      if (lockIsLive(existing, nowMs, processAlive)) {
        throw new Error("R2_ADMISSION_LOCK_HELD: the existing host-lock owner or controller is still live");
      }
      if (!mayRecoverOwner(existing.owner)) {
        throw new Error(
          "R2_ADMISSION_LOCK_STALE: explicit stale recovery cannot authorize this owner/cell transition",
        );
      }
      const archived = archivePath(lockPath, existing.owner, nowMs, "stale");
      renameSync(lockPath, archived);
      renameSync(candidatePath, lockPath);
    }
  } finally {
    if (existsSync(candidatePath)) rmSync(candidatePath, { recursive: true, force: true });
  }
  const ownerPath = join(lockPath, "owner.json");
  return {
    version: R2_HOST_LOCK_VERSION,
    path: lockPath,
    token,
    owner: {
      path: ownerPath,
      sha256: digest(ownerBytes),
      declaration: owner,
    },
  };
}

export function verifyExclusiveHostLock(lock, harnessConfig, cellId) {
  const expectedPath = configuredLockPath(harnessConfig);
  if (
    lock?.version !== R2_HOST_LOCK_VERSION
    || lock.path !== expectedPath
    || typeof lock.token !== "string"
    || lock.token.length !== 64
    || lock.owner?.path !== join(expectedPath, "owner.json")
  ) {
    throw new Error("R2_ADMISSION_LOCK: admission does not bind the configured exclusive host lock");
  }
  const ownerBytes = readRegular(lock.owner.path, "host lock owner");
  const owner = JSON.parse(ownerBytes.toString("utf8"));
  if (
    digest(ownerBytes) !== lock.owner.sha256
    || !sameJson(owner, lock.owner.declaration)
    || owner.version !== R2_HOST_LOCK_VERSION
    || owner.runId !== harnessConfig.runId
    || owner.cellId !== cellId
    || owner.purpose !== "admission"
    || owner.token !== lock.token
    || owner.hostname !== hostname()
  ) {
    throw new Error("R2_ADMISSION_LOCK: live lock owner bytes do not match the admission binding");
  }
  return owner;
}

export function claimExclusiveHostLock({ lock, harnessConfig, cellId, artifactSha256, execution }) {
  verifyExclusiveHostLock(lock, harnessConfig, cellId);
  const claimPath = join(lock.path, "controller-claim.json");
  const claim = {
    version: CLAIM_VERSION,
    runId: harnessConfig.runId,
    cellId,
    token: lock.token,
    artifactSha256,
    pid: process.pid,
    parentPid: process.ppid,
    claimedAt: new Date().toISOString(),
    execution,
  };
  try {
    writeFileSync(claimPath, `${JSON.stringify(claim, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("R2_ADMISSION_LOCK_HELD: this admission artifact is already claimed by a controller");
    }
    throw error;
  }
  return { path: claimPath, declaration: claim };
}

export function assertExclusiveHostLockHeld({ lock, harnessConfig, cellId, claim }) {
  verifyExclusiveHostLock(lock, harnessConfig, cellId);
  const claimBytes = readRegular(claim.path, "host lock controller claim");
  const live = JSON.parse(claimBytes);
  if (
    live.version !== CLAIM_VERSION
    || live.runId !== harnessConfig.runId
    || live.cellId !== cellId
    || live.token !== lock.token
    || live.pid !== process.pid
    || !sameJson(live, claim.declaration)
  ) {
    throw new Error("R2_ADMISSION_LOCK: controller no longer holds the exact exclusive lock claim");
  }
}

export function releaseExclusiveHostLock({ lock, claim = null, outcome, nowMs = Date.now() }) {
  if (!existsSync(lock.path)) return null;
  const existing = existingLockState(lock.path);
  if (existing.owner.token !== lock.token) {
    throw new Error("R2_ADMISSION_LOCK: refusing to release a lock owned by another token");
  }
  if (claim !== null) {
    const liveClaim = readJson(claim.path, "host lock controller claim");
    if (!sameJson(liveClaim, claim.declaration)) {
      throw new Error("R2_ADMISSION_LOCK: refusing to release a changed controller claim");
    }
  }
  const release = {
    version: "snapback.r2-exclusive-host-lock-release.v1",
    runId: existing.owner.runId,
    cellId: existing.owner.cellId,
    token: existing.owner.token,
    outcome,
    releasedAt: new Date(nowMs).toISOString(),
  };
  writeFileSync(join(lock.path, "release.json"), `${JSON.stringify(release, null, 2)}\n`, { flag: "wx" });
  const archived = archivePath(lock.path, existing.owner, nowMs, "released");
  renameSync(lock.path, archived);
  return archived;
}

export function exclusiveHostLockPath(harnessConfig) {
  return configuredLockPath(harnessConfig);
}
