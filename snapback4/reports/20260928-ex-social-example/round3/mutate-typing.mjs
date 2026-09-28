#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const binary = resolve(import.meta.dirname, '../../../target/debug/snapback4'), args = process.argv.slice(2);
if (args[0] !== 'new') process.execve(binary, [binary, ...args], process.env);
const result = spawnSync(binary, args, { stdio: 'inherit' });
if (result.status === 0 && args.includes('social')) {
  const path = join(args[1], 'src/useTyping.ts'), source = readFileSync(path, 'utf8');
  if (!source.includes('alive && call === generation && ')) throw Error('generation fence missing');
  writeFileSync(path, source.replace('alive && call === generation && ', ''));
}
process.exit(result.status ?? 1);
