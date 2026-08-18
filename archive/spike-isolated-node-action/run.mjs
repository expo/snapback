import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { buildBundle } from './lib/bundle.mjs';
import { verifyInstalledClosure } from './lib/closure.mjs';
import { runPortableProfileControl } from './lib/portable-control.mjs';
import { refuseRegistryPackageBeforeInstall } from './lib/preinstall-scan.mjs';
import { validateGoldens } from './schemas-draft/validate-goldens.mjs';

const spikeRoot = dirname(fileURLToPath(import.meta.url));
const sdkProject = join(spikeRoot, 'sdk-project');
const npmCache = process.env.npm_config_cache ?? '/private/tmp/llp0249-npm-cache';

function registryOnlyNpmEnvironment() {
  const env = {
    ...process.env,
    npm_config_cache: npmCache,
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_userconfig: '/dev/null',
    npm_config_always_auth: 'false',
  };
  for (const key of Object.keys(env)) {
    if (/^(?:NPM_TOKEN|NODE_AUTH_TOKEN)$/iu.test(key)
      || /(?:_auth|_authToken|password)$/iu.test(key)) delete env[key];
  }
  return env;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? spikeRoot,
    env: options.env ?? registryOnlyNpmEnvironment(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    error.result = result;
    throw error;
  }
  return result;
}

const nativeAddonRefusal = await refuseRegistryPackageBeforeInstall('bcrypt', '6.0.0');
const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: sdkProject });
const closure = verifyInstalledClosure(sdkProject);
const bundle = await buildBundle();

const preloadPath = join(spikeRoot, 'preload.mjs');
const sourceMapProbeSource = readFileSync(join(spikeRoot, 'fixtures/vendor-action.mjs'), 'utf8');
const expectedSourceMapLine = sourceMapProbeSource.slice(0, sourceMapProbeSource.indexOf("throw new Error('ISOLATED_NODE_SOURCE_MAP_PROBE')")).split('\n').length;
const childStartedAt = performance.now();
const child = run(process.execPath, [
  '--permission',
  '--no-addons',
  '--enable-source-maps',
  `--allow-fs-read=${preloadPath}`,
  `--allow-fs-read=${bundle.outputPath}`,
  `--allow-fs-read=${bundle.mapPath}`,
  '--import', preloadPath,
  bundle.outputPath,
], { env: {} });
const processWallMs = performance.now() - childStartedAt;
const worker = JSON.parse(child.stdout.trim());
const sourceMapMatch = worker.sourceMapStack.match(/fixtures\/vendor-action\.mjs:(\d+):(\d+)/u);
const sourceMapFidelity = {
  expectedPath: 'fixtures/vendor-action.mjs',
  expectedLine: expectedSourceMapLine,
  observedLine: sourceMapMatch ? Number(sourceMapMatch[1]) : null,
  observedColumn: sourceMapMatch ? Number(sourceMapMatch[2]) : null,
  passed: Boolean(sourceMapMatch) && Number(sourceMapMatch[1]) === expectedSourceMapLine,
  stack: worker.sourceMapStack,
};
const portableProfile = await runPortableProfileControl();
const schemaGoldens = await validateGoldens();

const result = {
  schemaVersion: 'isolated-node-action-spike.result.v1',
  runAt: new Date().toISOString(),
  evidenceLabel: 'CALIBRATION ONLY — NOT A CAPABILITY CLAIM',
  nodeVersion: process.version,
  platform: `${process.platform}-${process.arch}`,
  npmVersion: run('npm', ['--version']).stdout.trim(),
  npmCache,
  vendorSdk: {
    package: '@octokit/auth-token',
    version: '6.0.0',
    installCommand: 'npm install --ignore-scripts --no-audit --no-fund',
    installEnvironment: 'registry.npmjs.org pinned; user npm config and credential variables excluded',
    installStdout: install.stdout.trim(),
    installStderr: install.stderr.trim(),
    closure,
    bundle,
    worker: worker.sdk,
  },
  nativeCrypto: {
    ...worker.nativeCrypto,
    embeddedEngineComparisonMs: { citedLower: 8000, citedUpper: 11000, source: 'LLP 0249#motivation; not re-measured' },
    speedupVsCitedRange: {
      lowerBound: 8000 / worker.nativeCrypto.wallMs,
      upperBound: 11000 / worker.nativeCrypto.wallMs,
    },
  },
  nativeAddonRefusal,
  portableProfile,
  workerIsolationCalibration: {
    nodeArguments: [
      '--permission', '--no-addons', '--enable-source-maps',
      '--allow-fs-read=<preload>', '--allow-fs-read=<bundle>', '--allow-fs-read=<source-map>',
      '--import <preload>', '<bundle>',
    ],
    processWallMs,
    coldStartMs: worker.coldStartMs,
    rssBytes: worker.rssBytes,
    absentSurfaces: worker.absentSurfaces,
    stderr: child.stderr.trim(),
    sourceMapFidelity,
    qualificationLimit: 'Node --permission plus module hooks is not OS isolation; same-UID and kernel/container adversarial qualification remain unimplemented.',
  },
  schemaGoldens,
};

const outIndex = process.argv.indexOf('--out');
if (outIndex >= 0) {
  const out = resolve(process.argv[outIndex + 1]);
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
