// @ref LLP 3000.011.003.000.000#14-wave-15-saved-deployments-and-case-evidence-day5 — run the actual installed guide recipe and emitted scaffolds.
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runToolchainCommand} from './publication-starters.mjs';
export const day5Consumer=String.raw`
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {cli,command,testSource} from 'snapback4/proof';
const cwd=join(process.cwd(),'day5-app');mkdirSync(join(cwd,'snapback'),{recursive:true});
const source="use identity guests\nuse personas alice\nquery alive():\n  return true\n";
writeFileSync(join(cwd,'snapback/schema.q'),source);
mkdirSync(join(cwd,'fixtures'));writeFileSync(join(cwd,'fixtures/test.cases.jsonl'),'{"op":"alive","as":"alice","data":true}\n');
const run=async args=>{const r=await cli(args,{cwd});assert.equal(r.code,0,r.stdout+r.stderr);return r.stdout;};
const guide=await run(['guide','deploy','--section','Capture a saved version']);
const recipe=guide.match(/\x60\x60\x60sh\n([\s\S]*?)\x60\x60\x60/)[1];
const result=await command('sh',['-eu','-c',recipe],{cwd,env:{PATH:join(process.cwd(),'node_modules/.bin')+':'+process.env.PATH}});
assert.equal(result.code,0,result.stdout+result.stderr);
assert.equal(readFileSync(join(cwd,'versions/v1/schema.q'),'utf8'),source);
assert.equal(JSON.parse(readFileSync(join(cwd,'versions/v1/release.json'))).release,1);
assert.equal(readFileSync(join(cwd,'bridge/schema.q'),'utf8'),source);
assert.match(readFileSync(join(cwd,'bridge/ROLLBACK-CHECKLIST.md'),'utf8'),/release 1/);
assert.equal((await testSource('versions/v1',{cwd})).casesRun,1);
writeFileSync(join(cwd,'fixtures/test.cases.jsonl'),'');
assert.notEqual((await cli(['test','--fixture','fixtures'],{cwd})).code,0);
assert.equal((await cli(['test','--fixture','fixtures','--fixture-only'],{cwd})).code,0);
assert.notEqual((await cli(['test','--residency'],{cwd})).code,0);
assert.equal((await cli(['test','--residency','--fixture-only','--fixture','fixtures','--as','alice'],{cwd})).code,0);
for(const kind of ['web','expo']){
 const dir=join(cwd,kind);mkdirSync(join(dir,'snapback'),{recursive:true});writeFileSync(join(dir,'snapback/schema.q'),source);
 const init=await cli(['init','--'+kind],{cwd:dir});assert.equal(init.code,0,init.stdout+init.stderr);
 assert.equal(existsSync(join(dir,'scripts/frontend-proof.mjs')),false);
 assert.equal(existsSync(join(dir,'fixtures/todos.jsonl')),false);
 assert.doesNotMatch(readFileSync(join(dir,'README.md'),'utf8'),/npm run frontend:proof|# Todos/);
 const checked=await cli(['check'],{cwd:dir});assert.equal(checked.code,0,checked.stdout+checked.stderr);
}
// Execute the changed measurement recipes from the installed cards themselves.
const measurementEnv={PATH:join(process.cwd(),'node_modules/.bin')+':'+process.env.PATH};
const measurements=[];
async function measure(recipe,where=cwd){
 const shell=recipe.replaceAll('<principal>','alice').replaceAll('<directory>','fixtures').replaceAll('DIR','fixtures').replace(/\bdir\b/g,'fixtures').replace('[--as persona]','--as alice');
 const line=shell.startsWith('snapback4 ')?shell:'snapback4 '+shell;
 const r=await command('sh',['-eu','-c',line],{cwd:where,env:measurementEnv});assert.equal(r.code,0,line+'\n'+r.stdout+r.stderr);measurements.push(line);
}
for(const page of ['feeds','maintains','offline-interactions','testing','sync','EMPTY_READ']){
 const text=await run(page==='EMPTY_READ'?['why',page]:['guide',page]);
 const snippets=[...text.matchAll(/\x60((?:snapback4 )?test [^\x60\n]*--fixture-only[^\x60\n]*)\x60/g)].map(m=>m[1]);
 assert.ok(snippets.length,page+' missing measurement recipe');
 for(const recipe of snippets)await measure(recipe);
}
const chat=join(cwd,'chat-readme');mkdirSync(chat);
const chatInit=await cli(['init','--web','--template','chat'],{cwd:chat});assert.equal(chatInit.code,0,chatInit.stdout+chatInit.stderr);
mkdirSync(join(chat,'fixtures'),{recursive:true});
await measure(readFileSync(join(chat,'README.md'),'utf8').match(/\x60(snapback4 test --residency --fixture-only[^\x60]+)\x60/)[1],chat);
assert.ok(measurements.length>=8);
console.log('DAY5 installed guide recipe, immutable snapshot, bridge and schema-first starter custody passed');
`;
export async function proveDay5(cwd){
  writeFileSync(join(cwd,'day5.mjs'),day5Consumer);
  const env={...process.env};delete env.PORT_LO;delete env.PORT_HI;delete env.SNAPBACK4_BIN;
  await runToolchainCommand(process.execPath,['day5.mjs'],{cwd,env,timeout:300_000});
  return {status:'passed',directory:cwd,guideRecipe:'capture-release-and-bridge',starterCustody:['web','expo']};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){console.log(JSON.stringify(await proveDay5(process.argv[2]??process.cwd())));}
