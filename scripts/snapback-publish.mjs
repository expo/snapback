#!/usr/bin/env node

// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
// the runtime/CLI/Contract/React/Expo/client/codegen/app-CLI closure must install from a public
// registry without sibling checkouts or repository-only resolution.
// @ref LLP 0041#acceptance — publication is staged from immutable tarballs;
// dry-run is the default and a real publish is double-confirmed.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJcs, sha256Hex } from './snapback-promotion-core.mjs';
import {
  PACKAGE_DEPENDENCY_SECTIONS,
  PACKAGE_INVENTORY,
  assertNoUndeclaredSymbolRemovals,
  publishedSymbolsSnapshot,
  registrySymbolIdentities,
  parseBoundedJsonBytes,
  readBoundedFileBytes,
  readBoundedJsonFile,
  sha256File,
  validateCandidateLedger,
  validateQualifiedPlatformReceipts,
  validateQualifiedStagingLedger,
  validateQualifiedTarballs,
  validateInternalDependencyClosure,
  validatePublishedSymbolsSnapshot,
  validateSymbolLifecycle,
} from './snapback-publish-core.mjs';
import { sha256TarEntry } from './snapback-tar-entry.mjs';
import { enforceTelemetryCurrentGate } from './telemetry-release-gate.mjs';
import {
  CAPABILITY_QUALIFICATION_ENV_BY_PLATFORM,
  PUBLICATION_CAPABILITY_QUALIFICATION_FIELD,
  assertPublicationCapabilityQualificationMatrix,
  assertStagedRuntimeAdminConsole,
  assertStagedRuntimeStoreQualification,
  readPublicationCapabilityQualificationsFromEnvironment,
} from './publication-store-qualification-gate.mjs';
import { verifyRuntimePackageSeal } from '../packages/snapback-cli/runtime-readiness.mjs';
import {
  assertRuntimeCatalogBuildIdentityProof,
  inspectRuntimeCatalogBuildIdentity,
} from './runtime-package-authority.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRegistry = 'https://registry.npmjs.org';
const symbolRegistryPath = join(root, 'guide/reference/registry.json');
const symbolLifecyclePath = join(root, 'guide/reference/lifecycle.json');
const symbolLifecycleSchemaPath = join(root, 'guide/reference/lifecycle.schema.json');
const publishedSymbolsPath = join(root, 'guide/reference/published-symbols.json');
const runtimePackages = new Map([
  ['darwin-arm64', 'snapback-runtime-darwin-arm64'],
  ['linux-x64', 'snapback-runtime-linux-x64'],
]);
const commonPackages = [
  'snapback-contract',
  'snapback-client',
  'snapback-codegen',
  'snapback-react',
  'snapback-umbrella',
  'snapback-expo',
  'snapback-expo-custody',
  'snapback-app-cli',
  'snapback-cli',
  'snapback-vite',
  'snapback-acceptance',
  'create-snapback-app',
];
const allPackages = [...runtimePackages.values(), ...commonPackages];

const usage = `usage: node scripts/snapback-publish.mjs [--version <semver>]
  [--scope-preset <identity>] [--tag <tag>] [--out <dir>]
  [--runtime-platforms <host|all|comma-list>]
  [--qualified-ledger <path>] [--platform-receipt <path>]
  [--publish] [--otp <code>] [--allow-dirty]

Default mode packs and runs npm publish --dry-run only. A real publish requires
both --publish and SNAPBACK_PUBLISH_CONFIRM=yes-really, and publishes the
complete runtime matrix under an immutable non-default candidate tag. Moving
the default tag is a separate, externally leased promotion. Cross-host release
assembly supplies explicit runtime artifact paths to each platform package's
prepare script. A real publication consumes, without restaging, one
self-digested qualified ledger and clean staged receipts from both platforms.`;

