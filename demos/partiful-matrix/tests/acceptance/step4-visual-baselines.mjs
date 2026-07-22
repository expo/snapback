#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const repoRoot = resolve(demoRoot, '..', '..');
const browserHarness = join(here, 'browser-matrix.mjs');
const spec = JSON.parse(readFileSync(join(demoRoot, 'acceptance', 'visual-spec.v1.json'), 'utf8'));
const exactRevision = option('exact-revision') ?? process.env.PARTITIME_EXACT_REVISION;
const captureRoot = join(demoRoot, 'acceptance', 'visual-baselines', spec.specVersion);
const receiptRoot = join(demoRoot, 'acceptance', 'results', 'phase4-visual-baselines');
const indexPath = join(receiptRoot, 'index.json');
const arms = ['react', 'contract'];

if (!exactRevision) throw new Error('authoritative visual capture requires --exact-revision or PARTITIME_EXACT_REVISION');
mkdirSync(captureRoot, { recursive: true });
mkdirSync(receiptRoot, { recursive: true });

const shardRuns = [];
for (const arm of arms) {
  for (const theme of spec.themes) for (const viewport of spec.viewports) {
    const shardId = `${arm}-${theme.id}-${viewport.id}`;
    const receiptPath = join(receiptRoot, `${shardId}.json`);
    const execution = spawnSync(process.execPath, [
      browserHarness,
      '--product-ui',
      '--phase4-only',
      '--phase4-claim', 'STEP4.UI.VISUAL',
      '--capture-visual-dir', relative(repoRoot, captureRoot),
      '--visual-theme', theme.id,
      '--visual-viewport', viewport.id,
      '--arm', arm,
      '--receipt', receiptPath,
    ], {
      cwd: repoRoot,
      env: { ...process.env, PARTITIME_EXACT_REVISION: exactRevision },
      encoding: 'utf8',
      maxBuffer: 40 * 1024 * 1024,
    });
    let receipt = null;
    try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch { /* recorded below */ }
    const states = receipt?.results?.[0]?.details?.states ?? [];
    const expectedCells = spec.states.length;
    const artifacts = states.map((state) => state.artifact).filter(Boolean);
    const identitiesMatch = states.every((state) => state.theme === theme.id && state.viewport === viewport.id);
    const ok = execution.status === 0 && receipt?.ok === true && states.length === expectedCells && artifacts.length === expectedCells && identitiesMatch;
    console.log(`  ${ok ? '✓' : '✗'} ${shardId} ${artifacts.length}/${expectedCells} visual cells`);
    if (!ok) console.error((execution.stderr || execution.stdout || 'child produced no diagnostic output').trim().split('\n').slice(-12).join('\n'));
    shardRuns.push({ arm, theme: theme.id, viewport: viewport.id, ok, exitCode: execution.status, receiptPath: relative(repoRoot, receiptPath), receiptSha256: receipt ? digest(receiptPath) : null, states, artifacts });
  }
}

const artifacts = shardRuns.flatMap((run) => run.artifacts.map((artifact) => ({ arm: run.arm, ...artifact })));
const expectedArtifacts = arms.length * spec.states.length * spec.themes.length * spec.viewports.length;
const captureComplete = shardRuns.every((run) => run.ok) && artifacts.length === expectedArtifacts;
const report = {
  $schema: 'partitime-visual-baseline-index/v1',
  generatedAt: new Date().toISOString(),
  specVersion: spec.specVersion,
  revisions: { snapback: gitRevision(repoRoot), exact: exactRevision },
  matrix: { arms, states: spec.states.map(({ id }) => id), themes: spec.themes.map(({ id }) => id), viewports: spec.viewports.map(({ id, width, height }) => ({ id, width, height })), expectedArtifacts },
  captureComplete,
  approval: {
    status: 'pending-human-review',
    rule: 'Each image must be reviewed against its visual-spec.v1 acceptance text. React is a measured control, never the Contract oracle.',
    approvedBy: null,
    approvedAt: null,
    specVersion: spec.specVersion,
  },
  outcome: captureComplete ? 'pending-human-review' : 'red',
  isolation: 'fresh backend and browser process per arm × theme × viewport shard',
  shardRuns: shardRuns.map(({ arm, theme, viewport, ok, exitCode, receiptPath, receiptSha256 }) => ({ arm, theme, viewport, ok, exitCode, receiptPath, receiptSha256 })),
  artifacts,
};
writeFileSync(indexPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${captureComplete ? 'CAPTURE COMPLETE — HUMAN APPROVAL PENDING' : 'FAIL'} visual matrix — ${artifacts.length}/${expectedArtifacts}`);
console.log(`Index: ${indexPath}`);
process.exitCode = captureComplete ? 0 : 1;

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitRevision(cwd) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}
