// Programmatic static build of the Snapback admin Contract console.
//
// The shared Snapback Contract build preset owns the Exact/Contract Vite plugin
// ordering, route-registry preflights, static/native target, and base-path
// rewrite. This file only supplies the admin console mount shape.
//
// Run via bun (it imports the Exact .ts sources directly). See build.sh.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSnapbackContractStaticApp } from '../packages/snapback-contract/build-preset.mjs';
import { writeAdminConsoleSnapshotManifest } from '../packages/snapback-cli/admin-snapshot.mjs';
import { generateAdminContractBindings } from './generate-contract-bindings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..');

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `admin-ui: could not read build source identity: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`,
    );
  }
  return result.stdout.trim();
}

await generateAdminContractBindings({ root: here });

const result = await buildSnapbackContractStaticApp({
  root: here,
  basePath: '/_snapback/admin/',
  entry: '/src/main.ts',
  outDir: 'dist',
  routeRegistry: 'src/app/routes.ts',
  staticPlatformTargets: ['mac'],
});

const snapshot = writeAdminConsoleSnapshotManifest({
  root: result.outDir,
  sourceRevision: git(['rev-parse', 'HEAD']),
  sourceDirty: git(['status', '--porcelain', '--untracked-files=all']).length > 0,
});

console.log('admin-ui: static build OK ->', result.outDir);
console.log('admin-ui: snapshot sha256 ->', snapshot.manifest.snapshotSha256);
