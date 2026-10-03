// Recheck the preserved builder rewrites against this lane's generated bindings.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'../..');
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
for(const pilot of ['g47','cal29']) {
 const dir=join(import.meta.dirname,'pilots',pilot,'after');
 const checked=spawnSync(binary,['check'],{cwd:dir,encoding:'utf8'});
 writeFileSync(join(import.meta.dirname,`pilot-${pilot}-check.log`),checked.stdout+checked.stderr);
 if(checked.status!==0)throw Error(pilot+' schema check failed');
 const generated=join(dir,'snapback/generated/api.ts');
 let specimen=join(dir,'src/useReceipts.ts');
 if(pilot==='cal29') {
  const lines=readFileSync(join(dir,'src/chat.tsx'),'utf8').split('\n');
  specimen=join(dir,'receipt-specimen.ts');
  writeFileSync(specimen,`import {usePage,useSeen} from 'snapback4/react';
import {api} from './snapback/generated/api';
declare const id:string,foreground:boolean,routeFocused:boolean;
declare const viewport:{y:number,height:number},bounds:Record<string,{y:number,height:number}>;
const page=usePage(api.history,{conversation:id});
${lines.filter(x=>x.startsWith(' const newest=')||x.startsWith(' useSeen(')).join('\n')}
// @ts-expect-error generated seen arguments remain typed
api.receiptFamilies.chat.seen.args = {scope:3};
`);
 }
 const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  strict:true,noEmit:true,skipLibCheck:true,allowImportingTsExtensions:true,jsx:ts.JsxEmit.ReactJSX,
  baseUrl:root,paths:{'snapback4/*':['packages/snapback4/dist/*']},typeRoots:[join(root,'node_modules/@types')]};
 const program=ts.createProgram([generated,specimen],options);
 const errors=ts.getPreEmitDiagnostics(program);
 if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 const app=join(dir,'src',pilot==='g47'?'ConversationView.tsx':'chat.tsx');
 const parsed=ts.transpileModule(readFileSync(app,'utf8'),{compilerOptions:options,reportDiagnostics:true});
 if(parsed.diagnostics?.length)throw Error('pilot source did not parse');
 console.log(`${pilot}: schema check, generated API + receipt specimen strict typecheck, full edited client syntax: PASS`);
}
console.log('Pilot scope: receipt integration and visibility wiring; no full app or native-runtime qualification claimed.');
