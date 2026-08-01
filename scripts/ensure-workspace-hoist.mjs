#!/usr/bin/env node
// Generated api.d.ts files import '@expo/snapback-client' from demos/*;
// TypeScript resolves that upward to the repo root, but bun (1.3.x,
// workspaces packages/*) links workspace packages only into dependents'
// own node_modules. Ensure root-level @expo/* links exist so fixture
// compiles resolve on a fresh checkout. Idempotent; silent on no-op.
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');
const scopeDir = join(root, 'node_modules', '@expo');

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgJsonPath = join(packagesDir, entry.name, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;
  const name = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).name;
  if (typeof name !== 'string' || !name.startsWith('@expo/')) continue;
  const linkPath = join(scopeDir, name.slice('@expo/'.length));
  if (existsSync(linkPath)) continue;
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(relative(scopeDir, join(packagesDir, entry.name)), linkPath, 'dir');
  console.log(`hoisted ${name} -> ${relative(root, linkPath)}`);
}
