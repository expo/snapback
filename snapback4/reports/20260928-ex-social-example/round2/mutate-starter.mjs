#!/usr/bin/env node
// Run as SNAPBACK4_BIN for the cold-owner-key tests; mutate only fresh output.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const binary = resolve(import.meta.dirname, '../../../target/debug/snapback4');
const args = process.argv.slice(2);
// Preserve device/server PID ownership and normal signal cleanup.
if (args[0] !== 'new') process.execve(binary, [binary, ...args], process.env);
const result = spawnSync(binary, args, { stdio: 'inherit' });
if (result.status === 0 && args[0] === 'new' && args.includes('social')) {
  const path = join(args[1], 'snapback/schema.q');
  const source = readFileSync(path, 'utf8');
  if (!source.includes(' with own keys .principal')) throw Error('policy not found');
  writeFileSync(path, source.replace(' with own keys .principal', ''));
}
process.exit(result.status ?? 1);
