// Round-4 counterfactuals use isolated compiled clients, never the tested package.
import { cpSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
const root = resolve(process.argv[2]), report = import.meta.dirname;
const cases = [
  ['query-evidence', 'this.advance(version, tables);', '', 'independent ephemeral epoch model', 'hook-retention-model'],
  ['dependency-floor-model', 'return version.epoch >= floor;', 'return true;', 'independent ephemeral epoch model', 'hook-retention-model'],
  ['dependency-floor-http', 'return version.epoch >= floor;', 'return true;', 'buffered direct reply', 'hook-retention-ephemeral'],
  ['poll-floor', 'this.advance(version, value.tables ?? []);', '{}', 'withheld epochs', 'ephemeral-fencing'],
  ['final-publication', 'ephemeralReads.valid(result.ephemeralRequest, result.ephemeral)', 'ephemeralReads.current(result.ephemeralRequest)', 'final publication continuation', 'hook-retention-ephemeral', 'local.js'],
];
const results = [];
for (const [name, from, to, pattern, test, file = 'ephemeral-reads.js'] of cases.filter(c => !process.env.LV_MUTANT || c[0] === process.env.LV_MUTANT)) {
  const dir = join(root, 'target', 'lv-r4-mutant-' + name), pkg = join(dir, 'packages/snapback4');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(pkg, { recursive: true });
  try {
    const original = join(root, 'packages/snapback4');
    for (const part of ['dist', 'test', 'package.json']) cpSync(join(original, part), join(pkg, part), { recursive: true });
    symlinkSync(join(original, 'src'), join(pkg, 'src'));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
    symlinkSync(join(original, 'node_modules'), join(pkg, 'node_modules'));
    const path = join(pkg, 'dist', file), source = readFileSync(path, 'utf8');
    if (source.split(from).length !== 2) throw Error('mutation must match exactly once: ' + name);
    writeFileSync(path, source.replace(from, to));
    const command = [process.execPath, '--test', '--test-name-pattern=' + pattern, join(pkg, 'test', test + '.test.mjs')];
    const result = spawnSync(command[0], command.slice(1), { env: { ...process.env, SNAPBACK4_BIN: join(root, 'target/debug/snapback4') }, encoding: 'utf8', timeout: 60000 });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    writeFileSync(join(report, 'mutant-' + name + '.log.gz'), gzipSync(output));
    results.push({ name, killed: result.status === 1 && output.includes('AssertionError'), status: result.status, signal: result.signal, command });
    console.log(JSON.stringify(results.at(-1)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
writeFileSync(join(report, process.env.LV_MUTANT ? 'mutations-' + process.env.LV_MUTANT + '.json' : 'mutations.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(r => !r.killed)) process.exitCode = 1;
