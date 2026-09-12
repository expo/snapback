#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tables, logs, replay } from './replay.mjs';
import { verifyFixtures, formatStats } from './audit.mjs';

export const defaultOut = fileURLToPath(new URL('./out/', import.meta.url));
export function build({ log = 'scale', out = defaultOut, scale = Infinity } = {}) {
  const state = replay(log, scale);
  mkdirSync(out, { recursive: true });
  for (const table of tables) {
    const rows = [...state[table].values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    writeFileSync(join(out, `${table}.jsonl`), rows.map(row => `${JSON.stringify(row)}\n`).join(''));
  }
  return state;
}

export function main(args = process.argv.slice(2)) {
  const [command, ...flags] = args;
  if (!['build', 'stats'].includes(command)) throw new Error('usage: clique.mjs build|stats [--log scale|starter|sample] (build: [--out DIR] [--scale N])');
  const options = { log: 'scale' };
  const seen = new Set();
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    const value = flags[i + 1];
    if (!['--log', ...(command === 'build' ? ['--out', '--scale'] : [])].includes(flag) ||
      !value || value.startsWith('--') || seen.has(flag)) throw new Error(`invalid or duplicate option ${flag}`);
    seen.add(flag);
    options[flag.slice(2)] = value;
  }
  if (!Object.hasOwn(logs, options.log)) throw new Error(`unknown log ${options.log}`);
  if (options.scale !== undefined) {
    if (!/^[1-9]\d*$/.test(options.scale) || !Number.isSafeInteger(Number(options.scale))) throw new Error('--scale must be a positive safe integer');
    options.scale = Number(options.scale);
  }
  if (command === 'build') {
    const state = build(options);
    process.stdout.write(`built ${tables.reduce((n, table) => n + state[table].size, 0)} rows in ${resolve(options.out ?? defaultOut)}\n`);
  } else {
    verifyFixtures();
    process.stdout.write(formatStats(replay(options.log), options.log));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
