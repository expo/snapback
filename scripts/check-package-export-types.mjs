#!/usr/bin/env node
// Published-subpath types-condition regression check (LLP 0127 move 5,
// slice 5-types).
//
// Three external bakeoff arms independently hit TS7016 importing
// `@expo/snapback-client/online` because the subpath shipped with no `types`
// condition; LLP 0122 verified the whole declarationless class on main. This
// gate makes the property structural for EVERY publishing package under
// packages/: each subpath export must resolve TypeScript declarations under
// the standard `types` condition, the declarations must compile as a real
// external consumer would compile them, and each declaration's value-export
// surface must match the module's actual runtime exports.
//
// @ref LLP 0115#cv-1-prove-the-public-external-packagestarter-loop — CV-1
//   named gap 4: every published-package subpath resolves with type
//   declarations (exit clause 4, extended to the full sweep).
//
// Phases:
//   1. Static export-map audit: every non-JSON subpath of every non-private
//      package carries a conditions object with `types` FIRST (TypeScript
//      honors condition order), the declaration and runtime files exist, and
//      the publish `files` allowlist covers both (a tarball that drops the
//      .d.mts re-opens the defect for installed consumers). A declaration-only
//      subpath is admitted when the TypeScript checker proves that it exports
//      no runtime values.
//   2. Consumer-fixture compile: a generated fixture importing every swept
//      subpath by its public specifier, compiled with the locked TypeScript
//      under `--module nodenext --strict` against a synthetic node_modules of
//      symlinks — the same resolution an installed consumer runs.
//   3. Runtime parity: each declaration's value exports must equal the
//      runtime module's `Object.keys` (a missing name is a broken consumer;
//      an invented one is a dishonest declaration).
//
// JSON subpaths (./package.json, *.schema.json) are exempt from `types`
// conditions: TypeScript types them from the JSON file itself under
// `resolveJsonModule`; the audit only requires the file to exist.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  declarationCompilerOptions,
  declarationValueExportNames,
  inspectDeclarationValueExports,
} from './package-export-types-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const LABEL = '[check-package-export-types]';

const failures = [];
const fail = (message) => failures.push(message);

