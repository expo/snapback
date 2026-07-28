#!/usr/bin/env node

// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
// the runtime/CLI/Contract/React/client/codegen/app-CLI closure must install from a public
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRegistry = 'https://registry.npmjs.org';
const runtimePackages = new Map([
  ['darwin-arm64', 'snapback-runtime-darwin-arm64'],
  ['linux-x64', 'snapback-runtime-linux-x64'],
]);
const commonPackages = [
  'snapback-contract',
  'snapback-client',
  'snapback-codegen',
  'snapback-vite',
  'snapback-react',
  'snapback-app-cli',
  'snapback-cli',
];
const allPackages = [...runtimePackages.values(), ...commonPackages];

const usage = `usage: node scripts/snapback-publish.mjs [--version <semver>]
  [--scope-preset <identity|ccheever>] [--tag <tag>] [--out <dir>]
  [--runtime-platforms <host|all|comma-list>]
  [--publish] [--otp <code>] [--allow-dirty]

Default mode packs and runs npm publish --dry-run only. A real publish requires
both --publish and SNAPBACK_PUBLISH_CONFIRM=yes-really, and publishes the
complete runtime matrix under an immutable non-default candidate tag. Moving
the default tag is a separate, externally leased promotion. Cross-host release
assembly supplies explicit runtime artifact paths to each platform package's
prepare script.`;

function fail(message, code = 1) {
  console.error(`snapback-publish: ${message}`);
  process.exit(code);
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
  if (!['identity', 'ccheever'].includes(options.scopePreset)) {
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

function publishedName(sourceName, preset) {
  if (preset === 'identity') return sourceName;
  return `@ccheever/snapback-${sourceName.slice('@snapback/'.length)}`;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sourceDirty() {
  return run('git', ['status', '--porcelain']).stdout.trim().length > 0;
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
    if (JSON.stringify(manifest.dependencies ?? {}) !== JSON.stringify(row.dependencies)
        || JSON.stringify(manifest.optionalDependencies ?? {})
          !== JSON.stringify(row.optionalDependencies)) {
      fail(`published registry dependency closure drift for ${row.name}@${row.version}`);
    }
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
      for (const section of ['dependencies', 'optionalDependencies']) {
        for (const [dependency, value] of Object.entries(manifest[section] ?? {})) {
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
      rows.push({
        publicationOrder: rows.length,
        sourceName: sourceManifest.name,
        name: manifest.name,
        version: options.version,
        dependencies: packedManifest.dependencies ?? {},
        optionalDependencies: packedManifest.optionalDependencies ?? {},
        tarball: record.filename,
        sha256: sha256(tarballPath),
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

const options = parseArgs(process.argv.slice(2));
if (options.publish && process.env.SNAPBACK_PUBLISH_CONFIRM !== 'yes-really') {
  fail('real publish requires --publish and SNAPBACK_PUBLISH_CONFIRM=yes-really');
}
if (options.publish && options.runtimePlatforms.length !== runtimePackages.size) {
  fail('real publish requires --runtime-platforms all so the CLI never points at a missing supported runtime');
}
if (options.publish && options.scopePreset !== 'ccheever') {
  fail('real publication is limited to the decided @ccheever public closure');
}
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
const rows = stage(options);
const ledger = {
  schemaVersion: 'snapback.package-candidate-ledger.v1',
  mode: options.publish ? 'publish' : 'dry-run',
  revision,
  sourceDirty: dirty,
  version: options.version,
  tag: options.tag,
  registry: publicRegistry,
  scopePreset: options.scopePreset,
  runtimePlatforms: options.runtimePlatforms,
  packages: rows,
};
const ledgerPath = join(options.out, 'publish-ledger.json');

if (options.publish) {
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
      'publish', join(options.out, row.tarball),
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
  ledger.candidateLedgerSha256 = sha256Hex(canonicalJcs(ledger));
}
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
for (const row of rows) {
  console.log(`${row.status.padEnd(27)} ${row.name}@${row.version} ${row.tarball} ${row.sha256}`);
}
console.log(`ledger: ${ledgerPath}`);
if (!options.publish) console.log('DRY RUN complete — nothing was published.');
