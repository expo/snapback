#!/usr/bin/env node
// The SEC12 brief prohibits the full Rust/client pools selected by docs edges.
// Retain the original plan and disclose every omitted step; never call this a
// completed canonical selector receipt. Integration owns the remaining pool.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { planAffected, runPlan } = await import(pathToFileURL(resolve('snapback4/scripts/affected.mjs')));
const plan = planAffected({ base: 'origin/main', worktree: process.argv.includes('--worktree') });
const originalPath = process.argv[2];
if (!originalPath || originalPath.startsWith('--')) throw new Error('output prefix required');
writeFileSync(originalPath + '.original.json', JSON.stringify(plan, null, 2));
const allowed = new Set(['install-client','build-cli','build-wasm','build-client','rust:snapback4','rust:snapback4-lang',
  'diagnostics','docs-budget','packaged-docs','ref-check']);
const files = ['dx9-packed','sec10-packed','security-packed','write-authority','wave11-guide-types','lang4-guide']
  .map(name => `packages/snapback4/test/${name}.test.mjs`);
const steps = plan.steps.filter(step => allowed.has(step.id)).flatMap(step => {
  if (step.id === 'rust:snapback4-lang') {
    const prefix = ['cargo','test','--no-fail-fast','-p','snapback4-lang'];
    return [
      {...step, id:'rust:snapback4-lang-clock', argv:[...prefix,'--lib','bind::security::challenges::generated::sec9_clock_reach_tests::future_payment_can_be_replayed_against_clock_intent','--','--exact','--test-threads=1'], reason:'Retain the original clock bound and run the timer case separately'},
      {...step, argv:[...prefix,'--lib','--','--test-threads=4','--skip','future_payment_can_be_replayed_against_clock_intent'], reason:'All language unit modules; the full language suite and final delta integration targets are separate retained evidence'},
      {...step, id:'rust:snapback4-lang-security-integration', argv:[...prefix,'--test','guide','--test','security_wave16','--test','security_sec10','--test','release_bridge_security','--','--test-threads=4'], reason:'Guide, typed unique witness reach, security contracts and rollback policy'},
    ];
  }
  if (step.id !== 'rust:snapback4') return [step];
  const prefix = ['cargo','test','--no-fail-fast','-p','snapback4','--features','snapback4-core/test-support'];
  return [
    { ...step, argv: [...prefix,'--bin','snapback4','verbs::security','--','--test-threads=4'],
      reason: 'SEC12 witness and decision unit modules, including security_reviews' },
    { ...step, id: 'rust:snapback4-security-integration', argv: [...prefix,
      '--test','dx11','--test','dx11_refusals','--test','dx13','--test','security_reviews',
      '--test','security_wave19','--test','roll_views','--','--test-threads=4'], reason: 'Affected security and default-verdict integration targets' },
  ];
});
const client = plan.steps.find(step => step.id === 'client-tests');
if (client) steps.push({ ...client, argv: ['node','scripts/run-client-tests.mjs','3','files',...files] });
const scoped = { ...plan, steps, rustPackages: ['snapback4','snapback4-lang'], clientFiles: files.map(f => 'snapback4/' + f),
  sec12Override: { reason: 'Explicit workstream prohibition on the full five-crate suite and full client pool',
    canonicalComplete: false, legacyRootChecks: 'Root generated/guide/inventories are Snapback1 checks outside the Snapback4 fence; product guides are covered by language tests, guide clients and packaged-doc lint', cliTargets: ['unit verbs::security*','dx11','dx11_refusals','dx13','security_reviews','security_wave19','roll_views'], cliExcluded: 'Other CLI modules/integration targets, including unrelated 6,929-row residency calibration; interrupted earlier broad run retained separately', omitted: plan.steps.filter(step => !allowed.has(step.id)).map(step => step.id),
    languageComposition: 'The full language suite runs separately on frozen S1/S3 witness inputs; final units and targeted language/CLI integrations cover later release-only deltas. The unchanged 15-second clock case runs separately without increasing its bound.', differentialRuns: 'Direct 2k run-lean and run receipts are recorded separately' } };
writeFileSync(originalPath + '.scoped.json', JSON.stringify(scoped, null, 2));
const { receipt } = await runPlan(scoped);
writeFileSync(originalPath + '.receipt.json', JSON.stringify(receipt, null, 2));
process.exitCode = receipt.ok ? 0 : 1;
