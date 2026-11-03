import ts from '../../../node_modules/typescript/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';
const files=['packages/snapback4/src/local.ts','packages/snapback4/src/local-runtime.ts'];
const config=ts.readConfigFile('packages/snapback4/tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'packages/snapback4');
const host={getCompilationSettings:()=>parsed.options,getScriptFileNames:()=>parsed.fileNames,getScriptVersion:()=> '1',getScriptSnapshot:file=>ts.sys.fileExists(file)?ts.ScriptSnapshot.fromString(ts.sys.readFile(file)):undefined,getCurrentDirectory:()=>process.cwd(),getDefaultLibFileName:ts.getDefaultLibFilePath,...ts.sys};
const service=ts.createLanguageService(host);
for(const file of files){const changes=service.organizeImports({type:'file',fileName:file},{},{organizeImportsIgnoreCase:false});let s=readFileSync(file,'utf8');for(const c of changes.flatMap(c=>c.textChanges).sort((a,b)=>b.span.start-a.span.start)) s=s.slice(0,c.span.start)+c.newText+s.slice(c.span.start+c.span.length);writeFileSync(file,s);console.log(`${file}: ${s.split('\n').length-1} lines`);}
