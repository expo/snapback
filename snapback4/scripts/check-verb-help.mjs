// Publication checks the binary's generated help against announced CLI flags.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const verbs = new Set('init new check device types dev deploy rollback prune releases serve run clock reset test why guide data sql token doctor upgrade witness'.split(' '));
export function changelogFlags(changelog) {
  const flags = [];
  for (const line of changelog.split('\n')) {
    let verb;
    // Every flag must follow a named owner; preserve owner through adjacent flags.
    // Exact's rebuild command is an external tool, explicitly outside binary help.
    for (const match of line.matchAll(/\b(?:exact\.mjs|[A-Za-z]+)\b|--[a-z][a-z-]*/g)) {
      const token = match[0];
      if (token === 'exact.mjs') verb = 'exact';
      else if (verbs.has(token.toLowerCase())) verb = token.toLowerCase();
      else if (token.startsWith('--')) {
        if (verb === 'exact' && token === '--rebuild') continue;
        if (!verb || verb === 'exact') throw new Error(`changelog flag ${token} needs an explicit Snapback verb: ${line}`);
        flags.push([verb, token]);
      }
    }
  }
  return flags;
}
export function assertChangelogHelp(changelog, help) {
  const failures = [];
  for (const [verb, flag] of changelogFlags(changelog)) {
    const output = help(verb);
    if (!new RegExp(`${flag}(?![a-z-])`).test(output)) failures.push(`${verb} --help omits announced ${flag}`);
  }
  if (failures.length) throw new Error(failures.join('\n'));
}
export function checkVerbHelp(binary, changelog = readFileSync(new URL('../packages/snapback4/CHANGELOG.md', import.meta.url), 'utf8')) {
  const cache = new Map();
  assertChangelogHelp(changelog, verb => {
    if (!cache.has(verb)) {
      const result = spawnSync(binary, [verb, '--help'], { encoding: 'utf8', timeout: 30000 });
      if (result.status !== 0) throw new Error(`${verb} --help failed: ${result.stderr}`);
      cache.set(verb, result.stdout);
    }
    return cache.get(verb);
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkVerbHelp(process.argv[2] ?? fileURLToPath(new URL('../target/debug/snapback4', import.meta.url)));
  console.log('changelog verb help: all announced flags present');
}
