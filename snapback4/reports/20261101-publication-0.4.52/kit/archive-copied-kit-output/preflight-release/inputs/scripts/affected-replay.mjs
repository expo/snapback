#!/usr/bin/env node
// Replay selection only: no test-execution or historical-green claim.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARGO_ENV, ROOT, changedPaths, modelAtRevision, selectAffected } from './affected.mjs';

export function obligations(plan, model) {
  const selected = new Set();
  for (const crate of model.crates) {
    if (plan.rustPackages.includes(crate.name)) {
      for (const target of crate.targets) if (target.kind.some(kind => ['lib', 'bin', 'test', 'proc-macro'].includes(kind))) selected.add(`rust:${crate.name}:${target.kind.join('+')}:${target.name}`);
      if (crate.targets.some(target => target.kind.includes('lib'))) selected.add(`rust:${crate.name}:doc`);
    } else for (const target of plan.rustTargets[crate.name] ?? []) selected.add(`rust:${crate.name}:test:${target}`);
  }
  for (const file of plan.clientFiles) selected.add(`client:${file}`);
  for (const check of plan.checks) selected.add(`check:${check}`);
  for (const step of plan.steps) if (step.id.startsWith('difftest:')) selected.add(step.id);
  return [...selected].sort();
}
export function replay({ ref = 'origin/main', count = 30 } = {}) {
  const git = (...args) => execFileSync('timeout', ['120s', 'git', ...args], { cwd: ROOT, env: { ...process.env, ...CARGO_ENV }, encoding: 'utf8' }).trim();
  const commits = git('log', ref, '--merges', `-n${count}`, '--format=%H', '--', 'snapback4/').split('\n').filter(Boolean);
  const rows = commits.map((head, index) => {
    const base = git('rev-parse', `${head}^1`);
    const files = changedPaths(ROOT, base, head);
    const started = Date.now();
    return modelAtRevision(ROOT, head, model => {
      const plan = selectAffected(files, model);
      const full = selectAffected(['snapback4/Cargo.toml'], model);
      const selectedSet = obligations(plan, model);
      const fullSet = obligations(full, model);
      const result = { base, head, subject: git('show', '-s', '--format=%s', head), files, broad: plan.broad,
        selectedCount: selectedSet.length, fullCount: fullSet.length, ratio: selectedSet.length / fullSet.length,
        selectedCommandCount: plan.steps.length, fullCommandCount: full.steps.length,
        rustPackages: plan.rustPackages, rustTargets: plan.rustTargets, clientFiles: plan.clientFiles,
        reasons: plan.reasons, selectedSet, elapsedMs: Date.now() - started };
      console.error(`${index + 1}/${commits.length} ${head.slice(0, 10)}: ${result.selectedCount}/${result.fullCount} obligations; ${result.selectedCommandCount}/${result.fullCommandCount} commands; broad=${plan.broad}`);
      return result;
    });
  });
  return { schemaVersion: 'snapback4.affected-replay.v1', ref, refRevision: git('rev-parse', ref), requestedCount: count,
    measurement: 'Selection only; Rust target/client-file/check obligations, not individual test counts or timing.', rows };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const options = {}; let output;
  for (let i = 0; i < args.length; i++) {
    if (!['--ref', '--count', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('usage: affected-replay.mjs [--ref REV] [--count N] [--output PATH]');
    const key = args[i].slice(2); const value = args[++i];
    if (key === 'output') output = value; else options[key] = key === 'count' ? Number(value) : value;
  }
  if (options.count !== undefined && (!Number.isInteger(options.count) || options.count < 1)) throw new Error('positive integer count required');
  const result = replay(options); const bytes = JSON.stringify(result, null, 2) + '\n';
  if (output) writeFileSync(output, bytes); else console.log(bytes);
}
