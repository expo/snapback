import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function resolvedInstalledVersions(appRoot, packageNames) {
  return Object.fromEntries(packageNames.map((name) => {
    const packagePath = join(appRoot, 'node_modules', ...name.split('/'), 'package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    return [name, Object.freeze({
      version: manifest.version,
      packageJson: realpathSync(packagePath),
    })];
  }));
}

export function gitWorktreeIdentity(repoRoot) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const porcelain = execFileSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return Object.freeze({ head, dirty: porcelain.trim().length > 0 });
}

export function harnessFileDigests(repoRoot) {
  const harnessRoot = join(repoRoot, 'demos', 'native-custody-probes', 'harness');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(repoRoot, path));
    }
  };
  visit(harnessRoot);
  files.sort();
  return Object.freeze(Object.fromEntries(files.map((file) => [
    file,
    `sha256:${sha256File(join(repoRoot, file))}`,
  ])));
}

export function runtimeBinaryIdentity(binaryInput) {
  if (typeof binaryInput !== 'string' || binaryInput.length === 0) {
    throw new Error('P0/runtime-integrity: SNAPBACK_RUNTIME_BINARY is required');
  }
  const binary = resolve(binaryInput);
  if (!existsSync(binary)) {
    throw new Error(`P0/runtime-integrity: SNAPBACK_RUNTIME_BINARY does not exist at ${binary}`);
  }
  let versionStamp;
  try {
    versionStamp = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(`P0/runtime-integrity: could not read runtime version stamp: ${error.message}`);
  }
  const binarySha256 = sha256File(binary);
  const receiptPath = `${binary}.runtime-readiness.json`;
  let readiness = null;
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt.binary?.sha256 !== binarySha256) {
      throw new Error(
        `P0/runtime-integrity: adjacent runtime-readiness receipt does not bind ${binary}`,
      );
    }
    readiness = Object.freeze({
      path: receiptPath,
      sha256: `sha256:${sha256File(receiptPath)}`,
      schemaVersion: receipt.schemaVersion ?? null,
      sourceRevision: receipt.sourceRevision ?? null,
      binaryIdentity: receipt.buildIdentity?.binary ?? receipt.buildIdentity ?? null,
      qualificationOk: receipt.qualification?.ok ?? null,
    });
  }
  return Object.freeze({
    path: binary,
    sha256: `sha256:${binarySha256}`,
    versionStamp,
    runtimeReadiness: readiness,
  });
}

function filesNamed(root, name) {
  const matches = [];
  if (!existsSync(root)) return matches;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === name) matches.push(path);
    }
  };
  visit(root);
  return matches;
}

export function matchingPriorBuildReceipt({
  evidenceRoot,
  currentRunDirectory,
  platform,
  bundleId,
  artifactSha256,
}) {
  for (const path of filesNamed(evidenceRoot, 'build-receipt.json')) {
    if (path.startsWith(`${currentRunDirectory}/`)) continue;
    try {
      const receipt = JSON.parse(readFileSync(path, 'utf8'));
      if (
        receipt?.schemaVersion === 'snapback.native-custody-build.v1'
        && receipt.platform === platform
        && receipt.bundleId === bundleId
        && receipt.artifact?.sha256 === artifactSha256
      ) {
        return Object.freeze({
          path: relative(evidenceRoot, path),
          sha256: `sha256:${sha256File(path)}`,
        });
      }
    } catch { /* malformed receipts cannot authorize artifact reuse */ }
  }
  return null;
}
