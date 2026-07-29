import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { armRoot, cli, cliRoot, configPath, evidenceRoot } from './constants.mjs';

const samples = [];
for (let ordinal = 0; ordinal < 9; ordinal += 1) {
  const started = performance.now();
  const result = spawnSync(
    cli,
    [
      `--root-dir=${cliRoot}`,
      `--config-path=${configPath}`,
      'build',
      '--module-path',
      'server/spacetimedb',
    ],
    { cwd: path.resolve(armRoot, 'work'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const elapsedMs = Number((performance.now() - started).toFixed(3));
  if (result.status !== 0) {
    throw new Error(`build sample ${ordinal} failed: ${result.stderr || result.stdout}`);
  }
  samples.push(elapsedMs);
}
const sorted = samples.slice(2).sort((a, b) => a - b);
const percentile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  command: 'spacetime build --module-path server/spacetimedb',
  productVersion: '2.7.0',
  unit: 'milliseconds',
  warmups: samples.slice(0, 2),
  recorded: samples.slice(2),
  median: sorted[Math.floor(sorted.length / 2)],
  p95: percentile(0.95),
  successfulBuilds: samples.length,
};
await writeFile(
  path.resolve(evidenceRoot, 'build-performance.json'),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
