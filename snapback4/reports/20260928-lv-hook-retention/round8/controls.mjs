// Isolated controls: never replace the live SDK used by qualification.
import { cpSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
const root = resolve(process.argv[2]), report = import.meta.dirname;
const cases = [
  ['old-cross-invocation-assertion', 'test/expiry-retry-watch.test.mjs',
    'const continuationRequests = requests.slice(firstPageRequests);',
    'assert.ok(requests.slice(0, -1).every(request => request.args.c === null)); const continuationRequests = requests.slice(firstPageRequests);'],
  ['restart-continuation', 'dist/local.js',
    'evaluateLocal(queryEnvironment, op, args, revision, authority, watch)',
    'evaluateLocal(queryEnvironment, op, attempt > 0 ? { ...args, c: null } : args, revision, authority, watch)'],
  ['leak-expired-cursor', 'dist/local-query.js',
    'const refreshed = await local();',
    'args = { ...args, c: result.read.next }; const refreshed = await local();'],
];
const results = [];
for (const [name, file, from, to] of cases) {
  const dir = join(root, 'target', 'lv-r8-control-' + name), pkg = join(dir, 'packages/snapback4');
  mkdirSync(join(pkg, 'test'), { recursive: true });
  try {
    const original = join(root, 'packages/snapback4');
    for (const part of ['dist', 'package.json', 'test/expiry-retry-watch.test.mjs']) cpSync(join(original, part), join(pkg, part), { recursive: true });
    symlinkSync(join(original, 'src'), join(pkg, 'src'));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
    symlinkSync(join(original, 'node_modules'), join(pkg, 'node_modules'));
    const path = join(pkg, file), source = readFileSync(path, 'utf8');
    if (source.split(from).length !== 2) throw Error('control must match exactly once: ' + name);
    writeFileSync(path, source.replace(from, to));
    const command = [process.execPath, '--test', '--test-name-pattern=delayed changes', join(pkg, 'test/expiry-retry-watch.test.mjs')];
    const result = spawnSync(command[0], command.slice(1), { env: { ...process.env, SNAPBACK4_BIN: join(root, 'target/debug/snapback4') }, encoding: 'utf8', timeout: 60000 });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    writeFileSync(join(report, 'control-' + name + '.log.gz'), gzipSync(output));
    results.push({ name, killed: result.status === 1 && output.includes('AssertionError'), status: result.status, signal: result.signal, command });
    console.log(JSON.stringify(results.at(-1)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
writeFileSync(join(report, 'controls.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(r => !r.killed)) process.exitCode = 1;
