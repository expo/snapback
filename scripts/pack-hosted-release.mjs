#!/usr/bin/env node

// Assemble a Docker build context from explicit, already-staged artifacts.
// This command never reads a sibling checkout, downloads a dependency, builds
// Hermes, or guesses a default input path.
//
// @ref LLP 0111#tls-admission-evidence-and-packaging — the cold package lane
// is a closed input graph, with the patched Hermes tarball as a named object.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CADDY_BASE,
  OS_BASE,
  RUNTIME_BASE,
  canonicalJson,
  createHostedReleaseManifest,
} from '../demos/backend-bakeoff/hosted-release/release-manifest.mjs';

const REQUIRED_ARGUMENTS = [
  'staging-root',
  'source-tarball',
  'source-repository',
  'source-revision',
  'source-dirty',
  'dirty-paths-sha256',
  'package-tarball',
  'hermes-tarball',
  'runtime-libraries-tarball',
  'snapback-binary',
  'application-tarball',
  'public-assets-tarball',
  'sbom',
  'licenses',
  'platform',
  'target-id',
  'deployment-id',
  'image-tag',
  'dockerfile',
  'entrypoint',
  'caddyfile',
  'admission-renewer',
  'output-dir',
];
const ARTIFACT_ARGUMENTS = [
  'source-tarball',
  'package-tarball',
  'hermes-tarball',
  'runtime-libraries-tarball',
  'snapback-binary',
  'application-tarball',
  'public-assets-tarball',
  'sbom',
  'licenses',
];
const RECIPE_ARGUMENTS = ['dockerfile', 'entrypoint', 'caddyfile', 'admission-renewer'];
const REQUIRED_APPLICATION_PATHS = [
  'etc/hosted-edge.json',
  'etc/startup-artifacts.json',
  'generated/functions.manifest.json',
  'generated/schema.manifest.json',
  'generated/seed.json',
];
const FORBIDDEN_ARCHIVE_NAMES = [
  /(^|\/)\.env(?:\.|$)/u,
  /(^|\/)\.npmrc$/u,
  /(^|\/)id_(?:rsa|ed25519)$/u,
  /\.(?:pem|key|p12|pfx)$/u,
  /\.map$/u,
  /(^|\/)(?:app|hosted|dev)\.sqlite3?(?:-|$)/u,
];
const SECRET_CONTENT = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u,
  /AKIA[0-9A-Z]{16}/u,
  /(?:^|[^A-Za-z0-9])ghp_[A-Za-z0-9]{36}(?:$|[^A-Za-z0-9])/u,
  /(?:^|[^A-Za-z0-9])sk_live_[A-Za-z0-9]{16,}(?:$|[^A-Za-z0-9])/u,
];
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_ARCHIVE_FILES = 20_000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--') || value === undefined || value.startsWith('--')) {
      fail('SNAPBACK_HOSTED_RELEASE_ARGUMENT_INVALID', `expected --name value, observed ${option ?? '<end>'}`);
    }
    const name = option.slice(2);
    if (!REQUIRED_ARGUMENTS.includes(name) || values.has(name)) {
      fail('SNAPBACK_HOSTED_RELEASE_ARGUMENT_INVALID', `unknown or duplicate argument --${name}`);
    }
    values.set(name, value);
  }
  for (const name of REQUIRED_ARGUMENTS) {
    if (!values.has(name)) {
      fail('SNAPBACK_HOSTED_RELEASE_ARGUMENT_MISSING', `--${name} is required`);
    }
  }
  return Object.fromEntries(values);
}

function pathInside(root, path) {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function regularExplicitPath(path, label) {
  if (!isAbsolute(path)) {
    fail('SNAPBACK_HOSTED_RELEASE_PATH_INVALID', `${label} must be absolute`);
  }
  const observed = lstatSync(path);
  if (!observed.isFile() || observed.isSymbolicLink()) {
    fail('SNAPBACK_HOSTED_RELEASE_PATH_UNSAFE', `${label} must be a nonsymlink regular file`);
  }
  if (observed.size < 1 || observed.size > MAX_ARCHIVE_BYTES) {
    fail('SNAPBACK_HOSTED_RELEASE_PATH_INVALID', `${label} has an invalid size`);
  }
  return realpathSync(path);
}

function fileFact(path) {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  };
}

function run(command, args, { environment = process.env, timeout = 30_000 } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: environment,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(
      'SNAPBACK_HOSTED_RELEASE_PROBE_FAILED',
      `${basename(command)} ${args.join(' ')} failed`,
    );
  }
  return `${result.stdout}${result.stderr}`;
}

