import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const helper=readFileSync(join(root,'../../crates/snapback4/src/verbs/init/starter/on-write.ts'),'utf8');
function compile(source) {
  const file=join(root,'__starter2_types.ts'),options={strict:true,exactOptionalPropertyTypes:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true};
  const host=ts.createCompilerHost(options),read=host.readFile.bind(host);
  host.readFile=p=>p===file?source:read(p);
  return ts.getPreEmitDiagnostics(ts.createProgram([file],options,host));
}
test('SDK-typed starter onWrite accepts the seven lane handler shapes and preserves nullable results',()=>{
  const calls=Array.from({length:7},(_,n)=>`declare const run${n}: () => ${n%2?'Promise<Write<Row | null>>':'MutationPromise<Row | null>'};\nconst result${n}: Promise<Write<Row | null> | undefined> = onWrite(run${n},setProblem);`).join('\n');
  const diagnostics=compile(`${helper}\nimport type { MutationPromise } from 'snapback4/client';
  type Row={id:string;price?:number;approvedAt:number|null;photo:{id:string}};
  declare const setProblem:(message:string)=>void;
  ${calls}
  declare const pending:Write<Row>;
  onWrite(()=>Promise.resolve(pending),setProblem);
  `);
  assert.deepEqual(diagnostics.map(d=>d.code),[],ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
});
test('lane-shaped handwritten refusal promises still fail with exact optional properties',()=>{
  const diagnostics=compile(`import type { Write } from 'snapback4/contract';
  declare const write:Promise<Write<{id:string}|null>>;
  const broken:Promise<{state:string;why?:{message:string}}> = write;`);
  assert.deepEqual(diagnostics.map(d=>d.code),[2322]);
});
test('starter handler reports refusal, pending and thrown failure without inventing a commit',async()=>{
  const {onWrite}=await import('data:text/javascript,'+encodeURIComponent(ts.transpile(helper.replace('"snapback4/contract"',JSON.stringify(new URL('../dist/contract.js',import.meta.url).href)),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext})));
  const problems=[],setProblem=s=>problems.push(s);
  for(const write of [{state:'pending',id:'x',reason:'offline'},{state:'sent',id:'x',result:null},{state:'failed',id:'x',why:{code:'DENIED',message:'No permission',family:'auth',site:'test'}}]) {
    assert.equal(await onWrite(()=>Promise.resolve(write),setProblem),write);
    assert.equal(problems.at(-1),write.state==='failed'?'No permission':'');
  }
  assert.equal(await onWrite(()=>{throw Error('transport')},setProblem),undefined);
  assert.match(problems.at(-1),/did not finish/);
});
