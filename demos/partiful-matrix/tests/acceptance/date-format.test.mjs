#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fmtWhen } from '../../surfaces/contract/helpers.ts';

const here = dirname(fileURLToPath(import.meta.url));
const helperUrl = pathToFileURL(resolve(here, '../../surfaces/contract/helpers.ts')).href;
const cases = [
  [1_785_632_400_000, 'Sat, Aug 1, 6:00 PM'],
  [1_786_228_200_000, 'Sat, Aug 8, 3:30 PM'],
  [1_786_921_200_000, 'Sun, Aug 16, 4:00 PM'],
];

assert.deepEqual(
  cases.map(([timestamp]) => fmtWhen(timestamp)),
  cases.map(([, expected]) => expected),
  'Node-side static formatting drifted',
);

const bun = spawnSync('bun', [
  '-e',
  `import { fmtWhen } from ${JSON.stringify(helperUrl)}; console.log(JSON.stringify(${JSON.stringify(cases.map(([timestamp]) => timestamp))}.map(fmtWhen)));`,
], { encoding: 'utf8' });
assert.equal(bun.status, 0, `Bun formatter probe failed: ${bun.stderr}`);
assert.deepEqual(
  JSON.parse(bun.stdout),
  cases.map(([, expected]) => expected),
  'Bun and Node must produce the same static/hydration text',
);

console.log('PASS Partitime deterministic date formatting');
