// Keep the selector's fail-broad plan, execute the brief's affected-only scope.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const plan=planAffected({root,base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(new URL('../../../target/affected/',import.meta.url),{recursive:true});
writeFileSync(new URL('../../../target/affected/tok5-full-plan.json',import.meta.url),JSON.stringify(plan,null,2));
const steps=[];
const step=(id,cwd,argv,timeoutSeconds=10800)=>steps.push({id,cwd,argv,timeoutSeconds,requires:[],reason:'TOK5 affected scope; complete battery expressly excluded by brief'});
step('build-cli','snapback4',['cargo','build','--locked','-j','4','-p','snapback4']);
step('build-client','snapback4',['bun','run','--cwd','packages/snapback4','build']);
step('typecheck:snapback4','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']);
for(const [pkg,targets] of [['snapback4-lang',['guide','aggregate_copies','maintains','residency_notes','server_opt_in']],['snapback4-core',['lane_source']],['snapback4',['feed_bridge','scale']],['snapback4-device',['readauth']],['snapback4-sim',['clique']]]) {
 step(`rust:${pkg}:docs`,'snapback4',['cargo','test','--locked','-j','4','-p',pkg,...targets.flatMap(t=>['--test',t])]);
}
// All changed direct documentation consumers plus the public contract regressions.
const changed=execFileSync('git',['diff','--name-only','origin/main...HEAD'],{cwd:root,encoding:'utf8'})+'\n'+execFileSync('git',['diff','--name-only','HEAD'],{cwd:root,encoding:'utf8'});
const files=new Set(changed.split('\n').filter(p=>/^snapback4\/packages\/snapback4\/test\/[^/]+\.test\.mjs$/.test(p)));
for(const name of ['tok5-write','tok3-reading','packaged-docs','package-typecheck','wave11-guide-types','init-typecheck']) files.add(`snapback4/packages/snapback4/test/${name}.test.mjs`);
// Helper changes affect the signing/publication fixture consumers.
for(const name of readdirSync(new URL('../../packages/snapback4/test/',import.meta.url)).filter(n=>n.endsWith('.test.mjs'))) {
 const path=`snapback4/packages/snapback4/test/${name}`;
 if(readFileSync(new URL(`../../../${path}`,import.meta.url),'utf8').includes('helpers/publish-fixture.mjs'))files.add(path);
}
step('client-tests','snapback4',['node','scripts/run-client-tests.mjs','2','files',...[...files].sort().map(p=>p.replace(/^snapback4\//,''))]);
for(const id of ['docs-budget','packaged-docs','diagnostics','generated','guide','inventories','ref-check','selector-tests','chat-check','chat-typecheck','expo-typecheck']) {
 const selected=plan.steps.find(s=>s.id===id); if(selected)steps.push({...selected,requires:[]});
}
const scoped={...plan,steps,fullSelectorPlanExecuted:false,qualification:false,scopeReason:'Brief prohibits full crates/client/difftest battery for package-layout/type-only changes; full plan retained in tok5-full-plan.json'};
const {receipt}=await runPlan(scoped,{root});
process.exitCode=receipt.ok?0:1;
