#!/usr/bin/env node
// The brief explicitly excludes full Rust/client pools. Preserve the canonical
// selector plan and every omission; this is an affected scoped receipt.
import { writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {planAffected,runPlan}=await import(pathToFileURL(resolve('snapback4/scripts/affected.mjs')));
const prefix=process.argv[2];if(!prefix)throw Error('output prefix required');
const original=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
writeFileSync(prefix+'.original.json',JSON.stringify(original,null,2));
const allowed=new Set(['install-client','build-cli','build-wasm','build-client','typecheck:snapback4','rust:snapback4','rust:snapback4-core','rust:snapback4-lang','diagnostics','docs-budget','packaged-docs','ref-check','selector-tests']);
const files=['dx9-packed','sec10-packed','security-packed','write-authority','wave11-guide-types','lang4-guide'].map(n=>`packages/snapback4/test/${n}.test.mjs`);
const languageTargets=readdirSync('snapback4/crates/snapback4-lang/tests').filter(n=>/^security.*\.rs$/.test(n)).map(n=>n.slice(0,-3));
const steps=original.steps.filter(s=>allowed.has(s.id)).flatMap(s=>{
 if(s.id==='rust:snapback4'){
  const cargo=['cargo','test','--no-fail-fast','-p','snapback4','--features','snapback4-core/test-support'];
  return [{...s,argv:[...cargo,'--bin','snapback4','verbs::security','--','--test-threads=4']},
   {...s,id:'rust:snapback4-security-cli',argv:[...cargo,...['dx11','dx11_refusals','dx13','security_reviews','security_wave19'].flatMap(n=>['--test',n]),'--','--test-threads=1']}];
 }
 if(s.id==='rust:snapback4-core')return[{...s,argv:['cargo','test','--no-fail-fast','-p','snapback4-core','--features','test-support','--lib','--test','ephemeral','--test','asset_lists','--test','file_assets','--','--test-threads=4']}];
 if(s.id==='rust:snapback4-lang')return[{...s,argv:['cargo','test','--no-fail-fast','-p','snapback4-lang','--lib',...['guide',...languageTargets].flatMap(n=>['--test',n]),'--','--test-threads=4']}];
 return[s];
});
const client=original.steps.find(s=>s.id==='client-tests');if(client)steps.push({...client,argv:['node','scripts/run-client-tests.mjs','3','files',...files]});
const plan={...original,steps,rustPackages:['snapback4','snapback4-core','snapback4-lang'],clientFiles:files,
 sec11lOverride:{canonicalComplete:false,reason:'Explicit SEC11L prohibition on the full five-crate suite/full client pool; fixture construction and campaign scheduling only, no interpreter/planner/store-format semantics.',
 omitted:original.steps.filter(s=>!allowed.has(s.id)).map(s=>s.id),languageTargets,cliTargets:['unit verbs::security*','dx11','dx11_refusals','dx13','security_reviews','security_wave19'],coreTargets:['lib','ephemeral','asset_lists','file_assets'],legacyRoot:'Snapback1 generated/guide/inventories outside Snapback4 fence; Snapback4 guide and docs checks retained.'}};
writeFileSync(prefix+'.scoped.json',JSON.stringify(plan,null,2));
const {receipt}=await runPlan(plan);writeFileSync(prefix+'.receipt.json',JSON.stringify(receipt,null,2));process.exitCode=receipt.ok?0:1;
