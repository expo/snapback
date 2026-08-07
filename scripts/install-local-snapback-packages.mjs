#!/usr/bin/env node

// Configure one external/nested app to consume the React client closure from
// this checkout, then install it with the checkout's pinned Bun version.
//
// @ref LLP 0176#development-and-packaging — G0 A2 requires one coherent local
// package closure without changing the exact dependency pins that get published.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = realpathSync(resolve(dirname(SCRIPT_PATH), '..'));
const PACKAGES_ROOT = join(REPO_ROOT, 'packages');
const ROOT_PACKAGES = Object.freeze([
  '@expo/snapback-client',
  '@expo/snapback-expo',
  '@expo/snapback-react',
]);
const INTERNAL_PREFIX = '@expo/snapback-';
const LOCAL_PACKAGE_DIRECTORY = join('.snapback', 'local-source-packages');
const RUNTIME_DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const APP_DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function fail(message) {
  throw new Error(`install-local-snapback-packages: ${message}`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`could not read ${label} at ${path}: ${error.message}`);
  }
}

function packageInventory() {
  const inventory = new Map();
  for (const entry of readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const packageRoot = join(PACKAGES_ROOT, entry.name);
    const manifestPath = join(packageRoot, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath, 'source package manifest');
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      fail(`source package manifest has no name: ${manifestPath}`);
    }
    if (inventory.has(manifest.name)) {
      fail(`duplicate source package name ${manifest.name}`);
    }
    inventory.set(manifest.name, {
      manifest,
      packageRoot: realpathSync(packageRoot),
    });
  }
  return inventory;
}

export function resolveLocalClientClosure() {
  const inventory = packageInventory();
  const closure = new Map();
  const pending = [...ROOT_PACKAGES];

  while (pending.length > 0) {
    const name = pending.shift();
    if (closure.has(name)) continue;
    const sourcePackage = inventory.get(name);
    if (!sourcePackage) fail(`checkout has no source package for ${name}`);
    closure.set(name, sourcePackage);

    for (const section of RUNTIME_DEPENDENCY_SECTIONS) {
      for (const dependency of Object.keys(sourcePackage.manifest[section] ?? {})) {
        if (!dependency.startsWith(INTERNAL_PREFIX)) continue;
        const target = inventory.get(dependency);
        if (!target) {
          fail(`${name} has an internal ${section} edge with no local source: ${dependency}`);
        }
        const declared = String(sourcePackage.manifest[section][dependency]);
        if (EXACT_VERSION.test(declared) && declared !== target.manifest.version) {
          fail(`${name} requires ${dependency}@${declared}, but the checkout carries ${target.manifest.version}`);
        }
        pending.push(dependency);
      }
    }
  }

  const versions = new Set([...closure.values()].map(({ manifest }) => manifest.version));
  if (versions.size !== 1 || [...versions].some((version) => !EXACT_VERSION.test(version))) {
    fail(`local client closure must carry one exact source version; found ${[...versions].join(', ')}`);
  }

  return closure;
}

function localFileSpecifier(appRoot, packageRoot) {
  let path = relative(appRoot, packageRoot).split(sep).join('/');
  if (!path.startsWith('.')) path = `./${path}`;
  return `file:${path}`;
}

function isPathWithin(parent, child) {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function assertAppRoot(input) {
  const candidate = isAbsolute(input) ? input : resolve(process.cwd(), input);
  if (!existsSync(candidate)) fail(`app directory does not exist: ${candidate}`);
  const appRoot = realpathSync(candidate);
  if (appRoot === REPO_ROOT || appRoot === PACKAGES_ROOT || isPathWithin(PACKAGES_ROOT, appRoot)) {
    fail('the consumer must be an app outside the Snapback package workspace');
  }
  const manifestPath = join(appRoot, 'package.json');
  if (!existsSync(manifestPath)) fail(`app has no package.json: ${manifestPath}`);
  const stat = lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`app package.json must be a regular file, not a symlink: ${manifestPath}`);
  }
  return { appRoot, manifestPath };
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha512Integrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
}

function localPackageFilename(name) {
  return `${name.slice(INTERNAL_PREFIX.length).replace(/[^a-z0-9._-]/gu, '-')}.tgz`;
}

function contentAddressedLocalPackageFilename(name, digest) {
  const base = localPackageFilename(name).replace(/\.tgz$/u, '');
  return `${base}.${digest}.tgz`;
}