function fail(message, exitCode = 1, diagnosticCode = null) {
  const code = diagnosticCode ?? (exitCode === 2
    ? 'SNAPBACK_PUBLISH_ARGUMENT_INVALID'
    : 'SNAPBACK_PUBLISH_REFUSED');
  console.error(JSON.stringify({
    ok: false,
    diagnostics: [{
      code,
      severity: 'error',
      subsystem: 'publish',
      message,
    }],
  }));
  process.exit(exitCode);
}

function redactAuthenticationUrls(text) {
  return String(text)
    .replace(/https:\/\/www\.npmjs\.com\/auth\/cli\/\S+/g, 'https://www.npmjs.com/auth/cli/[redacted]')
    .replace(/https:\/\/registry\.npmjs\.org\/-\/v1\/done\?authId=\S+/g, 'https://registry.npmjs.org/-/v1/done?authId=[redacted]');
}

function parseArgs(argv) {
  const options = {
    version: '0.1.0',
    scopePreset: 'identity',
    tag: 'latest',
    out: join(root, 'dist-publish'),
    runtimePlatforms: 'host',
    publish: false,
    otp: null,
    allowDirty: false,
    qualifiedLedger: null,
    platformReceipts: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail(`${arg} requires a value\n${usage}`, 2);
      return value;
    };
    if (arg === '--version') options.version = take();
    else if (arg === '--scope-preset') options.scopePreset = take();
    else if (arg === '--tag') options.tag = take();
    else if (arg === '--out') options.out = resolve(take());
    else if (arg === '--runtime-platforms') options.runtimePlatforms = take();
    else if (arg === '--otp') options.otp = take();
    else if (arg === '--qualified-ledger') options.qualifiedLedger = resolve(take());
    else if (arg === '--platform-receipt') options.platformReceipts.push(resolve(take()));
    else if (arg === '--publish') options.publish = true;
    else if (arg === '--allow-dirty') options.allowDirty = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    } else fail(`unknown argument ${arg}\n${usage}`, 2);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) {
    fail(`invalid version ${options.version}`, 2);
  }
  if (options.scopePreset !== 'identity') {
    // Decision 9 (LLP 0115): the terminal @expo/snapback-* names publish
    // under the identity preset. The retired `ccheever` alias preset only
    // survives read-side, for validating pre-migration ledgers.
    fail(`unsupported scope preset ${options.scopePreset}`, 2);
  }
  const hostPlatform = `${process.platform}-${process.arch}`;
  const requestedPlatforms = options.runtimePlatforms === 'host'
    ? [hostPlatform]
    : options.runtimePlatforms === 'all'
      ? [...runtimePackages.keys()]
      : options.runtimePlatforms.split(',').filter(Boolean);
  if (requestedPlatforms.length === 0
      || new Set(requestedPlatforms).size !== requestedPlatforms.length
      || requestedPlatforms.some((platform) => !runtimePackages.has(platform))) {
    fail(
      `unsupported runtime platform selection ${options.runtimePlatforms}; expected host, all, or ${[...runtimePackages.keys()].join(',')}`,
      2,
    );
  }
  options.runtimePlatforms = requestedPlatforms;
  return options;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
  });
}

function buildAdminConsoleSnapshot() {
  // @ref LLP 0017#static-bundling-and-the-native-shell — publication owns a
  // fresh static/native snapshot; runtime preparation must never bless an
  // ambient, potentially stale dist directory.
  const adminRoot = join(root, 'admin-ui');
  const installed = run(
    'bun',
    ['install', '--frozen-lockfile', '--cwd', adminRoot],
    { timeout: 360_000 },
  );
  if (installed.status !== 0) {
    fail(`could not install the locked admin console build graph:\n${installed.stderr || installed.stdout}`);
  }
  const built = run('bun', ['run', '--cwd', adminRoot, 'build'], { timeout: 360_000 });
  if (built.status !== 0) {
    fail(`could not build the packaged admin console snapshot:\n${built.stderr || built.stdout}`);
  }
}