function archiveNames(path) {
  const output = run('tar', ['-tzf', path]);
  const names = output.split(/\r?\n/u).filter(Boolean);
  if (names.length < 1 || names.length > MAX_ARCHIVE_FILES) {
    fail('SNAPBACK_HOSTED_RELEASE_ARCHIVE_INVALID', `${basename(path)} has an invalid member count`);
  }
  const seen = new Set();
  for (const name of names) {
    const normalized = name.replace(/^(?:\.\/)+/u, '').replace(/\/$/u, '');
    if (
      name.includes('\0')
      || name.startsWith('/')
      || name.includes('//')
      || (
        normalized === ''
          ? name !== './'
          : normalized.split('/').some((part) => part === '.' || part === '..' || part === '')
      )
      || seen.has(normalized)
    ) {
      fail('SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE', `${basename(path)} has an unsafe member`);
    }
    seen.add(normalized);
  }
  const verbose = run('tar', ['-tvzf', path]).split(/\r?\n/u).filter(Boolean);
  if (
    verbose.length !== names.length
    || verbose.some((line, index) => (
      !['-', 'd'].includes(line[0])
      || (names[index] === './' && line[0] !== 'd')
    ))
  ) {
    fail(
      'SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE',
      `${basename(path)} contains a link, device, or unsupported member`,
    );
  }
  return names;
}

function sourceArchive(path, temporaryRoot) {
  const output = run('tar', ['-tzf', path]);
  const names = output.split(/\r?\n/u).filter(Boolean);
  if (names.length < 1 || names.length > MAX_ARCHIVE_FILES) {
    fail('SNAPBACK_HOSTED_RELEASE_SOURCE_INVALID', 'source archive has an invalid member count');
  }
  const seen = new Set();
  for (const name of names) {
    if (
      !/^[A-Za-z0-9_.@+/-]+$/u.test(name)
      || name.startsWith('/')
      || name.startsWith('./')
      || name.includes('//')
      || name.split('/').some((part) => part === '..')
      || seen.has(name)
    ) {
      fail('SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE', 'source archive has an unsafe member');
    }
    seen.add(name);
  }
  const verbose = run('tar', ['-tvzf', path]).split(/\r?\n/u).filter(Boolean);
  if (verbose.length !== names.length) {
    fail('SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE', 'source archive listing is ambiguous');
  }
  const virtualRoot = '/snapback-source';
  for (const [index, line] of verbose.entries()) {
    const type = line[0];
    const name = names[index];
    if (type === '-' || type === 'd') continue;
    if (type !== 'l') {
      fail(
        'SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE',
        'source archive contains a hard link, device, or unsupported member',
      );
    }
    const marker = ` ${name} -> `;
    const markerIndex = line.lastIndexOf(marker);
    const target = markerIndex < 0 ? '' : line.slice(markerIndex + marker.length);
    const resolvedTarget = resolve(virtualRoot, dirname(name), target);
    if (
      !/^[A-Za-z0-9_.@+/-]+$/u.test(target)
      || name.endsWith('/')
      || (resolvedTarget !== virtualRoot && !pathInside(virtualRoot, resolvedTarget))
      || names.some((candidate) => candidate.startsWith(`${name}/`))
    ) {
      fail(
        'SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE',
        `${name} is an unsafe source symlink`,
      );
    }
  }

  const destination = join(temporaryRoot, 'source');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  run('tar', ['-xzf', path, '-C', destination, '--no-same-owner', '--no-same-permissions']);
  const files = [];
  const visit = (current) => {
    for (const name of readdirSync(current).sort()) {
      const member = join(current, name);
      const observed = lstatSync(member);
      const relativePath = relative(destination, member).split(sep).join('/');
      if (observed.isDirectory()) {
        visit(member);
      } else if (observed.isFile() && observed.nlink === 1) {
        files.push({ type: 'file', path: member, relativePath, size: observed.size });
      } else if (observed.isSymbolicLink()) {
        const target = readlinkSync(member);
        const resolvedTarget = resolve(dirname(member), target);
        if (
          !/^[A-Za-z0-9_.@+/-]+$/u.test(target)
          || (resolvedTarget !== destination && !pathInside(destination, resolvedTarget))
        ) {
          fail(
            'SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE',
            `${relativePath} extracted as an unsafe source symlink`,
          );
        }
        files.push({ type: 'symlink', relativePath, target, size: Buffer.byteLength(target) });
      } else {
        fail(
          'SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE',
          'source archive extracted a linked or special file',
        );
      }
    }
  };
  visit(destination);
  if (files.length < 1) {
    fail('SNAPBACK_HOSTED_RELEASE_SOURCE_INVALID', 'source archive has no files');
  }
  const tree = createHash('sha256').update('snapback:hosted-release-source-tree:v1\0');
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    if (file.type === 'file') {
      tree.update(`file\0${file.relativePath}\0${file.size}\0${fileFact(file.path).sha256}\n`);
    } else {
      tree.update(`symlink\0${file.relativePath}\0${file.target}\n`);
    }
  }
  if (totalBytes > MAX_ARCHIVE_BYTES) {
    fail('SNAPBACK_HOSTED_RELEASE_SOURCE_INVALID', 'source archive is too large');
  }
  return {
    root: destination,
    fact: {
      ...fileFact(path),
      fileCount: files.length,
      treeSha256: tree.digest('hex'),
    },
  };
}

