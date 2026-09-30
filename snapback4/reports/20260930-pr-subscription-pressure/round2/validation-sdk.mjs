import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
const root='target/pr-r2-validation';mkdirSync(root,{recursive:true});
cpSync('packages/snapback4/dist',root+'/dist',{recursive:true});cpSync('packages/snapback4/package.json',root+'/package.json');
const file='packages/snapback4/src/local-reads.ts';
writeFileSync(root+'/dist/local-reads.js',ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,rewriteRelativeImportExtensions:true}}).outputText);