function publishedName(sourceName, preset) {
  if (preset === 'identity') return sourceName;
  throw new Error(`unsupported scope preset ${preset}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function verifyPackedRuntimeSeal({
  tarballPath,
  packageName,
  platformId,
  hostPlatformId = `${process.platform}-${process.arch}`,
}) {
  const extractionRoot = mkdtempSync(join(dirname(tarballPath), '.runtime-seal-'));
  try {
    execFileSync('tar', ['-xzf', tarballPath, '-C', extractionRoot]);
    const packageRoot = join(extractionRoot, 'package');
    const [platform, architecture] = platformId.split('-');
    const verdict = verifyRuntimePackageSeal({
      root: packageRoot,
      binaryPath: join(packageRoot, 'bin', 'snapback'),
      packageName,
      platform,
      architecture,
    });
    if (!verdict.ok) {
      const error = new Error(
        `${packageName} npm tarball failed its runtime seal (${verdict.reason}): `
        + verdict.diagnostic.message,
      );
      error.code = verdict.diagnostic.code;
      throw error;
    }
    assertRuntimeCatalogBuildIdentityProof(
      verdict.receipt.buildIdentity,
      verdict.receipt.catalogBuildIdentityProof,
    );
    if (hostPlatformId === platformId) {
      const binaryPath = join(packageRoot, 'bin', 'snapback');
      const identity = JSON.parse(
        execFileSync(binaryPath, ['build-identity'], { encoding: 'utf8' }),
      );
      inspectRuntimeCatalogBuildIdentity({
        binaryPath,
        binaryIdentity: identity,
      });
    }
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
}

function verifyQualifiedRuntimeTarballs({ ledger, rootDirectory }) {
  for (const [platformId, directory] of runtimePackages) {
    const sourceName = JSON.parse(
      readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'),
    ).name;
    const row = ledger.packages.find((candidate) => candidate.sourceName === sourceName);
    if (!row) throw new Error(`qualified ledger is missing runtime package ${sourceName}`);
    verifyPackedRuntimeSeal({
      tarballPath: join(rootDirectory, row.tarball),
      packageName: row.name,
      platformId,
    });
  }
}

function sourceDirty() {
  return run('git', ['status', '--porcelain']).stdout.trim().length > 0;
}

function validateSymbolPublicationState() {
  const registry = readBoundedJsonFile(symbolRegistryPath, 'current symbol registry');
  const currentIdentities = registrySymbolIdentities(registry);
  const lifecycle = validateSymbolLifecycle({
    document: readBoundedJsonFile(symbolLifecyclePath, 'authored symbol lifecycle'),
    schema: readBoundedJsonFile(symbolLifecycleSchemaPath, 'symbol lifecycle schema'),
    currentIdentities,
  });
  const snapshot = validatePublishedSymbolsSnapshot(
    readBoundedJsonFile(publishedSymbolsPath, 'published symbol snapshot'),
  );
  assertNoUndeclaredSymbolRemovals({
    snapshot,
    currentIdentities,
    lifecycle,
  });
  return { registry, snapshot };
}

function versionExists(name, version) {
  const result = run('npm', [
    'view', `${name}@${version}`, 'version', '--json',
    '--registry', publicRegistry,
  ]);
  if (result.status === 0) return true;
  if (/E404|404 Not Found/.test(`${result.stdout}\n${result.stderr}`)) return false;
  fail(`registry probe failed for ${name}@${version}:\n${result.stderr}`);
}

function candidateTagMatches(name, tag, version) {
  const result = run('npm', [
    'view', name, 'dist-tags', '--json', '--registry', publicRegistry,
  ]);
  if (result.status !== 0) {
    fail(`registry tag probe failed for ${name}:\n${result.stderr}`);
  }
  const tags = result.stdout.trim() ? JSON.parse(result.stdout) : {};
  return tags[tag] === version;
}

function bindRegistryArtifact(row, out) {
  const downloadRoot = mkdtempSync(join(out, '.registry-'));
  try {
    const packed = run('npm', [
      'pack',
      `${row.name}@${row.version}`,
      '--pack-destination', downloadRoot,
      '--json',
      '--ignore-scripts',
      '--registry', publicRegistry,
    ], { timeout: 360_000 });
    if (packed.status !== 0) {
      fail(`could not retrieve published artifact for ${row.name}@${row.version}:\n${packed.stderr || packed.stdout}`);
    }
    const record = JSON.parse(packed.stdout)[0];
    const downloaded = join(downloadRoot, record.filename);
    const manifest = JSON.parse(execFileSync(
      'tar', ['-xzOf', downloaded, 'package/package.json'], { encoding: 'utf8' },
    ));
    if (manifest.name !== row.name || manifest.version !== row.version) {
      fail(`published registry identity drift for ${row.name}@${row.version}`);
    }
    for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
      if (JSON.stringify(manifest[section] ?? {}) !== JSON.stringify(row[section])) {
        fail(`published registry ${section} closure drift for ${row.name}@${row.version}`);
      }
    }
    validateInternalDependencyClosure(manifest, row.version);
    row.registrySha256 = sha256(downloaded);
    if (row.registrySha256 !== row.sha256) {
      fail(
        `published registry bytes differ from the staged artifact for ${row.name}@${row.version}`,
      );
    }
    row.registryIntegrity = record.integrity ?? null;
    row.registryShasum = record.shasum ?? null;
  } finally {
    rmSync(downloadRoot, { recursive: true, force: true });
  }
}

function stage(options) {
  const out = resolve(options.out);
  mkdirSync(out, { recursive: true });
  const stageRoot = mkdtempSync(join(out, '.stage-'));
  const nameMap = new Map();
  for (const directory of allPackages) {
    const sourceManifest = JSON.parse(
      readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'),
    );
    nameMap.set(sourceManifest.name, publishedName(sourceManifest.name, options.scopePreset));
  }
  const enumeratedSourceNames = allPackages.map((directory) => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'),
    );
    return manifest.name;
  });
  const inventorySourceNames = PACKAGE_INVENTORY.map(([sourceName]) => sourceName);
  if (JSON.stringify(enumeratedSourceNames) !== JSON.stringify(inventorySourceNames)) {
    fail('publish enumeration does not match the exact package inventory/order');
  }

  const rows = [];
  try {
    const packages = [
      ...options.runtimePlatforms.map((platform) => runtimePackages.get(platform)),
      ...commonPackages,
    ];
    for (const directory of packages) {
      const sourceDir = join(root, 'packages', directory);
      const sourceManifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'));
      if (sourceManifest.private === true) fail(`${sourceManifest.name} is still private`);
      if (!Array.isArray(sourceManifest.files) || sourceManifest.files.length === 0) {
        fail(`${sourceManifest.name} must declare an explicit files list`);
      }
      const stageDir = join(stageRoot, directory);
      mkdirSync(stageDir, { recursive: true });
      const prepareScript = directory === 'snapback-codegen'
        ? 'prepare-runtime-artifacts.mjs'
        : directory === 'snapback-runtime-darwin-arm64'
          ? 'prepare-runtime.mjs'
          : directory === 'snapback-runtime-linux-x64'
            ? 'prepare-runtime.mjs'
          : null;
      if (prepareScript) {
        const prepared = run('node', [prepareScript], { cwd: sourceDir, timeout: 300_000 });
        if (prepared.status !== 0) {
          fail(`could not prepare ${sourceManifest.name} runtime artifacts:\n${prepared.stderr || prepared.stdout}`);
        }
      }
      for (const entry of sourceManifest.files) {
        const source = join(sourceDir, entry);
        if (!existsSync(source)) fail(`${sourceManifest.name} files entry is missing: ${entry}`);
        cpSync(source, join(stageDir, entry), { recursive: true });
      }
      const manifest = structuredClone(sourceManifest);
      manifest.name = nameMap.get(sourceManifest.name);
      manifest.version = options.version;
      delete manifest.private;
      delete manifest.scripts;
      for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
        for (const [dependency, value] of Object.entries(manifest[section] ?? {})) {
          if (
            dependency.startsWith('@ccheever/snapback-')
            || dependency.startsWith('@snapback/')
          ) {
            fail(
              `${sourceManifest.name} uses a pre-migration internal key ${section}.${dependency}`,
            );
          }
          if (!nameMap.has(dependency)) {
            if (/^(?:workspace:|file:|link:)/.test(String(value))) {
              fail(`${sourceManifest.name} has unpublished ${section}.${dependency}=${value}`);
            }
            continue;
          }
          const mapped = nameMap.get(dependency);
          manifest[section][dependency] = mapped === dependency
            ? options.version
            : `npm:${mapped}@${options.version}`;
        }
      }
      validateInternalDependencyClosure(manifest, options.version);
      writeFileSync(join(stageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      const packed = run('npm', ['pack', stageDir, '--pack-destination', out, '--json']);
      if (packed.status !== 0) fail(`npm pack failed for ${manifest.name}:\n${packed.stderr}`);
      const record = JSON.parse(packed.stdout)[0];
      const tarballPath = join(out, record.filename);
      const packedManifest = JSON.parse(execFileSync(
        'tar', ['-xzOf', tarballPath, 'package/package.json'], { encoding: 'utf8' },
      ));
      if (packedManifest.name !== manifest.name || packedManifest.version !== options.version) {
        fail(`packed identity drift for ${sourceManifest.name}`);
      }
      const runtimePlatform = [...runtimePackages.entries()]
        .find(([, runtimeDirectory]) => runtimeDirectory === directory)?.[0] ?? null;
      if (runtimePlatform !== null) {
        try {
          // @ref LLP 0123#package-seal-landing-2026-08-06 — consumption
          // coherence is defined over package-manager-delivered bytes.
          // Reopen the seal from npm's serialized bytes. In particular, npm
          // omits framework symlinks, so pre-pack verification is insufficient
          // for Darwin runtime packages.
          verifyPackedRuntimeSeal({
            tarballPath,
            packageName: manifest.name,
            platformId: runtimePlatform,
          });
        } catch (error) {
          fail(error.message, 1, error.code);
        }
      }
      rows.push({
        publicationOrder: rows.length,
        sourceName: sourceManifest.name,
        name: manifest.name,
        version: options.version,
        dependencies: packedManifest.dependencies ?? {},
        optionalDependencies: packedManifest.optionalDependencies ?? {},
        peerDependencies: packedManifest.peerDependencies ?? {},
        devDependencies: packedManifest.devDependencies ?? {},
        tarball: record.filename,
        sha256: sha256(tarballPath),
        runtimeBinarySha256: directory.startsWith('snapback-runtime-')
          ? sha256TarEntry(tarballPath, 'package/bin/snapback')
          : null,
        runtimeSupportSha256: directory === 'snapback-runtime-darwin-arm64'
          ? sha256TarEntry(
            tarballPath,
            'package/Frameworks/hermesvm.framework/Versions/1/hermesvm',
          )
          : directory === 'snapback-runtime-linux-x64'
            ? sha256TarEntry(tarballPath, 'package/lib/libhermesvm.so')
            : null,
        files: record.entryCount,
        unpackedSize: record.unpackedSize,
        status: 'packed',
      });
    }
    return rows;
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
const options = parseArgs(argv);
if (options.publish && process.env.SNAPBACK_PUBLISH_CONFIRM !== 'yes-really') {
  fail('real publish requires --publish and SNAPBACK_PUBLISH_CONFIRM=yes-really');
}
if (options.publish && options.runtimePlatforms.length !== runtimePackages.size) {
  fail('real publish requires --runtime-platforms all so the CLI never points at a missing supported runtime');
}
if (options.publish && options.scopePreset !== 'identity') {
  fail('real publication is limited to the decided @expo/snapback-* terminal closure');
}
if (options.publish && !options.qualifiedLedger) {
  fail('real publication requires --qualified-ledger; it never restages release bytes');
}
if (options.publish && options.platformReceipts.length !== 2) {
  fail('real publication requires exactly two --platform-receipt proofs');
}
if (!options.publish && (options.qualifiedLedger || options.platformReceipts.length > 0)) {
  fail('--qualified-ledger and --platform-receipt are real-publication inputs only');
}
if (!options.publish) buildAdminConsoleSnapshot();
if (options.publish
    && !/^bakeoff-\d+-\d+-\d+-[0-9a-f]{12}$/.test(options.tag)) {
  fail('real publication requires a non-default candidate tag bakeoff-<version>-<source-sha12>');
}
if (options.publish && options.tag.includes('latest')) {
  fail('candidate publication cannot mutate the latest tag');
}
const dirty = sourceDirty();
if (options.publish && dirty) fail('refusing to publish a dirty source tree');
const revision = run('git', ['rev-parse', 'HEAD']).stdout.trim();
if (options.publish) {
  const versionTag = options.version.replaceAll('.', '-');
  const expectedCandidateTag = `bakeoff-${versionTag}-${revision.slice(0, 12)}`;
  if (options.tag !== expectedCandidateTag) {
    fail(`candidate tag must be ${expectedCandidateTag} for this exact version and source revision`);
  }
}
const qualifiedShape = !options.publish
  && options.scopePreset === 'identity'
  && options.runtimePlatforms.length === runtimePackages.size
  && /^bakeoff-\d+-\d+-\d+-[0-9a-f]{12}$/.test(options.tag)
  && options.tag === `bakeoff-${options.version.replaceAll('.', '-')}-${revision.slice(0, 12)}`;
let symbolPublicationState = null;
if (options.publish || qualifiedShape) {
  try {
    // @ref LLP 0194#amendment-2026-08-09-authored-symbol-lifecycle-facts —
    // qualification and publication fail before registry effects when a
    // previously published identity disappears without removedIn.
    symbolPublicationState = validateSymbolPublicationState();
  } catch (error) {
    fail(error.message, 1, error.code);
  }
}
let qualifiedLedger = null;
let qualifiedPlatformReceipts = null;
let qualifiedRoot = null;
let telemetryCurrentness = null;
let rows;
if (options.publish) {
  qualifiedLedger = readBoundedJsonFile(options.qualifiedLedger, 'qualified publication ledger');
  try {
    validateQualifiedStagingLedger(qualifiedLedger);
  } catch (error) {
    fail(`qualified ledger refused: ${error.message}`);
  }
  if (
    qualifiedLedger.revision !== revision
    || qualifiedLedger.version !== options.version
    || qualifiedLedger.tag !== options.tag
  ) {
    fail('qualified ledger does not bind this exact source revision/version/tag');
  }
  qualifiedRoot = dirname(options.qualifiedLedger);
  try {
    validateQualifiedTarballs({ ledger: qualifiedLedger, root: qualifiedRoot });
    verifyQualifiedRuntimeTarballs({
      ledger: qualifiedLedger,
      rootDirectory: qualifiedRoot,
    });
  } catch (error) {
    fail(error.message, 1, error.code);
  }
  const records = options.platformReceipts.map((path) => {
    const bytes = readBoundedFileBytes(path, 'qualified platform receipt');
    return {
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      receipt: parseBoundedJsonBytes(bytes, 'qualified platform receipt'),
    };
  });
  try {
    assertPublicationCapabilityQualificationMatrix({
      ledger: qualifiedLedger,
      qualifications: records.map(
        ({ receipt }) => receipt?.[PUBLICATION_CAPABILITY_QUALIFICATION_FIELD],
      ),
    });
    qualifiedPlatformReceipts = validateQualifiedPlatformReceipts({
      ledger: qualifiedLedger,
      records,
    });
  } catch (error) {
    fail(`qualified platform receipts refused: ${error.message}`, 1, error.code);
  }
  rows = qualifiedLedger.packages.map((row) => ({
    ...row,
    status: 'qualified',
    candidateTagVerified: false,
    registrySha256: null,
    registryIntegrity: null,
    registryShasum: null,
  }));
  try {
    telemetryCurrentness = enforceTelemetryCurrentGate({
      repoRoot: root,
      candidateRevision: revision,
    });
  } catch (error) {
    fail(error.message);
  }
} else {
  rows = stage(options);
}
const ledger = options.publish ? {
  schemaVersion: 'snapback.package-candidate-ledger.v1',
  mode: 'publish',
  revision,
  sourceDirty: false,
  version: options.version,
  tag: options.tag,
  registry: publicRegistry,
  scopePreset: 'identity',
  runtimePlatforms: [...qualifiedLedger.runtimePlatforms],
  qualifiedLedgerSha256: qualifiedLedger.stagedLedgerSha256,
  qualifiedPlatformReceipts,
  telemetryCurrentness,
  packages: rows,
  candidateLedgerSha256: null,
} : {
  schemaVersion: qualifiedShape
    ? 'snapback.package-qualified-staging-ledger.v1'
    : 'snapback.package-candidate-ledger.v1',
  mode: 'dry-run',
  revision,
  sourceDirty: dirty,
  version: options.version,
  tag: options.tag,
  registry: publicRegistry,
  scopePreset: options.scopePreset,
  runtimePlatforms: options.runtimePlatforms,
  packages: rows,
  ...(qualifiedShape ? { stagedLedgerSha256: null } : {}),
};
if (!options.publish) {
  const capabilityQualificationInputPresent = Object.values(
    CAPABILITY_QUALIFICATION_ENV_BY_PLATFORM,
  ).some((name) => Object.hasOwn(process.env, name));
  // The receiptless pass manufactures the bytes later executed on both
  // platforms; it is not publication-qualified until pass two supplies both
  // receipts. Any partial evidence still enters the fail-closed comparison.
  const receiptlessManufacturingPass =
    process.env.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS === '1';
  if (
    (qualifiedShape && !receiptlessManufacturingPass)
    || capabilityQualificationInputPresent
  ) {
    try {
      assertPublicationCapabilityQualificationMatrix({
        ledger,
        qualifications: readPublicationCapabilityQualificationsFromEnvironment(),
      });
    } catch (error) {
      fail(error.message, 1, error.code);
    }
  }
}
const ledgerPath = join(options.out, 'publish-ledger.json');
if (options.publish && resolve(ledgerPath) === resolve(options.qualifiedLedger)) {
  fail('candidate ledger output must not overwrite the immutable qualified ledger');
}

if (options.publish) {
  try {
    assertStagedRuntimeStoreQualification({
      stagedDir: qualifiedRoot,
      ledger: qualifiedLedger,
    });
    assertStagedRuntimeAdminConsole({
      stagedDir: qualifiedRoot,
      ledger: qualifiedLedger,
    });
  } catch (error) {
    fail(error.message, 1, error.code);
  }
  const who = run('npm', ['whoami', '--registry', publicRegistry]);
  if (who.status !== 0) fail(`npm authentication required:\n${who.stderr}`);
  for (const row of rows) {
    if (versionExists(row.name, row.version)) {
      row.status = 'skipped-already-published';
      bindRegistryArtifact(row, options.out);
      if (!candidateTagMatches(row.name, options.tag, row.version)) {
        fail(`candidate tag ${options.tag} does not select ${row.name}@${row.version}`);
      }
      row.candidateTagVerified = true;
      writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
      continue;
    }
    const args = [
      'publish', join(qualifiedRoot, row.tarball),
      '--access', 'public', '--tag', options.tag,
      '--registry', publicRegistry,
    ];
    if (options.otp) args.push('--otp', options.otp);
    const result = run('npm', args);
    if (result.status !== 0) {
      const failure = `${result.stderr}\n${result.stdout}`;
      row.status = 'publish-failed';
      row.errorCode = failure.match(/npm error code (\S+)/)?.[1] ?? 'UNKNOWN';
      writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
      const otpHint = row.errorCode === 'EOTP'
        ? '\nAuthenticate interactively or rerun with --otp <current-code>; the ledger is resumable.'
        : '';
      fail(`publish failed for ${row.name}; rerun resumes safely:${otpHint}\n${redactAuthenticationUrls(result.stderr)}`);
    }
    row.status = 'published';
    bindRegistryArtifact(row, options.out);
    if (!candidateTagMatches(row.name, options.tag, row.version)) {
      fail(`candidate tag ${options.tag} does not select ${row.name}@${row.version}`);
    }
    row.candidateTagVerified = true;
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  }
} else {
  for (const row of rows) {
    const result = run('npm', [
      'publish', join(options.out, row.tarball), '--dry-run',
      '--access', 'public', '--tag', options.tag, '--json',
      '--registry', publicRegistry,
    ], { timeout: 360_000 });
    if (result.status !== 0) {
      fail(
        `publish dry-run failed for ${row.name} (${result.error?.code ?? result.status ?? result.signal ?? 'unknown'}):\n`
        + `${result.stderr || result.stdout}`,
      );
    }
    row.status = 'dry-run-ok';
  }
}

if (options.publish) {
  const incomplete = rows.filter((row) => (
    !['published', 'skipped-already-published'].includes(row.status)
    || row.registrySha256 !== row.sha256
    || typeof row.registryIntegrity !== 'string'
    || !candidateTagMatches(row.name, options.tag, row.version)
  ));
  if (incomplete.length > 0) {
    fail(`candidate ledger is incomplete for ${incomplete.map((row) => row.name).join(', ')}`);
  }
  // Compute over the exact closed object with only its digest omitted.
  const { candidateLedgerSha256: _digest, ...candidateWithoutDigest } = ledger;
  ledger.candidateLedgerSha256 = sha256Hex(canonicalJcs(candidateWithoutDigest));
  try {
    validateCandidateLedger(ledger);
  } catch (error) {
    fail(`candidate ledger closure refused: ${error.message}`);
  }
} else if (qualifiedShape) {
  const { stagedLedgerSha256: _digest, ...stagingWithoutDigest } = ledger;
  ledger.stagedLedgerSha256 = sha256Hex(canonicalJcs(stagingWithoutDigest));
  try {
    validateQualifiedStagingLedger(ledger);
  } catch (error) {
    fail(`qualified staging ledger closure refused: ${error.message}`);
  }
}
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
if (options.publish) {
  try {
    const refreshed = publishedSymbolsSnapshot({
      previousSnapshot: symbolPublicationState.snapshot,
      registry: symbolPublicationState.registry,
      publishedVersion: options.version,
      sourceRevision: revision,
      candidateLedgerSha256: ledger.candidateLedgerSha256,
      capturedAt: new Date().toISOString(),
    });
    // Refresh only after every registry artifact and the final candidate ledger
    // have validated, so failed or partial publications cannot advance history.
    writeFileSync(publishedSymbolsPath, `${JSON.stringify(refreshed, null, 2)}\n`);
  } catch (error) {
    fail(`publication completed but the symbol snapshot refresh failed: ${error.message}`, 1, error.code);
  }
}
for (const row of rows) {
  console.log(`${row.status.padEnd(27)} ${row.name}@${row.version} ${row.tarball} ${row.sha256}`);
}
console.log(`ledger: ${ledgerPath}`);
if (!options.publish) console.log('DRY RUN complete — nothing was published.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