function walkFiles(root, current = root, output = []) {
  for (const name of readdirSync(current).sort()) {
    const path = join(current, name);
    const observed = lstatSync(path);
    if (observed.isSymbolicLink()) {
      fail('SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE', 'extracted archive contains a symlink');
    }
    if (observed.isDirectory()) {
      walkFiles(root, path, output);
    } else if (observed.isFile() && observed.nlink === 1) {
      output.push({
        path,
        relativePath: relative(root, path).split(sep).join('/'),
        size: observed.size,
      });
    } else {
      fail('SNAPBACK_HOSTED_RELEASE_ARCHIVE_UNSAFE', 'extracted archive contains a special or linked file');
    }
  }
  return output;
}

function scanFile(path, relativePath) {
  if (FORBIDDEN_ARCHIVE_NAMES.some((pattern) => pattern.test(relativePath))) {
    fail('SNAPBACK_HOSTED_RELEASE_FORBIDDEN_FILE', `${relativePath} is forbidden`);
  }
  const bytes = readFileSync(path);
  if (bytes.includes(0)) return;
  const text = bytes.toString('utf8');
  if (SECRET_CONTENT.some((pattern) => pattern.test(text))) {
    fail('SNAPBACK_HOSTED_RELEASE_SECRET_DETECTED', `${relativePath} contains secret-shaped text`);
  }
}

function treeFact(root, { scan = false } = {}) {
  const files = walkFiles(root);
  let totalBytes = 0;
  const tree = createHash('sha256').update('snapback:hosted-release-tree:v1\0');
  for (const file of files) {
    if (scan) scanFile(file.path, file.relativePath);
    const digest = fileFact(file.path).sha256;
    totalBytes += file.size;
    tree.update(`${file.relativePath}\0${file.size}\0${digest}\n`);
  }
  if (files.length < 1 || totalBytes > MAX_ARCHIVE_BYTES) {
    fail('SNAPBACK_HOSTED_RELEASE_ARCHIVE_INVALID', 'extracted archive has an invalid closure size');
  }
  return {
    fileCount: files.length,
    treeSha256: tree.digest('hex'),
  };
}

function extractArchive(path, temporaryRoot, label, { scan = false } = {}) {
  archiveNames(path);
  const destination = join(temporaryRoot, label);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  run('tar', ['-xzf', path, '-C', destination, '--no-same-owner', '--no-same-permissions']);
  const tree = treeFact(destination, { scan });
  return {
    root: destination,
    fact: { ...fileFact(path), ...tree },
  };
}

function elfMachine(path, label) {
  const header = readFileSync(path).subarray(0, 20);
  if (
    header.byteLength !== 20
    || header[0] !== 0x7f
    || header.toString('ascii', 1, 4) !== 'ELF'
    || ![1, 2].includes(header[4])
    || ![1, 2].includes(header[5])
  ) {
    fail('SNAPBACK_HOSTED_RELEASE_PLATFORM_MISMATCH', `${label} is not an ELF executable`);
  }
  return header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
}