// --- Locked TypeScript custody (same posture as scripts/check-generated-types:
// the exact root workspace dependency, never a registry or ambient fallback).
const rootManifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const expectedTsVersion = rootManifest.devDependencies?.typescript;
if (!/^\d+\.\d+\.\d+$/.test(expectedTsVersion ?? '')) {
  console.error(`${LABEL} error: root TypeScript must be an exact version, found ${expectedTsVersion}`);
  process.exit(1);
}
const tscBin = path.join(ROOT, 'node_modules', '.bin', 'tsc');
const tsManifestPath = path.join(ROOT, 'node_modules', 'typescript', 'package.json');
if (!existsSync(tscBin) || !existsSync(tsManifestPath)) {
  console.error(`${LABEL} error: locked TypeScript ${expectedTsVersion} is not installed; run \`bun install --frozen-lockfile\``);
  process.exit(1);
}
const installedTsVersion = JSON.parse(readFileSync(tsManifestPath, 'utf8')).version;
if (installedTsVersion !== expectedTsVersion) {
  console.error(`${LABEL} error: installed TypeScript ${installedTsVersion} does not match package.json ${expectedTsVersion}; run \`bun install --frozen-lockfile\``);
  process.exit(1);
}
const ts = (await import(pathToFileURL(path.join(ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js')).href)).default;

const isDeclarationFile = (target) => /\.d\.(ts|mts|cts)$/.test(target);
const isJsonTarget = (target) => target.endsWith('.json');
const RUNTIME_CONDITIONS = ['import', 'default', 'require'];

// npm `files` semantics reduced to what these manifests use: literal file
// names and directory prefixes (package.json/README are always packed).
const coveredByFiles = (filesList, relativeTarget) => {
  if (relativeTarget === 'package.json' || /^readme(\.|$)/i.test(relativeTarget)) return true;
  if (!Array.isArray(filesList)) return true; // no allowlist: everything packs
  return filesList.some((entry) => {
    const normalized = entry.replace(/^\.\//, '').replace(/\/$/, '');
    return normalized === relativeTarget || relativeTarget.startsWith(`${normalized}/`);
  });
};

const packages = [];
const authoredConsumerFixtures = [];
for (const dirName of readdirSync(PACKAGES_DIR).sort()) {
  const manifestPath = path.join(PACKAGES_DIR, dirName, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.private === true) {
    console.log(`${LABEL} skip ${manifest.name} (private: true — not published)`);
    continue;
  }
  const dir = path.join(PACKAGES_DIR, dirName);
  packages.push({ dirName, dir, manifest });
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.export-types.fixture.mts')) continue;
    authoredConsumerFixtures.push({ packageName: manifest.name, file: path.join(dir, name) });
  }
}

// --- Phase 1: static export-map audit.
const sweep = []; // { packageName, subpath, typesFile, runtimeFile }
for (const { dirName, dir, manifest } of packages) {
  const exportsMap = manifest.exports;
  if (!exportsMap || typeof exportsMap !== 'object') {
    fail(`${manifest.name}: package.json has no exports map`);
    continue;
  }
  for (const [subpath, target] of Object.entries(exportsMap)) {
    if (subpath.includes('*')) {
      fail(`${manifest.name} ${subpath}: wildcard subpaths are not auditable here; enumerate them explicitly`);
      continue;
    }
    if (typeof target === 'string') {
      if (isJsonTarget(target)) {
        if (!existsSync(path.join(dir, target))) {
          fail(`${manifest.name} ${subpath}: JSON target ${target} does not exist`);
        }
        continue;
      }
      fail(`${manifest.name} ${subpath}: no \`types\` condition (bare target ${target}) — external TypeScript consumers get TS7016`);
      continue;
    }
    if (!target || typeof target !== 'object') {
      fail(`${manifest.name} ${subpath}: unsupported exports target ${JSON.stringify(target)}`);
      continue;
    }
    const conditions = Object.keys(target);
    const typesTarget = target.types;
    const runtimeCondition = RUNTIME_CONDITIONS.find((name) => typeof target[name] === 'string');
    const runtimeTarget = runtimeCondition ? target[runtimeCondition] : null;
    if (typeof typesTarget !== 'string') {
      fail(`${manifest.name} ${subpath}: conditions object has no \`types\` condition (${conditions.join(', ')})`);
      continue;
    }
    if (conditions[0] !== 'types') {
      fail(`${manifest.name} ${subpath}: \`types\` must be the FIRST condition (TypeScript honors condition order); found order ${conditions.join(', ')}`);
    }
    const typesIsDeclaration = isDeclarationFile(typesTarget);
    if (!typesIsDeclaration) {
      fail(`${manifest.name} ${subpath}: types condition ${typesTarget} is not a declaration file`);
    }
    const typesFile = path.join(dir, typesTarget);
    if (!existsSync(typesFile)) {
      fail(`${manifest.name} ${subpath}: types file ${typesTarget} does not exist`);
      continue;
    }
    const relativeTypesTarget = typesTarget.replace(/^\.\//, '');
    const typesCovered = coveredByFiles(manifest.files, relativeTypesTarget);
    if (!typesCovered) {
      fail(`${manifest.name} ${subpath}: ${relativeTypesTarget} is missing from the publish \`files\` allowlist — the published tarball would drop it`);
    }
    if (runtimeTarget === null) {
      if (!typesIsDeclaration || !typesCovered) continue;
      let valueExports;
      try {
        valueExports = inspectDeclarationValueExports(ts, typesFile);
      } catch (error) {
        fail(`${manifest.name} ${subpath}: could not inspect the declaration exports: ${error.message}`);
        continue;
      }
      if (valueExports.length > 0) {
        fail(`${manifest.name} ${subpath}: types-only subpath declaration exports runtime values: ${valueExports.join(', ')}`);
        continue;
      }
      console.log(`${LABEL} admit ${manifest.name} ${subpath} (type-only declaration ${typesTarget})`);
      continue;
    }
    if (!existsSync(path.join(dir, runtimeTarget))) {
      fail(`${manifest.name} ${subpath}: runtime target ${runtimeTarget} does not exist`);
      continue;
    }
    for (const relative of [runtimeTarget]) {
      const relativeTarget = relative.replace(/^\.\//, '');
      if (!coveredByFiles(manifest.files, relativeTarget)) {
        fail(`${manifest.name} ${subpath}: ${relativeTarget} is missing from the publish \`files\` allowlist — the published tarball would drop it`);
      }
    }
    sweep.push({
      packageName: manifest.name,
      dirName,
      subpath,
      specifier: subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`,
      typesFile,
      runtimeFile: path.join(dir, runtimeTarget),
    });
  }
}

// --- Phase 2: consumer-fixture compile under nodenext resolution.
let fixtureDir = null;
if (failures.length === 0) {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'snapback-export-types-'));
  try {
    for (const { dirName, manifest } of packages) {
      const linkPath = path.join(fixtureDir, 'node_modules', ...manifest.name.split('/'));
      mkdirSync(path.dirname(linkPath), { recursive: true });
      symlinkSync(path.join(PACKAGES_DIR, dirName), linkPath, 'dir');
    }
    const imports = sweep.map(
      ({ specifier }, index) => `import * as ns${index} from '${specifier}';\nvoid ns${index};`,
    );
    const semanticFixtures = `
import { defineTemplateCarrierConfig } from '@expo/snapback-cli/carrier-kit';
import { startDevControlSocket } from '@expo/snapback-cli/expo-dev';
import type {
  BootstrapExchangeControlResult,
  RunExpoDevOptions,
} from '@expo/snapback-cli/expo-dev';

const postFlushControlResult: BootstrapExchangeControlResult = {
  statusCode: 202,
  body: { ok: true },
  afterResponse: async () => {},
};
void postFlushControlResult;

type OnControlStopIsUndeclared = unknown extends RunExpoDevOptions['onControlStop']
  ? true
  : false;
const onControlStopIsUndeclared: OnControlStopIsUndeclared = true;
void onControlStopIsUndeclared;

void startDevControlSocket({
  readyFile: '/tmp/snapback/dev.ready.json',
  ownerIncarnationId: 'fixture-owner',
  ownerStartTime: 'fixture-start',
  startedAt: 'fixture-started-at',
  verbs: {
    'reload-metro': async () => {},
    'stop-children': async () => {},
  },
  // @ts-expect-error The socket owner survives stop-children; no completion callback is public.
  onStopComplete() {},
});

defineTemplateCarrierConfig({
  schemaVersion: 'snapback.template-carriers.v1',
  verifyCommand: ['snapback', 'verify'],
  verifyReceipt: '.snapback/verify-receipt.json',
  carriers: {
    'web-browser': {
      command: ['expo', 'start', '{artifacts}/proof.json', '{supervisorState}/child-state.json'],
      structuredReadiness: {
        kind: 'expo-supervisor',
        file: '{supervisorState}/expo-supervisor.json',
      },
    },
  },
});

defineTemplateCarrierConfig({
  schemaVersion: 'snapback.template-carriers.v1',
  verifyCommand: ['snapback', 'verify'],
  verifyReceipt: '.snapback/verify-receipt.json',
  carriers: {
    'web-browser': {
      command: ['expo', 'start'],
      structuredReadiness: {
        kind: 'expo-supervisor',
        // @ts-expect-error Readiness descriptors belong to private supervisor state, not public artifacts.
        file: '{artifacts}/expo-supervisor.json',
      },
    },
  },
});
`;
    const fixturePath = path.join(fixtureDir, 'imports.mts');
    writeFileSync(fixturePath, `// Generated consumer fixture: every published subpath, resolved as an\n// installed consumer resolves it.\n${imports.join('\n')}\n${semanticFixtures}\nexport {};\n`);
    const authoredFixturePaths = authoredConsumerFixtures.map(({ packageName, file }, index) => {
      const fixturePath = path.join(fixtureDir, `authored-${index}.mts`);
      writeFileSync(
        fixturePath,
        `// Copied from ${packageName}/${path.basename(file)}.\n${readFileSync(file, 'utf8')}`,
      );
      return fixturePath;
    });
    try {
      execFileSync(tscBin, [
        '--noEmit',
        '--strict',
        '--target', 'es2022',
        '--module', 'nodenext',
        '--moduleResolution', 'nodenext',
        '--lib', 'es2022,dom',
        fixturePath,
        ...authoredFixturePaths,
      ], { cwd: fixtureDir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      console.log(`${LABEL} fixture compile ok: ${sweep.length} subpaths and ${authoredFixturePaths.length} authored fixtures across ${packages.length} packages`);
    } catch (error) {
      fail(`consumer fixture failed to compile:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

// --- Phase 3: declared-value-export vs runtime-export parity.
if (failures.length === 0) {
  const program = ts.createProgram(
    sweep.map(({ typesFile }) => typesFile),
    declarationCompilerOptions(ts),
  );
  const checker = program.getTypeChecker();
  for (const { packageName, subpath, typesFile, runtimeFile } of sweep) {
    const sourceFile = program.getSourceFile(typesFile);
    const moduleSymbol = sourceFile === undefined ? undefined : checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) {
      fail(`${packageName} ${subpath}: could not load ${path.relative(ROOT, typesFile)} as a module`);
      continue;
    }
    const declaredValues = new Set(declarationValueExportNames(ts, checker, sourceFile));
    const runtime = await import(pathToFileURL(runtimeFile).href);
    const runtimeNames = new Set(Object.keys(runtime));
    const missing = [...runtimeNames].filter((name) => !declaredValues.has(name)).sort();
    const invented = [...declaredValues].filter((name) => !runtimeNames.has(name)).sort();
    if (missing.length > 0) {
      fail(`${packageName} ${subpath}: runtime exports missing from the declaration: ${missing.join(', ')}`);
    }
    if (invented.length > 0) {
      fail(`${packageName} ${subpath}: declaration exports values the runtime does not have: ${invented.join(', ')}`);
    }
  }
  if (failures.length === 0) {
    console.log(`${LABEL} runtime parity ok: ${sweep.length} declaration surfaces match their modules`);
  }
}

if (failures.length > 0) {
  console.error(`${LABEL} FAILED (${failures.length}):`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`${LABEL} ok: every published subpath resolves TypeScript declarations under the \`types\` condition`);
