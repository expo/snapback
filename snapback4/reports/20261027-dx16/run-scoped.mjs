import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
process.env.SNAPBACK4_INIT_INSTALL='0';process.env.RUST_TEST_THREADS='1';process.env.CARGO_BUILD_JOBS='2';
const full=planAffected({base:'origin/main',worktree:false});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});writeFileSync(join(ROOT,'target/affected/dx16-full-plan.json'),JSON.stringify(full,null,2)+'\n');
const step=(id,cwd,argv,timeoutSeconds=1800)=>({id,cwd,argv,reason:'DX16 affected behavior; the brief forbids the selector-wide complete Rust/client battery',timeoutSeconds,requires:[]});
const plan={...full,scopeOverride:{fullSelectorPlanExecuted:false,qualification:false,reason:'Shared guide/core inputs expand the conservative selector across seven crates and 450 client files. Preserve that plan, then narrow under the explicit affected-scope brief. Packed Linux consumer qualification runs separately.',fullRustPackages:full.rustPackages,fullClientFiles:full.clientFiles.length,fullStepCount:full.steps.length,priorEvidence:'10 files/101 client tests passed in /tmp/dx16-client-scope.log. Proof runtime transpilation is unchanged since c6fd5e6638; CLI init/frozen behavior is separately rerun here and in packed DX16. No full battery, difftest, or publication claim.'},steps:[
 step('web-device-inputs','.', ['node','--input-type=module','-e',`import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';const changed=execFileSync('git',['diff','--name-only','c9c3a35461','HEAD','--','snapback4/crates/snapback4-core','snapback4/crates/snapback4-device'],{encoding:'utf8'}).trim().split('\\n').filter(Boolean);const allowed=['snapback4/crates/snapback4-core/src/store/inspect.rs','snapback4/crates/snapback4-core/src/store/inspect_merged.rs','snapback4/crates/snapback4-core/src/store/port/tooling.rs'];if(changed.some(p=>!allowed.includes(p)))throw Error('Web device semantic inputs changed: '+changed);if(!readFileSync('snapback4/crates/snapback4-core/src/lib.rs','utf8').includes('#[cfg(feature = "sqlite")]'+String.fromCharCode(10)+'pub mod store;'))throw Error('Store module no longer excluded from web');console.log('Reuse built web device: all core changes are inside sqlite-only store, excluded by --no-default-features --features web. No device source/version/schema changes.');`]),
 step('client-build-evidence','.', ['node','snapback4/reports/20261027-dx16/verify-client-build.mjs']),
 step('client-types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('guide','snapback4',['cargo','test','-p','snapback4-lang','--test','guide']),
 step('frozen-init-inspection-reading','snapback4',['cargo','test','-p','snapback4','--test','dx16','--test','dx15_inspection','--test','init','--test','tok1','--','--skip','w8b_residency_measures_the_wired_calibration_shape']),
 step('core-inspection','snapback4',['cargo','test','-p','snapback4-core','--lib','store::inspect::']),
 step('reading-history-and-digests','snapback4',['cargo','test','-p','snapback4','--bin','snapback4','guide_seen::']),
 step('template-digests','snapback4',['cargo','test','-p','snapback4','--bin','snapback4','proof::tests::']),
 step('client-runtime-evidence','snapback4',['node','reports/20261027-dx16/verify-reused-clients.mjs']),
 step('new-client-proofs','snapback4',['node','scripts/run-client-tests.mjs','1','files','packages/snapback4/test/dx16-proof.test.mjs','packages/snapback4/test/tok1-reading.test.mjs']),
 step('bounded-corpus-consumers','snapback4',['node','--test','--test-concurrency=1','--test-name-pattern=H9 additive|guide topic aliases|probe and deploy guide agree|guide and probe agree|published social starter|KIT4 literal|packaged browser image|cleanup:|active-reference:|first check recovers older versions|runtime history','packages/snapback4/test/wave13-previews.test.mjs','packages/snapback4/test/wave13-surface.test.mjs','packages/snapback4/test/wave11-narration.test.mjs','packages/snapback4/test/wave12-clauses.test.mjs','packages/snapback4/test/social-starter.test.mjs','packages/snapback4/test/wire-first.test.mjs','packages/snapback4/test/wave11-guide-types.test.mjs','packages/snapback4/test/lang4-guide.test.mjs','packages/snapback4/test/wave11-upgrade-history.test.mjs']),
 step('docs-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import{lintPackagedDocs}from'./scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('api-digest','snapback4',['node','packages/snapback4/scripts/guide-api.mjs','--check']),
 step('proof-reference','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('root-check-evidence','.', ['node','snapback4/reports/20261027-dx16/verify-root-checks.mjs']),
 step('verb-help','snapback4',['node','scripts/check-verb-help.mjs','target/debug/snapback4']),
 step('refs','.', ['./ref-check']),
]};
const{receiptPath,receipt}=await runPlan(plan);console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false,qualification:false}));if(!receipt.ok)process.exitCode=1;
