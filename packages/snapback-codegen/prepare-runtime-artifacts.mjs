#!/usr/bin/env node

// @ref LLP 0041#acceptance — the published codegen package carries every
// public schema/corpus input needed by an external app; it does not reach into
// a sibling Snapback checkout at runtime.

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '..', '..');
const outputRoot = join(packageRoot, 'runtime-artifacts');

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(join(outputRoot, 'tests', 'conformance'), { recursive: true });
cpSync(join(repositoryRoot, 'schemas'), join(outputRoot, 'schemas'), { recursive: true });
cpSync(
  join(repositoryRoot, 'tests', 'conformance', 'data-tier'),
  join(outputRoot, 'tests', 'conformance', 'data-tier'),
  { recursive: true },
);

console.log(`prepared ${outputRoot}`);
