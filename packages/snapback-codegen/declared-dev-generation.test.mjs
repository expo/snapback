import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const root = mkdtempSync(join(tmpdir(), 'snapback-declared-dev-generation-'));
const backend = join(root, 'snapback');
try {
  cpSync(join(repoRoot, 'tests', 'fixtures', 'familiar-todo-explicit'), backend, { recursive: true });
  mkdirSync(join(root, 'node_modules', '@expo'), { recursive: true });
  symlinkSync(
    join(repoRoot, 'packages', 'snapback-client'),
    join(root, 'node_modules', '@expo', 'snapback-client'),
    'dir',
  );
  const defineUrl = pathToFileURL(join(repoRoot, 'packages', 'snapback-codegen', 'define.mjs')).href;
  for (const name of ['schema.mjs', 'functions.mjs']) {
    const path = join(backend, name);
    writeFileSync(path, readFileSync(path, 'utf8').replace(
      '../../../packages/snapback-codegen/define.mjs',
      defineUrl,
    ));
  }

  const development = await generate(backend, { appBindingMode: 'development' });
  assert.equal(development.ok, true, JSON.stringify(development.diagnostics));
  const devAlias = readFileSync(join(backend, 'generated', 'app.mjs'), 'utf8');
  assert.match(devAlias, /declaredDev/u);
  const devBindingName = readFileSync(join(backend, 'generated', 'app.binding.mjs'), 'utf8')
    .match(/from "(\.\/app\.binding\.[a-f0-9]{64}\.mjs)"/u)?.[1];
  assert(devBindingName);
  const devBindingSource = readFileSync(join(backend, 'generated', devBindingName.slice(2)), 'utf8');
  assert.match(devBindingSource, /@expo\/snapback-client\/internal\/declared-dev-mint/u);
  assert.match(devBindingSource, /unsafeInstallDeclaredDevCapabilityForGeneratedCode/u);
  const developmentModule = await import(`${pathToFileURL(join(backend, 'generated', 'app.mjs')).href}?development=1`);
  assert.equal(developmentModule.declaredDev?.format, 'snapback.declared-dev-capability.v1');
  assert.equal(developmentModule.app.declaredDev, developmentModule.declaredDev);
  assert.equal(developmentModule.declaredDev.deploymentIdentity.appId, development.artifactIndex.appId);
  assert.equal(developmentModule.declaredDev.deploymentIdentity.inputsHash, development.inputsHash);

  writeFileSync(join(backend, 'generated', 'stale-development-only.mjs'), 'stale');
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let release;
  try {
    release = await generate(backend, { appBindingMode: 'release' });
  } finally {
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
  assert.equal(release.ok, true, JSON.stringify(release.diagnostics));
  assert.equal(existsSync(join(backend, 'generated', 'stale-development-only.mjs')), false);
  const releaseAlias = readFileSync(join(backend, 'generated', 'app.mjs'), 'utf8');
  assert.match(releaseAlias, /declaredDev/u);
  const releaseBindingName = readFileSync(join(backend, 'generated', 'app.binding.mjs'), 'utf8')
    .match(/from "(\.\/app\.binding\.[a-f0-9]{64}\.mjs)"/u)?.[1];
  assert(releaseBindingName);
  assert.notEqual(releaseBindingName, devBindingName);
  assert.equal(existsSync(join(backend, 'generated', devBindingName.slice(2))), false);
  const releaseBindingSource = readFileSync(join(backend, 'generated', releaseBindingName.slice(2)), 'utf8');
  assert.doesNotMatch(releaseBindingSource, /declared-dev-mint|unsafeInstallDeclaredDevCapabilityForGeneratedCode/u);
  assert.match(releaseBindingSource, /export const declaredDev = null/u);
  const releaseModule = await import(`${pathToFileURL(join(backend, 'generated', 'app.mjs')).href}?release=1`);
  assert.equal(releaseModule.declaredDev, null);
  assert.equal(releaseModule.app.declaredDev, null);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('declared-dev-generation.test.mjs: dev mint, release sentinel, misleading NODE_ENV, stable exports, and atomic dev-to-release replacement pass');
