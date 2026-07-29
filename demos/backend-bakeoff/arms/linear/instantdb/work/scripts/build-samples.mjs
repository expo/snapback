import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import os from 'node:os';

const root = resolve(import.meta.dirname, '..');
const evidenceDir = resolve(root, '../evidence');
mkdirSync(evidenceDir, { recursive: true });
const target = JSON.parse(
  readFileSync(resolve(root, '.arm-runtime/target.json'), 'utf8'),
);
const warmups = [];
const recorded = [];
for (let index = 0; index < 9; index += 1) {
  const begin = performance.now();
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    env: { ...process.env, VITE_INSTANT_APP_ID: target.appId },
    encoding: 'utf8',
  });
  const elapsedMs = performance.now() - begin;
  if (result.status !== 0) {
    const sanitized = `${result.stdout}\n${result.stderr}`
      .replaceAll(target.appId, '[APP_ID]')
      .replaceAll(target.adminToken, '[ADMIN_TOKEN]');
    writeFileSync(resolve(evidenceDir, `build-failure-${index}.txt`), sanitized);
    throw new Error(`build sample ${index} failed`);
  }
  (index < 2 ? warmups : recorded).push(elapsedMs);
}
const sorted = [...recorded].sort((a, b) => a - b);
const nearest = (p) => sorted[Math.ceil(p * sorted.length) - 1];
const evidence = {
  operation: 'production-build',
  targetIdSha256: createHash('sha256').update(target.appId).digest('hex'),
  warmupMs: warmups,
  rawMs: recorded,
  medianMs: nearest(0.5),
  nearestRankP95Ms: nearest(0.95),
  machine: {
    hostname: os.hostname(),
    cpus: os.cpus().length,
    loadAverageAtCapture: os.loadavg(),
    node: process.version,
  },
  output: 'dist/',
  portReservation: 4325,
  capturedAt: new Date().toISOString(),
};
writeFileSync(
  resolve(evidenceDir, 'performance-build.json'),
  JSON.stringify(evidence, null, 2) + '\n',
);
process.stdout.write(
  JSON.stringify({
    ok: true,
    samples: recorded.length,
    medianMs: evidence.medianMs,
    nearestRankP95Ms: evidence.nearestRankP95Ms,
  }) + '\n',
);
