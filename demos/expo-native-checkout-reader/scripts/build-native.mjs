#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptRoot, '..', 'app');
const platform = process.argv[2];
const prebuildOnly = process.argv.includes('--prebuild-only');

if (!['ios', 'android'].includes(platform)) {
  throw new Error('usage: node build-native.mjs ios|android [--prebuild-only]');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? appRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${options.label ?? command} failed`);
  }
}

if (!existsSync(join(appRoot, 'node_modules'))) {
  run('bun', ['install', '--frozen-lockfile'], { label: 'witness dependency install' });
}
run('bun', ['run', 'generate'], { label: 'witness Snapback generation' });
run('bunx', ['expo', 'prebuild', '--clean', '--platform', platform], {
  label: `Expo ${platform} prebuild`,
});

if (!prebuildOnly && platform === 'ios') {
  run('xcodebuild', [
    '-workspace', 'ios/SnapbackCheckoutWitness.xcworkspace',
    '-scheme', 'SnapbackCheckoutWitness',
    '-configuration', 'Debug',
    '-sdk', 'iphonesimulator',
    '-derivedDataPath', '../.state/ios-derived-data',
    'CODE_SIGNING_ALLOWED=NO',
    'build',
  ], { label: 'iOS simulator development-client build' });
}
if (!prebuildOnly && platform === 'android') {
  run(join(appRoot, 'android', 'gradlew'), ['assembleDebug'], {
    cwd: join(appRoot, 'android'),
    label: 'Android development-client build',
  });
}
