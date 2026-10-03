// Frozen actual Cal29 edits; count physical source, never prettified LOC.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'../..'),base=join(import.meta.dirname,'pilot');
const before=readFileSync(join(base,'before/chat.tsx'),'utf8'),after=readFileSync(join(base,'after/chat.tsx'),'utf8');
const line=(source,predicate)=>{const rows=source.split('\n'),index=rows.findIndex(predicate);if(index<0)throw Error('missing specimen');return {text:rows[index],line:index+1};};
const count=text=>({physicalLines:text.split('\n').length,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')});
const specimens={
 L1:[line(before,l=>l.startsWith(' const historyKeys=')),line(after,l=>l.startsWith(' const [start,Start]'))],
 L2:[line(before,l=>l.startsWith('function StableMessage')),line(after,l=>l.startsWith('function StableMessage'))],
 L3:[line(before,l=>l.startsWith(' useEffect(()=>{const sub=AppState')),line(after,l=>l.startsWith(' useEffect(()=>()=>'))],
};
const result={method:'UTF-8 bytes excluding final newline; physical source lines; selected blocks overlap the whole-file totals. L3 selected replacement is cleanup only; all visibility/routing/owner overhead is charged below.',specimens:{},files:{}};
for(const [id,[a,b]] of Object.entries(specimens))result.specimens[id]={before:{line:a.line,...count(a.text)},after:{line:b.line,...count(b.text)}};
for(const [name,text] of [['before/chat.tsx',before],['after/chat.tsx',after],...['PageLifetime.ts','useForeground.ts'].map(name=>['after/'+name,readFileSync(join(base,'after',name),'utf8')])])result.files[name]=count(text.replace(/\n$/,''));
writeFileSync(join(import.meta.dirname,'measurements.json'),JSON.stringify(result,null,2)+'\n');
for(const [id,value] of Object.entries(result.specimens))console.log(`${id}: ${value.before.physicalLines} lines / ${value.before.bytes} B -> ${value.after.physicalLines} lines / ${value.after.bytes} B`);
for(const [name,value] of Object.entries(result.files))console.log(`${name}: ${value.physicalLines} lines / ${value.bytes} B`);
const schema=join(base,'after/snapback');mkdirSync(schema,{recursive:true});
for(const name of ['schema.q','windows.q'])copyFileSync(join(root,'reports/20261003-r-receipt-binding/pilots/cal29/before/snapback',name),join(schema,name));
const checked=spawnSync(process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4'),['check'],{cwd:join(base,'after'),encoding:'utf8'});
writeFileSync(join(import.meta.dirname,'checks/pilot-schema.log'),checked.stdout+checked.stderr);if(checked.status!==0)throw Error('pilot schema check failed');
const specimen=join(base,'after/specimen.tsx');
writeFileSync(specimen,`import React,{useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {useClient,usePage,useQuery} from 'snapback4/react';import {api} from './snapback/generated/api';import {PageLifetime} from './PageLifetime';
const Text=({children}:{children:React.ReactNode})=><span>{children}</span>;
function History({id}:{id:string}) {const client=useClient();
const lifetime=useMemo(()=>new PageLifetime(client,api.history,{conversation:id,c:null}),[client,id]);
const scope=useSyncExternalStore(lifetime.subscribe,lifetime.getSnapshot,lifetime.getSnapshot),historyOp=useMemo(()=>({...api.history}),[scope.epoch]);
const page=usePage(historyOp,{conversation:id});
${specimens.L1[1].text}
${specimens.L3[1].text}
return <>{historyKeys.map(key=><StableMessage key={\`\${scope.epoch}:\${key.id}\`} id={key.id}>{m=><Text>{m.text}</Text>}</StableMessage>)}</>;}
${specimens.L2[1].text}
`);
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,strict:true,noEmit:true,skipLibCheck:true,jsx:ts.JsxEmit.ReactJSX,baseUrl:root,paths:{'snapback4/*':['packages/snapback4/dist/*']},typeRoots:[join(root,'node_modules/@types')]};
const program=ts.createProgram([specimen],options),errors=ts.getPreEmitDiagnostics(program);
if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
const parsed=ts.transpileModule(after,{compilerOptions:options,reportDiagnostics:true});if(parsed.diagnostics?.length)throw Error('full edited chat syntax');
console.log('Cal29: schema, generated API + L1/L2/L3 ownership specimen strict typecheck, full edited chat syntax: PASS');
console.log('Scope: complete before/after components and published bounded screen mounted with UI substitutes; not full Cal29 application/native-runtime qualification.');
