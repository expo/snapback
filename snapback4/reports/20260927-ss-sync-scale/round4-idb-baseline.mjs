// Reproduce the inherited IDB witness failure with the pre-round web sources.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const pin = '1972112a04fc03ece3423fbd4af67646f0cd5826';
const root = resolve(import.meta.dirname, '../..');
const overrides = Object.fromEntries(['web.ts', 'web-journal.ts'].map(name => [
  join(root, 'packages/snapback4/src', name),
  execFileSync('git', ['show', `${pin}:snapback4/packages/snapback4/src/${name}`], { cwd: root, encoding: 'utf8' }),
]));
const source = readFileSync(join(root, 'witness/idb.mjs'), 'utf8')
  .replace('"./lib.mjs"', JSON.stringify(pathToFileURL(join(root, 'witness/lib.mjs')).href))
  .replace('await launch({ extraSource:', `await launch({ sourceOverrides: ${JSON.stringify(overrides)}, extraSource:`);
const directory = join(root, 'target/lane-ss-round4');
mkdirSync(directory, { recursive: true });
const script = join(directory, 'idb-main-control.mjs');
writeFileSync(script, source);
const child = spawn(process.execPath, [script], { cwd: root, stdio: 'inherit' });
process.exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (code, signal) => resolve(signal ? 1 : code));
});
