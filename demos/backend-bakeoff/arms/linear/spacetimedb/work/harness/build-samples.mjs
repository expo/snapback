import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const ARM_ROOT = new URL('../../', import.meta.url);
const armPath = decodeURIComponent(ARM_ROOT.pathname).replace(/\/$/, '');
const cli = `${armPath}/state/cli/spacetime`;
const server = `${armPath}/work/server`;
const samples = { warmups: [], recorded: [] };

for (let index = 0; index < 9; index += 1) {
  const started = performance.now();
  const result = spawnSync(
    cli,
    [
      `--root-dir=${armPath}/state/cli`,
      `--config-path=${armPath}/state/config/cli.toml`,
      'build',
      '-p',
      'spacetimedb',
    ],
    {
      cwd: server,
      env: {
        ...process.env,
        PATH: `${armPath}/state/cli:${process.env.PATH}`,
      },
      encoding: 'utf8',
    },
  );
  const elapsed = Number((performance.now() - started).toFixed(3));
  if (result.status !== 0) {
    throw new Error(`build sample ${index} failed: ${result.stderr.slice(0, 500)}`);
  }
  (index < 2 ? samples.warmups : samples.recorded).push(elapsed);
}

await writeFile(
  new URL('../../evidence/performance-build-samples.json', import.meta.url),
  `${JSON.stringify({
    schemaVersion: 1,
    path: 'build-or-deploy',
    operation: 'spacetime build -p spacetimedb',
    providerVersion: '2.7.0',
    warmups: samples.warmups,
    recorded: samples.recorded,
    sampleUnit: 'milliseconds',
    deploySampled: false,
  }, null, 2)}\n`,
);

console.log(JSON.stringify({ ok: true, samples }));
