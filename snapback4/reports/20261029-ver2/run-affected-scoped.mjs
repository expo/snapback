// The brief excludes the full client pool. Preserve the selector's full plan,
// then execute the affected starter/verify/docs slice with its normal runner.
import { planAffected, runPlan, ROOT } from '../../scripts/affected.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.env.VER2_EVIDENCE ?? '/tmp/ver2-evidence'); mkdirSync(out, { recursive: true });
const plan = planAffected({ base: 'origin/main', worktree: process.argv.includes('--worktree') });
writeFileSync(`${out}/selector-complete-plan.json`, JSON.stringify(plan, null, 2));
const step = (id, argv, cwd = 'snapback4', timeoutSeconds = 1800) => ({ id, argv, cwd, timeoutSeconds, requires: [] });
const keep = ['install-client', 'build-cli', 'build-client', 'diagnostics', 'docs-budget', 'guide', 'inventories', 'packaged-docs', 'ref-check'];
const steps = plan.steps.filter(s => keep.includes(s.id)).map(s => ({ ...s, requires: [], fileRequires: undefined }));
steps.splice(steps.findIndex(s => s.id === 'build-client') + 1, 0,
  step('rust:init-unit', ['cargo', 'test', '-p', 'snapback4', '--bin', 'snapback4', 'verbs::init::', '--', '--test-threads=4']),
  step('rust:starters', ['cargo', 'test', '-p', 'snapback4', '--test', 'init', '--test', 'init_ver1', '--test', 'init_dx3', '--test', 'init_production', '--', '--test-threads=4', '--skip', 'w8b_residency_measures_the_wired_calibration_shape']),
  step('rust:guide', ['cargo', 'test', '-p', 'snapback4-lang', '--test', 'guide', '--', '--test-threads=4']),
  step('client:verify', ['node', 'scripts/run-client-tests.mjs', '4', 'files', 'packages/snapback4/test/ver1-loop.test.mjs', 'packages/snapback4/test/ver2-routing.test.mjs', 'packages/snapback4/test/tok2-output.test.mjs', 'packages/snapback4/test/tok3-reading.test.mjs', 'packages/snapback4/test/tok1-reading.test.mjs', 'packages/snapback4/test/production-starters.test.mjs']),
  step('typecheck:snapback4', ['bun', 'run', '--cwd', 'packages/snapback4', 'typecheck']));
// Generated-artifact checking is mandatory even if this selector revision
// doesn't derive it for the embedded guide/starter leaves.
steps.push(step('generated', ['scripts/check-generated-artifacts'], '.', 1800));
const scoped = { ...plan, steps, fullSelectorPlanExecuted: false, qualification: false,
  scope: 'VER2 starter verification/reuse/progress and proof-loop prose; complete client pool, unrelated W8B calibration and full battery excluded by brief' };
writeFileSync(`${out}/selector-scoped-plan.json`, JSON.stringify(scoped, null, 2));
const { receiptPath, receipt } = await runPlan(scoped, { root: ROOT });
writeFileSync(`${out}/receipt-path.txt`, receiptPath + '\n');
if (!receipt.ok) process.exitCode = 1;
