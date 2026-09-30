// Run from snapback4/: isolated SDK control; real current devices/server are shared.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const [ref, label] = process.argv.slice(2), target = `target/pr-r2-${label}`;
mkdirSync(target, {recursive:true});
cpSync('packages/snapback4/dist', `${target}/dist`, {recursive:true});
cpSync('packages/snapback4/package.json', `${target}/package.json`);
const prefix='snapback4/packages/snapback4/src/';
const files=execFileSync('git',['-C','..','ls-tree','-r','--name-only',ref,'--',prefix],{encoding:'utf8'}).trim().split('\n');
if (!files.some(p=>p.endsWith('/local.ts'))) throw Error('missing baseline source inventory');
for(const path of files.filter(p=>/\.tsx?$/.test(p)&&!p.endsWith('.d.ts'))) {
 const source=execFileSync('git',['show',`${ref}:${path}`],{encoding:'utf8'});
 const file=path.slice(prefix.length).replace(/\.tsx?$/,'.js');
 mkdirSync(`${target}/dist/${file.split('/').slice(0,-1).join('/')}`,{recursive:true});
 writeFileSync(`${target}/dist/${file}`,ts.transpileModule(source,{fileName:path,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,rewriteRelativeImportExtensions:true,jsx:ts.JsxEmit.ReactJSX}}).outputText);
}
writeFileSync(`${target}/control.json`, JSON.stringify({ref:execFileSync('git',['rev-parse',ref],{encoding:'utf8'}).trim(), files},null,2)+'\n');
