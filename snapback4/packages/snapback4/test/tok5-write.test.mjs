import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refusalOf } from '../dist/client.js';
import { refusalOf as contractRefusal } from '../dist/contract.js';
import { refusalOf as reactRefusal } from '../dist/react.js';

test('Muse rerun: exclude sent then read why; pending reason and sent results retain their types', t => {
  const dir = mkdtempSync(fileURLToPath(new URL('../.tok5-types-', import.meta.url)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'app.ts');
  writeFileSync(source, `import {refusalOf, type Write, type Refusal} from '../dist/client.js';
import {sentResult, isFailed} from '../dist/contract.js';
declare const write: Write<{id:string}>;
if(write.state !== 'sent') { const why: Refusal | undefined = write.why; why?.message; }
const why: Refusal | undefined = write.why;
const found: Refusal | undefined = refusalOf(write);
if(write.state === 'pending') { const reason: string | undefined = write.reason; const absent: undefined = write.why; }
if(write.state === 'sent') { const absent: undefined = write.why; if(!write.replayed) { const id:string=write.result.id; } }
if(isFailed(write)) { const failed: Refusal = write.why; }
const result: {id:string}|undefined = sentResult(write);
const legacyPending: Write = {state:'pending',id:'p',reason:'E_OFFLINE'};
const fresh: Write<null> = {state:'sent',id:'f',seq:1,result:null};
const replay: Write = {state:'sent',id:'r',seq:1,replayed:true};
// @ts-expect-error pending status cannot claim a terminal refusal
const falseFailure: Write = {state:'pending',id:'p',why:{code:'x',family:'x',message:'x'}};
`);
  const program = ts.createProgram([source], {strict:true,exactOptionalPropertyTypes:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext});
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
});

test('refusalOf returns only failed refusal through each public entry', () => {
  const why={code:'E_RULE',family:'rule',message:'Not permitted'};
  for(const helper of [refusalOf,contractRefusal,reactRefusal]) {
    for(const value of [undefined,null,{state:'pending',id:'p',reason:'E_OFFLINE'},{state:'sent',id:'s',seq:1,result:null},{state:'sent',id:'r',seq:1,replayed:true}]) assert.equal(helper(value),undefined);
    assert.equal(helper({state:'failed',id:'f',why}),why);
  }
});
