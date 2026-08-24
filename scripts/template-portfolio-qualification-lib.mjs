import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
  PUBLIC_NPM_REGISTRY,
  coldInstallStagedPackageClosure,
} from './snapback-package-cold-install-lib.mjs';

// @ref LLP 0196#program — both freshness halves enumerate the template
// registry from the installed CLI, then scaffold, generate, and statically
// accept each entry against either exact tarballs or the published closure.
const RECEIPT_SCHEMA_VERSION = 'snapback.template-portfolio-qualification.v1';
const SNAPBACK_PACKAGE_PATTERN = /^@expo\/snapback-/u;
const REQUIRED_TEMPLATE_SCRIPTS = Object.freeze([
  'generate',
  'prove',
  'test',
  'test:static',
  'carry:headless',
  'carry:self-check',
]);
const OBSERVATION_CARRIER_ORDER = Object.freeze([
  'carry:headless',
  'carry:web-browser',
  'carry:native-simulator',
]);
export function renderTemplateScriptGlossary(manifest, { compact = false } = {}) {
  const observationScripts = OBSERVATION_CARRIER_ORDER
    .filter((script) => typeof manifest.scripts?.[script] === 'string')
    .map((script) => `\`bun run ${script}\``)
    .join(', ');
  if (compact) {
    return [
      '<!-- script-glossary:begin -->',
      '## Scripts',
      '',
      '`prove`: only done-oracle; writes the authoritative aggregate `snapback verify`',
      'receipt (acceptance evidence, not formal proof). `npm test`: unwrapped',
      '`acceptance.mjs` debug path. `test:static`: no-server coherence.',
      `${observationScripts}: observations only after \`prove\`, never proof.`,
      '`carry:self-check`: wiring only.',
      '<!-- script-glossary:end -->',
    ].join('\n');
  }
  return [
    '<!-- script-glossary:begin -->',
    '## Script glossary',
    '',
    '`bun run prove`: ordinary completion and the only done-oracle—the authoritative',
    'aggregate `snapback verify` receipt (acceptance evidence, not formal proof).',
    '`npm test`: raw acceptance implementation that `prove` wraps (debugging).',
    '`bun run test:static`: no-server source/generated coherence.',
    `${observationScripts}: observation artifacts after accepting the \`prove\` receipt,`,
    'never proof authority. `bun run carry:self-check` checks carrier wiring only.',
    'Migration: `test:live` was removed; use `npm test` for the same raw acceptance command.',
    '<!-- script-glossary:end -->',
  ].join('\n');
}

function assertStartPacketScriptGlossary({ name, manifest, instructions }) {
  // @ref LLP 0196#program — first-read packets may use the budgeted `carry:*`
  // spelling; validate its authority and manifest coverage instead of freezing
  // the packet's prose byte-for-byte (LLP 0259's steering budget).
  const match = instructions.match(
    /<!-- script-glossary:begin -->([\s\S]*?)<!-- script-glossary:end -->/u,
  );
  if (!match) throw new Error(`${name} start packet omits its script glossary`);
  const glossary = match[1];
  for (const required of [
    'only done-oracle',
    'snapback verify',
    'npm test',
    'test:static',
    'carry:self-check',
  ]) {
    if (!glossary.includes(required)) {
      throw new Error(`${name} start packet script glossary omits ${required}`);
    }
  }
  if (!glossary.includes('observation') || !glossary.includes('prove')) {
    throw new Error(`${name} start packet script glossary changes carrier authority`);
  }
  const documentsAllCarriers = glossary.includes('`carry:*`');
  for (const script of OBSERVATION_CARRIER_ORDER) {
    const present = typeof manifest.scripts?.[script] === 'string';
    if (present && !(documentsAllCarriers || glossary.includes(script))) {
      throw new Error(`${name} start packet script glossary omits ${script}`);
    }
  }
  const documentedCarriers = new Set(
    glossary.match(/carry:(?:headless|web-browser|native-simulator|self-check)/gu) ?? [],
  );
  for (const script of documentedCarriers) {
    if (typeof manifest.scripts?.[script] !== 'string') {
      throw new Error(`${name} start packet documents missing script ${script}`);
    }
  }
}

