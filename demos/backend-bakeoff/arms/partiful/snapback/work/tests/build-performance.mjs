import { execFileSync } from 'node:child_process';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workRoot = resolve(here, '..');
const evidenceRoot = resolve(workRoot, '..', 'evidence');
const samples = [];

for (let index = 0; index < 9; index += 1) {
  const before = process.hrtime.bigint();
  execFileSync('bun', ['run', 'vite', 'build'], {
    cwd: workRoot,
    stdio: index === 0 ? 'inherit' : 'ignore',
  });
  const milliseconds = Number(process.hrtime.bigint() - before) / 1e6;
  if (index >= 2) samples.push(Number(milliseconds.toFixed(3)));
}

async function sizeOf(path) {
  const info = await stat(path);
  if (info.isFile()) return info.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await sizeOf(join(path, entry));
  return total;
}

const sorted = [...samples].sort((a, b) => a - b);
const result = {
  schemaVersion: 1,
  path: 'vite-production-build',
  warmups: 2,
  recorded: 7,
  rawMs: samples,
  medianMs: sorted[Math.floor(sorted.length / 2)],
  p95NearestRankMs: sorted[Math.ceil(0.95 * sorted.length) - 1],
  outputBytes: await sizeOf(join(workRoot, 'dist')),
  command: 'bun run vite build',
};
await writeFile(join(evidenceRoot, 'build-performance.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
