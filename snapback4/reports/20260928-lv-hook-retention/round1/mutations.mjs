// Run against an isolated compiled client; never edit the full-suite workspace.
import { cpSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
const root = resolve(process.argv[2]), report = resolve(import.meta.dirname), binary = resolve(process.argv[3]);
const cases = [
  ['changes-call', 'local.js', /answers\.changed\(\[\.\.\.watches\.values\(\)\][^;]+;/, '', 'Astra 1', 'hook-retention-fences'],
  ['replica-fence', 'local-reads.js', /blocked\(key, tables\) \{[^\n]+/, 'blocked(key, tables) { return false; }', 'Astra 1', 'hook-retention-fences'],
  ['cross-policy', 'read-observation.js', 'const deliveries = [];\n    for (const watch of watches)', 'const deliveries = [];\n    for (const watch of [])', 'Astra 2', 'hook-retention-fences'],
  ['subset-replacement', 'read-observation.js', 'const deliveries = [];\n    for (const watch of watches)', 'if ("data" in read && Array.isArray(read.data) && read.data.length) return publish();\n    const deliveries = [];\n    for (const watch of watches)', 'Astra 3', 'hook-retention-fences'],
  ['asset-refusal', 'asset-lifetime.js', 'if (id && "denied" in read && read.denied.code === "E_ASSET_UNKNOWN")', 'if (false)', 'Astra 4 online', 'hook-retention-fences'],
  ['asset-next-cut', 'asset-lifetime.js', 'seq > meta.seq)', 'seq > meta.seq + 1)', 'next-sequence asset', 'hook-retention-model'],
  ['withheld-cut', 'local.js', /if \(!\("loading" in read\)( && \(served \|\| !result.controlCurrent\))?\)/g, 'if (true)', 'withheld reply cannot', 'hook-retention-fences'],
  ['builder-local', '../src/read-nonrevoking.ts', 'const program = backend?.programs.find(p => p.name === name);', 'return []; const program = backend?.programs.find(p => p.name === name);', 'Astra 5 browser wasm', 'hook-retention-browser'],
  ['builder-online', '../src/client.ts', 'if (!inputs || at > (watch.validThrough ?? 0) + 1', 'if (true || !inputs || at > (watch.validThrough ?? 0) + 1', 'Astra 5 browser online', 'hook-retention-browser'],
  ['unknown-cut-sync', 'local-reads.js', '(this.unknownKeys.get(key) ?? Infinity) <= requestSerial', 'true', 'already requested sync', 'hook-retention-model'],
];
const results = [];
for (const [name, file, from, to, pattern, test] of cases) {
  const dir = join(root, '..', 'lv-mutant-' + name); rmSync(dir, { recursive: true, force: true });
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
writeFileSync(join(report, 'mutations.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(r => !r.killed)) process.exitCode = 1;