export function assertTemplateScriptSurface({ name, manifest, readme, instructions }) {
  for (const script of REQUIRED_TEMPLATE_SCRIPTS) {
    if (typeof manifest.scripts?.[script] !== 'string') {
      throw new Error(`${name} omits ${script}`);
    }
  }
  if (Object.hasOwn(manifest.scripts, 'test:live')) {
    throw new Error(`${name} retains removed script test:live`);
  }
  const expectedCommands = new Map([
    ['test', 'node acceptance.mjs'],
    ['test:static', 'node acceptance.static.mjs'],
    ['carry:headless', 'node carrier.mjs headless'],
    ['carry:web-browser', 'node carrier.mjs web-browser'],
    ['carry:native-simulator', 'node carrier.mjs native-simulator'],
    ['carry:self-check', 'node carrier.mjs --self-check --json'],
  ]);
  if (!/^snapback verify snapback(?:\s|$)/u.test(manifest.scripts.prove)) {
    throw new Error(`${name} changes prove command class: ${manifest.scripts.prove}`);
  }
  for (const [script, expected] of expectedCommands) {
    const actual = manifest.scripts[script];
    if (actual !== undefined && actual !== expected) {
      throw new Error(`${name} changes ${script} command class: ${actual}`);
    }
  }

  if (!readme.includes(renderTemplateScriptGlossary(manifest))) {
    throw new Error(`${name} README script glossary disagrees with package.json`);
  }
  assertStartPacketScriptGlossary({ name, manifest, instructions });
  return Object.freeze({
    commands: Object.freeze({
      ordinaryCompletion: 'bun run prove',
      staticChecking: 'bun run test:static',
      rawAcceptanceDebugging: 'npm test',
      browserObservation: typeof manifest.scripts['carry:web-browser'] === 'string'
        ? 'bun run carry:web-browser'
        : null,
      simulatorObservation: typeof manifest.scripts['carry:native-simulator'] === 'string'
        ? 'bun run carry:native-simulator'
        : null,
    }),
    carriers: OBSERVATION_CARRIER_ORDER
      .filter((script) => typeof manifest.scripts[script] === 'string')
      .map((script) => script.slice('carry:'.length)),
  });
}

function run(command, args, {
  cwd,
  env = process.env,
  timeout = 600_000,
  capture = false,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout || result.error?.message) : result.error?.message;
    throw new Error(
      `${command} ${args.join(' ')} failed${detail ? `: ${String(detail).trim()}` : ''}`,
    );
  }
  return capture ? result.stdout : '';
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function inspectTarballs(stagedDir) {
  const byName = new Map();
  for (const filename of readdirSync(stagedDir).filter((name) => name.endsWith('.tgz')).sort()) {
    const path = join(stagedDir, filename);
    const manifest = JSON.parse(run(
      'tar',
      ['-xzOf', path, 'package/package.json'],
      { capture: true, timeout: 30_000 },
    ));
    if (typeof manifest.name !== 'string' || byName.has(manifest.name)) {
      throw new Error(`staged template qualification found invalid package identity in ${filename}`);
    }
    byName.set(manifest.name, Object.freeze({
      name: manifest.name,
      version: manifest.version,
      path,
      sha256: sha256(path),
    }));
  }
  if (!byName.has('@expo/snapback-cli')) {
    throw new Error('template qualification closure omits @expo/snapback-cli');
  }
  return byName;
}

export function discoverRegisteredTemplates(cliPackageRoot) {
  const root = realpathSync(resolve(cliPackageRoot));
  const templatesRoot = join(root, 'templates');
  const metadata = lstatSync(templatesRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`CLI template registry is not a materialized directory: ${templatesRoot}`);
  }
  const names = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0 || new Set(names).size !== names.length) {
    throw new Error('CLI template registry is empty or duplicated');
  }
  for (const name of names) {
    if (!existsSync(join(templatesRoot, name, 'package.json'))) {
      throw new Error(`registered CLI template ${name} omits package.json`);
    }
  }
  return Object.freeze(names);
}