function packLocalClosure(appRoot, closure) {
  const bunVersion = assertBunVersion();
  const packageDirectory = join(appRoot, LOCAL_PACKAGE_DIRECTORY);
  // Keep the prior lockfile-addressed artifacts until Bun has admitted the
  // newly packed closure. A source change rotates the content-addressed file
  // specifier; removing its predecessor first leaves Bun unable to migrate an
  // existing lockfile because the integrity record still names that path.
  mkdirSync(packageDirectory, { recursive: true });

  const artifacts = new Map();
  for (const [name, sourcePackage] of [...closure].sort(([left], [right]) => left.localeCompare(right))) {
    const provisionalFilename = `${localPackageFilename(name).replace(/\.tgz$/u, '')}.packing-${process.pid}.tgz`;
    const provisionalPath = join(packageDirectory, provisionalFilename);
    rmSync(provisionalPath, { force: true });
    const result = spawnSync('bun', [
      'pm',
      'pack',
      '--ignore-scripts',
      '--filename',
      provisionalPath,
      '--quiet',
    ], {
      cwd: sourcePackage.packageRoot,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      fail(`could not pack ${name}: ${result.stderr || result.stdout || result.error?.message || 'unknown error'}`);
    }
    if (!existsSync(provisionalPath)) fail(`Bun did not produce ${provisionalPath}`);
    const stat = lstatSync(provisionalPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`local package artifact must be a regular file: ${provisionalPath}`);
    }
    const digest = sha256(provisionalPath);
    const artifactPath = join(
      packageDirectory,
      contentAddressedLocalPackageFilename(name, digest),
    );
    if (existsSync(artifactPath)) {
      const existing = lstatSync(artifactPath);
      if (
        !existing.isFile()
        || existing.isSymbolicLink()
        || sha256(artifactPath) !== digest
      ) {
        fail(`content-addressed local package is not the expected regular file: ${artifactPath}`);
      }
      rmSync(provisionalPath, { force: true });
    } else {
      renameSync(provisionalPath, artifactPath);
    }
    artifacts.set(name, Object.freeze({
      artifactPath,
      sha256: digest,
      sourcePackageRoot: sourcePackage.packageRoot,
    }));
  }
  return Object.freeze({ artifacts, bunVersion, packageDirectory });
}

function cleanupSupersededLocalPackages(configuration) {
  const retained = new Set(configuration.artifactPaths);
  for (const entry of readdirSync(configuration.packageDirectory)) {
    const path = join(configuration.packageDirectory, entry);
    if (!retained.has(path)) rmSync(path, { recursive: true, force: true });
  }
}

