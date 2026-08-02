#!/usr/bin/env node

import assert from 'node:assert/strict';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { build, version as esbuildVersion } from 'esbuild';

// @ref LLP 0145#phase-a--establish-a-size-ratchet — freeze reproducible
// public-profile closures and module/package attribution before optimization.
// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
// committed baseline is CI-diffable, absolute at first run, and never loosened.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'client-bundle-metrology');
const PROFILE_PATH = join(FIXTURE_DIR, 'profiles.v1.json');
const BASELINE_PATH = join(FIXTURE_DIR, 'baseline.v1.json');
const CURRENT_PATH = join(FIXTURE_DIR, 'current.v1.json');
const PACKAGE_DIR = join(ROOT, 'packages');
const METRICS = ['minifiedBytes', 'gzipBytes', 'brotliBytes'];
const BEHAVIOR_COMMANDS = Object.freeze([
  ['node', ['packages/snapback-client/package.test.mjs']],
  ['node', ['packages/snapback-client/browser-closure.test.mjs']],
  ['node', ['packages/snapback-react/package.test.mjs']],
]);

function fail(message) {
  throw new Error(`SNAPBACK_CLIENT_BUNDLE_RATCHET_FAILED: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitText(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function baselineSourceProvenance() {
  const revision = gitText(['rev-parse', 'HEAD']);
  return {
    revision,
    packageTrees: Object.fromEntries(
      ['snapback-client', 'snapback-contract', 'snapback-react'].map((name) => [
        `packages/${name}`,
        gitText(['rev-parse', `${revision}:packages/${name}`]),
      ]),
    ),
  };
}

function validateBaselineSource(source) {
  assert.match(source?.revision ?? '', /^[0-9a-f]{40}$/u, 'baseline source revision');
  for (const [path, expected] of Object.entries(source?.packageTrees ?? {})) {
    assert.equal(
      gitText(['rev-parse', `${source.revision}:${path}`]),
      expected,
      `baseline package tree provenance for ${path}`,
    );
  }
}

function normalizePath(path) {
  const absolute = resolve(path);
  const rootPrefix = `${ROOT}${sep}`;
  if (absolute === ROOT) return '.';
  if (absolute.startsWith(rootPrefix)) return relative(ROOT, absolute).split(sep).join('/');
  return absolute.split(sep).join('/');
}

function packageForModule(path) {
  const normalized = normalizePath(path);
  const workspace = normalized.match(/^packages\/([^/]+)\//u);
  if (workspace) return `@expo/${workspace[1]}`;
  const dependency = normalized.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/u);
  if (dependency) return dependency[1];
  if (normalized.startsWith('tests/fixtures/client-bundle-metrology/')) return '<fixture>';
  return '<repository>';
}

function exportedTarget(manifest, exportKey) {
  const target = manifest.exports?.[exportKey];
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object') fail(`${manifest.name} does not export ${exportKey}`);
  return target.browser ?? target.import ?? target.default ?? fail(
    `${manifest.name} export ${exportKey} has no browser/import/default target`,
  );
}

const packageManifests = new Map();
for (const directory of ['snapback-client', 'snapback-contract', 'snapback-react']) {
  const manifestPath = join(PACKAGE_DIR, directory, 'package.json');
  const manifest = readJson(manifestPath);
  packageManifests.set(manifest.name, { directory: dirname(manifestPath), manifest });
}

function resolveWorkspaceSpecifier(specifier) {
  const match = specifier.match(/^(@expo\/[^/]+)(\/.*)?$/u);
  if (!match) return null;
  const record = packageManifests.get(match[1]);
  if (!record) return null;
  const exportKey = match[2] ? `.${match[2]}` : '.';
  const target = exportedTarget(record.manifest, exportKey);
  return resolve(record.directory, target);
}

const workspaceExports = {
  name: 'snapback-client-metrology-workspace-exports',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@expo\/(?:snapback-client|snapback-contract|snapback-react)(?:\/.*)?$/ }, (args) => {
      const path = resolveWorkspaceSpecifier(args.path);
      return path ? { path } : null;
    });
  },
};

function profileSource(profile) {
  if (profile.namespace === true) {
    return [
      `import * as measured from ${JSON.stringify(profile.package)};`,
      'export function __snapbackMetrologyBehavior() {',
      '  const keys = Object.keys(measured);',
      `  if (keys.length === 0) throw new Error(${JSON.stringify(`${profile.id}: empty public surface`)});`,
      '  return keys.length;',
      '}',
    ].join('\n');
  }
  const imports = profile.imports ?? [];
  const uses = profile.uses ?? [];
  return [
    `import { ${imports.join(', ')} } from ${JSON.stringify(profile.package)};`,
    'export function __snapbackMetrologyBehavior() {',
    `  const selected = [${uses.map((use) => `typeof ${use}`).join(', ')}];`,
    `  if (selected.some((value) => value !== 'function')) throw new Error(${JSON.stringify(`${profile.id}: selected surface is not callable`)});`,
    '  return selected.length;',
    '}',
  ].join('\n');
}

function publicSubpathProfiles(config) {
  const record = packageManifests.get(config.publicSubpaths.package);
  const excluded = new Set(config.publicSubpaths.exclude ?? []);
  return Object.keys(record.manifest.exports)
    .filter((key) => !excluded.has(key))
    .sort()
    .map((key) => ({
      id: `public-subpath-${key === '.' ? 'root' : key.slice(2).replaceAll('/', '-')}`,
      package: key === '.' ? record.manifest.name : `${record.manifest.name}/${key.slice(2)}`,
      namespace: true,
    }));
}

function normalizedMetafile(metafile, outputBytes) {
  const inputs = Object.fromEntries(
    Object.entries(metafile.inputs)
      .map(([path, input]) => [normalizePath(path), {
        bytes: input.bytes,
        imports: input.imports
          .map((entry) => ({
            path: entry.external ? entry.path : normalizePath(entry.path),
            kind: entry.kind,
            external: entry.external === true,
          }))
          .sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)),
      }])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const output = Object.values(metafile.outputs)[0];
  const entryPoint = output.entryPoint ? normalizePath(output.entryPoint) : '<stdin>';
  return {
    inputs,
    output: {
      bytes: outputBytes,
      entryPoint,
      imports: output.imports
        .map((entry) => ({ path: entry.path, kind: entry.kind, external: entry.external === true }))
        .sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)),
      inputs: Object.fromEntries(
        Object.entries(output.inputs)
          .map(([path, value]) => [normalizePath(path), { bytesInOutput: value.bytesInOutput }])
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
  };
}

function attributionFor(metafile) {
  const modules = Object.entries(metafile.output.inputs)
    .map(([path, value]) => ({
      module: path,
      package: packageForModule(path),
      bytes: value.bytesInOutput,
    }))
    .sort((left, right) => right.bytes - left.bytes || left.module.localeCompare(right.module));
  const packages = new Map();
  for (const module of modules) packages.set(module.package, (packages.get(module.package) ?? 0) + module.bytes);
  return {
    packages: [...packages]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name)),
    modules,
  };
}

async function executeBundle(profile, contents) {
  // Keep the transient module below the workspace node_modules directory so
  // intentionally external peer dependencies (React) resolve exactly as they
  // do for the package tests. The directory is removed in the same turn.
  const directory = mkdtempSync(join(ROOT, 'node_modules', '.snapback-client-metrology-'));
  const path = join(directory, `${profile.id}.mjs`);
  try {
    writeFileSync(path, contents);
    const module = await import(`${pathToFileURL(path).href}?sha256=${sha256(contents)}`);
    assert.equal(typeof module.__snapbackMetrologyBehavior, 'function', `${profile.id}: behavior export`);
    assert.ok(await module.__snapbackMetrologyBehavior(), `${profile.id}: behavior assertion`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function measureProfile(profile) {
  const source = profileSource(profile);
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: FIXTURE_DIR,
      sourcefile: `tests/fixtures/client-bundle-metrology/${profile.id}.fixture.mjs`,
      loader: 'js',
    },
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"production"' },
    external: profile.external ?? [],
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    minify: true,
    platform: 'browser',
    plugins: [workspaceExports],
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  assert.equal(result.outputFiles.length, 1, `${profile.id}: exactly one output`);
  const bytes = result.outputFiles[0].contents;
  await executeBundle(profile, bytes);
  const metafile = normalizedMetafile(result.metafile, bytes.byteLength);
  return {
    id: profile.id,
    package: profile.package,
    fixtureSha256: sha256(source),
    externals: [...(profile.external ?? [])].sort(),
    minifiedBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    outputSha256: sha256(bytes),
    attribution: attributionFor(metafile),
    metafile,
  };
}

function runBehaviorCommands() {
  for (const [command, args] of BEHAVIOR_COMMANDS) {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  }
}

async function measure() {
  const configBytes = readFileSync(PROFILE_PATH);
  const config = JSON.parse(configBytes);
  assert.equal(config.schemaVersion, 'snapback.client-bundle-metrology-profiles.v1');
  const profiles = [...config.profiles, ...publicSubpathProfiles(config)];
  const ids = profiles.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length, 'profile ids must be unique');
  const measured = [];
  for (const profile of profiles) measured.push(await measureProfile(profile));
  measured.sort((left, right) => left.id.localeCompare(right.id));
  runBehaviorCommands();
  return {
    schemaVersion: 'snapback.client-bundle-metrology.v1',
    authorities: [
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
    ],
    method: {
      runtime: {
        node: process.version,
        zlib: process.versions.zlib,
        brotli: process.versions.brotli,
      },
      bundler: `esbuild@${esbuildVersion}`,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      minify: true,
      treeShaking: true,
      legalComments: 'none',
      conditions: ['browser', 'import', 'default'],
      gzipLevel: 9,
      brotliQuality: 11,
      reactExternal: true,
      attribution: 'esbuild module-own bytesInOutput grouped by stable package boundary',
    },
    inputs: {
      profilesSha256: sha256(configBytes),
      lockfileSha256: sha256(readFileSync(join(ROOT, 'bun.lock'))),
    },
    behaviorCommands: BEHAVIOR_COMMANDS.map(([command, args]) => [command, ...args].join(' ')),
    profiles: measured,
  };
}

function compactBaseline(report) {
  return {
    schemaVersion: 'snapback.client-bundle-metrology-baseline.v1',
    source: baselineSourceProvenance(),
    authorities: report.authorities,
    frozenRule: 'first attributed run before optimization; valid ceilings never loosen',
    method: report.method,
    inputs: report.inputs,
    behaviorCommands: report.behaviorCommands,
    profiles: report.profiles.map((profile) => ({
      id: profile.id,
      package: profile.package,
      fixtureSha256: profile.fixtureSha256,
      externals: profile.externals,
      minifiedBytes: profile.minifiedBytes,
      gzipBytes: profile.gzipBytes,
      brotliBytes: profile.brotliBytes,
      outputSha256: profile.outputSha256,
      attribution: profile.attribution,
      metafile: profile.metafile,
    })),
  };
}

function compareToBaseline(report, baseline) {
  assert.equal(baseline.schemaVersion, 'snapback.client-bundle-metrology-baseline.v1');
  validateBaselineSource(baseline.source);
  assert.deepEqual(report.authorities, baseline.authorities, 'baseline authorities');
  assert.deepEqual(report.method, baseline.method, 'baseline measurement method');
  assert.deepEqual(report.inputs, baseline.inputs, 'baseline input digests');
  assert.deepEqual(report.behaviorCommands, baseline.behaviorCommands, 'baseline behavior commands');
  const currentById = new Map(report.profiles.map((profile) => [profile.id, profile]));
  const baselineById = new Map(baseline.profiles.map((profile) => [profile.id, profile]));
  const regressions = [];
  for (const [id, profile] of currentById) {
    const frozen = baselineById.get(id);
    if (!frozen) fail(`profile ${id} has no frozen baseline; add it prospectively before changing its closure`);
    for (const metric of METRICS) {
      if (profile[metric] > frozen[metric]) {
        regressions.push(`${id} ${metric} regressed from ${frozen[metric]} to ${profile[metric]} bytes`);
      }
    }
  }
  for (const id of baselineById.keys()) {
    if (!currentById.has(id)) fail(`frozen profile ${id} disappeared`);
  }
  if (regressions.length > 0) fail(regressions.join('; '));
}

function withSavings(report, baseline) {
  const baselineById = new Map(baseline.profiles.map((profile) => [profile.id, profile]));
  return {
    ...report,
    comparedTo: 'baseline.v1.json',
    profiles: report.profiles.map((profile) => {
      const frozen = baselineById.get(profile.id);
      return {
        ...profile,
        savings: Object.fromEntries(METRICS.map((metric) => [metric, frozen[metric] - profile[metric]])),
      };
    }),
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const mode = process.argv[2] ?? '--check';
if (!['--check', '--write-baseline', '--write-current'].includes(mode)) {
  console.error('usage: node scripts/client-bundle-metrology.mjs [--check|--write-baseline|--write-current]');
  process.exit(2);
}

const report = await measure();
if (mode === '--write-baseline') {
  if (existsSync(BASELINE_PATH)) fail('baseline.v1.json already exists; the first-run baseline is immutable');
  const baseline = compactBaseline(report);
  writeFileSync(BASELINE_PATH, stableJson(baseline));
  writeFileSync(CURRENT_PATH, stableJson(withSavings(report, baseline)));
  console.log(`client bundle baseline frozen: ${report.profiles.length} profiles`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) fail('baseline.v1.json is missing');
const baseline = readJson(BASELINE_PATH);
compareToBaseline(report, baseline);
const current = withSavings(report, baseline);
if (mode === '--write-current') {
  writeFileSync(CURRENT_PATH, stableJson(current));
  console.log(`client bundle current report updated: ${report.profiles.length} profiles`);
  process.exit(0);
}

if (!existsSync(CURRENT_PATH)) fail('current.v1.json is missing');
const committed = readFileSync(CURRENT_PATH, 'utf8');
const generated = stableJson(current);
if (committed !== generated) {
  fail('current.v1.json is stale; run node scripts/client-bundle-metrology.mjs --write-current');
}
console.log(`client bundle metrology passed: ${report.profiles.length} profiles, no frozen ceiling regressions`);
