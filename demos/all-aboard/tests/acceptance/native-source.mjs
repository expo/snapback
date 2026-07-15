#!/usr/bin/env node

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const demoRoot = fileURLToPath(new URL('../../', import.meta.url));
const surfaceRoot = resolve(demoRoot, 'surfaces/contract');
const pinPath = resolve(demoRoot, 'exact-source.json');
const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
const exactRoot = process.env.EXACT_ALL_ABOARD_SOURCE_ROOT;

function fail(message) {
  console.error(`not ok - ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    fail(`${command} ${args.join(' ')} exited ${result.status}`);
  }
  return (result.stdout ?? '').trim();
}

function embeddedModuleSource(startup, modulePath) {
  const prefix = '  const __exactDevModules = ';
  const moduleTable = startup.split('\n').find((line) => line.startsWith(prefix));
  if (!moduleTable?.endsWith(';')) return null;
  const modules = JSON.parse(moduleTable.slice(prefix.length, -1));
  return Object.values(modules).find((module) => module.path === modulePath)?.source ?? null;
}

if (!exactRoot) {
  fail(`EXACT_ALL_ABOARD_SOURCE_ROOT is required (expected ${pin.repository} at ${pin.commit})`);
}

const exact = resolve(exactRoot);
const head = run('git', ['-C', exact, 'rev-parse', 'HEAD'], { capture: true });
run('git', ['-C', exact, 'merge-base', '--is-ancestor', pin.commit, head], { capture: true });
console.log(`ok - Exact source contains pinned revision ${pin.commit.slice(0, 12)} (HEAD ${head.slice(0, 12)})`);

run('bun', ['run', 'build'], {
  cwd: surfaceRoot,
  env: {
    ...process.env,
    EXACT_ALL_ABOARD_SOURCE_ROOT: exact,
  },
});

const nativeRoot = resolve(surfaceRoot, 'dist/web/__exact/native');
for (const target of ['mac-appkit-hermes', 'ios-uikit-hermes']) {
  for (const file of ['exact-native.json', 'diagnostics.json', 'startup.js', 'startup.hbc']) {
    const path = resolve(nativeRoot, target, file);
    if (!existsSync(path)) fail(`${target} did not emit ${file}`);
  }
  const manifest = JSON.parse(readFileSync(resolve(nativeRoot, target, 'exact-native.json'), 'utf8'));
  const startup = readFileSync(resolve(nativeRoot, target, 'startup.js'), 'utf8');
  const externalUrlSource = embeddedModuleSource(startup, '/external-url.ts');
  const expectedPlatform = target.startsWith('mac-') ? 'mac' : 'ios';
  if (manifest.platform !== expectedPlatform || manifest.startup?.hbc?.status !== 'ready') {
    fail(`${target} manifest is not a ready ${expectedPlatform} envelope`);
  }
  if (!externalUrlSource?.includes('desktop.shell.openExternal')) {
    fail(`${target} startup does not carry All Aboard's Contract URL-open host capability`);
  }
  console.log(`ok - ${target} production envelope`);
}

if (process.env.EXACT_ALL_ABOARD_BUILD_HOSTS === '1') {
  if (process.platform !== 'darwin') fail('EXACT_ALL_ABOARD_BUILD_HOSTS=1 requires macOS');
  const project = resolve(exact, 'ios/ExactApp/ExactApp.xcodeproj');
  const derivedRoot = resolve(tmpdir(), `snapback-all-aboard-native-${process.pid}`);
  rmSync(derivedRoot, { recursive: true, force: true });
  try {
    run('xcodebuild', [
      '-project', project,
      '-scheme', 'ExactAppMac',
      '-configuration', 'Debug',
      '-derivedDataPath', resolve(derivedRoot, 'mac'),
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ]);
    console.log('ok - ExactAppMac host build');
    run('xcodebuild', [
      '-project', project,
      '-scheme', 'ExactApp',
      '-configuration', 'Debug',
      '-destination', 'generic/platform=iOS Simulator',
      '-derivedDataPath', resolve(derivedRoot, 'ios'),
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ]);
    console.log('ok - ExactApp iOS Simulator host build');
  } finally {
    rmSync(derivedRoot, { recursive: true, force: true });
  }
}

console.log('All Aboard native source acceptance passed.');