function proveDynamicClosure(binary, hermesLibrary, runtimeLibraryRoot, expectedMachine) {
  const staged = new Set();
  for (const file of walkFiles(runtimeLibraryRoot)) {
    if (file.relativePath.includes('/') || !/^lib[A-Za-z0-9+_.-]+\.so(?:\.[0-9]+)*$/u.test(file.relativePath)) {
      fail(
        'SNAPBACK_HOSTED_RELEASE_RUNTIME_CLOSURE_INVALID',
        'runtime libraries must be a flat set of SONAME-named shared objects',
      );
    }
    if (file.relativePath === 'libhermesvm.so'
        || ['libc.so.6', 'libm.so.6', 'libresolv.so.2'].includes(file.relativePath)
        || file.relativePath.startsWith('ld-linux')) {
      fail(
        'SNAPBACK_HOSTED_RELEASE_RUNTIME_CLOSURE_INVALID',
        `${file.relativePath} must come from the digest-pinned Ubuntu base`,
      );
    }
    if (elfMachine(file.path, file.relativePath) !== expectedMachine) {
      fail(
        'SNAPBACK_HOSTED_RELEASE_PLATFORM_MISMATCH',
        `${file.relativePath} has the wrong architecture`,
      );
    }
    staged.add(file.relativePath);
  }
  const environment = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LD_LIBRARY_PATH: `${dirname(hermesLibrary)}:${runtimeLibraryRoot}`,
  };
  const output = run('ldd', [binary], { environment });
  if (output.includes('not found')) {
    fail('SNAPBACK_HOSTED_RELEASE_RUNTIME_CLOSURE_INCOMPLETE', 'ldd found a missing library');
  }
  const requiredStaged = new Set();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*(\S+)\s+=>\s+(\S+)\s+\(/u.exec(line);
    if (!match) continue;
    const [, soname, resolvedPath] = match;
    if (soname === 'libhermesvm.so') {
      if (realpathSync(resolvedPath) !== realpathSync(hermesLibrary)) {
        fail('SNAPBACK_HOSTED_RELEASE_RUNTIME_CLOSURE_INVALID', 'ldd did not select staged Hermes');
      }
      continue;
    }
    if (['libc.so.6', 'libm.so.6', 'libresolv.so.2'].includes(soname)) continue;
    if (!pathInside(realpathSync(runtimeLibraryRoot), realpathSync(resolvedPath))) {
      fail(
        'SNAPBACK_HOSTED_RELEASE_RUNTIME_CLOSURE_INCOMPLETE',
        `${soname} resolved outside the explicit runtime library closure`,
      );
    }
    requiredStaged.add(soname);
  }
  if (canonicalJson([...staged].sort()) !== canonicalJson([...requiredStaged].sort())) {
    fail(
      'SNAPBACK_HOSTED_RELEASE_RUNTIME_CLOSURE_INVALID',
      'runtime library tarball has missing or unreferenced shared objects',
    );
  }
  return { output, environment };
}

function parseJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('SNAPBACK_HOSTED_RELEASE_ARTIFACT_INVALID', `${label} is not JSON`);
  }
}

function copyDirectoryContents(source, destination) {
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  for (const name of readdirSync(source)) {
    cpSync(join(source, name), join(destination, name), {
      recursive: true,
      dereference: false,
      preserveTimestamps: false,
    });
  }
}

export function expectedHostedSupportSha256(browserArtifactSha256) {
  if (!SHA256.test(browserArtifactSha256)) {
    fail(
      'SNAPBACK_HOSTED_RELEASE_APPLICATION_INVALID',
      'browser artifact identity is not lowercase SHA-256',
    );
  }
  const bucket = (burst) => ({
    intervalMs: 1_000,
    burst,
    maximumDenialDebtAttempts: 64,
  });
  const support = {
    hostedAuth: {
      externalTls: 'enforced',
      effectiveSource: 'trusted',
      authenticationThrottle: 'sharedEnforced',
      sessionInvalidation: 'globallyFenced',
      clientCredentialPosture: 'senderConstrainedV2',
    },
    authenticationThrottleConfig: {
      retentionMs: 600_000,
      maximumKeyCount: 100_000,
      global: bucket(2_000),
      source: bucket(600),
      subject: bucket(300),
      sourceSubject: bucket(200),
      family: bucket(300),
    },
    operatorSurface: 'disabled',
    browserDirectBearerSeam: 'excluded',
    browserArtifactSha256,
  };
  return createHash('sha256')
    .update('snapback-hosted-auth-support-v1\0')
    .update(canonicalJson(support))
    .digest('hex');
}

