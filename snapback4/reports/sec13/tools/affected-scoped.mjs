#!/usr/bin/env node
// The SEC13 brief prohibits the full Rust/client pools selected by docs edges.
// Retain the original plan and disclose every omitted step; never call this a
// completed canonical selector receipt. Integration owns the remaining pool.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
  if (step.id !== 'rust:snapback4') return [step];
  const prefix = ['cargo','test','--no-fail-fast','-p','snapback4','--features','snapback4-core/test-support'];
  return [
    { ...step, argv: [...prefix,'--bin','snapback4','verbs::security','--','--test-threads=4'],
      reason: 'SEC13 witness and decision unit modules, including security_reviews' },
    { ...step, id: 'rust:snapback4-security-integration', argv: [...prefix,
      '--test','dx11','--test','dx11_refusals','--test','dx13','--test','security_reviews',
      '--test','security_wave19','--','--test-threads=1'], reason: 'Affected security and default-verdict integration targets' },
  ];
});
const client = plan.steps.find(step => step.id === 'client-tests');
if (client) steps.push({ ...client, argv: ['node','scripts/run-client-tests.mjs','3','files',...files] });
const scoped = { ...plan, steps, rustPackages: ['snapback4','snapback4-lang'], clientFiles: files.map(f => 'snapback4/' + f),
  sec13Override: { reason: 'Explicit workstream prohibition on the full five-crate suite and full client pool',
    canonicalComplete: false, legacyRootChecks: 'Root generated/guide/inventories are Snapback1 checks outside the Snapback4 fence; product guides are covered by language tests, guide clients and packaged-doc lint', cliTargets: ['unit verbs::security*','dx11','dx11_refusals','dx13','security_reviews','security_wave19'], cliExcluded: 'Other CLI modules/integration targets, including unrelated 6,929-row residency calibration; interrupted earlier broad run retained separately', omitted: plan.steps.filter(step => !allowed.has(step.id)).map(step => step.id),
    differentialRuns: 'No interpreter/planner/store execution semantics changed; security inference and the partial concrete evaluator are covered by focused and full language tests' } };
writeFileSync(originalPath + '.scoped.json', JSON.stringify(scoped, null, 2));
if (process.argv.includes('--presentation-only')) {
  const allowedDelta = new Set([
    'snapback4/crates/snapback4/src/verbs/security_reviews/decisions.rs',
    'snapback4/crates/snapback4-lang/src/diag.rs', 'snapback4/crates/snapback4-lang/src/guide/security.md',
    'snapback4/crates/snapback4-lang/tests/guide/definitions.rs', 'snapback4/crates/snapback4-lang/tests/guide/refusal_actions.rs',
    'snapback4/packages/snapback4/test/security-packed.test.mjs',
  ]);
  const delta=execFileSync('git',['diff','--name-only','8dbe6d517c','HEAD','--','snapback4/crates','snapback4/packages'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  if (delta.some(path=>!allowedDelta.has(path))) throw new Error('semantic inputs changed since SEC13 semantic qualification; full scope required');
  scoped.steps=scoped.steps.flatMap(step=>{
    if(step.id==='rust:snapback4') return [{...step,argv:['cargo','test','--no-fail-fast','-p','snapback4','--bin','snapback4','verbs::security_reviews','--','--test-threads=4']}];
    if(step.id==='rust:snapback4-lang') return [
      {...step,id:'rust:snapback4-lang-guide',argv:['cargo','test','-p','snapback4-lang','--test','guide']},
      {...step,id:'rust:snapback4-lang-sec13',argv:['cargo','test','-p','snapback4-lang','--test','security_sec13']},
      {...step,id:'rust:snapback4-lang-boundaries',argv:['cargo','test','-p','snapback4-lang','--lib','sec13']},
    ];
    return [step];
  });
  scoped.sec13Override.composition={semanticSnapshot:'8dbe6d517c',mode:'presentation/recovery-only delta',checkedDelta:delta,fullLanguageAndSecurityResults:'retained semantic qualification plus the explicit guide retry; not a canonical full selector PASS'};
  writeFileSync(originalPath + '.scoped.json', JSON.stringify(scoped,null,2));
}
const { receipt } = await runPlan(scoped);
writeFileSync(originalPath + '.receipt.json', JSON.stringify(receipt, null, 2));
process.exitCode = receipt.ok ? 0 : 1;
