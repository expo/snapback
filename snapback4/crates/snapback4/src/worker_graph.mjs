import {createRequire,isBuiltin} from 'node:module';
import {existsSync,realpathSync,readFileSync,statSync} from 'node:fs';
import {resolve,dirname,sep,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [root,entry,...imports]=process.argv.slice(1),files=new Set(),watch=new Set();
let failure;
const local=path=>path===root||path.startsWith(root+sep);
const scopes=path=>{for(let dir=dirname(path);local(dir);dir=dirname(dir)){const pkg=resolve(dir,'package.json');if(existsSync(pkg))files.add(pkg);if(dir===root)break;}};
scopes(entry);
for(const encoded of imports){
 const [spec,kind]=JSON.parse(encoded);
 if(isBuiltin(spec))continue;
 if(isAbsolute(spec)||spec.startsWith('file:')){failure='use project-relative worker imports, not absolute/file URL imports';break;}
 let runtime;
 try{
  const resolved=kind==='require'?createRequire(entry).resolve(spec):import.meta.resolve(spec,pathToFileURL(entry).href);
  if(isBuiltin(resolved))continue;
  runtime=resolved.startsWith('file:')?fileURLToPath(resolved):resolved;
  if(!statSync(runtime).isFile())throw Error('local runtime module is missing or is a directory');
  const actual=realpathSync(runtime);
  if(!local(actual)){
   if(spec.startsWith('.'))throw Error('local worker imports must remain inside the project');
   continue; // installed host package
  }
  if(actual.split(sep).includes('node_modules'))continue;
  files.add(actual);scopes(actual);
  const packageFile=resolve(dirname(entry),spec,'package.json');if(existsSync(packageFile))files.add(packageFile);
 }catch(error){
  if(spec.startsWith('.')||runtime&&local(runtime)){
   if(runtime&&local(runtime)){for(let path=runtime;local(path);path=dirname(path)){watch.add(path);if(path===root)break;}}
   const base=resolve(dirname(entry),spec);
   for(let path=base;local(path);path=dirname(path)){watch.add(path);if(path===root)break;}
   try{const pkg=JSON.parse(readFileSync(resolve(base,'package.json'),'utf8'));if(typeof pkg.main==='string'){let path=resolve(base,pkg.main);for(;local(path);path=dirname(path)){watch.add(path);if(path===root)break;}}}catch{}
  }
  failure=error.message;break;
 }
}
console.log(JSON.stringify({files:[...files],watch:[...watch]}));
if(failure){console.error(failure);process.exitCode=1;}