function validateApplication(root, deploymentId, browserArtifactSha256) {
  for (const path of REQUIRED_APPLICATION_PATHS) {
    const absolute = join(root, ...path.split('/'));
    if (!existsSync(absolute) || !lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink()) {
      fail('SNAPBACK_HOSTED_RELEASE_APPLICATION_INCOMPLETE', `${path} is required`);
    }
  }
  const hostedEdge = parseJsonFile(join(root, 'etc', 'hosted-edge.json'), 'hosted-edge.json');
  const hostedKeys = [
    'formatVersion',
    'deploymentId',
    'publicOrigin',
    'firstContactTransport',
    'admissionPublicKey',
    'supportSha256',
  ];
  if (
    canonicalJson(Object.keys(hostedEdge).sort()) !== canonicalJson(hostedKeys.sort())
    || hostedEdge.formatVersion !== 1
    || hostedEdge.deploymentId !== deploymentId
    || hostedEdge.publicOrigin !== 'https://snapback-drill.fly.dev'
    || hostedEdge.firstContactTransport !== 'hstsPreloadedSuffix'
    || hostedEdge.admissionPublicKey !== 'fsoDTQBUILXkSYZp93vKG2-kYIlLGkBTrK67_5lvzXk'
    || hostedEdge.supportSha256 !== expectedHostedSupportSha256(browserArtifactSha256)
  ) {
    fail(
      'SNAPBACK_HOSTED_RELEASE_APPLICATION_INVALID',
      'hosted-edge config is not exact or bound to the sealed public served tree',
    );
  }
  const startup = parseJsonFile(
    join(root, 'etc', 'startup-artifacts.json'),
    'startup-artifacts.json',
  );
  if (
    canonicalJson(Object.keys(startup).sort())
      !== canonicalJson(['formatVersion', 'functions', 'schema'].sort())
    || startup.formatVersion !== 1
  ) {
    fail('SNAPBACK_HOSTED_RELEASE_APPLICATION_INVALID', 'startup artifacts carrier is not closed');
  }
  const schema = parseJsonFile(
    join(root, 'generated', 'schema.manifest.json'),
    'schema.manifest.json',
  );
  const functions = parseJsonFile(
    join(root, 'generated', 'functions.manifest.json'),
    'functions.manifest.json',
  );
  if (canonicalJson(startup.schema) !== canonicalJson(schema)
      || canonicalJson(startup.functions) !== canonicalJson(functions)) {
    fail(
      'SNAPBACK_HOSTED_RELEASE_APPLICATION_INVALID',
      'startup artifacts do not embed the staged generated manifests',
    );
  }
}