function installBootstrap({ mode, stagedDir, registry, version, temporary }) {
  const bootstrap = join(temporary, 'bootstrap');
  mkdirSync(bootstrap);
  writeFileSync(join(bootstrap, 'package.json'), `${JSON.stringify({
    name: 'snapback-template-portfolio-bootstrap',
    private: true,
    version: '1.0.0',
  }, null, 2)}\n`);
  if (mode === 'staged') {
    return coldInstallStagedPackageClosure({
      stagedDir,
      appDir: bootstrap,
      environment: {
        ...process.env,
        CI: '1',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_cache: join(temporary, 'npm-cache-bootstrap'),
      },
      timeoutMs: 600_000,
    }).then((installed) => ({ bootstrap, installed }));
  }
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--registry', registry,
    `@expo/snapback-cli@${version}`,
  ], {
    cwd: bootstrap,
    env: {
      ...process.env,
      CI: '1',
      npm_config_cache: join(temporary, 'npm-cache-bootstrap'),
    },
  });
  return Promise.resolve({ bootstrap, installed: null });
}

function rewriteStagedDependencies(manifest, tarballs) {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      const staged = tarballs.get(name);
      if (staged) manifest[section][name] = `file:${staged.path}`;
    }
  }
  return manifest;
}

function collectInstalledSnapbackPackages(projectRoot) {
  const scope = join(projectRoot, 'node_modules', '@expo');
  if (!existsSync(scope)) return [];
  return readdirSync(scope)
    .filter((name) => name.startsWith('snapback-'))
    .sort()
    .map((name) => {
      const path = join(scope, name);
      const metadata = lstatSync(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`template qualification refuses non-materialized package @expo/${name}`);
      }
      const manifest = readJson(join(path, 'package.json'));
      if (!SNAPBACK_PACKAGE_PATTERN.test(manifest.name ?? '')
          || typeof manifest.version !== 'string') {
        throw new Error(`template qualification found invalid installed package @expo/${name}`);
      }
      return Object.freeze({ name: manifest.name, version: manifest.version });
    });
}

