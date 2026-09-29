// Run against an isolated compiled client; never edit the full-suite workspace.
import { cpSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
const root = resolve(process.argv[2]), report = resolve(import.meta.dirname), binary = resolve(process.argv[3]);
const cases = [
  ['overlap-withdrawal', 'read-observation.js', 'for (const watch of watches.evidence(tables, cut, dependencyFree))', 'for (const watch of [])', 'round 2.*(subset|null withdraws)', 'hook-retention-fences'],
  ['replacement-call', 'local-read-publication.js', /if \(!result.dependencyFree\)\s*answers.replacement\(key, result.seq, result.tables\);/, '', 'round 2.*remote null', 'hook-retention-fences'],
  ['replacement-model', 'local-read-publication.js', /if \(!result.dependencyFree\)\s*answers.replacement\(key, result.seq, result.tables\);/, '', 'independent fence model', 'hook-retention-model'],
  ['dependency-fence', 'local-reads.js', 'this.fence(inputs, cut);', '{}', 'round 2.*remote null', 'hook-retention-fences'],
  ['profile-prediction', '../src/local.ts', 'predictionEffects.unaffected(table, request.predictionFreeRevision as number)', 'request.predictionFreeRevision === predictionEffects.revision', 'Astra 5 browser wasm', 'hook-retention-browser'],
  ['profile-replay', '../src/client.ts', '(watch.validThrough ?? -1) < Math.max(at, Number(json.head ?? at)) && ', '', 'Astra 5 browser online', 'hook-retention-browser'],
  ['asset-order', 'asset-lifetime.js', 'next.seq > prior.seq : next.ticket >= prior.ticket', 'true : true', 'round 2.*old-refusal', 'hook-retention-fences'],
  ['asset-inflight-refusal', 'asset-lifetime.js', /if \(refusal && !assetOrderAtLeast\(order, refusal\)\)\s*return false;/, '', 'per-asset refusal|round 2.*old-grant', 'hook-retention-index'],
  ['index-scan', 'read-index.js', 'this.byKey.get(readKey(op, args)) ?? []', '[...this.values()].filter(w => readKey(w.op, w.args) === readKey(op, args))', 'indexed replacements', 'hook-retention-index'],
  ['unknown-cut', 'local-reads.js', 'serial <= requestSerial', 'true', 'unknown-cut dependency', 'hook-retention-index'],
];
const results = [];
for (const [name, file, from, to, pattern, test] of cases.filter(c => !process.env.LV_MUTANT || c[0] === process.env.LV_MUTANT)) {
  const dir = join(root, 'target', 'lv-r2-mutant-' + name); rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'packages/snapback4'), { recursive: true });
  const pkg = join(dir, 'packages/snapback4'), original = join(root, 'packages/snapback4');
  for (const part of ['dist', 'test', 'src', 'package.json']) cpSync(join(original, part), join(pkg, part), { recursive: true });
  symlinkSync(resolve(root, 'node_modules'), join(dir, 'node_modules'));
  symlinkSync(resolve(original, 'node_modules'), join(pkg, 'node_modules'));
  cpSync(join(root, 'package.json'), join(dir, 'package.json'));
  cpSync(join(root, 'witness'), join(dir, 'witness'), { recursive: true });
  mkdirSync(join(dir, 'apps'), { recursive: true });
  symlinkSync(resolve(root, 'apps/chat'), join(dir, 'apps/chat'));
  const path = join(pkg, 'dist', file), source = readFileSync(path, 'utf8'), mutated = source.replace(from, to);
  if (source === mutated) throw Error('mutation did not match: ' + name);
  writeFileSync(path, mutated);
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=' + pattern, join(pkg, 'test', test + '.test.mjs')], { env: { ...process.env, SNAPBACK4_BIN: binary }, encoding: 'utf8', timeout: 60000 });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(join(report, 'mutant-' + name + '.log.gz'), gzipSync(output));
  const killed = result.status === 1 && output.includes('AssertionError');
  results.push({ name, killed, status: result.status, signal: result.signal, pattern });
  console.log(JSON.stringify(results.at(-1)));
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(join(report, process.env.LV_MUTANT ? 'mutations-' + process.env.LV_MUTANT + '.json' : 'mutations.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(r => !r.killed)) process.exitCode = 1;
