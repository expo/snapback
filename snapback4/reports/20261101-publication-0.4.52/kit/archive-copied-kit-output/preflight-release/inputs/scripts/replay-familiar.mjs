// Usage: node scripts/replay-familiar.mjs BEFORE_BINARY AFTER_BINARY OUTPUT_JSON
// The replay is read-only with respect to either binary's checkout.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
const [before, after, output] = process.argv.slice(2).map(p => resolve(p));
if (!before || !after || !output) throw Error('expected BEFORE_BINARY AFTER_BINARY OUTPUT_JSON');
const guesses = JSON.parse(readFileSync(new URL('../crates/snapback4/tests/familiar/guesses.json', import.meta.url)));
const directory = mkdtempSync(join(tmpdir(), 'sb4-familiar-replay-'));
const schema = join(directory, 'snapback');
mkdirSync(schema);
const identity = binary => ({path: binary, sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), version: spawnSync(binary, ['--version'], {encoding: 'utf8'}).stdout.trim()});
const result = {before: identity(before), after: identity(after), fixture: 'crates/snapback4/tests/familiar/guesses.json', guesses: []};
function check(binary, source) {
  writeFileSync(join(schema, 'schema.q'), source);
  const r = spawnSync(binary, ['check', '--json'], {cwd: directory, encoding: 'utf8'});
  if (r.error) throw r.error;
  const json = JSON.parse(r.stdout);
  return {exit: r.status, problems: json.problems ?? [], notes: json.notes ?? [], stderr: r.stderr};
}
try {
  for (const guess of guesses) {
    rmSync(join(schema, 'm.q'), {force: true});
    if (guess.module) writeFileSync(join(schema, 'm.q'), guess.module);
    result.guesses.push({name: guess.name, origin: guess.origin, before: check(before, guess.source), after: check(after, guess.source), repaired: check(after, guess.repaired)});
  }
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  for (const g of result.guesses) {
    const codes = r => r.exit === 0 ? 'compiles' : r.problems.map(p => p.code).join(', ');
    console.log(`${g.name}: ${codes(g.before)} -> ${codes(g.after)}; repair ${codes(g.repaired)}`);
    if (g.repaired.exit !== 0) process.exitCode = 1;
  }
} finally { rmSync(directory, {recursive: true, force: true}); }