function qualifyOneTemplate({
  name,
  cli,
  mode,
  registry,
  tarballs,
  temporary,
}) {
  const project = join(temporary, 'templates', name);
  mkdirSync(dirname(project), { recursive: true });
  run(cli, ['new', project, '--template', name, '--json'], {
    cwd: temporary,
    env: { ...process.env, CI: '1' },
    timeout: 60_000,
  });
  const manifestPath = join(project, 'package.json');
  const manifest = readJson(manifestPath);
  if (mode === 'staged') {
    rewriteStagedDependencies(manifest, tarballs);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(join(project, '.npmrc'), `registry=${registry}\n`);
  const installArguments = [
    'install',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--registry', registry,
    ...(mode === 'staged' ? [...tarballs.values()].map(({ path }) => path) : []),
  ];
  run('npm', installArguments, {
    cwd: project,
    env: {
      ...process.env,
      CI: '1',
      npm_config_cache: join(temporary, `npm-cache-${name}`),
    },
  });
  const scaffoldCli = join(project, 'node_modules', '.bin', 'snapback');
  run(scaffoldCli, ['generate', 'snapback', '--json'], {
    cwd: project,
    env: {
      ...process.env,
      CI: '1',
      ...(mode === 'staged' ? { npm_config_offline: 'true' } : {}),
    },
    timeout: 180_000,
  });
  run('npm', ['run', 'test:static'], {
    cwd: project,
    env: { ...process.env, CI: '1' },
    timeout: 180_000,
  });
  return Object.freeze({
    id: name,
    status: 'passed',
    scaffolded: true,
    generated: true,
    staticAcceptance: true,
    installedPackages: collectInstalledSnapbackPackages(project),
  });
}

export async function qualifyTemplatePortfolio({
  mode,
  stagedDir = null,
  registry = PUBLIC_NPM_REGISTRY,
  version = 'latest',
  receiptPath,
  keep = false,
}) {
  if (!['staged', 'registry'].includes(mode)) throw new TypeError('mode must be staged or registry');
  const resolvedRegistry = new URL(registry);
  if (!['http:', 'https:'].includes(resolvedRegistry.protocol)) {
    throw new TypeError('registry must be HTTP(S)');
  }
  if (resolvedRegistry.username || resolvedRegistry.password) {
    throw new TypeError('registry URL may not embed credentials');
  }
  if (mode === 'registry'
      && (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(version))) {
    throw new TypeError('registry version must be an exact version or dist-tag');
  }
  const normalizedRegistry = resolvedRegistry.href.replace(/\/$/u, '');
  const resolvedStage = mode === 'staged' ? resolve(stagedDir) : null;
  const temporary = mkdtempSync(join(tmpdir(), `snapback-template-${mode}-`));
  let tarballs = null;
  const templates = [];
  const failures = [];
  let registered = [];
  let packageClosure = [];
  let cliVersion = null;
  try {
    if (mode === 'staged') tarballs = inspectTarballs(resolvedStage);
    const { bootstrap, installed } = await installBootstrap({
      mode,
      stagedDir: resolvedStage,
      registry: normalizedRegistry,
      version,
      temporary,
    });
    const cliPackageRoot = join(bootstrap, 'node_modules', '@expo', 'snapback-cli');
    const cliManifest = readJson(join(cliPackageRoot, 'package.json'));
    cliVersion = cliManifest.version;
    packageClosure = mode === 'staged'
      ? installed.packageClosure
      : collectInstalledSnapbackPackages(bootstrap);
    registered = [...discoverRegisteredTemplates(cliPackageRoot)];
    const cli = join(bootstrap, 'node_modules', '.bin', 'snapback');
    for (const name of registered) {
      try {
        templates.push(qualifyOneTemplate({
          name,
          cli,
          mode,
          registry: normalizedRegistry,
          tarballs,
          temporary,
        }));
      } catch (error) {
        const failure = Object.freeze({
          id: name,
          status: 'failed',
          message: error?.message ?? String(error),
        });
        templates.push(failure);
        failures.push(failure);
      }
    }
  } catch (error) {
    failures.push(Object.freeze({
      id: 'portfolio-bootstrap',
      status: 'failed',
      message: error?.message ?? String(error),
    }));
  }
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    observedAt: new Date().toISOString(),
    mode,
    status: failures.length === 0 ? 'passed' : 'failed',
    blocking: mode === 'staged',
    registry: normalizedRegistry,
    requestedVersion: mode === 'registry' ? version : null,
    cliVersion,
    packageClosure,
    registeredTemplates: registered,
    expectedTemplateCount: registered.length,
    passedTemplateCount: templates.filter(({ status }) => status === 'passed').length,
    templates,
    failures,
    temporary: keep ? temporary : null,
  };
  mkdirSync(dirname(resolve(receiptPath)), { recursive: true });
  writeFileSync(resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
  if (!keep) rmSync(temporary, { recursive: true, force: true });
  return Object.freeze(receipt);
}

export function selfCheckTemplatePortfolio(sourceCliRoot) {
  const cliRoot = resolve(sourceCliRoot);
  const templates = discoverRegisteredTemplates(cliRoot);
  const sharedCarrier = readFileSync(join(cliRoot, 'carrier-kit.mjs'), 'utf8');
  for (const marker of [
    'import plistlib',
    'EXDevMenuIsOnboardingFinished',
    "'openurl'",
    'native-offline-relaunch.png',
  ]) {
    if (!sharedCarrier.includes(marker)) {
      throw new Error(`shared carrier kit omits executable technique ${marker}`);
    }
  }
  const records = templates.map((name) => {
    const root = join(cliRoot, 'templates', name);
    const manifest = readJson(join(root, 'package.json'));
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const instructions = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const carrier = readFileSync(join(root, 'carrier.mjs'), 'utf8');
    const scriptSurface = assertTemplateScriptSurface({ name, manifest, readme, instructions });
    const documentsAllCarriers = instructions.includes('`carry:*`');
    if (!(instructions.includes('carry:headless') || documentsAllCarriers)
        || !carrier.includes('snapback.template-carriers.v1')) {
      throw new Error(`${name} does not register its carrier kit for a cold agent`);
    }
    const carriers = ['headless'];
    for (const candidate of ['web-browser', 'native-simulator']) {
      const script = `carry:${candidate}`;
      if (typeof manifest.scripts[script] !== 'string') continue;
      if (!(instructions.includes(script) || documentsAllCarriers)
          || !carrier.includes(`'${candidate}'`)) {
        throw new Error(`${name} does not register its ${candidate} carrier for a cold agent`);
      }
      carriers.push(candidate);
    }
    if (carriers.join('\0') !== scriptSurface.carriers.join('\0')) {
      throw new Error(`${name} carrier registration disagrees with its script glossary`);
    }
    return Object.freeze({ id: name, carriers });
  });
  return Object.freeze({
    schemaVersion: 'snapback.template-portfolio-self-check.v1',
    ok: true,
    templates: records,
  });
}
