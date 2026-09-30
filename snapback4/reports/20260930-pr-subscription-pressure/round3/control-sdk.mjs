// SDK-only round-2 control: current server/device, exact prior SDK sources.
import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const dest='target/pr-r3-round2';mkdirSync(dest,{recursive:true});
cpSync('packages/snapback4/dist',dest+'/dist',{recursive:true});
cpSync('packages/snapback4/package.json',dest+'/package.json');
const files=execFileSync('git',['ls-tree','-r','--name-only','1a602df58d','--','packages/snapback4/src'],{encoding:'utf8'}).trim().split('\n');
for(const file of files.filter(f=>f.endsWith('.ts')&&!f.endsWith('.d.ts')&&!f.includes('/wasm/'))){
 const source=execFileSync('git',['show',`1a602df58d:snapback4/${file}`],{encoding:'utf8'});
 const relative=file.replace('packages/snapback4/src/','').replace(/\.ts$/,'.js');
 writeFileSync(`${dest}/dist/${relative}`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,rewriteRelativeImportExtensions:true}}).outputText);
}
console.log(`Built ${files.length} source paths from 1a602df58d under ${dest}`);
