#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(here, '..');
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// @ref LLP 0049#config-and-secrets — deployment/config writes are an
// operator-side authority boundary; the exact controller must be committed,
// lock-installed, and verified before it receives secret stdin.

export class WranglerPreflightError extends Error {
  constructor(message) {
    super(`SNAPBACK_WRANGLER_PRECHECK_FAILED: ${message}`);
    this.name = 'WranglerPreflightError';
    this.code = 'SNAPBACK_WRANGLER_PRECHECK_FAILED';
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new WranglerPreflightError(`${label} is unavailable or invalid at ${file}: ${error.message}`);
  }
}

function assertLockedResolution(lockText, expectedVersion) {
  const escaped = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const record = new RegExp(`"wrangler"\\s*:\\s*\\["wrangler@${escaped}"(?:,|\\])`);
  if (!record.test(lockText)) {
    throw new WranglerPreflightError(
      `bun.lock does not resolve the deployment controller's pinned Wrangler ${expectedVersion}; run a frozen root install after reconciling the lock`,
    );
  }
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveLockedWrangler({ repoRoot = defaultRepoRoot } = {}) {
  const lock = readJson(path.join(repoRoot, 'cloudflare', 'wrangler.lock.json'), 'Wrangler version pin');
  if (typeof lock.version !== 'string' || !EXACT_VERSION.test(lock.version)) {
    throw new WranglerPreflightError('cloudflare/wrangler.lock.json must contain one exact semantic version');
  }

  let bunLock;
  try {
    bunLock = fs.readFileSync(path.join(repoRoot, 'bun.lock'), 'utf8');
  } catch (error) {
    throw new WranglerPreflightError(`bun.lock is unavailable: ${error.message}`);
  }
  assertLockedResolution(bunLock, lock.version);

  const nodeModulesRoot = path.join(repoRoot, 'node_modules');
  const packageRoot = path.join(repoRoot, 'node_modules', 'wrangler');
  const installed = readJson(path.join(packageRoot, 'package.json'), 'installed Wrangler package');
  if (installed.version !== lock.version) {
    throw new WranglerPreflightError(
      `installed Wrangler ${String(installed.version || 'unknown')} does not match pinned ${lock.version}; run bun install --frozen-lockfile at the repository root`,
    );
  }
  const relativeBin = installed.bin && typeof installed.bin.wrangler === 'string'
    ? installed.bin.wrangler
    : null;
  if (!relativeBin || path.isAbsolute(relativeBin) || relativeBin.split(/[\\/]/).includes('..')) {
    throw new WranglerPreflightError('installed Wrangler package has no safe wrangler bin entry');
  }
  let realNodeModulesRoot;
  let realPackageRoot;
  try {
    realNodeModulesRoot = fs.realpathSync(nodeModulesRoot);
    realPackageRoot = fs.realpathSync(packageRoot);
  } catch (error) {
    throw new WranglerPreflightError(`cannot attest the local Wrangler package path: ${error.message}`);
  }
  if (!isWithin(realNodeModulesRoot, realPackageRoot)) {
    throw new WranglerPreflightError('installed Wrangler package resolves outside this repository node_modules tree');
  }
  const candidateBinPath = path.resolve(packageRoot, relativeBin);
  let binPath;
  let binStat;
  try {
    binPath = fs.realpathSync(candidateBinPath);
    binStat = fs.statSync(binPath);
  } catch (error) {
    throw new WranglerPreflightError(`cannot inspect pinned Wrangler executable at ${candidateBinPath}: ${error.message}`);
  }
  if (!isWithin(realPackageRoot, binPath) || !binStat.isFile()) {
    throw new WranglerPreflightError(`pinned Wrangler executable is missing at ${binPath}`);
  }
  return {
    command: process.execPath,
    args: [binPath],
    binPath,
    version: lock.version,
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const wrangler = resolveLockedWrangler();
    if (process.argv[2] === '--print-bin') {
      process.stdout.write(wrangler.binPath);
    } else if (process.argv[2] === '--verify') {
      process.stdout.write(`Wrangler ${wrangler.version} verified at ${wrangler.binPath}\n`);
    } else {
      throw new WranglerPreflightError('expected --verify or --print-bin');
    }
  } catch (error) {
    process.stderr.write(`${String(error.message || error)}\n`);
    process.exit(2);
  }
}
