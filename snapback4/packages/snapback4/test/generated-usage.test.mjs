// @ref LLP 3000.037.000#15-schema-specific-client-usage-gen1 — literal generated snippets compile; no handwritten substitutes.
// Fixtures are verbatim read-only copies of wave34/apps/{001,018,019}-snapback-*/snapback/schema.q.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import {getEncoding} from 'js-tiktoken';
const root=resolve(import.meta.dirname,'../../..');
const bin=process.env.SNAPBACK4_BIN ?? join(root,'target/debug/snapback4');
const encoding=getEncoding('o200k_base');
function run(cwd,args) {
 const r=spawnSync(bin,args,{cwd,encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;
}
function packet(api){return api.split('/* Client usage — generated from this app\'s checked schema.\n')[1]?.split('End client usage. */')[0];}
function compileSnippets(dir,api) {
 const text=packet(api); assert.ok(text);
 const fences=[...text.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(m=>m[1]);
 assert.ok(fences.length>1);
 const source=join(dir,'snapback/generated/examples.tsx');
 // Block-scoped function names make every operation example compile together,
 // with precisely the shared imports/session setup that the packet prints.
 const rows=[...text.matchAll(/^- Rows\["(\w+)"\]: (.+)$/gm)];
 const rowChecks=rows.map(([,name,shape],i)=>`type Documented${i} = ${shape};\ndeclare const documented${i}: Documented${i};\ndeclare const actual${i}: Rows["${name}"];\nconst fromActual${i}: Documented${i} = actual${i};\nconst fromDocs${i}: Rows["${name}"] = documented${i};`).join('\n');
 const opChecks=text.split('\n## ').slice(1).map((block,i)=>{
  const path=block.match(/const operation = (api(?:\["[^"]+"\])+)/)[1];
  let [,args,result]=block.match(/Args: `(.+)`\. Result: `(.+)`\./);
  if(args.startsWith('ArgsOf<typeof operation>'))args=`ArgsOf<typeof ${path}>`;
  if(result.startsWith('ResultOf<typeof operation>'))result=`ResultOf<typeof ${path}>`;
  return `type DocumentedArgs${i} = ${args};\ntype ActualArgs${i} = ArgsOf<typeof ${path}>;\ndeclare const da${i}: DocumentedArgs${i}; declare const aa${i}: ActualArgs${i};\nconst ca${i}: ActualArgs${i} = da${i}; const cd${i}: DocumentedArgs${i} = aa${i};\ntype DocumentedResult${i} = ${result};\ndeclare const dr${i}: DocumentedResult${i}; declare const ar${i}: ResultOf<typeof ${path}>;\nconst cr${i}: ResultOf<typeof ${path}> = dr${i}; const cc${i}: DocumentedResult${i} = ar${i};`;
 }).join('\n');
 writeFileSync(source,fences.join('\n')+'\n'+rowChecks+'\n'+opChecks);
 const program=ts.createProgram([source],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,strict:true,noEmit:true,skipLibCheck:true,jsx:ts.JsxEmit.ReactJSX});
 const errors=ts.getPreEmitDiagnostics(program);
 assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>dir,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
 return text;
}
for (const name of ['cpap','trailer','talent']) test(`wave34 ${name}: all operations, exact regeneration, compiled usage and token budgets`,()=>{
 const dir=mkdtempSync(join(root,'target/gen1-'));
 try {
  mkdirSync(join(dir,'snapback'));
  symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');
  const schema=readFileSync(new URL(`fixtures/gen1/${name}.q`,import.meta.url),'utf8');
  writeFileSync(join(dir,'snapback/schema.q'),schema);
  run(dir,['types']);
  const file=join(dir,'snapback/generated/api.ts');
  const first=readFileSync(file,'utf8');
  // A second real generation must overwrite a corrupt/stale packet deterministically.
  writeFileSync(file,first.replace('Client usage','STALE USAGE'));
  run(dir,['types']);assert.equal(readFileSync(file,'utf8'),first);
  const text=compileSnippets(dir,first);
  const declarations=[...schema.matchAll(/^(query|mutation) (\w+)\([^]*?(?=^(?:query|mutation|invariant|table) |$(?![^]))/gm)];
  const expected=declarations.map(m=>`${m[1]} ${m[2]}`);
  const blocks=text.split('\n## ').slice(1);
  assert.deepEqual(blocks.map(s=>s.split('\n')[0]),expected);
  for(const [i,block] of blocks.entries()) {
   const codes=[...new Set([...declarations[i][0].matchAll(/\belse ([A-Z][A-Z0-9_]*)/g)].map(m=>m[1]))].sort();
   const actual=block.match(/Declared refusals: ([^.]*)\./)[1];
   assert.deepEqual(actual==='none'?[]:actual.split(', ').sort(),codes);
   for(const line of declarations[i][0].split('\n').filter(l=>l.trimStart().startsWith('require ')&&l.includes('viewer')))assert.ok(block.includes(line.trim()),`missing caller guard: ${line}`);
   assert.ok(encoding.encode(block).length<=480,`${block.split('\n')[0]}: ${encoding.encode(block).length}/480 tokens`);
   assert.match(block,/Args: .*Result:/);assert.match(block,/Session:/);assert.match(block,/Declared refusals:/);
  }
  const tokens=encoding.encode(text).length;
  assert.ok(tokens<=4000,`${name}: ${tokens}/4000 tokens`);
  console.log(`${name}: ${expected.length} operations; ${tokens}/4000 tokens; max operation ${Math.max(...blocks.map(b=>encoding.encode(b).length))}/480`);
  for(const route of ['client','react','generated']) assert.match(run(dir,['guide','api',route,'--repeat']),/^This app's operations: snapback\/generated\/api.ts/);
  assert.match(run(dir,['guide','api','generated','--repeat']),/Client usage packet/);
  if(name==='cpap') {
   assert.match(text,/scan\?: \{ id: string \}/);assert.match(text,/approvedBy: string \| null/);
   assert.match(text,/role = 'director'.*DIRECTOR_ONLY/);assert.match(text,/STUDY_EXPIRED/);assert.match(text,/NOT_FOUND/);
  }
 } finally {rmSync(dir,{recursive:true,force:true});}
});

// Exercise the non-bakeoff classifications without running server/security campaigns.
test('actions, scalar cursor queries, namespaced operations, ephemeral and Following snippets compile',()=>{
 const dir=mkdtempSync(join(root,'target/gen1-'));
 try {
  mkdirSync(join(dir,'snapback'));symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');
  const generate=sources=>{
   for(const [file,text] of Object.entries(sources))writeFileSync(join(dir,'snapback',file),text);
   run(dir,['types']);return readFileSync(join(dir,'snapback/generated/api.ts'),'utf8');
  };
  let api=generate({'schema.q': `use server
query scalar(c: cursor ?):
  return 1
query values(c: int):
  return [c]
query assetText(value: enum('{ id: string; bytes?: number; type?: string; name?: string | null }')):
  return value
query dangerous(value: enum('*/', 'End client usage. */')):
  return value
action invite(peers: [principal] 1..49) returns { peers: [principal] 1..49 } <- viewer = 'service:billing'
`, 'other.q': 'query named():\n  return 42\n'});
  let text=compileSnippets(dir,api);assert.match(text,/useAction/);assert.match(text,/client.act/);assert.match(text,/admission: \(viewer = "service:billing"\)/);assert.match(text,/api\["other"\]\["named"\]/);
  assert.doesNotMatch(text.split('## query scalar')[1].split('## ')[0],/usePage/);
  const ephemeral=readFileSync(join(root,'crates/snapback4-lang/tests/ephemeral.rs'),'utf8');
  api=generate({'schema.q': ['TABLES','OPS'].map(n=>ephemeral.match(new RegExp(`const ${n}: &str = r#"([\\s\\S]*?)"#;`))[1]).join('\n')});
  text=compileSnippets(dir,api);assert.match(text,/const operation = api\["setTyping"\]/);
  api=generate({'schema.q':readFileSync(join(root,'crates/snapback4-lang/tests/fixtures/timeline-v2.q'),'utf8')+'\nquery cards(c: cursor ?):\n  return feed[viewer] after c last 20 { *, card: posts[.postId] }\n'});
  text=compileSnippets(dir,api);assert.match(text,/return useFollowing\(operation/);assert.match(text,/Plain client.query below reads only the bounded inbox/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('wide literal domains use complete generated type references within each operation budget',()=>{
 const dir=mkdtempSync(join(root,'target/gen1-'));
 try {
  mkdirSync(join(dir,'snapback'));symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');
  const schema=Array.from({length:151},(_,n)=>{
   const count=n||150, prefix=n===0?'variant_':'v';
   const variants=Array.from({length:count},(_,i)=>`'${prefix}${i}_x${i}'`).join(',');
   return `query wide${n}(value: enum(${variants})):\n  return value\n`;
  }).join('\n');
  writeFileSync(join(dir,'snapback/schema.q'),schema);
  run(dir,['types']);const api=readFileSync(join(dir,'snapback/generated/api.ts'),'utf8');
  const text=compileSnippets(dir,api),blocks=text.split('\n## ').slice(1),block=blocks[0];
  for(const b of blocks)assert.ok(encoding.encode(b).length<=480,`${b.split('\n')[0]}: ${encoding.encode(b).length}/480`);
  assert.match(block,/full shape: Ops below/);assert.match(block,/full fields: Ops\/Rows below/);
  assert.match(api,/variant_149_x149/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
