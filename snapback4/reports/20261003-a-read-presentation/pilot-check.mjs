// Exact frozen builder files; physical lines and UTF-8 bytes, excluding final newline.
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {existence,isReady,readPresentation} from '../../packages/snapback4/dist/contract.js';
import {readyRead} from '../../packages/snapback4/dist/read-existence.js';
const root=resolve(import.meta.dirname,'../..');
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const read=p=>readFileSync(p,'utf8');
const count=s=>{s=s.replace(/\n$/,'');return {lines:s.split('\n').length,bytes:Buffer.byteLength(s)};};
const measurements=JSON.parse(read(join(root,'reports/20261003-cx-client-contract/measurements.json')));
const pkg=createRequire(join(root,'packages/snapback4/package.json'));
const React=pkg('react'),jsx=pkg('react/jsx-runtime'),{renderToStaticMarkup}=pkg('react-dom/server');
function noticeComponent(source) {
 const exports={};
 const require=name=>name==='react/jsx-runtime'?jsx:name==='snapback4/contract'?{existence,isReady}:name==='react-native'?{
  View:({children})=>React.createElement('div',null,children),Text:({children})=>React.createElement('span',null,children),
 }:null;
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require});
 return exports.ReadNotice;
}
const cases=[{loading:true},{denied:{code:'NO',family:'test',message:'Refused'}}];
for(const data of [null,[],['row'],false,0,'',{nested:null}])
for(const complete of [true,false])for(const cut of [null,'meter','words'])
for(const next of [undefined,null,'more'])for(const pending of [false,true])
for(const fresh of [true,false])for(const revalidating of [undefined,true]) {
 cases.push(readyRead({data,complete,cut,next,fresh,revalidating,since:0},pending));
}
const results=[];
for(const [id,pilot,file] of [['A1','cal29','search.tsx'],['A2','g47','AuthGate.tsx']]) {
 const dir=join(import.meta.dirname,'pilots',pilot),before=read(join(dir,'before/src',file)),after=read(join(dir,'after/src',file));
 const original=measurements.specimens.find(s=>s.id===id);
 const sha=createHash('sha256').update(before).digest('hex');
 if(sha!==original.sha256)throw Error(id+' original changed');
 const checked=spawnSync(binary,['check'],{cwd:join(dir,'after'),encoding:'utf8'});
 writeFileSync(join(import.meta.dirname,`pilot-${pilot}-schema.log`),checked.stdout+checked.stderr);
 if(checked.status!==0)throw Error(pilot+' schema check failed');
 const span=id==='A1'?after.match(/loading=\{status.pending\} emptyText=\{[^\n]+?\} /)[0].trimEnd():after.match(/function EnsureProfile[\s\S]*?\n}/)[0];
 const notice=read(join(dir,'after/src/ReadNotice.tsx'));
 const directNotice=notice.replace('import type { ReadPresentation }','import { existence, isReady, type Read }')
  .replace('({ status }: { status: ReadPresentation })', '({ read }: { read: Read<unknown> })')
  .replace('  return <View', '  const state = existence(read);\n  return <View')
  .replaceAll('status.pending', 'state === "loading"')
  .replaceAll('status.why &&', '"denied" in read &&').replaceAll('status.why.message','read.denied.message')
  .replaceAll('status.incomplete', 'isReady(read) && (state === "partial" || !read.complete || read.cut !== null || read.next != null)')
  .replaceAll('status.stale','isReady(read) && !read.fresh').replaceAll('status.since','read.since')
  .replaceAll('status.revalidating','isReady(read) && read.revalidating');
 let directApp=after.replace(/import \{readPresentation\} from 'snapback4\/contract';/, 'import {existence} from \'snapback4/contract\';')
  .replace('import { readPresentation } from "snapback4/contract";\n','')
  .replace('const status=readPresentation(page.read);','')
  .replace('loading={status.pending}', 'loading={existence(page.read)===\'loading\'}')
  .replace('status.existence===\'absent\'', 'existence(page.read)===\'absent\'')
  .replace('const status = readPresentation(useQuery(api.myProfile, {}));', 'const profile = useQuery(api.myProfile, {});')
  .replace('<ReadNotice status={status}', '<ReadNotice read={'+(id==='A1'?'page.read':'profile')+'}');
 writeFileSync(join(dir,'after/direct-notice.tsx'),directNotice);
 writeFileSync(join(dir,'after/direct-app.tsx'),directApp);
 const withHelper=noticeComponent(notice),withoutHelper=noticeComponent(directNotice);
 for(const read of cases)assert.equal(renderToStaticMarkup(React.createElement(withHelper,{status:readPresentation(read)})),
  renderToStaticMarkup(React.createElement(withoutHelper,{read})),id+' same notice behavior');
 const specimen=id==='A1'?`import {readPresentation} from 'snapback4/contract';
import {usePage} from 'snapback4/react';
import {api} from './snapback/generated/api';
import {ReadNotice} from './src/ReadNotice';
const page=usePage(api.searchMessages,{q:''});
${after.match(/const status=readPresentation\(page.read\);/)[0]}
function Widget(props:{loading:boolean;emptyText:string}){return null;}
export const result=<><Widget ${span}/><ReadNotice status={status}/></>;
`:`import {readPresentation} from 'snapback4/contract';
import {useQuery} from 'snapback4/react';
import {api} from './snapback/generated/api';
import {ReadNotice} from './src/ReadNotice';
${span}
`;
 const specimenFile=join(dir,'after/specimen.tsx');writeFileSync(specimenFile,specimen);
 const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  strict:true,noEmit:true,skipLibCheck:true,allowImportingTsExtensions:true,jsx:ts.JsxEmit.ReactJSX,
  baseUrl:root,paths:{'snapback4/*':['packages/snapback4/dist/*'],'react-native':['apps/chat-expo/node_modules/react-native/types/index.d.ts']},
  typeRoots:[join(root,'node_modules/@types')]};
 const directSpecimen = specimen.replace("import {readPresentation}","import {existence}")
  .replace("'./src/ReadNotice'", "'./direct-notice'")
  .replace('const status=readPresentation(page.read);','')
  .replace('loading={status.pending}', 'loading={existence(page.read)===\'loading\'}')
  .replace('status.existence===\'absent\'', 'existence(page.read)===\'absent\'')
  .replace('const status = readPresentation(useQuery(api.myProfile, {}));', 'const profile = useQuery(api.myProfile, {});')
  .replace('<ReadNotice status={status}', '<ReadNotice read={'+(id==='A1'?'page.read':'profile')+'}');
 const directSpecimenFile=join(dir,'after/direct-specimen.tsx');writeFileSync(directSpecimenFile,directSpecimen);
 const program=ts.createProgram([specimenFile,directSpecimenFile],options);
 const errors=ts.getPreEmitDiagnostics(program);
 if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 const parsed=ts.transpileModule(after,{compilerOptions:options,reportDiagnostics:true});
 if(parsed.diagnostics?.length)throw Error(pilot+' full source did not parse');
 results.push({id,pilot,sha256:sha,excerpt:{before:count(original.excerpt),after:count(span)},
  wholeFile:{before:count(before),after:count(after)},addedNotice:count(notice),recipeOnly:{wholeFile:count(directApp),notice:count(directNotice)},
  ...(id==='A1'?{binding:count('const status=readPresentation(page.read);'),noticeCall:count('<ReadNotice status={status}/>')}:{}),
  afterSha256:createHash('sha256').update(after).digest('hex')});
 console.log(`${pilot}: original hash, schema, generated API + changed integration strict types, full edited source syntax, ${cases.length} recipe-only notice equivalence cases: PASS`);
}
writeFileSync(join(import.meta.dirname,'pilots.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
console.log('Scope: changed integrations; not full-app or native UI qualification. Shared notice code is charged separately.');
