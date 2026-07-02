// Programmatic static build of the Snapback admin Contract console.
//
// The shared Snapback Contract build preset owns the Exact/Contract Vite plugin
// ordering, route-registry preflights, static/native target, and base-path
// rewrite. This file only supplies the admin console mount shape.
//
// Run via bun (it imports the Exact .ts sources directly). See build.sh.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSnapbackContractStaticApp } from '../packages/snapback-contract/build-preset.mjs';
import { generateAdminContractBindings } from './generate-contract-bindings.mjs';

const here = dirname(fileURLToPath(import.meta.url));

await generateAdminContractBindings({ root: here });

// SNAPBACK_ADMIN_STATIC_TARGETS selects the native envelope targets
// (comma-separated; empty for a web-only build).
const staticPlatformTargets = (process.env.SNAPBACK_ADMIN_STATIC_TARGETS ?? 'mac')
  .split(',')
  .map((target) => target.trim())
  .filter(Boolean);

const result = await buildSnapbackContractStaticApp({
  root: here,
  exactRoot: process.env.SNAPBACK_EXACT_ROOT ?? resolve(here, '../../exact'),
  basePath: '/_snapback/admin/',
  entry: '/src/main.ts',
  outDir: 'dist',
  routeRegistry: 'src/app/routes.ts',
  staticPlatformTargets,
});

console.log('admin-ui: static build OK ->', result.outDir);
