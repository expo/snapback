// DX13 task scope; the brief prohibits the complete crate/client batteries.
// Retain affected.mjs's complete selection and execute a disclosed subset through
// its own timeout/input-digest/receipt machinery. This cannot qualify publication.
import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const full=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
const folder=join(ROOT,'target/affected');mkdirSync(folder,{recursive:true});
const fullPath=join(folder,`dx13-full-plan-${full.head.slice(0,12)}.json`);writeFileSync(fullPath,JSON.stringify(full,null,2)+'\n');
const step=(id,cwd,argv,timeoutSeconds=1800,requires=[])=>({id,cwd,argv,timeoutSeconds,requires,reason:'DX13 touched-code verification; complete crate/client batteries excluded by brief'});
const names=['proof-contract','proof','proof-fixtures','wave10-witness','dx10-process-accounts','dx12-serve','dx13-proof','staging','day3-proofs','day4-proofs','day5-proofs','production-starters','dx9-packed','delivery-integrated'];
const files=names.map(name=>'packages/snapback4/test/'+name+'.test.mjs');
const steps=[
 step('install-client','snapback4',['bun','install','--frozen-lockfile']),
 step('build-cli','snapback4',['cargo','build','-p','snapback4']),
 step('build-wasm','snapback4',['bash','scripts/build-wasm.sh'],1800,['install-client']),
 step('build-client','snapback4',['bun','run','--cwd','packages/snapback4','build'],1800,['build-wasm']),
 step('types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck'],1800,['build-client']),
 step('cli-unit','snapback4',['cargo','test','-p','snapback4','--features','snapback4-core/test-support','--bin','snapback4','--','--test-threads=1'],3600),
 step('cli-output','snapback4',['cargo','test','--no-fail-fast','-p','snapback4','--features','snapback4-core/test-support',...['dx11','dx11_refusals','dx12_output','dx13','surf4','security_reviews'].flatMap(name=>['--test',name]),'--','--test-threads=2'],3600),
 step('core','snapback4',['cargo','test','--no-fail-fast','-p','snapback4-core','--features','test-support','--','--test-threads=4'],5400),
 step('language','snapback4',['cargo','test','--no-fail-fast','-p','snapback4-lang','--','--test-threads=4'],5400),
 step('clients','snapback4',['node','scripts/run-client-tests.mjs','6','files',...files],3600,['build-cli','build-client']),
 step('doc-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import {lintPackagedDocs} from './scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('proof-api','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('diagnostics','.', ['node','scripts/generate-diagnostics-registry.mjs','--check']),
 step('inventories','.', ['node','scripts/check-inventories.mjs']),
 step('generated','.', ['bash','scripts/check-generated-artifacts']),
 step('root-guide','.', ['node','scripts/check-guide.mjs']),
 step('refs','.', ['./ref-check']),
 step('wasm-measurement','snapback4',['bash','scripts/measure-wasm.sh','--no-record'],1800,['build-wasm']),
 ...['run-lean','run'].map(mode=>step('difftest:'+mode,'snapback4',['cargo','run','--release','-p','snapback4-difftest','--',mode,'--seed','0','--cases','2000','--workers','2','--out','target/affected/dx13-'+mode],5400)),
];
const excerptOnly=process.argv.includes('--excerpt-only');
const finalDelta=process.argv.includes('--final-delta')||excerptOnly;
const priorPath=join(folder,excerptOnly?'60bb235bc658-1792999045615.json':'199df9644300-1792993157113.json');
const prior=finalDelta?JSON.parse(readFileSync(priorPath,'utf8')):null;
if(prior&&(!prior.complete||!prior.unchanged||!prior.head.startsWith(excerptOnly?'60bb235bc658':'199df9644300')))throw Error('DX13 parent receipt must be complete and unchanged');
const finalFiles=['wave10-witness','proof-contract','dx9-packed'].map(name=>'packages/snapback4/test/'+name+'.test.mjs');
const finalSteps=finalDelta?[
 ...steps.filter(s=>['build-cli','cli-unit'].includes(s.id)),
 {...steps.find(s=>s.id==='cli-output'),argv:['cargo','test','--no-fail-fast','-p','snapback4','--features','snapback4-core/test-support',...['dx11','dx11_refusals','dx12_output','dx13','surf4','security_reviews','security_wave19'].flatMap(name=>['--test',name]),'--','--test-threads=2']},
 step('language-followup','snapback4',['cargo','test','--no-fail-fast','-p','snapback4-lang','--test','guide','--test','wave26_security','--','--test-threads=4'],3600),
 step('clients-followup','snapback4',['node','scripts/run-client-tests.mjs','3','files',...finalFiles],1800,['build-cli']),
 ...steps.filter(s=>['doc-budget','packaged-docs','proof-api','diagnostics','inventories','generated','root-guide','refs'].includes(s.id)),
]:steps;
const excerptSteps=[
 steps.find(s=>s.id==='build-cli'),
 step('cli-excerpts','snapback4',['cargo','test','-p','snapback4','--features','snapback4-core/test-support','--bin','snapback4','doctor_tests::w11_check_renderer_has_a_dedicated_excerpt_for_every_registered_code','--','--test-threads=1']),
 step('guide-excerpts','snapback4',['cargo','test','-p','snapback4-lang','--test','guide','--','--test-threads=4']),
 ...steps.filter(s=>['doc-budget','packaged-docs','proof-api','diagnostics','inventories','generated','root-guide','refs'].includes(s.id)),
];
const scoped={...full,rustPackages:finalDelta?['snapback4','snapback4-lang']:['snapback4','snapback4-core','snapback4-lang'],clientFiles:(excerptOnly?[]:finalDelta?finalFiles:files).map(file=>'snapback4/'+file),steps:excerptOnly?excerptSteps:finalSteps,
 fullSelectorPlanExecuted:false,qualification:false,
 scopeOverride:{reason:excerptOnly?'Catalogue excerpt follow-up only: explicit diagnostic navigation, code-prefixed prose and independent definition/recovery pins. The preceding complete unchanged receipt remains raw FAIL; its runtime, default-authority, client, verdict and documentation evidence is retained. Rerun the dedicated CLI excerpt test, full language guide and required documentation checks; no engine, binder, kit, starter or default-verdict semantic inputs changed. This is not a complete selector pass.':finalDelta?'Final delta: deploy rendering, diagnostic prose, generated API table and superseded test expectations only. Core/engine and non-guide language semantics are byte-unchanged from the complete parent receipt; retain that raw FAIL, its passed core/other language/eleven client files/wasm/plain 2k evidence, and its byte-identical inherited Lean findings. Rerun changed CLI output, guide/wave26 targets, three failed client files and documentation checks. This is not a complete selector pass.':'As in DX12: honor the brief prohibition on the complete five-crate battery and complete client pool. Three touched crates, direct proof/packed-consumer clients, root documentation checks and the two required 2k semantic campaigns are executed. The full CLI integrations additionally ran before this bounded receipt; its census failure is inherited and ticketed.',priorReceipt:prior?{path:priorPath,head:prior.head,inputDigest:prior.inputDigest,complete:prior.complete,unchanged:prior.unchanged,ok:prior.ok}:null,fullPlanPath:fullPath,fullRustPackages:full.rustPackages,fullClientFiles:full.clientFiles.length,fullStepCount:full.steps.length}};
const {receiptPath,receipt}=await runPlan(scoped);console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false,qualification:false}));if(!receipt.ok)process.exitCode=1;
