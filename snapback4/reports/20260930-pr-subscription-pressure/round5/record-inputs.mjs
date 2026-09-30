// Qualification input snapshot, run from snapback4/; reports/journal are outputs.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
const files = [...new Set(execFileSync('git', ['-C', '..', 'ls-files', '-co', '--exclude-standard', '--', 'snapback4', ':(exclude)snapback4/reports'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim().split('\n'))].sort();
const hashes = {};
for (const file of files) {
  if (file.startsWith('snapback4/reports/') || file === 'snapback4/JOURNAL.md' || (file.startsWith('snapback4/metrics/') && file !== 'snapback4/metrics/wasm-budget.json')) continue;
  if (!lstatSync('../' + file).isFile()) continue;
  hashes[file] = createHash('sha256').update(readFileSync('../' + file)).digest('hex');
}
writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes }, null, 2)+'\n');
console.log(Object.keys(hashes).length, 'inputs');
