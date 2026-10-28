#!/usr/bin/env node
// The SEC11 brief prohibits the full Rust/client pools selected by docs edges.
// Retain the original plan and disclose every omitted step; never call this a
// completed canonical selector receipt. Integration owns the remaining pool.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { planAffected, runPlan } = await import(pathToFileURL(resolve('snapback4/scripts/affected.mjs')));
const plan = planAffected({ base: process.env.SEC11B_AFFECTED_BASE || 'origin/main', worktree: process.argv.includes('--worktree') });
const originalPath = process.argv[2];
if (!originalPath || originalPath.startsWith('--')) throw new Error('output prefix required');
writeFileSync(originalPath + '.original.json', JSON.stringify(plan, null, 2));
const allowed = new Set(['install-client','build-cli','build-wasm','build-client','rust:snapback4','rust:snapback4-lang',
  'diagnostics','docs-budget','packaged-docs','ref-check']);
const files = ['dx9-packed','sec10-packed','security-packed','write-authority','wave11-guide-types','lang4-guide']
  .map(name => `packages/snapback4/test/${name}.test.mjs`);
const steps = plan.steps.filter(step => allowed.has(step.id)).flatMap(step => {
  if (step.id === 'rust:snapback4-lang') {
    // The canonical plan may already append libtest options after `--`.
    // Cargo target selectors must precede that separator, not reach libtest.
    const separator = step.argv.indexOf('--');
    const cargo = separator < 0 ? step.argv : step.argv.slice(0, separator);
    const harness = separator < 0 ? [] : step.argv.slice(separator);
    return [
    { ...step, argv: [...cargo, '--lib', '--', '--test-threads=4'],
      reason: 'Affected language unit tests with four threads: unchanged 15-second clock fixture failed under the default unit pool; exact isolated retry passed without source changes' },
    { ...step, id: 'rust:snapback4-lang-integration', argv: [...cargo, '--test', '*', ...harness],
      reason: 'All integration targets in the affected language crate; canonical harness options are retained for the integration targets' },
    { ...step, id: 'rust:snapback4-lang-doc', argv: [...cargo, '--doc', ...harness], reason: 'Affected language doctests' },
    ];
  }
  if (step.id !== 'rust:snapback4') return [step];
  const prefix = ['cargo','test','--no-fail-fast','-p','snapback4','--features','snapback4-core/test-support'];
  return [
    { ...step, argv: [...prefix,'--bin','snapback4','verbs::security','--','--test-threads=4'],
      reason: 'SEC11 witness and decision unit modules, including security_reviews' },
    { ...step, id: 'rust:snapback4-security-integration', argv: [...prefix,
      '--test','dx11','--test','dx11_refusals','--test','dx13','--test','security_reviews',
      '--test','security_wave19','--','--test-threads=1'], reason: 'Affected security and default-verdict integration targets' },
  ];
});
const client = plan.steps.find(step => step.id === 'client-tests');
if (client) steps.push({ ...client, argv: ['node','scripts/run-client-tests.mjs','3','files',...files] });
const scoped = { ...plan, steps, rustPackages: ['snapback4','snapback4-lang'], clientFiles: files.map(f => 'snapback4/' + f),
  sec11Override: { reason: 'Explicit workstream prohibition on the full five-crate suite and full client pool',
    canonicalComplete: false, legacyRootChecks: 'Root generated/guide/inventories are Snapback1 checks outside the Snapback4 fence; product guides are covered by language tests, guide clients and packaged-doc lint', cliTargets: ['unit verbs::security*','dx11','dx11_refusals','dx13','security_reviews','security_wave19'], cliExcluded: 'Other CLI modules/integration targets, including unrelated 6,929-row residency calibration; interrupted earlier broad run retained separately', omitted: plan.steps.filter(step => !allowed.has(step.id)).map(step => step.id),
    differentialRuns: 'Direct 2k run-lean and run receipts are recorded separately',
    languageUnitTestThreads: { count: 4, integrationTargets: 'canonical harness options retained', issue: 'issues/20261027-snapback4-clock-fixture-test-wall-deadline-under-parallel-load.md', assertionsAndProductBudgetsUnchanged: true } } };
writeFileSync(originalPath + '.scoped.json', JSON.stringify(scoped, null, 2));
if (process.argv.includes('--plan-only')) process.exit(0);
const { receipt } = await runPlan(scoped);
writeFileSync(originalPath + '.receipt.json', JSON.stringify(receipt, null, 2));
process.exitCode = receipt.ok ? 0 : 1;
