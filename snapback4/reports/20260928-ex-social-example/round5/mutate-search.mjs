#!/usr/bin/env node
// Restore the pre-OS split only in freshly generated output. Preserve owned PIDs.
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../../..');
const binary = join(root, 'target/debug/snapback4');
const args = process.argv.slice(2);
if (args[0] !== 'new') process.execve(binary, [binary, ...args], process.env);
const result = spawnSync(binary, args, { stdio: 'inherit' });
if (result.status === 0 && args.includes('social')) {
  const prefix = 'snapback4/crates/snapback4/src/verbs/init/social/';
  for (const [from, to] of [['Search.tsx', 'src/Search.tsx'], ['schema.q', 'snapback/schema.q']]) {
    const original = execFileSync('git', ['show', 'ae265b730:' + prefix + from], { cwd: root, encoding: 'utf8' });
    writeFileSync(join(args[1], to), original);
  }
}
process.exit(result.status ?? 1);
