import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const DISALLOWED_SPECIFIER = /^(?:workspace:|file:|https?:|git(?:\+|:)|github:|gitlab:|bitbucket:)|(?:^|\/)\.\.(?:\/|$)/iu;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function refuse(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function ownPackageBytes(root) {
  let bytes = 0;
  let files = 0;
  let runtimeJavaScriptFiles = 0;
  let nativeEvidence = null;
  const visit = (directory, relativePrefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        refuse('SNAPBACK_ISOLATED_NODE_DEPENDENCY_SYMLINK_REFUSED', `dependency closure contains symlink ${rel}`, { path: rel });
      }
      if (stat.isDirectory()) visit(path, rel);
      else if (stat.isFile()) {
        bytes += stat.size;
        files += 1;
        if (/\.(?:[cm]?js)$/u.test(entry.name) && !entry.name.endsWith('.d.ts')) {
          runtimeJavaScriptFiles += 1;
        }
        if (entry.name === 'binding.gyp' || entry.name.endsWith('.node')) nativeEvidence ??= rel;
      }
    }
  };
  visit(root);
  return { bytes, files, runtimeJavaScriptFiles, nativeEvidence };
}

function esmCapable(manifest) {
  if (manifest.type === 'module') return true;
  if (typeof manifest.module === 'string' && !manifest.module.endsWith('.cjs')) return true;
  const stack = [manifest.exports];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value) continue;
    if (typeof value === 'string' && value.endsWith('.mjs')) return true;
    if (typeof value === 'object') {
      if (typeof value.import === 'string' || value.import) return true;
      stack.push(...Object.values(value));
    }
  }
  return false;
}

function dependencyMaps(manifest) {
  return [manifest.dependencies, manifest.optionalDependencies].filter(Boolean);
}

function resolveLockedDependency(packages, fromKey, dependency) {
  let base = fromKey;
  while (true) {
    const candidate = base ? `${base}/node_modules/${dependency}` : `node_modules/${dependency}`;
    if (packages[candidate]) return candidate;
    const marker = base.lastIndexOf('/node_modules/');
    if (marker < 0) break;
    base = base.slice(0, marker);
  }
  const rootCandidate = `node_modules/${dependency}`;
  return packages[rootCandidate] ? rootCandidate : null;
}