function writeJsonAtomically(path, value) {
  writeTextAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextAtomically(path, value) {
  const temporary = `${path}.snapback-source-${process.pid}`;
  try {
    writeFileSync(temporary, value, { flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function localArtifactSpecifier(name, value) {
  if (typeof value !== 'string' || !value.startsWith('file:')) return null;
  const relativePath = value.slice('file:'.length);
  const base = localPackageFilename(name).replace(/\.tgz$/u, '');
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `^\\.snapback/local-source-packages/${escapedBase}(?:\\.[0-9a-f]{64})?\\.tgz$`,
    'u',
  ).test(relativePath) ? relativePath : null;
}

function localLockPackageMetadata(sourcePackage, closure) {
  const metadata = {};
  for (const section of RUNTIME_DEPENDENCY_SECTIONS) {
    const declared = sourcePackage.manifest[section];
    if (!declared || Object.keys(declared).length === 0) continue;
    metadata[section] = Object.fromEntries(Object.entries(declared).map(([name, value]) => [
      name,
      closure.has(name) ? closure.get(name).manifest.version : value,
    ]));
  }
  const optionalPeers = Object.keys(sourcePackage.manifest.peerDependencies ?? {})
    .filter((name) => sourcePackage.manifest.peerDependenciesMeta?.[name]?.optional === true);
  if (optionalPeers.length > 0) metadata.optionalPeers = optionalPeers;
  for (const field of ['bin', 'cpu', 'os']) {
    if (sourcePackage.manifest[field] !== undefined) {
      metadata[field] = sourcePackage.manifest[field];
    }
  }
  return metadata;
}

function localLockPackageRecord(name, relativePath, sourcePackage, closure, artifactPath) {
  return `    ${JSON.stringify(name)}: [${JSON.stringify(`${name}@${relativePath}`)}, ${JSON.stringify(
    localLockPackageMetadata(sourcePackage, closure),
  )}, ${JSON.stringify(sha512Integrity(artifactPath))}],`;
}

// Bun consults existing package records before reconciling changed file
// specifiers. In a fresh clone the content-addressed tarballs are intentionally
// ignored, so a tracked lock that names an older source pack otherwise fails
// ENOENT before Bun can rotate it. Rewrite only helper-owned paths and their
// exact dependency/integrity tuples, leaving the registry graph byte-for-byte
// unchanged and the lock valid for Bun's normal verification.
function reconcileLocalLockfile(
  appRoot,
  previousManifest,
  localSpecifiers,
  closure,
  artifacts,
) {
  const lockPath = join(appRoot, 'bun.lock');
  if (!existsSync(lockPath)) return;
  const replacements = new Map();
  const rotatedRecords = new Map();
  for (const [name, nextSpecifier] of localSpecifiers) {
    const nextPath = localArtifactSpecifier(name, nextSpecifier);
    if (nextPath === null) fail(`generated an invalid local package specifier for ${name}`);
    for (const section of APP_DEPENDENCY_SECTIONS) {
      const previousPath = localArtifactSpecifier(name, previousManifest[section]?.[name]);
      if (previousPath !== null && previousPath !== nextPath) {
        replacements.set(previousPath, nextPath);
        rotatedRecords.set(name, nextPath);
      }
    }
    const overridePath = localArtifactSpecifier(name, previousManifest.overrides?.[name]);
    if (overridePath !== null && overridePath !== nextPath) {
      replacements.set(overridePath, nextPath);
      rotatedRecords.set(name, nextPath);
    }
  }
  if (replacements.size === 0) return;
  const original = readFileSync(lockPath, 'utf8');
  let reconciled = original;
  for (const [previousPath, nextPath] of replacements) {
    reconciled = reconciled.split(previousPath).join(nextPath);
  }
  const recordReplacements = new Map([...rotatedRecords].map(([name, nextPath]) => [
    `    ${JSON.stringify(name)}: [${JSON.stringify(`${name}@${nextPath}`)}`,
    localLockPackageRecord(
      name,
      nextPath,
      closure.get(name),
      closure,
      artifacts.get(name).artifactPath,
    ),
  ]));
  reconciled = reconciled.split('\n').map((line) => {
    for (const [prefix, replacement] of recordReplacements) {
      if (line.startsWith(prefix)) return replacement;
    }
    return line;
  }).join('\n');
  if (reconciled !== original) writeTextAtomically(lockPath, reconciled);
}

export function configureLocalClientClosure(appInput) {
  const { appRoot, manifestPath } = assertAppRoot(appInput);
  const manifest = readJson(manifestPath, 'consumer package manifest');
  const previousManifest = structuredClone(manifest);
  const closure = resolveLocalClientClosure();
  const packed = packLocalClosure(appRoot, closure);
  const directPackages = new Set(ROOT_PACKAGES);
  const localSpecifiers = new Map(
    [...packed.artifacts].map(([name, artifact]) => [
      name,
      localFileSpecifier(appRoot, artifact.artifactPath),
    ]),
  );

  manifest.dependencies = { ...(manifest.dependencies ?? {}) };
  manifest.overrides = { ...(manifest.overrides ?? {}) };

  for (const [name, specifier] of localSpecifiers) {
    for (const section of APP_DEPENDENCY_SECTIONS) {
      if (section === 'dependencies') continue;
      if (manifest[section] && Object.hasOwn(manifest[section], name)) {
        delete manifest[section][name];
        if (Object.keys(manifest[section]).length === 0) delete manifest[section];
      }
    }

    if (directPackages.has(name)) {
      manifest.dependencies[name] = specifier;
    } else {
      delete manifest.dependencies[name];
    }
    // Bun resolves both dependency and peer-dependency edges. Keep every
    // internal name in the consumer's top-level override set—even the two
    // direct roots—so peer resolution cannot consult registry metadata.
    manifest.overrides[name] = specifier;
  }

  reconcileLocalLockfile(
    appRoot,
    previousManifest,
    localSpecifiers,
    closure,
    packed.artifacts,
  );
  if (Object.keys(manifest.overrides).length === 0) delete manifest.overrides;
  writeJsonAtomically(manifestPath, manifest);

  return Object.freeze({
    appRoot,
    artifactDigests: Object.freeze(Object.fromEntries(
      [...packed.artifacts].map(([name, artifact]) => [name, artifact.sha256]).sort(),
    )),
    bunVersion: packed.bunVersion,
    manifestPath,
    packageDirectory: packed.packageDirectory,
    artifactPaths: Object.freeze(
      [...packed.artifacts.values()].map(({ artifactPath }) => artifactPath),
    ),
    directPackages: Object.freeze([...ROOT_PACKAGES]),
    overridePackages: Object.freeze([...localSpecifiers.keys()].sort()),
    localSpecifiers: Object.freeze(Object.fromEntries([...localSpecifiers].sort())),
  });
}

function requiredBunVersion() {
  const rootManifest = readJson(join(REPO_ROOT, 'package.json'), 'checkout package manifest');
  const match = /^bun@([^\s]+)$/u.exec(rootManifest.packageManager ?? '');
  if (!match) fail('checkout package.json must pin packageManager as bun@<version>');
  return match[1];
}

function assertBunVersion() {
  const expected = requiredBunVersion();
  const result = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`Bun ${expected} is required but bun --version failed: ${result.stderr || result.error?.message || 'unknown error'}`);
  }
  const actual = result.stdout.trim();
  if (actual !== expected) fail(`checkout requires Bun ${expected}; found ${actual}`);
  return actual;
}

function usage() {
  return `Usage:
  node scripts/install-local-snapback-packages.mjs <expo-app-directory> [options]

Configures @expo/snapback-client, @expo/snapback-expo, and
@expo/snapback-react as local file dependencies, generates local overrides
for their internal package closure, and runs the checkout-pinned Bun install.

Options:
  --frozen-lockfile   Require package.json to match an existing bun.lock
  --no-install        Pack/configure the closure without running Bun install
  --no-cache          Forward --no-cache to Bun (proof/debug use)
  --cache-dir <path>  Forward an isolated cache directory to Bun
  --registry <url>    Override Bun's registry (proof/debug use)
  -h, --help          Show this help
`;
}

function parseArguments(argv) {
  const parsed = {
    appInput: null,
    cacheDir: null,
    frozenLockfile: false,
    install: true,
    noCache: false,
    registry: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') return { help: true };
    if (argument === '--frozen-lockfile') {
      parsed.frozenLockfile = true;
      continue;
    }
    if (argument === '--no-install') {
      parsed.install = false;
      continue;
    }
    if (argument === '--no-cache') {
      parsed.noCache = true;
      continue;
    }
    if (argument === '--cache-dir' || argument === '--registry') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) fail(`${argument} requires a value`);
      index += 1;
      if (argument === '--cache-dir') parsed.cacheDir = value;
      else parsed.registry = value;
      continue;
    }
    if (argument.startsWith('-')) fail(`unknown option ${argument}`);
    if (parsed.appInput !== null) fail('expected exactly one Expo app directory');
    parsed.appInput = argument;
  }
  if (parsed.appInput === null) fail('missing Expo app directory');
  return parsed;
}

