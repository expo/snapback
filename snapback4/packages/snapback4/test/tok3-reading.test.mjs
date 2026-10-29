// Wave-34 section-hoppers and declaration searchers; generated and packed bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {getEncoding} from 'js-tiktoken';
const root=new URL('../../../',import.meta.url), dist=new URL('../dist/',import.meta.url);
const enc=getEncoding('o200k_base');
const card=name=>readFileSync(new URL(`crates/snapback4-lang/src/guide/${name}.md`,root),'utf8');

test('wave34 Codex 001 CPAP / 039 Boat and Muse 019 Child Talent / 018 Horse Trailer: one complete bounded recipe',()=>{
 assert.ok(Buffer.byteLength(card('start'))<=8000);
 const workflow=card('workflow');
 assert.ok(Buffer.byteLength(workflow)<=8000);
 assert.ok(workflow.includes('```quarry')&&workflow.includes('```js'));
 assert.ok(!/guide (?:staging|time|jobs|rules|production)\b/.test(workflow),'no feature-card tour after schema');
 assert.ok(readFileSync(new URL('packages/snapback4/README.md',root),'utf8').split('\n').length<12);
});
test('wave34 react.d.ts / proof-accounts.d.ts / contract.d.ts grep targets are in their generated digests',()=>{
 const targets={react:['usePage','useQuery','useMutation','useClient','useAuth','ReadState','PageHook','AssetState','useUpload','sentResult','useSignedInViewer','useQueryData','useQueryResult','useNow','useLink','useSaveAsset'],client:['observe','Observed','Signal','Session','Cursor','Ready','Read','Write','UploadOptions'],proof:['StagingAccount','SeedAccountsOptions','args?:','roles?:','ServeOptions','AdvanceOptions','startServe','snapshotAll']};
 for(const [module,names] of Object.entries(targets)){
  const text=readFileSync(new URL(`crates/snapback4-lang/src/guide/api_${module}.md`,root),'utf8');
  for(const name of names)assert.ok(text.includes(name),`${module}: ${name}`);
  assert.ok(enc.encode(text).length<1600,module);
 }
 const react=readFileSync(new URL('react.d.ts',dist),'utf8').split('\n').slice(0,100).join('\n');
 assert.ok(enc.encode(readFileSync(new URL('crates/snapback4-lang/src/guide/api_react.md',root),'utf8')).length<enc.encode(react).length,'digest replaces observed first-100-lines declaration lookup');
 for(const file of readdirSync(dist,{recursive:true}).filter(f=>f.endsWith('.d.ts'))){
  assert.match(readFileSync(new URL(file,dist),'utf8').split('\n')[0],/^\/\/ Day-one API signatures: snapback4 guide api (app|react|client|auth|proof|witness);/);
 }
});
