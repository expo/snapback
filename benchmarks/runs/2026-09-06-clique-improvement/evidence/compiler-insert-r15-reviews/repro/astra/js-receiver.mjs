import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../snapback2/node_modules/typescript/lib/typescript.js';
const input=JSON.parse(fs.readFileSync(new URL('./custom2.json',import.meta.url),'utf8'))[3];
const js=ts.transpileModule(input.source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const logs=[];
const exports={};
const initialDb={insert(...args){logs.push({insert:args});return args[1];},get(...args){logs.push({get:args});return null;}};
const context={exports,require(name){if(name==='snapback2')return {mutation:(_args,handler)=>handler,t:{json:n=>n}};if(name==='./schema')return {records:'records'};throw new Error(name);}};
vm.runInNewContext(js,context);
let i=0,error,result;
try{result=exports.probe({db:initialDb,ctx:{newId(){return `id-${++i}`;}},args:{payload:{}}});}catch(e){error={name:e.name,message:e.message};}
const out={scope:'ordinary checked-private JavaScript receiver semantics; mocked module constructors/table and initial db, not native/server',source:input.source,js,arguments:{payload:{}},error,result,initialDbCalls:logs,idsAllocated:i};
fs.writeFileSync(new URL('./js-receiver-result.json',import.meta.url),JSON.stringify(out,null,2));
console.log(JSON.stringify(out));
if(error?.name!=='TypeError'||logs.length!==0)process.exitCode=1;