function installWithBun(configuration, options) {
  const args = ['install'];
  if (options.frozenLockfile) args.push('--frozen-lockfile');
  if (options.noCache) args.push('--no-cache');
  if (options.cacheDir !== null) {
    const cacheDir = isAbsolute(options.cacheDir)
      ? options.cacheDir
      : resolve(process.cwd(), options.cacheDir);
    args.push('--cache-dir', cacheDir);
  }
  if (options.registry !== null) args.push('--registry', options.registry);

  const result = spawnSync('bun', args, {
    cwd: configuration.appRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    fail(`bun install failed with status ${result.status ?? 'unknown'}`);
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const configuration = configureLocalClientClosure(options.appInput);
  if (options.install) {
    installWithBun(configuration, options);
    // Only after Bun rewrites/adopts the lock may the helper remove prior
    // content-addressed tarballs. The directory is exclusively helper-owned.
    cleanupSupersededLocalPackages(configuration);
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'snapback.local-source-package-closure.v1',
    ok: true,
    appRoot: configuration.appRoot,
    artifactDigests: configuration.artifactDigests,
    directPackages: configuration.directPackages,
    overridePackages: configuration.overridePackages,
    localSpecifiers: configuration.localSpecifiers,
    installed: options.install,
    frozenLockfile: options.frozenLockfile,
    bunVersion: configuration.bunVersion,
  })}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
