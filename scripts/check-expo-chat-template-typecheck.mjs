#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateApp, scaffoldApp } from '../packages/snapback-cli/index.mjs';

const root = resolve(import.meta.dirname, '..');
const harnessRoot = join(root, 'tests', 'expo-chat-template-typecheck');
const templateRoot = join(root, 'packages', 'snapback-cli', 'templates', 'expo-chat');
const templateManifest = JSON.parse(readFileSync(join(templateRoot, 'package.json'), 'utf8'));
const harnessManifest = JSON.parse(readFileSync(join(harnessRoot, 'package.json'), 'utf8'));

function nonSnapbackDependencies(manifest, section) {
  return Object.fromEntries(Object.entries(manifest[section] ?? {}).filter(
    ([name]) => !name.startsWith('@expo/snapback-'),
  ));
}

for (const section of ['dependencies', 'devDependencies']) {
  assert.deepEqual(
    nonSnapbackDependencies(harnessManifest, section),
    nonSnapbackDependencies(templateManifest, section),
    `expo-chat ${section} drifted from the recurring typecheck harness`,
  );
}
for (const [name, version] of Object.entries(templateManifest.dependencies ?? {})) {
  if (!name.startsWith('@expo/snapback-')) continue;
  assert.equal(version, '__SNAPBACK_VERSION__', `${name} must remain a scaffold placeholder`);
  if (![
    '@expo/snapback-client',
    '@expo/snapback-expo',
    '@expo/snapback-react',
  ].includes(name)) continue;
  assert.match(
    harnessManifest.dependencies?.[name] ?? '',
    /^file:\.\.\/\.\.\/packages\/snapback-/u,
    `${name} must resolve from a workspace package in the typecheck harness`,
  );
}

const scratchRoot = mkdtempSync(join(harnessRoot, '.expo-chat-typecheck-'));
const scaffoldRoot = join(scratchRoot, 'expo-chat');
try {
  // @ref LLP 0186#w2--context-injection-surface-owned-here — keep the
  // golden-path scaffold type-correct against its exact Expo peer set as the
  // template and first-party client declarations evolve.
  const scaffold = scaffoldApp(scaffoldRoot, { template: 'expo-chat' });
  assert.equal(scaffold.ok, true);
  const generated = await generateApp(join(scaffoldRoot, 'snapback'));
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.equal(
    generated.summary.counts.degradedResults,
    0,
    JSON.stringify(generated.summary.degradedResults),
  );
  const typecheck = spawnSync(
    join(harnessRoot, 'node_modules', '.bin', 'tsc'),
    ['--noEmit', '--project', join(scaffoldRoot, 'tsconfig.json')],
    { cwd: scaffoldRoot, encoding: 'utf8', timeout: 180_000 },
  );
  assert.equal(typecheck.status, 0, typecheck.stderr || typecheck.stdout);
  process.stdout.write('expo-chat template dependency parity, codegen, and strict typecheck: PASS\n');
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}
