// @ref LLP 3000.037.000#18-bounded-package-reference-and-wiring-lookups-tok6 — first-lookups carry the app's facts; packed Markdown is cheap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {getEncoding} from 'js-tiktoken';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'../../..'),bin=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const encoding=getEncoding('o200k_base');
const run=(cwd,args)=>{const p=spawnSync(bin,args,{cwd,encoding:'utf8',timeout:60000});assert.equal(p.status,0,p.stdout+p.stderr);assert.ok(Buffer.byteLength(p.stdout)<=8000,`${args}: byte budget`);return p.stdout;};
for(const name of ['cpap','trailer','talent'])test(`${name}: the first four wiring lookups contain current app calls and guards`,()=>{
 const cwd=mkdtempSync(join(root,'target/tok6-test-'));
 try{
  mkdirSync(join(cwd,'snapback'));symlinkSync(join(root,'node_modules'),join(cwd,'node_modules'),'dir');
  const schema=readFileSync(new URL(`fixtures/gen1/${name}.q`,import.meta.url),'utf8');
  writeFileSync(join(cwd,'snapback/schema.q'),schema);
  // No check/generated api is needed; an old/corrupt artifact must never win.
  mkdirSync(join(cwd,'snapback/generated'));writeFileSync(join(cwd,'snapback/generated/api.ts'),'/* obsolete app */');
  const expected=[...schema.matchAll(/^(query|mutation) (\w+)\(/gm)].map(m=>`${m[1]} ${m[2]}`);
  for(const module of ['client','react','auth','generated']){
   const text=run(cwd,['guide','api',module,'--repeat']);
   assert.match(text,/^# This app's client usage/);assert.doesNotMatch(text,/obsolete app/);
   for(const op of expected)assert.ok(text.includes(`## ${op}\n`),`${module} first lookup: ${op}`);
   assert.match(text,/Signup grants no role/);assert.match(text,/row\/field rules still apply/);
   if(module!=='auth'){
    assert.match(text,/Args: .*Result:/);assert.match(text,/possibly hidden\/absent; null/);
    assert.match(text,/pending is not committed/);assert.match(text,/Upload separately per column/);
   }
   const index=run(cwd,['guide','api',module,'--sections']);
   const n=[...index.matchAll(/^\s*(\d+)\. (?:query|mutation) /gm)][0]?.[1];
   assert.ok(n,`${module}: app section index`);
   const section=run(cwd,['guide','api',module,'--section',n,'--repeat']);
   assert.match(section,/## (?:query|mutation) /);assert.match(section,/Session:/);
   if(name==='cpap')assert.match(text,/DIRECTOR_ONLY/);
   console.log(name,module,Buffer.byteLength(text),encoding.encode(text).length);
  }
  const generic=run(cwd,['guide','api','client','--generic','--repeat']);assert.match(generic,/exact signature digest/);assert.doesNotMatch(generic,/## mutation /);
  // Literal compact call expressions must typecheck against the emitted app API.
  execFileSync(bin,['types'],{cwd});
  const text=run(cwd,['guide','api','generated','--repeat']);
  let i=0;
  const examples=[];
  for(const block of text.split('\n## ').slice(1)){
   const plain=block.match(/Plain: `([^`]+)`/),react=block.match(/React: `([^`]+)`/);
   if(!plain||!react)continue;
   const path=plain[1].match(/\((api(?:\["[^"]+"\])+), args\)/)[1];
   const paged=react[1].startsWith('usePage(');
   examples.push(`function example${i++}(args: ${paged?`Omit<ArgsOf<typeof ${path}>, 'c'>`:`ArgsOf<typeof ${path}>`}) { return ${react[1].split(' //')[0]}; }`);
   examples.push(`function example${i++}(args: ArgsOf<typeof ${path}>) { return ${plain[1]}; }`);
  }
  const source=join(cwd,'snapback/generated/examples.tsx');
  writeFileSync(source,"import {api} from './api';\nimport type {ArgsOf,Client} from 'snapback4/contract';\nimport {useQuery,usePage,useFollowing,useMutation,useAction} from 'snapback4/react';\ndeclare const client:Client;\n"+examples.join('\n'));
  const program=ts.createProgram([source],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,strict:true,noEmit:true,skipLibCheck:true,jsx:ts.JsxEmit.ReactJSX});
  const errors=ts.getPreEmitDiagnostics(program);assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>cwd,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
  assert.equal(i,expected.length*2);
  writeFileSync(join(cwd,'snapback/schema.q'),'query replacement():\n  return true\n');
  const fresh=run(cwd,['guide','api','generated','--repeat']);assert.match(fresh,/## query replacement/);assert.ok(!fresh.includes(`## ${expected[0]}\n`));
 }finally{rmSync(cwd,{recursive:true,force:true});}
});

test('whole-package Markdown listing and cats stay under 3000 tokens beyond README',()=>{
 const pkg=join(root,'packages/snapback4');
 const [pack]=JSON.parse(execFileSync('npm',['pack','--dry-run','--json'],{cwd:pkg,encoding:'utf8'}));
 const markdown=pack.files.filter(f=>f.path.endsWith('.md'));
 assert.deepEqual(markdown.map(f=>f.path),['README.md']);
 const listing=pack.files.map(f=>f.path).join('\n');
 const text=listing+'\n'+markdown.filter(f=>f.path!=='README.md').map(f=>readFileSync(join(pkg,f.path),'utf8')).join('\n');
 const tokens=encoding.encode(text).length;
 assert.ok(tokens<=3000,`${tokens}/3000 tokens`);
 console.log('all packed paths plus non-README Markdown:',tokens,'tokens');
});

test('every embedded manual page is reachable, bounded, and keeps executable fences whole',()=>{
 for(const topic of ['server','client','following','offline-uploads','changes']){
  const index=run(root,['guide','package-reference',topic,'--sections']);
  const numbers=[...index.matchAll(/^\s*(\d+)\. /gm)].map(m=>m[1]);assert.ok(numbers.length);
  for(const n of numbers){const page=run(root,['guide','package-reference',topic,'--section',n,'--repeat']);assert.equal((page.match(/^```/gm)??[]).length%2,0,`${topic} ${n}: fence`);assert.doesNotMatch(page,/Truncated: default budget/);}
 }
});

test('large app packets page to late operations; invalid/no project never returns stale app facts',()=>{
 const cwd=mkdtempSync(join(root,'target/tok6-test-'));
 try{
  mkdirSync(join(cwd,'snapback'));
  writeFileSync(join(cwd,'snapback/operations.q'),Array.from({length:80},(_,i)=>`query q${i}():\n  return ${i}\n`).join('\n'));
  const index=run(cwd,['guide','api','react','--sections','--repeat']);assert.match(index,/query operations.q79/);
  const selected=run(cwd,['guide','api','react','--section','operations.q79','--repeat']);assert.match(selected,/api\["operations"\]\["q79"\]/);assert.match(selected,/Result: `number`/);
  assert.ok(!readFileSync(new URL('../package.json',import.meta.url),'utf8').includes('reference",'));
  const generic=run(cwd,['guide','api','react','--generic','--full','--repeat']);assert.match(generic,/--section/);
  run(cwd,['guide','api','react','--generic','--section','usePage','--repeat']);
  writeFileSync(join(cwd,'snapback/operations.q'),'broken schema');
  assert.match(run(cwd,['guide','api','client','--repeat']),/App schema does not bind/);
  const bad=spawnSync(bin,['guide','api','generated'],{cwd,encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/repair the schema/);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