function validateSupplyChain(sbomPath, licensePath, sourceArchiveFact) {
  const sbom = parseJsonFile(sbomPath, 'SBOM');
  if (
    typeof sbom.spdxVersion !== 'string'
    || !sbom.spdxVersion.startsWith('SPDX-')
    || sbom.SPDXID !== 'SPDXRef-DOCUMENT'
    || sbom.documentNamespace !== `https://snapback.dev/spdx/${sourceArchiveFact.sha256}`
    || !Array.isArray(sbom.packages)
    || sbom.packages.length < 1
    || sbom.packages.some((entry) => (
      typeof entry?.name !== 'string'
      || entry.name.length < 1
      || typeof entry?.SPDXID !== 'string'
      || !/^SPDXRef-Package-[1-9][0-9]*$/u.test(entry.SPDXID)
    ))
    || new Set(sbom.packages.map((entry) => entry.SPDXID)).size !== sbom.packages.length
  ) {
    fail('SNAPBACK_HOSTED_RELEASE_SBOM_INVALID', 'SBOM must be a nonempty SPDX JSON document');
  }
  const licenses = parseJsonFile(licensePath, 'license inventory');
  if (
    canonicalJson(Object.keys(licenses ?? {}).sort())
      !== canonicalJson(['schemaVersion', 'sourceTarballSha256', 'licenses'].sort())
    || licenses?.schemaVersion !== 'snapback.hosted-license-inventory.v1'
    || licenses.sourceTarballSha256 !== sourceArchiveFact.sha256
    || !Array.isArray(licenses.licenses)
    || licenses.licenses.length < 1
    || licenses.licenses.some((entry) => (
      canonicalJson(Object.keys(entry ?? {}).sort())
        !== canonicalJson(['name', 'version', 'declared', 'source'].sort())
      || ['name', 'version', 'declared', 'source'].some(
        (key) => typeof entry[key] !== 'string' || entry[key].length < 1,
      )
    ))
    || new Set(licenses.licenses.map(
      (entry) => `${entry.name}\0${entry.version}\0${entry.source}`,
    )).size !== licenses.licenses.length
    || canonicalJson(sbom.packages.map((entry) => entry.name).sort())
      !== canonicalJson(licenses.licenses.map((entry) => entry.name).sort())
  ) {
    fail(
      'SNAPBACK_HOSTED_RELEASE_LICENSE_INVENTORY_INVALID',
      'license inventory must be closed and nonempty',
    );
  }
  scanFile(sbomPath, 'sbom.spdx.json');
  scanFile(licensePath, 'licenses.json');
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const stagingRoot = realpathSync(args['staging-root']);
  if (!lstatSync(stagingRoot).isDirectory() || lstatSync(stagingRoot).isSymbolicLink()) {
    fail('SNAPBACK_HOSTED_RELEASE_STAGING_UNSAFE', 'staging root must be a nonsymlink directory');
  }

  const inputs = {};
  for (const name of ARTIFACT_ARGUMENTS) {
    inputs[name] = regularExplicitPath(args[name], name);
    if (!pathInside(stagingRoot, inputs[name])) {
      fail('SNAPBACK_HOSTED_RELEASE_STAGING_ESCAPE', `${name} is outside the sealed staging root`);
    }
  }
  for (const name of RECIPE_ARGUMENTS) {
    inputs[name] = regularExplicitPath(args[name], name);
    scanFile(inputs[name], `configuration/${name}`);
  }

  if (!['linux/amd64', 'linux/arm64'].includes(args.platform)) {
    fail('SNAPBACK_HOSTED_RELEASE_PLATFORM_MISMATCH', 'platform must be linux/amd64 or linux/arm64');
  }
  const architecture = args.platform.split('/')[1];
  const expectedMachine = architecture === 'amd64' ? 62 : 183;
  if (!/^[0-9a-f]{40,64}$/u.test(args['source-revision'])) {
    fail('SNAPBACK_HOSTED_RELEASE_SOURCE_INVALID', 'source revision is not a full Git hash');
  }
  if (!['true', 'false'].includes(args['source-dirty'])) {
    fail('SNAPBACK_HOSTED_RELEASE_SOURCE_INVALID', 'source-dirty must be true or false');
  }
  const dirty = args['source-dirty'] === 'true';
  if ((dirty && !SHA256.test(args['dirty-paths-sha256']))
      || (!dirty && args['dirty-paths-sha256'] !== 'none')) {
    fail(
      'SNAPBACK_HOSTED_RELEASE_SOURCE_INVALID',
      'dirty source requires its path-set digest; clean source requires "none"',
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(args['image-tag'])) {
    fail('SNAPBACK_HOSTED_RELEASE_IMAGE_INVALID', 'image tag is not portable');
  }

  const output = resolve(args['output-dir']);
  if (existsSync(output)) {
    fail('SNAPBACK_HOSTED_RELEASE_OUTPUT_EXISTS', 'output directory already exists');
  }
  const scratch = mkdtempSync(join(dirname(output), '.snapback-hosted-pack-'));
  const extraction = join(scratch, 'extract');
  const context = join(scratch, 'context');
  mkdirSync(extraction, { recursive: true, mode: 0o700 });
  mkdirSync(context, { recursive: true, mode: 0o700 });

  try {
    const extractedSource = sourceArchive(inputs['source-tarball'], extraction);
    const packageArchive = extractArchive(
      inputs['package-tarball'],
      extraction,
      'package',
      { scan: true },
    );
    const hermesArchive = extractArchive(
      inputs['hermes-tarball'],
      extraction,
      'hermes',
    );
    const runtimeLibrariesArchive = extractArchive(
      inputs['runtime-libraries-tarball'],
      extraction,
      'runtime-libraries',
    );
    const applicationArchive = extractArchive(
      inputs['application-tarball'],
      extraction,
      'application',
      { scan: true },
    );
    const publicArchive = extractArchive(
      inputs['public-assets-tarball'],
      extraction,
      'public',
      { scan: true },
    );
    validateApplication(
      applicationArchive.root,
      args['deployment-id'],
      publicArchive.fact.treeSha256,
    );
    validateSupplyChain(inputs.sbom, inputs.licenses, extractedSource.fact);

    const hermesLibrary = join(hermesArchive.root, 'lib', 'libhermesvm.so');
    const hermesCompiler = join(hermesArchive.root, 'bin', 'hermesc');
    const runtimeLibraryRoot = join(runtimeLibrariesArchive.root, 'lib');
    if (!existsSync(runtimeLibraryRoot) || !lstatSync(runtimeLibraryRoot).isDirectory()) {
      fail('SNAPBACK_HOSTED_RELEASE_RUNTIME_CLOSURE_INCOMPLETE', 'runtime library tarball needs lib/');
    }
    for (const [path, label] of [
      [hermesLibrary, 'Hermes library'],
      [hermesCompiler, 'hermesc'],
    ]) {
      if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
        fail('SNAPBACK_HOSTED_RELEASE_HERMES_INCOMPLETE', `${label} is missing`);
      }
      if (elfMachine(path, label) !== expectedMachine) {
        fail('SNAPBACK_HOSTED_RELEASE_PLATFORM_MISMATCH', `${label} has the wrong architecture`);
      }
    }
    if (elfMachine(inputs['snapback-binary'], 'Snapback binary') !== expectedMachine) {
      fail('SNAPBACK_HOSTED_RELEASE_PLATFORM_MISMATCH', 'Snapback binary has the wrong architecture');
    }

    const nmOutput = run('nm', ['-D', hermesLibrary]);
    if (!/(?:^|\s)ex_hermes_vm_current_package_id(?:$|\s)/mu.test(nmOutput)) {
      fail('SNAPBACK_HOSTED_RELEASE_HERMES_UNPATCHED', 'Hermes patched export is missing');
    }
    chmodSync(hermesCompiler, 0o500);
    const hermescOutput = run(hermesCompiler, ['--version']);
    const hbc = /HBC bytecode version:\s*([0-9]+)/u.exec(hermescOutput);
    if (!hbc) {
      fail('SNAPBACK_HOSTED_RELEASE_HERMESC_INVALID', 'hermesc did not report an HBC version');
    }
    if ((statSync(inputs['snapback-binary']).mode & 0o111) === 0) {
      fail('SNAPBACK_HOSTED_RELEASE_BINARY_INVALID', 'Snapback binary is not executable');
    }
    const dynamicLinkProbe = proveDynamicClosure(
      inputs['snapback-binary'],
      hermesLibrary,
      runtimeLibraryRoot,
      expectedMachine,
    );
    const buildIdentity = run(inputs['snapback-binary'], ['build-identity'], {
      environment: dynamicLinkProbe.environment,
    });
    const parsedIdentity = JSON.parse(buildIdentity);
    if (
      parsedIdentity?.schemaVersion !== 'snapback.binary-identity.v1'
      || parsedIdentity?.binary?.gitCommit !== args['source-revision']
      || parsedIdentity?.binary?.gitDirty !== dirty
      || typeof parsedIdentity?.binary?.crateVersion !== 'string'
      || typeof parsedIdentity?.binary?.buildProfile !== 'string'
    ) {
      fail('SNAPBACK_HOSTED_RELEASE_BINARY_INVALID', 'Snapback build identity is absent');
    }
    const stableBuildIdentity = {
      schemaVersion: parsedIdentity.schemaVersion,
      crateVersion: parsedIdentity.binary.crateVersion,
      gitCommit: parsedIdentity.binary.gitCommit,
      gitDirty: parsedIdentity.binary.gitDirty,
      buildProfile: parsedIdentity.binary.buildProfile,
    };

    const closure = join(context, 'closure');
    for (const directory of ['bin', 'lib', 'etc', 'generated', 'public', 'share']) {
      mkdirSync(join(closure, directory), { recursive: true, mode: 0o755 });
    }
    copyFileSync(inputs['snapback-binary'], join(closure, 'bin', 'snapback'));
    copyFileSync(hermesCompiler, join(closure, 'bin', 'hermesc'));
    copyFileSync(inputs.entrypoint, join(closure, 'bin', 'entrypoint.sh'));
    copyFileSync(inputs['admission-renewer'], join(closure, 'bin', 'admission-renewer.sh'));
    copyFileSync(hermesLibrary, join(closure, 'lib', 'libhermesvm.so'));
    copyDirectoryContents(runtimeLibraryRoot, join(closure, 'lib'));
    copyFileSync(inputs.caddyfile, join(closure, 'etc', 'Caddyfile'));
    copyFileSync(
      join(applicationArchive.root, 'etc', 'hosted-edge.json'),
      join(closure, 'etc', 'hosted-edge.json'),
    );
    copyFileSync(
      join(applicationArchive.root, 'etc', 'startup-artifacts.json'),
      join(closure, 'etc', 'startup-artifacts.json'),
    );
    copyDirectoryContents(join(applicationArchive.root, 'generated'), join(closure, 'generated'));
    copyDirectoryContents(publicArchive.root, join(closure, 'public'));
    copyFileSync(inputs.sbom, join(closure, 'share', 'sbom.spdx.json'));
    copyFileSync(inputs.licenses, join(closure, 'share', 'licenses.json'));
    copyFileSync(inputs.dockerfile, join(context, 'Dockerfile'));

    const manifest = createHostedReleaseManifest({
      source: {
        repository: args['source-repository'],
        revision: args['source-revision'],
        dirty,
        dirtyPathsSha256: dirty ? args['dirty-paths-sha256'] : null,
        tarball: extractedSource.fact,
      },
      package: { tarball: packageArchive.fact },
      platform: {
        selected: args.platform,
        os: 'linux',
        architecture,
        linuxAmd64: args.platform === 'linux/amd64',
        linuxArm64: args.platform === 'linux/arm64',
      },
      baseImages: [
        {
          purpose: 'operatingSystem',
          reference: OS_BASE.reference,
          indexSha256: OS_BASE.indexSha256,
          selectedManifestSha256: OS_BASE.platforms[args.platform],
        },
        {
          purpose: 'admissionRuntime',
          reference: RUNTIME_BASE.reference,
          indexSha256: RUNTIME_BASE.indexSha256,
          selectedManifestSha256: RUNTIME_BASE.platforms[args.platform],
        },
        {
          purpose: 'tlsTerminator',
          reference: CADDY_BASE.reference,
          indexSha256: CADDY_BASE.indexSha256,
          selectedManifestSha256: CADDY_BASE.platforms[args.platform],
        },
      ],
      hermes: {
        tarball: hermesArchive.fact,
        library: fileFact(hermesLibrary),
        compiler: fileFact(hermesCompiler),
        patchedExportProbe: {
          passed: true,
          symbol: 'ex_hermes_vm_current_package_id',
          tool: 'nm -D',
          outputSha256: createHash('sha256').update(nmOutput).digest('hex'),
        },
        hermescProbe: {
          passed: true,
          argument: '--version',
          hbcBytecodeVersion: Number(hbc[1]),
          outputSha256: createHash('sha256').update(hermescOutput).digest('hex'),
        },
      },
      snapback: {
        binary: fileFact(inputs['snapback-binary']),
        elfMachine: expectedMachine,
        runtimeLibraries: runtimeLibrariesArchive.fact,
        dynamicLinkProbe: {
          passed: true,
          tool: 'ldd',
          outputSha256: createHash('sha256').update(dynamicLinkProbe.output).digest('hex'),
          hostProvidedSonames: ['libc.so.6', 'libm.so.6', 'libresolv.so.2'],
        },
        sourceRevision: parsedIdentity.binary.gitCommit,
        sourceDirty: parsedIdentity.binary.gitDirty,
        buildIdentitySha256: createHash('sha256')
          .update(canonicalJson(stableBuildIdentity))
          .digest('hex'),
      },
      application: {
        tarball: applicationArchive.fact,
        requiredPaths: REQUIRED_APPLICATION_PATHS,
      },
      publicAssets: {
        tarball: publicArchive.fact,
        servedRoot: '/app/public',
      },
      supplyChain: {
        sbom: fileFact(inputs.sbom),
        licenses: fileFact(inputs.licenses),
      },
      configuration: {
        dockerfile: fileFact(inputs.dockerfile),
        entrypoint: fileFact(inputs.entrypoint),
        caddyfile: fileFact(inputs.caddyfile),
        admissionRenewer: fileFact(inputs['admission-renewer']),
      },
      admissionChannel: {
        protocol: 'mutual-tls-1.3',
        endpoint: 'https://snapback-hosted-supervisor-sjc.internal:8444/v1/target/admission',
        requestSchema: 'snapback.hosted-target-admission-request.v1',
        targetId: args['target-id'],
        deploymentId: args['deployment-id'],
        renewalMode: 'online',
        refreshIntervalMaximumMs: 30_000,
        authorityLifetimeMaximumMs: 60_000,
        projectionPath: '/data/control/admission.json',
        requiredSecretPaths: [
          '/run/secrets/supervisor-target-client-key.pem',
          '/run/secrets/supervisor-target-client-cert.pem',
          '/run/secrets/supervisor-server-ca.pem',
        ],
      },
      image: {
        repository: 'registry.fly.io/snapback-drill',
        tag: args['image-tag'],
        intendedReference: `registry.fly.io/snapback-drill:${args['image-tag']}`,
      },
    });
    const manifestBytes = `${canonicalJson(manifest)}\n`;
    writeFileSync(join(closure, 'share', 'release-manifest.json'), manifestBytes, {
      mode: 0o444,
      flag: 'wx',
    });
    chmodSync(join(closure, 'bin', 'snapback'), 0o555);
    chmodSync(join(closure, 'bin', 'hermesc'), 0o555);
    chmodSync(join(closure, 'bin', 'entrypoint.sh'), 0o555);
    chmodSync(join(closure, 'bin', 'admission-renewer.sh'), 0o555);
    renameSync(context, output);
    process.stdout.write(`${manifestBytes}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    const code = typeof error?.code === 'string'
      ? error.code
      : 'SNAPBACK_HOSTED_RELEASE_PACK_FAILED';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exit(1);
  }
}