export function verifyInstalledClosure(projectRoot) {
  const packageLock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  if (packageLock.lockfileVersion !== 3 || !packageLock.packages) {
    refuse('SNAPBACK_ISOLATED_NODE_LOCKFILE_UNSUPPORTED', 'dependency closure requires npm lockfileVersion 3 with a packages table');
  }
  for (const [name, specifier] of Object.entries(rootManifest.dependencies ?? {})) {
    if (!EXACT_VERSION.test(specifier) || DISALLOWED_SPECIFIER.test(specifier)) {
      refuse('SNAPBACK_ISOLATED_NODE_DIRECT_SPECIFIER_REFUSED', `direct dependency ${name} must use one exact registry version, got ${specifier}`, { name, specifier });
    }
  }

  const packageKeys = Object.keys(packageLock.packages).filter(Boolean).sort();
  if (packageKeys.length > 256) {
    refuse('SNAPBACK_ISOLATED_NODE_CLOSURE_INSTANCE_LIMIT', `locked closure has ${packageKeys.length} instances; maximum is 256`);
  }

  let totalBytes = 0;
  let totalFiles = 0;
  const integrityList = [];
  const packageRecords = new Map();
  for (const key of packageKeys) {
    const locked = packageLock.packages[key];
    if (locked.link || !locked.version || !locked.integrity) {
      refuse('SNAPBACK_ISOLATED_NODE_LOCK_INTEGRITY_MISSING', `locked instance ${key} must carry version and exact integrity and must not be a link`, { key });
    }
    if (!/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/u.test(locked.integrity)) {
      refuse('SNAPBACK_ISOLATED_NODE_LOCK_INTEGRITY_INVALID', `locked instance ${key} has a non-exact integrity`, { key, integrity: locked.integrity });
    }
    const installedRoot = join(projectRoot, ...key.split('/'));
    const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
    if (manifest.version !== locked.version) {
      refuse('SNAPBACK_ISOLATED_NODE_INSTALLED_VERSION_MISMATCH', `${key} installed ${manifest.version}, lockfile requires ${locked.version}`);
    }
    for (const script of LIFECYCLE_SCRIPTS) {
      if (manifest.scripts?.[script]) {
        refuse('SNAPBACK_ISOLATED_NODE_DEPENDENCY_SCRIPT_REFUSED', `${manifest.name}@${manifest.version} declares ${script}: ${manifest.scripts[script]}`, {
          package: manifest.name,
          version: manifest.version,
          script,
          remediation: 'choose an ESM package whose published closure has no install/prepare lifecycle scripts',
        });
      }
    }
    for (const dependencyMap of dependencyMaps(manifest)) {
      for (const [name, specifier] of Object.entries(dependencyMap)) {
        if (DISALLOWED_SPECIFIER.test(specifier)) {
          refuse('SNAPBACK_ISOLATED_NODE_DEPENDENCY_SPECIFIER_REFUSED', `${manifest.name} dependency ${name} uses refused specifier ${specifier}`, { package: manifest.name, name, specifier });
        }
      }
    }
    const measured = ownPackageBytes(installedRoot);
    if (!esmCapable(manifest) && measured.runtimeJavaScriptFiles > 0) {
      refuse('SNAPBACK_ISOLATED_NODE_COMMONJS_ONLY_REFUSED', `${manifest.name}@${manifest.version} has no ESM entry`, {
        package: manifest.name,
        remediation: 'choose a package publishing an ESM import condition or module entry',
      });
    }
    if (manifest.gypfile === true) {
      refuse('SNAPBACK_ISOLATED_NODE_NATIVE_ADDON_REFUSED', `${manifest.name}@${manifest.version} declares gypfile`, { package: manifest.name });
    }
    if (measured.nativeEvidence) {
      refuse('SNAPBACK_ISOLATED_NODE_NATIVE_ADDON_REFUSED', `${manifest.name}@${manifest.version} contains ${measured.nativeEvidence}`, { package: manifest.name, evidence: measured.nativeEvidence });
    }
    totalBytes += measured.bytes;
    totalFiles += measured.files;
    integrityList.push({ name: manifest.name, version: manifest.version, path: key, integrity: locked.integrity });
    packageRecords.set(key, { manifest, locked });
  }
  if (totalBytes > 64 * 1024 * 1024) {
    refuse('SNAPBACK_ISOLATED_NODE_CLOSURE_BYTES_LIMIT', `installed closure is ${totalBytes} bytes; maximum is 67108864`);
  }

  let maximumDepth = 0;
  const reachable = new Set();
  const visiting = new Set();
  const visit = (key, depth) => {
    maximumDepth = Math.max(maximumDepth, depth);
    if (depth > 32) refuse('SNAPBACK_ISOLATED_NODE_CLOSURE_DEPTH_LIMIT', `dependency depth ${depth} exceeds 32`, { key });
    if (visiting.has(key)) return;
    reachable.add(key);
    visiting.add(key);
    const record = packageRecords.get(key);
    for (const dependency of Object.keys(record?.locked.dependencies ?? {})) {
      const resolved = resolveLockedDependency(packageLock.packages, key, dependency);
      if (!resolved) refuse('SNAPBACK_ISOLATED_NODE_LOCK_CLOSURE_OPEN', `${key} dependency ${dependency} does not resolve inside the lockfile`, { key, dependency });
      visit(resolved, depth + 1);
    }
    visiting.delete(key);
  };
  for (const dependency of Object.keys(rootManifest.dependencies ?? {})) {
    const key = resolveLockedDependency(packageLock.packages, '', dependency);
    if (!key) refuse('SNAPBACK_ISOLATED_NODE_LOCK_CLOSURE_OPEN', `direct dependency ${dependency} is absent from lockfile`);
    visit(key, 1);
  }
  if (reachable.size !== packageKeys.length) {
    const unreachable = packageKeys.filter((key) => !reachable.has(key));
    refuse('SNAPBACK_ISOLATED_NODE_LOCK_EXTRANEOUS', `lockfile contains ${unreachable.length} unreachable package instances`, { unreachable });
  }

  const digest = createHash('sha256').update(JSON.stringify(integrityList)).digest('hex');
  return {
    admitted: true,
    lockfileVersion: packageLock.lockfileVersion,
    lockedInstances: packageKeys.length,
    maximumDepth,
    unpackedBytes: totalBytes,
    files: totalFiles,
    integrityList,
    integrityListDigest: `sha256:${digest}`,
    lifecycleScriptsReRead: true,
    installedTreeReRead: true,
    commonJsOnlyInstances: 0,
    nativeAddonInstances: 0,
  };
}
